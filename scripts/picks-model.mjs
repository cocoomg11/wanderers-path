/**
 * A character's picks and the rules for spending points, pure (tested in Node: tests/picks-model.test.mjs). No Foundry calls.
 *
 * Picks live on the actor in `flags.wanderers-path.picks` (PICKS_VERSION 1), read through `normalizePicks` (never throws):
 *   { v, enabled: true | false | null (null = the world's "Talents for every character"), trees: { add: [treeId], remove: [treeId] },
 *     ranks: { treeId: { nodeId: n } }, awards: [{ id, n, reason, at, by }], log: [{ id, at, by, kind, text }] }
 * The log keeps the newest LOG_MAX entries (core's addCapped). Awards keep the newest AWARDS_MAX; older ones fold into one "carried"
 * entry so no point is ever lost. Granted documents are found by their tag (slice 4), never stored here.
 *
 * Rules (`Rules`, from the world settings): { enabledForAll, unlockLevel, pointsFromLevel, pointsPerLevel, playerRespec }.
 * One pool per character across trees; a tiered tree's tier gate counts the points spent in that tree's lower tiers.
 */
import { versioned, addCapped } from "../vendor/wanderers-core/index.mjs";
import { clampInt, MAX_RANKS, NODE_ID_RE, MAX_LEVEL, neighbours } from "./tree-model.mjs";

export const PICKS_VERSION = 1;
export const LOG_MAX = 50;
export const AWARDS_MAX = 100;
export const AWARD_MAX = 50;
export const REASON_MAX = 200;
export const LOG_TEXT_MAX = 300;
export const MAX_TREES = 50;
export const LOG_KINDS = /** @type {const} */ (["learn", "refund", "respec", "award", "enable", "trees"]);
/** The award id older awards fold into when the list is full. */
export const CARRIED = "carried";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {import("./tree-model.mjs").TalentNode} TalentNode */
/** @typedef {{ id: string, n: number, reason: string, at: number, by: string }} Award */
/** @typedef {{ id: string, at: number, by: string, kind: string, text: string }} LogEntry */
/**
 * @typedef {object} Picks
 * @property {number} v @property {boolean | null} enabled @property {{ add: string[], remove: string[] }} trees
 * @property {Record<string, Record<string, number>>} ranks @property {Award[]} awards @property {LogEntry[]} log
 */
/** @typedef {{ enabledForAll: boolean, unlockLevel: number, pointsFromLevel: number, pointsPerLevel: number, playerRespec: boolean }} Rules */
/** @typedef {Record<string, number>} Ranks node id → ranks, one tree */

export const DEFAULT_RULES = Object.freeze({ enabledForAll: true, unlockLevel: 1, pointsFromLevel: 2, pointsPerLevel: 1, playerRespec: false });

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v */
const okId = v => typeof v === "string" && NODE_ID_RE.test(v);
/** @param {unknown} v @param {number} max */
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** @param {unknown} l */
const idList = l => [...new Set((Array.isArray(l) ? l : []).filter(okId))].slice(0, MAX_TREES);

/** @returns {Picks} */
export const emptyPicks = () => ({ v: PICKS_VERSION, enabled: null, trees: { add: [], remove: [] }, ranks: {}, awards: [], log: [] });

/** Rules read leniently from settings values. @param {Record<string, unknown>} [raw] @returns {Rules} */
export function readRules(raw = {}) {
  const r = isObj(raw) ? raw : {};
  return {
    enabledForAll: typeof r.enabledForAll === "boolean" ? r.enabledForAll : DEFAULT_RULES.enabledForAll,
    unlockLevel: clampInt(r.unlockLevel, 1, MAX_LEVEL, DEFAULT_RULES.unlockLevel),
    pointsFromLevel: clampInt(r.pointsFromLevel, 1, MAX_LEVEL, DEFAULT_RULES.pointsFromLevel),
    pointsPerLevel: clampInt(r.pointsPerLevel, 0, 10, DEFAULT_RULES.pointsPerLevel),
    playerRespec: r.playerRespec === true
  };
}

/** @param {Record<string, any>} raw @returns {Picks} */
function clean(raw) {
  const p = emptyPicks();
  p.enabled = typeof raw.enabled === "boolean" ? raw.enabled : null;
  const t = isObj(raw.trees) ? raw.trees : {};
  p.trees = { add: idList(t.add), remove: idList(t.remove) };
  p.trees.add = p.trees.add.filter(id => !p.trees.remove.includes(id));
  for (const [tree, map] of Object.entries(isObj(raw.ranks) ? raw.ranks : {})) {
    if (!okId(tree) || !isObj(map) || Object.keys(p.ranks).length >= MAX_TREES) continue;
    /** @type {Ranks} */ const out = {};
    for (const [node, n] of Object.entries(map)) { const r = clampInt(n, 0, MAX_RANKS, 0); if (okId(node) && r > 0) out[node] = r; }
    if (Object.keys(out).length) p.ranks[tree] = out;
  }
  for (const a of Array.isArray(raw.awards) ? raw.awards : []) {
    if (!isObj(a)) continue;
    const n = clampInt(a.n, -9999, 9999, 0); if (!n) continue;
    p.awards.push({ id: text(a.id, 40) || `a${p.awards.length}`, n, reason: text(a.reason, REASON_MAX), at: clampInt(a.at, 0, Number.MAX_SAFE_INTEGER, 0), by: text(a.by, 40) });
  }
  p.awards = foldAwards(p.awards);
  for (const e of Array.isArray(raw.log) ? raw.log : []) {
    if (!isObj(e) || p.log.length >= LOG_MAX) continue;
    const kind = /** @type {readonly string[]} */ (LOG_KINDS).includes(e.kind) ? e.kind : "learn";
    p.log.push({ id: text(e.id, 40), at: clampInt(e.at, 0, Number.MAX_SAFE_INTEGER, 0), by: text(e.by, 40), kind, text: text(e.text, LOG_TEXT_MAX) });
  }
  return p;
}

/** Newest first, at most AWARDS_MAX: the overflow folds into one "carried" entry (kept last). @param {Award[]} list */
function foldAwards(list) {
  if (list.length <= AWARDS_MAX) return list;
  const keep = list.slice(0, AWARDS_MAX - 1);
  const rest = list.slice(AWARDS_MAX - 1);
  const n = rest.reduce((s, a) => s + a.n, 0);
  return n ? [...keep, { id: CARRIED, n, reason: "Earlier awards", at: rest[0].at, by: "" }] : keep;
}

/** The one normalizer for stored picks. @type {(raw: unknown) => Picks} */
export const normalizePicks = versioned({ version: PICKS_VERSION, empty: emptyPicks, upgrades: { 0: old => old }, clean });

/** Picks with a log entry added (newest first, capped). @param {Picks} picks @param {Omit<LogEntry, "id"> & { id?: string }} entry @returns {Picks} */
export function withLog(picks, entry) {
  const e = { id: entry.id ?? `${entry.at}-${picks.log.length}`, at: entry.at, by: entry.by, kind: entry.kind, text: text(entry.text, LOG_TEXT_MAX) };
  return { ...picks, log: addCapped(picks.log, e, { max: LOG_MAX, key: null }) };
}

/** Picks with an award added (newest first; old ones folded). @param {Picks} picks @param {Award} award @returns {Picks} */
export function withAward(picks, award) {
  const a = { ...award, n: clampInt(award.n, -AWARD_MAX, AWARD_MAX, 0), reason: text(award.reason, REASON_MAX) };
  if (!a.n) return picks;
  return { ...picks, awards: foldAwards([a, ...picks.awards]) };
}

// ---------------------------------------------------------------- points
/** Points one rank of a node costs (1 for unknown nodes, such as orphans). @param {Tree | undefined} tree @param {string} node */
const costOf = (tree, node) => tree?.nodes.find(n => n.id === node)?.cost ?? 1;

/** Points spent in one tree's ranks. @param {Tree | undefined} tree @param {Ranks | undefined} ranks */
export function spentIn(tree, ranks) {
  return Object.entries(ranks ?? {}).reduce((s, [node, r]) => s + r * costOf(tree, node), 0);
}

/**
 * The character's pool: { level, fromLevel, awards, total, spent, available, byTree }. Points from level: `pointsPerLevel` per level
 * from `pointsFromLevel` on (defaults: 1 per level from 2 → 19 at level 20). Spent counts every tree in the picks, including ones no
 * longer published (orphans, at 1 point a rank) until they are refunded. `ranks` overrides the stored ranks (a preview).
 * @param {{ level: number, picks: Picks, trees: Tree[], rules: Rules, ranks?: Picks["ranks"] }} f
 */
export function pointsFor({ level, picks, trees, rules, ranks }) {
  const lv = clampInt(level, 0, MAX_LEVEL, 0);
  const fromLevel = lv >= rules.pointsFromLevel ? (lv - rules.pointsFromLevel + 1) * rules.pointsPerLevel : 0;
  const awards = picks.awards.reduce((s, a) => s + a.n, 0);
  const byId = new Map(trees.map(t => [t.id, t]));
  /** @type {Record<string, number>} */ const byTree = {};
  for (const [tid, r] of Object.entries(ranks ?? picks.ranks)) byTree[tid] = spentIn(byId.get(tid), r);
  const spent = Object.values(byTree).reduce((a, b) => a + b, 0);
  const total = Math.max(0, fromLevel + awards);
  return { level: lv, fromLevel, awards, total, spent, available: total - spent, byTree };
}

// ---------------------------------------------------------------- which trees
/**
 * Which trees a character sees, and whether talents are open for them.
 * Enabled: the actor's own switch (`picks.enabled`), else the world's `enabledForAll`. Assigned: a tree whose `assign.classes` /
 * `assign.subclasses` holds one of the character's identifiers, plus trees the GM added by hand, minus trees the GM removed.
 * Unlocked: character level ≥ the tree's own unlock level, else the world's.
 * @param {{ trees: Tree[], picks: Picks, classes?: string[], subclasses?: string[], level: number, rules: Rules }} f
 * @returns {{ enabled: boolean, reason: string, trees: { tree: Tree, unlocked: boolean, unlockLevel: number, reason: string, manual: boolean }[], orphans: string[] }}
 */
export function treesFor({ trees, picks, classes = [], subclasses = [], level, rules }) {
  const enabled = picks.enabled ?? rules.enabledForAll;
  const cls = new Set(classes.map(s => String(s).toLowerCase())); const sub = new Set(subclasses.map(s => String(s).toLowerCase()));
  const out = [];
  for (const tree of trees) {
    if (!tree.id || picks.trees.remove.includes(tree.id)) continue;
    const auto = tree.assign.classes.some(c => cls.has(c)) || tree.assign.subclasses.some(s => sub.has(s));
    const manual = picks.trees.add.includes(tree.id);
    if (!auto && !manual) continue;
    const unlockLevel = tree.unlockLevel ?? rules.unlockLevel;
    const unlocked = level >= unlockLevel;
    out.push({ tree, unlocked, unlockLevel, manual: manual && !auto, reason: unlocked ? "" : `Talents open at level ${unlockLevel}.` });
  }
  const known = new Set(trees.map(t => t.id));
  const orphans = Object.keys(picks.ranks).filter(id => !known.has(id));
  return { enabled, reason: enabled ? "" : "Talents aren't turned on for this character.", trees: out, orphans };
}

// ---------------------------------------------------------------- node rules
/** Points spent in a tree's tiers below `tier`, and in the whole tree except one node. */
function treePoints(/** @type {Tree} */ tree, /** @type {Ranks} */ ranks, /** @type {(n: TalentNode) => boolean} */ include) {
  return tree.nodes.reduce((s, n) => s + (include(n) ? (ranks[n.id] ?? 0) * n.cost : 0), 0);
}

/** Learned nodes reachable from the hub through learned nodes (board layout). @param {Tree} tree @param {Ranks} ranks */
function reachable(tree, ranks) {
  const hub = tree.board.hub; const out = new Set();
  if (!hub || !(ranks[hub] > 0)) return out;
  out.add(hub); const queue = [hub];
  while (queue.length) for (const nb of neighbours(tree, /** @type {string} */ (queue.shift()))) if (!out.has(nb) && ranks[nb] > 0) { out.add(nb); queue.push(nb); }
  return out;
}

/**
 * Why a node can't hold ranks with these ranks (its own included), or "" when it can. Tiered: the tier opens at tier × tierSize
 * points in the tree's lower tiers. Board: the hub, or next to a learned node (`connected`). Then the node's gates (points in the
 * tree besides this node, character level), prerequisites and exclusions.
 * @param {Tree} tree @param {TalentNode} node @param {Ranks} ranks @param {number} level @param {{ connected?: boolean }} [o]
 */
export function lockReason(tree, node, ranks, level, o = {}) {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  if (tree.layout === "tiered") {
    const need = node.tier * tree.tiered.tierSize;
    const have = treePoints(tree, ranks, n => n.tier < node.tier);
    if (have < need) return `Requires ${need} points in ${tree.name} (${have}).`;
  } else if (node.id !== tree.board.hub && !o.connected) {
    return "Connect it to a talent you have learned first.";
  }
  if (node.gate.treePoints) {
    const have = treePoints(tree, ranks, n => n.id !== node.id);
    if (have < node.gate.treePoints) return `Requires ${node.gate.treePoints} points in ${tree.name} (${have}).`;
  }
  if (node.gate.level && level < node.gate.level) return `Requires character level ${node.gate.level}.`;
  for (const p of node.prereqs) {
    const r = ranks[p.node] ?? 0;
    if (r < p.ranks) return `Requires ${p.ranks} ${p.ranks === 1 ? "point" : "points"} in ${byId.get(p.node)?.name ?? p.node}.`;
  }
  for (const x of node.excludes) if ((ranks[x] ?? 0) > 0) return `Can't be learned with ${byId.get(x)?.name ?? x}.`;
  return "";
}

/** Whether a node touches a learned node on the board (for a node that has no ranks yet). */
function touchesLearned(/** @type {Tree} */ tree, /** @type {string} */ id, /** @type {Ranks} */ ranks, /** @type {Set<string>} */ reach) {
  return neighbours(tree, id).some(nb => reach.has(nb) && (ranks[nb] ?? 0) > 0);
}

/**
 * The state of one node for display and clicks, in both layouts:
 *   { state: "locked" | "available" | "partial" | "maxed", rank, max, reason, canLearn }
 * `ranks` are the tree's ranks including anything pending; `available` the points left in the pool after those.
 * "partial": has ranks but more can be learned (or its rule broke later; `reason` says why). `reason` is plain text.
 * @param {Tree} tree @param {TalentNode} node @param {{ ranks: Ranks, level: number, available: number }} f
 */
export function nodeState(tree, node, { ranks, level, available }) {
  const rank = ranks[node.id] ?? 0; const max = node.maxRanks;
  if (rank >= max) return { state: /** @type {const} */ ("maxed"), rank, max, reason: "", canLearn: false };
  const reach = tree.layout === "board" ? reachable(tree, ranks) : new Set();
  const connected = tree.layout === "board" && (reach.has(node.id) || touchesLearned(tree, node.id, ranks, reach));
  // A node with ranks is judged on the ranks as they are; one without is judged as if it had its first rank.
  const reason = lockReason(tree, node, ranks, level, { connected });
  if (reason) return { state: rank > 0 ? /** @type {const} */ ("partial") : /** @type {const} */ ("locked"), rank, max, reason, canLearn: false };
  if (available < node.cost) return { state: rank > 0 ? /** @type {const} */ ("partial") : /** @type {const} */ ("available"), rank, max, reason: "No points left to spend.", canLearn: false };
  return { state: rank > 0 ? /** @type {const} */ ("partial") : /** @type {const} */ ("available"), rank, max, reason: "", canLearn: true };
}

/**
 * Every rule a tree's ranks break: [{ node, text }] (empty = valid). Each learned node must pass `lockReason` with the ranks as
 * they are; on a board it must be reachable from the hub through learned nodes; ranks never exceed the node's maximum; ranks on
 * nodes the tree doesn't have are reported too.
 * @param {Tree} tree @param {Ranks} ranks @param {number} level
 */
export function rankProblems(tree, ranks, level) {
  /** @type {{ node: string, text: string }[]} */ const out = [];
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const reach = tree.layout === "board" ? reachable(tree, ranks) : new Set();
  for (const [id, r] of Object.entries(ranks)) {
    if (!(r > 0)) continue;
    const node = byId.get(id);
    if (!node) { out.push({ node: id, text: `${id} isn't in ${tree.name} any more.` }); continue; }
    if (r > node.maxRanks) { out.push({ node: id, text: `${node.name} has ${r} ranks; it holds ${node.maxRanks}.` }); continue; }
    const why = lockReason(tree, node, ranks, level, { connected: reach.has(id) });
    if (why) out.push({ node: id, text: `${node.name}: ${why}` });
  }
  return out;
}

/**
 * Checks a Learn: the new ranks per tree against the stored ones. Learning only adds ranks (refunds are their own request); every
 * changed tree must be one the character sees and has unlocked; the result must break no rule and fit the pool.
 * @param {{ trees: Tree[], picks: Picks, pending: Picks["ranks"], level: number, rules: Rules, classes?: string[], subclasses?: string[] }} f
 * @returns {{ ok: boolean, errors: string[], changes: { tree: string, node: string, from: number, to: number }[], cost: number, ranks: Picks["ranks"] }}
 */
export function validatePending({ trees, picks, pending, level, rules, classes = [], subclasses = [] }) {
  /** @type {string[]} */ const errors = [];
  /** @type {{ tree: string, node: string, from: number, to: number }[]} */ const changes = [];
  const seen = treesFor({ trees, picks, classes, subclasses, level, rules });
  if (!seen.enabled) errors.push(seen.reason);
  const visible = new Map(seen.trees.map(t => [t.tree.id, t]));
  /** @type {Picks["ranks"]} */ const ranks = structuredClone(picks.ranks);
  let cost = 0;
  for (const [tid, map] of Object.entries(isObj(pending) ? pending : {})) {
    const vt = visible.get(tid);
    const before = picks.ranks[tid] ?? {};
    const next = { ...before };
    let changed = false;
    for (const [node, raw] of Object.entries(isObj(map) ? map : {})) {
      const to = clampInt(raw, 0, MAX_RANKS, 0); const from = before[node] ?? 0;
      if (to === from) continue;
      if (to < from) { errors.push("Learning can't remove ranks (use a refund)."); continue; }
      changed = true; next[node] = to; changes.push({ tree: tid, node, from, to });
    }
    if (!changed) continue;
    if (!vt) { errors.push(`${tid} isn't one of this character's trees.`); continue; }
    if (!vt.unlocked) { errors.push(vt.reason); continue; }
    for (const p of rankProblems(vt.tree, next, level)) errors.push(p.text);
    cost += spentIn(vt.tree, next) - spentIn(vt.tree, before);
    ranks[tid] = next;
  }
  if (!changes.length) errors.push("Nothing to learn.");
  const pts = pointsFor({ level, picks, trees, rules, ranks });
  if (pts.available < 0) errors.push(`That costs ${cost} ${cost === 1 ? "point" : "points"}; only ${pts.available + cost} left.`);
  return { ok: !errors.length, errors: [...new Set(errors)], changes, cost, ranks };
}

/**
 * The ranks after refunding one rank of a node (or all of it with `all`), or the whole tree (no `node`), with every dependant that
 * then breaks a rule removed as well (repeated until nothing breaks). Returns { ranks, removed: [{ node, from, to }], refund }.
 * @param {Tree} tree @param {Ranks} ranks @param {{ node?: string, all?: boolean, level: number }} o
 */
export function refundPlan(tree, ranks, { node, all = false, level }) {
  /** @type {Ranks} */ const next = { ...ranks };
  if (node === undefined) { for (const k of Object.keys(next)) delete next[k]; }
  else if ((next[node] ?? 0) > 0) { next[node] = all ? 0 : next[node] - 1; if (!next[node]) delete next[node]; }
  for (let i = 0; i < 500; i++) {
    // Anything that now breaks a rule goes too (dependants, higher tiers, ranks on nodes the tree no longer has).
    const drop = [...new Set(rankProblems(tree, next, level).map(p => p.node))].filter(id => next[id] > 0);
    if (!drop.length) break;
    for (const id of drop) delete next[id];
  }
  /** @type {{ node: string, from: number, to: number }[]} */ const removed = [];
  for (const [id, r] of Object.entries(ranks)) { const to = next[id] ?? 0; if (to !== r) removed.push({ node: id, from: r, to }); }
  return { ranks: next, removed, refund: spentIn(tree, ranks) - spentIn(tree, next) };
}
