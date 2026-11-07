/**
 * The talent window (ApplicationV2, core's RememberedWindow key "path", one window per character): layout 1A from view-model.mjs.
 * Clicks change a preview only; Learn sends a pathLearn request to the leader, Reset / right-click refunds send pathRefund (only
 * while refunds are allowed). GMs also get the character's GM tools. Untested in Node: needs a live client.
 */
import { RememberedWindow } from "../vendor/wanderers-core/foundry/index.mjs";
import { UI_CLASSES, esc } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, PICKS_FLAG } from "./const.mjs";
import { onRulesChanged } from "./core.mjs";
import * as V from "./view-model.mjs";
import { learnChanges } from "./requests-model.mjs";
import { AWARD_MAX, REASON_MAX } from "./picks-model.mjs";
import { stateOf, send, gmConnected, actorFrom, grantSummaryOf } from "./path.mjs";
import { onTreesChanged, packId, loadTreesChecked } from "./trees.mjs";
import { GRANTED_FLAG } from "./grants.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
/** Placement key (never rename: saved placements live under it). */
export const WINDOW_KEY = "path";

/** @type {Map<string, PathWindow>} */
const open = new Map();

export class PathWindow extends RememberedWindow(ApplicationV2, { moduleId: ID, key: WINDOW_KEY }) {
  static DEFAULT_OPTIONS = {
    classes: ["wp-window", "wp-path-window", ...UI_CLASSES],
    window: { title: "Talents", icon: "fa-solid fa-route", resizable: true },
    position: { width: 760, height: 680 },
    actions: {
      node: PathWindow.#onNode, tab: PathWindow.#onTab, learn: PathWindow.#onLearn, undo: PathWindow.#onUndo, resetTree: PathWindow.#onReset,
      gmAward: PathWindow.#onAward, gmRespec: PathWindow.#onRespec, gmTrees: PathWindow.#onTrees, gmRefresh: PathWindow.#onRefresh
    }
  };

  /** @param {any} actor @param {object} [options] */
  constructor(actor, options = {}) {
    super({ id: `${ID}-path-${actor.id}`, ...options });
    this.actor = actor;
    /** @type {string | null} */ this.current = null;
    /** @type {Record<string, Record<string, number>> | null} the preview (null = same as stored) */ this.pending = null;
    this.busy = false;
    /** @type {any} the facts of the last render (view-model ViewFacts) */ this.facts = null;
  }

  get title() { return `Talents · ${this.actor?.name ?? ""}`; }

  async _renderHTML() {
    const st = await stateOf(this.actor);
    const stored = st.picks.ranks;
    const pending = this.pending ?? structuredClone(stored);
    if (!this.current || !st.seen.trees.some(t => t.tree.id === this.current)) this.current = st.seen.trees[0]?.tree.id ?? null;
    const isGM = !!game.user?.isGM;
    this.facts = {
      actor: { id: this.actor.id, name: String(this.actor.name ?? ""), level: st.facts.level }, isGM,
      canEdit: isGM || this.actor.isOwner, respec: isGM || st.rules.playerRespec, gmConnected: gmConnected(), rules: st.rules,
      picks: st.picks, pending, seen: st.seen, allTrees: st.trees, current: this.current, packSet: !!packId(), busy: this.busy,
      grants: isGM ? grantSummaryOf(this.actor, st, (await loadTreesChecked()).ok) : undefined
    };
    const div = document.createElement("div");
    div.className = "wp-body";
    div.innerHTML = V.windowHTML(this.facts);
    return div;
  }

  /** @param {HTMLElement} result @param {HTMLElement} content */
  _replaceHTML(result, content) { content.replaceChildren(result); }

  /** @param {any} context @param {any} options */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Right-click: take a new rank back, or refund a learned one (when refunds are allowed).
    this.element.addEventListener("contextmenu", (/** @type {MouseEvent} */ ev) => {
      const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target)?.closest?.("[data-action=node]"));
      if (!el) return;
      ev.preventDefault();
      this.#unclick(String(el.dataset.node ?? ""));
    });
    this.element.addEventListener("change", (/** @type {Event} */ ev) => {
      const el = /** @type {HTMLSelectElement} */ (ev.target);
      if (el?.dataset?.change === "enable" && game.user?.isGM) send("pathEnable", { actorId: this.actor.id, enabled: el.value });
    });
  }

  /** @param {any} options */
  _onClose(options) { super._onClose(options); open.delete(this.actor.id); }

  /** Picks or rules changed: the preview is dropped (what was learned is now stored). */
  refresh({ keepPending = false } = {}) { if (!keepPending) this.pending = null; this.busy = false; if (this.rendered) this.render(); }

  #row(/** @type {string} */ node) {
    const m = V.viewModel(/** @type {any} */ (this.facts));
    return m.screen === "tree" ? (m.nodes ?? []).find(n => n.node.id === node) ?? null : null;
  }

  /** Left click: one more rank in the preview. */
  static #onNode(/** @type {Event} */ _ev, /** @type {HTMLElement} */ el) {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    const id = String(el.dataset.node ?? ""); const row = self.#row(id); const tree = self.current;
    if (!row || !tree || !row.canLearn) return;
    const pending = structuredClone(self.facts.pending);
    (pending[tree] ??= {})[id] = row.rank + 1;
    self.pending = pending; self.render();
  }

  #unclick(/** @type {string} */ id) {
    const row = this.#row(id); const tree = this.current; if (!row || !tree) return;
    if (row.canUndo) {
      const pending = structuredClone(this.facts.pending);
      (pending[tree] ??= {})[id] = row.rank - 1;
      // Pending ranks that no longer fit (a dependant of this one) go back to what is stored.
      const t = this.facts.seen.trees.find((/** @type {any} */ x) => x.tree.id === tree)?.tree;
      if (t) pending[tree] = V.trimPending(t, this.facts.picks.ranks[tree] ?? {}, pending[tree], this.facts.actor.level);
      this.pending = pending; this.render();
      return;
    }
    if (row.canRefund) this.#confirmRefund(tree, id, row.node.name);
  }

  async #confirmRefund(/** @type {string} */ tree, /** @type {string} */ node, /** @type {string} */ name) {
    const ok = await DialogV2.confirm({ classes: ["wp-window", ...UI_CLASSES], window: { title: "Refund a rank" }, content: `<p>Refund one rank of <strong>${esc(name)}</strong>? Talents that need it are refunded too.</p>`, rejectClose: false });
    if (ok) send("pathRefund", { actorId: this.actor.id, tree, node });
  }

  static #onTab(/** @type {Event} */ _ev, /** @type {HTMLElement} */ el) {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    self.current = String(el.dataset.tree ?? ""); self.render();
  }

  static #onUndo() { const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this)); self.pending = null; self.render(); }

  static #onLearn() {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    const changes = learnChanges(self.facts.picks.ranks, self.facts.pending);
    if (!changes.length) return;
    if (send("pathLearn", { actorId: self.actor.id, changes })) { self.busy = true; self.render(); setTimeout(() => { if (self.busy) self.refresh({ keepPending: true }); }, 8000); }
  }

  static async #onReset() {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    const tree = self.facts.seen.trees.find((/** @type {any} */ t) => t.tree.id === self.current)?.tree; if (!tree) return;
    const ok = await DialogV2.confirm({ classes: ["wp-window", ...UI_CLASSES], window: { title: "Reset tree" }, content: `<p>Refund every talent in <strong>${esc(tree.name)}</strong>?</p>`, rejectClose: false });
    if (ok) { self.pending = null; send("pathRefund", { actorId: self.actor.id, tree: tree.id }); }
  }

  static async #onAward() {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    if (!game.user?.isGM) return;
    const r = await DialogV2.prompt({
      classes: ["wp-window", ...UI_CLASSES], window: { title: `Award points · ${self.actor.name}` }, rejectClose: false,
      content: `<div class="wp-form"><label>Points <input type="number" name="n" value="1" min="-${AWARD_MAX}" max="${AWARD_MAX}" step="1"></label>
        <label>Reason <input type="text" name="reason" maxlength="${REASON_MAX}" placeholder="What it was for"></label><p class="wc-hint">A negative number takes points back.</p></div>`,
      ok: { label: "Award", callback: (/** @type {Event} */ _e, /** @type {any} */ button) => ({ n: Math.round(Number(button.form.elements.n.value)), reason: String(button.form.elements.reason.value ?? "").trim() }) }
    });
    if (!r || !Number.isFinite(r.n) || !r.n) return;
    send("pathAward", { actorId: self.actor.id, n: Math.max(-AWARD_MAX, Math.min(AWARD_MAX, r.n)), reason: r.reason.slice(0, REASON_MAX) });
  }

  static async #onRespec() {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    if (!game.user?.isGM) return;
    const ok = await DialogV2.confirm({ classes: ["wp-window", ...UI_CLASSES], window: { title: "Free respec" }, content: `<p>Refund every talent ${esc(self.actor.name)} has, in every tree (including trees no longer published)? Awards stay.</p>`, rejectClose: false });
    if (ok) { self.pending = null; send("pathRefund", { actorId: self.actor.id }); }
  }

  static #onRefresh() {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    if (!game.user?.isGM) return;
    send("pathRefresh", { actorId: self.actor.id });
  }

  static #onTrees(/** @type {Event} */ _ev, /** @type {HTMLElement} */ el) {
    const self = /** @type {PathWindow} */ (/** @type {unknown} */ (this));
    if (!game.user?.isGM) return;
    send("pathTrees", { actorId: self.actor.id, tree: String(el.dataset.tree ?? ""), op: String(el.dataset.op ?? "") });
  }
}

/**
 * Opens (or brings forward) the talent window of a character. Actor, id or UUID.
 * @param {any} a
 */
export function openWindow(a) {
  const actor = actorFrom(a);
  if (!actor) { ui.notifications.warn(`${TITLE}: no character to open.`); return null; }
  if (actor.type !== "character") { ui.notifications.warn(`${TITLE}: ${actor.name} isn't a player character.`); return null; }
  if (!actor.testUserPermission?.(game.user, "OBSERVER")) { ui.notifications.warn(`${TITLE}: you can't view ${actor.name}.`); return null; }
  let app = open.get(actor.id);
  if (!app) { app = new PathWindow(actor); open.set(actor.id, app); }
  app.render({ force: true });
  if (app.rendered) app.bringToFront?.();
  return app;
}

/** The key binding: your character (players), the selected token's character (GMs); a second press closes it when in front. */
export function openFromKey() {
  const pick = V.pickActor({
    isGM: !!game.user?.isGM, controlled: (canvas?.ready ? canvas.tokens?.controlled ?? [] : []).map((/** @type {any} */ t) => t.actor), character: game.user?.character,
    owned: game.user?.isGM || game.user?.character ? [] : (game.actors?.filter((/** @type {any} */ a) => a.type === "character" && a.isOwner) ?? [])
  });
  if (pick.warn !== undefined) return ui.notifications.info(pick.warn);
  const app = open.get(pick.actor.id);
  if (app?.rendered && !app.minimized && ui.activeWindow === app) return app.close();
  return openWindow(pick.actor);
}

/** A character the default open picks (API with no argument): the assigned character, else the selected token's. */
export function defaultActor() {
  const pick = V.pickActor({ isGM: !!game.user?.isGM, controlled: (canvas?.ready ? canvas.tokens?.controlled ?? [] : []).map((/** @type {any} */ t) => t.actor), character: game.user?.character,
    owned: game.user?.isGM || game.user?.character ? [] : (game.actors?.filter((/** @type {any} */ a) => a.type === "character" && a.isOwner) ?? []) });
  return pick.actor ?? null;
}

/** Redraws every open window (rules or trees changed). */
export const refreshAll = () => { for (const app of open.values()) app.refresh({ keepPending: true }); };

/** dnd5e's sheet header menu: a Talents entry on character sheets (feature sheetButton). @param {any} app @param {any[]} controls */
export function addHeaderControl(app, controls) {
  const actor = app?.document ?? app?.actor;
  if (!(actor instanceof Actor) || actor.type !== "character" || !Array.isArray(controls)) return;
  if (app.options?.actions && !app.options.actions.wpTalents) app.options.actions.wpTalents = function () { const a = this.document ?? this.actor; if (a) openWindow(a); };
  controls.push({ icon: "fa-solid fa-route", label: "Talents", action: "wpTalents", visible: true });
}

/** Hooks for open windows (init, feature on). Each bails out unless the change is about an open window's character. */
export function registerHooks() {
  Hooks.on("updateActor", (/** @type {any} */ actor, /** @type {any} */ changes) => {
    const app = open.get(actor?.id); if (!app) return;
    const ours = foundry.utils.hasProperty(changes, `flags.${ID}.${PICKS_FLAG}`) || Object.keys(changes?.flags?.[ID] ?? {}).some(k => k.includes(PICKS_FLAG));
    if (ours) return app.refresh();
    if (foundry.utils.hasProperty(changes, "system.details")) app.refresh({ keepPending: true });
  });
  const itemChange = (/** @type {any} */ item) => {
    if (item?.type !== "class" && item?.type !== "subclass") return;
    const app = open.get(item.parent?.id); if (app) app.refresh({ keepPending: true });
  };
  for (const h of ["createItem", "updateItem", "deleteItem"]) Hooks.on(h, itemChange);
  // A granted item or effect added or removed: the GM box's count changes.
  const grantChange = (/** @type {any} */ doc) => {
    if (!game.user?.isGM || !doc?.flags?.[ID]?.[GRANTED_FLAG]) return;
    const app = open.get(doc.parent?.id); if (app) app.refresh({ keepPending: true });
  };
  for (const h of ["createItem", "deleteItem", "createActiveEffect", "deleteActiveEffect"]) Hooks.on(h, grantChange);
  onTreesChanged(refreshAll);
  onRulesChanged(refreshAll);
  // Who is connected changes whether Learn works.
  Hooks.on("userConnected", (/** @type {any} */ user) => { if (user?.isGM) refreshAll(); });
}

