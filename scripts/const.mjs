/**
 * Shared constants and tiny helpers. The module id lives only here and in module.json. No Foundry calls at import time, so every
 * pure file can import this in Node. The text helpers come from the vendored wanderers-core.
 */
export { esc, plural } from "../vendor/wanderers-core/index.mjs";

export const ID = "wanderers-path";
export const TITLE = "Wanderer's Path";
/** Hooks we fire (see README, Public API and hooks). `learned` / `respec` carry ids only. */
export const HOOKS = { ready: `${ID}.ready`, learned: `${ID}.learned`, respec: `${ID}.respec` };
/** Where a character's picks are stored: `flags.wanderers-path.picks`. */
export const PICKS_FLAG = "picks";
/** Where a published tree is stored on its JournalEntry: `flags.wanderers-path.tree`. */
export const TREE_FLAG = "tree";
/** Marks the readable page the tree editor writes into a tree's JournalEntry: `flags.wanderers-path.page` on the page (0.6.0). */
export const PAGE_FLAG = "page";
/** Wanderer's Toolkit (recommends only): its sheet takes our Talents page. */
export const TOOLKIT_ID = "wayfarers-toolkit";
