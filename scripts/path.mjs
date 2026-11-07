/**
 * The data layer: reading a character's facts, the leader's request handlers (learn, refund, GM award / enable / trees) and the one
 * place that writes `flags.wanderers-path.picks`. Every write runs on the leader (core's one-writer election), after the sending
 * user's rights are checked from Foundry's sender (never a payload field) and the rules are checked with the pure model. After each
 * write the character's granted documents are reconciled (grants.mjs). The leader's work runs one request at a time per character.
 * Untested in Node: needs a live world (the rules are tested in picks-model and grants-model).
 */
import { storeDeletions, deletionKeys } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, HOOKS, PICKS_FLAG } from "./const.mjs";
import { F, S, leader, log, warn } from "./core.mjs";
import * as P from "./picks-model.mjs";
import { NOTICE_HOOK, readNotice, pendingFrom } from "./requests-model.mjs";
import { loadTrees, loadTreesChecked } from "./trees.mjs";
import * as G from "./grants-model.mjs";
import * as Grants from "./grants.mjs";
import { builderSupported } from "./builder-model.mjs";

/** @typedef {import("./picks-model.mjs").Picks} Picks */

/** Whether built (template) grants can run in this world: Foundry 14 and dnd5e 6. */
export const builtOk = () => builderSupported({ generation: game.release?.generation, system: game.system?.id, systemVersion: game.system?.version });

/** What the character should be granted now. @param {Awaited<ReturnType<typeof stateOf>>} st */
export const desiredOf = st => G.desiredGrants(st.picks, G.grantTrees(st.seen), { built: builtOk() });

/** The world rules from the settings. */
export const rules = () => P.readRules({
  enabledForAll: S.get("enabledForAll"), unlockLevel: S.get("unlockLevel"), pointsFromLevel: S.get("pointsFromLevel"),
  pointsPerLevel: S.get("pointsPerLevel"), playerRespec: S.get("playerRespec")
});

/** A character's stored picks (normalized). @param {any} actor @returns {Picks} */
export const picksOf = actor => P.normalizePicks(actor?.getFlag?.(ID, PICKS_FLAG) ?? actor?.flags?.[ID]?.[PICKS_FLAG]);

/**
 * What the rules need to know about a character: level, class and subclass identifiers (dnd5e: `actor.classes` keyed by
 * identifier, subclass items' `identifier`).
 * @param {any} actor
 */
export function actorFacts(actor) {
  let classes = [], subclasses = [];
  try { classes = Object.keys(actor?.classes ?? {}); } catch { classes = []; }
  try { subclasses = (actor?.itemTypes?.subclass ?? []).map((/** @type {any} */ i) => String(i.identifier ?? "")).filter(Boolean); } catch { subclasses = []; }
  const level = Number(actor?.system?.details?.level ?? 0) || 0;
  return { level, classes, subclasses };
}

/**
 * What a character's grants look like without loading any source: { count, outOfSync, advancement } (grants-model `grantSummary`).
 * Nothing is counted as removable while the trees couldn't be read.
 * @param {any} actor @param {Awaited<ReturnType<typeof stateOf>>} st @param {boolean} [treesOk]
 */
export function grantSummaryOf(actor, st, treesOk = true) {
  try { return G.grantSummary(desiredOf(st), Grants.existingOf(actor), { keepTree: () => !treesOk }); }
  catch (e) { warn("grant summary", e); return { count: 0, outOfSync: 0, advancement: [] }; }
}

/** Everything the window and the API need for one character. @param {any} actor */
export async function stateOf(actor) {
  const trees = await loadTrees();
  const picks = picksOf(actor); const r = rules(); const fx = actorFacts(actor);
  const seen = P.treesFor({ trees, picks, classes: fx.classes, subclasses: fx.subclasses, level: fx.level, rules: r });
  return { trees, picks, rules: r, facts: fx, seen, points: P.pointsFor({ level: fx.level, picks, trees, rules: r }) };
}

/** An Actor from an Actor, id or UUID (null when there is none). @param {any} a */
export function actorFrom(a) {
  if (!a) return null;
  if (a instanceof Actor) return a;
  if (typeof a === "string") return game.actors?.get(a) ?? (a.includes(".") ? fromUuidSync(a) : null) ?? null;
  return null;
}

// ---------------------------------------------------------------- notices
let noticeHooked = false;
/** Ready hook, every client: shows notices meant for this user and starts the leader. */
export function start() {
  if (!noticeHooked) {
    noticeHooked = true;
    Hooks.on(NOTICE_HOOK, (/** @type {unknown} */ payload) => { const n = readNotice(payload, game.user?.id); if (n) ui.notifications[n.level](n.text); });
  }
  leader.start();
}

/** Leader: a notice on one user's client. @param {string} to @param {string} text @param {"info" | "warn"} [level] */
function notify(to, text, level = "info") {
  const payload = { to, level, text: `${TITLE}: ${String(text).slice(0, 260)}` };
  if (leader.isLeader()) leader.broadcastHook(NOTICE_HOOK, payload);
  else if (to === game.user?.id) ui.notifications[level](payload.text);
}

/** Fires one of our public hooks (ids only) on every client, when "Hooks for other modules" is on. @param {string} name @param {object} payload */
function fireHook(name, payload) {
  if (!F.on("moduleHooks")) return;
  try { leader.broadcastHook(name, payload); } catch (e) { warn(`hook ${name}`, e); }
}

// ---------------------------------------------------------------- the write
/**
 * Writes picks (leader only). Keys gone from the new picks are deleted (Foundry merges object updates), with v14's deletion
 * operator when there is one, else "-=" keys.
 * @param {any} actor @param {Picks} next
 */
async function writePicks(actor, next) {
  if (!leader.isLeader()) throw new Error(`${ID}: only the leader writes picks`);
  const base = `flags.${ID}.${PICKS_FLAG}`;
  const prev = picksOf(actor);
  const clean = P.normalizePicks(next);
  const del = deletionKeys(storeDeletions(prev, clean, base, 3), /** @type {any} */ (globalThis)._del);
  await actor.update({ [base]: clean, ...del });
  log(`picks written for ${actor.name}`);
  return clean;
}

// ---------------------------------------------------------------- grants
/** The leader's work, one at a time per character. */
const queue = G.serial();

/**
 * Makes the character's tagged items and effects match their learned talents (leader only; call inside the character's queue).
 * While the tree compendium can't be read nothing is removed. A GM is told when granted items carry dnd5e advancement.
 * @param {any} actor @param {{ refresh?: boolean, to?: string }} [o] `to`: the user to tell about problems
 */
async function syncGrants(actor, { refresh = false, to } = {}) {
  try {
    const { ok } = await loadTreesChecked();
    // With the trees unknown nothing can be judged: granted documents stay as they are until the compendium reads again.
    if (!ok) { log(`grants for ${actor.name}: skipped, the tree compendium can't be read`); return null; }
    const st = await stateOf(actor);
    const r = await Grants.reconcile(actor, desiredOf(st), { refresh });
    const gm = to && game.users?.get(to)?.isGM ? to : null;
    if (gm && r.plan.missing.length) notify(gm, `${actor.name}: ${r.plan.missing.length} granted ${r.plan.missing.length === 1 ? "document wasn't" : "documents weren't"} found (see the health check).`, "warn");
    if (gm && r.result.advancement.length) notify(gm, `${actor.name}: ${r.result.advancement.join(", ")} ${r.result.advancement.length === 1 ? "has" : "have"} advancement, which doesn't run on talent grants.`, "warn");
    return r;
  } catch (e) { warn(`grants for ${actor?.name}`, e); return null; }
}

/** The actor a request names, and whether its sender may change it. @param {any} data @param {any} user */
function target(data, user) {
  const actor = game.actors?.get(data.actorId);
  if (!actor) return { error: "That character isn't in this world." };
  if (actor.type !== "character") return { error: `${actor.name} isn't a player character.` };
  if (!user?.isGM && !actor.testUserPermission(user, "OWNER")) return { error: `You don't own ${actor.name}.` };
  return { actor };
}

/** A short "who did it" for the log: the user's name. @param {any} user */
const who = user => String(user?.name ?? "").slice(0, 40);

/** pathLearn (leader). @param {any} data @param {any} user */
async function onLearn(data, user) {
  const t = target(data, user); if (!t.actor) return notify(user.id, t.error ?? "", "warn");
  const actor = t.actor;
  const st = await stateOf(actor);
  const v = P.validatePending({ trees: st.trees, picks: st.picks, pending: pendingFrom(st.picks.ranks, data.changes), level: st.facts.level, rules: st.rules, classes: st.facts.classes, subclasses: st.facts.subclasses });
  if (!v.ok) return notify(user.id, `Not learned: ${v.errors.slice(0, 3).join(" ")}`, "warn");
  const names = v.changes.map(c => st.trees.find(x => x.id === c.tree)?.nodes.find(n => n.id === c.node)?.name ?? c.node);
  let next = { ...st.picks, ranks: v.ranks };
  next = P.withLog(next, { at: Date.now(), by: who(user), kind: "learn", text: `Learned ${names.join(", ")} (${v.cost} ${v.cost === 1 ? "point" : "points"}).` });
  await writePicks(actor, next);
  await syncGrants(actor, { to: user.id });
  notify(user.id, `${actor.name} learned ${names.join(", ")}.`);
  fireHook(HOOKS.learned, { actorId: actor.id, userId: user.id, changes: v.changes });
}

/** pathRefund (leader): players only while player respec is on; a GM always, for free. @param {any} data @param {any} user */
async function onRefund(data, user) {
  const t = target(data, user); if (!t.actor) return notify(user.id, t.error ?? "", "warn");
  const actor = t.actor;
  const st = await stateOf(actor);
  if (!user.isGM && !st.rules.playerRespec) return notify(user.id, "Refunds are off in this world (ask your GM).", "warn");
  /** @type {Picks["ranks"]} */ const ranks = structuredClone(st.picks.ranks);
  /** @type {{ tree: string, node: string, from: number, to: number }[]} */ const removed = [];
  const treeIds = data.tree ? [data.tree] : Object.keys(ranks);
  for (const tid of treeIds) {
    if (!ranks[tid]) continue;
    const tree = st.trees.find(x => x.id === tid);
    if (!tree) { if (data.node) continue; for (const [node, r] of Object.entries(ranks[tid])) removed.push({ tree: tid, node, from: r, to: 0 }); delete ranks[tid]; continue; }
    const plan = P.refundPlan(tree, ranks[tid], { node: data.tree ? data.node : undefined, all: !!data.all, level: st.facts.level });
    for (const r of plan.removed) removed.push({ tree: tid, ...r });
    if (Object.keys(plan.ranks).length) ranks[tid] = plan.ranks; else delete ranks[tid];
  }
  if (!removed.length) return notify(user.id, "Nothing to refund.", "warn");
  const pts = removed.length;
  const scope = data.node ? "a talent" : data.tree ? (st.trees.find(x => x.id === data.tree)?.name ?? data.tree) : "every tree";
  let next = { ...st.picks, ranks };
  next = P.withLog(next, { at: Date.now(), by: who(user), kind: data.node ? "refund" : "respec", text: `Refunded ${scope} (${pts} ${pts === 1 ? "talent" : "talents"} changed).` });
  await writePicks(actor, next);
  await syncGrants(actor, { to: user.id });
  notify(user.id, `${actor.name}: refunded ${scope}.`);
  fireHook(HOOKS.respec, { actorId: actor.id, userId: user.id, tree: data.tree ?? null, removed });
}

/** pathAward (leader, GM senders only). @param {any} data @param {any} user */
async function onAward(data, user) {
  const t = target(data, user); if (!t.actor) return notify(user.id, t.error ?? "", "warn");
  const p = picksOf(t.actor);
  const at = Date.now();
  let next = P.withAward(p, { id: `${at.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, n: data.n, reason: data.reason, at, by: who(user) });
  if (next === p) return notify(user.id, "An award needs a number of points.", "warn");
  next = P.withLog(next, { at, by: who(user), kind: "award", text: `${data.n > 0 ? "+" : ""}${data.n} ${Math.abs(data.n) === 1 ? "point" : "points"}${data.reason ? `: ${data.reason}` : ""}` });
  await writePicks(t.actor, next);
  await syncGrants(t.actor, { to: user.id });
  notify(user.id, `${t.actor.name}: ${data.n > 0 ? "awarded" : "took back"} ${Math.abs(data.n)} ${Math.abs(data.n) === 1 ? "point" : "points"}.`);
}

/** pathEnable (leader, GM senders only). @param {any} data @param {any} user */
async function onEnable(data, user) {
  const t = target(data, user); if (!t.actor) return notify(user.id, t.error ?? "", "warn");
  const enabled = data.enabled === "on" ? true : data.enabled === "off" ? false : null;
  let next = { ...picksOf(t.actor), enabled };
  next = P.withLog(next, { at: Date.now(), by: who(user), kind: "enable", text: `Talents ${enabled === null ? "follow the world setting" : enabled ? "on" : "off"}.` });
  await writePicks(t.actor, next);
  await syncGrants(t.actor, { to: user.id });
}

/** pathTrees (leader, GM senders only). @param {any} data @param {any} user */
async function onTrees(data, user) {
  const t = target(data, user); if (!t.actor) return notify(user.id, t.error ?? "", "warn");
  const p = picksOf(t.actor);
  const add = p.trees.add.filter(x => x !== data.tree); const remove = p.trees.remove.filter(x => x !== data.tree);
  if (data.op === "add") add.push(data.tree); else if (data.op === "remove") remove.push(data.tree);
  let next = { ...p, trees: { add, remove } };
  next = P.withLog(next, { at: Date.now(), by: who(user), kind: "trees", text: `Tree ${data.tree}: ${data.op === "auto" ? "automatic" : data.op === "add" ? "added" : "removed"}.` });
  await writePicks(t.actor, next);
  await syncGrants(t.actor, { to: user.id });
}

/** The characters a GM-wide request covers: one (actorId), else every player character with picks or granted documents. @param {any} data */
function actorsFor(data) {
  if (data.actorId) { const a = game.actors?.get(data.actorId); return a && a.type === "character" ? [a] : []; }
  return (game.actors?.contents ?? []).filter((/** @type {any} */ a) => a.type === "character" && (a.flags?.[ID]?.[PICKS_FLAG] || Grants.existingOf(a).length));
}

/** pathRefresh (leader, GM senders only): every granted document made again from its source where the source changed. @param {any} data @param {any} user */
async function onRefresh(data, user) {
  const list = actorsFor(data);
  if (!list.length) return notify(user.id, "No character to refresh.", "warn");
  let changed = 0, missing = 0;
  for (const a of list) {
    const r = await queue.run(a.id, () => syncGrants(a, { refresh: true, to: user.id }));
    if (r?.result) changed += r.result.created + r.result.removed + r.result.updated;
    missing += r?.plan?.missing.length ?? 0;
  }
  notify(user.id, `Refreshed granted items for ${list.length === 1 ? list[0].name : `${list.length} characters`}: ${changed ? `${changed} ${changed === 1 ? "change" : "changes"}` : "nothing to change"}${missing ? `, ${missing} missing` : ""}.`);
}

/** pathOrphans (leader, GM senders only): ranks in trees or talents no longer published are refunded, and their grants removed. @param {any} data @param {any} user */
async function onOrphans(data, user) {
  const { trees, ok } = await loadTreesChecked();
  if (!ok) return notify(user.id, "The tree compendium can't be read, so nothing is refunded.", "warn");
  let n = 0;
  for (const a of actorsFor(data)) {
    await queue.run(a.id, async () => {
      const p = picksOf(a);
      const o = G.orphanRanks(p, trees);
      if (!o.removed.length) return;
      n++;
      let next = { ...p, ranks: o.ranks };
      next = P.withLog(next, { at: Date.now(), by: who(user), kind: "orphans", text: `Refunded ${o.removed.length} ${o.removed.length === 1 ? "talent" : "talents"} no longer published.` });
      await writePicks(a, next);
      await syncGrants(a, { to: user.id });
      fireHook(HOOKS.respec, { actorId: a.id, userId: user.id, tree: null, removed: o.removed });
    });
  }
  notify(user.id, n ? `Refunded unpublished talents for ${n} ${n === 1 ? "character" : "characters"}.` : "No character has unpublished talents.");
}

/** Registers the leader's handlers (ready, feature on). */
export function registerHandlers() {
  /** One character's requests run one at a time. @param {(data: any, user: any) => Promise<unknown>} fn */
  const one = fn => (/** @type {any} */ data, /** @type {any} */ user) => queue.run(String(data.actorId), () => fn(data, user));
  leader.handle("pathLearn", one(onLearn));
  leader.handle("pathRefund", one(onRefund));
  leader.handle("pathAward", one(onAward));
  leader.handle("pathEnable", one(onEnable));
  leader.handle("pathTrees", one(onTrees));
  leader.handle("pathRefresh", onRefresh);
  leader.handle("pathOrphans", onOrphans);
}

/**
 * Sends a request (any user). False, with a notice, when no GM is connected or the data doesn't fit.
 * @param {"pathLearn" | "pathRefund" | "pathAward" | "pathEnable" | "pathTrees" | "pathRefresh" | "pathOrphans"} kind @param {Record<string, unknown>} data
 */
export function send(kind, data) {
  const ok = leader.request(kind, data);
  if (!ok) ui.notifications.warn(`${TITLE}: ${leader.activeGM() ? "that request couldn't be sent." : "a GM must be connected to change talents."}`);
  return ok;
}

/** Whether a GM is connected (learning needs one). */
export const gmConnected = () => !!leader.activeGM();
