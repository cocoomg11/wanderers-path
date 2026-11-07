/**
 * The one place that binds wanderers-core to this module: the feature registry, the settings table and debug logging. Everything
 * else imports F, S, log and warn from here. Core is vendored in vendor/wanderers-core/ and is never edited by hand.
 * The one-writer leader (core's createLeader, with "socket": true already in module.json) is added here with the first tool that
 * writes documents automatically or takes requests from players.
 */
import { createFeatures, createSettings, createLogger } from "../vendor/wanderers-core/foundry/index.mjs";
import { TITLE, ID } from "./const.mjs";

/**
 * Features: one world setting per tool (`feature-<id>`, reload). A turned-off tool registers nothing (no hooks, buttons, key
 * bindings or socket handlers) and its API entry is undefined. Setting keys are stable: never rename one. No tools yet.
 */
export const F = createFeatures(ID, [], { title: TITLE });

/** Every other setting is one row (hidden from Configure Settings until the module has a control panel). */
export const S = createSettings(ID, [
  { key: "debugLog", type: "bool", default: false, label: "Debug logging", hint: "Write the module's automatic decisions to the browser console.", tab: "data", advanced: true }
], { reserved: F.FEATURES.map(f => f.key) });

export const { log, warn } = createLogger(ID);
