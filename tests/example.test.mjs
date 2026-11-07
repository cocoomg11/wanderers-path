import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../scripts/example-model.mjs";
import { esc, plural } from "../scripts/const.mjs";

test("normalizeNotes reads missing, old and broken shapes", () => {
  assert.deepEqual(M.normalizeNotes(undefined), { v: M.NOTES_VERSION, notes: [] });
  assert.deepEqual(M.normalizeNotes(["a", " ", "b"]).notes.map(n => n.text), ["a", "b"]);
  assert.deepEqual(M.normalizeNotes({ v: 1, notes: [{ text: "x", at: 5 }, null, { text: "" }] }).notes, [{ text: "x", at: 5 }]);
  assert.equal(M.normalizeNotes("junk").notes.length, 0);
});

test("addNote trims, caps text and caps the list (newest first)", () => {
  let s = M.normalizeNotes(null);
  s = M.addNote(s, "  hello  ", 1);
  assert.equal(s.added, true); assert.equal(s.notes[0].text, "hello");
  assert.equal(M.addNote(s, "   ").added, false);
  assert.equal(M.addNote(s, "x".repeat(2000)).notes[0].text.length, M.NOTE_TEXT_MAX);
  let big = M.normalizeNotes([]);
  for (let i = 0; i < M.NOTES_MAX + 10; i++) big = M.addNote(big, `n${i}`, i);
  assert.equal(big.notes.length, M.NOTES_MAX);
  assert.equal(big.notes[0].text, `n${M.NOTES_MAX + 9}`);
  assert.equal(M.normalizeNotes(Array.from({ length: 200 }, (_, i) => `n${i}`)).notes.length, M.NOTES_MAX);
});

test("summary wording", () => {
  assert.equal(M.summary(null), "No notes yet.");
  assert.equal(M.summary(["a"]), "1 note.");
  assert.equal(M.summary(["a", "b"]), "2 notes.");
});

test("const helpers come from core", () => {
  assert.equal(esc("<a href=\"x\">&"), "&lt;a href=&quot;x&quot;&gt;&amp;");
  assert.equal(plural(1, "tool"), "1 tool"); assert.equal(plural(2, "tool"), "2 tools");
});
