/**
 * Talent trees, pure (tested in Node: tests/tree-model.test.mjs). No Foundry calls at import or call time.
 *
 * A tree is GM content stored in the world's tree compendium (one JournalEntry per tree, `flags.wanderers-path.tree`). It is read
 * through one normalizer, `normalizeTree`, which never throws: bad fields get defaults, ranks are clamped to 1–5, references to
 * nodes that don't exist are dropped and exclusions are mirrored both ways. `treeIssues` lists what the GM should fix.
 *
 * Tree (TREE_VERSION 1):
 *   { v, id, name, img, layout: "tiered" | "board", assign: { classes, subclasses }, unlockLevel: number | null,
 *     tiered: { columns, tierSize, tiers }, board: { hub, edges: [[a, b]] }, nodes: Node[] }
 * Node:
 *   { id, name, img, text, tier, col, x, y, maxRanks 1–5, cost 1–5, keystone, prereqs: [{ node, ranks }],
 *     gate: { treePoints?, level? }, excludes: [id], grant: Grant, automation: { kind: "external", key, data } | null }
 * Grant (used by the grant engine, slice 4):
 *   { mode: "item" | "effect" | "none", perRank: "scale" | "replace", ranks: ({ uuid } | { built })[] }
 */
import { versioned } from "../vendor/wanderers-core/index.mjs";

export const TREE_VERSION = 1;
export const LAYOUTS = /** @type {const} */ (["tiered", "board"]);
export const MAX_RANKS = 5;
export const MAX_COST = 5;
export const MAX_NODES = 200;
export const MAX_EDGES = 600;
export const MAX_ASSIGN = 50;
export const MAX_LEVEL = 30;
export const NAME_MAX = 120;
export const TEXT_MAX = 4000;
export const IMG_MAX = 500;
/** Node and tree ids: letters, digits, "_" and "-", 1 to 64. */
export const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** A dnd5e identifier (class or subclass): lower-case slug. */
export const IDENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID_RE = /^[A-Za-z0-9_.-]{3,300}$/;

/** @typedef {{ node: string, ranks: number }} Prereq */
/** @typedef {{ treePoints?: number, level?: number }} Gate */
/** @typedef {{ uuid: string } | { built: Record<string, any> }} GrantRank */
/** @typedef {{ mode: "item" | "effect" | "none", perRank: "scale" | "replace", ranks: GrantRank[] }} Grant */
/**
 * @typedef {object} TalentNode
 * @property {string} id @property {string} name @property {string} img @property {string} text
 * @property {number} tier @property {number} col @property {number} x @property {number} y
 * @property {number} maxRanks @property {number} cost @property {boolean} keystone
 * @property {Prereq[]} prereqs @property {Gate} gate @property {string[]} excludes @property {Grant} grant
 * @property {{ kind: "external", key: string, data: Record<string, any> } | null} automation
 */
/**
 * @typedef {object} Tree
 * @property {number} v @property {string} id @property {string} name @property {string} img
 * @property {"tiered" | "board"} layout @property {{ classes: string[], subclasses: string[] }} assign
 * @property {number | null} unlockLevel
 * @property {{ columns: number, tierSize: number, tiers: number }} tiered
 * @property {{ hub: string, edges: [string, string][] }} board
 * @property {TalentNode[]} nodes
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v @param {number} max */
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** An integer in [min, max], or `dflt` when unreadable. @param {unknown} v @param {number} min @param {number} max @param {number} dflt */
export function clampInt(v, min, max, dflt) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}
/** @param {unknown} v */
const nodeId = v => (typeof v === "string" && NODE_ID_RE.test(v.trim()) ? v.trim() : "");
/** @param {unknown} list */
const idents = list => [...new Set((Array.isArray(list) ? list : []).map(s => (typeof s === "string" ? s.trim().toLowerCase() : "")).filter(s => IDENT_RE.test(s)))].slice(0, MAX_ASSIGN);

/** A fresh, empty tree (no id: unusable until it has one). @returns {Tree} */
export function emptyTree() {
  return { v: TREE_VERSION, id: "", name: "", img: "", layout: "tiered", assign: { classes: [], subclasses: [] }, unlockLevel: null,
    tiered: { columns: 3, tierSize: 5, tiers: 6 }, board: { hub: "", edges: [] }, nodes: [] };
}

/** A grant read leniently. @param {unknown} raw @returns {Grant} */
export function normalizeGrant(raw) {
  const g = isObj(raw) ? raw : {};
  const mode = g.mode === "item" || g.mode === "effect" ? g.mode : "none";
  const perRank = g.perRank === "replace" ? "replace" : "scale";
  /** @type {GrantRank[]} */
  const ranks = [];
  for (const r of Array.isArray(g.ranks) ? g.ranks : []) {
    if (ranks.length >= MAX_RANKS) break;
    if (isObj(r) && typeof r.uuid === "string" && UUID_RE.test(r.uuid.trim()) && r.uuid.includes(".")) ranks.push({ uuid: r.uuid.trim() });
    else if (isObj(r) && isObj(r.built)) ranks.push({ built: structuredClone(r.built) });
  }
  return { mode, perRank, ranks };
}

/** One node read leniently (references are fixed by normalizeTree). @param {unknown} raw @returns {TalentNode | null} */
function readNode(raw) {
  if (!isObj(raw)) return null;
  const id = nodeId(raw.id); if (!id) return null;
  const gate = isObj(raw.gate) ? raw.gate : {};
  /** @type {Gate} */
  const g = {};
  const tp = clampInt(gate.treePoints, 0, 999, 0); if (tp > 0) g.treePoints = tp;
  const lv = clampInt(gate.level, 0, MAX_LEVEL, 0); if (lv > 0) g.level = lv;
  const a = isObj(raw.automation) && raw.automation.kind === "external" && typeof raw.automation.key === "string" && raw.automation.key.trim()
    ? { kind: /** @type {const} */ ("external"), key: raw.automation.key.trim().slice(0, 100), data: isObj(raw.automation.data) ? structuredClone(raw.automation.data) : {} } : null;
  return {
    id, name: text(raw.name, NAME_MAX) || id, img: text(raw.img, IMG_MAX), text: text(raw.text, TEXT_MAX),
    tier: clampInt(raw.tier, 0, 99, 0), col: clampInt(raw.col, 0, 99, 0), x: clampInt(raw.x, 0, 10000, 0), y: clampInt(raw.y, 0, 10000, 0),
    maxRanks: clampInt(raw.maxRanks, 1, MAX_RANKS, 1), cost: clampInt(raw.cost, 1, MAX_COST, 1), keystone: raw.keystone === true,
    prereqs: Array.isArray(raw.prereqs) ? raw.prereqs.map(p => (isObj(p) ? { node: nodeId(p.node), ranks: clampInt(p.ranks, 1, MAX_RANKS, 0) } : typeof p === "string" ? { node: nodeId(p), ranks: 0 } : null)).filter(/** @returns {p is Prereq} */ p => !!p && !!p.node) : [],
    gate: g, excludes: Array.isArray(raw.excludes) ? raw.excludes.map(nodeId).filter(Boolean) : [],
    grant: normalizeGrant(raw.grant), automation: a
  };
}

/**
 * Fixes the references once every node is known: prereqs and exclusions to unknown nodes or to the node itself are dropped,
 * prereq ranks clamped to the required node's max ranks (0 = "all its ranks"), exclusions mirrored, positions clamped to the grid.
 * @param {Tree} t
 */
function fixRefs(t) {
  const byId = new Map(t.nodes.map(n => [n.id, n]));
  const cols = t.tiered.columns;
  for (const n of t.nodes) {
    n.col = Math.min(n.col, cols - 1);
    const seen = new Set();
    n.prereqs = n.prereqs.filter(p => p.node !== n.id && byId.has(p.node) && !seen.has(p.node) && seen.add(p.node))
      .map(p => { const m = /** @type {TalentNode} */ (byId.get(p.node)).maxRanks; return { node: p.node, ranks: p.ranks ? Math.min(p.ranks, m) : m }; });
    n.excludes = [...new Set(n.excludes.filter(x => x !== n.id && byId.has(x)))];
  }
  for (const n of t.nodes) for (const x of n.excludes) { const o = /** @type {TalentNode} */ (byId.get(x)); if (!o.excludes.includes(n.id)) o.excludes.push(n.id); }
  const maxTier = t.nodes.reduce((m, n) => Math.max(m, n.tier), 0);
  t.tiered.tiers = Math.max(t.tiered.tiers, maxTier + 1);
  // Board: edges between two different known nodes, once each (unordered); the hub must be a node (else the first node).
  const edges = new Set(); /** @type {[string, string][]} */ const out = [];
  for (const e of t.board.edges) {
    if (!Array.isArray(e)) continue;
    const a = nodeId(e[0]), b = nodeId(e[1]);
    if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (edges.has(k)) continue;
    edges.add(k); out.push([a, b]); if (out.length >= MAX_EDGES) break;
  }
  t.board.edges = out;
  if (!byId.has(t.board.hub)) t.board.hub = t.layout === "board" ? (t.nodes[0]?.id ?? "") : "";
}

/** @param {Record<string, any>} raw @returns {Tree} */
function clean(raw) {
  const t = emptyTree();
  t.id = nodeId(raw.id);
  t.name = text(raw.name, NAME_MAX) || t.id;
  t.img = text(raw.img, IMG_MAX);
  t.layout = raw.layout === "board" ? "board" : "tiered";
  const as = isObj(raw.assign) ? raw.assign : {};
  t.assign = { classes: idents(as.classes), subclasses: idents(as.subclasses) };
  const ul = clampInt(raw.unlockLevel, 0, MAX_LEVEL, 0); t.unlockLevel = ul > 0 ? ul : null;
  const ti = isObj(raw.tiered) ? raw.tiered : {};
  // No explicit `tiers`: as many rows as the nodes use (fixRefs raises it to the highest tier + 1). Explicit tiers are kept as given.
  t.tiered = { columns: clampInt(ti.columns, 1, 7, 3), tierSize: clampInt(ti.tierSize, 1, 50, 5), tiers: clampInt(ti.tiers, 1, 20, 1) };
  const bo = isObj(raw.board) ? raw.board : {};
  t.board = { hub: nodeId(bo.hub), edges: Array.isArray(bo.edges) ? bo.edges.slice(0, MAX_EDGES * 2) : [] };
  const seen = new Set();
  for (const r of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (t.nodes.length >= MAX_NODES) break;
    const n = readNode(r); if (!n || seen.has(n.id)) continue;
    seen.add(n.id); t.nodes.push(n);
  }
  for (const n of t.nodes) n.tier = Math.min(n.tier, 19);
  fixRefs(t);
  return t;
}

/**
 * The one normalizer for a stored tree. Never throws; an unreadable value gives an empty tree (id ""), which the loader skips.
 * @type {(raw: unknown) => Tree}
 */
export const normalizeTree = versioned({ version: TREE_VERSION, empty: emptyTree, upgrades: { 0: old => old }, clean });

/** The node with that id, or null. @param {Tree} tree @param {string} id */
export const nodeOf = (tree, id) => tree.nodes.find(n => n.id === id) ?? null;

/** Board neighbours of a node. @param {Tree} tree @param {string} id @returns {string[]} */
export function neighbours(tree, id) {
  const out = [];
  for (const [a, b] of tree.board.edges) { if (a === id) out.push(b); else if (b === id) out.push(a); }
  return out;
}

/** Every UUID a tree's grants point to. @param {Tree} tree @returns {{ node: string, uuid: string }[]} */
export function grantUuids(tree) {
  return tree.nodes.flatMap(n => n.grant.ranks.flatMap(r => ("uuid" in r ? [{ node: n.id, uuid: r.uuid }] : [])));
}

/**
 * Prerequisite cycles: lists of node ids that require each other (each cycle once).
 * @param {Tree} tree @returns {string[][]}
 */
export function prereqCycles(tree) {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  /** @type {Map<string, number>} 0 new, 1 on stack, 2 done */
  const state = new Map(); /** @type {string[]} */ const stack = []; /** @type {string[][]} */ const out = [];
  const seenCycle = new Set();
  const visit = (/** @type {string} */ id) => {
    state.set(id, 1); stack.push(id);
    for (const p of byId.get(id)?.prereqs ?? []) {
      const s = state.get(p.node) ?? 0;
      if (s === 1) {
        const cyc = stack.slice(stack.indexOf(p.node));
        const key = [...cyc].sort().join("|");
        if (!seenCycle.has(key)) { seenCycle.add(key); out.push(cyc); }
      } else if (s === 0) visit(p.node);
    }
    stack.pop(); state.set(id, 2);
  };
  for (const n of tree.nodes) if (!state.get(n.id)) visit(n.id);
  return out;
}

/**
 * What the GM should fix in a tree: [{ level: "bad" | "warn", node?, text }]. Plain text. `has(uuid)` tells whether a granted
 * document exists (true / false; undefined = unknown, not reported). Never throws.
 * @param {Tree} tree
 * @param {{ has?: (uuid: string) => boolean | undefined }} [opts]
 * @returns {{ level: "bad" | "warn", node?: string, text: string }[]}
 */
export function treeIssues(tree, { has } = {}) {
  /** @type {{ level: "bad" | "warn", node?: string, text: string }[]} */
  const out = [];
  try {
    const name = tree.name || tree.id || "A tree";
    if (!tree.id) out.push({ level: "bad", text: `${name} has no id, so it can't be used.` });
    if (!tree.nodes.length) out.push({ level: "warn", text: `${name} has no talents yet.` });
    const byId = new Map(tree.nodes.map(n => [n.id, n]));
    for (const cyc of prereqCycles(tree)) out.push({ level: "bad", node: cyc[0], text: `${name}: ${cyc.map(id => byId.get(id)?.name ?? id).join(" → ")} require each other, so none of them can be learned.` });
    const totalRanks = tree.nodes.reduce((s, n) => s + n.maxRanks * n.cost, 0);
    for (const n of tree.nodes) {
      const label = `${name} › ${n.name}`;
      if (n.gate.treePoints && n.gate.treePoints > totalRanks - n.maxRanks * n.cost) out.push({ level: "bad", node: n.id, text: `${label} needs ${n.gate.treePoints} points in the tree, more than the rest of the tree can hold.` });
      if (n.gate.level && n.gate.level > 20) out.push({ level: "warn", node: n.id, text: `${label} needs character level ${n.gate.level}, above the usual level 20.` });
      for (const x of n.excludes) if (n.prereqs.some(p => p.node === x)) out.push({ level: "bad", node: n.id, text: `${label} requires ${byId.get(x)?.name ?? x} but also can't be learned with it.` });
      if (tree.layout === "tiered") {
        const need = n.tier * tree.tiered.tierSize;
        const below = tree.nodes.filter(o => o.tier < n.tier).reduce((s, o) => s + o.maxRanks * o.cost, 0);
        if (need > below) out.push({ level: "bad", node: n.id, text: `${label} is in a tier that opens at ${need} points, but the tiers below hold only ${below}.` });
        for (const p of n.prereqs) { const o = byId.get(p.node); if (o && o.tier >= n.tier) out.push({ level: "warn", node: n.id, text: `${label} requires ${o.name}, which isn't in a lower tier.` }); }
        const clash = tree.nodes.find(o => o !== n && o.tier === n.tier && o.col === n.col);
        if (clash && tree.nodes.indexOf(clash) > tree.nodes.indexOf(n)) out.push({ level: "warn", node: clash.id, text: `${label} and ${clash.name} share a spot in the grid.` });
      }
      if (n.grant.mode !== "none" && !n.grant.ranks.length) out.push({ level: "warn", node: n.id, text: `${label} grants nothing yet.` });
    }
    if (tree.layout === "board") {
      if (!tree.board.hub) out.push({ level: "bad", text: `${name} has no starting hub.` });
      else {
        const reach = new Set([tree.board.hub]); const queue = [tree.board.hub];
        while (queue.length) for (const nb of neighbours(tree, /** @type {string} */ (queue.shift()))) if (!reach.has(nb)) { reach.add(nb); queue.push(nb); }
        for (const n of tree.nodes) if (!reach.has(n.id)) out.push({ level: "warn", node: n.id, text: `${name} › ${n.name} isn't connected to the hub.` });
      }
    }
    if (typeof has === "function") {
      for (const { node, uuid } of grantUuids(tree)) {
        let ok; try { ok = has(uuid); } catch { ok = undefined; }
        if (ok === false) out.push({ level: "bad", node, text: `${name} › ${byId.get(node)?.name ?? node} grants a document that no longer exists (${uuid}).` });
      }
    }
  } catch (e) {
    out.push({ level: "warn", text: `Couldn't check ${tree?.name || "a tree"}: ${String(/** @type {any} */ (e)?.message ?? e)}` });
  }
  return out;
}
