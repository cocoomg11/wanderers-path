import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as M from "../scripts/settings-model.mjs";
import * as B from "../scripts/builder-model.mjs";
import * as Cleanup from "../scripts/cleanup.mjs";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const scripts = readdirSync(new URL("../scripts/", import.meta.url)).filter(f => f.endsWith(".mjs"));

const run = async () => "Refresh granted items: done.";
const report = () => [
  { title: "Trees", lines: [{ level: "ok", text: "Tree compendium: <b>T</b>." }] },
  { title: "Characters", lines: [
    { level: "warn", text: "Hero: 1 granted document is out of step.", fix: { label: "Refresh granted items", confirm: "Sure?", run } },
    { level: "info", text: "Satchel-only fix", fix: { label: "X", action: "some.action" } }
  ] }
];

test("settings report: Fix buttons only for lines with a run fix, keyed s:l, escaped", () => {
  const html = M.reportHTML(report());
  assert.match(html, /data-action="fix" data-fix="1:0">Refresh granted items<\/button>/);
  assert.equal((html.match(/data-action="fix"/g) ?? []).length, 1, "an action-id fix has no button here");
  assert.doesNotMatch(html, /<b>T<\/b>/); assert.match(html, /&lt;b&gt;T&lt;\/b&gt;/);
  assert.match(html, /<h4>Characters<\/h4>/);
  const busy = M.reportHTML(report(), { busy: "1:0" });
  assert.match(busy, /data-fix="1:0" disabled>Working…<\/button>/);
  assert.match(M.reportHTML(null), /Not run yet/);
  assert.match(M.reportHTML([]), /Nothing to report/);
});

test("settings report: fixAt finds the fix again; bad keys and stale reports give null", () => {
  const r = report();
  const f = M.fixAt(r, "1:0");
  assert.equal(f?.label, "Refresh granted items"); assert.equal(f?.confirm, "Sure?"); assert.equal(f?.run, run);
  for (const k of ["1:1", "0:0", "9:9", "x", "1:0;", "", null, 3]) assert.equal(M.fixAt(r, k), null, String(k));
  assert.equal(M.fixAt(null, "1:0"), null);
});

test("settings report: fix notices", () => {
  assert.deepEqual(M.fixNotice("Refresh", false), { level: "warn", text: "Refresh: nothing was sent." });
  assert.deepEqual(M.fixNotice("Refresh", "Refresh: sent; the GM client hasn't answered yet."), { level: "info", text: "Refresh: sent; the GM client hasn't answered yet." });
  assert.deepEqual(M.fixNotice("Refresh", true), { level: "info", text: "Refresh: done." });
});

test("settings window: confirm, run, then re-check; GM only", () => {
  const w = src("scripts/settings-window.mjs");
  assert.match(w, /fix: SettingsWindow\.#onFix/);
  assert.match(w, /static async #onFix[\s\S]*?if \(!game\.user\?\.isGM \|\| self\.busy\) return;[\s\S]*?DialogV2\.confirm[\s\S]*?await f\.run\(\)[\s\S]*?self\.report = await Health\.report\(\)/);
  assert.match(src("scripts/health.mjs"), /run: \(\) => runAndWait\("pathRefresh"/);
  assert.match(src("scripts/health.mjs"), /run: \(\) => runAndWait\("pathOrphans"/);
  assert.doesNotMatch(w, /statusLines\(/, "the report goes through reportHTML");
});

test("builder: replaced base/step are reported, valid ones aren't", () => {
  assert.deepEqual(B.specWarnings({ template: "ac", base: 2, step: 1 }), []);
  assert.deepEqual(B.specWarnings({ template: "ac" }), [], "missing = default, said nowhere");
  assert.deepEqual(B.specWarnings({ template: "ac", base: "3", step: "1" }), [], "numeric text is fine");
  const w = B.specWarnings({ template: "ac", base: "x", step: 1.5 });
  assert.equal(w.length, 2);
  assert.match(w[0], /X at rank 1 "x" isn't a number: 1 is used\./);
  assert.match(w[1], /Added per rank 1\.5 isn't a whole number: 2 is used\./);
  assert.deepEqual(B.specWarnings({ template: "advantage", base: "x" }), [], "a template that doesn't scale ignores base");
  assert.deepEqual(B.specWarnings(null), []); assert.deepEqual(B.specWarnings({ template: "nope", base: "x" }), []);
  assert.match(src("scripts/health.mjs"), /for \(const w of specWarnings\(raw\)\) add\("warn"/);
});

test("cleanup covers everything Path writes", () => {
  // Flags: every flags.wanderers-path.<key> written is the picks (actors), the granted tag and built marker (granted documents, deleted
  // with them) or the tree (the GM's own compendium content, listed and kept).
  const keys = new Set();
  for (const f of scripts) {
    const s = src(`scripts/${f}`);
    for (const m of s.matchAll(/flags\.\$\{ID\}\.\$\{([A-Z_]+)\}/g)) keys.add(m[1]);
    for (const m of s.matchAll(/"wanderers-path": \{ (\w+):/g)) keys.add(m[1]);
    for (const m of s.matchAll(/(\w+): tagFor\(/g)) keys.add(m[1]);
  }
  assert.deepEqual([...keys].sort(), ["GRANTED_FLAG", "PICKS_FLAG", "TREE_FLAG", "built", "granted"].sort());
  const c = src("scripts/cleanup.mjs");
  assert.match(c, /unsetFlags\(ID, p\.picks/, "picks: the whole namespace on actors");
  assert.match(c, /t\.delta\?\._source\?\.flags\?\.\[ID\]/, "unlinked tokens' actors too");
  assert.match(c, /existingOf\(a\)/, "granted documents found by tag");
  // Settings: every registered setting of the namespace (rows, feature switches and core's client windowPlacement, which holds the
  // window keys path, settings and builder).
  assert.match(c, /changedSettings\(settingValues\(ID\), \{ scopes: \["world", "client"\] \}\)/);
  const keysUsed = scripts.flatMap(f => [...src(`scripts/${f}`).matchAll(/RememberedWindow\(ApplicationV2, \{ moduleId: ID, key: ([^ }]+) \}/g)].map(m => m[1]));
  assert.deepEqual(keysUsed.sort(), ["BUILDER_KEY", "WINDOW_KEY", "\"settings\""].sort());
  assert.match(src("scripts/main.mjs"), /registerWindowPlacement\(ID\)/);
  assert.ok(Cleanup.CATEGORIES.some(([k, l]) => k === "settings" && /window placements/.test(l)));
  // No other documents: no chat messages, no world items, no journal writes but the builder's tree flag.
  for (const f of scripts) assert.doesNotMatch(src(`scripts/${f}`), /ChatMessage\.(create|implementation)|Item\.create\(|JournalEntry\.create\(|game\.settings\.register\(/, f);
});

test("0.5.0: version, changelog, docs", () => {
  const m = JSON.parse(src("module.json"));
  assert.equal(m.version, "0.5.0");
  assert.match(src("CHANGELOG.md"), /^## 0\.5\.0$[\s\S]*?### Untested in Foundry/m);
  const docs = src("docs/trees.md");
  for (const h of ["## 1. The tree compendium", "## 2. A tree's data", "## 3. Linking items and effects", "## 4. Build a talent effect", "## 5. Who gets a tree", "## 6. Points", "## 7. Refunds and respec", "## Troubleshooting"]) assert.ok(docs.includes(h), h);
  const readme = src("README.md");
  assert.match(readme, /docs\/trees\.md/);
  for (const k of ["version", "isReady", "features", "open(actor?)", "trees()", "points(actor)", "refresh(actor?)", "healthReport", "cleanup", "settings()", "builder", "registerAutomation"]) assert.ok(readme.includes(`\`${k}`), k);
  for (const h of ["wanderers-path.ready", "wanderers-path.learned", "wanderers-path.respec"]) assert.ok(readme.includes(h), h);
});
