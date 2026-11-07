/**
 * The Talents page on the Wanderer's Toolkit character sheet, pure (tested in Node: tests/sheet-page.test.mjs). The toolkit (2.3.0+)
 * takes pages from other modules through `api.sheet.registerPage(def)` (wanderers-core guest pages); this file builds our
 * definition, the compact page (model and HTML) and the health line. sheet-page.mjs does the registering and wiring.
 *
 * Guest contract (the toolkit's docs/scripting.md, "Sheet pages for other modules"): `render(ctx)` gets `{ actor, mode, editable,
 * root }` and returns HTML (inserted as is: everything from the world is escaped here); `activate(ctx)` also gets `element` and
 * `refresh()`. No `data-action`, `data-name` or `[data-drop]` inside the page: our buttons use `data-wp-act`. CSS lives under
 * `.wp-page` with no theme selectors (the sheet is dark in both themes).
 */
import { esc, plural } from "../vendor/wanderers-core/index.mjs";
import { ID } from "./const.mjs";
import { pointsFor, nodeState } from "./picks-model.mjs";
import { specText } from "./builder-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {import("./picks-model.mjs").Picks} Picks */

export const PAGE_ID = `${ID}.talents`;
/** After the toolkit's Reputation (75), before Bastion (80). */
export const PAGE_ORDER = 77;
export const PAGE_LABEL = "Talents";
export const PAGE_HINT = "talent trees and points";
export const PAGE_ICON = "fa-solid fa-route";
/** How many log lines the page shows. */
export const PAGE_LOG = 5;
/** Mini tree preview: px per cell. */
export const MINI = Object.freeze({ cell: 14, gap: 4 });

/**
 * Our page definition for `registerPage`.
 * @param {{ render: (ctx: any) => string | Promise<string>, activate?: (ctx: any) => void, visible?: (actor: any) => boolean }} fns
 */
export function pageDef({ render, activate, visible }) {
  return { id: PAGE_ID, label: PAGE_LABEL, hint: PAGE_HINT, icon: PAGE_ICON, order: PAGE_ORDER, render, ...(activate ? { activate } : {}), ...(visible ? { visible } : {}) };
}

/**
 * Whether the page shows for a character: talents on for them and at least one tree assigned.
 * @param {ReturnType<typeof import("./picks-model.mjs").treesFor> | null | undefined} seen
 */
export const pageVisible = seen => !!seen?.enabled && seen.trees.length > 0;

/**
 * Where the registration stands, as one health line.
 * @param {{ feature: boolean, toolkit: "missing" | "inactive" | "active", toolkitVersion?: string, sheet: boolean, result?: { ok?: boolean, reason?: string } | null }} f
 * @returns {{ level: "ok" | "warn" | "info" | "off", text: string }}
 */
export function pageStatus(f) {
  if (!f.feature) return { level: "off", text: "Toolkit sheet page: off (Feature: Toolkit sheet page)." };
  if (f.toolkit !== "active") return { level: "info", text: "Toolkit sheet page: Wanderer's Toolkit isn't active, so there's no sheet to add the page to (the talent window works without it)." };
  if (!f.sheet) return { level: "info", text: `Toolkit sheet page: Wanderer's Toolkit ${f.toolkitVersion ?? ""} has no sheet pages (it needs 2.3.0 or later with its character sheet replacement on).`.replace("  ", " ") };
  if (!f.result) return { level: "warn", text: "Toolkit sheet page: not registered yet (it registers when the toolkit's sheet is ready; reload if this stays)." };
  if (f.result.ok === false) return { level: "warn", text: `Toolkit sheet page: the toolkit refused it (${f.result.reason ?? "no reason given"}).` };
  return { level: "ok", text: "Toolkit sheet page: Talents is a bookmark on the toolkit's character sheet." };
}

/**
 * The button a click on our page hit, `{ act, tree }`, or null. Only `data-wp-act` buttons count. Duck-typed for Node.
 * @param {any} target
 */
export function pageClick(target) {
  const b = target?.closest?.("[data-wp-act]");
  if (!b || b.disabled) return null;
  const d = b.dataset ?? {};
  return { act: String(d.wpAct ?? ""), tree: String(d.tree ?? "") };
}

/**
 * @typedef {object} PageFacts
 * @property {{ id: string, name: string, level: number }} actor
 * @property {Picks} picks @property {Tree[]} allTrees
 * @property {ReturnType<typeof import("./picks-model.mjs").treesFor>} seen
 * @property {import("./picks-model.mjs").Rules} rules
 * @property {string | null} [current] the tree the preview shows (default: the first)
 */

/**
 * What one learned node gives, in plain words: built rank slots read their template's sentence at the rank; other grants say
 * "Name (rank/max)".
 * @param {import("./tree-model.mjs").TalentNode} n @param {number} rank
 */
export function activeLine(n, rank) {
  const g = n.grant;
  const slot = g.perRank === "replace" ? g.ranks[Math.min(rank, g.ranks.length) - 1] : g.ranks[0];
  const built = slot && "built" in slot ? specText(slot.built, rank) : "";
  return { name: n.name, rank, max: n.maxRanks, text: built };
}

/** The page model. @param {PageFacts} f */
export function pageModel(f) {
  const pts = pointsFor({ level: f.actor.level, picks: f.picks, trees: f.allTrees, rules: f.rules });
  const trees = f.seen.trees.map(t => ({ id: t.tree.id, name: t.tree.name, spent: pts.byTree[t.tree.id] ?? 0, unlocked: t.unlocked, reason: t.reason }));
  const cur = f.seen.trees.find(t => t.tree.id === f.current) ?? f.seen.trees[0] ?? null;
  /** @type {{ id: string, name: string, cols: number, rows: number, cells: { x: number, y: number, state: string, name: string, rank: number, max: number }[] } | null} */
  let mini = null;
  if (cur && cur.tree.layout === "tiered") {
    const t = cur.tree; const ranks = f.picks.ranks[t.id] ?? {};
    mini = { id: t.id, name: t.name, cols: t.tiered.columns, rows: t.tiered.tiers, cells: t.nodes.map(n => {
      const s = nodeState(t, n, { ranks, level: f.actor.level, available: pts.available });
      return { x: n.col, y: n.tier, state: cur.unlocked || s.rank ? s.state : "locked", name: n.name, rank: s.rank, max: s.max };
    }) };
  }
  const active = f.seen.trees.flatMap(t => t.tree.nodes.filter(n => (f.picks.ranks[t.tree.id]?.[n.id] ?? 0) > 0 && n.grant.mode !== "none")
    .map(n => ({ tree: t.tree.name, ...activeLine(n, Math.min(n.maxRanks, f.picks.ranks[t.tree.id][n.id])) })));
  return { enabled: f.seen.enabled, reason: f.seen.reason, points: pts, trees, current: cur?.tree.id ?? null, board: cur?.tree.layout === "board", mini, active, log: f.picks.log.slice(0, PAGE_LOG) };
}

/** @param {ReturnType<typeof pageModel>["mini"]} m */
function miniHTML(m) {
  if (!m) return "";
  const { cell, gap } = MINI; const w = m.cols * (cell + gap) - gap; const h = m.rows * (cell + gap) - gap;
  const cells = m.cells.map(c => `<span class="wp-mini-n wp-${esc(c.state)}" style="left:${c.x * (cell + gap)}px;top:${c.y * (cell + gap)}px" data-tooltip-text="${esc(`${c.name} ${c.rank}/${c.max}`)}"></span>`).join("");
  return `<div class="wp-mini" style="width:${w}px;height:${h}px" role="img" aria-label="${esc(`${m.name}: ${m.cells.filter(c => c.rank > 0).length} of ${m.cells.length} talents learned`)}">${cells}</div>`;
}

/**
 * The page's HTML (escaped). Buttons: `data-wp-act="open"` (the full window), `data-wp-act="tree"` with `data-tree` (switch the
 * preview).
 * @param {ReturnType<typeof pageModel>} m
 */
export function pageHTML(m) {
  const open = `<button type="button" class="wc-btn wc-btn-sm" data-wp-act="open"><i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i> Open full window</button>`;
  if (!m.enabled) return `<div class="wp-page"><p class="wc-hint">${esc(m.reason)}</p></div>`;
  const p = m.points;
  const head = `<div class="wp-page-head"><span class="wp-pill">Available <b>${p.available}</b> · Spent <b>${p.spent}</b></span>${open}</div>`;
  const trees = m.trees.map(t => `<li><button type="button" class="wp-page-tree${t.id === m.current ? " wp-on" : ""}" data-wp-act="tree" data-tree="${esc(t.id)}" aria-pressed="${t.id === m.current}">${esc(t.name)}</button><b>${t.spent}</b>${t.unlocked ? "" : ` <small class="wc-hint">${esc(t.reason)}</small>`}</li>`).join("");
  const preview = m.board ? `<p class="wc-hint">This tree uses the board layout; open the full window to see it.</p>` : miniHTML(m.mini);
  const active = m.active.length ? m.active.map(a => `<li><span>${esc(a.name)}${a.max > 1 ? ` <small>${a.rank}/${a.max}</small>` : ""}</span>${a.text ? `<small>${esc(a.text)}</small>` : ""}</li>`).join("") : `<li class="wc-hint">Nothing yet</li>`;
  const log = m.log.length ? m.log.map(l => `<li><small>${esc(l.by)}</small> ${esc(l.text)}</li>`).join("") : `<li class="wc-hint">No changes yet</li>`;
  return `<div class="wp-page">${head}<div class="wp-page-grid">
    <section class="wp-box"><h3>Points per tree</h3><ul class="wp-list">${trees}</ul></section>
    <section class="wp-box"><h3>${esc(m.trees.find(t => t.id === m.current)?.name ?? "Tree")}</h3>${preview}</section>
    <section class="wp-box"><h3>Active from talents</h3><ul class="wp-list wp-active">${active}</ul></section>
    <section class="wp-box"><h3>Recent</h3><ul class="wp-list wp-log">${log}</ul></section></div>
    <p class="wc-hint">${plural(p.total, "point", "points")} in all: ${p.fromLevel} from levels${p.awards ? `, ${p.awards} from awards` : ""}.</p></div>`;
}
