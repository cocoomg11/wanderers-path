/**
 * Example pure model: a small capped, versioned list of notes. No Foundry calls, so it is tested in Node (tests/example.test.mjs).
 * Pattern to copy for real data: a version number, one normalizer that reads every stored shape (core's `versioned`), and a cap on
 * any list-like store (core's `addCapped`).
 */
import { versioned, addCapped } from "../vendor/wanderers-core/index.mjs";

export const NOTES_VERSION = 1;
/** A list-like store always has a cap. */
export const NOTES_MAX = 50;
export const NOTE_TEXT_MAX = 500;

/**
 * @typedef {{ text: string, at: number }} Note
 * @typedef {{ v: number, notes: Note[] }} Notes
 */

/**
 * @param {unknown} item
 * @returns {Note | null}
 */
function cleanNote(item) {
  const o = typeof item === "string" ? { text: item, at: 0 } : /** @type {any} */ (item);
  const text = String(o?.text ?? "").trim().slice(0, NOTE_TEXT_MAX);
  return text ? { text, at: Number.isFinite(o?.at) ? o.at : 0 } : null;
}

/**
 * Reads whatever is stored (missing, old shape, hand-edited) into the current shape, newest first. Never throws.
 * Version 0 was a plain array of strings.
 * @type {(raw: unknown) => Notes}
 */
export const normalizeNotes = versioned({
  version: NOTES_VERSION,
  empty: () => ({ v: NOTES_VERSION, notes: [] }),
  upgrades: { 0: old => ({ v: NOTES_VERSION, notes: Array.isArray(old) ? old : Array.isArray(old?.notes) ? old.notes : [] }) },
  clean: s => ({ v: NOTES_VERSION, notes: (Array.isArray(s?.notes) ? s.notes : []).map(cleanNote).filter(Boolean).slice(0, NOTES_MAX) })
});

/**
 * Adds a note (newest first); the oldest fall off at the cap. Returns a new object.
 * @param {unknown} stored
 * @param {string} text
 * @param {number} [at]
 */
export function addNote(stored, text, at = Date.now()) {
  const s = normalizeNotes(stored);
  const note = cleanNote({ text, at });
  if (!note) return { ...s, added: false };
  return { v: NOTES_VERSION, notes: addCapped(s.notes, note, { max: NOTES_MAX, key: null }), added: true };
}

/**
 * One line for the window and the health check.
 * @param {unknown} stored
 */
export function summary(stored) {
  const n = normalizeNotes(stored).notes.length;
  return n === 0 ? "No notes yet." : `${n} ${n === 1 ? "note" : "notes"}.`;
}
