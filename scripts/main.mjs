/**
 * Wanderer's Path entry point: features and settings (`init`), the API (`game.modules.get("wanderers-path").api`, set in `init`),
 * the tool's hooks, the sheet button, the key binding, the leader's request handlers (`ready`), the Wanderer's Satchel registration
 * and the `wanderers-path.ready` hook (fired once in `ready`). Everything a tool adds is gated by `F.on(...)`. Talent content is
 * never shipped; it lives in each world's tree compendium.
 */
import { registerOpenKeybinding, registerWindowPlacement } from "../vendor/wanderers-core/foundry/index.mjs";
import { ID, TITLE, HOOKS } from "./const.mjs";
import { F, S, RECORDS, log, warn } from "./core.mjs";
import * as Trees from "./trees.mjs";
import * as Path from "./path.mjs";
import * as Health from "./health.mjs";
import * as Cleanup from "./cleanup.mjs";
import * as Win from "./window.mjs";
import * as SetWin from "./settings-window.mjs";
import { registration, registerWith, SATCHEL_ID } from "./satchel-model.mjs";
import * as SheetPage from "./sheet-page.mjs";
import * as Builder from "./builder.mjs";
import { templateList, preview } from "./builder-model.mjs";

let isReady = false;

const clone = (/** @type {unknown} */ v) => structuredClone(v);

export const API = {
  get version() { return game.modules.get(ID)?.version; },
  get isReady() { return isReady; },
  features: F,
  /** Opens the talent window of a character (Actor, id or UUID; default: your character or the selected token's). Undefined when off. */
  get open() { return F.on("talents") ? (/** @type {any} */ actor) => Win.openWindow(actor ?? Win.defaultActor()) : undefined; },
  /** The published trees (copies). Undefined when off. */
  get trees() { return F.on("talents") ? async () => clone(await Trees.loadTrees()) : undefined; },
  /** A character's points { level, fromLevel, awards, total, spent, available, byTree }, or null. Undefined when off. */
  get points() {
    if (!F.on("talents")) return undefined;
    return async (/** @type {any} */ a) => { const actor = Path.actorFrom(a); if (!actor || !actor.testUserPermission?.(game.user, "OBSERVER")) return null; return clone((await Path.stateOf(actor)).points); };
  },
  /**
   * GM: makes granted items and effects match the learned talents again, re-copying those whose source changed. An Actor, id or
   * UUID; no argument (or "all"): every character. Returns whether the request was sent. Undefined when off.
   */
  get refresh() {
    if (!F.on("talents")) return undefined;
    return (/** @type {any} */ a) => {
      if (!game.user?.isGM) { ui.notifications.warn(`${TITLE}: GM only.`); return false; }
      if (a === undefined || a === null || a === "all") return Path.send("pathRefresh", {});
      const actor = Path.actorFrom(a); if (!actor) { ui.notifications.warn(`${TITLE}: no such character.`); return false; }
      return Path.send("pathRefresh", { actorId: actor.id });
    };
  },
  /** Read-only health report: [{ title, lines: [{ level, text }] }] (GM; players get []). */
  healthReport: (/** @type {{ timeoutMs?: number }} */ opts = {}) => Health.report(opts),
  /** Remove module data (GM): plan(), dryRun(), remove(pick, "REMOVE"). */
  cleanup: { plan: () => Cleanup.plan(), dryRun: () => Cleanup.dryRunRows(), remove: (/** @type {Record<string, boolean>} */ pick, /** @type {string} */ word) => Cleanup.remove(pick, word) },
  /** Opens the GM's Settings window (rules, health, Remove data). */
  settings: () => SetWin.openSettings(),
  /**
   * The feature builder (part A): `templates()` (every template, plain data), `preview(spec, rank?, maxRanks?)` ({ ok, issues, text,
   * line, changes, spec }), `open()` (GM: the Build a talent effect window). Undefined when the feature is off.
   */
  get builder() {
    if (!F.on("builder")) return undefined;
    return Object.freeze({
      templates: () => templateList(),
      preview: (/** @type {unknown} */ spec, /** @type {number} */ rank = 1, /** @type {number | undefined} */ maxRanks) => clone(preview(spec, rank, maxRanks)),
      open: () => Builder.openBuilder()
    });
  }
};

Hooks.once("init", () => {
  F.register({ config: true });
  S.register();
  registerWindowPlacement(ID);
  const mod = game.modules.get(ID); if (mod) mod.api = API;
  SetWin.registerMenu();
  if (F.on("talents")) {
    Trees.registerHooks();
    Win.registerHooks();
    if (F.on("sheetButton")) Hooks.on("getHeaderControlsActorSheetV2", (/** @type {any} */ app, /** @type {any[]} */ controls) => Win.addHeaderControl(app, controls));
    if (F.on("keybindings")) {
      try { registerOpenKeybinding({ moduleId: ID, action: "path", name: "Open talents", hint: "Opens your character's talents (a GM: the selected token's character).", onDown: () => { Win.openFromKey(); } }); }
      catch (e) { warn("key binding", e); }
    }
  }
  log("init: settings registered");
});

Hooks.once("ready", () => {
  if (F.on("talents")) { Path.registerHandlers(); Path.start(); }
  if (F.on("toolkitPage")) SheetPage.ready();
  isReady = true;
  // Optional: show up in the Wanderer's Satchel hub when it is installed.
  const reg = registration({
    id: ID, title: TITLE,
    // Open: the selected token's character; with none selected, the Settings window (false = the Satchel opens openPanel).
    open: () => { const a = F.on("talents") ? Win.defaultActor() : null; return a ? Win.openWindow(a) ?? false : false; }, openLabel: "Talents",
    openPanel: () => SetWin.openSettings() ?? false,
    health: opts => Health.report(opts), records: RECORDS, debugKey: "debugLog"
  });
  registerWith(reg, {
    active: () => !!game.modules.get(SATCHEL_ID)?.active,
    api: () => game.modules.get(SATCHEL_ID)?.api,
    once: (hook, fn) => Hooks.once(hook, fn),
    warn: (msg, e) => warn(msg, e ?? "")
  });
  log(`ready (v${API.version})`);
  Hooks.callAll(HOOKS.ready, API);
});
