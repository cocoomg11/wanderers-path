/**
 * The grant engine, pure (tested in Node: tests/grants-model.test.mjs). No Foundry calls.
 *
 * What a character should have (`desiredGrants`: one entry per learned node that grants something) is compared with what the
 * character has (`reconcilePlan`: the actor's items and effects tagged `flags.wanderers-path.granted`), giving creates, replaces,
 * updates and removals. Documents without our tag are never touched. Applying the plan and planning again gives an empty plan.
 *
 * Tag (`flags.wanderers-path.granted`): { tree, node, rank, key, src, hash }
 *   key   stable id of the grant: "tree.node" for a "scale" node (one copy whose rank changes), "tree.node.N" for a "replace" node
 *         (N = the rank slot whose document is granted; a new slot replaces the previous copy).
 *   src   the UUID the copy was made from; hash = `stableHash` of the source data snapshot (`snapshot`) when it was copied, so a
 *         GM Refresh can tell the source changed.
 * Built rank slots (`{ built: spec }`, builder-model.mjs): `src` = "built:<hash of the spec>" (so another spec replaces the copy),
 * `hash` = stable hash of the spec, the grant mode and the node's name, image and text (rank-free: a rank change is an update that
 * rewrites the effect's values, never a new copy). The data is generated, not loaded (`builtSource`).
 */
import { normalizeSpec, buildTemplate } from "./builder-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {import("./picks-model.mjs").Picks} Picks */
/**
 * @typedef {object} Grant one desired grant
 * @property {string} key @property {string} tree @property {string} node @property {number} rank @property {number} max
 * @property {"item" | "effect"} mode @property {"scale" | "replace"} perRank @property {string} src source UUID
 * @property {"Item" | "ActiveEffect"} type the embedded document type on the actor
 * @property {boolean} suffix whether the copy's name gets "(rank/max)" (multi-rank "scale" nodes only)
 * @property {import("./builder-model.mjs").Spec | null} [built] a template spec (built slot), else absent / null
 * @property {{ name: string, img: string, text: string }} [facts] the node's name, image and text (built slots)
 */
/** @typedef {{ tree: string, node: string, rank: number, key: string, src: string, hash: string }} Tag */
/** @typedef {{ id: string, type: "Item" | "ActiveEffect", tag: unknown, name?: string }} Existing a document on the actor */
/**
 * @typedef {object} Plan
 * @property {{ grant: Grant, hash: string }[]} create
 * @property {{ id: string, type: "Item" | "ActiveEffect", grant: Grant, hash: string, why: string }[]} replace delete the copy, create a fresh one
 * @property {{ id: string, type: "Item" | "ActiveEffect", grant: Grant, hash: string }[]} update the rank (tag and name) only; hash = the copy's own
 * @property {{ id: string, type: "Item" | "ActiveEffect", why: string, key: string }[]} remove
 * @property {Grant[]} missing desired grants whose source can't be found (an existing copy is kept)
 * @property {number} stale copies whose source changed since they were made (replaced only on a refresh)
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const TAG_KEY_RE = /^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,64}(\.[1-5])?$/;

/** The key a source's hash is looked up by: the document type and the UUID (one UUID can be an item grant and an effect grant). @param {{ type: string, src: string }} g */
export const srcKey = g => `${g.type}:${g.src}`;

/** The key of a grant. @param {string} tree @param {string} node @param {"scale" | "replace"} perRank @param {number} slot 1-based */
export const grantKey = (tree, node, perRank, slot) => (perRank === "replace" ? `${tree}.${node}.${slot}` : `${tree}.${node}`);

/**
 * Every grant the character should have: for each learned node (rank > 0) of the given trees whose grant isn't "none" and has a
 * document. Pass only the trees whose talents apply now (the character sees them, talents on): ranks in any other tree grant
 * nothing. "scale" uses the first rank slot (one copy, the rank recorded); "replace" uses the slot of the current rank (or the last
 * slot when the node has more ranks than slots).
 * Built slots grant only with `built` true (Foundry 14 and dnd5e 6: builder-model `builderSupported`).
 * @param {Picks} picks @param {Tree[]} trees @param {{ built?: boolean }} [o] @returns {Grant[]}
 */
export function desiredGrants(picks, trees, { built = true } = {}) {
  /** @type {Grant[]} */ const out = [];
  const seen = new Set();
  for (const t of Array.isArray(trees) ? trees : []) {
    const ranks = picks?.ranks?.[t.id]; if (!isObj(ranks) || seen.has(t.id)) continue;
    seen.add(t.id);
    for (const n of t.nodes) {
      const r = Math.min(Number(ranks[n.id] ?? 0) || 0, n.maxRanks);
      const g = n.grant;
      if (r < 1 || g.mode === "none" || !g.ranks.length) continue;
      const slot = g.perRank === "replace" ? Math.min(r, g.ranks.length) : 1;
      const s = g.ranks[slot - 1];
      if (!s) continue;
      const base = { key: grantKey(t.id, n.id, g.perRank, slot), tree: t.id, node: n.id, rank: r, max: n.maxRanks, mode: g.mode, perRank: g.perRank,
        type: /** @type {"Item" | "ActiveEffect"} */ (g.mode === "item" ? "Item" : "ActiveEffect") };
      if ("uuid" in s) { out.push({ ...base, src: s.uuid, suffix: g.perRank === "scale" && n.maxRanks > 1 }); continue; }
      if (!built) continue;
      const spec = normalizeSpec(s.built); if (!spec) continue;
      // A built copy is named after the node; its values carry the rank, so no "(r/max)".
      out.push({ ...base, src: `built:${stableHash(spec)}`, suffix: false, built: spec, facts: { name: n.name, img: n.img, text: n.text } });
    }
  }
  return out;
}

/**
 * The generated source of a built grant: `{ data, hash }` (data = what `buildTemplate` makes at the grant's rank), or null when
 * the spec can't be built. Not a loaded document: `inCompendium` false, no advancement.
 * @param {Grant} g @returns {{ data: Record<string, any>, hash: string } | null}
 */
export function builtSource(g) {
  if (!g.built) return null;
  const data = buildTemplate(g.built, g.rank, { mode: g.mode === "item" ? "item" : "effect", node: g.facts, key: g.key });
  if (!data) return null;
  return { data, hash: stableHash({ spec: g.built, mode: g.mode, facts: g.facts ?? null }) };
}

/**
 * The trees whose ranks grant something now: the trees the character sees (assigned, not removed by the GM), when talents are on
 * for them. A tree that is assigned but not yet unlocked still counts (its ranks were learned; a lower level takes nothing away).
 * @param {{ enabled: boolean, trees: { tree: Tree }[] }} seen the result of picks-model `treesFor` @returns {Tree[]}
 */
export const grantTrees = seen => (seen?.enabled ? seen.trees.map(t => t.tree) : []);

/** A stored tag read strictly (null when it isn't one of ours). @param {unknown} raw @returns {Tag | null} */
export function readTag(raw) {
  if (!isObj(raw)) return null;
  const { tree, node, key, src, hash } = raw;
  if (typeof key !== "string" || !TAG_KEY_RE.test(key) || typeof tree !== "string" || typeof node !== "string" || !key.startsWith(`${tree}.${node}`)) return null;
  const rank = Number(raw.rank);
  return { tree, node, rank: Number.isInteger(rank) && rank >= 1 && rank <= 5 ? rank : 1, key, src: typeof src === "string" ? src : "", hash: typeof hash === "string" ? hash : "" };
}

/** The tag a copy carries. @param {Grant} g @param {string} hash @returns {Tag} */
export const tagFor = (g, hash) => ({ tree: g.tree, node: g.node, rank: g.rank, key: g.key, src: g.src, hash });

/** JSON with object keys sorted (arrays keep their order); undefined values and functions left out. @param {unknown} v @returns {string} */
export function stableJSON(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined || typeof x === "function" ? "null" : stableJSON(x))).join(",")}]`;
  const o = /** @type {Record<string, unknown>} */ (v);
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined && typeof o[k] !== "function").map(k => `${JSON.stringify(k)}:${stableJSON(o[k])}`).join(",")}}`;
}

/** A short stable hash (53 bits, base 36) of a value's stable JSON. @param {unknown} v */
export function stableHash(v) {
  const s = stableJSON(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Keys a copy never takes from its source (ids, sidebar placement, ownership, document stats). */
const VOLATILE = ["_id", "_stats", "folder", "sort", "ownership"];
/**
 * The part of a source document's data (its `toObject()`) that a copy is made from and that the hash covers: everything but the
 * id, document stats, folder, sort and ownership, and our own flags.
 * @param {Record<string, any>} data @returns {Record<string, any>}
 */
export function snapshot(data) {
  const d = structuredClone(isObj(data) ? data : {});
  for (const k of VOLATILE) delete d[k];
  if (isObj(d.flags?.["wanderers-path"])) { delete d.flags["wanderers-path"]; if (!Object.keys(d.flags).length) delete d.flags; }
  // Embedded effects' stats change with every system migration, not with the effect: left out of the hash too.
  if (Array.isArray(d.effects)) for (const e of d.effects) if (isObj(e)) delete e._stats;
  return d;
}

/** A copy's name: the source's, with "(rank/max)" on multi-rank "scale" nodes. @param {string} name @param {Grant} g */
export const grantName = (name, g) => `${String(name ?? "").trim() || g.node}${g.suffix ? ` (${g.rank}/${g.max})` : ""}`;

/**
 * Whether item data has dnd5e advancement entries (`system.advancement`: an object keyed by id, or an older array). Advancement
 * doesn't run on talent grants, so the GM is told.
 * @param {unknown} data
 */
export function hasAdvancement(data) {
  const a = /** @type {any} */ (data)?.system?.advancement;
  return Array.isArray(a) ? a.length > 0 : isObj(a) ? Object.keys(a).length > 0 : false;
}

/**
 * The data to create one copy on the actor: the snapshot with our tag, the copy's name, `_stats.compendiumSource` (a compendium
 * source) or `_stats.duplicateSource` (a world source), and for an effect on the actor `origin` = the actor. Item effects keep
 * their `transfer`. Pure: the caller creates it.
 * @param {Record<string, any>} snap @param {Grant} g @param {{ hash: string, inCompendium: boolean, actorUuid: string, id?: string }} o
 */
export function copyData(snap, g, { hash, inCompendium, actorUuid }) {
  const d = structuredClone(snap);
  delete d._id;
  // A built grant has no source document: both stay null.
  d._stats = g.built ? { compendiumSource: null, duplicateSource: null } : { compendiumSource: inCompendium ? g.src : null, duplicateSource: inCompendium ? null : g.src };
  d.name = grantName(d.name, g);
  d.flags = isObj(d.flags) ? d.flags : {};
  d.flags["wanderers-path"] = { ...(isObj(d.flags["wanderers-path"]) ? d.flags["wanderers-path"] : {}), granted: tagFor(g, hash) };
  if (g.type === "ActiveEffect") d.origin = actorUuid;
  return d;
}

/**
 * The plan that makes the actor's tagged documents match the desired grants.
 *   - no copy for a key → create (unless the source is missing: `missing`);
 *   - a copy whose source UUID or document type changed → replace; with `refresh`, also one whose source hash changed (otherwise
 *     it only counts as `stale`, so learning never resets a copy's state behind the GM's back);
 *   - a copy with another rank → update (tag and name);
 *   - copies no grant wants (refunded, orphaned, a second copy of a key) → remove, except copies of trees `keepTree` protects
 *     (the trees couldn't be read, so nothing is known about them).
 * `hashes` maps `srcKey(grant)` to the source's current hash; a key it lacks is missing. Without `hashes` (a quick structural check, no
 * sources loaded) nothing is missing or stale and creates carry hash "".
 * @param {Grant[]} desired @param {Existing[]} existing
 * @param {{ hashes?: Map<string, string> | null, refresh?: boolean, keepTree?: (tree: string) => boolean }} [o]
 * @returns {Plan}
 */
export function reconcilePlan(desired, existing, { hashes = null, refresh = false, keepTree = () => false } = {}) {
  /** @type {Plan} */ const plan = { create: [], replace: [], update: [], remove: [], missing: [], stale: 0 };
  /** @type {Map<string, { id: string, type: "Item" | "ActiveEffect", tag: Tag }[]>} */ const byKey = new Map();
  for (const e of Array.isArray(existing) ? existing : []) {
    const tag = readTag(e?.tag); if (!tag || !e.id) continue;
    const list = byKey.get(tag.key) ?? []; list.push({ id: e.id, type: e.type, tag }); byKey.set(tag.key, list);
  }
  const wanted = new Set();
  for (const g of desired) {
    if (wanted.has(g.key)) continue;
    wanted.add(g.key);
    const have = byKey.get(g.key) ?? [];
    const cur = have.find(h => h.type === g.type && h.tag.src === g.src) ?? have.find(h => h.type === g.type) ?? have[0];
    for (const h of have) if (h !== cur) plan.remove.push({ id: h.id, type: h.type, key: g.key, why: "a second copy" });
    const hash = hashes ? hashes.get(srcKey(g)) : "";
    if (hash === undefined) { plan.missing.push(g); continue; }
    if (!cur) { plan.create.push({ grant: g, hash }); continue; }
    if (cur.type !== g.type || cur.tag.src !== g.src) { plan.replace.push({ id: cur.id, type: cur.type, grant: g, hash, why: "the talent grants another document now" }); continue; }
    if (hashes && cur.tag.hash !== hash) {
      if (refresh) { plan.replace.push({ id: cur.id, type: cur.type, grant: g, hash, why: "the source changed" }); continue; }
      plan.stale++;
    }
    if (cur.tag.rank !== g.rank) plan.update.push({ id: cur.id, type: cur.type, grant: g, hash: cur.tag.hash });
  }
  for (const [key, list] of byKey) {
    if (wanted.has(key)) continue;
    for (const h of list) if (!keepTree(h.tag.tree)) plan.remove.push({ id: h.id, type: h.type, key, why: "no learned talent grants it" });
  }
  return plan;
}

/** How many document changes a plan makes. @param {Plan} p */
export const planSize = p => p.create.length + p.replace.length + p.update.length + p.remove.length;

/**
 * Where a source UUID lives, for loading sources in bulk: a compendium Item (`{ pack, id, effect? }`, effect = an ActiveEffect
 * embedded in it) or anything else (`{ world: true }`, read synchronously). Null for an unreadable UUID.
 * @param {unknown} uuid @returns {{ pack: string, id: string, effect: string | null } | { world: true } | null}
 */
export function parseUuid(uuid) {
  if (typeof uuid !== "string" || !uuid.includes(".")) return null;
  const p = uuid.split(".");
  if (p[0] !== "Compendium") return p.every(Boolean) ? { world: true } : null;
  // Compendium.<package>.<pack>.Item.<id>[.ActiveEffect.<id>]
  if (p.length < 5 || p[3] !== "Item" || !p[4]) return null;
  if (p.length === 5) return { pack: `${p[1]}.${p[2]}`, id: p[4], effect: null };
  if (p.length === 7 && p[5] === "ActiveEffect" && p[6]) return { pack: `${p[1]}.${p[2]}`, id: p[4], effect: p[6] };
  return null;
}

/**
 * Picks without the ranks no tree holds any more: whole trees that are no longer published and nodes a tree lost. Returns
 * { ranks, removed: [{ tree, node, from, to: 0 }] }.
 * @param {Picks} picks @param {Tree[]} trees
 */
export function orphanRanks(picks, trees) {
  const byId = new Map(trees.map(t => [t.id, new Set(t.nodes.map(n => n.id))]));
  /** @type {Picks["ranks"]} */ const ranks = {};
  /** @type {{ tree: string, node: string, from: number, to: number }[]} */ const removed = [];
  for (const [tid, map] of Object.entries(picks.ranks)) {
    const nodes = byId.get(tid);
    /** @type {Record<string, number>} */ const keep = {};
    for (const [nid, r] of Object.entries(map)) { if (nodes?.has(nid)) keep[nid] = r; else removed.push({ tree: tid, node: nid, from: r, to: 0 }); }
    if (Object.keys(keep).length) ranks[tid] = keep;
  }
  return { ranks, removed };
}

/**
 * The UUID sources of desired grants that no longer exist (0.6.2): unique UUIDs (built slots skipped) for which `has(uuid)` is
 * false. Unknown (`undefined`, an index not loaded) never counts. An existing copy of a missing source is kept by reconcile.
 * @param {Grant[]} desired @param {(uuid: string) => boolean | undefined} has
 */
export function missingSources(desired, has) {
  const out = new Set();
  for (const g of desired) { if (g.built || !g.src || g.src.startsWith("built:")) continue; if (!out.has(g.src) && has(g.src) === false) out.add(g.src); }
  return [...out];
}

/**
 * What the GM box shows about a character's granted documents, from a structural plan (no sources loaded): { count, outOfSync,
 * advancement: names of granted items that carry dnd5e advancement }.
 * @param {Grant[]} desired @param {(Existing & { advancement?: boolean })[]} existing @param {{ keepTree?: (tree: string) => boolean }} [o]
 */
export function grantSummary(desired, existing, o = {}) {
  const tagged = existing.filter(e => readTag(e?.tag));
  const p = reconcilePlan(desired, tagged, { keepTree: o.keepTree });
  return { count: tagged.length, outOfSync: planSize(p), advancement: tagged.filter(e => e.advancement).map(e => String(e.name ?? "")) };
}

/**
 * What a rank change rewrites on a built copy (pure; grants.mjs applies it): for an effect, `{ effect: { system.changes,
 * description } }`; for an item, `{ item: { system.description.value, system.uses.max, system.activities.<id> }, effects: [{ _id,
 * system.changes, description }] }` for each of its effects made by the builder (`flags.wanderers-path.built`). Activities keep their
 * ids (`activityId` of the grant key), so they are updated in place and their spent uses are kept (`system.uses.spent` too). Null
 * when the grant isn't built or can't be built at that rank.
 * @param {Grant} g @param {{ effects?: { _id: string, flags?: any }[] }} [doc] the copy's data (an item's effects, by id)
 */
export function builtRankUpdate(g, doc = {}) {
  const src = builtSource(g); if (!src) return null;
  const fx = g.type === "Item" ? src.data.effects?.[0] : src.data;
  const effect = fx ? { "system.changes": fx.system.changes, description: fx.description, [`flags.wanderers-path.built.rank`]: g.rank } : null;
  if (g.type === "ActiveEffect") return effect ? { effect, effects: [] } : null;
  const sys = src.data.system ?? {};
  /** @type {Record<string, any>} */
  const item = { "system.description.value": sys.description.value, [`flags.wanderers-path.built.rank`]: g.rank };
  if (isObj(sys.uses)) item["system.uses.max"] = sys.uses.max;
  // `_id` and `type` stay out: the activity is found by its id and its type never changes (another type = another spec = a new copy).
  for (const [id, a] of Object.entries(isObj(sys.activities) ? sys.activities : {})) { const { _id, type, ...rest } = a; item[`system.activities.${id}`] = rest; }
  const ids = effect ? (Array.isArray(doc.effects) ? doc.effects : []).filter(e => isObj(e?.flags?.["wanderers-path"]?.built)).map(e => e._id) : [];
  return { item, effects: effect ? ids.map(_id => ({ _id, ...effect })) : [] };
}

/** A copy's name for a new rank: its current name without an old "(r/max)" suffix, then `grantName`. @param {string} name @param {Grant} g */
export const rankedName = (name, g) => grantName(String(name ?? "").replace(/\s\(\d\/\d\)$/, ""), g);

/**
 * A structural plan (made without `hashes`) completed with the sources that were loaded for it: every create and replace whose
 * source is in `hashes` gets its hash; the others move to `missing` (and a replace keeps its old copy). Returns a new plan.
 * @param {Plan} plan @param {Map<string, string>} hashes
 * @returns {Plan}
 */
export function withSources(plan, hashes) {
  /** @type {Plan} */ const out = { ...plan, create: [], replace: [], missing: [...plan.missing] };
  for (const c of plan.create) { const h = hashes.get(srcKey(c.grant)); if (h === undefined) out.missing.push(c.grant); else out.create.push({ grant: c.grant, hash: h }); }
  for (const r of plan.replace) { const h = hashes.get(srcKey(r.grant)); if (h === undefined) out.missing.push(r.grant); else out.replace.push({ ...r, hash: h }); }
  return out;
}

/** Which grants of a plan need their source loaded (creates and replaces). @param {Plan} plan @returns {Grant[]} */
export const sourcesNeeded = plan => [...plan.create.map(c => c.grant), ...plan.replace.map(r => r.grant)];

/**
 * A queue per key (actor id): `run(key, fn)` starts `fn` once every earlier `fn` of the same key has settled, and returns its
 * promise. A failing `fn` doesn't stop the queue.
 */
export function serial() {
  /** @type {Map<string, Promise<unknown>>} */ const tails = new Map();
  return {
    /** @template T @param {string} key @param {() => T | Promise<T>} fn @returns {Promise<T>} */
    run(key, fn) {
      const prev = tails.get(key) ?? Promise.resolve();
      const next = prev.then(fn, fn);
      const tail = next.catch(() => undefined);
      tails.set(key, tail);
      tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
      return next;
    },
    /** Keys with work queued or running. */
    get size() { return tails.size; }
  };
}
