import { test } from "node:test";
import assert from "node:assert/strict";
import * as V from "../scripts/view-model.mjs";
import * as P from "../scripts/picks-model.mjs";
import { normalizeTree } from "../scripts/tree-model.mjs";
import { REQUESTS, readNotice, learnChanges, pendingFrom } from "../scripts/requests-model.mjs";
import { readRequest } from "../vendor/wanderers-core/index.mjs";
import { tiered, board } from "./_fixtures.mjs";

const rules = P.readRules({});
/** @param {any} [o] */
function facts(o = {}) {
  const trees = o.trees ?? [tiered()];
  const picks = o.picks ?? P.emptyPicks();
  const level = o.level ?? 10;
  const seen = P.treesFor({ trees, picks, classes: o.classes ?? ["fighter"], level, rules: o.rules ?? rules });
  return { actor: { id: "actor00000000001", name: o.name ?? "Hero", level }, isGM: !!o.isGM, canEdit: o.canEdit ?? true, respec: !!o.respec, gmConnected: o.gm ?? true,
    rules: o.rules ?? rules, picks, pending: o.pending ?? structuredClone(picks.ranks), seen, allTrees: trees, current: o.current ?? null, packSet: true };
}

test("pickActor: the toolkit's rule", () => {
  const a = { type: "character", name: "A" }, b = { type: "character", name: "B" }, npc = { type: "npc", name: "N" };
  assert.equal(V.pickActor({ isGM: true, controlled: [a] }).actor, a);
  assert.match(V.pickActor({ isGM: true, controlled: [npc] }).warn ?? "", /isn't a player character/);
  assert.match(V.pickActor({ isGM: true }).warn ?? "", /Select/);
  assert.equal(V.pickActor({ character: b, owned: [a] }).actor, b);
  assert.equal(V.pickActor({ owned: [a] }).actor, a);
  assert.equal(V.pickActor({ owned: [a, b], controlled: [b] }).actor, b);
  assert.match(V.pickActor({ owned: [a, b] }).warn ?? "", /several/);
  assert.match(V.pickActor({}).warn ?? "", /no character/);
});

test("viewModel: tiers, arrows, node states, preview counts as spent", () => {
  const f = facts({ pending: { alpha: { a1: 5 } } });
  const m = V.viewModel(f);
  assert.equal(m.screen, "tree"); assert.equal(m.current, "alpha");
  assert.equal(m.pending, true);
  assert.equal(m.points.spent, 5); assert.equal(m.stored.spent, 0);
  assert.equal(m.points.available, 4, "level 10: 9 points, 5 in the preview");
  const st = Object.fromEntries((m.nodes ?? []).map(n => [n.node.id, n.state]));
  assert.deepEqual(st, { a1: "maxed", a2: "available", b1: "available", b2: "available", c1: "locked" });
  assert.equal(m.arrows.length, 1); assert.equal(m.arrows[0].met, true);
  assert.deepEqual(m.tiers.slice(0, 3).map(t => t.open), [true, true, false]);
  assert.equal(m.next, 10);
  assert.equal(m.nodes.find(n => n.node.id === "a1")?.added, 5);
});

test("viewModel: messages for off, no trees, board placeholder, locked tree", () => {
  assert.equal(V.viewModel(facts({ picks: { ...P.emptyPicks(), enabled: false } })).screen, "message");
  assert.match(V.viewModel(facts({ classes: [] })).message ?? "", /No talent trees/);
  const b = board(); b.assign.classes = ["fighter"];
  const m = V.viewModel(facts({ trees: [b] }));
  assert.equal(m.board, true);
  assert.match(V.windowHTML(facts({ trees: [b] })), /Board view coming soon/);
  const locked = V.viewModel(facts({ level: 3, rules: { ...rules, unlockLevel: 5 } }));
  assert.equal(locked.unlocked, false);
  assert.ok((locked.nodes ?? []).every(n => !n.canLearn));
});

test("viewModel: refunds only when allowed and only on stored ranks; undo on new ranks", () => {
  const picks = { ...P.emptyPicks(), ranks: { alpha: { a1: 2 } } };
  let m = V.viewModel(facts({ picks, pending: { alpha: { a1: 3 } } }));
  let a1 = m.nodes.find(n => n.node.id === "a1");
  assert.equal(a1?.canUndo, true); assert.equal(a1?.canRefund, false);
  m = V.viewModel(facts({ picks }));
  a1 = m.nodes.find(n => n.node.id === "a1");
  assert.equal(a1?.canRefund, false, "respec off");
  m = V.viewModel(facts({ picks, respec: true }));
  assert.equal(m.nodes.find(n => n.node.id === "a1")?.canRefund, true);
  m = V.viewModel(facts({ picks, canEdit: false }));
  assert.ok(m.nodes.every(n => !n.canLearn), "observers can't click");
});

test("trimPending: dependants in the preview go back with their prereq", () => {
  const t = tiered();
  assert.deepEqual(V.trimPending(t, {}, { a1: 4, b1: 1 }, 20), { a1: 4 });
  assert.deepEqual(V.trimPending(t, { a1: 5, b1: 1 }, { a1: 5, b1: 2 }, 20), { a1: 5, b1: 2 });
  assert.equal(V.hasPending({ t: { a: 1 } }, { t: { a: 1 } }), false);
  assert.equal(V.hasPending({}, { t: { a: 1 } }), true);
});

test("windowHTML: escapes world text, tabs, Learn disabled without changes or a GM, GM tools only for GMs", () => {
  const evil = normalizeTree({ id: "evil", name: "<b>x</b>", assign: { classes: ["fighter"] }, nodes: [{ id: "n", name: "\"><img src=x onerror=1>", text: "<script>" }] });
  const h = V.windowHTML(facts({ trees: [evil, tiered()], name: "<i>me</i>" }));
  assert.doesNotMatch(h, /<script>|<b>x<\/b>|<i>me<\/i>/);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(h, /class="wp-tabs"/);
  assert.match(h, /data-action="learn" disabled/);
  assert.match(V.windowHTML(facts({ pending: { alpha: { a1: 1 } } })), /data-action="learn">/);
  assert.match(V.windowHTML(facts({ pending: { alpha: { a1: 1 } }, gm: false })), /data-action="learn" disabled/);
  assert.match(V.windowHTML(facts({ gm: false })), /A GM must be connected/);
  assert.doesNotMatch(h, /data-action="gmAward"/);
  const gm = V.windowHTML(facts({ isGM: true, respec: true }));
  assert.match(gm, /data-action="gmAward"/); assert.match(gm, /data-change="enable"/); assert.match(gm, /data-action="resetTree"/);
  assert.match(V.tooltipHTML(V.viewModel(facts()).nodes[0]), /Click to learn/);
});

test("requests: schemas accept the window's data and refuse junk", () => {
  const rid = "aaaa-1-abc";
  const ok = (kind, data) => readRequest(REQUESTS, { action: "request", kind, rid, data }).ok;
  const actorId = "actor00000000001";
  assert.ok(ok("pathLearn", { actorId, changes: [{ tree: "alpha", node: "a1", to: 2 }] }));
  assert.ok(!ok("pathLearn", { actorId, changes: [{ tree: "alpha", node: "a1", to: 9 }] }));
  assert.ok(!ok("pathLearn", { actorId, changes: [{ tree: "a b", node: "a1", to: 1 }] }));
  assert.ok(!ok("pathLearn", { actorId, userId: "x", changes: [] }), "no user field accepted");
  assert.ok(ok("pathRefund", { actorId }));
  assert.ok(ok("pathRefund", { actorId, tree: "alpha", node: "a1", all: true }));
  assert.ok(ok("pathAward", { actorId, n: -3, reason: "" }));
  assert.ok(!ok("pathAward", { actorId, n: 1.5, reason: "" }));
  assert.ok(ok("pathEnable", { actorId, enabled: "world" }));
  assert.ok(!ok("pathTrees", { actorId, tree: "alpha", op: "delete" }));
  for (const k of ["pathAward", "pathEnable", "pathTrees"]) assert.equal(REQUESTS[k].from, "gm", k);
  assert.equal(REQUESTS.pathLearn.from, undefined); assert.equal(REQUESTS.pathRefund.from, undefined);
});

test("learnChanges / pendingFrom round trip; notices read only for this user", () => {
  const stored = { alpha: { a1: 2 } };
  const ch = learnChanges(stored, { alpha: { a1: 4, a2: 1 }, beta: { h: 0 } });
  assert.deepEqual(ch, [{ tree: "alpha", node: "a1", to: 4 }, { tree: "alpha", node: "a2", to: 1 }]);
  assert.deepEqual(pendingFrom(stored, ch), { alpha: { a1: 4, a2: 1 } });
  assert.deepEqual(readNotice({ to: "u1", level: "warn", text: "hi" }, "u1"), { level: "warn", text: "hi" });
  assert.equal(readNotice({ to: "u2", text: "hi" }, "u1"), null);
  assert.equal(readNotice({ to: null, text: "" }, "u1"), null);
  assert.equal(readNotice(null, "u1"), null);
});
