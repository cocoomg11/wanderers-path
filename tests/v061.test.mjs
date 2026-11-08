// 0.6.1: fixes before release (review of 0.6.0 and live test 6). Generic placeholders only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as D from "../scripts/draft-model.mjs";
import * as E from "../scripts/editor-model.mjs";
import { normalizeTree, treeIssues, uuidPresence, isEffectUuid } from "../scripts/tree-model.mjs";
import { tiered } from "./_fixtures.mjs";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** @param {E.EditResult} r */
const ok = r => { assert.ok(r.ok, /** @type {any} */ (r).error); return /** @type {{ tree: any }} */ (r).tree; };
const ITEM = "Compendium.world.talent-sources.Item.abcdefghijklmnop";
const ITEM2 = "Compendium.world.talent-sources.Item.bbbbbbbbbbbbbbbb";
const EFFECT = `${ITEM}.ActiveEffect.qrstuvwxyzABCDEF`;
const index = (/** @type {string[]} */ ids) => { const m = new Map(ids.map(i => [i, { _id: i }])); return m; };

test("H1 uuidPresence: an effect inside an indexed compendium item is unknown, never missing", () => {
  const packs = { "world.talent-sources": index(["abcdefghijklmnop"]) };
  const o = { sync: () => null, packIndex: (/** @type {string} */ id) => /** @type {any} */ (packs)[id] ?? null };
  assert.equal(uuidPresence(EFFECT, o), undefined, "parent in the index: can't check the effect synchronously");
  assert.equal(uuidPresence(ITEM, o), true);
  assert.equal(uuidPresence(`${ITEM2}.ActiveEffect.qrstuvwxyzABCDEF`, o), false, "parent not in a loaded index");
  assert.equal(uuidPresence(ITEM2, o), false);
  assert.equal(uuidPresence("Compendium.world.gone.Item.abcdefghijklmnop", o), false, "no such pack");
  assert.equal(uuidPresence(EFFECT, { sync: () => null, packIndex: () => new Map() }), undefined, "index not loaded");
  assert.equal(uuidPresence("Item.abcdefghijklmnop", o), false, "world document not found");
  assert.equal(uuidPresence(EFFECT, { sync: () => ({ name: "x" }), packIndex: () => null }), true);
  assert.equal(uuidPresence(EFFECT, { sync: () => { throw new Error("embedded in an index entry"); }, packIndex: () => null }), undefined, "never throws");
  // The Publish gate: such a tree has no "no longer exists" error.
  const t = ok(E.setRankSlot(ok(E.updateNode(tiered(), "a1", { mode: "effect" })), "a1", 1, { uuid: EFFECT }));
  assert.ok(!treeIssues(t, { has: u => uuidPresence(u, o) }).some(i => /no longer exists/.test(i.text)));
  assert.match(src("scripts/trees.mjs"), /return uuidPresence\(uuid, \{/);
});

test("M3 an item talent can't hold an effect: treeIssues error, setRankSlot switches or refuses", () => {
  assert.ok(isEffectUuid(EFFECT) && isEffectUuid("ActiveEffect.qrstuvwxyzABCDEF") && !isEffectUuid(ITEM));
  // Stored by hand (or by changing the mode later): an error that blocks Publish.
  const bad = normalizeTree({ ...tiered(), nodes: [{ id: "a1", name: "A", grant: { mode: "item", ranks: [{ uuid: EFFECT }] } }] });
  assert.ok(treeIssues(bad).some(i => i.level === "bad" && i.node === "a1" && /active effect/.test(i.text)));
  assert.ok(!E.publishPlan(bad, { has: () => true }).ok);
  // Item talent, empty: dropping an effect switches it to effects.
  const item = ok(E.setRankSlot(tiered(), "a1", 1, { uuid: ITEM }));
  assert.equal(item.nodes.find((/** @type {any} */ n) => n.id === "a1").grant.mode, "item");
  const sw = ok(E.setRankSlot(item, "a1", 1, { uuid: EFFECT }));
  const n = sw.nodes.find((/** @type {any} */ x) => x.id === "a1");
  assert.equal(n.grant.mode, "effect"); assert.equal(n.grant.ranks[0].uuid, EFFECT);
  assert.deepEqual(treeIssues(sw).filter(i => i.node === "a1" && /active effect/.test(i.text)), []);
  // Replace talent with an item in another slot: refused with a notice, nothing changed.
  let rep = ok(E.updateNode(tiered(), "a2", { perRank: "replace" }));
  rep = ok(E.setRankSlot(rep, "a2", 1, { uuid: ITEM }));
  rep = ok(E.setRankSlot(rep, "a2", 2, { uuid: ITEM2 }));
  const r = E.setRankSlot(rep, "a2", 2, { uuid: EFFECT });
  assert.equal(r.ok, false); assert.match(/** @type {any} */ (r).error, /grants items/);
  // An effect talent still takes items (their first transferring effect).
  const eff = ok(E.setRankSlot(sw, "a1", 1, { uuid: ITEM }));
  assert.equal(eff.nodes.find((/** @type {any} */ x) => x.id === "a1").grant.mode, "effect");
});

test("M4 publishStale: the draft's base, else the hash taken when the published tree was opened", () => {
  const pub = tiered();
  const later = ok(E.updateNode(pub, "a1", { name: "Changed elsewhere" }));
  const draft = D.withDraft(null, ok(E.updateNode(pub, "a2", { name: "Mine" })), { published: pub, at: 1 }).drafts.alpha;
  assert.equal(E.publishStale({ draft, published: pub }), false);
  assert.equal(E.publishStale({ draft, published: later }), true);
  assert.equal(E.publishStale({ draft: null, published: later, base: D.treeHash(pub) }), true);
  assert.equal(E.publishStale({ draft: null, published: pub, base: D.treeHash(pub) }), false);
  assert.equal(E.publishStale({ draft: null, published: null, base: "x" }), false, "never published");
  const ed = src("scripts/editor.mjs");
  assert.match(ed, /static async #onPublish[\s\S]*?E\.publishStale\([\s\S]*?changed since[\s\S]*?confirm\("Publish tree"/);
});

test("M2 discarding on close drops the working copy and the undo history (shared window)", () => {
  const ed = src("scripts/editor.mjs");
  assert.match(ed, /async close\(options = \{\}\) \{[\s\S]*?if \(!ok\) return this;[\s\S]*?this\.work = null; this\.history = E\.emptyHistory\(\);[\s\S]*?return super\.close\(options\);/);
});

test("live bug: a Fix button is busy from the first click (double-click opens one confirm, runs once)", () => {
  const w = src("scripts/settings-window.mjs");
  const body = w.slice(w.indexOf("static async #onFix"), w.indexOf("static async #onRemove"));
  assert.ok(body.indexOf("self.busy = key") > -1 && body.indexOf("self.busy = key") < body.indexOf("DialogV2.confirm"), "busy before the confirm");
  assert.match(body, /if \(!ok\) \{ self\.busy = null; return; \}/, "cleared on No / close");
  assert.match(body, /if \(!game\.user\?\.isGM \|\| self\.busy\) return;/);
});

test("lows: switch refusal, actor-owned drops, delete not found, drafts cap and store errors", () => {
  const ed = src("scripts/editor.mjs");
  assert.match(ed, /async show\(treeId[\s\S]*?!\(await this\.#switchTo\(treeId\)\)\)[\s\S]*?return this;[\s\S]*?if \(node\) this\.selected = node;/);
  assert.ok(E.ownedSource("Actor.abcdefghijklmnop.Item.abcdefghijklmnop.ActiveEffect.qrstuvwxyzABCDEF"));
  assert.ok(E.ownedSource("Scene.abcdefghijklmnop.Token.abcdefghijklmnop.Actor.abcdefghijklmnop.Item.abcdefghijklmnop"));
  assert.ok(E.ownedSource("Compendium.world.heroes.Actor.abcdefghijklmnop.Item.abcdefghijklmnop"));
  assert.ok(!E.ownedSource(ITEM) && !E.ownedSource(EFFECT) && !E.ownedSource("Item.abcdefghijklmnop"));
  assert.match(ed, /E\.ownedSource\(data\.uuid\)[\s\S]*?Items sidebar or a compendium/);
  assert.match(ed, /wasn't found in the tree compendium/);
  // Cap: the save tells which drafts went.
  const full = { drafts: Object.fromEntries(Array.from({ length: D.DRAFTS_MAX }, (_, i) => [`t${i}`, { tree: { id: `t${i}`, name: `T${i}` }, savedAt: i + 1 }])) };
  const next = D.withDraft(full, { id: "fresh", name: "Fresh" }, { at: 1e9 });
  assert.deepEqual(D.evicted(full, next, "fresh"), [{ id: "t0", name: "T0" }]);
  assert.deepEqual(D.evicted(next, D.withDraft(next, { id: "fresh", name: "Fresh 2" }, { at: 2e9 }), "fresh"), [], "re-saving drops nothing");
  assert.match(src("scripts/drafts.mjs"), /lost = evicted\(d, next, tree\.id\)/);
  assert.equal(D.saveErrorText(new Error("wanderers-path: the GM-only store would be 2000000 bytes (limit 1000000); nothing was written")), "couldn't save the draft: the GM-only store would be 2000000 bytes (limit 1000000); nothing was written.");
  assert.equal(D.saveErrorText(null), "couldn't save the draft.");
  assert.doesNotMatch(ed, /warnUser\("couldn't save the draft\."\)/);
});

test("0.6.1: version and changelog", () => {
  const m = JSON.parse(src("module.json"));
  assert.equal(m.version, "0.6.1");
  assert.equal(m.download, "https://github.com/cocoomg11/wanderers-path/releases/download/v0.6.1/module.zip");
  assert.match(src("CHANGELOG.md"), /^## 0\.6\.1$[\s\S]*?### Untested in Foundry[\s\S]*?^## 0\.6\.0$/m);
});
