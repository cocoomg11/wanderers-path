// 0.6.0: the GM tree editor (drafts, editing rules, publish gate, markup), the builder writing into the editor, tree `enabled`.
// Generic placeholders only: the module ships no talent content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fakeWorld, installFakes } from "../vendor/wanderers-core/testing/index.mjs";
import * as D from "../scripts/draft-model.mjs";
import * as E from "../scripts/editor-model.mjs";
import * as V from "../scripts/editor-view-model.mjs";
import { builderHTML, buildState } from "../scripts/builder-view-model.mjs";
import { normalizeTree, treeIssues } from "../scripts/tree-model.mjs";
import { treesFor, emptyPicks, DEFAULT_RULES } from "../scripts/picks-model.mjs";
import { tiered } from "./_fixtures.mjs";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const scripts = readdirSync(new URL("../scripts/", import.meta.url)).filter(f => f.endsWith(".mjs"));
/** @param {E.EditResult} r */
const ok = r => { assert.ok(r.ok, /** @type {any} */ (r).error); return /** @type {{ tree: any }} */ (r).tree; };
const UUID = "Compendium.world.talent-sources.Item.abcdefghijklmnop";
const EFFECT = "Compendium.world.talent-sources.Item.abcdefghijklmnop.ActiveEffect.qrstuvwxyzABCDEF";

// ---------------------------------------------------------------- drafts
test("drafts: normalize drops bad drafts and mismatched keys, caps the count (newest kept)", () => {
  assert.deepEqual(D.normalizeDrafts(null), { v: 1, drafts: {} });
  assert.deepEqual(D.normalizeDrafts("x"), { v: 1, drafts: {} });
  const s = D.normalizeDrafts({ drafts: { alpha: { tree: tiered(), base: "h", savedAt: 5 }, wrong: { tree: tiered(), savedAt: 1 }, bad: { tree: {} }, junk: 3 } });
  assert.deepEqual(Object.keys(s.drafts), ["alpha"]);
  assert.equal(s.drafts.alpha.base, "h"); assert.equal(s.drafts.alpha.savedAt, 5);
  const many = { drafts: Object.fromEntries(Array.from({ length: D.DRAFTS_MAX + 5 }, (_, i) => [`t${i}`, { tree: { id: `t${i}` }, savedAt: i + 1 }])) };
  const c = D.normalizeDrafts(many);
  assert.equal(Object.keys(c.drafts).length, D.DRAFTS_MAX);
  assert.ok(c.drafts[`t${D.DRAFTS_MAX + 4}`] && !c.drafts.t0, "the oldest saved go first");
});

test("drafts: withDraft keeps the base it started from; withoutDraft; states and the tree list", () => {
  const pub = tiered();
  let s = D.withDraft(null, pub, { published: pub, at: 10 });
  assert.equal(s.drafts.alpha.base, D.treeHash(pub));
  assert.equal(D.draftState(s.drafts.alpha, pub).state, "same");
  const changed = ok(E.updateNode(pub, "a1", { name: "Renamed" }));
  s = D.withDraft(s, changed, { published: changed, at: 20 });
  assert.equal(s.drafts.alpha.base, D.treeHash(pub), "the base stays the original published tree");
  assert.deepEqual(D.draftState(s.drafts.alpha, pub), { state: "differs", stale: false, label: "Draft differs from published" });
  const other = ok(E.updateNode(pub, "a2", { name: "Elsewhere" }));
  assert.equal(D.draftState(s.drafts.alpha, other).stale, true, "the published tree changed since the draft started");
  assert.equal(D.draftState(null, pub).state, "published");
  assert.equal(D.draftState(s.drafts.alpha, null).state, "new");
  s = D.withDraft(s, ok(E.newTree("Second", ["alpha"])), { at: 30 });
  const list = D.treeList([pub], s);
  assert.deepEqual(list.map(t => [t.id, t.state]), [["alpha", "differs"], ["second", "new"]]);
  assert.match(D.draftLines([pub], s)[0].text, /^2 drafts aren't published yet: Alpha, Second\./);
  assert.equal(D.draftLines([pub], D.withoutDraft(D.withoutDraft(s, "alpha"), "second"))[0].level, "ok");
  assert.equal(D.withDraft(null, { name: "no id" }).drafts && Object.keys(D.withDraft(null, { name: "no id" }).drafts).length, 0);
});

test("drafts: change summary against the published tree", () => {
  const pub = tiered();
  let t = ok(E.deleteNode(pub, "c1"));
  t = ok(E.updateNode(t, "a1", { text: "New text" }));
  const r = E.placeNode(t, { tier: 2, col: 2 }, null); t = ok(r);
  const ch = D.changeSummary(t, pub);
  assert.deepEqual(ch.added, ["New talent"]);
  assert.deepEqual(ch.removed, [{ id: "c1", name: "Node C1" }]);
  assert.deepEqual(ch.changed, ["Node A1"]);
  assert.equal(ch.settings, false);
  assert.equal(D.changeSummary(ok(E.setTreeFields(pub, { name: "Alpha 2" })), pub).settings, true);
  assert.equal(D.changeSummary(pub, null).added.length, 5);
});

test("drafts store on core's fakes: GM saves and discards, players read nothing, cleanup removes it", async () => {
  const world = fakeWorld({ users: [{ name: "GM", isGM: true }, { name: "Pat" }], modules: [{ id: "wanderers-path" }] });
  const [gm, player] = world.users.contents;
  const restore = installFakes(world, gm);
  try {
    const Drafts = await import("../scripts/drafts.mjs");
    await Drafts.save(tiered(), null);
    const j = Drafts.Store.entry();
    assert.equal(j.name, Drafts.STORE_NAME);
    assert.equal(j.getFlag("wanderers-path", "draftsEntry"), true);
    assert.deepEqual(Object.keys(Drafts.read().drafts), ["alpha"]);
    await Drafts.discard("alpha");
    assert.deepEqual(Drafts.read().drafts, {}, "a removed draft key is deleted, not merged back");
    await Drafts.save(tiered(), null);
    const { actAs } = await import("../vendor/wanderers-core/testing/index.mjs");
    actAs(world, player);
    assert.deepEqual(Drafts.read().drafts, {}, "players read nothing");
    await assert.rejects(Drafts.save(tiered(), null));
    actAs(world, gm);
    assert.equal(await Drafts.remove(), 1);
    assert.equal(Drafts.Store.entry(), null);
  } finally { restore(); }
});

// ---------------------------------------------------------------- editing
test("editor: new tree, duplicate, unique ids, tree fields and assignment", () => {
  const t = ok(E.newTree("  Example Tree ", ["example-tree"]));
  assert.equal(t.id, "example-tree-2"); assert.equal(t.name, "Example Tree"); assert.equal(t.layout, "tiered"); assert.equal(t.tiered.tiers, 3);
  assert.equal(E.newTree("  ", []).ok, false);
  const d = ok(E.duplicateTree(tiered(), ["alpha"]));
  assert.equal(d.id, "alpha-copy"); assert.equal(d.nodes.length, 5);
  assert.equal(E.uniqueId("???", []), "talent");
  let s = ok(E.setTreeFields(t, { name: "X", columns: "4", tierSize: "3", tiers: "5", unlockLevel: "0", enabled: false, layout: "board", img: " i.png " }));
  assert.deepEqual([s.name, s.tiered.columns, s.tiered.tierSize, s.tiered.tiers, s.unlockLevel, s.enabled, s.layout, s.img], ["X", 4, 3, 5, null, false, "board", "i.png"]);
  s = ok(E.setTreeFields(s, { unlockLevel: "7", columns: "x" }));
  assert.equal(s.unlockLevel, 7); assert.equal(s.tiered.columns, 4, "bad numbers keep the old value");
  assert.equal(E.setTreeFields(t, { name: "" }).ok, false);
  const full = tiered();
  assert.match(/** @type {any} */ (E.setTreeFields(full, { columns: 2 })).error, /column 3/);
  assert.match(/** @type {any} */ (E.setTreeFields(full, { tiers: 2 })).error, /tier 3/);
  s = ok(E.addAssign(t, "classes", "Fighter"));
  s = ok(E.addAssign(s, "classes", "fighter"));
  assert.deepEqual(s.assign.classes, ["fighter"]);
  assert.equal(E.addAssign(s, "classes", "bad id").ok, false);
  assert.deepEqual(ok(E.removeAssign(s, "classes", "fighter")).assign.classes, []);
  assert.equal(ok(E.addTier(t)).tiered.tiers, 4);
  assert.equal(E.removeTier(ok(E.setTreeFields(t, { tiers: 1 }))).ok, false);
});

test("editor: placing talents in slots, from dropped documents or blank; moving and swapping", () => {
  const t0 = ok(E.newTree("T", []));
  assert.deepEqual(E.readCell("2:1"), { tier: 2, col: 1 }); assert.equal(E.readCell("x"), null); assert.equal(E.readCell("1:2:3"), null);
  const doc = E.readDropped({ uuid: UUID, documentName: "Item", name: "Iron Hide", img: "a.png", type: "feat" });
  assert.ok(doc);
  const r = E.placeNode(t0, { tier: 0, col: 1 }, doc);
  const t1 = ok(r);
  assert.equal(r.ok && r.id, "iron-hide");
  assert.deepEqual(t1.nodes[0].grant, { mode: "item", perRank: "scale", ranks: [{ uuid: UUID }] });
  assert.equal(t1.nodes[0].img, "a.png");
  const fx = E.readDropped({ uuid: EFFECT, name: "Glow" });
  assert.equal(fx?.documentName, "ActiveEffect");
  const t2 = ok(E.placeNode(t1, { tier: 1, col: 0 }, fx));
  assert.equal(t2.nodes[1].grant.mode, "effect");
  assert.equal(E.placeNode(t2, { tier: 0, col: 1 }, null).ok, false, "taken spot");
  assert.equal(E.placeNode(t2, { tier: 9, col: 0 }, null).ok, false, "outside the grid");
  const t3 = ok(E.placeNode(t2, { tier: 2, col: 2 }, null));
  assert.equal(t3.nodes[2].name, "New talent"); assert.equal(t3.nodes[2].grant.mode, "none");
  assert.equal(E.readDropped({ uuid: "Scene.abc" }), null);
  assert.equal(E.readDropped(null), null);
  // Move to an empty spot, then onto a taken one (swap).
  const m1 = ok(E.moveNode(t3, "iron-hide", { tier: 0, col: 0 }));
  assert.deepEqual([m1.nodes[0].tier, m1.nodes[0].col], [0, 0]);
  const m2 = ok(E.moveNode(m1, "iron-hide", { tier: 1, col: 0 }));
  const byId = Object.fromEntries(m2.nodes.map((/** @type {any} */ n) => [n.id, [n.tier, n.col]]));
  assert.deepEqual(byId["iron-hide"], [1, 0]); assert.deepEqual(byId.glow, [0, 0]);
  assert.equal(E.moveNode(m2, "nope", { tier: 0, col: 0 }).ok, false);
  assert.equal(t0.nodes.length, 0, "inputs are never changed");
});

test("editor: talent fields, rank slots, scale vs replace", () => {
  let t = tiered();
  t = ok(E.updateNode(t, "a1", { name: "Renamed", text: "Text", maxRanks: "3", cost: "2", keystone: true, gateTreePoints: "4", gateLevel: "0", mode: "item" }));
  const a1 = t.nodes.find((/** @type {any} */ n) => n.id === "a1");
  assert.deepEqual([a1.name, a1.text, a1.maxRanks, a1.cost, a1.keystone, a1.gate, a1.grant.mode], ["Renamed", "Text", 3, 2, true, { treePoints: 4 }, "item"]);
  assert.equal(t.nodes.find((/** @type {any} */ n) => n.id === "b1").prereqs[0].ranks, 3, "a requirement follows lowered max ranks");
  assert.equal(E.updateNode(t, "a1", { name: " " }).ok, false);
  // Tier/column fields (1-based) move the talent.
  const mv = ok(E.updateNode(t, "a2", { tier: "3", col: "3" }));
  assert.deepEqual(((/** @type {any} */ n) => [n.tier, n.col])(mv.nodes.find((/** @type {any} */ n) => n.id === "a2")), [2, 2]);
  // Slots
  t = ok(E.setRankSlot(t, "a1", 1, { uuid: UUID }));
  assert.equal(E.setRankSlot(t, "a1", 2, { uuid: UUID }).ok, false, "scale talents use slot 1");
  t = ok(E.updateNode(t, "a1", { perRank: "replace" }));
  assert.equal(E.setRankSlot(t, "a1", 3, { uuid: UUID }).ok, false, "fill in order");
  t = ok(E.setRankSlot(t, "a1", 2, { built: { template: "ac", params: {}, base: 1, step: 1 } }));
  t = ok(E.setRankSlot(t, "a1", 3, { uuid: EFFECT }));
  assert.equal(t.nodes.find((/** @type {any} */ n) => n.id === "a1").grant.ranks.length, 3);
  t = ok(E.setRankSlot(t, "a1", 1, null));
  const g = t.nodes.find((/** @type {any} */ n) => n.id === "a1").grant;
  assert.ok("built" in g.ranks[0], "later slots move up");
  assert.equal(E.setRankSlot(t, "a1", 1, { uuid: "not a uuid" }).ok, false);
  t = ok(E.updateNode(t, "a1", { perRank: "scale" }));
  assert.equal(t.nodes.find((/** @type {any} */ n) => n.id === "a1").grant.ranks.length, 1, "back to scale keeps slot 1");
  const none = ok(E.setRankSlot(tiered(), "a2", 1, { uuid: EFFECT }));
  assert.equal(none.nodes.find((/** @type {any} */ n) => n.id === "a2").grant.mode, "effect", "a talent granting nothing takes the dropped type");
});

test("editor: link and unlink requirements, no loops, ranks; exclusions mirrored; delete cleans references", () => {
  let t = tiered();
  const lr = E.toggleLink(t, "c1", "b1", 1);
  t = ok(lr); assert.equal(/** @type {any} */ (lr).linked, true);
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "c1").prereqs, [{ node: "b1", ranks: 1 }]);
  assert.equal(E.toggleLink(t, "a1", "c1").ok, false, "a1 ← b1 ← c1: c1 → a1 would loop");
  assert.equal(E.toggleLink(t, "a1", "a1").ok, false);
  assert.ok(E.requires(t, "c1", "a1"));
  t = ok(E.setPrereqRanks(t, "c1", "b1", "9"));
  assert.equal(t.nodes.find((/** @type {any} */ n) => n.id === "c1").prereqs[0].ranks, 2, "clamped to b1's max ranks");
  const un = E.toggleLink(t, "c1", "b1"); t = ok(un);
  assert.equal(/** @type {any} */ (un).linked, false);
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "c1").prereqs, []);
  // Exclusions
  t = ok(E.toggleExclude(t, "a2", "c1"));
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "c1").excludes, ["a2"]);
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "a2").excludes, ["c1"]);
  assert.equal(E.toggleExclude(t, "b1", "a1").ok, false, "linked by a requirement");
  t = ok(E.toggleExclude(t, "c1", "a2"));
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "a2").excludes, []);
  // Linking two exclusive talents drops the exclusion.
  t = ok(E.toggleLink(ok(E.toggleExclude(t, "a2", "c1")), "c1", "a2"));
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "c1").excludes, []);
  // Delete a1: b1's requirement on it goes; b2 ⟂ b1 survives; deleting b1 clears b2's exclusion.
  t = ok(E.deleteNode(tiered(), "a1"));
  assert.equal(t.nodes.length, 4);
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "b1").prereqs, []);
  t = ok(E.deleteNode(t, "b1"));
  assert.deepEqual(t.nodes.find((/** @type {any} */ n) => n.id === "b2").excludes, []);
  assert.equal(E.deleteNode(t, "nope").ok, false);
});

test("editor: undo history keeps the last 20 states", () => {
  let h = E.emptyHistory();
  assert.equal(E.undoHistory(h), null);
  let t = tiered();
  for (let i = 0; i < 25; i++) { h = E.pushHistory(h, t); t = ok(E.updateNode(t, "a1", { name: `N${i}` })); }
  assert.equal(h.past.length, E.HISTORY_MAX);
  const u = /** @type {any} */ (E.undoHistory(h));
  assert.equal(u.tree.nodes[0].name, "N23", "the state before the last edit");
  assert.equal(u.history.past.length, E.HISTORY_MAX - 1);
  // Snapshots are copies: changing the working copy later doesn't change the history.
  const h2 = E.pushHistory(E.emptyHistory(), t); t.nodes[0].name = "changed in place";
  assert.notEqual(h2.past[0].nodes[0].name, "changed in place");
});

// ---------------------------------------------------------------- publish
test("publish plan: errors block, warnings don't; built slot problems count", () => {
  const good = tiered();
  const p = E.publishPlan(good);
  assert.equal(p.ok, true);
  const warned = E.publishPlan(ok(E.updateNode(good, "a2", { mode: "item" })));
  assert.equal(warned.ok, true, "a warning doesn't block");
  assert.ok(warned.warnings.some(w => /grants nothing yet/.test(w.text) && w.node === "a2"));
  // A loop is an error.
  const loop = normalizeTree({ ...good, nodes: good.nodes.map((/** @type {any} */ n) => (n.id === "a1" ? { ...n, prereqs: [{ node: "b1", ranks: 1 }] } : n)) });
  const pl = E.publishPlan(loop);
  assert.equal(pl.ok, false);
  assert.ok(pl.errors.some(e => /require each other/.test(e.text)));
  assert.equal(pl.errors.filter(e => e.node).length >= 1, true);
  // A missing document (has → false) blocks; unknown (undefined) doesn't.
  const linked = ok(E.setRankSlot(ok(E.updateNode(good, "a1", { mode: "item" })), "a1", 1, { uuid: UUID }));
  assert.equal(E.publishPlan(linked, { has: () => false }).ok, false);
  assert.equal(E.publishPlan(linked, { has: () => undefined }).ok, true);
  // Built slots: a bad spec and an item-only template on an effect talent.
  const bad = ok(E.setRankSlot(ok(E.updateNode(good, "a2", { mode: "effect" })), "a2", 1, { built: { template: "nope" } }));
  assert.equal(E.publishPlan(bad).ok, false);
  const itemOnly = ok(E.setRankSlot(ok(E.updateNode(good, "a2", { mode: "effect" })), "a2", 1, { built: { template: "describe", params: {}, base: 1, step: 0 } }));
  const io = E.publishPlan(itemOnly);
  assert.equal(io.ok, false); assert.ok(io.errors.some(e => /makes a feature item/.test(e.text)));
  // Errors line up with treeIssues' "bad" lines.
  assert.equal(pl.errors.length, treeIssues(loop).filter(i => i.level === "bad").length);
  assert.equal(E.publishPlan({}).ok, false, "no id: never publishable");
});

test("publish: the readable page lists tiers and talents, escaped", () => {
  const t = ok(E.updateNode(tiered(), "a1", { name: "<b>Bold</b>", text: "x < y & z" }));
  const html = E.treePageHTML(t);
  assert.doesNotMatch(html, /<b>Bold/);
  assert.match(html, /&lt;b&gt;Bold&lt;\/b&gt;/); assert.match(html, /x &lt; y &amp; z/);
  assert.match(html, /<h2>Tier 2 \(5 points in the tree\)<\/h2>/);
  assert.match(html, /Needs &lt;b&gt;Bold&lt;\/b&gt; 5\/5\./);
  assert.match(html, /For: fighter\./);
  assert.match(E.treePageHTML(ok(E.newTree("Empty", []))), /No talents yet/);
});

test("class choices from index entries: identifiers, slug fallback, once each, sorted", () => {
  const c = E.classChoices([
    { type: "class", name: "Wizard", system: { identifier: "wizard" } }, { type: "class", name: "Fighter" }, { type: "class", name: "Fighter copy", system: { identifier: "fighter" } },
    { type: "subclass", name: "Path of Example", system: { identifier: "example" } }, { type: "feat", name: "X" }, null
  ]);
  assert.deepEqual(c.classes, [{ id: "fighter", name: "Fighter" }, { id: "wizard", name: "Wizard" }]);
  assert.deepEqual(c.subclasses, [{ id: "example", name: "Path of Example" }]);
});

// ---------------------------------------------------------------- view
/** @param {Partial<import("../scripts/editor-view-model.mjs").EditorFacts>} o */
const facts = (o = {}) => ({
  list: D.treeList([tiered()], D.emptyDrafts()), tree: tiered(), status: { state: "published", label: "Published", stale: false }, dirty: false, canUndo: false,
  selected: null, linkMode: false, sources: [], search: "", labels: {}, classes: { classes: [{ id: "fighter", name: "Fighter" }], subclasses: [] },
  plan: { errors: [], warnings: [] }, builder: true, packName: "Talent trees", packLocked: false, busy: false, ...o
});

test("editor view: three columns, slots and nodes, every data-action has a handler", () => {
  const html = V.editorHTML(/** @type {any} */ (facts()));
  assert.match(html, /class="wp-ed-left"[\s\S]*class="wp-ed-main"[\s\S]*class="wp-ed-insp"/);
  assert.equal((html.match(/data-action="selectNode"/g) ?? []).length, 5);
  assert.equal((html.match(/data-action="addNode"/g) ?? []).length, 3 * 3 - 5, "every empty spot is a slot");
  assert.match(html, /<h3>Tree settings<\/h3>/);
  const sel = V.editorHTML(/** @type {any} */ (facts({ tree: ok(E.updateNode(tiered(), "b1", { mode: "item" })), selected: "b1", linkMode: true, dirty: true, canUndo: true })));
  assert.match(sel, /<h3>Talent<\/h3>/);
  assert.match(sel, /class="wp-node wp-ed-node[^"]*wp-sel/);
  assert.match(sel, /wp-req[^>]*data-node="a1"/, "the requirement is marked in link mode");
  assert.match(sel, /Unsaved changes/);
  assert.match(sel, /name="req\.a1" value="5"/);
  assert.match(sel, /data-action="buildSlot" data-slot="1"/);
  const actions = new Set([...html.matchAll(/data-action="([^"]+)"/g), ...sel.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
  const ed = src("scripts/editor.mjs");
  for (const a of actions) assert.match(ed, new RegExp(`\\b${a}: EditorWindow\\.#on`), `action ${a} has a handler`);
  for (const f of [...html.matchAll(/name="([^"]+)"/g), ...sel.matchAll(/name="([^"]+)"/g)].map(m => m[1])) assert.ok(V.readFieldName(f), `field ${f} is read`);
});

test("editor view: names escaped, tooltips plain text, publish disabled on errors, board placeholder", () => {
  const t = ok(E.updateNode(tiered(), "a1", { name: "<img src=x onerror=alert(1)>" }));
  const html = V.editorHTML(/** @type {any} */ (facts({ tree: t, selected: "a1", plan: { errors: [{ node: "a1", text: "Bad <thing>" }], warnings: [] }, sources: [{ uuid: UUID, name: "<script>", img: "", type: "feat", documentName: "Item", from: "World" }] })));
  assert.doesNotMatch(html, /<img src=x|<script>|Bad <thing>/);
  assert.doesNotMatch(html, /data-tooltip="/, "only data-tooltip-text");
  assert.match(html, /data-action="publish"[^>]*disabled/);
  assert.match(html, /wp-ed-node[^"]*wp-bad/);
  assert.match(V.editorHTML(/** @type {any} */ (facts({ tree: ok(E.setTreeFields(tiered(), { layout: "board" })) }))), /Board editing comes later/);
  assert.match(V.editorHTML(/** @type {any} */ (facts({ tree: null }))), /Choose a tree on the left/);
  assert.match(V.editorHTML(/** @type {any} */ (facts())), /data-action="publish"(?![^>]*disabled)/);
});

test("editor view: document search and field names", () => {
  const docs = [{ name: "Iron Hide", type: "feat" }, { name: "Quick Hands", type: "feat" }, { name: "Ember", type: "spell" }];
  assert.deepEqual(V.searchDocs(docs, "iron").map(d => d.name), ["Iron Hide"]);
  assert.deepEqual(V.searchDocs(docs, "feat q").map(d => d.name), ["Quick Hands"]);
  assert.equal(V.searchDocs(docs, "").length, 3);
  assert.equal(V.searchDocs(docs, "", 2).length, 2);
  assert.deepEqual(V.readFieldName("node.maxRanks"), { scope: "node", key: "maxRanks" });
  assert.deepEqual(V.readFieldName("addReq"), { scope: "addReq", key: "" });
  for (const bad of ["x", "node.", "node.a b", 3, null]) assert.equal(V.readFieldName(bad), null);
  assert.match(V.sourcesHTML({ sources: [], search: "zz" }), /Nothing matches/);
});

test("builder in the editor: fixed tree, talent and slot; Use for this rank", () => {
  const trees = [tiered()];
  const s = buildState({ tree: "alpha", node: "a1", slot: 1, template: "ac" }, trees);
  const html = builderHTML(s, trees, { supported: true, fixed: true });
  assert.doesNotMatch(html, /name="tree"|name="node"|name="slot"/);
  assert.match(html, /Alpha › Node A1 · all 5 ranks/);
  assert.match(html, /Use for this rank/);
  assert.match(builderHTML(s, [], { supported: true, fixed: true }), /Open the tree editor/);
});

// ---------------------------------------------------------------- enabled
test("tree enabled (0.6.0): missing = on; off hides the tree except for characters with ranks, who keep it locked", () => {
  assert.equal(normalizeTree({ id: "t" }).enabled, true);
  assert.equal(normalizeTree({ id: "t", enabled: false }).enabled, false);
  const off = normalizeTree({ ...tiered(), enabled: false });
  const base = { trees: [off], classes: ["fighter"], level: 5, rules: DEFAULT_RULES };
  assert.deepEqual(treesFor({ ...base, picks: emptyPicks() }).trees, []);
  const picks = { ...emptyPicks(), ranks: { alpha: { a1: 2 } } };
  const seen = treesFor({ ...base, picks }).trees;
  assert.equal(seen.length, 1); assert.equal(seen[0].unlocked, false); assert.match(seen[0].reason, /turned this tree off/);
});

// ---------------------------------------------------------------- house
test("house: the editor is GM only, feature gated, remembered; the builder opens through it", () => {
  const ed = src("scripts/editor.mjs");
  assert.match(ed, /RememberedWindow\(ApplicationV2, \{ moduleId: ID, key: EDITOR_KEY \}\)/);
  assert.match(ed, /export const EDITOR_KEY = "editor"/);
  assert.match(ed, /export function openEditor[\s\S]*?if \(!game\.user\?\.isGM\)[\s\S]*?if \(!F\.on\("editor"\)\)/);
  assert.match(ed, /classes: \["wp-window", "wp-path-window", "wp-editor-window", \.\.\.UI_CLASSES\]/);
  assert.doesNotMatch(ed, /fromUuid\([^)]*\)\s*\)/, "no nested fromUuid");
  assert.equal((ed.match(/await fromUuid\(/g) ?? []).length, 1, "one load per drop, nowhere else");
  assert.match(ed, /if \(relock\) \{ try \{ await p\.configure\(\{ locked: true \}\)/, "a locked pack is locked again");
  const m = src("scripts/main.mjs");
  assert.match(m, /get editor\(\) \{\s*if \(!F\.on\("editor"\)\) return undefined;/);
  assert.match(m, /open: \(\/\*\* @type \{string \| undefined\} \*\/ treeId, [^)]*\) => Editor\.openEditor/, "api.builder.open opens the editor");
  assert.match(m, /hideDataFolder\(ID, \{ shown: \(\) => S\.get\("showModuleData"\) === true \}\)/);
  assert.match(m, /if \(F\.on\("editor"\)\) leader\.settled\(\)\.then\(\(\) => \{ if \(leader\.isLeader\(\)\) Drafts\.file\(\); \}\)/);
  assert.match(src("scripts/settings-window.mjs"), /F\.on\("editor"\)[\s\S]*?data-action="editor"/);
  assert.match(src("scripts/health.mjs"), /if \(F\.on\("editor"\)\) await c\.checkAsync\("Drafts"/);
  // Drafts store: GM-only journal on core's createStore, filed by the leader, removed by cleanup.
  const dr = src("scripts/drafts.mjs");
  assert.match(dr, /createStore\(ID, \{[\s\S]*?flagKey: DRAFTS_FLAG, entryFlag: ENTRY_FLAG, normalize: normalizeDrafts/);
  for (const f of scripts) if (f !== "drafts.mjs") assert.doesNotMatch(src(`scripts/${f}`), /createStore\(/, f);
});

test("0.6.0: version, changelog, docs", () => {
  const m = JSON.parse(src("module.json"));
  assert.equal(m.version, "0.6.0");
  assert.equal(m.download, "https://github.com/cocoomg11/wanderers-path/releases/download/v0.6.0/module.zip");
  assert.match(src("CHANGELOG.md"), /^## 0\.6\.0$[\s\S]*?### Untested in Foundry/m);
  const docs = src("docs/trees.md");
  for (const h of ["## 1. The tree compendium", "## 2. The tree editor", "## 3. Linking items and effects", "## 4. Build a talent effect", "## 5. Who gets a tree", "## 6. Points", "## 7. Refunds and respec", "## Troubleshooting", "## Appendix: a tree's data"]) assert.ok(docs.includes(h), h);
  const readme = src("README.md");
  assert.match(readme, /`editor`/);
  assert.match(readme, /tree editor/i);
});
