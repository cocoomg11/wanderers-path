import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../scripts/grants-model.mjs";
import * as P from "../scripts/picks-model.mjs";
import { normalizeTree } from "../scripts/tree-model.mjs";

const ITEM = "Compendium.world.feats.Item.aaaaaaaaaaaaaaaa";
const ITEM2 = "Compendium.world.feats.Item.bbbbbbbbbbbbbbbb";
const R = n => `Compendium.world.feats.Item.r${n}rrrrrrrrrrrrrr`;
const EFF = "Item.cccccccccccccccc.ActiveEffect.dddddddddddddddd";

const tree = () => normalizeTree({
  id: "alpha", name: "Alpha", assign: { classes: ["fighter"] },
  nodes: [
    { id: "s", name: "Scale", maxRanks: 3, grant: { mode: "item", perRank: "scale", ranks: [{ uuid: ITEM }] } },
    { id: "one", name: "One", maxRanks: 1, grant: { mode: "item", ranks: [{ uuid: ITEM2 }] } },
    { id: "rep", name: "Replace", maxRanks: 3, grant: { mode: "item", perRank: "replace", ranks: [{ uuid: R(1) }, { uuid: R(2) }] } },
    { id: "fx", name: "Effect", grant: { mode: "effect", ranks: [{ uuid: EFF }] } },
    { id: "none", name: "Nothing", grant: { mode: "none", ranks: [{ uuid: ITEM }] } },
    { id: "built", name: "Built", grant: { mode: "effect", ranks: [{ built: { kind: "ac", base: 1 } }] } }
  ]
});
const picks = ranks => P.normalizePicks({ v: 1, ranks: { alpha: ranks } });

/** A fake actor: tagged documents applied from a plan as the Foundry half would. */
function fakeActor(start = []) {
  let n = 0;
  const docs = [...start];
  return {
    docs,
    existing: () => docs.map(d => ({ id: d.id, type: d.docType ?? "Item", tag: d.flags?.["wanderers-path"]?.granted, name: d.name })),
    apply(plan, sources) {
      for (const r of [...plan.remove, ...plan.replace]) { const i = docs.findIndex(d => d.id === r.id); if (i >= 0) docs.splice(i, 1); }
      for (const { grant, hash } of [...plan.create, ...plan.replace]) {
        const s = sources.get(G.srcKey(grant));
        docs.push({ ...G.copyData(s, grant, { hash, inCompendium: grant.src.startsWith("Compendium."), actorUuid: "Actor.hero" }), id: `d${++n}`, docType: grant.type });
      }
      for (const u of plan.update) { const d = docs.find(x => x.id === u.id); d.name = G.rankedName(d.name, u.grant); d.flags["wanderers-path"].granted = G.tagFor(u.grant, u.hash); }
    }
  };
}
const sourcesFor = (grants, data = id => ({ _id: "x", name: `Src ${id}`, type: "feat", system: { description: { value: "" } }, _stats: { modifiedTime: 1 } })) =>
  new Map(grants.map(g => [G.srcKey(g), G.snapshot(data(g.src))]));
const hashes = src => new Map([...src].map(([k, v]) => [k, G.stableHash(v)]));

test("desiredGrants: keys, modes, rank slots, nothing for none / built / unlearned", () => {
  const d = G.desiredGrants(picks({ s: 2, one: 1, rep: 3, fx: 1, none: 1, built: 1 }), [tree()]);
  assert.deepEqual(d.map(g => g.key), ["alpha.s", "alpha.one", "alpha.rep.2", "alpha.fx"]);
  const s = d[0];
  assert.equal(s.rank, 2); assert.equal(s.src, ITEM); assert.equal(s.type, "Item"); assert.equal(s.suffix, true);
  assert.equal(d[1].suffix, false, "single-rank nodes keep their name");
  assert.equal(d[2].src, R(2), "replace past the last slot uses the last slot"); assert.equal(d[2].suffix, false);
  assert.equal(d[3].type, "ActiveEffect");
  assert.deepEqual(G.desiredGrants(picks({ rep: 1 }), [tree()]).map(g => [g.key, g.src]), [["alpha.rep.1", R(1)]]);
  assert.deepEqual(G.desiredGrants(picks({ s: 1 }), []), [], "trees not given grant nothing");
  assert.deepEqual(G.desiredGrants(picks({ ghost: 1 }), [tree()]), []);
});

test("grantTrees: only when talents are on, every seen tree", () => {
  const t = tree();
  assert.deepEqual(G.grantTrees({ enabled: true, trees: [{ tree: t }] }), [t]);
  assert.deepEqual(G.grantTrees({ enabled: false, trees: [{ tree: t }] }), []);
});

test("reconcile is idempotent: plan → apply to a fake → plan again = empty", () => {
  const actor = fakeActor([{ id: "mine", type: "Item", name: "Hand-made", flags: {} }]);
  let desired = G.desiredGrants(picks({ s: 1, one: 1, rep: 1, fx: 1 }), [tree()]);
  let src = sourcesFor(desired);
  let plan = G.reconcilePlan(desired, actor.existing(), { hashes: hashes(src) });
  assert.equal(plan.create.length, 4);
  actor.apply(plan, src);
  assert.equal(G.planSize(G.reconcilePlan(desired, actor.existing(), { hashes: hashes(src) })), 0);
  assert.equal(G.planSize(G.reconcilePlan(desired, actor.existing(), { hashes: hashes(src), refresh: true })), 0);
  assert.equal(G.planSize(G.reconcilePlan(desired, actor.existing())), 0, "the structural plan agrees");
  assert.equal(actor.docs.find(d => d.id === "mine").name, "Hand-made");
  assert.equal(actor.docs.find(d => d.flags?.["wanderers-path"]?.granted?.key === "alpha.s").name, "Src " + ITEM + " (1/3)");

  // Rank up: scale updates in place, replace swaps the copy.
  desired = G.desiredGrants(picks({ s: 3, one: 1, rep: 2, fx: 1 }), [tree()]);
  src = sourcesFor(desired);
  plan = G.reconcilePlan(desired, actor.existing(), { hashes: hashes(src) });
  assert.deepEqual(plan.update.map(u => u.grant.key), ["alpha.s"]);
  assert.deepEqual(plan.create.map(c => c.grant.key), ["alpha.rep.2"]);
  assert.deepEqual(plan.remove.map(r => r.key), ["alpha.rep.1"]);
  actor.apply(plan, src);
  assert.equal(G.planSize(G.reconcilePlan(desired, actor.existing(), { hashes: hashes(src) })), 0);
  assert.equal(actor.docs.find(d => d.flags?.["wanderers-path"]?.granted?.key === "alpha.s").name, "Src " + ITEM + " (3/3)");

  // Respec: every tagged copy goes, the hand-made item stays.
  plan = G.reconcilePlan([], actor.existing(), { hashes: new Map() });
  assert.equal(plan.remove.length, 4);
  actor.apply(plan, new Map());
  assert.deepEqual(actor.docs.map(d => d.id), ["mine"]);
  assert.equal(G.planSize(G.reconcilePlan([], actor.existing())), 0);
});

test("reconcilePlan: source drift is stale until a refresh; changed source UUID replaces; missing keeps the copy", () => {
  const actor = fakeActor();
  const desired = G.desiredGrants(picks({ one: 1 }), [tree()]);
  const src = sourcesFor(desired);
  actor.apply(G.reconcilePlan(desired, [], { hashes: hashes(src) }), src);
  const edited = sourcesFor(desired, id => ({ name: `Src ${id}`, type: "feat", system: { description: { value: "edited" } } }));
  const quiet = G.reconcilePlan(desired, actor.existing(), { hashes: hashes(edited) });
  assert.equal(G.planSize(quiet), 0); assert.equal(quiet.stale, 1);
  const r = G.reconcilePlan(desired, actor.existing(), { hashes: hashes(edited), refresh: true });
  assert.equal(r.replace.length, 1); assert.equal(r.replace[0].why, "the source changed");
  actor.apply(r, edited);
  assert.equal(G.planSize(G.reconcilePlan(desired, actor.existing(), { hashes: hashes(edited), refresh: true })), 0);

  const t2 = tree(); t2.nodes[1].grant.ranks = [{ uuid: ITEM }];
  const d2 = G.desiredGrants(picks({ one: 1 }), [t2]);
  const moved = G.reconcilePlan(d2, actor.existing(), { hashes: hashes(sourcesFor(d2)) });
  assert.equal(moved.replace.length, 1, "the talent grants another document now");

  const gone = G.reconcilePlan(desired, actor.existing(), { hashes: new Map() });
  assert.equal(gone.missing.length, 1); assert.equal(G.planSize(gone), 0, "a missing source never removes the copy");
});

test("reconcilePlan: untagged and malformed tags never touched; duplicates trimmed; keepTree protects", () => {
  const tag = { tree: "alpha", node: "one", rank: 1, key: "alpha.one", src: ITEM2, hash: "h" };
  const existing = [
    { id: "a", type: "Item", tag: null }, { id: "b", type: "Item", tag: { key: "../evil" } }, { id: "c", type: "Item", tag: "x" },
    { id: "d", type: "Item", tag }, { id: "e", type: "Item", tag }, { id: "f", type: "Item", tag: { ...tag, tree: "gone", key: "gone.one" } }
  ];
  const desired = G.desiredGrants(picks({ one: 1 }), [tree()]);
  const p = G.reconcilePlan(desired, existing);
  assert.deepEqual(p.remove.map(r => r.id).sort(), ["e", "f"]);
  const kept = G.reconcilePlan(desired, existing, { keepTree: t => t === "gone" });
  assert.deepEqual(kept.remove.map(r => r.id), ["e"]);
  assert.equal(G.readTag({ ...tag, key: "beta.one" }), null, "key must match tree and node");
});

test("withSources / sourcesNeeded: a structural plan completed with the loaded sources", () => {
  const desired = G.desiredGrants(picks({ s: 1, one: 1 }), [tree()]);
  const rough = G.reconcilePlan(desired, []);
  assert.equal(G.sourcesNeeded(rough).length, 2);
  const src = sourcesFor(desired.slice(0, 1));
  const p = G.withSources(rough, hashes(src));
  assert.equal(p.create.length, 1); assert.equal(p.missing.length, 1);
  assert.equal(p.create[0].hash, G.stableHash(src.get(G.srcKey(desired[0]))));
});

test("copyData: tag, name, source stats, effect origin, effects keep transfer, other flags kept", () => {
  const [s] = G.desiredGrants(picks({ s: 2 }), [tree()]);
  const snap = G.snapshot({ _id: "zzz", name: "Thing", folder: "f", sort: 5, ownership: { default: 0 }, _stats: { modifiedTime: 9 },
    flags: { other: { x: 1 }, "wanderers-path": { granted: { key: "old" } } }, effects: [{ _id: "e1", transfer: true, _stats: { a: 1 } }] });
  assert.deepEqual(Object.keys(snap).sort(), ["effects", "flags", "name"]);
  const d = G.copyData(snap, s, { hash: "h1", inCompendium: true, actorUuid: "Actor.hero" });
  assert.equal(d._id, undefined); assert.equal(d.name, "Thing (2/3)");
  assert.deepEqual(d._stats, { compendiumSource: ITEM, duplicateSource: null });
  assert.deepEqual(d.flags["wanderers-path"].granted, { tree: "alpha", node: "s", rank: 2, key: "alpha.s", src: ITEM, hash: "h1" });
  assert.deepEqual(d.flags.other, { x: 1 }); assert.equal(d.effects[0].transfer, true); assert.equal(d.origin, undefined);
  const [fx] = G.desiredGrants(picks({ fx: 1 }), [tree()]);
  const e = G.copyData(G.snapshot({ name: "Aura", transfer: false }), fx, { hash: "", inCompendium: false, actorUuid: "Actor.hero" });
  assert.equal(e.origin, "Actor.hero"); assert.deepEqual(e._stats, { compendiumSource: null, duplicateSource: EFF });
  assert.equal(G.rankedName("Thing (2/3)", { ...s, rank: 3 }), "Thing (3/3)");
});

test("stableHash: key order doesn't matter, content does; stats and our flags ignored", () => {
  assert.equal(G.stableHash({ a: 1, b: [1, { c: 2, d: 3 }] }), G.stableHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(G.stableHash({ a: 1 }), G.stableHash({ a: 2 }));
  assert.notEqual(G.stableHash([1, 2]), G.stableHash([2, 1]));
  assert.equal(G.stableHash(G.snapshot({ name: "x", _stats: { t: 1 } })), G.stableHash(G.snapshot({ name: "x", _stats: { t: 2 }, flags: { "wanderers-path": { granted: {} } } })));
  assert.match(G.stableHash({}), /^[0-9a-z]+$/);
});

test("hasAdvancement, parseUuid, orphanRanks, grantSummary", () => {
  assert.equal(G.hasAdvancement({ system: { advancement: { a1: { type: "ItemGrant" } } } }), true);
  assert.equal(G.hasAdvancement({ system: { advancement: [] } }), false);
  assert.equal(G.hasAdvancement({ system: {} }), false);
  assert.deepEqual(G.parseUuid(ITEM), { pack: "world.feats", id: "aaaaaaaaaaaaaaaa", effect: null });
  assert.deepEqual(G.parseUuid(`${ITEM}.ActiveEffect.eeeeeeeeeeeeeeee`), { pack: "world.feats", id: "aaaaaaaaaaaaaaaa", effect: "eeeeeeeeeeeeeeee" });
  assert.deepEqual(G.parseUuid(EFF), { world: true });
  assert.equal(G.parseUuid("Compendium.world.journal.JournalEntry.x"), null);
  assert.equal(G.parseUuid("nope"), null);

  const o = G.orphanRanks(P.normalizePicks({ ranks: { alpha: { s: 1, lost: 2 }, gone: { x: 1 } } }), [tree()]);
  assert.deepEqual(o.ranks, { alpha: { s: 1 } });
  assert.deepEqual(o.removed.map(r => `${r.tree}.${r.node}`).sort(), ["alpha.lost", "gone.x"]);

  const desired = G.desiredGrants(picks({ one: 1 }), [tree()]);
  const sum = G.grantSummary(desired, [{ id: "x", type: "Item", tag: { tree: "alpha", node: "s", rank: 1, key: "alpha.s", src: ITEM }, name: "Old", advancement: true }, { id: "y", type: "Item", tag: null }]);
  assert.deepEqual(sum, { count: 1, outOfSync: 2, advancement: ["Old"] });
});

test("serial: one at a time per key, failures don't stop the queue", async () => {
  const q = G.serial(); const log = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const a = q.run("x", async () => { await wait(20); log.push("a"); });
  const b = q.run("x", async () => { log.push("b"); throw new Error("boom"); });
  const c = q.run("x", async () => { log.push("c"); return 3; });
  const other = q.run("y", async () => { log.push("y"); });
  await assert.rejects(b);
  assert.equal(await c, 3); await a; await other;
  assert.deepEqual(log, ["y", "a", "b", "c"]);
});
