/**
 * Every socket request Wanderer's Path accepts, as wanderers-core request schemas (pure; tested in Node). Players (and GM tabs that
 * aren't the leader) send these with `leader.request(kind, data)`; the leader reads each one through its schema before the handler
 * runs, and the handler gets Foundry's sender user (never a user field in the payload). `from: "gm"` kinds refuse players.
 *
 * Notices back to one user go out as the leader's broadcast hook NOTICE_HOOK (never a raw socket message).
 */
import { defineRequests } from "../vendor/wanderers-core/index.mjs";
import { NODE_ID_RE, MAX_RANKS } from "./tree-model.mjs";
import { AWARD_MAX, REASON_MAX } from "./picks-model.mjs";

const ID = "wanderers-path";
export const NOTICE_HOOK = `${ID}.notice`;
/** @type {any} */ const actorId = { type: "id" };
/** @type {any} */ const ref = { type: "string", pattern: NODE_ID_RE, max: 64 };

export const REQUESTS = defineRequests(/** @type {any} */ ({
  /** Learn: the new rank of each changed node (ranks only go up; the leader checks every rule and the pool). */
  pathLearn: {
    fields: { actorId, changes: { type: "array", max: 200, of: { type: "object", fields: { tree: ref, node: ref, to: { type: "number", int: true, min: 1, max: MAX_RANKS } } } } },
    maxBytes: 16 * 1024
  },
  /** Refund: one rank of a node (`all`: every rank), a whole tree (no node) or every tree (no tree). Players only while player respec is on. */
  pathRefund: { fields: { actorId, tree: { ...ref, optional: true }, node: { ...ref, optional: true }, all: { type: "boolean", optional: true } }, maxBytes: 512 },
  /** GM: award (or take back) points with a reason. */
  pathAward: { fields: { actorId, n: { type: "number", int: true, min: -AWARD_MAX, max: AWARD_MAX }, reason: { type: "string", max: REASON_MAX } }, from: "gm", maxBytes: 1024 },
  /** GM: talents on / off for this character, or back to the world's setting. */
  pathEnable: { fields: { actorId, enabled: { type: "string", oneOf: ["on", "off", "world"] } }, from: "gm", maxBytes: 256 },
  /** GM: add a tree to this character by hand, remove one, or back to automatic (by class and subclass). */
  pathTrees: { fields: { actorId, tree: ref, op: { type: "string", oneOf: ["add", "remove", "auto"] } }, from: "gm", maxBytes: 256 },
  /** GM: make this character's granted documents again from their sources (no actorId: every character). */
  pathRefresh: { fields: { actorId: { ...actorId, optional: true } }, from: "gm", maxBytes: 256 },
  /** GM: refund the ranks in trees and talents that are no longer published (no actorId: every character). */
  pathOrphans: { fields: { actorId: { ...actorId, optional: true } }, from: "gm", maxBytes: 256 }
}));

/**
 * A notice payload read for this client: { level, text } when it is for `me` (or everyone), else null.
 * @param {unknown} payload @param {string | undefined} me
 */
export function readNotice(payload, me) {
  const p = /** @type {any} */ (payload);
  if (!p || typeof p !== "object" || typeof p.text !== "string" || !p.text) return null;
  if (p.to !== null && p.to !== me) return null;
  return { level: p.level === "warn" || p.level === "error" ? p.level : "info", text: p.text.slice(0, 300) };
}

/**
 * The `changes` a Learn sends: every node whose pending rank is above the stored rank.
 * @param {Record<string, Record<string, number>>} stored @param {Record<string, Record<string, number>>} pending
 */
export function learnChanges(stored, pending) {
  const out = [];
  for (const [tree, map] of Object.entries(pending ?? {})) for (const [node, to] of Object.entries(map ?? {})) if (to > (stored?.[tree]?.[node] ?? 0)) out.push({ tree, node, to });
  return out;
}

/** The pending ranks a Learn request stands for: the stored ranks with each change applied. */
export function pendingFrom(/** @type {Record<string, Record<string, number>>} */ stored, /** @type {{ tree: string, node: string, to: number }[]} */ changes) {
  /** @type {Record<string, Record<string, number>>} */ const out = {};
  for (const c of changes) (out[c.tree] ??= { ...(stored?.[c.tree] ?? {}) })[c.node] = c.to;
  return out;
}
