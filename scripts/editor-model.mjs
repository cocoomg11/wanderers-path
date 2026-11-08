/**
 * The GM tree editor's rules, pure (tested in Node: tests/v060.test.mjs). No Foundry calls at import or call time.
 *
 * Every edit takes a normalized tree and returns `{ ok: true, tree }` (a new, normalized tree; the input is never changed) or
 * `{ ok: false, error }` (plain text for a notice). The editor window (editor.mjs) keeps the working copy, an undo history
 * (`pushHistory` / `undoHistory`, HISTORY_MAX steps) and the selection; drafts live in the GM-only store (draft-model.mjs).
 *
 * Publishing is gated by `publishPlan`: the tree's issues (`treeIssues`) plus its built slots' problems; any "bad" one blocks.
 * `treePageHTML` is the readable page written next to the tree's data in the compendium.
 */
import { esc, slug } from "../vendor/wanderers-core/index.mjs";
import { normalizeTree, emptyTree, treeIssues, isEffectUuid, MAX_NODES, MAX_RANKS, MAX_COST, MAX_LEVEL, NAME_MAX, TEXT_MAX, IMG_MAX, IDENT_RE } from "./tree-model.mjs";
import { specIssues, templateOf, previewLine } from "./builder-model.mjs";
import { draftState, treeHash } from "./draft-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {import("./tree-model.mjs").TalentNode} TalentNode */
/** @typedef {{ ok: true, tree: Tree } | { ok: false, error: string }} EditResult */
/**
 * A document dropped onto the editor: what drag data and its index entry give.
 * @typedef {{ uuid: string, documentName: "Item" | "ActiveEffect", name?: string, img?: string, type?: string }} DroppedDoc
 */

/** Undo steps kept. */
export const HISTORY_MAX = 20;
export const MAX_COLUMNS = 7;
export const MAX_TIERS = 20;
export const MAX_TIER_SIZE = 50;
/** UUIDs the editor accepts for a rank slot: an Item, or an Active Effect on an actor, an item or the world (compendium or not). */
export const DOC_UUID_RE = /^(Compendium\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)?(Item\.[A-Za-z0-9]{16}(\.ActiveEffect\.[A-Za-z0-9]{16})?|Actor\.[A-Za-z0-9]{16}(\.Item\.[A-Za-z0-9]{16})?\.ActiveEffect\.[A-Za-z0-9]{16}|ActiveEffect\.[A-Za-z0-9]{16})$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {Tree} t @returns {Tree} */
const copy = t => structuredClone(t);
/** @param {Tree} t @returns {EditResult} */
const done = t => ({ ok: true, tree: normalizeTree(t) });
/** @param {string} error @returns {EditResult} */
const fail = error => ({ ok: false, error });
/** @param {unknown} v @param {number} min @param {number} max @returns {number | null} */
const int = (v, min, max) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
};

// ---------------------------------------------------------------- ids
/**
 * An id made from a name: a slug (letters, digits, "-"), unique among `taken` ("-2", "-3", … when needed); `fallback` when the
 * name has no letters or digits.
 * @param {string} name @param {Iterable<string>} taken @param {string} [fallback]
 */
export function uniqueId(name, taken, fallback = "talent") {
  const used = new Set(taken);
  const base = (slug(name) || fallback).slice(0, 56);
  if (!used.has(base)) return base;
  for (let i = 2; i < 10000; i++) { const id = `${base}-${i}`; if (!used.has(id)) return id; }
  return `${base}-${Date.now().toString(36)}`.slice(0, 64);
}

// ---------------------------------------------------------------- trees
/**
 * A new, empty tiered tree named `name`, its id unique among `taken` (published trees and drafts).
 * @param {unknown} name @param {Iterable<string>} taken @returns {EditResult}
 */
export function newTree(name, taken) {
  const n = typeof name === "string" ? name.trim().slice(0, NAME_MAX) : "";
  if (!n) return fail("Give the tree a name.");
  const t = emptyTree();
  t.id = uniqueId(n, taken, "tree"); t.name = n; t.tiered = { columns: 3, tierSize: 5, tiers: 3 };
  return done(t);
}

/** A copy of `tree` under a new id and "(copy)" name, not published. @param {Tree} tree @param {Iterable<string>} taken @returns {EditResult} */
export function duplicateTree(tree, taken) {
  const t = copy(tree);
  t.name = `${tree.name} (copy)`.slice(0, NAME_MAX);
  t.id = uniqueId(t.name, taken, "tree");
  return done(t);
}

/**
 * The tree's own fields from the Tree settings form (strings or values). Unknown fields are ignored; bad numbers keep the old value.
 * `classes` / `subclasses` are lists of dnd5e identifiers (bad ones dropped).
 * @param {Tree} tree @param {Record<string, any>} f @returns {EditResult}
 */
export function setTreeFields(tree, f) {
  const t = copy(tree);
  if (typeof f.name === "string") { const n = f.name.trim().slice(0, NAME_MAX); if (!n) return fail("A tree needs a name."); t.name = n; }
  if (typeof f.img === "string") t.img = f.img.trim().slice(0, IMG_MAX);
  if (f.layout === "tiered" || f.layout === "board") t.layout = f.layout;
  if ("enabled" in f) t.enabled = f.enabled === true || f.enabled === "true" || f.enabled === "on";
  if ("unlockLevel" in f) { const v = int(f.unlockLevel, 0, MAX_LEVEL); t.unlockLevel = v ? v : null; }
  if ("columns" in f) {
    const v = int(f.columns, 1, MAX_COLUMNS);
    if (v !== null) {
      const far = t.nodes.find(n => n.col >= v);
      if (far) return fail(`${far.name} sits in column ${far.col + 1}: move it before removing that column.`);
      t.tiered.columns = v;
    }
  }
  if ("tierSize" in f) { const v = int(f.tierSize, 1, MAX_TIER_SIZE); if (v !== null) t.tiered.tierSize = v; }
  if ("tiers" in f) {
    const v = int(f.tiers, 1, MAX_TIERS);
    if (v !== null) {
      const low = t.nodes.find(n => n.tier >= v);
      if (low) return fail(`${low.name} sits in tier ${low.tier + 1}: move it before removing that tier.`);
      t.tiered.tiers = v;
    }
  }
  for (const k of /** @type {const} */ (["classes", "subclasses"])) {
    if (!(k in f)) continue;
    const list = Array.isArray(f[k]) ? f[k] : [];
    t.assign[k] = [...new Set(list.map(s => String(s).trim().toLowerCase()).filter(s => IDENT_RE.test(s)))];
  }
  return done(t);
}

/** Adds an identifier to the assignment. @param {Tree} tree @param {"classes" | "subclasses"} kind @param {unknown} ident @returns {EditResult} */
export function addAssign(tree, kind, ident) {
  const id = String(ident ?? "").trim().toLowerCase();
  if (!IDENT_RE.test(id)) return fail("An identifier is lower-case letters, digits, \"-\" and \"_\" (the class item's Identifier, e.g. fighter).");
  if (tree.assign[kind].includes(id)) return { ok: true, tree: normalizeTree(tree) };
  return setTreeFields(tree, { [kind]: [...tree.assign[kind], id] });
}
/** @param {Tree} tree @param {"classes" | "subclasses"} kind @param {string} ident @returns {EditResult} */
export const removeAssign = (tree, kind, ident) => setTreeFields(tree, { [kind]: tree.assign[kind].filter(x => x !== ident) });

/** One more tier at the bottom. @param {Tree} tree @returns {EditResult} */
export function addTier(tree) {
  if (tree.tiered.tiers >= MAX_TIERS) return fail(`A tree has at most ${MAX_TIERS} tiers.`);
  return setTreeFields(tree, { tiers: tree.tiered.tiers + 1 });
}
/** The last tier removed (only when empty). @param {Tree} tree @returns {EditResult} */
export function removeTier(tree) {
  if (tree.tiered.tiers <= 1) return fail("A tree keeps at least one tier.");
  return setTreeFields(tree, { tiers: tree.tiered.tiers - 1 });
}

// ---------------------------------------------------------------- the grid
/** The node at a grid spot, or null. @param {Tree} tree @param {number} tier @param {number} col */
export const nodeAt = (tree, tier, col) => tree.nodes.find(n => n.tier === tier && n.col === col) ?? null;

/** Whether a spot is inside the grid. @param {Tree} tree @param {number} tier @param {number} col */
export const inGrid = (tree, tier, col) => Number.isInteger(tier) && Number.isInteger(col) && tier >= 0 && col >= 0 && tier < tree.tiered.tiers && col < tree.tiered.columns;

/** Reads "tier:col" (from a slot's data attribute). @param {unknown} s @returns {{ tier: number, col: number } | null} */
export function readCell(s) {
  const m = typeof s === "string" ? /^(\d{1,2}):(\d{1,2})$/.exec(s) : null;
  return m ? { tier: Number(m[1]), col: Number(m[2]) } : null;
}

/**
 * What a dropped document becomes in a node: an Item → grant mode "item", an Active Effect → "effect"; the node is named after
 * it. Null when it can't be used. @param {unknown} raw @returns {DroppedDoc | null}
 */
export function readDropped(raw) {
  if (!isObj(raw)) return null;
  const uuid = typeof raw.uuid === "string" ? raw.uuid.trim() : "";
  if (!DOC_UUID_RE.test(uuid)) return null;
  const documentName = raw.documentName === "ActiveEffect" || /\.?ActiveEffect\.[A-Za-z0-9]{16}$/.test(uuid) ? "ActiveEffect" : "Item";
  return { uuid, documentName, name: typeof raw.name === "string" ? raw.name.slice(0, NAME_MAX) : "", img: typeof raw.img === "string" ? raw.img.slice(0, IMG_MAX) : "", type: typeof raw.type === "string" ? raw.type : "" };
}

/**
 * A new talent on an empty spot: blank (`doc` null: grants nothing yet) or made from a dropped document (named after it, its image,
 * rank slot 1 = its UUID).
 * @param {Tree} tree @param {{ tier: number, col: number }} at @param {DroppedDoc | null} [doc] @returns {EditResult & { id?: string }}
 */
export function placeNode(tree, at, doc = null) {
  if (!inGrid(tree, at.tier, at.col)) return fail("That spot isn't in the grid.");
  if (nodeAt(tree, at.tier, at.col)) return fail("That spot is taken: drop on an empty one.");
  if (tree.nodes.length >= MAX_NODES) return fail(`A tree holds at most ${MAX_NODES} talents.`);
  const t = copy(tree);
  const name = (doc?.name || "New talent").trim().slice(0, NAME_MAX);
  const id = uniqueId(name, t.nodes.map(n => n.id));
  /** @type {any} */ const node = { id, name, img: doc?.img ?? "", text: "", tier: at.tier, col: at.col, maxRanks: 1, cost: 1, keystone: false, prereqs: [], gate: {}, excludes: [],
    grant: doc ? { mode: doc.documentName === "ActiveEffect" ? "effect" : "item", perRank: "scale", ranks: [{ uuid: doc.uuid }] } : { mode: "none", perRank: "scale", ranks: [] }, automation: null };
  t.nodes.push(node);
  return { ...done(t), id };
}

/**
 * Moves a talent to another spot; a taken spot swaps the two.
 * @param {Tree} tree @param {string} id @param {{ tier: number, col: number }} at @returns {EditResult}
 */
export function moveNode(tree, id, at) {
  if (!inGrid(tree, at.tier, at.col)) return fail("That spot isn't in the grid.");
  const t = copy(tree);
  const n = t.nodes.find(x => x.id === id); if (!n) return fail("That talent isn't in the tree.");
  if (n.tier === at.tier && n.col === at.col) return done(t);
  const other = t.nodes.find(x => x !== n && x.tier === at.tier && x.col === at.col);
  if (other) { other.tier = n.tier; other.col = n.col; }
  n.tier = at.tier; n.col = at.col;
  return done(t);
}

/**
 * A talent's own fields from the inspector (strings or values): name, img, text, maxRanks, cost, keystone, mode, perRank,
 * gateTreePoints, gateLevel, tier, col (a taken spot swaps). Ranks lowered below a prerequisite's need lower that need.
 * @param {Tree} tree @param {string} id @param {Record<string, any>} f @returns {EditResult}
 */
export function updateNode(tree, id, f) {
  let t = copy(tree);
  const n = t.nodes.find(x => x.id === id); if (!n) return fail("That talent isn't in the tree.");
  if (typeof f.name === "string") { const v = f.name.trim().slice(0, NAME_MAX); if (!v) return fail("A talent needs a name."); n.name = v; }
  if (typeof f.img === "string") n.img = f.img.trim().slice(0, IMG_MAX);
  if (typeof f.text === "string") n.text = f.text.trim().slice(0, TEXT_MAX);
  if ("maxRanks" in f) { const v = int(f.maxRanks, 1, MAX_RANKS); if (v !== null) { n.maxRanks = v; if (n.grant.perRank === "replace") n.grant.ranks = n.grant.ranks.slice(0, v); } }
  if ("cost" in f) { const v = int(f.cost, 1, MAX_COST); if (v !== null) n.cost = v; }
  if ("keystone" in f) n.keystone = f.keystone === true || f.keystone === "true" || f.keystone === "on";
  if (f.mode === "item" || f.mode === "effect" || f.mode === "none") n.grant.mode = f.mode;
  if (f.perRank === "scale" || f.perRank === "replace") {
    if (f.perRank === "scale" && n.grant.perRank === "replace") n.grant.ranks = n.grant.ranks.slice(0, 1);
    n.grant.perRank = f.perRank;
  }
  if ("gateTreePoints" in f) { const v = int(f.gateTreePoints, 0, 999); if (v) n.gate.treePoints = v; else delete n.gate.treePoints; }
  if ("gateLevel" in f) { const v = int(f.gateLevel, 0, MAX_LEVEL); if (v) n.gate.level = v; else delete n.gate.level; }
  // Prerequisites on this talent that need more ranks than it now has: their need drops to its max (normalizeTree does that).
  for (const o of t.nodes) for (const p of o.prereqs) if (p.node === n.id && p.ranks > n.maxRanks) p.ranks = n.maxRanks;
  if ("tier" in f || "col" in f) {
    const tier = "tier" in f ? int(f.tier, 1, MAX_TIERS) : n.tier + 1; const col = "col" in f ? int(f.col, 1, MAX_COLUMNS) : n.col + 1;
    if (tier !== null && col !== null && (tier - 1 !== n.tier || col - 1 !== n.col)) {
      const r = moveNode(normalizeTree(t), n.id, { tier: tier - 1, col: col - 1 });
      if (!r.ok) return r;
      t = r.tree;
    }
  }
  return done(t);
}

/**
 * Whether a dropped UUID belongs to an actor (a character's item or effect, or a token's): the editor refuses those, since a grant
 * would then depend on that one actor. Sidebar items and compendium documents are fine. Pure. @param {unknown} uuid
 */
export const ownedSource = uuid => /^(Actor\.|Scene\.|Compendium\.[^.]+\.[^.]+\.Actor\.)/.test(String(uuid ?? ""));

/**
 * Whether Publish would replace a published tree that changed after the work began: the draft's own `stale` (its base differs),
 * else, with no draft, the hash taken when the published tree was opened (`base`). Pure.
 * @param {{ draft: import("./draft-model.mjs").Draft | null, published: Tree | null, base?: string | null }} o
 */
export function publishStale({ draft, published, base = null }) {
  if (!published) return false;
  if (draft) return draftState(draft, published).stale;
  return !!base && base !== treeHash(published);
}

/**
 * A rank slot (1-based) set to a document (`{ uuid }`), a built spec (`{ built }`), or emptied (null: later slots move up).
 * "scale" talents use slot 1; "replace" talents slots 1 to max ranks, filled in order.
 * @param {Tree} tree @param {string} id @param {number} slot @param {{ uuid: string } | { built: Record<string, any> } | null} value @returns {EditResult}
 */
export function setRankSlot(tree, id, slot, value) {
  const t = copy(tree);
  const n = t.nodes.find(x => x.id === id); if (!n) return fail("That talent isn't in the tree.");
  const max = n.grant.perRank === "replace" ? n.maxRanks : 1;
  const s = Math.round(Number(slot));
  if (!Number.isInteger(s) || s < 1 || s > max) return fail(n.grant.perRank === "replace" ? `Choose a rank from 1 to ${max}.` : "This talent scales one grant with its rank: use rank slot 1.");
  if (value === null) { n.grant.ranks.splice(s - 1, 1); return done(t); }
  if (s > n.grant.ranks.length + 1) return fail(`Fill rank ${n.grant.ranks.length + 1} first.`);
  if ("uuid" in value) {
    if (!DOC_UUID_RE.test(String(value.uuid))) return fail("That isn't an Item or Active Effect UUID.");
    const isEffect = isEffectUuid(String(value.uuid));
    if (n.grant.mode === "item" && isEffect) {
      // An item talent can't grant an effect: switch the talent to effects, unless another slot needs it to stay an item.
      const others = n.grant.ranks.filter((_r, i) => i !== s - 1);
      const needsItem = others.some(r => ("uuid" in r && !isEffectUuid(String(r.uuid))) || ("built" in r && !!templateOf(r.built?.template)?.itemOnly));
      if (needsItem) return fail("That's an active effect, but this talent grants items and its other rank slots hold items: drop an item here, or clear those slots first.");
      n.grant.mode = "effect";
    }
    n.grant.ranks[s - 1] = { uuid: String(value.uuid) };
    if (n.grant.mode === "none") n.grant.mode = isEffect ? "effect" : "item";
  } else if (isObj(value.built)) n.grant.ranks[s - 1] = { built: structuredClone(value.built) };
  else return fail("Nothing to put in that slot.");
  return done(t);
}

/**
 * Link mode: the talent `id` requires `other` (toggles: a second click removes the link). `ranks` 0 = all of its ranks.
 * Refuses a link to itself and one that would make a cycle.
 * @param {Tree} tree @param {string} id @param {string} other @param {number} [ranks] @returns {EditResult & { linked?: boolean }}
 */
export function toggleLink(tree, id, other, ranks = 0) {
  if (id === other) return fail("A talent can't require itself.");
  const t = copy(tree);
  const n = t.nodes.find(x => x.id === id); const o = t.nodes.find(x => x.id === other);
  if (!n || !o) return fail("That talent isn't in the tree.");
  const i = n.prereqs.findIndex(p => p.node === other);
  if (i >= 0) { n.prereqs.splice(i, 1); return { ...done(t), linked: false }; }
  if (requires(t, other, id)) return fail(`${o.name} already needs ${n.name} (directly or through others): that would make a loop.`);
  n.excludes = n.excludes.filter(x => x !== other); o.excludes = o.excludes.filter(x => x !== id);
  n.prereqs.push({ node: other, ranks: Math.min(o.maxRanks, Math.max(0, Math.round(ranks))) || o.maxRanks });
  return { ...done(t), linked: true };
}

/** Whether `a` requires `b`, directly or through others. @param {Tree} tree @param {string} a @param {string} b */
export function requires(tree, a, b) {
  const byId = new Map(tree.nodes.map(n => [n.id, n])); const seen = new Set(); const stack = [a];
  while (stack.length) {
    const x = /** @type {string} */ (stack.pop()); if (seen.has(x)) continue; seen.add(x);
    for (const p of byId.get(x)?.prereqs ?? []) { if (p.node === b) return true; stack.push(p.node); }
  }
  return false;
}

/** The ranks a prerequisite needs (1 to its max). @param {Tree} tree @param {string} id @param {string} other @param {unknown} ranks @returns {EditResult} */
export function setPrereqRanks(tree, id, other, ranks) {
  const t = copy(tree);
  const n = t.nodes.find(x => x.id === id); const o = t.nodes.find(x => x.id === other);
  const p = n?.prereqs.find(x => x.node === other);
  if (!n || !o || !p) return fail("That requirement isn't there any more.");
  const v = int(ranks, 1, o.maxRanks); if (v !== null) p.ranks = v;
  return done(t);
}

/** Two talents that can't be learned together (toggles; mirrored both ways). @param {Tree} tree @param {string} a @param {string} b @returns {EditResult} */
export function toggleExclude(tree, a, b) {
  if (a === b) return fail("A talent can't exclude itself.");
  const t = copy(tree);
  const n = t.nodes.find(x => x.id === a); const o = t.nodes.find(x => x.id === b);
  if (!n || !o) return fail("That talent isn't in the tree.");
  if (n.excludes.includes(b)) { n.excludes = n.excludes.filter(x => x !== b); o.excludes = o.excludes.filter(x => x !== a); return done(t); }
  if (requires(t, a, b) || requires(t, b, a)) return fail(`${n.name} and ${o.name} are linked by a requirement: they can't also exclude each other.`);
  n.excludes.push(b); o.excludes.push(a);
  return done(t);
}

/** Deletes a talent and every reference to it (requirements, exclusions, the board's hub and edges). @param {Tree} tree @param {string} id @returns {EditResult} */
export function deleteNode(tree, id) {
  const t = copy(tree);
  if (!t.nodes.some(n => n.id === id)) return fail("That talent isn't in the tree.");
  t.nodes = t.nodes.filter(n => n.id !== id);
  for (const n of t.nodes) { n.prereqs = n.prereqs.filter(p => p.node !== id); n.excludes = n.excludes.filter(x => x !== id); }
  t.board.edges = t.board.edges.filter(([a, b]) => a !== id && b !== id);
  if (t.board.hub === id) t.board.hub = "";
  return done(t);
}

// ---------------------------------------------------------------- undo
/** @typedef {{ past: Tree[] }} History */
/** @returns {History} */
export const emptyHistory = () => ({ past: [] });
/** The history with `tree` (the state before an edit) on top, at most HISTORY_MAX. @param {History} h @param {Tree} tree @returns {History} */
export const pushHistory = (h, tree) => ({ past: [...h.past, structuredClone(tree)].slice(-HISTORY_MAX) });
/** The last state, and the history without it; null when there's nothing to undo. @param {History} h */
export function undoHistory(h) {
  if (!h.past.length) return null;
  return { tree: /** @type {Tree} */ (h.past.at(-1)), history: { past: h.past.slice(0, -1) } };
}

// ---------------------------------------------------------------- keys and focus
/**
 * What the editor does with a key press (0.6.2), wherever focus is: "escape" (leave link mode), "undo", or null (let it through).
 * `inEditor` = the event target is inside the editor window; `typing` = the target is a text field (any window); `otherWindow` = the
 * target is inside another window. Outside the editor (focus fell back to the page body after a redraw) the keys still reach us, but
 * never from a field or another window. Escape outside link mode is left alone (Foundry's close-the-top-window stays).
 * @param {{ key: string, ctrl?: boolean, linkMode?: boolean, inEditor?: boolean, typing?: boolean, otherWindow?: boolean, canUndo?: boolean }} k
 * @returns {"escape" | "undo" | null}
 */
export function keyAction(k) {
  if (k.typing || (!k.inEditor && k.otherWindow)) return null;
  if (k.key === "Escape") return k.linkMode ? "escape" : null;
  if (k.ctrl && String(k.key).toLowerCase() === "z") return k.inEditor || k.canUndo ? "undo" : null;
  return null;
}

/** A selector quote (pure; ids are plain, but quotes and backslashes are escaped). @param {string} v */
const q = v => `"${String(v).replace(/["\\]/g, "\\$&")}"`;

/**
 * A stable selector for the control that had focus before a redraw (0.6.2), from its data attributes and name; null when it has
 * none worth finding again (the window itself is focused then).
 * @param {{ action?: string, node?: string, cell?: string, wpSlot?: string, tree?: string, other?: string, kind?: string, ident?: string, name?: string }} d
 */
export function focusSelector(d = {}) {
  if (d.name) return `[name=${q(d.name)}]`;
  if (!d.action && d.cell == null && d.wpSlot == null) return null;
  let s = d.action ? `[data-action=${q(d.action)}]` : "";
  for (const [k, attr] of /** @type {const} */ ([["node", "data-node"], ["cell", "data-cell"], ["wpSlot", "data-wp-slot"], ["tree", "data-tree"], ["other", "data-other"], ["kind", "data-kind"], ["ident", "data-ident"]])) if (d[k] != null && d[k] !== "") s += `[${attr}=${q(d[k])}]`;
  return s || null;
}

// ---------------------------------------------------------------- publish
/**
 * Problems of a tree's built rank slots: [{ level, node, text }] (a bad spec, an item-only template on an effect talent).
 * @param {Tree} tree
 */
export function builtIssues(tree) {
  /** @type {{ level: "bad" | "warn", node: string, text: string }[]} */ const out = [];
  for (const n of tree.nodes) {
    for (const r of n.grant.ranks) {
      if (!("built" in r)) continue;
      const raw = /** @type {any} */ (r).built;
      const i = specIssues(raw, { maxRanks: n.maxRanks });
      if (i.length) { out.push({ level: "bad", node: n.id, text: `${n.name}: ${i[0]}` }); continue; }
      const tpl = templateOf(raw?.template);
      if (tpl?.itemOnly && n.grant.mode !== "item") out.push({ level: "bad", node: n.id, text: `${n.name}: ${tpl.label} makes a feature item, but the talent grants an effect.` });
    }
  }
  return out;
}

/**
 * Whether a tree can be published, and what to show: `errors` block publishing, `warnings` are shown and allowed.
 * `has(uuid)` says whether a granted document exists (undefined = unknown).
 * @param {unknown} raw @param {{ has?: (uuid: string) => boolean | undefined }} [o]
 * @returns {{ ok: boolean, tree: Tree, errors: { node?: string, text: string }[], warnings: { node?: string, text: string }[] }}
 */
export function publishPlan(raw, { has } = {}) {
  const tree = normalizeTree(raw);
  const all = [...treeIssues(tree, { has }), ...builtIssues(tree)];
  if (!tree.name) all.unshift({ level: "bad", text: "The tree needs a name." });
  const errors = all.filter(i => i.level === "bad").map(({ node, text }) => (node ? { node, text } : { text }));
  const warnings = all.filter(i => i.level !== "bad").map(({ node, text }) => (node ? { node, text } : { text }));
  return { ok: !errors.length && !!tree.id, tree, errors, warnings };
}

/**
 * The readable page written into the tree's Journal Entry on Publish (HTML, every value escaped): the tree's tiers and talents.
 * The data itself is the flag; this page is only for reading.
 * @param {Tree} tree
 */
export function treePageHTML(tree) {
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const out = [`<p><em>Written by Wanderer's Path when this tree was published. Edit the tree in the tree editor; changes here are replaced on the next publish.</em></p>`];
  const who = [...tree.assign.classes, ...tree.assign.subclasses];
  out.push(`<p>${who.length ? `For: ${esc(who.join(", "))}.` : "Assigned by hand only."}${tree.unlockLevel ? ` Opens at level ${tree.unlockLevel}.` : ""}${tree.enabled ? "" : " Turned off."}</p>`);
  const tiers = tree.layout === "tiered" ? Array.from({ length: tree.tiered.tiers }, (_, i) => i) : [0];
  for (const tier of tiers) {
    const nodes = tree.nodes.filter(n => tree.layout !== "tiered" || n.tier === tier).sort((a, b) => a.col - b.col);
    if (!nodes.length) continue;
    if (tree.layout === "tiered") out.push(`<h2>Tier ${tier + 1}${tier ? ` (${tier * tree.tiered.tierSize} points in the tree)` : ""}</h2>`);
    out.push(`<ul>${nodes.map(n => {
      const meta = [`${n.maxRanks} ${n.maxRanks === 1 ? "rank" : "ranks"}`, n.cost > 1 ? `${n.cost} points a rank` : ""].filter(Boolean).join(", ");
      const req = n.prereqs.map(p => `${byId.get(p.node)?.name ?? p.node} ${p.ranks}/${byId.get(p.node)?.maxRanks ?? p.ranks}`);
      const gate = [n.gate.treePoints ? `${n.gate.treePoints} points in the tree` : "", n.gate.level ? `level ${n.gate.level}` : ""].filter(Boolean);
      const ex = n.excludes.map(x => byId.get(x)?.name ?? x);
      const lines = [req.length || gate.length ? `Needs ${[...req, ...gate].join(", ")}.` : "", ex.length ? `Not with ${ex.join(", ")}.` : ""].filter(Boolean);
      return `<li><strong>${esc(n.name)}</strong> (${esc(meta)})${n.text ? `: ${esc(n.text)}` : ""}${lines.length ? `<br><small>${esc(lines.join(" "))}</small>` : ""}</li>`;
    }).join("")}</ul>`);
  }
  if (!tree.nodes.length) out.push("<p>No talents yet.</p>");
  return out.join("\n");
}

/**
 * Class and subclass choices from item index entries (`{ type, name, system: { identifier } }`): [{ id, name }] each, sorted, once
 * per identifier. Identifiers fall back to the name's slug, as dnd5e does.
 * @param {Iterable<any>} entries @returns {{ classes: { id: string, name: string }[], subclasses: { id: string, name: string }[] }}
 */
export function classChoices(entries) {
  /** @type {Record<"class" | "subclass", Map<string, string>>} */ const maps = { class: new Map(), subclass: new Map() };
  for (const e of entries) {
    const type = e?.type; if (type !== "class" && type !== "subclass") continue;
    const id = String(e?.system?.identifier || slug(e?.name ?? "")).toLowerCase();
    if (!IDENT_RE.test(id) || maps[type].has(id)) continue;
    maps[type].set(id, String(e?.name ?? id));
  }
  const list = (/** @type {Map<string, string>} */ m) => [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { classes: list(maps.class), subclasses: list(maps.subclass) };
}

/** A rank slot's label for the inspector: a built spec's preview, else the linked document's name (from `labels`), else its UUID. @param {any} r @param {number} maxRanks @param {Record<string, { name: string }>} [labels] */
export function slotLabel(r, maxRanks, labels = {}) {
  if (!r) return "";
  if ("built" in r) return `Built: ${previewLine(r.built, maxRanks)}`;
  return labels[r.uuid]?.name || r.uuid;
}
