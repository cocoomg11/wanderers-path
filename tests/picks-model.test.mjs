import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../scripts/picks-model.mjs";
import { tiered, board } from "./_fixtures.mjs";

const rules = P.readRules({});
const fresh = (over = {}) => ({ ...P.emptyPicks(), ...over });

test("normalizePicks: garbage and old shapes, caps", () => {
  for (const raw of [null, 3, "x", [], { v: 42 }]) assert.deepEqual(P.normalizePicks(raw), P.emptyPicks());
  const p = P.normalizePicks({ enabled: "yes", trees: { add: ["a", "a", "b", "bad id!"], remove: ["b"] },
    ranks: { alpha: { a1: 9, a2: 0, "x!": 2, a3: "2" }, empty: {}, junk: 4 }, awards: [{ n: 2, reason: "r" }, { n: 0 }, "x"], log: "nope" });
  assert.equal(p.v, P.PICKS_VERSION);
  assert.equal(p.enabled, null);
  assert.deepEqual(p.trees, { add: ["a"], remove: ["b"] }, "a removed tree isn't also added");
  assert.deepEqual(p.ranks, { alpha: { a1: 5, a3: 2 } });
  assert.equal(p.awards.length, 1); assert.equal(p.awards[0].n, 2);
  assert.deepEqual(p.log, []);
  assert.deepEqual(P.normalizePicks(p), p, "round trip");
});

test("log is capped at 50 (newest first); awards fold instead of being lost", () => {
  let p = P.emptyPicks();
  for (let i = 0; i < P.LOG_MAX + 15; i++) p = P.withLog(p, { at: i, by: "u", kind: "learn", text: `t${i}` });
  assert.equal(p.log.length, P.LOG_MAX);
  assert.equal(p.log[0].text, `t${P.LOG_MAX + 14}`);
  assert.equal(P.normalizePicks({ log: Array.from({ length: 80 }, (_, i) => ({ kind: "x", text: String(i) })) }).log.length, P.LOG_MAX);
  let q = P.emptyPicks();
  for (let i = 0; i < P.AWARDS_MAX + 20; i++) q = P.withAward(q, { id: `a${i}`, n: 1, reason: "r", at: i, by: "g" });
  assert.equal(q.awards.length, P.AWARDS_MAX);
  assert.equal(q.awards.reduce((s, a) => s + a.n, 0), P.AWARDS_MAX + 20, "no point lost");
  assert.equal(q.awards.at(-1)?.id, P.CARRIED);
  assert.equal(P.withAward(q, { id: "z", n: 0, reason: "", at: 0, by: "" }), q, "a zero award changes nothing");
  assert.equal(P.withAward(P.emptyPicks(), { id: "z", n: 999, reason: "", at: 0, by: "" }).awards[0].n, P.AWARD_MAX);
});

test("readRules: defaults and clamps", () => {
  assert.deepEqual(rules, { enabledForAll: true, unlockLevel: 1, pointsFromLevel: 2, pointsPerLevel: 1, playerRespec: false });
  assert.deepEqual(P.readRules({ enabledForAll: false, unlockLevel: 99, pointsFromLevel: 0, pointsPerLevel: "2", playerRespec: true }),
    { enabledForAll: false, unlockLevel: 30, pointsFromLevel: 1, pointsPerLevel: 2, playerRespec: true });
});

test("pointsFor: 1 per level from 2 (19 at 20), awards, orphans counted", () => {
  const t = tiered();
  assert.equal(P.pointsFor({ level: 20, picks: fresh(), trees: [t], rules }).total, 19);
  assert.equal(P.pointsFor({ level: 1, picks: fresh(), trees: [t], rules }).total, 0);
  const p = fresh({ ranks: { alpha: { a1: 3 }, gone: { q: 2 } }, awards: [{ id: "a", n: 2, reason: "", at: 0, by: "" }] });
  const pts = P.pointsFor({ level: 5, picks: p, trees: [t], rules });
  assert.deepEqual({ total: pts.total, spent: pts.spent, available: pts.available, byTree: pts.byTree }, { total: 6, spent: 5, available: 1, byTree: { alpha: 3, gone: 2 } });
  assert.equal(P.pointsFor({ level: 1, picks: fresh({ awards: [{ id: "a", n: -5, reason: "", at: 0, by: "" }] }), trees: [], rules }).total, 0, "never below 0");
});

test("treesFor: class/subclass assignment, manual add/remove, enablement, unlock levels, orphans", () => {
  const a = tiered(); const b = board(); b.assign.subclasses = ["oath"]; b.unlockLevel = 5;
  let r = P.treesFor({ trees: [a, b], picks: fresh(), classes: ["fighter"], level: 3, rules });
  assert.equal(r.enabled, true); assert.deepEqual(r.trees.map(x => x.tree.id), ["alpha"]);
  r = P.treesFor({ trees: [a, b], picks: fresh(), classes: [], subclasses: ["oath"], level: 3, rules });
  assert.deepEqual(r.trees.map(x => [x.tree.id, x.unlocked, x.reason]), [["beta", false, "Talents open at level 5."]]);
  r = P.treesFor({ trees: [a, b], picks: fresh({ trees: { add: ["beta"], remove: ["alpha"] } }), classes: ["fighter"], level: 6, rules });
  assert.deepEqual(r.trees.map(x => [x.tree.id, x.manual]), [["beta", true]]);
  assert.equal(P.treesFor({ trees: [a], picks: fresh(), level: 1, rules: { ...rules, enabledForAll: false } }).enabled, false);
  assert.equal(P.treesFor({ trees: [a], picks: fresh({ enabled: true }), level: 1, rules: { ...rules, enabledForAll: false } }).enabled, true);
  assert.equal(P.treesFor({ trees: [a], picks: fresh({ enabled: false }), level: 1, rules }).enabled, false);
  assert.equal(P.treesFor({ trees: [a], picks: fresh(), classes: ["fighter"], level: 1, rules: { ...rules, unlockLevel: 3 } }).trees[0].unlocked, false);
  assert.deepEqual(P.treesFor({ trees: [a], picks: fresh({ ranks: { gone: { x: 1 } } }), level: 1, rules }).orphans, ["gone"]);
});

test("nodeState, tiered: tier gates count points in this tree, then prereqs, level gates, exclusions", () => {
  const t = tiered(); const n = id => /** @type {any} */ (t.nodes.find(x => x.id === id));
  const st = (id, ranks, level = 20, available = 10) => P.nodeState(t, n(id), { ranks, level, available });
  assert.equal(st("a1", {}).state, "available");
  assert.match(st("b1", { a1: 4 }).reason, /Requires 5 points in Alpha \(4\)/);
  assert.match(st("b1", { a2: 3, a1: 2 }).reason, /Requires 5 points in Node A1/, "tier open, prereq not");
  assert.equal(st("b1", { a1: 5 }).state, "available");
  assert.equal(st("b1", { a1: 5, b1: 1 }).state, "partial");
  assert.equal(st("b1", { a1: 5, b1: 2 }).state, "maxed");
  assert.match(st("b2", { a1: 5, b1: 1 }).reason, /Can't be learned with Node B1/);
  assert.match(st("c1", { a1: 5, a2: 3, b1: 2 }, 9).reason, /character level 10/);
  assert.equal(st("c1", { a1: 5, a2: 3, b1: 2 }, 10).state, "available", "tier 2 opens at 10 points in tiers 0–1");
  const none = st("a1", {}, 20, 0);
  assert.equal(none.canLearn, false); assert.match(none.reason, /No points left/);
  assert.equal(st("a1", {}).canLearn, true);
});

test("nodeState, board: hub first, then connected to a learned node", () => {
  const t = board(); const n = id => /** @type {any} */ (t.nodes.find(x => x.id === id));
  const st = (id, ranks) => P.nodeState(t, n(id), { ranks, level: 20, available: 10 });
  assert.equal(st("h", {}).state, "available");
  assert.match(st("x", {}).reason, /Connect it/);
  assert.equal(st("x", { h: 1 }).state, "available");
  assert.equal(st("y", { h: 1 }).state, "locked");
  assert.equal(st("y", { h: 1, x: 1 }).state, "available");
  assert.equal(st("k", { h: 1, z: 1 }).state, "available", "two ways in");
  assert.equal(st("y", { x: 1 }).state, "locked", "a learned node not reached from the hub doesn't count");
});

test("validatePending: adds only, visible and unlocked trees, rules and pool", () => {
  const t = tiered(); const base = { trees: [t], level: 20, rules, classes: ["fighter"] };
  let v = P.validatePending({ ...base, picks: fresh(), pending: { alpha: { a1: 5, b1: 1 } } });
  assert.equal(v.ok, true); assert.equal(v.cost, 6); assert.deepEqual(v.ranks, { alpha: { a1: 5, b1: 1 } });
  v = P.validatePending({ ...base, picks: fresh(), pending: { alpha: { a1: 2, b1: 1 } } });
  assert.equal(v.ok, false); assert.ok(v.errors.some(e => /Node B1/.test(e)));
  v = P.validatePending({ ...base, level: 3, picks: fresh(), pending: { alpha: { a1: 3 } } });
  assert.ok(v.errors.some(e => /only 2 left/.test(e)), "pool");
  v = P.validatePending({ ...base, picks: fresh({ ranks: { alpha: { a1: 3 } } }), pending: { alpha: { a1: 2 } } });
  assert.ok(v.errors.some(e => /refund/.test(e)));
  v = P.validatePending({ ...base, classes: [], picks: fresh(), pending: { alpha: { a1: 1 } } });
  assert.ok(v.errors.some(e => /isn't one of this character's trees/.test(e)));
  v = P.validatePending({ ...base, rules: { ...rules, unlockLevel: 25 }, picks: fresh(), pending: { alpha: { a1: 1 } } });
  assert.ok(v.errors.some(e => /level 25/.test(e)));
  v = P.validatePending({ ...base, picks: fresh(), pending: {} });
  assert.deepEqual(v.errors, ["Nothing to learn."]);
  v = P.validatePending({ ...base, picks: fresh({ enabled: false }), pending: { alpha: { a1: 1 } } });
  assert.ok(v.errors.some(e => /turned on/.test(e)));
  v = P.validatePending({ ...base, picks: fresh(), pending: /** @type {any} */ ({ alpha: "junk" }) });
  assert.equal(v.ok, false);
});

test("refundPlan: one rank, whole node, whole tree, cascades dependants and higher tiers", () => {
  const t = tiered();
  const ranks = { a1: 5, a2: 3, b1: 2, c1: 1 };
  let r = P.refundPlan(t, ranks, { node: "a2", level: 20 });
  assert.deepEqual(r.ranks, { a1: 5, a2: 2, b1: 2 }, "tier 2 closes (9 < 10): c1 goes");
  assert.equal(r.refund, 2);
  r = P.refundPlan(t, ranks, { node: "a1", level: 20 });
  assert.deepEqual(r.ranks, { a1: 4, a2: 3 }, "b1 loses its prereq, then c1 its tier");
  assert.deepEqual(r.removed.map(x => x.node).sort(), ["a1", "b1", "c1"]);
  r = P.refundPlan(t, ranks, { node: "b1", all: true, level: 20 });
  assert.deepEqual(r.ranks, { a1: 5, a2: 3 });
  r = P.refundPlan(t, ranks, { level: 20 });
  assert.deepEqual(r.ranks, {}); assert.equal(r.refund, 11);
  r = P.refundPlan(t, { a1: 1, ghost: 2 }, { node: "a1", level: 20 });
  assert.deepEqual(r.ranks, {}, "ranks on nodes the tree lost go too");
  const b = board();
  assert.deepEqual(P.refundPlan(b, { h: 1, x: 2, y: 1 }, { node: "h", level: 20 }).ranks, {}, "board: everything cut off from the hub");
  assert.deepEqual(P.refundPlan(t, ranks, { node: "zzz", level: 20 }).removed, [], "unknown node: nothing");
});

test("rankProblems: over-max and broken rules reported", () => {
  const t = tiered();
  assert.deepEqual(P.rankProblems(t, { a1: 5, b1: 2 }, 20), []);
  assert.equal(P.rankProblems(t, { b1: 1 }, 20).length, 1);
  assert.ok(P.rankProblems(t, { a1: 6 }, 20)[0].text.includes("holds 5"));
});
