/**
 * The grant engine's Foundry half: reads a character's tagged copies, loads the source documents in bulk (one `getDocuments` per
 * compendium, world documents with `fromUuidSync`; never a fromUuid per node) and applies a plan from grants-model.mjs. Writes run
 * only on the leader. Untested in Node: needs a live world (the plan and the copy data are tested in grants-model).
 */
import { ID } from "./const.mjs";
import { leader, log, warn } from "./core.mjs";
import * as G from "./grants-model.mjs";

/** @typedef {import("./grants-model.mjs").Grant} Grant */
/** @typedef {import("./grants-model.mjs").Plan} Plan */
/** @typedef {{ data: Record<string, any>, hash: string, inCompendium: boolean, advancement: boolean, name: string }} Source */

export const GRANTED_FLAG = "granted";

/** The tag on a document, raw (null when it has none). @param {any} doc */
export const tagOf = doc => doc?._source?.flags?.[ID]?.[GRANTED_FLAG] ?? doc?.flags?.[ID]?.[GRANTED_FLAG] ?? null;

/**
 * The actor's tagged items and effects (only the actor's own effects: an item's effects go with the item).
 * @param {any} actor @returns {(import("./grants-model.mjs").Existing & { advancement: boolean })[]}
 */
export function existingOf(actor) {
  const out = [];
  for (const i of actor?.items ?? []) { const tag = tagOf(i); if (tag) out.push({ id: i.id, type: /** @type {const} */ ("Item"), tag, name: String(i.name ?? ""), advancement: itemHasAdvancement(i) }); }
  for (const e of actor?.effects ?? []) { const tag = tagOf(e); if (tag) out.push({ id: e.id, type: /** @type {const} */ ("ActiveEffect"), tag, name: String(e.name ?? ""), advancement: false }); }
  return out;
}

/** dnd5e's `Item5e#hasAdvancement`, else the stored data. @param {any} item */
function itemHasAdvancement(item) {
  try { return typeof item?.hasAdvancement === "boolean" ? item.hasAdvancement : G.hasAdvancement(item?._source); } catch { return false; }
}

/** The data one grant copies from a loaded document, or null when the document can't give it. @param {any} doc @param {Grant} g */
function sourceData(doc, g) {
  if (!doc) return null;
  if (g.type === "Item") return doc.documentName === "Item" ? doc : null;
  if (doc.documentName === "ActiveEffect") return doc;
  // An effect grant pointing at an item: its first effect that transfers to the actor.
  if (doc.documentName === "Item") return doc.effects?.find?.((/** @type {any} */ e) => e.transfer) ?? null;
  return null;
}

/**
 * Loads the sources of these grants: one `pack.getDocuments({ _id__in })` per compendium, world documents synchronously.
 * Returns a map `srcKey(grant)` → Source (a grant whose source can't be found or doesn't fit is left out).
 * @param {Grant[]} grants @returns {Promise<Map<string, Source>>}
 */
export async function loadSources(grants) {
  /** @type {Map<string, Source>} */ const out = new Map();
  /** @type {Map<string, Set<string>>} */ const byPack = new Map();
  for (const g of grants) {
    // Built grants are generated, never loaded (their data carries our `built` marker, so no snapshot: it would drop it).
    if (g.built) { const b = G.builtSource(g); if (b) out.set(G.srcKey(g), { data: b.data, hash: b.hash, inCompendium: false, advancement: false, name: String(b.data.name ?? "") }); continue; }
    const where = G.parseUuid(g.src);
    if (where && "pack" in where) { const s = byPack.get(where.pack) ?? new Set(); s.add(where.id); byPack.set(where.pack, s); }
  }
  /** @type {Map<string, any>} */ const docs = new Map();
  for (const [key, ids] of byPack) {
    const pk = game.packs?.get(key);
    if (!pk || pk.documentName !== "Item") continue;
    try { for (const d of await pk.getDocuments({ _id__in: [...ids] })) docs.set(`${key}.${d.id}`, d); }
    catch (e) { warn(`couldn't read ${key}`, e); }
  }
  for (const g of grants) {
    const k = G.srcKey(g); if (out.has(k) || g.built) continue;
    const where = G.parseUuid(g.src); if (!where) continue;
    let doc = null;
    try {
      if ("pack" in where) { const item = docs.get(`${where.pack}.${where.id}`); doc = where.effect ? item?.effects?.get?.(where.effect) ?? null : item ?? null; }
      else doc = fromUuidSync(g.src, { strict: false });
    } catch { doc = null; }
    // A world UUID resolves to the document itself; a compendium index entry (no toObject) can't be copied.
    const src = sourceData(doc, g);
    if (!src || typeof src.toObject !== "function") continue;
    const snap = G.snapshot(src.toObject());
    out.set(k, { data: snap, hash: G.stableHash(snap), inCompendium: !!src.inCompendium, advancement: g.type === "Item" && G.hasAdvancement(snap), name: String(src.name ?? "") });
  }
  return out;
}

/** Hashes from loaded sources. @param {Map<string, Source>} sources */
export const hashesOf = sources => new Map([...sources].map(([k, s]) => [k, s.hash]));

/**
 * Applies a plan (leader only): deletes first (removals and the old copies of replacements), then creates, then rank updates.
 * Returns { created, removed, updated, advancement: names of created items that carry advancement }.
 * @param {any} actor @param {Plan} plan @param {Map<string, Source>} sources
 */
export async function applyPlan(actor, plan, sources) {
  if (!leader.isLeader()) throw new Error(`${ID}: only the leader writes granted documents`);
  const del = { Item: /** @type {string[]} */ ([]), ActiveEffect: /** @type {string[]} */ ([]) };
  for (const r of [...plan.remove, ...plan.replace]) if (!del[r.type].includes(r.id)) del[r.type].push(r.id);
  const make = { Item: /** @type {any[]} */ ([]), ActiveEffect: /** @type {any[]} */ ([]) };
  /** @type {string[]} */ const adv = [];
  for (const { grant, hash } of [...plan.create, ...plan.replace]) {
    const s = sources.get(G.srcKey(grant)); if (!s) continue;
    make[grant.type].push(G.copyData(s.data, grant, { hash, inCompendium: s.inCompendium, actorUuid: actor.uuid }));
    if (s.advancement) adv.push(s.name);
  }
  const upd = { Item: /** @type {any[]} */ ([]), ActiveEffect: /** @type {any[]} */ ([]) };
  /** @type {{ item: any, effects: any[] }[]} built items whose own effects get the new rank's values */
  const itemFx = [];
  for (const u of plan.update) {
    const doc = u.type === "Item" ? actor.items.get(u.id) : actor.effects.get(u.id); if (!doc) continue;
    const row = { _id: u.id, name: G.rankedName(doc.name, u.grant), [`flags.${ID}.${GRANTED_FLAG}`]: G.tagFor(u.grant, u.hash) };
    // A built copy: the rank's values are written into its effect (scale mode), the copy itself stays.
    const b = u.grant.built ? G.builtRankUpdate(u.grant, { effects: u.type === "Item" ? doc.effects?.map?.((/** @type {any} */ e) => ({ _id: e.id, flags: e.flags })) ?? [] : [] }) : null;
    if (b?.effect && u.type === "ActiveEffect") Object.assign(row, b.effect);
    if (b?.item) { Object.assign(row, b.item); if (b.effects.length) itemFx.push({ item: doc, effects: b.effects }); }
    upd[u.type].push(row);
  }
  let removed = 0, created = 0, updated = 0;
  for (const type of /** @type {const} */ (["Item", "ActiveEffect"])) {
    if (del[type].length) removed += (await actor.deleteEmbeddedDocuments(type, del[type])).length;
  }
  for (const type of /** @type {const} */ (["Item", "ActiveEffect"])) {
    if (make[type].length) created += (await actor.createEmbeddedDocuments(type, make[type])).length;
    if (upd[type].length) updated += (await actor.updateEmbeddedDocuments(type, upd[type])).length;
  }
  for (const { item, effects } of itemFx) await item.updateEmbeddedDocuments("ActiveEffect", effects);
  if (removed || created || updated) log(`grants for ${actor.name}: +${created} −${removed} ~${updated}`);
  return { created, removed, updated, advancement: adv };
}

/**
 * Reconciles one character (leader only): `desired` against the tagged documents. With `refresh`, every desired source is loaded
 * and a copy whose source changed is made again; otherwise only the sources of new copies are loaded. Returns the plan applied and
 * the result.
 * @param {any} actor @param {Grant[]} desired @param {{ refresh?: boolean }} [o]
 */
export async function reconcile(actor, desired, { refresh = false } = {}) {
  const existing = existingOf(actor);
  let plan, sources;
  if (refresh) {
    sources = await loadSources(desired);
    plan = G.reconcilePlan(desired, existing, { hashes: hashesOf(sources), refresh: true });
  } else {
    const rough = G.reconcilePlan(desired, existing);
    sources = await loadSources(G.sourcesNeeded(rough));
    plan = G.withSources(rough, hashesOf(sources));
  }
  const result = G.planSize(plan) ? await applyPlan(actor, plan, sources) : { created: 0, removed: 0, updated: 0, advancement: [] };
  return { plan, result };
}
