/**
 * Remove module data: what this module stored, counted first (a dry run), removed only after the GM types REMOVE. Every new flag,
 * setting, status effect, folder or document the module writes must be found by plan(), removed by remove() and listed in CATEGORIES.
 * Core supplies the dry run, the confirmation word and the "settings that differ from their defaults" rule; the window that shows
 * this (with a REMOVE box) is the module's own, and this template ships the API only.
 */
import { dryRun, picked, confirmed, summary, changedSettings } from "../vendor/wanderers-core/index.mjs";
import { settingValues, resetSettings } from "../vendor/wanderers-core/foundry/index.mjs";
import { ID, TITLE } from "./const.mjs";
import { S } from "./core.mjs";

/** @type {import("../vendor/wanderers-core/cleanup-model.mjs").Category[]} [key, label, tickedByDefault] */
export const CATEGORIES = [
  ["notes", "Notes saved by the example tool", true],
  ["settings", `Reset ${TITLE}'s settings to their defaults (feature switches, debug logging; reloads)`, false]
];

/** What each category would remove. Nothing is changed. */
export function plan() {
  const stored = /** @type {any} */ (S.get("exampleNotes"));
  const notes = Array.isArray(stored?.notes) ? stored.notes.map((/** @type {any} */ n, /** @type {number} */ i) => ({ id: String(i), name: String(n?.text ?? n).slice(0, 30) })) : [];
  const defs = settingValues(ID).filter(d => d.key !== "exampleNotes");
  return { notes, settings: changedSettings(defs) };
}

/** The dry run as rows: [{ key, label, count, ticked, text }]. */
export const dryRunRows = () => dryRun(CATEGORIES, plan());

/**
 * Carries out the picked categories after the typed word matches: { [category]: number }, or null when refused.
 * @param {Record<string, boolean>} pick
 * @param {string} word what the GM typed (must be REMOVE)
 */
export async function remove(pick = {}, word = "") {
  if (!game.user?.isGM) { ui.notifications.warn("GM only."); return null; }
  if (!confirmed(word)) { ui.notifications.warn(`${TITLE}: type REMOVE to confirm.`); return null; }
  const p = plan(); /** @type {Record<string, number>} */ const done = {};
  for (const k of picked(CATEGORIES, pick, p)) {
    if (k === "notes") { await S.set("exampleNotes", {}); done.notes = p.notes.length; }
    if (k === "settings") done.settings = await resetSettings(ID, p.settings.map(item => /** @type {string} */ (item.key)));
  }
  return done;
}

export const describe = (/** @type {Record<string, number>} */ done) => summary(done, CATEGORIES);
