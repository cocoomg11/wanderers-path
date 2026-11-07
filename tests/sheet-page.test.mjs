import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPageHost, readPageDef, renderGuest } from "../vendor/wanderers-core/index.mjs";
import * as SP from "../scripts/sheet-page-model.mjs";
import * as P from "../scripts/picks-model.mjs";
import { tiered, board } from "./_fixtures.mjs";

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const rules = P.readRules({});

const facts = (over = {}) => {
  const t = tiered();
  t.nodes[0].grant = { mode: "effect", perRank: "scale", ranks: [{ built: { template: "ac", base: 1, step: 1 } }] };
  t.nodes[1].name = "<script>x</script>";
  t.nodes[1].grant = { mode: "item", perRank: "scale", ranks: [{ uuid: "Compendium.world.f.Item.aaaaaaaaaaaaaaaa" }] };
  const trees = [t, board()];
  const picks = P.normalizePicks({ v: 1, trees: { add: ["beta"] }, ranks: { alpha: { a1: 3, a2: 1 } }, log: [{ id: "1", at: 1, by: "GM<", kind: "learn", text: "Learned <i>it</i>" }] });
  const seen = P.treesFor({ trees, picks, classes: ["fighter"], level: 6, rules });
  return { actor: { id: "a", name: "Hero", level: 6 }, picks, allTrees: trees, seen, rules, ...over };
};

test("our page definition passes core's guest checks and sorts between Reputation and Bastion", async () => {
  const def = SP.pageDef({ render: () => "<p>x</p>", activate: () => {}, visible: () => true });
  const r = readPageDef(def);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual([def.id, def.label, def.order], ["wanderers-path.talents", "Talents", 77]);
  assert.equal(r.page.fa, "fa-solid fa-route");
  const host = createPageHost({ hostId: "host", builtIn: [{ id: "reputation", order: 75 }, { id: "bastion", order: 80 }] });
  assert.notEqual(host.register(def).ok, false);
  assert.deepEqual(host.pages({}).map(p => p.id), ["reputation", "wanderers-path.talents", "bastion"]);
  assert.deepEqual(await renderGuest(host.get(def.id), { actor: {} }), { html: "<p>x</p>" });
  const hidden = createPageHost({ hostId: "host" }); hidden.register(SP.pageDef({ render: () => "", visible: () => false }));
  assert.deepEqual(hidden.pages({}).map(p => p.id), []);
});

test("visible only with talents on and a tree assigned", () => {
  const f = facts();
  assert.equal(SP.pageVisible(f.seen), true);
  assert.equal(SP.pageVisible(P.treesFor({ trees: f.allTrees, picks: P.normalizePicks({}), classes: ["wizard"], level: 5, rules })), false);
  assert.equal(SP.pageVisible(P.treesFor({ trees: f.allTrees, picks: P.normalizePicks({ v: 1, enabled: false }), classes: ["fighter"], level: 5, rules })), false);
  assert.equal(SP.pageVisible(null), false);
});

test("page model: points, spent per tree, mini preview, active from talents, recent log", () => {
  const m = SP.pageModel(facts());
  assert.deepEqual([m.points.available, m.points.spent], [1, 4]);
  assert.deepEqual(m.trees.map(t => [t.id, t.spent]), [["alpha", 4], ["beta", 0]]);
  assert.equal(m.current, "alpha");
  assert.equal(m.mini.cells.length, 5);
  assert.deepEqual(m.mini.cells.find(c => c.name === "Node A1"), { x: 0, y: 0, state: "partial", name: "Node A1", rank: 3, max: 5 });
  assert.deepEqual(m.active.map(a => [a.name, a.rank, a.text]), [["Node A1", 3, "+3 AC"], ["<script>x</script>", 1, ""]]);
  assert.equal(m.log.length, 1);
  assert.equal(SP.pageModel(facts({ current: "beta" })).board, true);
});

test("page HTML: escaped, data-wp-act only, never the sheet's data-action / data-name / data-drop", () => {
  const html = SP.pageHTML(SP.pageModel(facts()));
  assert.ok(html.startsWith(`<div class="wp-page">`));
  assert.ok(!/data-action=|data-name=|data-drop/.test(html), "guest contract");
  assert.ok(html.includes(`data-wp-act="open"`) && html.includes(`data-wp-act="tree" data-tree="beta"`));
  assert.ok(!html.includes("<script>") && !html.includes("<i>it</i>") && html.includes("&lt;script&gt;"));
  assert.match(html, /Open full window/);
  assert.match(html, /\+3 AC/);
  const off = SP.pageHTML(SP.pageModel(facts({ seen: { enabled: false, reason: "Off <b>", trees: [], orphans: [] } })));
  assert.ok(off.includes("Off &lt;b&gt;") && !off.includes("data-action"));
  assert.match(SP.pageHTML(SP.pageModel(facts({ current: "beta" }))), /board layout/);
});

test("page clicks: only data-wp-act buttons, disabled ones ignored", () => {
  const btn = (ds, disabled = false) => ({ disabled, dataset: ds });
  const target = b => ({ closest: sel => (sel === "[data-wp-act]" ? b : null) });
  assert.deepEqual(SP.pageClick(target(btn({ wpAct: "tree", tree: "beta" }))), { act: "tree", tree: "beta" });
  assert.equal(SP.pageClick(target(null)), null);
  assert.equal(SP.pageClick(target(btn({ wpAct: "open" }, true))), null);
  assert.equal(SP.pageClick(null), null);
});

test("health line for the sheet page", () => {
  assert.equal(SP.pageStatus({ feature: false, toolkit: "active", sheet: true }).level, "off");
  assert.match(SP.pageStatus({ feature: true, toolkit: "missing", sheet: false }).text, /isn't active/);
  assert.match(SP.pageStatus({ feature: true, toolkit: "active", toolkitVersion: "2.2.0", sheet: false }).text, /2\.3\.0/);
  assert.equal(SP.pageStatus({ feature: true, toolkit: "active", sheet: true, result: null }).level, "warn");
  assert.match(SP.pageStatus({ feature: true, toolkit: "active", sheet: true, result: { ok: false, reason: "bad id" } }).text, /bad id/);
  assert.equal(SP.pageStatus({ feature: true, toolkit: "active", sheet: true, result: { ok: true } }).level, "ok");
});

test("the page registers at ready and on the toolkit's sheetReady hook, through the public API only", () => {
  const s = src("scripts/sheet-page.mjs");
  assert.ok(s.includes("Hooks.once(SHEET_READY") && s.includes("`${TOOLKIT_ID}.sheetReady`") && s.includes("api?.sheet"));
  assert.ok(!/flags\.wayfarers-toolkit|setFlag|\.update\(/.test(s));
  assert.match(src("scripts/main.mjs"), /if \(F\.on\("toolkitPage"\)\) SheetPage\.ready\(\)/);
  assert.match(src("scripts/const.mjs"), /TOOLKIT_ID = "wayfarers-toolkit"/);
  const m = JSON.parse(src("module.json"));
  assert.ok(m.relationships.recommends.some(r => r.id === "wayfarers-toolkit") && !m.relationships.requires);
});
