/**
 * The one place that binds wanderers-core to this module: the feature registry, the settings table, debug logging and the
 * one-writer leader. Everything else imports F, S, log and leader from here. Core is vendored in vendor/wanderers-core/ and is never
 * edited by hand (see TEMPLATE.md and CONVENTIONS.md in the core repo).
 */
import { createFeatures, createSettings, createLogger, createLeader } from "../vendor/wanderers-core/foundry/index.mjs";
import { defineRequests } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, HOOKS } from "./const.mjs";

/**
 * Features: one world setting per tool (`feature-<id>`, reload). A turned-off tool registers nothing (no hooks, buttons, key
 * bindings or socket handlers) and its API entry is undefined. Setting keys are stable: never rename one.
 */
export const F = createFeatures(ID, [
  { id: "example", label: "Example tool", hint: "The example tool that comes with the template: a scene control button that opens a small notes window. Delete or replace it." }
], { title: TITLE });

/**
 * Every other setting is one row. This module has no control panel, so the rows are registered hidden from Configure Settings
 * (`config: false`, core's default); add a panel that shows them by tab when the module needs one.
 */
export const S = createSettings(ID, [
  { key: "exampleNotes", type: "object", default: {}, hidden: true },
  { key: "debugLog", type: "bool", default: false, label: "Debug logging", hint: "Write the module's automatic decisions to the browser console.", tab: "data", advanced: true }
], { reserved: F.FEATURES.map(f => f.key) });

export const { log, warn } = createLogger(ID);

/** Socket requests the leader accepts: a schema per kind; anything else is refused. The sender is Foundry's, never a payload field. */
export const REQUESTS = defineRequests({
  exampleNote: { fields: { text: { type: "string", max: 500 } } }
});

/** `module.json` must have `"socket": true`. Automatic writes run only when `leader.isLeader()`. */
export const leader = createLeader({ id: ID, log, requests: REQUESTS, hooks: [HOOKS.ready] });
