import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as V from "../scripts/view-model.mjs";
import * as P from "../scripts/picks-model.mjs";
import { normalizeTree } from "../scripts/tree-model.mjs";
import { REQUESTS, DONE_HOOK, TICKET_RE, readDone, maySend } from "../scripts/requests-model.mjs";
import { readRequest, makeRequest } from "../vendor/wanderers-core/index.mjs";

const src = (/** @type {string} */ f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");

/** A tiered tree whose nodes reach tier 2 (tierSize 3). @param {any} [extra] */
const shallow = (extra = {}) => normalizeTree({ v: 1, id: "t", name: "T", layout: "tiered", assign: { classes: ["fighter"] }, tiered: { columns: 3, tierSize: 3, ...extra }, nodes: [
  { id: "a", tier: 0, col: 0, maxRanks: 3 }, { id: "b", tier: 1, col: 0, maxRanks: 3 }, { id: "c", tier: 2, col: 0, maxRanks: 1 }
] });

/** @param {any} tree @param {Record<string, number>} ranks */
const model = (tree, ranks) => V.viewModel(factsOf(tree, ranks));
/** @param {any} tree @param {Record<string, number>} ranks @returns {any} */
function factsOf(tree, ranks) {
  const rules = P.readRules({}); const picks = { ...P.emptyPicks(), ranks: { t: ranks } };
  const seen = P.treesFor({ trees: [tree], picks, classes: ["fighter"], level: 20, rules });
  return ({ actor: { id: "actor00000000001", name: "Hero", level: 20 }, isGM: false, canEdit: true, respec: false, gmConnected: true,
    rules, picks, pending: structuredClone(picks.ranks), seen, allTrees: [tree], current: null, packSet: true });
}

test("tiers: no explicit tiers = up to the highest tier used; explicit tiers kept as given", () => {
  assert.equal(shallow().tiered.tiers, 3, "nodes reach tier 2: three rows");
  assert.equal(normalizeTree({ id: "e", nodes: [] }).tiered.tiers, 1, "an empty tree has one row");
  assert.equal(shallow({ tiers: 6 }).tiered.tiers, 6, "explicit tiers kept");
  assert.equal(shallow({ tiers: 1 }).tiered.tiers, 3, "explicit tiers still raised to hold every node");
});

test("progress: next tier only while one exists, then All tiers open", () => {
  const m = model(shallow(), { a: 3 });
  assert.equal(m.tiers.length, 3); assert.equal(m.next, 6);
  const done = model(shallow(), { a: 3, b: 3 });
  assert.equal(done.next, null, "6 points open tier 2, the last one");
  assert.equal(done.progress, 100);
  const html = V.windowHTML(factsOf(shallow(), { a: 3, b: 3 }));
  assert.match(html, /All tiers open\./); assert.doesNotMatch(html, /Next tier opens/);
  assert.match(V.windowHTML(factsOf(shallow(), { a: 3 })), /Next tier opens at <b>6<\/b>/);
  assert.doesNotMatch(src("view-model.mjs"), /Every tier is open/);
});

test("done signal: tickets on GM-wide requests, read back from the hook", () => {
  assert.equal(DONE_HOOK, "wanderers-path.done");
  const ok = readRequest(REQUESTS, makeRequest(REQUESTS, "pathRefresh", "u1-1", { ticket: "abcDEF0123456789" }));
  assert.equal(ok.ok, true);
  assert.equal(readRequest(REQUESTS, makeRequest(REQUESTS, "pathOrphans", "u1-2", {})).ok, true, "ticket optional");
  assert.throws(() => makeRequest(REQUESTS, "pathRefresh", "u1-3", { ticket: "bad ticket!" }));
  assert.equal(readDone({ ticket: "abcDEF0123456789" }), "abcDEF0123456789");
  for (const p of [null, 3, {}, { ticket: "x" }, { ticket: "<b>no</b>" }]) assert.equal(readDone(p), "");
  assert.ok(TICKET_RE.test("abcdefgh"));
  assert.match(src("core.mjs"), /hooks: \[NOTICE_HOOK, DONE_HOOK/);
  const path = src("path.mjs");
  assert.match(path, /leader\.handle\("pathRefresh", answered\(onRefresh\)\)/);
  assert.match(path, /leader\.handle\("pathOrphans", answered\(onOrphans\)\)/);
  assert.match(path, /finally \{ if \(readDone\(data\)\)/, "the answer comes after the handler, refusals included");
  assert.match(path, /setTimeout\([^]*resolve\("timeout"\)/);
  const health = src("health.mjs");
  assert.match(health, /runAndWait\("pathRefresh"/); assert.match(health, /runAndWait\("pathOrphans"/);
  assert.doesNotMatch(health, /run: \(\) => send\(/);
});

test("players: GM-only kinds refused locally; cleanup plan and dry run GM only", () => {
  for (const k of ["pathAward", "pathEnable", "pathTrees", "pathRefresh", "pathOrphans"]) { assert.equal(maySend(k, false), false, k); assert.equal(maySend(k, true), true); }
  for (const k of ["pathLearn", "pathRefund"]) assert.equal(maySend(k, false), true, k);
  assert.match(src("path.mjs"), /if \(!maySend\(kind, !!game\.user\?\.isGM\)\)/);
  const main = src("main.mjs");
  assert.match(main, /plan: \(\) => gmOnly\(/); assert.match(main, /dryRun: \(\) => gmOnly\(/);
});

test("health: granted items kept line when no compendium is chosen", () => {
  assert.match(src("health.mjs"), /else if \(!packId\(\) && granted\) add\("info", "No tree compendium is chosen: granted items are kept/);
});
