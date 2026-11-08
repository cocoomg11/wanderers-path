/**
 * Remove Wanderer's Path data (GM): characters' picks (`flags.wanderers-path` on actors, world actors and unlinked tokens' own
 * actors), the items and effects talents granted (tagged `flags.wanderers-path.granted`; deleted, untagged documents never) and the
 * module's settings, and (0.6.0) the tree editor's drafts journal (core's GM-only store; unticked by default). The tree compendium is the GM's own content: it is listed in the dry run, never deleted.
 * Nothing changes until the GM ticks categories and types REMOVE (core's cleanup model). The plan is read with `plan()`; Foundry is
 * only touched when `plan()` / `remove()` run.
 */
import { CONFIRM_WORD, confirmed, hasFlags, dryRun, picked, changedSettings, summary } from "../vendor/wanderers-core/index.mjs";
import { unsetFlags, resetSettings, settingValues } from "../vendor/wanderers-core/foundry/index.mjs";
import { ID } from "./const.mjs";
import { existingOf } from "./grants.mjs";
import * as Drafts from "./drafts.mjs";

/** Deletes every tagged item and effect (one call per actor and type). Returns how many were deleted. */
async function removeGranted() {
  let n = 0;
  for (const a of grantHolders()) {
    const list = existingOf(a); if (!list.length) continue;
    for (const type of /** @type {const} */ (["Item", "ActiveEffect"])) {
      const ids = list.filter(d => d.type === type).map(d => d.id);
      if (!ids.length) continue;
      try { n += (await a.deleteEmbeddedDocuments(type, ids)).length; } catch (e) { console.warn(`${ID} | remove granted ${a.name}`, e); }
    }
  }
  return n;
}

/** @type {import("../vendor/wanderers-core/cleanup-model.mjs").Category[]} */
export const CATEGORIES = [
  ["picks", "Talent picks, awards and logs on characters (flags only; the characters stay)", true],
  ["granted", "Items and effects talents granted to characters (deleted; items you added by hand are never touched)", true],
  ["drafts", "Tree drafts: the GM-only journal of unpublished trees in the Module data folder (unpublished edits are lost; published trees stay)", false],
  ["settings", "Reset Wanderer's Path's settings to their defaults (the tree compendium choice and the window placements, including the tree editor's, and the Module data folder switch too; reloads)", false],
  ["trees", "The tree compendium (listed only: your trees are your own content and are never deleted here)", false]
];
/** Categories remove() acts on (the tree compendium is never one). */
export const REMOVABLE = Object.freeze(["picks", "granted", "drafts", "settings"]);

/** Every actor that can hold picks: world actors and unlinked tokens' own actors. */
function* holders() {
  for (const a of game.actors ?? []) yield a;
  for (const s of game.scenes ?? []) for (const t of s.tokens) if (!t.actorLink && t.actor && t.delta?._source?.flags?.[ID]) yield t.actor;
}

/** Every actor that can hold granted documents: world actors and unlinked tokens' own actors whose delta has items or effects. */
function* grantHolders() {
  for (const a of game.actors ?? []) yield a;
  for (const s of game.scenes ?? []) for (const t of s.tokens) if (!t.actorLink && t.actor && (t.delta?._source?.items?.length || t.delta?._source?.effects?.length)) yield t.actor;
}

/** Counts what each category would remove. Nothing is changed. @returns {import("../vendor/wanderers-core/cleanup-model.mjs").Plan} */
export function plan() {
  /** @type {import("../vendor/wanderers-core/cleanup-model.mjs").Plan} */
  const p = { picks: [], granted: [], drafts: [], settings: [], trees: [] };
  for (const a of holders()) if (hasFlags(a, ID)) p.picks.push({ uuid: a.uuid, name: String(a.name ?? a.id) });
  for (const a of grantHolders()) for (const d of existingOf(a)) p.granted.push({ uuid: `${a.uuid}.${d.type}.${d.id}`, name: `${d.name} (${a.name})` });
  try { const st = Drafts.status(); if (st.exists) p.drafts.push({ id: st.id, name: `${st.name}${st.count > 1 ? ` (${st.count} entries)` : ""}` }); } catch { p.drafts = []; }
  // World and client settings that differ from their defaults (client ones are this browser's: window placements).
  try { p.settings = changedSettings(settingValues(ID), { scopes: ["world", "client"] }); } catch { p.settings = []; }
  let packKey = ""; try { packKey = String(game.settings.get(ID, "treePack") ?? ""); } catch { packKey = ""; }
  const pk = packKey ? game.packs?.get(packKey) : null;
  if (pk) p.trees.push({ id: pk.collection, name: `${pk.title} (kept)` });
  return p;
}

/** The dry run rows. */
export const dryRunRows = () => dryRun(CATEGORIES, plan());

/**
 * Removes the ticked categories after the GM typed REMOVE. Returns a one-line summary, or null when not confirmed.
 * @param {Record<string, boolean>} pick @param {string} word
 */
export async function remove(pick, word) {
  if (!game.user?.isGM) { ui.notifications.warn("Wanderer's Path: GM only."); return null; }
  if (!confirmed(word)) { ui.notifications.warn(`Type ${CONFIRM_WORD} to confirm.`); return null; }
  const p = plan();
  const keys = picked(CATEGORIES, pick, p).filter(k => REMOVABLE.includes(k));
  /** @type {Record<string, number>} */ const done = {};
  // Granted documents first: their tag is what finds them.
  if (keys.includes("granted")) done.granted = await removeGranted();
  if (keys.includes("drafts")) done.drafts = await Drafts.remove();
  if (keys.includes("picks")) done.picks = await unsetFlags(ID, p.picks.map(x => /** @type {string} */ (x.uuid)));
  if (keys.includes("settings")) done.settings = await resetSettings(ID, p.settings.map(x => /** @type {string} */ (x.key)));
  const text = summary(done, CATEGORIES);
  ui.notifications.info(`Wanderer's Path: removed ${text}.`);
  if (done.settings) foundry.utils.debounce(() => globalThis.location?.reload(), 500)();
  return text;
}
