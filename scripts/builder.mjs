/**
 * The GM's "Build a talent effect" window (feature "builder"; ApplicationV2, core's RememberedWindow key "builder"), opened from our
 * Settings window and `api.builder.open()`. Until the tree editor exists (slice 5), this is where a GM puts a built spec into a node's
 * rank slot: it reads the published trees, shows the template form and its preview (builder-view-model.mjs), and on Save writes the
 * tree back into its JournalEntry's `flags.wanderers-path.tree` in the tree compendium (the GM's own edit of their content, not an
 * automatic write: no leader needed). Granted copies follow on the next reconcile (Refresh granted items). The spell picker (Grant a
 * spell) takes a dropped Item or a pasted UUID and checks it against the compendium's index (or the world's items), never fromUuid.
 * Untested in Node.
 */
import { RememberedWindow } from "../vendor/wanderers-core/foundry/index.mjs";
import { UI_CLASSES } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, TREE_FLAG } from "./const.mjs";
import { log, warn } from "./core.mjs";
import { normalizeTree } from "./tree-model.mjs";
import { withBuiltSlot } from "./builder-model.mjs";
import { buildState, builderHTML, readForm, stateSpec, parseItemUuid, spellInfo } from "./builder-view-model.mjs";
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
  /** @type {import("./builder-view-model.mjs").SpellInfo | null} the last spell lookup */ spell = null;

  async _renderHTML() {
    const div = document.createElement("div"); div.className = "wp-scroll";
    if (!game.user?.isGM) { div.textContent = "GM only."; return div; }
    const trees = await loadTrees();
    this.state = buildState({ ...(this.state ?? {}), ...this.raw }, trees);
    const uuid = this.state.template === "spell" ? String(this.state.params.spell ?? "") : "";
    if (uuid && this.spell?.uuid !== uuid) this.spell = await lookupSpell(uuid);
    div.innerHTML = builderHTML(this.state, trees, { supported: builtOk(), packLocked: !!pack()?.locked, spell: uuid ? this.spell : null });
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
    if (!game.user?.isGM || self.busy || !self.state) return;
    self.raw = { ...self.#values(), prevTemplate: self.state.template };
    const s = buildState({ ...self.state, ...self.raw }, await loadTrees());
    if (s.template === "spell") { const sp = await lookupSpell(String(s.params.spell ?? "")); if (!sp.ok) return ui.notifications.warn(`${TITLE}: ${sp.error}`); }
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

/** Opens the builder (GM). */
export function openBuilder() {
  if (!game.user?.isGM) { ui.notifications.warn(`${TITLE}: GM only.`); return null; }
  app ??= new BuilderWindow();
  app.render({ force: true });
  return app;
}
