import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "../scripts/builder-model.mjs";
import * as BV from "../scripts/builder-view-model.mjs";
import * as G from "../scripts/grants-model.mjs";
import * as P from "../scripts/picks-model.mjs";
import { normalizeTree } from "../scripts/tree-model.mjs";

const ch = (key, type, value) => ({ key, type, value, phase: "initial", priority: null });

// Snapshot of every template's changes (keys checked against dnd5e 6.0.6; v14 change shape).
const SNAPSHOTS = [
  [{ template: "ac", base: 1, step: 1 }, 3, [ch("system.attributes.ac.bonus", "add", "3")]],
  [{ template: "speed", params: { move: "fly" }, base: 10, step: 5 }, 2, [ch("system.attributes.movement.speeds.fly", "add", "15")]],
  [{ template: "speed" }, 1, [ch("system.attributes.movement.speeds.walk", "add", "5")]],
  [{ template: "sense", params: { sense: "darkvision" }, base: 60, step: 30 }, 2, [ch("system.attributes.senses.ranges.darkvision", "upgrade", "90")]],
  [{ template: "bonus", params: { target: "skill", key: "ste" }, base: 2 }, 1, [ch("system.skills.ste.roll.bonus", "add", "2")]],
  [{ template: "bonus", params: { target: "check", key: "int" } }, 2, [ch("system.abilities.int.check.roll.bonus", "add", "2")]],
  [{ template: "bonus", params: { target: "save", key: "wis" } }, 1, [ch("system.abilities.wis.save.roll.bonus", "add", "1")]],
  [{ template: "bonus", params: { target: "skills" } }, 1, [ch("system.rolls.ability.skill.bonus", "add", "1")]],
  [{ template: "bonus", params: { target: "checks" } }, 1, [ch("system.rolls.ability.check.bonus", "add", "1")]],
  [{ template: "bonus", params: { target: "saves" } }, 1, [ch("system.rolls.ability.save.bonus", "add", "1")]],
  [{ template: "bonus", params: { target: "initiative" }, base: 2, step: 2 }, 3, [ch("system.attributes.init.roll.bonus", "add", "6")]],
  [{ template: "advantage", params: { target: "save", key: "con" } }, 1, [ch("system.abilities.con.save.roll.mode", "add", "1")]],
  [{ template: "advantage", params: { target: "check", key: "str" } }, 1, [ch("system.abilities.str.check.roll.mode", "add", "1")]],
  [{ template: "advantage", params: { target: "skill", key: "prc" } }, 2, [ch("system.skills.prc.roll.mode", "add", "1")]],
  [{ template: "advantage", params: { target: "initiative" } }, 1, [ch("system.attributes.init.roll.mode", "add", "1")]],
  [{ template: "proficiency", params: { kind: "skill", key: "ath", level: "2" } }, 1, [ch("system.skills.ath.value", "upgrade", "2")]],
  [{ template: "proficiency", params: { kind: "save", key: "dex" } }, 1, [ch("system.abilities.dex.proficient", "upgrade", "1")]],
  [{ template: "proficiency", params: { kind: "tool", key: "thief", level: "1" } }, 1, [ch("system.tools.thief.value", "upgrade", "1")]],
  [{ template: "proficiency", params: { kind: "weapon", key: "mar" } }, 1, [ch("system.traits.weaponProf.value", "add", "mar")]],
  [{ template: "proficiency", params: { kind: "weapon", key: "dagger" } }, 1, [ch("system.traits.weaponProf.value", "add", "dagger")]],
  [{ template: "proficiency", params: { kind: "armor", key: "hvy" } }, 1, [ch("system.traits.armorProf.value", "add", "hvy")]],
  [{ template: "proficiency", params: { kind: "language", key: "elvish" } }, 1, [ch("system.traits.languages.value", "add", "elvish")]],
  [{ template: "defense", params: { kind: "dr", type: "fire" } }, 1, [ch("system.traits.dr.value", "add", "fire")]],
  [{ template: "defense", params: { kind: "di", type: "poison" } }, 1, [ch("system.traits.di.value", "add", "poison")]],
  [{ template: "defense", params: { kind: "dv", type: "cold" } }, 1, [ch("system.traits.dv.value", "add", "cold")]],
  [{ template: "defense", params: { kind: "ci", type: "frightened" } }, 1, [ch("system.traits.ci.value", "add", "frightened")]],
  [{ template: "ability", params: { ability: "con" }, base: 1, step: 1 }, 2, [ch("system.abilities.con.value", "add", "2")]],
  [{ template: "hp", params: { per: "level" } }, 1, [ch("system.attributes.hp.bonuses.level", "add", "1")]],
  [{ template: "hp", params: { per: "overall" }, base: 5, step: 5 }, 3, [ch("system.attributes.hp.bonuses.overall", "add", "15")]],
  [{ template: "crit", base: 1 }, 1, [ch("flags.dnd5e.weaponCriticalThreshold", "downgrade", "19")]],
  [{ template: "crit", base: 1, step: 1 }, 2, [ch("flags.dnd5e.weaponCriticalThreshold", "downgrade", "18")]]
];

test("every template's changes (snapshots)", () => {
  for (const [spec, rank, want] of SNAPSHOTS) assert.deepEqual(B.buildChanges(spec, rank), want, JSON.stringify(spec));
  const covered = new Set(SNAPSHOTS.map(s => s[0].template));
  assert.deepEqual(B.TEMPLATES.map(t => t.id).filter(id => !covered.has(id)), [], "every template has a snapshot");
});

test("no built key is a legacy key dnd5e 6 shims", () => {
  const shimmed = /\.bonuses\.(check|save)$|^system\.attributes\.(movement\.(walk|fly|swim|climb|burrow|jump|speed)|senses\.(darkvision|blindsight|tremorsense|truesight)|init\.bonus)$|^system\.bonuses\.|^flags\.dnd5e\.initiativeAdv$/;
  for (const [spec, rank] of SNAPSHOTS) for (const c of B.buildChanges(spec, rank)) assert.doesNotMatch(c.key, shimmed, c.key);
});

test("X = base + step × (rank − 1); preview lines in plain words", () => {
  const s = B.normalizeSpec({ template: "ac", base: 1, step: 1 });
  assert.deepEqual([1, 2, 3].map(r => B.valueAt(s, r)), [1, 2, 3]);
  assert.equal(B.previewLine({ template: "ac", base: 1, step: 1 }, 3), "+X AC per rank: 1 / 2 / 3");
  assert.equal(B.previewLine({ template: "ac", base: 2, step: 0 }, 3), "+2 AC (every rank)");
  assert.equal(B.previewLine({ template: "ac" }, 1), "+1 AC");
  assert.equal(B.previewLine({ template: "speed", params: { move: "walk" } }, 2), "+X ft walking speed per rank: 5 / 10");
  assert.equal(B.previewLine({ template: "crit", base: 1, step: 1 }, 2), "Weapon critical hits on per rank: 19–20 / 18–20");
  assert.equal(B.previewLine({ template: "defense", params: { kind: "ci", type: "charmed" } }, 2), "Immunity to the charmed condition (every rank)");
  assert.equal(B.specText({ template: "bonus", params: { target: "save", key: "wis" }, base: 2 }), "+2 to Wisdom saving throws");
  assert.equal(B.specText({ template: "proficiency", params: { kind: "skill", key: "ste", level: "2" } }), "Expertise in Stealth");
  assert.equal(B.specText({ template: "hp", params: { per: "level" } }), "+1 hit points per level");
});

test("validators: bad template, bad parameter, X out of range, free keys", () => {
  assert.deepEqual(B.specIssues(null), ["A built rank needs a template."]);
  assert.match(B.specIssues({ template: "flying-car" })[0], /no template/);
  assert.match(B.specIssues({ template: "speed", params: { move: "teleport" } })[0], /Speed: "teleport"/);
  assert.match(B.specIssues({ template: "ac", base: 1, step: 5 }, { maxRanks: 3 })[0], /At rank 3 X would be 11/);
  assert.deepEqual(B.specIssues({ template: "ac", base: 1, step: 5 }, { maxRanks: 2 }), []);
  assert.match(B.specIssues({ template: "crit", base: 6 })[0], /takes 1 to 5/);
  assert.deepEqual(B.specIssues({ template: "proficiency", params: { kind: "tool", key: "smith" } }), []);
  assert.match(B.specIssues({ template: "proficiency", params: { kind: "tool", key: "Bad Key!" } })[0], /isn't one of the choices/);
  assert.match(B.specIssues({ template: "bonus", params: { target: "skill", key: "str" } })[0], /Which/);
  assert.deepEqual(B.buildChanges({ template: "ac", base: 99 }, 1), [], "nothing is built from a bad spec");
  assert.equal(B.buildTemplate({ template: "nope" }, 1), null);
});

test("normalizeSpec: defaults, only the parameters a template uses, non-scaling templates ignore X", () => {
  assert.deepEqual(B.normalizeSpec({ template: "bonus", params: { target: "initiative", key: "ste", junk: "x" } }), { template: "bonus", params: { target: "initiative" }, base: 1, step: 1 });
  assert.deepEqual(B.normalizeSpec({ template: "defense", base: 9, step: 9 }), { template: "defense", params: { kind: "dr", type: "fire" }, base: 0, step: 0 });
  assert.deepEqual(B.normalizeSpec({ template: "sense" }), { template: "sense", params: { sense: "darkvision" }, base: 60, step: 0 });
  assert.equal(B.normalizeSpec({ template: "ac", base: "2" }).base, 2);
  assert.equal(B.normalizeSpec("nope"), null);
  // fit: a value of another kind goes back to the default (the window switching kinds).
  assert.equal(B.normalizeSpec({ template: "proficiency", params: { kind: "save", key: "ath" } }, { fit: true }).params.key, "con");
});

test("buildTemplate: an effect, or a feat carrying one transfer effect; generic names from the node", () => {
  const fx = B.buildTemplate({ template: "ac", base: 1, step: 1 }, 2, { mode: "effect", node: { name: "Node A", img: "", text: "" } });
  assert.deepEqual(fx, {
    name: "Node A", img: B.DEFAULT_IMG, type: "base", disabled: false, transfer: false, description: "+2 AC",
    system: { changes: [ch("system.attributes.ac.bonus", "add", "2")] }, flags: { "wanderers-path": { built: { template: "ac", rank: 2 } } }
  });
  const it = B.buildTemplate({ template: "defense", params: { kind: "dr", type: "fire" } }, 1, { mode: "item", node: { name: "N<b>", img: "x.webp", text: "Flavour & more" } });
  assert.equal(it.type, "feat");
  assert.deepEqual(it.system.type, { value: "feat", subtype: "" });
  assert.equal(it.system.description.value, "<p>Resistance to fire damage</p><p>Flavour &amp; more</p>");
  assert.equal(it.effects.length, 1);
  assert.equal(it.effects[0].transfer, true);
  assert.deepEqual(it.effects[0].system.changes, [ch("system.traits.dr.value", "add", "fire")]);
  assert.equal(B.buildTemplate({ template: "ac" }, 1).name, "Armor Class bonus", "no node: the template's label");
});

test("builderSupported: Foundry 14 and dnd5e 6 only", () => {
  assert.equal(B.builderSupported({ generation: 14, system: "dnd5e", systemVersion: "6.0.6" }), true);
  assert.equal(B.builderSupported({ generation: 13, system: "dnd5e", systemVersion: "6.0.6" }), false);
  assert.equal(B.builderSupported({ generation: 14, system: "dnd5e", systemVersion: "5.2.0" }), false);
  assert.equal(B.builderSupported({ generation: 14, system: "pf2e", systemVersion: "7.0.0" }), false);
});

test("api preview and templates: plain data", () => {
  const p = B.preview({ template: "ac", base: 1, step: 1 }, 2, 3);
  assert.deepEqual([p.ok, p.text, p.line], [true, "+2 AC", "+X AC per rank: 1 / 2 / 3"]);
  assert.deepEqual(p.changes, [ch("system.attributes.ac.bonus", "add", "2")]);
  assert.equal(B.preview({ template: "ac", base: 50 }).ok, false);
  const list = B.templateList();
  assert.deepEqual(list.map(t => t.id), ["ac", "speed", "sense", "bonus", "advantage", "proficiency", "defense", "ability", "hp", "crit"]);
  assert.ok(JSON.stringify(list).length > 100 && !list.some(t => Object.values(t).some(v => typeof v === "function")));
});

const rawTree = () => ({
  v: 1, id: "alpha", name: "Alpha", assign: { classes: ["fighter"] },
  nodes: [
    { id: "s", name: "Scale", maxRanks: 3, grant: { mode: "none", ranks: [] } },
    { id: "rep", name: "Replace", maxRanks: 3, grant: { mode: "item", perRank: "replace", ranks: [{ uuid: "Compendium.world.f.Item.aaaaaaaaaaaaaaaa" }] } }
  ]
});

test("withBuiltSlot writes a spec into a rank slot (scale: slot 1; replace: next free slot at most)", () => {
  const r = B.withBuiltSlot(rawTree(), "s", 1, { template: "ac", base: 1, step: 1 }, "effect");
  assert.equal(r.ok, true);
  assert.deepEqual(r.tree.nodes[0].grant, { mode: "effect", perRank: "scale", ranks: [{ built: { template: "ac", params: {}, base: 1, step: 1 } }] });
  assert.equal(normalizeTree(r.tree).nodes[0].grant.ranks[0].built.template, "ac", "the tree normalizer keeps it");
  assert.match(B.withBuiltSlot(rawTree(), "s", 2, { template: "ac" }, "effect").error, /slot 1/);
  assert.match(B.withBuiltSlot(rawTree(), "s", 1, { template: "ac", base: 1, step: 5 }, "effect").error, /rank 3/);
  assert.equal(B.withBuiltSlot(rawTree(), "rep", 2, { template: "ac" }, "item").ok, true);
  assert.match(B.withBuiltSlot(rawTree(), "rep", 3, { template: "ac" }, "item").error, /Fill rank slot 2 first/);
  assert.match(B.withBuiltSlot(rawTree(), "ghost", 1, { template: "ac" }, "item").error, /isn't in the tree/);
  assert.match(B.withBuiltSlot(rawTree(), "s", 1, { template: "ac" }, "none").error, /effect or an item/);
  const t = rawTree(); B.withBuiltSlot(t, "s", 1, { template: "ac" }, "effect");
  assert.equal(t.nodes[0].grant.mode, "none", "the input isn't changed");
});

// ---------------------------------------------------------------- the grant engine with built slots
const builtTree = (perRank = "scale", mode = "effect") => normalizeTree({
  id: "alpha", name: "Alpha", nodes: [{ id: "b", name: "Built", maxRanks: 3, text: "t", grant: { mode, perRank, ranks: [{ built: { template: "ac", base: 1, step: 1 } }, { built: { template: "speed", base: 10 } }] } }]
});
const picks = r => P.normalizePicks({ v: 1, ranks: { alpha: { b: r } } });

test("desiredGrants: built slots grant (key, rank, src from the spec), and nothing with built off", () => {
  const [g] = G.desiredGrants(picks(2), [builtTree()]);
  assert.equal(g.key, "alpha.b");
  assert.equal(g.rank, 2);
  assert.match(g.src, /^built:/);
  assert.equal(g.suffix, false);
  assert.deepEqual(g.built, { template: "ac", params: {}, base: 1, step: 1 });
  assert.deepEqual(G.desiredGrants(picks(2), [builtTree()], { built: false }), []);
  const rep = G.desiredGrants(picks(2), [builtTree("replace")])[0];
  assert.equal(rep.key, "alpha.b.2");
  assert.equal(rep.built.template, "speed");
});

/** A fake actor applying plans as grants.mjs does (built updates included). */
function fake() {
  let n = 0; const docs = [];
  return {
    docs,
    existing: () => docs.map(d => ({ id: d.id, type: d.docType, tag: d.flags["wanderers-path"].granted })),
    apply(plan) {
      for (const r of [...plan.remove, ...plan.replace]) docs.splice(docs.findIndex(d => d.id === r.id), 1);
      for (const { grant, hash } of [...plan.create, ...plan.replace]) docs.push({ ...G.copyData(G.builtSource(grant).data, grant, { hash, inCompendium: false, actorUuid: "Actor.hero" }), id: `d${++n}`, docType: grant.type });
      for (const u of plan.update) {
        const d = docs.find(x => x.id === u.id);
        d.flags["wanderers-path"].granted = G.tagFor(u.grant, u.hash);
        const b = G.builtRankUpdate(u.grant, { effects: (d.effects ?? []).map((e, i) => ({ _id: `e${i}`, flags: e.flags })) });
        if (u.type === "ActiveEffect") d.system.changes = b.effect["system.changes"];
        else { d.system.description.value = b.item["system.description.value"]; b.effects.forEach((e, i) => { d.effects[i].system.changes = e["system.changes"]; }); }
      }
    }
  };
}
const plan = (actor, desired) => {
  const rough = G.reconcilePlan(desired, actor.existing());
  return G.withSources(rough, new Map(G.sourcesNeeded(rough).map(g => [G.srcKey(g), G.builtSource(g).hash])));
};

test("reconcile with built grants: create, scale rank rewrites the values in place, idempotent, refund removes", () => {
  const a = fake();
  a.apply(plan(a, G.desiredGrants(picks(1), [builtTree()])));
  assert.equal(a.docs.length, 1);
  assert.deepEqual(a.docs[0].system.changes, [ch("system.attributes.ac.bonus", "add", "1")]);
  assert.deepEqual(a.docs[0]._stats, { compendiumSource: null, duplicateSource: null });
  assert.equal(a.docs[0].name, "Built", "no (r/max) suffix on a built copy");
  const id = a.docs[0].id;
  const p2 = plan(a, G.desiredGrants(picks(3), [builtTree()]));
  assert.deepEqual([p2.create.length, p2.replace.length, p2.update.length], [0, 0, 1]);
  a.apply(p2);
  assert.equal(a.docs[0].id, id, "same copy");
  assert.deepEqual(a.docs[0].system.changes, [ch("system.attributes.ac.bonus", "add", "3")]);
  assert.equal(G.planSize(plan(a, G.desiredGrants(picks(3), [builtTree()]))), 0, "planning again changes nothing");
  // A refresh with the same spec finds the hash unchanged (rank-free).
  const d = G.desiredGrants(picks(3), [builtTree()]);
  assert.equal(G.planSize(G.reconcilePlan(d, a.existing(), { hashes: new Map(d.map(g => [G.srcKey(g), G.builtSource(g).hash])), refresh: true })), 0);
  a.apply(plan(a, []));
  assert.equal(a.docs.length, 0);
});

test("built item grants: the feat's transfer effect gets the new rank's values", () => {
  const a = fake();
  a.apply(plan(a, G.desiredGrants(picks(1), [builtTree("scale", "item")])));
  assert.equal(a.docs[0].type, "feat");
  a.apply(plan(a, G.desiredGrants(picks(2), [builtTree("scale", "item")])));
  assert.deepEqual(a.docs[0].effects[0].system.changes, [ch("system.attributes.ac.bonus", "add", "2")]);
  assert.match(a.docs[0].system.description.value, /\+2 AC/);
});

test("a changed spec replaces the copy (new src); another node text only counts on Refresh", () => {
  const a = fake();
  a.apply(plan(a, G.desiredGrants(picks(1), [builtTree()])));
  const other = normalizeTree({ id: "alpha", nodes: [{ id: "b", name: "Built", maxRanks: 3, grant: { mode: "effect", ranks: [{ built: { template: "ac", base: 2, step: 1 } }] } }] });
  const p = plan(a, G.desiredGrants(picks(1), [other]));
  assert.equal(p.replace.length, 1);
  const textOnly = normalizeTree({ id: "alpha", nodes: [{ id: "b", name: "Built", maxRanks: 3, text: "new text", grant: { mode: "effect", ranks: [{ built: { template: "ac", base: 1, step: 1 } }] } }] });
  const d = G.desiredGrants(picks(1), [textOnly]);
  assert.equal(G.planSize(plan(a, d)), 0, "structural reconcile ignores it");
  const r = G.reconcilePlan(d, a.existing(), { hashes: new Map(d.map(g => [G.srcKey(g), G.builtSource(g).hash])), refresh: true });
  assert.equal(r.replace.length, 1, "Refresh re-builds it");
});

test("builder window state and HTML (escaped, no stale parameters)", () => {
  const trees = [normalizeTree(rawTree())];
  const s = BV.buildState({ tree: "alpha", node: "s", template: "speed", params: { move: "fly" }, base: "10", step: "5" }, trees);
  assert.deepEqual(s, { tree: "alpha", node: "s", slot: 1, mode: "effect", template: "speed", params: { move: "fly" }, base: 10, step: 5 });
  const sw = BV.buildState({ ...s, template: "ac", prevTemplate: "speed" }, trees);
  assert.deepEqual([sw.base, sw.step, sw.params], [1, 1, {}], "a new template starts from its defaults");
  const html = BV.builderHTML(s, trees, { supported: true });
  assert.match(html, /\+X ft flying speed per rank: 10 \/ 15 \/ 20/);
  assert.match(html, /data-action="save"(?! disabled)/);
  const bad = BV.builderHTML({ ...s, base: 200 }, trees, { supported: false });
  assert.match(bad, /data-action="save" disabled/);
  assert.match(bad, /need Foundry 14 and dnd5e 6/);
  const evil = [normalizeTree({ id: "x", name: "<img src=x>", nodes: [{ id: "n", name: "<b>" }] })];
  const h2 = BV.builderHTML(BV.buildState({}, evil), evil, { supported: true });
  assert.ok(!h2.includes("<img src=x>") && !h2.includes("<b>"));
  assert.match(BV.builderHTML(BV.buildState({}, []), [], { supported: true }), /No trees are published/);
  assert.deepEqual(BV.readForm({ tree: "a", "p.move": "fly", junk: "x" }), { tree: "a", params: { move: "fly" } });
  const rep = BV.buildState({ tree: "alpha", node: "rep", slot: "9" }, trees);
  assert.deepEqual([rep.slot, rep.mode], [2, "item"], "replace nodes: up to the next free slot; the node's mode by default");
});
