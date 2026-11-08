/**
 * The tree loader: published trees come from the GM-picked world compendium (setting `treePack`), one JournalEntry per tree with
 * its data in `flags.wanderers-path.tree`. Loaded with one `pack.getIndex({ fields })` (never a fromUuid per node) and cached until
 * the compendium, one of its entries or the setting changes. Untested in Node: needs a live world (the pure rules are tree-model).
 */
import { ID, TREE_FLAG } from "./const.mjs";
import { S, log, warn, onRulesChanged } from "./core.mjs";
import { normalizeTree, uuidPresence } from "./tree-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */

/** @type {Promise<Tree[]> | null} */
let cache = null;
/** Whether the last read of the tree compendium worked (false: none chosen, missing, or unreadable). */
let readOk = false;
/** @type {Set<() => void>} */
const listeners = new Set();

/** The chosen pack id ("" when none). */
export const packId = () => String(S.get("treePack") ?? "").trim();
/** The chosen pack, or null. */
export const pack = () => { const id = packId(); return id ? game.packs?.get(id) ?? null : null; };

/** The trees of the last finished read (synchronous; [] before the first). For checks that can't wait, such as a page's visible(). @type {Tree[]} */
let last = [];
export const cachedTrees = () => last;

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
    readOk = false;
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
      readOk = true;
      last = out;
      return out;
    } catch (e) { warn("couldn't read the tree compendium", e); cache = null; return []; }
  })();
  return cache;
}

/**
 * The published trees, and whether they could be read. The grant engine removes nothing while `ok` is false: an unset or broken
 * compendium must never strip every character's granted items.
 * @returns {Promise<{ trees: Tree[], ok: boolean }>}
 */
export async function loadTreesChecked() {
  const trees = await loadTrees();
  return { trees, ok: readOk };
}

/**
 * Whether a granted document exists, without loading it: a world document or a compendium index entry (rules: tree-model
 * `uuidPresence`). Unknown (undefined) when a compendium's index isn't loaded, or for an effect inside a compendium item whose item
 * is in the index (fromUuidSync can't reach embedded documents of an index entry), so nothing is reported wrongly. Used by the
 * health check and the editor's Publish.
 * @param {string} uuid @returns {boolean | undefined}
 */
export function uuidExists(uuid) {
  return uuidPresence(uuid, {
    sync: u => { try { return fromUuidSync(u, { strict: false }); } catch { return null; } },
    packIndex: id => { const pk = game.packs?.get(id); return pk ? (pk.index ?? { size: 0, has: () => false }) : null; }
  });
}

/** Hooks that invalidate the cache (init, feature on). Each bails out unless the change is in our pack. */
export function registerHooks() {
  const ours = (/** @type {any} */ doc) => !!doc?.pack && doc.pack === packId();
  for (const h of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) Hooks.on(h, (/** @type {any} */ doc) => { if (ours(doc)) invalidate(); });
  Hooks.on("updateCompendium", (/** @type {any} */ p) => { if (p?.collection === packId()) invalidate(); });
  onRulesChanged(() => invalidate());
}
