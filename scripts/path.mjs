/**
 * The data layer: reading a character's facts, the leader's request handlers (learn, refund, GM award / enable / trees) and the one
 * place that writes `flags.wanderers-path.picks`. Every write runs on the leader (core's one-writer election), after the sending
 * user's rights are checked from Foundry's sender (never a payload field) and the rules are checked with the pure model. No grants
 * yet (the grant engine comes in a later version). Untested in Node: needs a live world (the rules are tested in picks-model).
 */
import { storeDeletions, deletionKeys } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, HOOKS, PICKS_FLAG } from "./const.mjs";
import { F, S, leader, log, warn } from "./core.mjs";
import * as P from "./picks-model.mjs";
import { NOTICE_HOOK, readNotice, pendingFrom } from "./requests-model.mjs";
import { loadTrees } from "./trees.mjs";

/** @typedef {import("./picks-model.mjs").Picks} Picks */

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
  notify(user.id, `${t.actor.name}: ${data.n > 0 ? "awarded" : "took back"} ${Math.abs(data.n)} ${Math.abs(data.n) === 1 ? "point" : "points"}.`);
}

/** pathEnable (leader, GM senders only). @param {any} data @param {any} user */
async function onEnable(data, user) {
  const t = target(data, user); if (!t.actor) return notify(user.id, t.error ?? "", "warn");
  const enabled = data.enabled === "on" ? true : data.enabled === "off" ? false : null;
  let next = { ...picksOf(t.actor), enabled };
  next = P.withLog(next, { at: Date.now(), by: who(user), kind: "enable", text: `Talents ${enabled === null ? "follow the world setting" : enabled ? "on" : "off"}.` });
  await writePicks(t.actor, next);
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
}

/** Registers the leader's handlers (ready, feature on). */
export function registerHandlers() {
  leader.handle("pathLearn", onLearn);
  leader.handle("pathRefund", onRefund);
  leader.handle("pathAward", onAward);
  leader.handle("pathEnable", onEnable);
  leader.handle("pathTrees", onTrees);
}

/**
 * Sends a request (any user). False, with a notice, when no GM is connected or the data doesn't fit.
 * @param {"pathLearn" | "pathRefund" | "pathAward" | "pathEnable" | "pathTrees"} kind @param {Record<string, unknown>} data
 */
export function send(kind, data) {
  const ok = leader.request(kind, data);
  if (!ok) ui.notifications.warn(`${TITLE}: ${leader.activeGM() ? "that request couldn't be sent." : "a GM must be connected to change talents."}`);
  return ok;
}

/** Whether a GM is connected (learning needs one). */
export const gmConnected = () => !!leader.activeGM();
