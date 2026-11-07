/**
 * The talent window's model and markup, pure (tested in Node: tests/view-model.test.mjs). No Foundry calls: the window (window.mjs)
 * gathers plain facts, this file turns them into HTML. Every value from the world is escaped with core's `esc`.
 *
 * Layout 1A (classic tiered tree): spec tabs along the bottom, the tree's tiers with arrows for prerequisites, rank counters on the
 * nodes, points available / spent, tooltips, and a Learn / Reset bar. Clicks only change a preview (`pending`) until Learn.
 * Boards (layout "board") show a placeholder for now.
 */
import { esc, plural } from "../vendor/wanderers-core/index.mjs";
import { nodeState, pointsFor, spentIn, rankProblems } from "./picks-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {import("./tree-model.mjs").TalentNode} TalentNode */
/** @typedef {import("./picks-model.mjs").Picks} Picks */
/** @typedef {import("./picks-model.mjs").Rules} Rules */

/** Grid geometry of a tiered tree (px). */
export const GRID = Object.freeze({ cw: 96, rh: 80, ox: 58, oy: 16, size: 52 });

/**
 * Which actor the keybinding opens (the toolkit's pick rule). A player: the assigned character; else the only character they own;
 * else, owning several, the selected token's character when it is one of theirs. A GM: the first selected token's actor, which
 * must be a player character. `{ actor }` or `{ warn }`.
 * @template {{ type?: string, name?: string }} A
 * @param {{ isGM?: boolean, controlled?: Array<A | null | undefined>, character?: A | null, owned?: A[] }} f
 * @returns {{ actor: A, warn?: undefined } | { actor?: undefined, warn: string }}
 */
export function pickActor(f = {}) {
  if (f.isGM) {
    const a = (f.controlled ?? []).find(Boolean);
    if (!a) return { warn: "Select a character's token to open their talents." };
    if (a.type !== "character") return { warn: `${a.name ?? "That token"} isn't a player character.` };
    return { actor: a };
  }
  if (f.character) return { actor: f.character };
  const owned = (f.owned ?? []).filter(Boolean);
  if (owned.length === 1) return { actor: owned[0] };
  if (owned.length > 1) {
    const sel = (f.controlled ?? []).find(a => a && owned.includes(a));
    if (sel) return { actor: sel };
    return { warn: "You own several characters: select one's token or assign one in User Configuration." };
  }
  return { warn: "You have no character assigned (User Configuration)." };
}

/** Node position in the grid. @param {TalentNode} n */
export const nodePos = n => ({ x: GRID.ox + n.col * GRID.cw, y: GRID.oy + n.tier * GRID.rh });

/**
 * The SVG path of a prerequisite arrow from `a` (above) to `b`: straight down when in the same column, else an elbow.
 * @param {TalentNode} a @param {TalentNode} b
 */
export function arrowPath(a, b) {
  const p = nodePos(a), q = nodePos(b), s = GRID.size;
  const x1 = p.x + s / 2, y1 = p.y + s + 2, x2 = q.x + s / 2, y2 = q.y - 4;
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M${x1} ${y1}L${x1} ${mid}L${x2} ${mid}L${x2} ${y2}`;
}

/**
 * @typedef {object} ViewFacts
 * @property {{ id: string, name: string, level: number }} actor
 * @property {boolean} isGM
 * @property {boolean} canEdit owner or GM (may click and Learn)
 * @property {boolean} respec refunds allowed for this user (GM, or player respec on)
 * @property {boolean} gmConnected a GM is there to apply a Learn
 * @property {Rules} rules
 * @property {Picks} picks stored
 * @property {Picks["ranks"]} pending preview ranks (stored + clicks)
 * @property {ReturnType<typeof import("./picks-model.mjs").treesFor>} seen
 * @property {Tree[]} allTrees every published tree (points and GM tools)
 * @property {string | null} current the tab
 * @property {boolean} [packSet] a tree compendium is chosen
 * @property {boolean} [busy] a Learn is on its way
 * @property {{ count: number, outOfSync: number, advancement: string[] }} [grants] the character's granted documents (GM box)
 */

/**
 * A tree's preview ranks with every pending rank that breaks a rule taken back to its stored rank (repeated until nothing
 * breaks). Stored ranks are never touched here.
 * @param {Tree} tree @param {Record<string, number>} stored @param {Record<string, number>} pending @param {number} level
 */
export function trimPending(tree, stored, pending, level) {
  const out = { ...pending };
  for (let i = 0; i < 200; i++) {
    const bad = rankProblems(tree, out, level).map(p => p.node).filter(id => (out[id] ?? 0) > (stored[id] ?? 0));
    if (!bad.length) break;
    for (const id of bad) { if (stored[id]) out[id] = stored[id]; else delete out[id]; }
  }
  for (const [id, r] of Object.entries(out)) if (!r) delete out[id];
  return out;
}

/** Whether the preview differs from what is stored. @param {Picks["ranks"]} stored @param {Picks["ranks"]} pending */
export function hasPending(stored, pending) {
  for (const [t, m] of Object.entries(pending ?? {})) for (const [n, r] of Object.entries(m ?? {})) if (r !== (stored?.[t]?.[n] ?? 0)) return true;
  return false;
}

/**
 * The model the window draws: { screen: "message" | "tree", message?, tabs, tree?, nodes, arrows, points, ... }.
 * @param {ViewFacts} f
 */
export function viewModel(f) {
  const pts = pointsFor({ level: f.actor.level, picks: f.picks, trees: f.allTrees, rules: f.rules, ranks: f.pending });
  const stored = pointsFor({ level: f.actor.level, picks: f.picks, trees: f.allTrees, rules: f.rules });
  const tabs = f.seen.trees.map(t => ({ id: t.tree.id, name: t.tree.name, spent: pts.byTree[t.tree.id] ?? 0, unlocked: t.unlocked }));
  const base = { actor: f.actor, isGM: f.isGM, tabs, points: pts, stored, pending: hasPending(f.picks.ranks, f.pending), orphans: f.seen.orphans };
  const message = (/** @type {string} */ text) => ({ ...base, screen: /** @type {const} */ ("message"), message: text, current: null });
  if (!f.seen.enabled) return message(f.isGM ? "Talents are off for this character. Turn them on below." : f.seen.reason);
  if (!tabs.length) return message(f.packSet === false && f.isGM ? "Choose the tree compendium in Wanderer's Path's settings first." : "No talent trees are open to this character yet.");
  const cur = f.seen.trees.find(t => t.tree.id === f.current) ?? f.seen.trees[0];
  const tree = cur.tree;
  const ranks = f.pending[tree.id] ?? {};
  const storedRanks = f.picks.ranks[tree.id] ?? {};
  const inTree = spentIn(tree, ranks);
  const view = { ...base, screen: /** @type {const} */ ("tree"), current: tree.id, tree, unlocked: cur.unlocked, lockedReason: cur.reason, inTree };
  if (tree.layout === "board") return { ...view, board: true, nodes: [], arrows: [], tiers: [], learned: [], next: null, progress: 0, size: { width: 0, height: 0 } };
  const nodes = tree.nodes.map(n => {
    const s = nodeState(tree, n, { ranks, level: f.actor.level, available: pts.available });
    const st = cur.unlocked ? s : { ...s, state: s.rank >= s.max ? s.state : s.rank > 0 ? "partial" : "locked", reason: cur.reason, canLearn: false };
    const kept = storedRanks[n.id] ?? 0;
    return { node: n, ...st, stored: kept, added: s.rank - kept, canLearn: st.canLearn && f.canEdit, canUndo: s.rank > kept, canRefund: f.respec && f.canEdit && kept > 0 && s.rank === kept, pos: nodePos(n) };
  });
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const arrows = tree.nodes.flatMap(n => n.prereqs.map(p => {
    const from = /** @type {TalentNode} */ (byId.get(p.node));
    return { d: arrowPath(from, n), met: (ranks[p.node] ?? 0) >= p.ranks };
  }));
  const tiers = Array.from({ length: tree.tiered.tiers }, (_, t) => ({ tier: t, need: t * tree.tiered.tierSize, open: inTree >= t * tree.tiered.tierSize }));
  const maxNeed = (tree.tiered.tiers - 1) * tree.tiered.tierSize;
  const next = tiers.find(t => !t.open)?.need ?? null;
  const learned = nodes.filter(n => n.rank > 0).map(n => ({ name: n.node.name, rank: n.rank, max: n.max, added: n.added }));
  return { ...view, board: false, nodes, arrows, tiers, next, progress: maxNeed ? Math.min(100, Math.round((inTree / maxNeed) * 100)) : 100, learned,
    size: { width: GRID.ox + tree.tiered.columns * GRID.cw, height: GRID.oy + tree.tiered.tiers * GRID.rh } };
}

/** @param {TalentNode} n */
const nodeIcon = n => (n.img ? `<img src="${esc(n.img)}" alt="">` : `<i class="fa-solid ${n.keystone ? "fa-star" : "fa-circle-dot"}" aria-hidden="true"></i>`);

/**
 * A node's tooltip (HTML, escaped), for `data-tooltip-html`.
 * @param {any} v a node row of viewModel().nodes
 */
export function tooltipHTML(v) {
  const n = /** @type {TalentNode} */ (v.node);
  const parts = [`<div class="wp-tip-t">${esc(n.name)}</div>`, `<div class="wp-tip-r">Rank ${v.rank}/${v.max}${n.cost > 1 ? ` · ${n.cost} points a rank` : ""}</div>`];
  if (n.text) parts.push(`<div class="wp-tip-d">${esc(n.text)}</div>`);
  if (v.reason) parts.push(`<div class="wp-tip-req">${esc(v.reason)}</div>`);
  if (v.canLearn) parts.push(`<div class="wp-tip-hint">Click to ${v.rank ? "add a rank" : "learn"}.</div>`);
  if (v.canUndo) parts.push(`<div class="wp-tip-hint">Right-click to take the new rank back.</div>`);
  else if (v.canRefund) parts.push(`<div class="wp-tip-nxt">Right-click to refund a rank.</div>`);
  return parts.join("");
}

/** @param {ReturnType<typeof viewModel>} m @param {{ respec: boolean, canEdit: boolean, gmConnected: boolean, busy?: boolean, isGM: boolean }} o */
function footer(m, o) {
  const learnOff = !m.pending || !o.canEdit || o.busy || (!o.gmConnected && !o.isGM);
  const note = !o.gmConnected && !o.isGM ? "A GM must be connected to learn." : o.respec ? (o.isGM ? "GM: refunds are always free." : "Respec is on: refunds are free.") : "Learned talents stay learned (respec is off).";
  return `<footer class="wp-bar"><span class="wp-note">${esc(note)}</span><span class="wp-bar-buttons">
    ${m.pending ? `<button type="button" class="wc-btn" data-action="undo"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Undo changes</button>` : ""}
    ${o.respec && o.canEdit && m.screen === "tree" ? `<button type="button" class="wc-btn" data-action="resetTree"${(m.stored.byTree[m.current ?? ""] ?? 0) ? "" : " disabled"}><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Reset tree</button>` : ""}
    <button type="button" class="wc-btn wc-btn-primary wp-learn" data-action="learn"${learnOff ? " disabled" : ""}><i class="fa-solid fa-check" aria-hidden="true"></i> ${o.busy ? "Learning…" : "Learn"}</button>
  </span></footer>`;
}

/** @param {ReturnType<typeof viewModel>} m */
function tabsHTML(m) {
  if (m.tabs.length < 2) return "";
  return `<nav class="wp-tabs" aria-label="Talent trees">${m.tabs.map(t => `<button type="button" class="wp-tab${t.id === m.current ? " wp-on" : ""}" data-action="tab" data-tree="${esc(t.id)}" aria-pressed="${t.id === m.current}">${esc(t.name)}<small>${t.spent}</small>${t.unlocked ? "" : ` <i class="fa-solid fa-lock" aria-label="Locked"></i>`}</button>`).join("")}</nav>`;
}

/** @param {ReturnType<typeof viewModel>} m */
function pointsSource(m) {
  const p = m.points; const r = [];
  r.push(`<b>${p.fromLevel}</b> from levels`);
  if (p.awards) r.push(`<b>${p.awards}</b> from GM awards`);
  return r.join(" + ");
}

/**
 * The GM's tools for this character (only for GMs).
 * @param {{ picks: Picks, allTrees: Tree[], seen: ViewFacts["seen"], grants?: ViewFacts["grants"] }} f
 */
export function gmToolsHTML(f) {
  const en = f.picks.enabled === null ? "world" : f.picks.enabled ? "on" : "off";
  const opt = (/** @type {string} */ v, /** @type {string} */ label) => `<option value="${v}"${en === v ? " selected" : ""}>${esc(label)}</option>`;
  const shown = new Set(f.seen.trees.map(t => t.tree.id));
  const rows = f.allTrees.filter(t => t.id).map(t => {
    const removed = f.picks.trees.remove.includes(t.id); const added = f.picks.trees.add.includes(t.id);
    const how = removed ? "removed by hand" : added && shown.has(t.id) ? "added by hand" : shown.has(t.id) ? "by class" : "not assigned";
    const btn = (/** @type {string} */ op, /** @type {string} */ label) => `<button type="button" class="wc-btn wc-btn-sm" data-action="gmTrees" data-tree="${esc(t.id)}" data-op="${op}">${esc(label)}</button>`;
    return `<li><span>${esc(t.name)} <small>${esc(how)}</small></span><span>${shown.has(t.id) ? btn("remove", "Remove") : btn("add", "Add")}${removed || added ? btn("auto", "Automatic") : ""}</span></li>`;
  }).join("");
  return `<section class="wp-box wp-gm"><h3>GM</h3>
    <label class="wp-row">Talents <select data-change="enable" aria-label="Talents for this character">${opt("world", "World setting")}${opt("on", "On")}${opt("off", "Off")}</select></label>
    <div class="wp-row"><button type="button" class="wc-btn wc-btn-sm" data-action="gmAward"><i class="fa-solid fa-gift" aria-hidden="true"></i> Award points</button>
    <button type="button" class="wc-btn wc-btn-sm" data-action="gmRespec"><i class="fa-solid fa-broom" aria-hidden="true"></i> Free respec</button></div>
    ${rows ? `<ul class="wp-list wp-trees">${rows}</ul>` : `<p class="wc-hint">No trees are published yet.</p>`}
    ${grantsHTML(f.grants)}
  </section>`;
}

/**
 * The GM box's granted-items part: how many, whether they match the learned talents, the advancement note, and Refresh.
 * @param {ViewFacts["grants"]} g
 */
export function grantsHTML(g) {
  if (!g) return "";
  const state = g.outOfSync ? `<p class="wp-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${plural(g.outOfSync, "granted document is", "granted documents are")} out of step with the learned talents.</p>`
    : `<p class="wc-hint">${g.count ? `${plural(g.count, "granted item or effect", "granted items and effects")}, in step with the learned talents.` : "No granted items or effects."}</p>`;
  const adv = g.advancement.length ? `<p class="wp-warn"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${esc(g.advancement.join(", "))}: advancement doesn't run on talent grants.</p>` : "";
  return `<div class="wp-grants">${state}${adv}<div class="wp-row"><button type="button" class="wc-btn wc-btn-sm" data-action="gmRefresh" data-tooltip="Make the granted items and effects again where their source changed, and add or remove what the learned talents call for."><i class="fa-solid fa-rotate" aria-hidden="true"></i> Refresh granted items</button></div></div>`;
}

/**
 * The window's whole body.
 * @param {ViewFacts} f
 */
export function windowHTML(f) {
  const m = viewModel(f);
  const pill = `<span class="wp-pill">Available <b>${m.points.available}</b> · Spent <b>${m.points.spent}</b></span>`;
  const gm = f.isGM ? gmToolsHTML(f) : "";
  const orphans = m.orphans.length ? `<p class="wp-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${plural(m.orphans.length, "point set", "point sets")} in trees that are no longer published still count as spent${f.isGM ? " (a free respec gives them back)" : ""}.</p>` : "";
  const o = { respec: f.respec, canEdit: f.canEdit, gmConnected: f.gmConnected, busy: f.busy, isGM: f.isGM };
  if (m.screen === "message") {
    return `<div class="wp-path"><header class="wp-head"><div class="wp-title"><span class="wp-name">${esc(f.actor.name)}</span><small>Level ${m.actor.level}</small></div>${pill}</header>
      <div class="wp-main"><div class="wp-empty"><i class="fa-solid fa-route" aria-hidden="true"></i><p>${esc(m.message ?? "")}</p></div><aside class="wp-side">${orphans}${gm}</aside></div></div>`;
  }
  const tree = /** @type {Tree} */ (m.tree);
  const head = `<header class="wp-head"><span class="wp-crest">${tree.img ? `<img src="${esc(tree.img)}" alt="">` : `<i class="fa-solid fa-route" aria-hidden="true"></i>`}</span>
    <div class="wp-title"><span class="wp-name">${esc(tree.name)}</span><small>${esc(f.actor.name)} · Level ${m.actor.level} · Points in tree: <b>${m.inTree}</b></small></div>${pill}</header>`;
  let board;
  if (m.board) board = `<div class="wp-empty"><i class="fa-solid fa-diagram-project" aria-hidden="true"></i><p>Board view coming soon.</p><p class="wc-hint">This tree uses the free-form board layout, which a later version draws.</p></div>`;
  else {
    const sz = /** @type {{ width: number, height: number }} */ (m.size);
    const labels = m.tiers.map(t => `<span class="wp-tier${t.open ? " wp-open" : ""}" style="top:${GRID.oy + t.tier * GRID.rh + 18}px">${t.need} pts</span>`).join("");
    const svg = `<svg class="wp-links" width="${sz.width}" height="${sz.height}" aria-hidden="true"><defs><marker id="wp-ah-${esc(tree.id)}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>${m.arrows.map(a => `<path d="${a.d}" class="${a.met ? "wp-met" : ""}" marker-end="url(#wp-ah-${esc(tree.id)})"/>`).join("")}</svg>`;
    const nodes = m.nodes.map(v => `<button type="button" class="wp-node wp-${v.state}${v.node.keystone ? " wp-key" : ""}${v.added > 0 ? " wp-new" : ""}" style="left:${v.pos.x}px;top:${v.pos.y}px" data-action="node" data-node="${esc(v.node.id)}" aria-label="${esc(`${v.node.name}, rank ${v.rank} of ${v.max}${v.reason ? `. ${v.reason}` : ""}`)}" data-tooltip-html="${esc(tooltipHTML(v))}" data-tooltip-direction="RIGHT" data-tooltip-class="wp-tip">${nodeIcon(v.node)}<span class="wp-rk">${v.rank}/${v.max}</span></button>`).join("");
    board = `<div class="wp-scroll-x"><div class="wp-grid" style="width:${sz.width}px;height:${sz.height}px">${labels}${svg}${nodes}</div></div>`;
  }
  const learned = m.learned.length ? m.learned.map(l => `<li>${esc(l.name)} <span>${l.max > 1 ? `${l.rank}/${l.max}` : ""}${l.added > 0 ? " · new" : ""}</span></li>`).join("") : `<li class="wc-hint">Nothing yet</li>`;
  const lock = m.unlocked ? "" : `<p class="wp-warn"><i class="fa-solid fa-lock" aria-hidden="true"></i> ${esc(m.lockedReason ?? "")}</p>`;
  const side = `<aside class="wp-side">${lock}${orphans}
    <section class="wp-box"><h3>Learned in this tree</h3><ul class="wp-list">${learned}</ul></section>
    ${m.board ? "" : `<section class="wp-box"><h3>Progress</h3><div class="wp-small">${m.next === null ? "All tiers open." : `Next tier opens at <b>${m.next}</b> points.`}</div><div class="wp-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.progress}"><i style="width:${m.progress}%"></i></div>
      <div class="wp-small wp-muted">Points come from: ${pointsSource(m)}.</div></section>`}
    <section class="wp-box wp-small wp-muted"><b>Changes are a preview</b> until you click <i>Learn</i>.</section>${gm}</aside>`;
  return `<div class="wp-path">${head}<div class="wp-main"><div class="wp-tree">${board}</div>${side}</div>${footer(m, o)}${tabsHTML(m)}</div>`;
}
