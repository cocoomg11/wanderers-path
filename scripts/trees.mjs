/**
 * The tree loader: published trees come from the GM-picked world compendium (setting `treePack`), one JournalEntry per tree with
 * its data in `flags.wanderers-path.tree`. Loaded with one `pack.getIndex({ fields })` (never a fromUuid per node) and cached until
 * the compendium, one of its entries or the setting changes. Untested in Node: needs a live world (the pure rules are tree-model).
 */
import { ID, TREE_FLAG } from "./const.mjs";
import { S, log, warn, onRulesChanged } from "./core.mjs";
import { normalizeTree } from "./tree-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */

/** @type {Promise<Tree[]> | null} */
let cache = null;
/** @type {Set<() => void>} */
const listeners = new Set();

/** The chosen pack id ("" when none). */
export const packId = () => String(S.get("treePack") ?? "").trim();
/** The chosen pack, or null. */
export const pack = () => { const id = packId(); return id ? game.packs?.get(id) ?? null : null; };

/** Forgets the cache and tells open windows. */
export function invalidate() {
  cache = null;
  for (const fn of listeners) { try { fn(); } catch (e) { warn("tree listener", e); } }
}
/** Runs `fn` whenever the published trees may have changed. @param {() => void} fn */
export const onTreesChanged = fn => { listeners.add(fn); };

/**
 * Every published tree with an id, sorted by name (the cache is shared: callers get clones from `trees()` in the API only).
 * Never throws: an unreadable pack gives [].
 * @returns {Promise<Tree[]>}
 */
export function loadTrees() {
  if (cache) return cache;
  cache = (async () => {
    const p = pack();
    if (!p || p.documentName !== "JournalEntry") return [];
    try {
      const index = await p.getIndex({ fields: [`flags.${ID}.${TREE_FLAG}`] });
      /** @type {Tree[]} */ const out = []; const seen = new Set();
      for (const e of index) {
        const t = normalizeTree(e?.flags?.[ID]?.[TREE_FLAG]);
        if (!t.id || seen.has(t.id)) continue;
        if (!t.name) t.name = String(e.name ?? t.id);
        seen.add(t.id); out.push(t);
      }
      out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      log(`trees: ${out.length} loaded from ${p.collection}`);
      return out;
    } catch (e) { warn("couldn't read the tree compendium", e); cache = null; return []; }
  })();
  return cache;
}

/** Hooks that invalidate the cache (init, feature on). Each bails out unless the change is in our pack. */
export function registerHooks() {
  const ours = (/** @type {any} */ doc) => !!doc?.pack && doc.pack === packId();
  for (const h of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) Hooks.on(h, (/** @type {any} */ doc) => { if (ours(doc)) invalidate(); });
  Hooks.on("updateCompendium", (/** @type {any} */ p) => { if (p?.collection === packId()) invalidate(); });
  onRulesChanged(() => invalidate());
}
