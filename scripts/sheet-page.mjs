/**
 * The Talents page on the Wanderer's Toolkit character sheet (feature "toolkitPage", needs "talents"). When the toolkit's `api.sheet`
 * exists (toolkit 2.3.0+ with its character sheet on) we register one guest page: at our ready when the toolkit's API is already
 * there, and on its `wayfarers-toolkit.sheetReady` hook (fired on every client right after its API is set). A second registration with
 * the same id replaces the first. Each client registers its own page. Nothing is stored and nothing is written here: the page reads
 * the character (path.mjs `stateOf`) and its buttons open our window or switch the preview. The toolkit redraws its sheet on actor and
 * item changes; our own changes (trees, rules) call the page's `refresh()`. Untested in Node: the model and HTML are in
 * sheet-page-model.mjs.
 */
import { TOOLKIT_ID } from "./const.mjs";
import { log, warn, onRulesChanged } from "./core.mjs";
import { stateOf, actorFacts, picksOf, rules } from "./path.mjs";
import { onTreesChanged, cachedTrees, loadTrees } from "./trees.mjs";
import { treesFor } from "./picks-model.mjs";
import { openWindow } from "./window.mjs";
import { pageDef, pageClick, pageModel, pageHTML, pageVisible } from "./sheet-page-model.mjs";

/** The toolkit's sheet hook. */
export const SHEET_READY = `${TOOLKIT_ID}.sheetReady`;

/** What the last registerPage returned (for the health line). @type {{ ok?: boolean, reason?: string } | null} */
let result = null;
/** The toolkit sheets showing our page, by actor id. @type {Map<string, { element: HTMLElement, refresh: () => unknown }>} */
const SHOWN = new Map();
/** The tree each character's page previews (per client, not stored). @type {Map<string, string>} */
const CURRENT = new Map();

/** visible(): synchronous, from the last tree read (the first read is started at ready). @param {any} actor */
function visible(actor) {
  if (actor?.type !== "character" || !actor.testUserPermission?.(game.user, "OBSERVER")) return false;
  const fx = actorFacts(actor);
  return pageVisible(treesFor({ trees: cachedTrees(), picks: picksOf(actor), classes: fx.classes, subclasses: fx.subclasses, level: fx.level, rules: rules() }));
}

/** @param {any} ctx */
async function render(ctx) {
  const actor = ctx?.actor;
  if (!actor) return `<div class="wp-page"><p class="wc-hint">No character.</p></div>`;
  const st = await stateOf(actor);
  return pageHTML(pageModel({ actor: { id: actor.id, name: String(actor.name ?? ""), level: st.facts.level }, picks: st.picks, allTrees: st.trees, seen: st.seen, rules: st.rules, current: CURRENT.get(actor.id) ?? null }));
}

/** @param {any} ctx */
function activate(ctx) {
  const { actor, element, refresh } = ctx ?? {};
  if (!element?.addEventListener || !actor) return;
  if (typeof refresh === "function" && actor.id) SHOWN.set(actor.id, { element, refresh });
  element.addEventListener("click", (/** @type {MouseEvent} */ ev) => {
    const hit = pageClick(ev.target); if (!hit) return;
    ev.preventDefault(); ev.stopPropagation();
    if (hit.act === "open") openWindow(actor);
    else if (hit.act === "tree" && hit.tree) { CURRENT.set(actor.id, hit.tree); if (typeof refresh === "function") refresh(); }
  });
}

/** Registers our page with the toolkit's sheet API. @param {any} sheet `api.sheet` */
function register(sheet) {
  if (typeof sheet?.registerPage !== "function") return;
  try {
    const off = sheet.registerPage(pageDef({ render, activate, visible }));
    result = { ok: off?.ok !== false, reason: off?.reason };
    if (result.ok) log("toolkit sheet page registered"); else warn(`the toolkit refused the sheet page: ${off?.reason}`);
  } catch (e) { result = { ok: false, reason: String(/** @type {any} */ (e)?.message ?? e) }; warn("toolkit sheet page", e); }
}

/** Redraws the toolkit sheets showing our page (our data changed). Drops the ones that are gone. */
export function refreshPages() {
  for (const [id, s] of SHOWN) {
    if (!s.element?.isConnected) { SHOWN.delete(id); continue; }
    try { s.refresh(); } catch { SHOWN.delete(id); }
  }
}

/** At our ready (feature on): register now if the toolkit's API is there, and again on its sheetReady hook. */
export function ready() {
  const sheetApi = () => game.modules.get(TOOLKIT_ID)?.api?.sheet;
  Hooks.once(SHEET_READY, (/** @type {any} */ sheet) => register(sheet ?? sheetApi()));
  const tk = game.modules.get(TOOLKIT_ID);
  if (tk?.active) register(tk.api?.sheet);
  // visible() reads the cached trees. Once they (re)load, registering again (same id: a replace) makes the toolkit redraw its open
  // sheets, so the bookmark appears or goes without a reload.
  const reload = () => { loadTrees().then(() => { if (game.modules.get(TOOLKIT_ID)?.active) register(sheetApi()); }, () => undefined); };
  reload();
  onTreesChanged(reload);
  onRulesChanged(refreshPages);
}

/** Health facts. */
export function status() {
  const tk = game.modules.get(TOOLKIT_ID);
  return { toolkit: /** @type {"missing" | "inactive" | "active"} */ (!tk ? "missing" : tk.active ? "active" : "inactive"), toolkitVersion: tk?.version, sheet: !!tk?.api?.sheet, result };
}
