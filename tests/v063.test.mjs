// 0.6.3: the Trees list's short badge explains itself (live test B2). Generic placeholders only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../scripts/draft-model.mjs";
import * as V from "../scripts/editor-view-model.mjs";
import { tiered } from "./_fixtures.mjs";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const facts = (/** @type {any} */ list) => /** @type {any} */ ({
  list, tree: null, status: null, dirty: false, canUndo: false, selected: null, linkMode: false, sources: [], search: "", labels: {},
  classes: { classes: [], subclasses: [] }, plan: { errors: [], warnings: [] }, builder: true, packName: "P", packLocked: false, busy: false
});

test("Trees list: the stale Draft (changed) badge has the title bar's sentence as its tooltip", () => {
  const pub = tiered();
  const old = { ...pub, name: "Older" };
  const changed = { ...pub, name: "Changed" };
  const store = D.withDraft(D.emptyDrafts(), changed, { published: old, at: 1 });
  const list = D.treeList([pub], store);
  const row = list.find(t => t.id === pub.id);
  assert.equal(row?.state, "differs"); assert.equal(row?.stale, true);
  const title = D.draftState({ tree: changed, base: D.treeHash(old), savedAt: 1 }, pub);
  assert.equal(row?.tip, title.tip, "same text as the title-bar badge");
  const html = V.editorHTML(facts(list));
  assert.match(html, /<small class="wc-badge wc-warn" data-tooltip-text="This draft differs from the published tree, and the published tree changed since the draft was started\.">Draft \(changed\)<\/small>/);
});

test("Trees list: other badges show their full label on hover", () => {
  const pub = tiered();
  const list = D.treeList([pub], D.emptyDrafts());
  assert.equal(list[0].tip, "");
  assert.match(V.editorHTML(facts(list)), /data-tooltip-text="Published">Published<\/small>/);
  const fresh = D.withDraft(D.emptyDrafts(), { ...pub, name: "Changed" }, { published: pub, at: 1 });
  assert.match(V.editorHTML(facts(D.treeList([pub], fresh))), /data-tooltip-text="Draft differs from published">Draft \(changed\)<\/small>/);
});

test("0.6.3: version and changelog", () => {
  const m = JSON.parse(src("module.json"));
  assert.equal(m.version, "0.6.3");
  assert.equal(m.download, "https://github.com/cocoomg11/wanderers-path/releases/download/v0.6.3/module.zip");
  assert.match(src("CHANGELOG.md"), /^## 0\.6\.3$[\s\S]*?### Untested in Foundry[\s\S]*?^## 0\.6\.2$/m);
});
