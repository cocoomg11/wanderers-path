import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTree, TREE_VERSION, treeIssues, prereqCycles, neighbours, grantUuids, MAX_NODES } from "../scripts/tree-model.mjs";

import { tiered, board } from "./_fixtures.mjs";

test("normalizeTree: garbage gives an empty tree, never throws", () => {
  for (const raw of [null, undefined, 3, "x", [], { v: 99, id: "new" }, { nodes: "nope" }, { v: "1", id: 5 }]) {
    const t = normalizeTree(raw);
    assert.equal(t.v, TREE_VERSION);
    assert.ok(Array.isArray(t.nodes));
    assert.equal(t.layout, "tiered");
  }
  assert.equal(normalizeTree({ v: 99, id: "new" }).id, "", "a newer shape isn't read");
});

test("normalizeTree: an old (unversioned) shape is read; clamps ranks, cost and positions", () => {
  const t = normalizeTree({ id: "t", name: "  T  ", tiered: { columns: 2 }, nodes: [
    { id: "n1", maxRanks: 9, cost: 0, col: 5, tier: -2 }, { id: "n2", maxRanks: "0" }, { id: "n3", maxRanks: 2.6 }, { id: "bad id!" }, { id: "n1" }, "junk"
  ] });
  assert.equal(t.v, 1); assert.equal(t.name, "T");
  assert.deepEqual(t.nodes.map(n => n.id), ["n1", "n2", "n3"], "bad and duplicate ids dropped");
  assert.equal(t.nodes[0].maxRanks, 5); assert.equal(t.nodes[1].maxRanks, 1); assert.equal(t.nodes[2].maxRanks, 3);
  assert.equal(t.nodes[0].cost, 1); assert.equal(t.nodes[0].col, 1, "col clamped to the grid"); assert.equal(t.nodes[0].tier, 0);
  assert.equal(t.nodes[1].name, "n2", "name falls back to the id");
});

test("normalizeTree: references fixed, exclusions mirrored, prereq ranks clamped", () => {
  const t = normalizeTree({ id: "t", nodes: [
    { id: "a", maxRanks: 2 }, { id: "b", prereqs: [{ node: "a", ranks: 9 }, { node: "ghost" }, { node: "b" }, "a"], excludes: ["c", "ghost", "b"] }, { id: "c" }
  ] });
  const [a, b, c] = t.nodes;
  assert.deepEqual(b.prereqs, [{ node: "a", ranks: 2 }], "unknown/self/duplicate prereqs dropped; ranks clamped to max");
  assert.deepEqual(b.excludes, ["c"]);
  assert.deepEqual(c.excludes, ["b"], "mirrored");
  assert.deepEqual(a.excludes, []);
  assert.equal(normalizeTree({ id: "t", nodes: [{ id: "a", maxRanks: 3 }, { id: "b", prereqs: ["a"] }] }).nodes[1].prereqs[0].ranks, 3, "no ranks = all ranks");
});

test("normalizeTree: grants and gates read leniently", () => {
  const t = normalizeTree({ id: "t", nodes: [{ id: "a", grant: { mode: "item", perRank: "weird", ranks: [{ uuid: "Compendium.world.x.Item.abc" }, { uuid: "nodot" }, { built: { kind: "ac" } }, 4] }, gate: { level: 99, treePoints: -1 } }] });
  const g = t.nodes[0].grant;
  assert.equal(g.mode, "item"); assert.equal(g.perRank, "scale");
  assert.deepEqual(g.ranks, [{ uuid: "Compendium.world.x.Item.abc" }, { built: { kind: "ac" } }]);
  assert.deepEqual(t.nodes[0].gate, { level: 30 });
  assert.deepEqual(normalizeTree({ id: "t", nodes: [{ id: "a", grant: "x" }] }).nodes[0].grant, { mode: "none", perRank: "scale", ranks: [] });
  assert.deepEqual(grantUuids(t), [{ node: "a", uuid: "Compendium.world.x.Item.abc" }]);
});

test("normalizeTree: assignment identifiers, unlock level, node cap, round trip", () => {
  const t = normalizeTree({ id: "t", assign: { classes: ["Fighter", "fighter", "bad id", 3], subclasses: "x" }, unlockLevel: 0 });
  assert.deepEqual(t.assign, { classes: ["fighter"], subclasses: [] });
  assert.equal(t.unlockLevel, null);
  assert.equal(normalizeTree({ id: "t", unlockLevel: "4" }).unlockLevel, 4);
  const many = normalizeTree({ id: "t", nodes: Array.from({ length: MAX_NODES + 10 }, (_, i) => ({ id: `n${i}` })) });
  assert.equal(many.nodes.length, MAX_NODES);
  const a = tiered();
  assert.deepEqual(normalizeTree(a), a, "the current shape round-trips");
});

test("board: hub and edges cleaned", () => {
  const b = normalizeTree({ id: "b", layout: "board", board: { hub: "ghost", edges: [["a", "b"], ["b", "a"], ["a", "a"], ["a", "ghost"], "x"] }, nodes: [{ id: "a" }, { id: "b" }] });
  assert.equal(b.board.hub, "a", "a missing hub falls back to the first node");
  assert.deepEqual(b.board.edges, [["a", "b"]]);
  assert.deepEqual(neighbours(b, "b"), ["a"]);
  assert.equal(normalizeTree({ id: "t", board: { hub: "ghost" } }).board.hub, "", "tiered trees need no hub");
});

test("treeIssues: cycles, gates, tiers, missing refs, board reach", () => {
  const cyc = normalizeTree({ id: "c", name: "Cyc", nodes: [{ id: "a", prereqs: ["b"] }, { id: "b", prereqs: ["c"] }, { id: "c", prereqs: ["a"] }] });
  assert.equal(prereqCycles(cyc).length, 1);
  assert.ok(treeIssues(cyc).some(i => i.level === "bad" && /require each other/.test(i.text)));
  assert.deepEqual(treeIssues(tiered()).filter(i => i.level === "bad"), [], "the sample tree is clean");
  const gate = normalizeTree({ id: "g", name: "G", nodes: [{ id: "a" }, { id: "b", gate: { treePoints: 5 } }] });
  assert.ok(treeIssues(gate).some(i => /more than the rest/.test(i.text)));
  const tier = normalizeTree({ id: "t", name: "T", nodes: [{ id: "a" }, { id: "b", tier: 2 }] });
  assert.ok(treeIssues(tier).some(i => /tiers below hold only 1/.test(i.text)));
  const ex = normalizeTree({ id: "e", name: "E", nodes: [{ id: "a" }, { id: "b", prereqs: ["a"], excludes: ["a"] }] });
  assert.ok(treeIssues(ex).some(i => /also can't be learned/.test(i.text)));
  const g = normalizeTree({ id: "u", name: "U", nodes: [{ id: "a", grant: { mode: "item", ranks: [{ uuid: "Item.gone" }, { uuid: "Item.here" }] } }] });
  const issues = treeIssues(g, { has: u => u === "Item.here" });
  assert.equal(issues.filter(i => /no longer exists/.test(i.text)).length, 1);
  assert.deepEqual(treeIssues(g).filter(i => /no longer exists/.test(i.text)), [], "no index: not checked");
  assert.ok(treeIssues(board()).some(i => /Lonely isn't connected/.test(i.text)));
  assert.ok(treeIssues(normalizeTree({ id: "", name: "" })).some(i => /no id/.test(i.text)));
  assert.doesNotThrow(() => treeIssues(/** @type {any} */ ({ nodes: null })));
});
