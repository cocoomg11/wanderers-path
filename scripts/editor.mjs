/**
 * The GM tree editor (feature "editor"; ApplicationV2, core's RememberedWindow key "editor"), opened from our Settings window,
 * `api.editor.open(treeId?)` and the Satchel (Settings). Untested in Node: the rules and the markup are pure (editor-model.mjs,
 * editor-view-model.mjs, draft-model.mjs); this file wires them to Foundry.
 *
 * The working copy is a tree in memory: every edit goes through editor-model (with an undo history), Save draft writes it to the
 * GM-only drafts store (drafts.mjs), Publish writes it to the tree compendium. **This is the one place that writes trees**: the
 * tree flag (`flags.wanderers-path.tree`) and its readable page on the tree's Journal Entry, and deletes a tree's entry. Every write
 * is a GM click, so no leader is needed (the GM editing their own content). Granted copies follow on the next reconcile.
 *
 * Documents dropped onto the editor are read once each (one fromUuid per drop: a GM action, never per node); the browser's list
 * and the class choices come from indexes (`getIndex`), and slot names from fromUuidSync or a pack's index.
 */
import { RememberedWindow } from "../vendor/wanderers-core/foundry/index.mjs";
import { UI_CLASSES, esc } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, TREE_FLAG, PICKS_FLAG, PAGE_FLAG } from "./const.mjs";
import { F, S, log, warn } from "./core.mjs";
import { normalizeTree } from "./tree-model.mjs";
import * as E from "./editor-model.mjs";
import { editorHTML, sourcesHTML, searchDocs, readFieldName } from "./editor-view-model.mjs";
import { DRAFTS_MAX, treeList, draftState, changeSummary, treeHash, saveErrorText } from "./draft-model.mjs";
import { hasAdvancement } from "./grants-model.mjs";
import * as Drafts from "./drafts.mjs";
import { loadTrees, pack, invalidate, onTreesChanged, uuidExists } from "./trees.mjs";
import { sendAndWait } from "./path.mjs";
import { openBuilder } from "./builder.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
/** Placement key (never rename). */
export const EDITOR_KEY = "editor";
/** The compendium Publish offers to create when none is chosen. */
export const NEW_PACK = Object.freeze({ name: "talent-trees", label: "Talent trees" });
/** The readable page's name in a tree's Journal Entry. */
export const PAGE_NAME = "Talents";
/** @type {EditorWindow | null} */
let app = null;
let hooked = false;

const dialog = { classes: ["wp-window", ...UI_CLASSES], rejectClose: false };
/** @param {string} title @param {string} html */
const confirm = (title, html) => DialogV2.confirm({ ...dialog, window: { title }, content: html });
/** @param {string} text */
const warnUser = text => ui.notifications.warn(`${TITLE}: ${text}`);
/** Tells the GM which drafts a save dropped past the cap. @param {{ name: string }[]} lost */
const warnEvicted = lost => { if (lost?.length) warnUser(`the drafts are full (at most ${DRAFTS_MAX}): the oldest ${lost.length === 1 ? "draft was" : "drafts were"} dropped (${lost.map(d => d.name).join(", ")}).`); };

/** Characters with ranks in a tree (by node, or any node when `nodes` is null). @param {string} treeId @param {string[] | null} [nodes] */
function rankHolders(treeId, nodes = null) {
  return (game.actors?.contents ?? []).filter((/** @type {any} */ a) => {
    const r = a.flags?.[ID]?.[PICKS_FLAG]?.ranks?.[treeId];
    if (!r || typeof r !== "object") return false;
    return Object.entries(r).some(([n, v]) => Number(v) > 0 && (!nodes || nodes.includes(n)));
  });
}

/** The compendium class (v13 / v14). */
const CompendiumCls = () => foundry.documents?.collections?.CompendiumCollection ?? /** @type {any} */ (globalThis).CompendiumCollection;

export class EditorWindow extends RememberedWindow(ApplicationV2, { moduleId: ID, key: EDITOR_KEY }) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-editor`,
    classes: ["wp-window", "wp-path-window", "wp-editor-window", ...UI_CLASSES],
    window: { title: `${TITLE} · Tree editor`, icon: "fa-solid fa-sitemap", resizable: true },
    position: { width: 1200, height: 780 },
    actions: {
      pickTree: EditorWindow.#onPickTree, newTree: EditorWindow.#onNewTree, duplicateTree: EditorWindow.#onDuplicate, deleteTree: EditorWindow.#onDeleteTree,
      selectNode: EditorWindow.#onSelectNode, deselect: EditorWindow.#onDeselect, addNode: EditorWindow.#onAddNode, deleteNode: EditorWindow.#onDeleteNode,
      addTier: EditorWindow.#onAddTier, removeTier: EditorWindow.#onRemoveTier, linkMode: EditorWindow.#onLinkMode, undo: EditorWindow.#onUndo,
      saveDraft: EditorWindow.#onSaveDraft, discardDraft: EditorWindow.#onDiscard, publish: EditorWindow.#onPublish,
      buildSlot: EditorWindow.#onBuildSlot, clearSlot: EditorWindow.#onClearSlot, unlink: EditorWindow.#onUnlink, unexclude: EditorWindow.#onUnexclude,
      addAssign: EditorWindow.#onAddAssign, removeAssign: EditorWindow.#onRemoveAssign, pickImg: EditorWindow.#onPickImg
    }
  };

  /** @type {string | null} the tree being edited */ current = null;
  /** @type {import("./tree-model.mjs").Tree | null} the working copy */ work = null;
  dirty = false;
  history = E.emptyHistory();
  /** @type {string | null} */ selected = null;
  linkMode = false;
  search = "";
  busy = false;
  /** @type {string | null} hash of the published tree the working copy was opened from (no draft yet), for Publish's stale warning */ base = null;
  /** @type {Promise<any[]> | null} */ #sources = null;
  /** @type {Promise<any> | null} */ #classes = null;
  /** @type {Map<string, { name: string, img?: string }>} */ #labels = new Map();

  async _renderHTML() {
    const div = document.createElement("div"); div.className = "wp-body";
    if (!game.user?.isGM) { div.textContent = "GM only."; return div; }
    const published = await loadTrees();
    const store = Drafts.read();
    const pub = published.find(t => t.id === this.current) ?? null;
    const draft = this.current ? store.drafts[this.current] ?? null : null;
    if (this.current && !this.work) {
      const t = draft?.tree ?? pub;
      if (t) { this.work = normalizeTree(t); this.base = draft ? null : pub ? treeHash(pub) : null; } else this.current = null;
    }
    if (this.work && this.selected && !this.work.nodes.some(n => n.id === this.selected)) this.selected = null;
    const sel = this.work && this.selected ? this.work.nodes.find(n => n.id === this.selected) ?? null : null;
    const p = pack();
    /** @type {import("./editor-view-model.mjs").EditorFacts} */
    const facts = {
      list: treeList(published, store), tree: this.work, status: this.work ? draftState(draft, pub) : null, dirty: this.dirty,
      canUndo: this.history.past.length > 0, selected: this.selected, linkMode: this.linkMode,
      sources: searchDocs(await this.#sourceList(), this.search), search: this.search,
      labels: sel ? await this.#labelsFor(sel) : {}, classes: this.work && !sel ? await this.#classChoices() : { classes: [], subclasses: [] },
      plan: this.work ? E.publishPlan(this.work, { has: uuidExists }) : null,
      builder: F.on("builder"), packName: p?.title ?? "", packLocked: !!p?.locked, busy: this.busy
    };
    div.innerHTML = editorHTML(facts);
    return div;
  }

  /** @param {HTMLElement} result @param {HTMLElement} content */
  _replaceHTML(result, content) {
    // Keep the canvas's scroll position across redraws.
    const old = content.querySelector(".wp-ed-canvas"); const top = old?.scrollTop ?? 0, left = old?.scrollLeft ?? 0;
    const insp = content.querySelector(".wp-ed-insp"); const itop = insp?.scrollTop ?? 0;
    // Focus (0.6.2): the redraw replaces the focused control; find it again by a stable selector, else focus the window, so Escape
    // and Ctrl+Z still reach the editor and not Foundry.
    const act = /** @type {HTMLElement | null} */ (document.activeElement);
    const hadFocus = !!act && act !== document.body && (content.contains(act) || act === this.element);
    const sel = hadFocus && content.contains(act) ? E.focusSelector({ ...(act?.dataset ?? {}), name: /** @type {HTMLInputElement} */ (act).name || undefined }) : null;
    content.replaceChildren(result);
    if (hadFocus) this.#refocus(content, sel);
    const c = content.querySelector(".wp-ed-canvas"); if (c) { c.scrollTop = top; c.scrollLeft = left; }
    const i = content.querySelector(".wp-ed-insp"); if (i && this.#keepInspector) i.scrollTop = itop;
    this.#keepInspector = true;
  }
  #keepInspector = true;

  /** Focuses the control `sel` finds in `content`, else the window itself (tabindex -1). @param {HTMLElement} content @param {string | null} sel */
  #refocus(content, sel) {
    /** @type {HTMLElement | null} */ let el = null;
    try { el = sel ? /** @type {HTMLElement | null} */ (content.querySelector(sel)) : null; } catch { el = null; }
    const target = el && !(/** @type {any} */ (el).disabled) ? el : /** @type {HTMLElement | null} */ (this.element);
    target?.focus?.({ preventScroll: true });
  }

  /** The document-level key listener while the editor is open (0.6.2); null when not added. @type {((ev: KeyboardEvent) => void) | null} */
  #docKey = null;

  /** @param {any} context @param {any} options */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const root = /** @type {HTMLElement} */ (this.element);
    root.addEventListener("change", ev => this.#onChange(/** @type {HTMLInputElement} */ (ev.target)));
    root.addEventListener("input", ev => { const el = /** @type {HTMLInputElement} */ (ev.target); if (el?.name === "search") this.#onSearch(el.value); });
    root.tabIndex = -1;
    root.addEventListener("keydown", ev => this.#onKey(ev));
    // Escape (link mode) and Ctrl+Z also when focus fell back to the page: capture on the window, before Foundry's key bindings.
    if (!this.#docKey) { this.#docKey = ev => this.#onDocKey(ev); window.addEventListener("keydown", this.#docKey, true); }
    // Foundry's Space key binding (pause) listens on the document: Space and Enter on our controls stay here.
    root.addEventListener("keyup", ev => { if (ev.key === " " || ev.key === "Enter") ev.stopPropagation(); });
    root.addEventListener("dragstart", ev => this.#onDragStart(ev));
    root.addEventListener("dragover", ev => { if (/** @type {HTMLElement} */ (ev.target)?.closest?.("[data-cell], [data-wp-slot]")) ev.preventDefault(); });
    root.addEventListener("drop", ev => { this.#onDrop(ev); });
  }

  /** Closing with unsaved changes asks first. @param {any} [options] */
  async close(options = {}) {
    if (this.dirty && !options?.force && game.user?.isGM) {
      const ok = await confirm("Unsaved changes", `<p>Close the editor without saving the draft of <strong>${esc(this.work?.name ?? "")}</strong>?</p>`);
      if (!ok) return this;
      // The window is one shared instance: drop the discarded working copy and its undo history, so reopening reads the saved state.
      this.dirty = false; this.work = null; this.history = E.emptyHistory(); this.selected = null; this.linkMode = false; this.base = null;
    }
    return super.close(options);
  }

  /** @param {any} options */
  _onClose(options) {
    super._onClose(options);
    if (this.#docKey) { window.removeEventListener("keydown", this.#docKey, true); this.#docKey = null; }
    this.#sources = null; this.#classes = null; this.#labels.clear(); }

  // ---------------------------------------------------------------- state helpers
  /** Applies an edit (a notice on refusal). @param {E.EditResult & { id?: string }} r @param {{ select?: string | null }} [o] */
  #edit(r, o = {}) {
    if (!r.ok) { warnUser(r.error); return false; }
    if (this.work) this.history = E.pushHistory(this.history, this.work);
    this.work = r.tree; this.dirty = true;
    if (o.select !== undefined) this.selected = o.select;
    this.render();
    return true;
  }

  /** Switches to a tree (asks first when there are unsaved changes). @param {string | null} id */
  async #switchTo(id) {
    if (id === this.current) return true;
    if (this.dirty && !(await confirm("Unsaved changes", `<p>Drop the unsaved changes to <strong>${esc(this.work?.name ?? "")}</strong>?</p>`))) return false;
    this.current = id; this.work = null; this.dirty = false; this.history = E.emptyHistory(); this.selected = null; this.linkMode = false; this.base = null;
    return true;
  }

  /** Every tree id in use: published and drafts. */
  async #taken() { return [...(await loadTrees()).map(t => t.id), ...Object.keys(Drafts.read().drafts)]; }

  /** The published version of the current tree, or null. */
  async #published() { return (await loadTrees()).find(t => t.id === this.current) ?? null; }

  /** Items the browser lists: world items and world Item compendiums (index only), loaded once per open. */
  #sourceList() {
    this.#sources ??= (async () => {
      /** @type {any[]} */ const out = [];
      for (const i of game.items ?? []) out.push({ uuid: i.uuid, name: String(i.name ?? ""), img: String(i.img ?? ""), type: String(i.type ?? ""), documentName: "Item", from: "Items" });
      for (const p of game.packs ?? []) {
        if (p.documentName !== "Item" || p.metadata?.packageType !== "world") continue;
        try { for (const e of await p.getIndex()) out.push({ uuid: e.uuid ?? `Compendium.${p.collection}.Item.${e._id}`, name: String(e.name ?? ""), img: String(e.img ?? ""), type: String(e.type ?? ""), documentName: "Item", from: String(p.title ?? p.collection) }); }
        catch (e) { warn(`editor: couldn't read ${p.collection}`, e); }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    })();
    return this.#sources;
  }

  /** Class and subclass choices from the world's items and every Item compendium's index (loaded once per open). */
  #classChoices() {
    this.#classes ??= (async () => {
      /** @type {any[]} */ const entries = [...(game.items ?? [])].filter((/** @type {any} */ i) => i.type === "class" || i.type === "subclass");
      for (const p of game.packs ?? []) {
        if (p.documentName !== "Item") continue;
        try { for (const e of await p.getIndex({ fields: ["system.identifier"] })) if (e.type === "class" || e.type === "subclass") entries.push(e); }
        catch (e) { warn(`editor: couldn't read ${p.collection}`, e); }
      }
      return E.classChoices(entries);
    })();
    return this.#classes;
  }

  /** Names of the documents a node's slots point to (fromUuidSync, else the pack's index). @param {import("./tree-model.mjs").TalentNode} n */
  async #labelsFor(n) {
    /** @type {Record<string, { name: string, img?: string }>} */ const out = {};
    for (const r of n.grant.ranks) {
      if (!("uuid" in r)) continue;
      const u = r.uuid;
      if (!this.#labels.has(u)) {
        let name = "";
        try { name = String(fromUuidSync(u, { strict: false })?.name ?? ""); } catch { name = ""; }
        if (!name && u.startsWith("Compendium.")) {
          const parts = u.split("."); const pk = game.packs?.get(`${parts[1]}.${parts[2]}`);
          try { const e = pk ? (await pk.getIndex()).get(parts[4]) : null; if (e) name = `${e.name}${parts.length > 5 ? " (effect)" : ""}`; } catch { name = ""; }
        }
        this.#labels.set(u, { name: name || (uuidExists(u) === false ? `Missing: ${u}` : u) });
      }
      out[u] = /** @type {{ name: string }} */ (this.#labels.get(u));
    }
    return out;
  }

  // ---------------------------------------------------------------- fields
  /** @param {HTMLInputElement} el */
  #onChange(el) {
    const f = readFieldName(el?.name); if (!f || !this.work) return;
    const value = el.type === "checkbox" ? el.checked : String(el.value ?? "");
    if (f.scope === "tree") return this.#edit(E.setTreeFields(this.work, { [f.key]: value }));
    if (f.scope === "node" && this.selected) return this.#edit(E.updateNode(this.work, this.selected, { [f.key]: value }));
    if (f.scope === "req" && this.selected) return this.#edit(E.setPrereqRanks(this.work, this.selected, f.key, value));
    if (f.scope === "assign" && value && (f.key === "classes" || f.key === "subclasses")) return this.#edit(E.addAssign(this.work, f.key, value));
    if (f.scope === "addReq" && value && this.selected) return this.#edit(E.toggleLink(this.work, this.selected, String(value)));
    if (f.scope === "addEx" && value && this.selected) return this.#edit(E.toggleExclude(this.work, this.selected, String(value)));
  }

  #searchTimer = /** @type {any} */ (null);
  /** Redraws the browser's list only (the search box keeps focus). @param {string} text */
  #onSearch(text) {
    this.search = String(text ?? "").slice(0, 80);
    clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(async () => {
      const list = /** @type {HTMLElement | null} */ (this.element?.querySelector(".wp-ed-docs"));
      if (list) list.innerHTML = sourcesHTML({ sources: searchDocs(await this.#sourceList(), this.search), search: this.search });
    }, 150);
  }

  /** @param {KeyboardEvent} ev */
  #onKey(ev) {
    const t = /** @type {HTMLElement} */ (ev.target);
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName);
    if ((ev.key === " " || ev.key === "Enter") && !typing) ev.stopPropagation();
    if (ev.key === "Enter" && t?.tagName === "INPUT") {
      ev.preventDefault(); ev.stopPropagation();
      const name = /** @type {HTMLInputElement} */ (t).name;
      if (name.startsWith("custom.")) { this.#addCustom(name.slice(7)); return; }
      /** @type {HTMLInputElement} */ (t).blur();
      return;
    }
    // Escape and Ctrl+Z are handled by #onDocKey (window capture), which runs first for every key press.
  }

  /** Escape (leave link mode) and Ctrl+Z (undo), wherever focus is, unless typing or in another window. @param {KeyboardEvent} ev */
  #onDocKey(ev) {
    if (!this.rendered || !game.user?.isGM || !this.work) return;
    if (/** @type {any} */ (this).minimized) return;
    const t = /** @type {HTMLElement | null} */ (ev.target instanceof HTMLElement ? ev.target : null);
    const inEditor = !!t && !!this.element?.contains(t);
    const typing = !!t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);
    const otherWindow = !!t && !inEditor && !!t.closest?.(".application, .app, .window-app");
    const a = E.keyAction({ key: ev.key, ctrl: ev.ctrlKey || ev.metaKey, linkMode: this.linkMode, inEditor, typing, otherWindow, canUndo: this.history.past.length > 0 });
    if (!a) return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    if (a === "undo") this.#undo();
    else { this.linkMode = false; this.render(); }
  }

  /** @param {string} kind */
  #addCustom(kind) {
    const el = /** @type {HTMLInputElement | null} */ (this.element?.querySelector(`input[name="custom.${kind}"]`));
    const v = String(el?.value ?? "").trim(); if (!v || !this.work || (kind !== "classes" && kind !== "subclasses")) return;
    this.#edit(E.addAssign(this.work, kind, v));
  }

  #undo() {
    const u = E.undoHistory(this.history); if (!u) return;
    this.history = u.history; this.work = u.tree; this.dirty = true; this.render();
  }

  // ---------------------------------------------------------------- drag and drop
  /** @param {DragEvent} ev */
  #onDragStart(ev) {
    const el = /** @type {HTMLElement} */ (ev.target)?.closest?.("[data-uuid], .wp-ed-node");
    if (!el || !ev.dataTransfer) return;
    const data = el.matches(".wp-ed-node") ? { type: `${ID}.node`, node: /** @type {HTMLElement} */ (el).dataset.node } : { type: /** @type {HTMLElement} */ (el).dataset.doc === "ActiveEffect" ? "ActiveEffect" : "Item", uuid: /** @type {HTMLElement} */ (el).dataset.uuid };
    ev.dataTransfer.setData("text/plain", JSON.stringify(data));
  }

  /** @param {DragEvent} ev */
  async #onDrop(ev) {
    const target = /** @type {HTMLElement} */ (ev.target);
    const cellEl = /** @type {HTMLElement | null} */ (target?.closest?.("[data-cell]"));
    const slotEl = /** @type {HTMLElement | null} */ (target?.closest?.("[data-wp-slot]"));
    if (!this.work || (!cellEl && !slotEl)) return;
    ev.preventDefault(); ev.stopPropagation();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
    if (data?.type === `${ID}.node` && cellEl) {
      const at = E.readCell(cellEl.dataset.cell); if (!at || typeof data.node !== "string") return;
      return this.#edit(E.moveNode(this.work, data.node, at));
    }
    if ((data?.type !== "Item" && data?.type !== "ActiveEffect") || typeof data.uuid !== "string") return warnUser("drop an item or an active effect.");
    if (E.ownedSource(data.uuid)) return warnUser("that comes from a character or token: drag it from the Items sidebar or a compendium, so the talent doesn't depend on one actor.");
    const doc = await this.#readDoc(data.uuid);
    if (!doc) return warnUser("that document can't be read (or isn't an item or effect): drag it from the Items sidebar or a compendium.");
    if (doc.advancement) warnUser(`${doc.name} has dnd5e advancement, which doesn't run on talent grants: add what it would give by hand.`);
    if (slotEl && this.selected) return this.#edit(E.setRankSlot(this.work, this.selected, Number(slotEl.dataset.wpSlot), { uuid: doc.uuid }));
    if (!cellEl) return;
    const at = E.readCell(cellEl.dataset.cell); if (!at) return;
    if (E.nodeAt(this.work, at.tier, at.col)) return warnUser("that spot is taken: drop on an empty spot, or onto a rank slot of the selected talent.");
    const r = E.placeNode(this.work, at, doc);
    this.#edit(r, { select: r.ok ? r.id ?? null : this.selected });
  }

  /**
   * A dropped document's facts (one load per drop, a GM action): { uuid, documentName, name, img, type, advancement }, or null.
   * @param {string} uuid
   */
  async #readDoc(uuid) {
    /** @type {any} */ let d = null;
    try { d = await fromUuid(uuid); } catch (e) { warn("editor: drop", e); }
    if (!d || (d.documentName !== "Item" && d.documentName !== "ActiveEffect")) return null;
    const doc = E.readDropped({ uuid: d.uuid ?? uuid, documentName: d.documentName, name: d.name, img: d.img, type: d.type });
    if (!doc) return null;
    this.#labels.set(doc.uuid, { name: String(d.name ?? doc.uuid) });
    return { ...doc, advancement: d.documentName === "Item" && hasAdvancement(d._source ?? d) };
  }

  // ---------------------------------------------------------------- actions
  static async #onPickTree(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (await self.#switchTo(String(el.dataset.tree ?? ""))) self.render();
  }

  static async #onNewTree() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    const name = await DialogV2.prompt({ ...dialog, window: { title: "New tree" },
      content: `<div class="wp-form"><label class="wp-field"><span>Name</span><input type="text" name="name" maxlength="120" placeholder="e.g. Example Tree" autofocus></label><p class="wc-hint">A tiered tree with three columns. It is saved as a draft; players see it once you publish it.</p></div>`,
      ok: { label: "Create", callback: (/** @type {Event} */ _ev, /** @type {any} */ button) => String(button.form.elements.name.value ?? "") } });
    if (typeof name !== "string" || !name.trim()) return;
    const r = E.newTree(name, await self.#taken()); if (!r.ok) return warnUser(r.error);
    if (!(await self.#switchTo(r.tree.id))) return;
    await self.#saveNew(r.tree);
  }

  static async #onDuplicate() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work) return;
    const r = E.duplicateTree(self.work, await self.#taken()); if (!r.ok) return warnUser(r.error);
    if (!(await self.#switchTo(r.tree.id))) return;
    await self.#saveNew(r.tree);
  }

  /** A new tree goes straight into the drafts, so it shows in the list. @param {import("./tree-model.mjs").Tree} tree */
  async #saveNew(tree) {
    try { warnEvicted(await Drafts.save(tree, null)); } catch (e) { warn("editor: save draft", e); return warnUser(saveErrorText(e)); }
    this.current = tree.id; this.work = tree; this.dirty = false; this.render();
  }

  static async #onDeleteTree() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work || self.busy) return;
    const tree = self.work; const pub = await self.#published();
    if (!pub) {
      const held = rankHolders(tree.id);
      const body = held.length
        ? `<p>Delete the draft <strong>${esc(tree.name)}</strong>? It isn't in the tree compendium (never published, or removed there). ${held.length} ${held.length === 1 ? "character still has" : "characters still have"} points in it: Refund orphans (health check) clears them.</p>`
        : `<p>Delete the draft <strong>${esc(tree.name)}</strong>? It isn't in the tree compendium, and no character has points in it.</p>`;
      if (!(await confirm("Delete draft", body))) return;
      await Drafts.discard(tree.id); self.dirty = false; await self.#switchTo(null); return self.render();
    }
    const holders = rankHolders(tree.id);
    const warnText = holders.length ? `<p class="wp-warn"><strong>${holders.length} ${holders.length === 1 ? "character has" : "characters have"} points in it</strong> (${esc(holders.slice(0, 6).map((/** @type {any} */ a) => a.name).join(", "))}${holders.length > 6 ? ", …" : ""}). Their ranks become orphans: still counted as spent until refunded, and their granted items stay until then.</p>` : "";
    if (!(await confirm("Delete tree", `<p>Delete the published tree <strong>${esc(tree.name)}</strong> from the compendium${Drafts.read().drafts[tree.id] ? " and its draft" : ""}? Players lose it at once.</p>${warnText}`))) return;
    self.busy = true; self.render();
    try {
      let found = false;
      const ok = await self.#withPack(async p => {
        const entry = await self.#entryOf(p, tree.id);
        if (entry) { await entry.delete(); found = true; }
      });
      if (!ok) return;
      const hadDraft = !!Drafts.read().drafts[tree.id];
      await Drafts.discard(tree.id);
      invalidate();
      log(`editor: deleted tree ${tree.id}${found ? "" : " (not found in the compendium)"}`);
      self.dirty = false; await self.#switchTo(null);
      if (found) ui.notifications.info(`${TITLE}: ${tree.name} deleted.`);
      else warnUser(`${tree.name} wasn't found in the tree compendium (already deleted, or the compendium changed)${hadDraft ? "; its draft was deleted" : ""}.`);
      if (holders.length && await confirm("Refund orphans", `<p>Refund the ranks those characters had in <strong>${esc(tree.name)}</strong> now, and remove what they granted? (Also offered later by the health check.)</p>`)) {
        const r = await sendAndWait("pathOrphans", {});
        ui.notifications.info(`${TITLE}: ${r === false ? "Refund orphans couldn't be sent." : r === "timeout" ? "Refund orphans sent; the GM client hasn't answered yet." : "orphans refunded."}`);
      }
    } finally { self.busy = false; self.render(); }
  }

  static #onSelectNode(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    const id = String(el.dataset.node ?? ""); if (!self.work) return;
    if (self.linkMode && self.selected && self.selected !== id) { self.#edit(E.toggleLink(self.work, self.selected, id)); return; }
    self.selected = id; self.#keepInspector = false; self.render();
  }

  static #onDeselect() { const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this)); self.selected = null; self.linkMode = false; self.#keepInspector = false; self.render(); }

  static #onAddNode(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    const at = E.readCell(el.dataset.cell); if (!at || !self.work) return;
    const r = E.placeNode(self.work, at, null);
    self.#keepInspector = false;
    self.#edit(r, { select: r.ok ? r.id ?? null : self.selected });
  }

  static async #onDeleteNode() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work || !self.selected) return;
    const n = self.work.nodes.find(x => x.id === self.selected); if (!n) return;
    const holders = rankHolders(self.work.id, [n.id]);
    const extra = holders.length ? ` <strong>${holders.length} ${holders.length === 1 ? "character has" : "characters have"} ranks in it</strong>: after publishing, those become orphans (Refund orphans in the health check).` : "";
    if (!(await confirm("Delete talent", `<p>Delete <strong>${esc(n.name)}</strong> and every link to it?${extra} Undo brings it back until you close the editor.</p>`))) return;
    self.#edit(E.deleteNode(self.work, n.id), { select: null });
  }

  static #onAddTier() { const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this)); if (self.work) self.#edit(E.addTier(self.work)); }
  static #onRemoveTier() { const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this)); if (self.work) self.#edit(E.removeTier(self.work)); }
  static #onLinkMode() { const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this)); self.linkMode = !self.linkMode; self.render(); }
  static #onUndo() { /** @type {EditorWindow} */ (/** @type {unknown} */ (this)).#undo(); }

  static async #onSaveDraft() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work || self.busy) return;
    self.busy = true;
    try { const lost = await Drafts.save(self.work, await self.#published()); self.dirty = false; self.base = null; ui.notifications.info(`${TITLE}: draft saved.`); warnEvicted(lost); }
    catch (e) { warn("editor: save draft", e); warnUser(saveErrorText(e)); }
    finally { self.busy = false; self.render(); }
  }

  static async #onDiscard() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work || self.busy) return;
    const pub = await self.#published();
    if (!(await confirm("Discard draft", pub ? `<p>Drop the draft and any unsaved changes, back to the published <strong>${esc(pub.name)}</strong>?</p>` : `<p><strong>${esc(self.work.name)}</strong> was never published: discarding deletes it. Go on?</p>`))) return;
    await Drafts.discard(self.work.id);
    const id = pub ? self.work.id : null;
    self.dirty = false; self.current = null; self.work = null; await self.#switchTo(id); self.render();
  }

  /**
   * Publish (GM click): blocks on the tree's errors, shows warnings and what changes, creates the tree compendium when none is
   * chosen (asking first), unlocks a locked one only with the GM's OK (and locks it again), writes the tree flag and the readable page,
   * drops the draft and reloads the trees.
   */
  static async #onPublish() {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work || self.busy || !game.user?.isGM) return;
    const plan = E.publishPlan(self.work, { has: uuidExists });
    if (!plan.ok) { self.render(); return warnUser(`fix ${plan.errors.length === 1 ? "the problem" : `the ${plan.errors.length} problems`} listed under the tree first.`); }
    const tree = plan.tree; const pub = await self.#published();
    const ch = changeSummary(tree, pub);
    const removedHeld = ch.removed.length ? rankHolders(tree.id, ch.removed.map(r => r.id)) : [];
    const li = (/** @type {string[]} */ l) => l.length ? `<ul>${l.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join("")}${l.length > 8 ? `<li>… ${l.length - 8} more</li>` : ""}</ul>` : "";
    const parts = [`<p>Publish <strong>${esc(tree.name)}</strong>${pub ? " over the published version" : ""}? Characters who see it get the new version at once; their granted items follow on their next change, or with Refresh granted items.</p>`];
    if (pub) parts.push(`<p>${[ch.added.length ? `${ch.added.length} added` : "", ch.changed.length ? `${ch.changed.length} changed` : "", ch.removed.length ? `${ch.removed.length} removed` : "", ch.settings ? "tree settings changed" : ""].filter(Boolean).join(", ") || "No changes"}.</p>`);
    const draft = Drafts.read().drafts[tree.id] ?? null;
    if (pub && E.publishStale({ draft, published: pub, base: self.base })) parts.push(`<p class="wp-warn">The published <strong>${esc(pub.name)}</strong> changed since ${draft ? "this draft was started" : "you opened it"} (another GM, or an edit elsewhere). Publishing replaces that version with this one.</p>`);
    if (removedHeld.length) parts.push(`<p class="wp-warn">${removedHeld.length} ${removedHeld.length === 1 ? "character has" : "characters have"} ranks in removed talents (${esc(ch.removed.map(r => r.name).join(", "))}): those become orphans until refunded (health check › Refund orphans).</p>`);
    if (plan.warnings.length) parts.push(`<p>Warnings (publishing is still allowed):</p>${li(plan.warnings.map(w => w.text))}`);
    if (!(await confirm("Publish tree", parts.join("")))) return;
    self.busy = true; self.render();
    try {
      const ok = await self.#withPack(async p => {
        const html = E.treePageHTML(tree);
        const page = { name: PAGE_NAME, type: "text", text: { content: html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 }, flags: { [ID]: { [PAGE_FLAG]: true } } };
        const entry = await self.#entryOf(p, tree.id);
        if (entry) {
          // The whole tree flag is written (Foundry merges objects; the nodes array is replaced as a whole).
          await entry.update({ name: tree.name, [`flags.${ID}.${TREE_FLAG}`]: tree });
          const old = entry.pages?.find((/** @type {any} */ pg) => pg.flags?.[ID]?.[PAGE_FLAG]);
          if (old) await old.update({ "text.content": html });
          else await entry.createEmbeddedDocuments("JournalEntryPage", [page]);
        } else {
          await JournalEntry.implementation.create({ name: tree.name, flags: { [ID]: { [TREE_FLAG]: tree } }, pages: [page] }, { pack: p.collection });
        }
      }, { create: true });
      if (!ok) return;
      await Drafts.discard(tree.id);
      invalidate();
      log(`editor: published ${tree.id} (${tree.nodes.length} talents)`);
      self.work = tree; self.dirty = false; self.base = treeHash(tree);
      ui.notifications.info(`${TITLE}: ${tree.name} published.${removedHeld.length ? " Some characters now have orphan ranks: the health check offers Refund orphans." : ""}`);
    } catch (e) { warn("editor: publish", e); warnUser(`publishing failed (${String(/** @type {any} */ (e)?.message ?? e).slice(0, 120)}).`); }
    finally { self.busy = false; self.render(); }
  }

  /** The tree's Journal Entry in the pack (by the tree flag's id), or null. @param {any} p @param {string} id */
  async #entryOf(p, id) {
    const index = await p.getIndex({ fields: [`flags.${ID}.${TREE_FLAG}`] });
    const e = [...index].find((/** @type {any} */ x) => normalizeTree(x?.flags?.[ID]?.[TREE_FLAG]).id === id);
    return e ? p.getDocument(e._id) : null;
  }

  /**
   * Runs `fn(pack)` on the tree compendium: with `create`, offers to make one when none is chosen; a locked pack is unlocked only
   * after the GM agrees, and locked again afterwards. False when nothing ran.
   * @param {(p: any) => Promise<void>} fn @param {{ create?: boolean }} [o]
   */
  async #withPack(fn, { create = false } = {}) {
    let p = pack();
    if (!p) {
      if (!create) { warnUser("no tree compendium is chosen."); return false; }
      const existing = game.packs?.get(`world.${NEW_PACK.name}`);
      if (!(await confirm("Tree compendium", existing?.documentName === "JournalEntry"
        ? `<p>No tree compendium is chosen. Use the world compendium <strong>${esc(existing.title)}</strong> for published trees?</p>`
        : `<p>No tree compendium is chosen. Create a world compendium of Journal Entries named <strong>${NEW_PACK.label}</strong> (players can read it) for published trees?</p>`))) return false;
      p = existing?.documentName === "JournalEntry" ? existing : await createTreePack();
      if (!p) { warnUser("couldn't create the compendium."); return false; }
      await S.set("treePack", p.collection);
    }
    if (p.documentName !== "JournalEntry") { warnUser(`${p.title} holds ${p.documentName} documents; trees are Journal Entries. Choose another compendium in the settings.`); return false; }
    const relock = !!p.locked;
    if (relock) {
      if (!(await confirm("Compendium locked", `<p>The tree compendium <strong>${esc(p.title)}</strong> is locked. Unlock it for this change and lock it again afterwards?</p>`))) return false;
      await p.configure({ locked: false });
    }
    try { await fn(p); return true; }
    finally { if (relock) { try { await p.configure({ locked: true }); } catch (e) { warn("editor: relock", e); warnUser("couldn't lock the compendium again."); } } }
  }

  /** Build… on a rank slot: the feature builder, writing into this working copy. @param {Event} _e @param {HTMLElement} el */
  static #onBuildSlot(_e, el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work || !self.selected) return;
    self.#build(self.selected, Number(el.dataset.slot) || 1);
  }

  /** Opens the builder on one slot of the working copy. @param {string} node @param {number} slot */
  #build(node, slot) {
    if (!F.on("builder")) return warnUser("the feature builder is turned off (Features).");
    const treeId = this.work?.id;
    openBuilder({
      tree: () => (this.work?.id === treeId ? this.work : null), node, slot,
      onSave: (/** @type {Record<string, any>} */ rawTree) => {
        if (!this.work || this.work.id !== treeId) { warnUser("the editor shows another tree now: nothing was changed."); return false; }
        this.selected = node;
        return this.#edit({ ok: true, tree: normalizeTree(rawTree) });
      }
    });
  }

  static #onClearSlot(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (self.work && self.selected) self.#edit(E.setRankSlot(self.work, self.selected, Number(el.dataset.slot), null));
  }
  static #onUnlink(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (self.work && self.selected) self.#edit(E.toggleLink(self.work, self.selected, String(el.dataset.other ?? "")));
  }
  static #onUnexclude(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (self.work && self.selected) self.#edit(E.toggleExclude(self.work, self.selected, String(el.dataset.other ?? "")));
  }
  static #onAddAssign(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) { /** @type {EditorWindow} */ (/** @type {unknown} */ (this)).#addCustom(String(el.dataset.kind ?? "")); }
  static #onRemoveAssign(/** @type {Event} */ _e, /** @type {HTMLElement} */ el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    const kind = el.dataset.kind; if (!self.work || (kind !== "classes" && kind !== "subclasses")) return;
    self.#edit(E.removeAssign(self.work, kind, String(el.dataset.ident ?? "")));
  }

  /** Foundry's file picker for the tree's or the selected talent's image. @param {Event} _e @param {HTMLElement} el */
  static #onPickImg(_e, el) {
    const self = /** @type {EditorWindow} */ (/** @type {unknown} */ (this));
    if (!self.work) return;
    const target = el.dataset.target === "node" ? "node" : "tree";
    const node = target === "node" ? self.work.nodes.find(n => n.id === self.selected) : null;
    if (target === "node" && !node) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({ type: "image", current: (node ?? self.work).img || "", callback: (/** @type {string} */ path) => {
      if (!self.work) return;
      if (node) self.#edit(E.updateNode(self.work, node.id, { img: path }));
      else self.#edit(E.setTreeFields(self.work, { img: path }));
    } }).browse();
  }

  /** Opens a tree (and optionally one talent and rank slot, which opens the builder). @param {string | null} [treeId] @param {{ node?: string, slot?: number }} [o] */
  async show(treeId, { node, slot } = {}) {
    if (treeId && treeId !== this.current && !(await this.#switchTo(treeId))) {
      // The GM kept the unsaved changes: stay on the current tree, and don't select (or build on) a talent of another tree.
      await this.render({ force: true });
      return this;
    }
    if (node) this.selected = node;
    await this.render({ force: true });
    if (node && slot && this.work?.nodes.some(n => n.id === node)) this.#build(node, slot);
    return this;
  }
}

/** Creates the world compendium for published trees (players: Observer). */
async function createTreePack() {
  try {
    const p = await CompendiumCls().createCompendium({ type: "JournalEntry", label: NEW_PACK.label, name: NEW_PACK.name, package: "world" });
    try { await p.configure({ ownership: { PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OWNER" } }); } catch (e) { warn("editor: compendium ownership", e); }
    return p;
  } catch (e) { warn("editor: create compendium", e); return null; }
}

/**
 * Opens the tree editor (GM): at a tree, optionally at one talent (and a rank slot: opens the builder there).
 * @param {string | null} [treeId] @param {{ node?: string, slot?: number }} [o]
 */
export function openEditor(treeId = null, o = {}) {
  if (!game.user?.isGM) { ui.notifications.warn(`${TITLE}: GM only.`); return null; }
  if (!F.on("editor")) { ui.notifications.warn(`${TITLE}: the tree editor is turned off (Features).`); return null; }
  app ??= new EditorWindow();
  if (!hooked) { hooked = true; onTreesChanged(() => { if (app?.rendered) app.render(); }); }
  app.show(typeof treeId === "string" && treeId ? treeId : null, o);
  return app;
}
