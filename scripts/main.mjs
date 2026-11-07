/**
 * Wanderer's Path entry point: settings (`init`), the API (`game.modules.get("wanderers-path").api`, set in `init`) and the
 * `wanderers-path.ready` hook (fired once in `ready`). wanderers-core is bound in core.mjs.
 * Scaffold only: no tools are registered yet. Talent content is never shipped; it lives in each world.
 */
import { ID, HOOKS } from "./const.mjs";
import { F, S, log } from "./core.mjs";

let isReady = false;

export const API = {
  get version() { return game.modules.get(ID)?.version; },
  get isReady() { return isReady; },
  features: F
};

Hooks.once("init", () => {
  F.register({ config: true });
  S.register();
  const mod = game.modules.get(ID); if (mod) mod.api = API;
  log("init: settings registered, no tools yet");
});

Hooks.once("ready", () => {
  isReady = true;
  log(`ready (v${API.version})`);
  Hooks.callAll(HOOKS.ready, API);
});
