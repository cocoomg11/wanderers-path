/**
 * Shared constants and tiny helpers. The module id lives only here and in module.json. No Foundry calls at import time, so every
 * pure file can import this in Node. The text helpers come from the vendored wanderers-core.
 */
export { esc, plural } from "../vendor/wanderers-core/index.mjs";

export const ID = "my-module";
export const TITLE = "My Module";
/** Hooks we fire (see README, Public API and hooks). */
export const HOOKS = { ready: `${ID}.ready` };
