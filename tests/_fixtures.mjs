/** Shared test trees. Generic placeholders only: the module ships no talent content. */
import { normalizeTree } from "../scripts/tree-model.mjs";

export const tiered = () => normalizeTree({
  v: 1, id: "alpha", name: "Alpha", layout: "tiered", assign: { classes: ["fighter"] }, tiered: { columns: 3, tierSize: 5 },
  nodes: [
    { id: "a1", name: "Node A1", tier: 0, col: 0, maxRanks: 5 },
    { id: "a2", name: "Node A2", tier: 0, col: 1, maxRanks: 3 },
    { id: "b1", name: "Node B1", tier: 1, col: 0, maxRanks: 2, prereqs: [{ node: "a1", ranks: 5 }] },
    { id: "b2", name: "Node B2", tier: 1, col: 2, maxRanks: 1, excludes: ["b1"] },
    { id: "c1", name: "Node C1", tier: 2, col: 1, maxRanks: 1, gate: { level: 10 } }
  ]
});
export const board = () => normalizeTree({
  id: "beta", name: "Beta", layout: "board", board: { hub: "h", edges: [["h", "x"], ["x", "y"], ["h", "z"], ["y", "k"], ["z", "k"]] },
  nodes: [{ id: "h", name: "Hub" }, { id: "x", name: "X", maxRanks: 2 }, { id: "y", name: "Y" }, { id: "z", name: "Z" }, { id: "k", name: "Key", keystone: true }, { id: "lonely", name: "Lonely" }]
});

