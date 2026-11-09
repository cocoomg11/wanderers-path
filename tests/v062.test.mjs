// 0.6.2: fixes from live test 7. Generic placeholders only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../scripts/draft-model.mjs";
import * as E from "../scripts/editor-model.mjs";
import * as G from "../scripts/grants-model.mjs";
import * as V from "../scripts/editor-view-model.mjs";
import { tiered } from "./_fixtures.mjs";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("keyAction: Escape only in link mode, Ctrl+Z with focus lost, never while typing or in another window", () => {
  const k = (/** @type {any} */ o) => E.keyAction({ key: "Escape", ...o });
  assert.equal(k({ linkMode: true, inEditor: true }), "escape");
  assert.equal(k({ linkMode: true, inEditor: false }), "escape", "focus fell back to the page body");
  assert.equal(k({ linkMode: false, inEditor: true }), null, "Foundry's own Escape stays");
  assert.equal(k({ linkMode: true, typing: true }), null);
  assert.equal(k({ linkMode: true, otherWindow: true }), null);
  const z = (/** @type {any} */ o) => E.keyAction({ key: "z", ctrl: true, ...o });
  assert.equal(z({ inEditor: true }), "undo");
  assert.equal(z({ inEditor: true, key: "Z" }), "undo");
  assert.equal(z({ inEditor: false, canUndo: true }), "undo");
  assert.equal(z({ inEditor: false, canUndo: false }), null, "nothing to undo: Foundry's undo");
  assert.equal(z({ inEditor: true, typing: true }), null);
  assert.equal(z({ otherWindow: true, canUndo: true }), null);
  assert.equal(E.keyAction({ key: "z", inEditor: true }), null, "plain z");
  assert.equal(E.keyAction({ key: "a", ctrl: true, inEditor: true }), null);
});

test("focusSelector: stable selectors from data attributes and names", () => {
  assert.equal(E.focusSelector({ action: "selectNode", node: "a1" }), '[data-action="selectNode"][data-node="a1"]');
  assert.equal(E.focusSelector({ action: "addNode", cell: "1.2" }), '[data-action="addNode"][data-cell="1.2"]');
  assert.equal(E.focusSelector({ name: "node.name" }), '[name="node.name"]');
  assert.equal(E.focusSelector({ action: "linkMode" }), '[data-action="linkMode"]');
  assert.equal(E.focusSelector({ action: "x", node: 'a"b\\c' }), '[data-action="x"][data-node="a\\"b\\\\c"]');
  assert.equal(E.focusSelector({}), null);
  assert.equal(E.focusSelector({ tooltipText: "hi" }), null);
});

test("editor wiring: refocus after redraw, window-capture key listener removed on close", () => {
  const ed = src("scripts/editor.mjs");
  assert.match(ed, /E\.focusSelector\(/);
  assert.match(ed, /this\.#refocus\(content, sel\)/);
  assert.match(ed, /root\.tabIndex = -1/);
  assert.match(ed, /window\.addEventListener\("keydown", this\.#docKey, true\)/);
  assert.match(ed, /window\.removeEventListener\("keydown", this\.#docKey, true\)/);
  assert.match(ed, /E\.keyAction\(/);
  assert.doesNotMatch(ed, /ev\.key === "Escape" && this\.linkMode/, "one place decides Escape");
  assert.match(ed, /It isn't in the tree compendium/);
  assert.doesNotMatch(ed, /It was never published, so no character has it/);
});

test("stale draft badge: short label, full text as a plain-text tooltip", () => {
  const pub = tiered(); const changed = { ...tiered(), name: "Changed" };
  const st = D.draftState({ tree: changed, base: "old-hash", savedAt: 1 }, pub);
  assert.equal(st.state, "differs"); assert.equal(st.stale, true);
  assert.equal(st.label, "Draft · published tree changed");
  assert.match(st.tip ?? "", /changed since the draft was started\.$/);
  assert.equal(D.draftState({ tree: changed, base: null, savedAt: 1 }, pub).label, "Draft differs from published");
  const facts = {
    list: [], tree: changed, status: st, dirty: false, canUndo: false, selected: null, linkMode: false, sources: [], search: "", labels: {},
    classes: { classes: [], subclasses: [] }, plan: { errors: [], warnings: [] }, builder: true, packName: "P", packLocked: false, busy: false
  };
  const html = V.editorHTML(/** @type {any} */ (facts));
  assert.match(html, /<small class="wc-badge[^"]*" data-tooltip-text="This draft differs[^"]*">Draft · published tree changed<\/small>/);
});

test("missingSources: missing UUIDs once, built slots and unknown never", () => {
  const g = (/** @type {string} */ src, extra = {}) => /** @type {any} */ ({ tree: "t", node: "n", rank: 1, key: "t.n", type: "Item", mode: "item", perRank: "scale", src, ...extra });
  const has = (/** @type {string} */ u) => u === "Item.aaaaaaaaaaaaaaaa" ? true : u === "Item.bbbbbbbbbbbbbbbb" ? false : undefined;
  assert.deepEqual(G.missingSources([g("Item.aaaaaaaaaaaaaaaa"), g("Item.bbbbbbbbbbbbbbbb"), g("Item.bbbbbbbbbbbbbbbb"), g("Compendium.x.y.Item.cccccccccccccccc"), g("built:abc", { built: {} })], has), ["Item.bbbbbbbbbbbbbbbb"]);
  const h = src("scripts/health.mjs");
  assert.match(h, /missingSources\(desiredOf\(st\), exists\)/);
  assert.match(h, /outOfSync \|\| missing \? "" : ", all in step"/);
});
