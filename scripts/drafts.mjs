/**
 * The tree editor's drafts: the GM-only store (core `createStore`). One Journal Entry named "Wanderer's Path drafts (GM only)",
 * ownership None, filed in the shared "Module data" folder, its data in `flags.wanderers-path.drafts` (shape and rules in
 * draft-model.mjs). Not secrecy: a None-ownership journal still reaches players' clients; it keeps drafts out of the tree compendium
 * and out of players' windows. Every write is a GM click in the editor (Save draft, Publish, Discard, Delete); the active GM's client
 * only files the entry once per load. Untested in Node beyond core's fakes.
 */
import { createStore } from "../vendor/wanderers-core/foundry/index.mjs";
import { ID } from "./const.mjs";
import { leader, warn } from "./core.mjs";
import { normalizeDrafts, withDraft, withoutDraft, evicted } from "./draft-model.mjs";

export const STORE_NAME = "Wanderer's Path drafts (GM only)";
/** The data flag and the entry's marker flag (never rename: worlds find the entry by them). */
export const DRAFTS_FLAG = "drafts";
export const ENTRY_FLAG = "draftsEntry";

export const Store = createStore(ID, {
  name: STORE_NAME, flagKey: DRAFTS_FLAG, entryFlag: ENTRY_FLAG, normalize: normalizeDrafts, keys: ["drafts"],
  about: "Unpublished talent tree drafts from Wanderer's Path's tree editor. Publish a draft in the tree editor to make it visible to players; Remove Wanderer's Path data (Drafts) deletes this entry.",
  log: { warn }, isWriter: () => leader.isLeader()
});

/** The drafts (GM; players get the empty store). @returns {import("./draft-model.mjs").DraftStore} */
export const read = () => (game.user?.isGM ? normalizeDrafts(Store.read()) : normalizeDrafts(null));

/**
 * Saves a tree as its draft (GM click). Resolves to the drafts the save dropped past the cap (oldest first to go), usually none;
 * rejects with the store's reason (e.g. its size limit).
 * @param {import("./tree-model.mjs").Tree} tree @param {import("./tree-model.mjs").Tree | null} published
 * @returns {Promise<{ id: string, name: string }[]>}
 */
export async function save(tree, published) {
  /** @type {{ id: string, name: string }[]} */ let lost = [];
  await Store.update(d => { const next = withDraft(d, tree, { published, at: Date.now() }); lost = evicted(d, next, tree.id); return next; });
  return lost;
}

/** Drops a tree's draft (GM click). Nothing is written when there is none. @param {string} id */
export async function discard(id) {
  if (!read().drafts[id]) return;
  await Store.update(d => withoutDraft(d, id));
}

/** Files the entry in "Module data" (the leader, once per load). */
export const file = () => Store.file();
/** Deletes the store entry (cleanup). */
export const remove = () => Store.remove();
/** For the health check. */
export const status = () => Store.status();
