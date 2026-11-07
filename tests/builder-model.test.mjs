import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "../scripts/builder-model.mjs";
import * as BV from "../scripts/builder-view-model.mjs";
import * as G from "../scripts/grants-model.mjs";
import * as P from "../scripts/picks-model.mjs";
import { normalizeTree } from "../scripts/tree-model.mjs";
import * as A from "../scripts/automation-model.mjs";

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
  [{ template: "crit", base: 1, step: 1 }, 2, [ch("flags.dnd5e.weaponCriticalThreshold", "downgrade", "18")]],
  [{ template: "damageDie", params: { die: "6", type: "fire", on: "weapon" }, base: 1, step: 1 }, 2, [ch("system.rolls.damage.mwak.bonus", "add", "2d6[fire]"), ch("system.rolls.damage.rwak.bonus", "add", "2d6[fire]")]],
  [{ template: "damageDie", params: { die: "8", type: "radiant", on: "mwak" } }, 1, [ch("system.rolls.damage.mwak.bonus", "add", "1d8[radiant]")]],
  [{ template: "damageDie", params: { die: "4", type: "cold", on: "rwak" } }, 1, [ch("system.rolls.damage.rwak.bonus", "add", "1d4[cold]")]],
  [{ template: "damageDie", params: { die: "10", type: "force", on: "spell" } }, 1, [ch("system.rolls.damage.msak.bonus", "add", "1d10[force]"), ch("system.rolls.damage.rsak.bonus", "add", "1d10[force]")]],
  [{ template: "damageDie", params: { die: "12", type: "acid", on: "all" } }, 1, ["mwak", "rwak", "msak", "rsak"].map(k => ch(`system.rolls.damage.${k}.bonus`, "add", "1d12[acid]"))]
];

const SPELL = "Compendium.world.spells.Item.abcdefghijklmnop";
const KEY = "alpha.b";
const ID16 = B.activityId(KEY);
const spend = { type: "itemUses", target: "", value: "1", scaling: {} };
const custom = (formula, type) => ({ number: null, denomination: 0, bonus: "", types: [type], custom: { enabled: true, formula }, scaling: { number: 1 } });
// Snapshot of every item-only template's feat `system` extras (dnd5e 6.0.6 activity data, as its own packs).
const ITEM_SNAPSHOTS = [
  [{ template: "uses", params: { action: "utility", period: "sr", activation: "bonus" }, base: 1, step: 1 }, 2, {
    uses: { max: "2", spent: 0, recovery: [{ period: "sr", type: "recoverAll" }] },
    activities: { [ID16]: { _id: ID16, type: "utility", name: "", sort: 0, activation: { type: "bonus", value: null, override: false, condition: "" },
      consumption: { targets: [spend], scaling: { allowed: false }, spellSlot: true }, roll: { formula: "", name: "", prompt: false, visible: false } } }
  }],
  [{ template: "uses", params: { action: "heal", formula: "1d10 + @prof", heal: "healing", who: "self" } }, 1, {
    uses: { max: "1", spent: 0, recovery: [{ period: "lr", type: "recoverAll" }] },
    activities: { [ID16]: { _id: ID16, type: "heal", name: "", sort: 0, activation: { type: "action", value: null, override: false, condition: "" },
      consumption: { targets: [spend], scaling: { allowed: false }, spellSlot: true }, healing: custom("1d10 + @prof", "healing"),
      range: { units: "self", override: false }, target: { affects: { type: "self", choice: false }, override: false, prompt: false } } }
  }],
  [{ template: "uses", params: { action: "heal", formula: "5", heal: "temphp", who: "creature" } }, 1, {
    uses: { max: "1", spent: 0, recovery: [{ period: "lr", type: "recoverAll" }] },
    activities: { [ID16]: { _id: ID16, type: "heal", name: "", sort: 0, activation: { type: "action", value: null, override: false, condition: "" },
      consumption: { targets: [spend], scaling: { allowed: false }, spellSlot: true }, healing: custom("5", "temphp"),
      range: { units: "touch", override: false }, target: { affects: { type: "creature", count: "1", choice: false }, override: false, prompt: false } } }
  }],
  [{ template: "uses", params: { action: "damage", formula: "2d6", type: "thunder", activation: "reaction" }, base: 2, step: 1 }, 3, {
    uses: { max: "4", spent: 0, recovery: [{ period: "lr", type: "recoverAll" }] },
    activities: { [ID16]: { _id: ID16, type: "damage", name: "", sort: 0, activation: { type: "reaction", value: null, override: false, condition: "" },
      consumption: { targets: [spend], scaling: { allowed: false }, spellSlot: true }, damage: { critical: { allow: false, bonus: "" }, parts: [custom("2d6", "thunder")] },
      range: { units: "spec", override: false }, target: { affects: { type: "creature", count: "1", choice: false }, override: false, prompt: false } } }
  }],
  [{ template: "spell", params: { spell: SPELL, cost: "uses", period: "lr", ability: "wis", book: "yes" }, base: 1, step: 1 }, 3, {
    uses: { max: "3", spent: 0, recovery: [{ period: "lr", type: "recoverAll" }] }, properties: ["mgc"],
    activities: { [ID16]: { _id: ID16, type: "cast", name: "", sort: 0, activation: { type: "", override: false, condition: "" },
      consumption: { targets: [spend], scaling: { allowed: false }, spellSlot: true },
      spell: { uuid: SPELL, spellbook: true, ability: "wis", level: null, properties: [], challenge: { override: false } } } }
  }],
  [{ template: "spell", params: { spell: SPELL, cost: "free", book: "no" } }, 1, {
    properties: ["mgc"],
    activities: { [ID16]: { _id: ID16, type: "cast", name: "", sort: 0, activation: { type: "", override: false, condition: "" },
      consumption: { targets: [], scaling: { allowed: false }, spellSlot: true },
      spell: { uuid: SPELL, spellbook: false, ability: "", level: null, properties: [], challenge: { override: false } } } }
  }],
  [{ template: "describe", params: { automation: "my-mod.thorns" } }, 1, {}]
];
/** The feat's `system` minus what every built feat has. */
const extras = sys => { const { description, type, ...rest } = sys; return rest; };

test("every template's changes (snapshots)", () => {
  for (const [spec, rank, want] of SNAPSHOTS) assert.deepEqual(B.buildChanges(spec, rank), want, JSON.stringify(spec));
  for (const [spec, rank, want] of ITEM_SNAPSHOTS) {
    const it = B.buildTemplate(spec, rank, { mode: "item", node: { name: "Node", text: "Its text" }, key: KEY });
    assert.deepEqual(extras(it.system), want, JSON.stringify(spec));
    assert.deepEqual(it.effects, [], "item-only templates carry no effect");
  }
  const covered = new Set([...SNAPSHOTS, ...ITEM_SNAPSHOTS].map(s => s[0].template));
  assert.deepEqual(B.TEMPLATES.map(t => t.id).filter(id => !covered.has(id)), [], "every template has a snapshot");
});

test("activity ids: 16 letters and digits, stable per grant key, different per key", () => {
  assert.match(ID16, /^[A-Za-z0-9]{16}$/);
  assert.equal(B.activityId(KEY), ID16);
  assert.notEqual(B.activityId("alpha.c"), ID16);
  assert.notEqual(B.activityId("alpha.b.2"), ID16);
});

test("item-only templates: item mode only, validators, preview lines", () => {
  assert.equal(B.buildTemplate({ template: "uses" }, 1, { mode: "effect" }), null, "no effect form");
  assert.match(B.specIssues({ template: "uses", params: { action: "heal", formula: "rm -rf; drop" } })[0], /Formula/);
  assert.match(B.specIssues({ template: "uses", params: { action: "heal", formula: "" } })[0], /Formula/);
  assert.deepEqual(B.specIssues({ template: "uses", params: { action: "heal", formula: "2d8 + @abilities.wis.mod" } }), []);
  assert.match(B.specIssues({ template: "spell" })[0], /Spell: drop a spell/);
  assert.match(B.specIssues({ template: "spell", params: { spell: "Actor.abcdefghijklmnop" } })[0], /won't do/);
  assert.deepEqual(B.specIssues({ template: "spell", params: { spell: "Item.abcdefghijklmnop" } }), [], "world items too");
  assert.match(B.specIssues({ template: "describe", params: { automation: "bad key!" } })[0], /Automation key/);
  assert.match(B.specIssues({ template: "damageDie", base: 11 })[0], /takes 1 to 10/);
  assert.equal(B.previewLine({ template: "uses", params: { action: "heal", formula: "1d8" }, base: 1, step: 1 }, 3), "X uses per long rest: regain 1d8 hit points per rank: 1 / 2 / 3");
  assert.equal(B.previewLine({ template: "uses", params: { action: "damage", formula: "2d6", type: "fire", period: "sr" }, base: 2, step: 0 }, 2), "2 uses per short rest: 2d6 fire damage (every rank)");
  assert.equal(B.previewLine({ template: "damageDie", params: { die: "6", type: "fire", on: "weapon" }, base: 1, step: 1 }, 3), "+Xd6 fire damage on weapon attacks per rank: 1d6 / 2d6 / 3d6");
  assert.equal(B.previewLine({ template: "spell", params: { spell: SPELL, cost: "uses" } }, 1), "Casts the chosen spell without a spell slot, 1 time per long rest");
  assert.equal(B.previewLine({ template: "spell", params: { spell: SPELL, cost: "free" }, base: 5, step: 5 }, 3), "Casts the chosen spell without a spell slot, at will (every rank)");
  assert.deepEqual(B.normalizeSpec({ template: "spell", params: { spell: SPELL, cost: "free" }, base: 5 }), { template: "spell", params: { spell: SPELL, cost: "free", ability: "", book: "yes" }, base: 0, step: 0 }, "at will: X unused");
  const d = B.buildTemplate({ template: "describe" }, 1, { mode: "item", node: { name: "N", text: "Thorns <b>hurt</b>" } });
  assert.equal(d.system.description.value, "<p>Thorns &lt;b&gt;hurt&lt;/b&gt;</p>", "the node's text only");
  // damageDie is an ordinary effect template: both modes.
  assert.equal(B.buildTemplate({ template: "damageDie" }, 1, { mode: "effect" }).system.changes.length, 2);
  assert.equal(B.buildTemplate({ template: "damageDie" }, 1, { mode: "item" }).effects.length, 1);
});

test("withBuiltSlot: item-only templates need item mode; describe sets or clears the node's automation", () => {
  const t = { v: 1, id: "alpha", nodes: [{ id: "n", name: "N", grant: { mode: "none", ranks: [] }, automation: { kind: "external", key: "k1", data: { a: 1 } } }] };
  assert.match(B.withBuiltSlot(t, "n", 1, { template: "uses" }, "effect").error, /feature item/);
  const same = B.withBuiltSlot(t, "n", 1, { template: "describe", params: { automation: "k1" } }, "item");
  assert.deepEqual(same.tree.nodes[0].automation, { kind: "external", key: "k1", data: { a: 1 } }, "same key keeps its data");
  const other = B.withBuiltSlot(t, "n", 1, { template: "describe", params: { automation: "k2" } }, "item");
  assert.deepEqual(other.tree.nodes[0].automation, { kind: "external", key: "k2", data: {} });
  assert.equal(normalizeTree(other.tree).nodes[0].automation.key, "k2", "the tree normalizer keeps it");
  assert.equal(B.withBuiltSlot(t, "n", 1, { template: "describe" }, "item").tree.nodes[0].automation, null);
  assert.deepEqual(B.withBuiltSlot(t, "n", 1, { template: "ac" }, "effect").tree.nodes[0].automation, t.nodes[0].automation, "other templates leave it");
});

test("no extra damage key is a shimmed system.bonuses key; the change shape matches dnd5e 6.0.6's packs", () => {
  for (const c of B.buildChanges({ template: "damageDie", params: { on: "all" } }, 1)) {
    assert.match(c.key, /^system\.rolls\.damage\.(mwak|rwak|msak|rsak)\.bonus$/);
    assert.deepEqual(Object.keys(c), ["key", "type", "value", "phase", "priority"]);
  }
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
  assert.deepEqual(list.map(t => t.id), ["ac", "speed", "sense", "bonus", "advantage", "proficiency", "defense", "ability", "hp", "crit", "damageDie", "uses", "spell", "describe"]);
  assert.deepEqual(list.filter(t => t.itemOnly).map(t => t.id), ["uses", "spell", "describe"]);
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

// ---------------------------------------------------------------- part B: item-only templates in the grant engine
const usesTree = (spec) => normalizeTree({ id: "alpha", name: "Alpha", nodes: [{ id: "b", name: "Built", maxRanks: 3, text: "t", grant: { mode: "item", ranks: [{ built: spec }] } }] });

test("uses per rest: a rank change updates uses.max and the activity in place (same id, no _id/type rewrite)", () => {
  const spec = { template: "uses", params: { action: "heal", formula: "1d8" }, base: 1, step: 1 };
  const [g1] = G.desiredGrants(picks(1), [usesTree(spec)]);
  const d1 = G.builtSource(g1).data;
  const id = Object.keys(d1.system.activities)[0];
  assert.equal(id, B.activityId("alpha.b"), "the id comes from the grant key");
  assert.equal(d1.system.uses.max, "1");
  const [g3] = G.desiredGrants(picks(3), [usesTree(spec)]);
  assert.equal(G.builtSource(g3).hash, G.builtSource(g1).hash, "the source hash is rank-free");
  assert.equal(Object.keys(G.builtSource(g3).data.system.activities)[0], id, "same activity id at every rank");
  const u = G.builtRankUpdate(g3, { effects: [] });
  assert.equal(u.item["system.uses.max"], "3");
  assert.ok(!("system.uses.spent" in u.item), "spent uses are kept");
  const a = u.item[`system.activities.${id}`];
  assert.equal(a.healing.custom.formula, "1d8");
  assert.ok(!("_id" in a) && !("type" in a));
  assert.deepEqual(u.effects, []);
  // The structural plan sees only a rank change: an update, not a replace.
  const a1 = fake(); a1.apply(plan(a1, [g1]));
  const p = plan(a1, [g3]);
  assert.deepEqual([p.create.length, p.replace.length, p.update.length], [0, 0, 1]);
});

test("grant a spell: the cast activity keeps its id across ranks; a new spell is a new spec (replace)", () => {
  const spec = { template: "spell", params: { spell: "Compendium.world.spells.Item.abcdefghijklmnop" }, base: 1, step: 1 };
  const [g1] = G.desiredGrants(picks(1), [usesTree(spec)]);
  const [g2] = G.desiredGrants(picks(2), [usesTree(spec)]);
  const id = Object.keys(G.builtSource(g1).data.system.activities)[0];
  const u = G.builtRankUpdate(g2);
  assert.equal(u.item["system.uses.max"], "2");
  assert.equal(u.item[`system.activities.${id}`].spell.uuid, spec.params.spell);
  const a = fake(); a.apply(plan(a, [g1]));
  const other = { ...spec, params: { spell: "Compendium.world.spells.Item.ponmlkjihgfedcba" } };
  assert.equal(plan(a, G.desiredGrants(picks(1), [usesTree(other)])).replace.length, 1);
  assert.equal(G.builtSource({ ...g1, mode: "effect", type: "ActiveEffect" }), null, "no effect form");
});

test("replace-per-rank slots get their own activity ids (grant key per slot)", () => {
  const t = normalizeTree({ id: "alpha", nodes: [{ id: "b", maxRanks: 2, grant: { mode: "item", perRank: "replace", ranks: [{ built: { template: "uses" } }, { built: { template: "uses" } }] } }] });
  const [r1] = G.desiredGrants(picks(1), [t]); const [r2] = G.desiredGrants(picks(2), [t]);
  assert.notEqual(Object.keys(G.builtSource(r1).data.system.activities)[0], Object.keys(G.builtSource(r2).data.system.activities)[0]);
});

test("automation registry: stored, never invoked; health lines list keys and waiting talents", () => {
  const r = A.createAutomationRegistry();
  let ran = 0;
  assert.equal(r.register("my-mod.thorns", () => { ran++; }), true);
  assert.equal(r.register("bad key!", () => {}), false);
  assert.equal(r.register("x", "not a function"), false);
  assert.equal(r.register("", () => {}), false);
  assert.deepEqual(r.keys(), ["my-mod.thorns"]);
  assert.equal(ran, 0, "nothing runs a handler");
  const trees = [normalizeTree({ id: "t", name: "T", nodes: [
    { id: "a", name: "A", automation: { kind: "external", key: "my-mod.thorns" } },
    { id: "b", name: "B", automation: { kind: "external", key: "other.key" } },
    { id: "c", name: "C" }
  ] })];
  const nodes = A.automationNodes(trees, k => r.has(k));
  assert.deepEqual(nodes.map(n => [n.node, n.registered]), [["A", true], ["B", false]]);
  const lines = A.automationLines(r.keys(), nodes);
  assert.ok(lines.every(l => l.level === "info"));
  assert.match(lines[0].text, /my-mod\.thorns/);
  assert.match(lines[1].text, /T › B \(other\.key\)/);
  assert.match(A.automationLines([], [])[0].text, /No talent uses/);
});

test("builder window, part B: item-only templates force item mode; spell picker states; save waits for a checked spell", () => {
  const trees = [normalizeTree(rawTree())];
  const s = BV.buildState({ tree: "alpha", node: "s", mode: "effect", template: "uses", params: { action: "heal", formula: "2d4" } }, trees);
  assert.equal(s.mode, "item");
  const h = BV.builderHTML(s, trees, { supported: true });
  assert.match(h, /type="hidden" name="mode" value="item"/);
  assert.match(h, /name="p\.formula" value="2d4"/);
  assert.match(h, /data-action="save"(?! disabled)/);
  const sp = BV.buildState({ tree: "alpha", node: "s", template: "spell", params: { spell: "Compendium.world.spells.Item.abcdefghijklmnop" } }, trees);
  assert.match(BV.builderHTML(sp, trees, { supported: true }), /data-action="save" disabled/, "unchecked spell");
  const ok = BV.spellInfo(sp.params.spell, { name: "Spark <i>", type: "spell" });
  const h2 = BV.builderHTML(sp, trees, { supported: true, spell: ok });
  assert.match(h2, /data-wp-drop="spell"/);
  assert.match(h2, /Spark &lt;i&gt;/);
  assert.match(h2, /data-action="save"(?! disabled)/);
  const notSpell = BV.spellInfo(sp.params.spell, { name: "Rope", type: "loot" });
  assert.match(BV.builderHTML(sp, trees, { supported: true, spell: notSpell }), /Rope isn&#39;t a spell|Rope isn't a spell/);
  assert.equal(BV.spellInfo("x", null).ok, false);
  assert.match(BV.spellInfo(sp.params.spell, null).error, /No item has that UUID/);
  assert.deepEqual(BV.parseItemUuid("Compendium.world.spells.Item.abcdefghijklmnop"), { pack: "world.spells", id: "abcdefghijklmnop" });
  assert.deepEqual(BV.parseItemUuid("Item.abcdefghijklmnop"), { pack: null, id: "abcdefghijklmnop" });
  assert.equal(BV.parseItemUuid("JournalEntry.abcdefghijklmnop"), null);
  // A typed UUID survives a redraw (fit keeps free text).
  assert.equal(BV.buildState({ ...sp, params: { spell: "Compend" } }, trees).params.spell, "Compend");
  const d = BV.builderHTML(BV.buildState({ tree: "alpha", node: "s", template: "describe" }, trees), trees, { supported: true });
  assert.match(d, /api\.registerAutomation/);
});
