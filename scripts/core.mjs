/**
 * The one place that binds wanderers-core to this module: the feature registry, the settings table, debug logging and the
 * one-writer leader with our request schemas. Everything else imports F, S, leader, log and warn from here. Core is vendored in
 * vendor/wanderers-core/ and is never edited by hand. Importing this file calls nothing in Foundry; `leader.start()` runs in "ready".
 */
import { createFeatures, createSettings, createLogger, createLeader } from "../vendor/wanderers-core/foundry/index.mjs";
import { createAutomationRegistry } from "./automation-model.mjs";
import { records } from "../vendor/wanderers-core/index.mjs";
import { TITLE, ID, HOOKS } from "./const.mjs";
import { REQUESTS, NOTICE_HOOK } from "./requests-model.mjs";

/**
 * Features: one world setting per tool (`feature-<id>`, reload). A turned-off tool registers nothing (no hooks, buttons, key
 * bindings or socket handlers) and its API entry is undefined. Setting keys are stable: never rename one.
 */
export const F = createFeatures(ID, [
  { id: "talents", label: "Talents", hint: "Talent trees for characters: the talent window, learning and refunds." },
  { id: "sheetButton", label: "Character sheet button", hint: "A Talents button in the character sheet's header menu.", needs: ["talents"] },
  { id: "keybindings", label: "Key binding", hint: "An Open talents action in Configure Controls (no key assigned by default).", needs: ["talents"] },
  { id: "moduleHooks", label: "Hooks for other modules", hint: "Fires wanderers-path.learned and wanderers-path.respec after talents change (ids only).", needs: ["talents"] },
  { id: "toolkitPage", label: "Toolkit sheet page", hint: "A Talents page (bookmark) on Wanderer's Toolkit's character sheet, when the toolkit (2.3.0 or later) is active with its sheet on. The talent window stays.", needs: ["talents"] },
  { id: "builder", label: "Feature builder", hint: "Build a talent's effect from plain-language templates (AC, speed, senses, roll bonuses, advantage, proficiencies, resistances, ability scores, hit points, critical range). Needs Foundry 14 and dnd5e 6.", needs: ["talents"] }
], { title: TITLE });

/** Points one setting change re-reads: open windows and the tree cache listen through this. */
const changed = new Set();
/** @param {() => void} fn */
export const onRulesChanged = fn => { changed.add(fn); };
const fire = () => { for (const fn of changed) { try { fn(); } catch (e) { console.warn(`${ID} |`, e); } } };

/** Every other setting is one row (shown in our Settings window, not in Configure Settings). Keys are stable. */
export const S = createSettings(ID, [
  { key: "treePack", type: "text", default: "", label: "Tree compendium", hint: "The world compendium (Journal Entries) that holds the published talent trees. Players need Observer on it.", tab: "rules", feature: "talents", onChange: fire },
  { key: "enabledForAll", type: "bool", default: true, label: "Talents for every character", hint: "Off: only characters a GM turns on have talents.", tab: "rules", feature: "talents", onChange: fire },
  { key: "unlockLevel", type: "number", default: 1, min: 1, max: 30, step: 1, label: "Talents open at level", hint: "A tree may set its own level instead.", tab: "rules", feature: "talents", onChange: fire },
  { key: "pointsFromLevel", type: "number", default: 2, min: 1, max: 30, step: 1, label: "First point at level", hint: "Characters get points from this level on.", tab: "rules", feature: "talents", onChange: fire },
  { key: "pointsPerLevel", type: "number", default: 1, min: 0, max: 10, step: 1, label: "Points per level", hint: "With the defaults: 19 points at level 20, plus GM awards.", tab: "rules", feature: "talents", onChange: fire },
  { key: "playerRespec", type: "bool", default: false, label: "Players may refund", hint: "On: players refund and reset their own talents for free (honour system). A GM can always respec for free.", tab: "rules", feature: "talents", onChange: fire },
  { key: "debugLog", type: "bool", default: false, label: "Debug logging", hint: "Write the module's automatic decisions to the browser console.", tab: "data", advanced: true }
], { reserved: F.FEATURES.map(f => f.key) });

/** Hidden record settings (never exported or imported by the Satchel). None yet. */
export const RECORDS = records(S.ROWS);

export const { log, warn } = createLogger(ID);

/** The one writer. Hook names it may broadcast: notices and our public hooks. */
export const leader = createLeader({ id: ID, log, requests: REQUESTS, hooks: [NOTICE_HOOK, HOOKS.learned, HOOKS.respec] });

/** External automation handlers (`api.registerAutomation`): stored, never invoked in this version (automation-model.mjs). */
export const AUTOMATIONS = createAutomationRegistry();
