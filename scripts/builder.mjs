/**
 * The GM's "Build a talent effect" window (feature "builder"; ApplicationV2, core's RememberedWindow key "builder"), opened from our
 * Settings window and `api.builder.open()`. Until the tree editor exists (slice 5), this is where a GM puts a built spec into a node's
 * rank slot: it reads the published trees, shows the template form and its preview (builder-view-model.mjs), and on Save writes the
 * tree back into its JournalEntry's `flags.wanderers-path.tree` in the tree compendium (the GM's own edit of their content, not an
 * automatic write: no leader needed). Granted copies follow on the next reconcile (Refresh granted items). Untested in Node.
 */
import { RememberedWindow } from "../vendor/wanderers-core/foundry/index.mjs";
import { UI_CLASSES } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, TREE_FLAG } from "./const.mjs";
import { log } from "./core.mjs";
import { normalizeTree } from "./tree-model.mjs";
import { withBuiltSlot } from "./builder-model.mjs";
import { buildState, builderHTML, readForm, stateSpec } from "./builder-view-model.mjs";
import { loadTrees, pack, invalidate } from "./trees.mjs";
import { builtOk } from "./path.mjs";

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

  async _renderHTML() {
    const div = document.createElement("div"); div.className = "wp-scroll";
    if (!game.user?.isGM) { div.textContent = "GM only."; return div; }
    const trees = await loadTrees();
    this.state = buildState({ ...(this.state ?? {}), ...this.raw }, trees);
    div.innerHTML = builderHTML(this.state, trees, { supported: builtOk(), packLocked: !!pack()?.locked });
    return div;
  }

  /** @param {HTMLElement} result @param {HTMLElement} content */
  _replaceHTML(result, content) { content.replaceChildren(result); }

  /** @param {any} context @param {any} options */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Every change redraws the form and its preview; Enter never submits.
    this.element.addEventListener("change", () => { this.raw = { ...this.#values(), prevTemplate: this.state?.template }; this.render(); });
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
    if (!game.user?.isGM || self.busy || !self.state) return;
    self.raw = { ...self.#values(), prevTemplate: self.state.template };
    const s = buildState({ ...self.state, ...self.raw }, await loadTrees());
    const p = pack();
    if (!p) return ui.notifications.warn(`${TITLE}: no tree compendium is chosen.`);
    if (p.locked) return ui.notifications.warn(`${TITLE}: the tree compendium is locked.`);
    self.busy = true;
    try {
      const index = await p.getIndex({ fields: [`flags.${ID}.${TREE_FLAG}`] });
      const entry = [...index].find(e => normalizeTree(e?.flags?.[ID]?.[TREE_FLAG]).id === s.tree);
      if (!entry) return ui.notifications.warn(`${TITLE}: that tree isn't in the compendium any more.`);
      const doc = await p.getDocument(entry._id);
      const r = withBuiltSlot(doc?.getFlag(ID, TREE_FLAG), s.node, s.slot, stateSpec(s), s.mode);
      if (!r.ok) return ui.notifications.warn(`${TITLE}: ${r.error}`);
      // The whole tree flag is written back (Foundry merges objects; the nodes array is replaced as a whole).
      await doc.update({ [`flags.${ID}.${TREE_FLAG}`]: r.tree });
      invalidate();
      log(`builder: ${s.tree}.${s.node} slot ${s.slot} = ${s.template}`);
      ui.notifications.info(`${TITLE}: saved. Characters who learned it get it on the next change, or now with Refresh granted items.`);
    } finally { self.busy = false; self.render(); }
  }
}

/** Opens the builder (GM). */
export function openBuilder() {
  if (!game.user?.isGM) { ui.notifications.warn(`${TITLE}: GM only.`); return null; }
  app ??= new BuilderWindow();
  app.render({ force: true });
  return app;
}
