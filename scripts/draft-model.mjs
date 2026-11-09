/**
 * Tree drafts, pure (tested in Node: tests/v060.test.mjs). No Foundry calls at import or call time.
 *
 * The tree editor keeps the GM's unpublished edits in the GM-only store (core `createStore`, drafts.mjs): one journal entry in the
 * "Module data" folder, data in `flags.wanderers-path.drafts`. Publishing copies a draft into the tree compendium and drops it.
 *
 * Store (DRAFTS_VERSION 1):
 *   { v, drafts: { [treeId]: { tree: Tree, base: string | null, savedAt: number } } }
 * `tree` is always read through `normalizeTree`; `base` is the hash of the published tree the draft started from (null = a new
 * tree), so the editor can say "the published tree changed since". At most DRAFTS_MAX drafts (the oldest saved go first).
 */
import { versioned } from "../vendor/wanderers-core/index.mjs";
import { normalizeTree } from "./tree-model.mjs";
import { stableHash } from "./grants-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {{ tree: Tree, base: string | null, savedAt: number }} Draft */
/** @typedef {{ v: number, drafts: Record<string, Draft> }} DraftStore */

export const DRAFTS_VERSION = 1;
/** Drafts kept at most (each a whole tree; the store's own size limit is 8 MB). */
export const DRAFTS_MAX = 50;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);

/** @returns {DraftStore} */
export const emptyDrafts = () => ({ v: DRAFTS_VERSION, drafts: {} });

/** One draft read leniently, or null (a tree without an id is dropped). @param {unknown} raw @returns {Draft | null} */
export function normalizeDraft(raw) {
  if (!isObj(raw)) return null;
  const tree = normalizeTree(raw.tree);
  if (!tree.id) return null;
  const base = typeof raw.base === "string" && raw.base ? raw.base.slice(0, 40) : null;
  const at = Number(raw.savedAt);
  return { tree, base, savedAt: Number.isFinite(at) && at > 0 ? Math.round(at) : 0 };
}

/** @param {Record<string, any>} raw @returns {DraftStore} */
function clean(raw) {
  /** @type {Draft[]} */ const list = [];
  for (const [k, d] of Object.entries(isObj(raw.drafts) ? raw.drafts : {})) {
    const n = normalizeDraft(d);
    if (n && n.tree.id === k) list.push(n);
  }
  list.sort((a, b) => b.savedAt - a.savedAt);
  /** @type {Record<string, Draft>} */ const drafts = {};
  for (const d of list.slice(0, DRAFTS_MAX)) drafts[d.tree.id] = d;
  return { v: DRAFTS_VERSION, drafts };
}

/** The one normalizer for the store's data. Never throws. @type {(raw: unknown) => DraftStore} */
export const normalizeDrafts = versioned({ version: DRAFTS_VERSION, empty: emptyDrafts, upgrades: { 0: old => old }, clean });

/** A tree's content hash (normalized first, so equal trees always match). @param {unknown} tree */
export const treeHash = tree => stableHash(normalizeTree(tree));

/**
 * The store with `tree` saved as a draft (replacing that tree's draft). `published` is the published tree it is based on (null
 * for a new tree); when the draft already exists its base is kept. Pure.
 * @param {unknown} store @param {unknown} tree @param {{ published?: unknown, at?: number }} [o] @returns {DraftStore}
 */
export function withDraft(store, tree, { published = null, at = Date.now() } = {}) {
  const s = normalizeDrafts(store);
  const t = normalizeTree(tree);
  if (!t.id) return s;
  const old = s.drafts[t.id];
  const base = old ? old.base : published ? treeHash(published) : null;
  s.drafts[t.id] = { tree: t, base, savedAt: at };
  return normalizeDrafts(s);
}

/**
 * Drafts that were in `before` but not in `after` (other than `keep`): the ones a save dropped past DRAFTS_MAX. Pure.
 * @param {unknown} before @param {unknown} after @param {string} [keep] @returns {{ id: string, name: string }[]}
 */
export function evicted(before, after, keep = "") {
  const b = normalizeDrafts(before), a = normalizeDrafts(after);
  return Object.values(b.drafts).filter(d => d.tree.id !== keep && !a.drafts[d.tree.id]).map(d => ({ id: d.tree.id, name: d.tree.name || d.tree.id }));
}

/** The words for a failed draft save (the store's own reason, e.g. its size limit, without the module id prefix). @param {unknown} e */
export function saveErrorText(e) {
  const m = String(/** @type {any} */ (e)?.message ?? e ?? "").replace(/^[\w-]+:\s*/, "").trim().slice(0, 160);
  return m ? `couldn't save the draft: ${m}.`.replace(/\.\.$/, ".") : "couldn't save the draft.";
}

/** The store without that tree's draft. @param {unknown} store @param {string} id @returns {DraftStore} */
export function withoutDraft(store, id) {
  const s = normalizeDrafts(store);
  delete s.drafts[id];
  return s;
}

/**
 * A tree's state in the editor: "published" (no draft), "new" (a draft never published), "same" (a draft equal to the published
 * tree), "differs" (a draft with changes to publish). `stale`: the published tree changed since the draft was started.
 * @param {Draft | null | undefined} draft @param {Tree | null | undefined} published
 * @returns {{ state: "published" | "new" | "same" | "differs", stale: boolean, label: string, tip?: string }}
 */
export function draftState(draft, published) {
  if (!draft) return { state: "published", stale: false, label: "Published" };
  if (!published) return { state: "new", stale: false, label: "Draft, never published" };
  const ph = treeHash(published);
  const stale = !!draft.base && draft.base !== ph;
  if (treeHash(draft.tree) === ph) return { state: "same", stale: false, label: "Draft, same as published" };
  return stale
    ? { state: "differs", stale, label: "Draft · published tree changed", tip: "This draft differs from the published tree, and the published tree changed since the draft was started." }
    : { state: "differs", stale, label: "Draft differs from published" };
}

/**
 * What publishing would change, talent by talent: { added, removed, changed } (node names), `settings` (the tree's own fields
 * changed). `published` null: everything is added.
 * @param {Tree} draft @param {Tree | null | undefined} published
 * @returns {{ added: string[], removed: { id: string, name: string }[], changed: string[], settings: boolean }}
 */
export function changeSummary(draft, published) {
  const d = normalizeTree(draft);
  if (!published) return { added: d.nodes.map(n => n.name), removed: [], changed: [], settings: true };
  const p = normalizeTree(published);
  const pm = new Map(p.nodes.map(n => [n.id, n])); const dm = new Map(d.nodes.map(n => [n.id, n]));
  const added = d.nodes.filter(n => !pm.has(n.id)).map(n => n.name);
  const removed = p.nodes.filter(n => !dm.has(n.id)).map(n => ({ id: n.id, name: n.name }));
  const changed = d.nodes.filter(n => pm.has(n.id) && stableHash(n) !== stableHash(pm.get(n.id))).map(n => n.name);
  const { nodes: _a, ...ds } = d; const { nodes: _b, ...ps } = p;
  return { added, removed, changed, settings: stableHash(ds) !== stableHash(ps) };
}

/**
 * The editor's tree list: every published tree and every draft, once each, sorted by name, with its state.
 * @param {Tree[]} published @param {DraftStore} store
 * @returns {{ id: string, name: string, state: string, label: string, tip: string, stale: boolean, published: boolean, draft: boolean }[]}
 */
export function treeList(published, store) {
  const s = normalizeDrafts(store);
  const pub = new Map(published.map(t => [t.id, t]));
  const ids = new Set([...pub.keys(), ...Object.keys(s.drafts)]);
  return [...ids].map(id => {
    const d = s.drafts[id] ?? null; const p = pub.get(id) ?? null;
    const st = draftState(d, p);
    return { id, name: (d?.tree ?? p)?.name || id, state: st.state, label: st.label, tip: st.tip ?? "", stale: st.stale, published: !!p, draft: !!d };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Health lines for the drafts (plain text): drafts not published (info). @param {Tree[]} published @param {DraftStore} store */
export function draftLines(published, store) {
  const list = treeList(published, store).filter(t => t.state === "new" || t.state === "differs");
  if (!list.length) return [{ level: /** @type {const} */ ("ok"), text: "No unpublished drafts." }];
  const names = list.slice(0, 8).map(t => t.name).join(", ") + (list.length > 8 ? `, and ${list.length - 8} more` : "");
  return [{ level: /** @type {const} */ ("info"), text: `${list.length} ${list.length === 1 ? "draft isn't" : "drafts aren't"} published yet: ${names}. Players see only published trees (Tree editor › Publish).` }];
}
