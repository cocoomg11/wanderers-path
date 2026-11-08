/**
 * The GM's "Build a talent effect" window (feature "builder"; ApplicationV2, core's RememberedWindow key "builder"). Since 0.6.0 it
 * is opened by the tree editor's **Build…** button on one rank slot of the tree being edited (`openBuilder(target)`): it shows the
 * template form and its preview (builder-view-model.mjs) and, on **Use for this rank**, hands the changed tree back to the editor
 * (`target.onSave(tree)`), which keeps it in the working copy (undo, Save draft, Publish). The builder writes nothing itself: tree
 * writes live only in editor.mjs. The spell picker (Grant a spell) takes a dropped Item or a pasted UUID and checks it against the
 * compendium's index (or the world's items), never fromUuid. Untested in Node.
 */
import { RememberedWindow } from "../vendor/wanderers-core/foundry/index.mjs";
import { UI_CLASSES } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE } from "./const.mjs";
import { log, warn } from "./core.mjs";
import { withBuiltSlot } from "./builder-model.mjs";
import { buildState, builderHTML, readForm, stateSpec, parseItemUuid, spellInfo } from "./builder-view-model.mjs";
import { builtOk } from "./path.mjs";

/**
 * What the builder edits: one rank slot of the editor's working copy. `tree()` returns the current working copy (null when the
 * editor moved to another tree); `onSave(tree)` takes the changed tree and returns whether it was applied.
 * @typedef {{ tree: () => import("./tree-model.mjs").Tree | null, node: string, slot: number, onSave: (tree: Record<string, any>) => boolean }} BuildTarget
 */

const { ApplicationV2 } = foundry.applications.api;
/** Placement key (never rename). */
export const BUILDER_KEY = "builder";
/** @type {BuilderWindow | null} */
let app = null;

export class BuilderWindow extends RememberedWindow(ApplicationV2, { moduleId: ID, key: BUILDER_KEY }) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-builder`, tag: "form", form: { closeOnSubmit: false },
    classes: ["wp-window", "wp-builder-window", ...UI_CLASSES],
    window: { title: `${TITLE} · Build a talent effect`, icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 480, height: 620 },
    actions: { save: BuilderWindow.#onSave }
  };
  /** @type {Record<string, any>} */ raw = {};
  /** @type {import("./builder-view-model.mjs").BuildState | null} */ state = null;
  busy = false;
  /** @type {import("./builder-view-model.mjs").SpellInfo | null} the last spell lookup */ spell = null;
  /** @type {BuildTarget | null} */ target = null;

  /** The tree being edited, as a one-item list (or none when the editor moved on). */
  #trees() { const t = this.target?.tree(); return t ? [t] : []; }

  async _renderHTML() {
    const div = document.createElement("div"); div.className = "wp-scroll";
    if (!game.user?.isGM) { div.textContent = "GM only."; return div; }
    const trees = this.#trees();
    if (!this.target || !trees.length) { div.innerHTML = `<p class="wc-hint">Open the tree editor and click Build… on a talent's rank slot.</p>`; return div; }
    this.state = buildState({ ...(this.state ?? {}), ...this.raw, tree: trees[0].id, node: this.target.node, slot: this.target.slot }, trees);
    const uuid = this.state.template === "spell" ? String(this.state.params.spell ?? "") : "";
    if (uuid && this.spell?.uuid !== uuid) this.spell = await lookupSpell(uuid);
    div.innerHTML = builderHTML(this.state, trees, { supported: builtOk(), fixed: true, spell: uuid ? this.spell : null });
    return div;
  }

  /** @param {HTMLElement} result @param {HTMLElement} content */
  _replaceHTML(result, content) { content.replaceChildren(result); }

  /** @param {any} context @param {any} options */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Every change redraws the form and its preview; Enter never submits.
    this.element.addEventListener("change", () => { this.raw = { ...this.#values(), prevTemplate: this.state?.template }; this.render(); });
    // The spell picker: drop a spell (an Item from the sidebar or a compendium) onto it.
    this.element.addEventListener("dragover", (/** @type {DragEvent} */ ev) => { if (/** @type {HTMLElement} */ (ev.target)?.closest?.("[data-wp-drop]")) ev.preventDefault(); });
    this.element.addEventListener("drop", (/** @type {DragEvent} */ ev) => {
      if (!/** @type {HTMLElement} */ (ev.target)?.closest?.("[data-wp-drop=spell]")) return;
      ev.preventDefault();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      if (data?.type !== "Item" || typeof data.uuid !== "string") return ui.notifications.warn(`${TITLE}: drop a spell item.`);
      const v = this.#values(); v.params = { ...(v.params ?? {}), spell: data.uuid };
      this.raw = { ...v, prevTemplate: this.state?.template }; this.render();
    });
    this.element.addEventListener("keydown", (/** @type {KeyboardEvent} */ ev) => { if (ev.key === "Enter" && /** @type {HTMLElement} */ (ev.target)?.tagName === "INPUT") { ev.preventDefault(); /** @type {HTMLElement} */ (ev.target).blur(); } });
  }

  /** The form's fields as strings. */
  #values() {
    /** @type {Record<string, string>} */ const out = {};
    for (const el of /** @type {any} */ (this.element).querySelectorAll("select[name], input[name]")) out[el.name] = String(el.value ?? "");
    return readForm(out);
  }

  static async #onSave() {
    const self = /** @type {BuilderWindow} */ (/** @type {unknown} */ (this));
    if (!game.user?.isGM || self.busy || !self.state || !self.target) return;
    const trees = self.#trees();
    if (!trees.length) return ui.notifications.warn(`${TITLE}: the tree editor shows another tree now.`);
    self.raw = { ...self.#values(), prevTemplate: self.state.template };
    const s = buildState({ ...self.state, ...self.raw, tree: trees[0].id, node: self.target.node, slot: self.target.slot }, trees);
    if (s.template === "spell") { const sp = await lookupSpell(String(s.params.spell ?? "")); if (!sp.ok) return ui.notifications.warn(`${TITLE}: ${sp.error}`); }
    self.busy = true;
    try {
      const r = withBuiltSlot(trees[0], s.node, s.slot, stateSpec(s), s.mode);
      if (!r.ok) return ui.notifications.warn(`${TITLE}: ${r.error}`);
      if (!self.target.onSave(r.tree)) return;
      log(`builder: ${s.tree}.${s.node} slot ${s.slot} = ${s.template} (in the editor's working copy)`);
      ui.notifications.info(`${TITLE}: built into the talent. Save the draft and publish it in the tree editor.`);
      self.busy = false;
      await self.close();
    } finally { self.busy = false; if (self.rendered) self.render(); }
  }
}

/**
 * Whether a UUID is a spell, from the compendium's index (type and name are in every index) or the world's items: no document load.
 * @param {string} uuid @returns {Promise<import("./builder-view-model.mjs").SpellInfo>}
 */
async function lookupSpell(uuid) {
  const at = parseItemUuid(uuid);
  if (!at) return spellInfo(uuid, null);
  try {
    if (!at.pack) return spellInfo(uuid, game.items?.get(at.id) ?? null);
    const p = game.packs?.get(at.pack);
    if (!p || p.documentName !== "Item") return spellInfo(uuid, null);
    const index = await p.getIndex();
    return spellInfo(uuid, index.get(at.id) ?? null);
  } catch (e) { warn("spell lookup", e); return spellInfo(uuid, null); }
}

/** Opens the builder on one rank slot of the tree editor's working copy (GM; the editor calls this). @param {BuildTarget} target */
export function openBuilder(target) {
  if (!game.user?.isGM) { ui.notifications.warn(`${TITLE}: GM only.`); return null; }
  app ??= new BuilderWindow();
  const same = app.target && app.target.node === target.node && app.target.slot === target.slot && app.target.tree()?.id === target.tree()?.id;
  app.target = target;
  if (!same) { app.state = null; app.raw = {}; app.spell = null; }
  app.render({ force: true });
  return app;
}
