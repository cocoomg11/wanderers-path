/**
 * My Module entry point: settings, hooks, buttons and the API (`game.modules.get("my-module").api`). The api exists from our init
 * hook; `my-module.ready` fires once at our ready hook for modules that load before us. wanderers-core is bound in core.mjs.
 */
import { ID, TITLE, HOOKS } from "./const.mjs";
import { F, S, leader, warn } from "./core.mjs";
import * as Health from "./health.mjs";
import * as Cleanup from "./cleanup.mjs";
import * as Example from "./example.mjs";

let isReady = false;
const gm = () => { if (game.user?.isGM) return true; ui.notifications.warn("GM only."); return false; };

export const API = {
  get version() { return game.modules.get(ID)?.version; },
  /** Read-only health report: [{ title, lines: [{ level, text }] }]. */
  health: () => Health.run(),
  /** Remove module data: plan(), dryRun(), remove(pick, "REMOVE"). */
  cleanup: { plan: () => Cleanup.plan(), dryRun: () => Cleanup.dryRunRows(), remove: (/** @type {Record<string, boolean>} */ pick, /** @type {string} */ word) => Cleanup.remove(pick, word) },
  /** The example tool. Undefined when its feature is off. */
  get example() { return F.on("example") ? { open: () => gm() ? Example.open() : undefined, notes: () => Example.notes(), add: (/** @type {string} */ text) => Example.add(text) } : undefined; },
  get isReady() { return isReady; },
  features: F
};

Hooks.once("init", () => {
  F.register({ config: true });
  S.register();
  const mod = game.modules.get(ID); if (mod) mod.api = API;

  // A turned-off feature registers nothing: no hooks, no buttons, no socket handlers.
  if (F.on("example")) Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;
    const tokens = controls.tokens ?? controls.token; if (!tokens?.tools) return;
    tokens.tools.myModuleExample = { name: "myModuleExample", title: `${TITLE}: example`, icon: "fa-solid fa-note-sticky", order: 130, button: true, visible: true, onChange: () => Example.open() };
  });
});

Hooks.once("ready", () => {
  isReady = true;
  leader.start();
  if (F.on("example")) leader.handle("exampleNote", Example.handleNote);
  // Optional: show up in the Wanderer's Satchel hub when it is installed (register() is part of its public API).
  try { game.modules.get("wanderers-satchel")?.api?.register({ id: ID, title: TITLE, health: () => Health.run() }); } catch (e) { warn("could not register with the Satchel", e); }
  Hooks.callAll(HOOKS.ready, API);
  console.log(`${ID} | ready (v${API.version})`);
});
