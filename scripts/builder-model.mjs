/**
 * The feature builder, part A, pure (tested in Node: tests/builder-model.test.mjs). No Foundry calls.
 *
 * A rank slot of a node's grant can hold a template spec instead of a UUID: `{ built: { template, params, base, step } }`. The
 * builder turns it into dnd5e-native data: an Active Effect (grant mode "effect") or a feat item carrying one transfer effect (grant
 * mode "item"). The value X of a rank is `base + step × (rank − 1)`; templates that don't scale ignore it.
 *
 * Every change key was checked against dnd5e 6.0.6 (its data models and `ActiveEffect5e.SHIM_FIELDS`; none of the keys below is a
 * shimmed legacy key) and uses Foundry 14's change shape `{ key, type, value, phase, priority }` stored in `system.changes`, as in
 * dnd5e 6.0.6's own compendium effects. Built grants therefore need Foundry 14 and dnd5e 6 (`builderSupported`).
 *
 * Names are generic: the effect and the item are named after the GM's node; the template texts are plain rules words.
 */
import { esc } from "../vendor/wanderers-core/index.mjs";

/** @typedef {{ key: string, type: "add" | "upgrade" | "downgrade" | "override", value: string, phase: "initial", priority: null }} Change */
/** @typedef {{ template: string, params: Record<string, string>, base: number, step: number }} Spec */
/** @typedef {{ name: string, img: string, text: string }} NodeFacts what the copy is named after (the GM's node) */

/** dnd5e 6.0.6 `CONFIG.DND5E.abilities` keys. */
export const ABILITIES = Object.freeze({ str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" });
/** dnd5e 6.0.6 `CONFIG.DND5E.skills` keys. */
export const SKILLS = Object.freeze({
  acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics", dec: "Deception", his: "History", ins: "Insight",
  itm: "Intimidation", inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception", prf: "Performance", per: "Persuasion",
  rel: "Religion", slt: "Sleight of Hand", ste: "Stealth", sur: "Survival"
});
/** dnd5e 6.0.6 `CONFIG.DND5E.movementTypes` keys. */
export const MOVES = Object.freeze({ walk: "walking", burrow: "burrowing", climb: "climbing", fly: "flying", jump: "jumping", swim: "swimming" });
/** dnd5e 6.0.6 `CONFIG.DND5E.senses` keys. */
export const SENSES = Object.freeze({ darkvision: "Darkvision", blindsight: "Blindsight", tremorsense: "Tremorsense", truesight: "Truesight" });
/** dnd5e 6.0.6 `CONFIG.DND5E.damageTypes` keys. */
export const DAMAGE = Object.freeze({
  acid: "acid", bludgeoning: "bludgeoning", cold: "cold", fire: "fire", force: "force", lightning: "lightning", necrotic: "necrotic",
  piercing: "piercing", poison: "poison", psychic: "psychic", radiant: "radiant", slashing: "slashing", thunder: "thunder"
});
/** dnd5e 6.0.6 `CONFIG.DND5E.conditionTypes` keys that are real conditions (not `pseudo`). */
export const CONDITIONS = Object.freeze({
  blinded: "blinded", charmed: "charmed", deafened: "deafened", exhaustion: "exhaustion", frightened: "frightened", grappled: "grappled",
  incapacitated: "incapacitated", invisible: "invisible", paralyzed: "paralyzed", petrified: "petrified", poisoned: "poisoned",
  prone: "prone", restrained: "restrained", stunned: "stunned", unconscious: "unconscious"
});
/** dnd5e 6.0.6 `CONFIG.DND5E.armorProficiencies` keys. */
export const ARMOR = Object.freeze({ lgt: "light armor", med: "medium armor", hvy: "heavy armor", shl: "shields" });
/** dnd5e 6.0.6 `CONFIG.DND5E.weaponProficiencies` keys (a single weapon's key, such as `dagger`, is accepted too). */
export const WEAPONS = Object.freeze({ sim: "simple weapons", mar: "martial weapons" });
/** A dnd5e key the world may extend (tools, languages, single weapons): lower-case letters, digits, "-" and "_". */
export const KEY_RE = /^[a-z][a-z0-9_-]{0,39}$/;
/** The default image of a built effect or item (Foundry core). */
export const DEFAULT_IMG = "icons/svg/upgrade.svg";

const BONUS_TARGETS = Object.freeze({ skill: "one skill", check: "one ability's checks", save: "one ability's saving throws", skills: "all skill checks", checks: "all ability checks", saves: "all saving throws", initiative: "initiative" });
const ADV_TARGETS = Object.freeze({ save: "one ability's saving throws", check: "one ability's checks", skill: "one skill", initiative: "initiative" });
const PROF_KINDS = Object.freeze({ skill: "a skill", save: "a saving throw", tool: "a tool", weapon: "weapons", armor: "armor", language: "a language" });
const DEFENSE_KINDS = Object.freeze({ dr: "Resistance", di: "Immunity", dv: "Vulnerability", ci: "Condition immunity" });
const HP_PER = Object.freeze({ level: "per character level", overall: "in total" });
const LEVELS = Object.freeze({ 1: "proficiency", 2: "expertise" });

/**
 * A parameter: `options` (fixed keys → plain labels) or `free` (a key matching KEY_RE). `when(params)` false = not used.
 * @typedef {{ key: string, label: string, options?: Readonly<Record<string, string>>, free?: string, dflt: string, when?: (p: Record<string, string>) => boolean, optionsFor?: (p: Record<string, string>) => Readonly<Record<string, string>> }} Param
 */
/**
 * @typedef {object} Template
 * @property {string} id @property {string} label plain-language name @property {string} hint
 * @property {Param[]} params @property {boolean} scales whether X matters
 * @property {[number, number]} range allowed X
 * @property {[number, number]} [start] default base and step (else [range low, 1] when it scales, [0, 0] when not)
 * @property {(p: Record<string, string>, x: number) => string} text what one rank gives, in plain words
 * @property {(p: Record<string, string>) => string} phrase the same with "X" for the per-rank preview
 * @property {(p: Record<string, string>, x: number) => string} [show] how a value reads in the preview line
 * @property {(p: Record<string, string>, x: number) => { key: string, type: Change["type"], value: string }[]} changes
 */

/** @param {number} x */
const signed = x => (x < 0 ? `${x}` : `+${x}`);
const oneOf = (/** @type {Record<string, string>} */ p) => (p.target === "skill" ? SKILLS[p.key] : ABILITIES[p.key]) ?? p.key;
/** @param {Record<string, string>} p */
const bonusWhat = p => ({ skill: `${oneOf(p)} checks`, check: `${oneOf(p)} checks`, save: `${oneOf(p)} saving throws`, skills: "all skill checks", checks: "all ability checks", saves: "all saving throws", initiative: "initiative" })[p.target] ?? p.target;
/** @param {Record<string, string>} p */
const keyOptions = p => (p.target === "skill" || p.kind === "skill" ? SKILLS : ABILITIES);
const needsKey = (/** @type {Record<string, string>} */ p) => ["skill", "check", "save"].includes(p.target);
const crit = (/** @type {number} */ x) => `${20 - x}–20`;

/** @type {readonly Template[]} */
export const TEMPLATES = Object.freeze([
  {
    id: "ac", label: "Armor Class bonus", hint: "+X to AC.", params: [], scales: true, range: [1, 10],
    text: (_p, x) => `${signed(x)} AC`, phrase: () => "+X AC",
    changes: (_p, x) => [{ key: "system.attributes.ac.bonus", type: "add", value: `${x}` }]
  },
  {
    id: "speed", label: "Speed bonus", hint: "+X feet to one kind of speed (a speed the character lacks starts at X).", scales: true, range: [5, 120], start: [5, 5],
    params: [{ key: "move", label: "Speed", options: MOVES, dflt: "walk" }],
    text: (p, x) => `${signed(x)} ft ${MOVES[p.move]} speed`, phrase: p => `+X ft ${MOVES[p.move]} speed`,
    changes: (p, x) => [{ key: `system.attributes.movement.speeds.${p.move}`, type: "add", value: `${x}` }]
  },
  {
    id: "sense", label: "Darkvision or another sense", hint: "The sense reaches X feet (a longer range the character has stays).", scales: true, range: [5, 300], start: [60, 0],
    params: [{ key: "sense", label: "Sense", options: SENSES, dflt: "darkvision" }],
    text: (p, x) => `${SENSES[p.sense]} ${x} ft`, phrase: p => `${SENSES[p.sense]} X ft`,
    changes: (p, x) => [{ key: `system.attributes.senses.ranges.${p.sense}`, type: "upgrade", value: `${x}` }]
  },
  {
    id: "bonus", label: "Bonus to a roll", hint: "+X to a skill, an ability's checks or saving throws, all of them, or initiative.", scales: true, range: [1, 20],
    params: [
      { key: "target", label: "Roll", options: BONUS_TARGETS, dflt: "skill" },
      { key: "key", label: "Which", options: SKILLS, optionsFor: keyOptions, dflt: "prc", when: needsKey }
    ],
    text: (p, x) => `${signed(x)} to ${bonusWhat(p)}`, phrase: p => `+X to ${bonusWhat(p)}`,
    changes: (p, x) => {
      const key = ({
        skill: `system.skills.${p.key}.roll.bonus`, check: `system.abilities.${p.key}.check.roll.bonus`, save: `system.abilities.${p.key}.save.roll.bonus`,
        skills: "system.rolls.ability.skill.bonus", checks: "system.rolls.ability.check.bonus", saves: "system.rolls.ability.save.bonus",
        initiative: "system.attributes.init.roll.bonus"
      })[p.target];
      return [{ key, type: "add", value: `${x}` }];
    }
  },
  {
    id: "advantage", label: "Advantage on a roll", hint: "Advantage on an ability's saving throws or checks, a skill, or initiative.", scales: false, range: [0, 0],
    params: [
      { key: "target", label: "Roll", options: ADV_TARGETS, dflt: "save" },
      { key: "key", label: "Which", options: ABILITIES, optionsFor: keyOptions, dflt: "wis", when: needsKey }
    ],
    text: p => `Advantage on ${bonusWhat(p)}`, phrase: p => `Advantage on ${bonusWhat(p)}`,
    changes: p => {
      const key = ({ save: `system.abilities.${p.key}.save.roll.mode`, check: `system.abilities.${p.key}.check.roll.mode`, skill: `system.skills.${p.key}.roll.mode`, initiative: "system.attributes.init.roll.mode" })[p.target];
      return [{ key, type: "add", value: "1" }];
    }
  },
  {
    id: "proficiency", label: "Proficiency or expertise", hint: "A skill, a saving throw, a tool, weapons, armor or a language.", scales: false, range: [0, 0],
    params: [
      { key: "kind", label: "In", options: PROF_KINDS, dflt: "skill" },
      { key: "key", label: "Which", options: SKILLS, dflt: "ath", when: p => p.kind === "skill" },
      { key: "key", label: "Which", options: ABILITIES, dflt: "con", when: p => p.kind === "save" },
      { key: "key", label: "Which", options: ARMOR, dflt: "lgt", when: p => p.kind === "armor" },
      { key: "key", label: "Tool key", free: "the dnd5e tool key, such as alchemist or thief", dflt: "thief", when: p => p.kind === "tool" },
      { key: "key", label: "Weapons", options: WEAPONS, free: "sim, mar, or one weapon's key such as dagger", dflt: "mar", when: p => p.kind === "weapon" },
      { key: "key", label: "Language key", free: "the dnd5e language key, such as common or elvish", dflt: "common", when: p => p.kind === "language" },
      { key: "level", label: "Level", options: LEVELS, dflt: "1", when: p => p.kind === "skill" || p.kind === "tool" }
    ],
    text: p => profText(p), phrase: p => profText(p),
    changes: p => {
      if (p.kind === "skill") return [{ key: `system.skills.${p.key}.value`, type: "upgrade", value: p.level }];
      if (p.kind === "save") return [{ key: `system.abilities.${p.key}.proficient`, type: "upgrade", value: "1" }];
      if (p.kind === "tool") return [{ key: `system.tools.${p.key}.value`, type: "upgrade", value: p.level }];
      const trait = ({ weapon: "weaponProf", armor: "armorProf", language: "languages" })[p.kind];
      return [{ key: `system.traits.${trait}.value`, type: "add", value: p.key }];
    }
  },
  {
    id: "defense", label: "Resistance, immunity or vulnerability", hint: "To a damage type, or immunity to a condition.", scales: false, range: [0, 0],
    params: [
      { key: "kind", label: "Kind", options: DEFENSE_KINDS, dflt: "dr" },
      { key: "type", label: "Damage type", options: DAMAGE, dflt: "fire", when: p => p.kind !== "ci" },
      { key: "type", label: "Condition", options: CONDITIONS, dflt: "poisoned", when: p => p.kind === "ci" }
    ],
    text: p => defenseText(p), phrase: p => defenseText(p),
    changes: p => [{ key: `system.traits.${p.kind}.value`, type: "add", value: p.type }]
  },
  {
    id: "ability", label: "Ability score bonus", hint: "+X to one ability score.", scales: true, range: [1, 10],
    params: [{ key: "ability", label: "Ability", options: ABILITIES, dflt: "str" }],
    text: (p, x) => `${signed(x)} ${ABILITIES[p.ability]}`, phrase: p => `+X ${ABILITIES[p.ability]}`,
    changes: (p, x) => [{ key: `system.abilities.${p.ability}.value`, type: "add", value: `${x}` }]
  },
  {
    id: "hp", label: "Extra hit points", hint: "+X maximum hit points per character level, or in total.", scales: true, range: [1, 100],
    params: [{ key: "per", label: "Counted", options: HP_PER, dflt: "level" }],
    text: (p, x) => `${signed(x)} hit points${p.per === "level" ? " per level" : ""}`, phrase: p => `+X hit points${p.per === "level" ? " per level" : ""}`,
    changes: (p, x) => [{ key: `system.attributes.hp.bonuses.${p.per}`, type: "add", value: `${x}` }]
  },
  {
    id: "crit", label: "Wider critical range", hint: "Weapon attacks score a critical hit on a lower roll: X = 1 means 19–20.", scales: true, range: [1, 5],
    params: [],
    text: (_p, x) => `Weapon critical hits on ${crit(x)}`, phrase: () => "Weapon critical hits on", show: (_p, x) => crit(x),
    changes: (_p, x) => [{ key: "flags.dnd5e.weaponCriticalThreshold", type: "downgrade", value: `${20 - x}` }]
  }
]);

/** @param {Record<string, string>} p */
function profText(p) {
  if (p.kind === "skill") return `${p.level === "2" ? "Expertise" : "Proficiency"} in ${SKILLS[p.key] ?? p.key}`;
  if (p.kind === "tool") return `${p.level === "2" ? "Expertise" : "Proficiency"} with a tool (${p.key})`;
  if (p.kind === "save") return `Proficiency in ${ABILITIES[p.key] ?? p.key} saving throws`;
  if (p.kind === "armor") return `Proficiency with ${ARMOR[p.key] ?? p.key}`;
  if (p.kind === "weapon") return `Proficiency with ${WEAPONS[p.key] ?? `a weapon (${p.key})`}`;
  return `Knows a language (${p.key})`;
}
/** @param {Record<string, string>} p */
function defenseText(p) {
  if (p.kind === "ci") return `Immunity to the ${CONDITIONS[p.type] ?? p.type} condition`;
  return `${DEFENSE_KINDS[p.kind] ?? p.kind} to ${DAMAGE[p.type] ?? p.type} damage`;
}

/** The template with that id, or null. @param {unknown} id */
export const templateOf = id => TEMPLATES.find(t => t.id === id) ?? null;

/** The parameters a template uses with these values (the first matching definition of each key). @param {Template} t @param {Record<string, string>} p */
export function activeParams(t, p) {
  /** @type {Param[]} */ const out = []; const seen = new Set();
  for (const d of t.params) {
    if (seen.has(d.key) || (d.when && !d.when(p))) continue;
    seen.add(d.key); out.push(d);
  }
  return out;
}
/** The options a parameter offers with these values. @param {Param} d @param {Record<string, string>} p */
export const optionsOf = (d, p) => (d.optionsFor ? d.optionsFor(p) : d.options) ?? null;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v @param {number} dflt */
const int = (v, dflt) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? Math.round(n) : dflt; };

/**
 * A stored spec read leniently: unknown templates give null; parameters are filled with defaults, then each is kept when the
 * template uses it (a bad value is kept as text so `specIssues` can name it). Base 1 and step 0 by default (step 1 for templates that scale).
 * @param {unknown} raw @param {{ fit?: boolean }} [o] @returns {Spec | null}
 */
export function normalizeSpec(raw, { fit = false } = {}) {
  if (!isObj(raw)) return null;
  const t = templateOf(raw.template); if (!t) return null;
  const given = isObj(raw.params) ? raw.params : {};
  /** @type {Record<string, string>} */ const p = {};
  // Defaults first (in order, so a later parameter's `when` sees the earlier ones), then what was given.
  for (let pass = 0; pass < 2; pass++) {
    for (const d of activeParams(t, p)) {
      const v = given[d.key];
      let val = typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, 40) : p[d.key] ?? d.dflt;
      // `fit` (the builder window): a value the parameter doesn't take now (another kind was chosen) goes back to its default.
      const opts = optionsOf(d, p);
      if (fit && !(opts && val in opts) && !(d.free && KEY_RE.test(val))) val = d.dflt;
      p[d.key] = val;
    }
  }
  /** @type {Record<string, string>} */ const params = {};
  for (const d of activeParams(t, p)) params[d.key] = p[d.key];
  const [b0, s0] = t.start ?? (t.scales ? [t.range[0], 1] : [0, 0]);
  return { template: t.id, params, base: t.scales ? int(raw.base, b0) : 0, step: t.scales ? int(raw.step, s0) : 0 };
}

/** X at a rank. @param {Spec} s @param {number} rank */
export const valueAt = (s, rank) => s.base + s.step * (Math.max(1, Math.round(rank)) - 1);

/**
 * What is wrong with a spec (plain text, [] when it can be built), checked for ranks 1 to `maxRanks`.
 * @param {unknown} raw @param {{ maxRanks?: number }} [o] @returns {string[]}
 */
export function specIssues(raw, { maxRanks = 1 } = {}) {
  const s = normalizeSpec(raw);
  if (!s) return [isObj(raw) && raw.template ? `There is no template "${String(raw.template).slice(0, 40)}".` : "A built rank needs a template."];
  const t = /** @type {Template} */ (templateOf(s.template));
  const out = [];
  for (const d of activeParams(t, s.params)) {
    const v = s.params[d.key]; const opts = optionsOf(d, s.params);
    if (opts && v in opts) continue;
    if (d.free && KEY_RE.test(v)) continue;
    out.push(`${d.label}: "${v}" isn't one of the choices${d.free ? ` (${d.free})` : ""}.`);
  }
  if (t.scales) {
    if (!Number.isInteger(s.base) || !Number.isInteger(s.step)) out.push("X needs whole numbers.");
    const [lo, hi] = t.range;
    for (let r = 1; r <= Math.min(5, Math.max(1, maxRanks)); r++) {
      const x = valueAt(s, r);
      if (x < lo || x > hi) { out.push(`At rank ${r} X would be ${x}; ${t.label} takes ${lo} to ${hi}.`); break; }
    }
  }
  return out;
}

/** The plain sentence a spec gives at a rank ("" when it can't be built). @param {unknown} raw @param {number} [rank] */
export function specText(raw, rank = 1) {
  const s = normalizeSpec(raw); if (!s || specIssues(s, { maxRanks: rank }).length) return "";
  return /** @type {Template} */ (templateOf(s.template)).text(s.params, valueAt(s, rank));
}

/**
 * The preview line: "+X AC per rank: 1 / 2 / 3" for a value that scales, else the sentence (with "(every rank)" on multi-rank nodes).
 * @param {unknown} raw @param {number} [maxRanks]
 */
export function previewLine(raw, maxRanks = 1) {
  const s = normalizeSpec(raw); if (!s) return "";
  const issues = specIssues(s, { maxRanks }); if (issues.length) return issues[0];
  const t = /** @type {Template} */ (templateOf(s.template));
  const n = Math.min(5, Math.max(1, Math.round(maxRanks)));
  if (!t.scales || n === 1) return `${t.text(s.params, valueAt(s, 1))}${n > 1 ? " (every rank)" : ""}`;
  const show = t.show ?? ((_p, x) => String(x));
  const vals = Array.from({ length: n }, (_, i) => show(s.params, valueAt(s, i + 1)));
  if (s.step === 0) return `${t.text(s.params, valueAt(s, 1))} (every rank)`;
  return `${t.phrase(s.params)} per rank: ${vals.join(" / ")}`;
}

/**
 * The changes a spec makes at a rank (Foundry 14 shape), or [] when it can't be built.
 * @param {unknown} raw @param {number} rank @returns {Change[]}
 */
export function buildChanges(raw, rank) {
  const s = normalizeSpec(raw); if (!s || specIssues(s, { maxRanks: rank }).length) return [];
  const t = /** @type {Template} */ (templateOf(s.template));
  return t.changes(s.params, valueAt(s, rank)).map(c => ({ key: c.key, type: c.type, value: c.value, phase: /** @type {const} */ ("initial"), priority: null }));
}

/** The description of a built item at a rank (HTML, escaped): the sentence, then the node's own text. @param {unknown} raw @param {number} rank @param {NodeFacts} node */
export function builtDescription(raw, rank, node) {
  return `<p>${esc(specText(raw, rank))}</p>${node.text ? `<p>${esc(node.text)}</p>` : ""}`;
}

/**
 * dnd5e-native data for one rank (pure; the grant engine tags it and names it): an Active Effect for grant mode "effect", or a
 * feat item carrying one transfer effect for mode "item". Null when the spec can't be built.
 * `buildTemplate(spec, rank)` without node facts names it after the template.
 * @param {unknown} raw @param {number} rank @param {{ mode?: "item" | "effect", node?: Partial<NodeFacts> }} [o]
 * @returns {Record<string, any> | null}
 */
export function buildTemplate(raw, rank, { mode = "effect", node = {} } = {}) {
  const s = normalizeSpec(raw);
  const changes = buildChanges(s, rank); if (!s || !changes.length) return null;
  const t = /** @type {Template} */ (templateOf(s.template));
  const facts = { name: String(node.name ?? "").trim() || t.label, img: String(node.img ?? "").trim() || DEFAULT_IMG, text: String(node.text ?? "") };
  const effect = (/** @type {boolean} */ transfer) => ({
    name: facts.name, img: facts.img, type: "base", disabled: false, transfer, description: esc(specText(s, rank)),
    system: { changes }, flags: { "wanderers-path": { built: { template: s.template, rank } } }
  });
  if (mode === "effect") return effect(false);
  return {
    name: facts.name, type: "feat", img: facts.img,
    system: { description: { value: builtDescription(s, rank, facts) }, type: { value: "feat", subtype: "" } },
    effects: [effect(true)], flags: { "wanderers-path": { built: { template: s.template, rank } } }
  };
}

/**
 * Whether built grants can run here: Foundry 14 (change `type`, `system.changes`) and dnd5e 6 (the 6.0 data paths).
 * @param {{ generation?: number, system?: string, systemVersion?: string }} f
 */
export function builderSupported(f) {
  const major = Number(String(f.systemVersion ?? "").split(".")[0]);
  return Number(f.generation) >= 14 && f.system === "dnd5e" && Number.isFinite(major) && major >= 6;
}

/** Every template for the API and the window: [{ id, label, hint, scales, range, params: [{ key, label, options, free, dflt }] }] (copies, no functions). */
export function templateList() {
  return TEMPLATES.map(t => ({
    id: t.id, label: t.label, hint: t.hint, scales: t.scales, range: [...t.range],
    params: t.params.map(d => ({ key: d.key, label: d.label, options: d.options ? { ...d.options } : null, free: d.free ?? null, dflt: d.dflt }))
  }));
}

/**
 * `api.builder.preview(spec, rank)`: { ok, issues, text (at that rank), line (per rank up to `maxRanks`), changes, spec (normalized) }.
 * @param {unknown} raw @param {number} [rank] @param {number} [maxRanks]
 */
export function preview(raw, rank = 1, maxRanks = Math.max(3, Math.round(rank) || 1)) {
  const r = Math.min(5, Math.max(1, Math.round(Number(rank)) || 1));
  const issues = specIssues(raw, { maxRanks: Math.max(r, maxRanks) });
  const spec = normalizeSpec(raw);
  return { ok: !issues.length, issues, text: specText(raw, r), line: previewLine(raw, maxRanks), changes: buildChanges(raw, r), spec };
}

/**
 * A stored tree (raw flag data) with a built spec written into one rank slot of one node. Pure: returns a new object.
 *   - the node's grant mode becomes `mode` ("item" or "effect");
 *   - "scale" nodes use slot 1 only; "replace" nodes take slots 1 to max ranks, and a new slot can only follow the existing ones.
 * @param {unknown} rawTree @param {string} nodeId @param {number} slot 1-based
 * @param {unknown} rawSpec @param {"item" | "effect"} mode
 * @returns {{ ok: true, tree: Record<string, any> } | { ok: false, error: string }}
 */
export function withBuiltSlot(rawTree, nodeId, slot, rawSpec, mode) {
  if (!isObj(rawTree) || !Array.isArray(rawTree.nodes)) return { ok: false, error: "That tree can't be read." };
  if (mode !== "item" && mode !== "effect") return { ok: false, error: "Choose whether the talent grants an effect or an item." };
  const spec = normalizeSpec(rawSpec); if (!spec) return { ok: false, error: "Choose a template." };
  const tree = structuredClone(rawTree);
  const node = tree.nodes.find((/** @type {any} */ n) => isObj(n) && n.id === nodeId);
  if (!node) return { ok: false, error: "That talent isn't in the tree." };
  const max = Math.min(5, Math.max(1, int(node.maxRanks, 1)));
  const issues = specIssues(spec, { maxRanks: max }); if (issues.length) return { ok: false, error: issues[0] };
  const g = isObj(node.grant) ? node.grant : {};
  const perRank = g.perRank === "replace" ? "replace" : "scale";
  const ranks = Array.isArray(g.ranks) ? g.ranks.filter(isObj).slice(0, 5) : [];
  const s = Math.round(Number(slot));
  if (perRank === "scale" && s !== 1) return { ok: false, error: "This talent scales one grant with its rank: build rank slot 1." };
  if (!Number.isInteger(s) || s < 1 || s > max) return { ok: false, error: `Choose a rank slot from 1 to ${max}.` };
  if (s > ranks.length + 1) return { ok: false, error: `Fill rank slot ${ranks.length + 1} first.` };
  ranks[s - 1] = { built: spec };
  node.grant = { ...g, mode, perRank, ranks };
  return { ok: true, tree };
}
