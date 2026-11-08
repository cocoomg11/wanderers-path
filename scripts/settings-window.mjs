/**
 * The GM's Settings window (ApplicationV2, core's RememberedWindow key "settings"): the rules (settings rows on the "rules" tab), the
 * tree compendium pick (world Journal Entry compendiums), the tree editor's button (0.6.0), the health check and Remove data (with
 * this browser's "Show the Module data folder" switch). Also the Configure Settings menu entry
 * and the Satchel's Settings button. Untested in Node: needs a live client.
 */
import { RememberedWindow } from "../vendor/wanderers-core/foundry/index.mjs";
import { UI_CLASSES, esc, tabRows, convert, statusLine, CONFIRM_WORD } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE } from "./const.mjs";
import { F, S } from "./core.mjs";
import * as Health from "./health.mjs";
import * as Cleanup from "./cleanup.mjs";
import { openEditor } from "./editor.mjs";
import { reportHTML, fixAt, fixNotice } from "./settings-model.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
/** @type {SettingsWindow | null} */
let app = null;

/** World compendiums of Journal Entries: [{ id, title }]. */
const journalPacks = () => (game.packs?.contents ?? []).filter((/** @type {any} */ p) => p.documentName === "JournalEntry" && p.metadata?.packageType === "world").map((/** @type {any} */ p) => ({ id: p.collection, title: p.title }));

export class SettingsWindow extends RememberedWindow(ApplicationV2, { moduleId: ID, key: "settings" }) {
  static DEFAULT_OPTIONS = {
    id: `${ID}-settings`, tag: "form", form: { closeOnSubmit: false },
    classes: ["wp-window", "wp-settings-window", ...UI_CLASSES],
    window: { title: `${TITLE} · Settings`, icon: "fa-solid fa-route", resizable: true },
    position: { width: 560, height: 640 },
    actions: { save: SettingsWindow.#onSave, health: SettingsWindow.#onHealth, remove: SettingsWindow.#onRemove, fix: SettingsWindow.#onFix, editor: () => { openEditor(); } }
  };
  /** @type {any[] | null} */ report = null;
  /** The key ("s:l") of the fix that is running, or null. @type {string | null} */ busy = null;
  /** The last fix's result line, shown above the report. @type {{ level: string, text: string } | null} */ fixed = null;

  async _renderHTML() {
    const div = document.createElement("div"); div.className = "wp-scroll";
    if (!game.user?.isGM) { div.textContent = "GM only."; return div; }
    const { basic } = tabRows(S.ROWS, "rules", spec => F.allOn(spec));
    const packs = journalPacks(); const cur = String(S.get("treePack") ?? "");
    const row = (/** @type {any} */ r) => {
      const v = S.get(r.key);
      if (r.key === "treePack") {
        const opts = [`<option value="">(none)</option>`, ...packs.map(p => `<option value="${esc(p.id)}"${p.id === cur ? " selected" : ""}>${esc(p.title)}</option>`)];
        if (cur && !packs.some(p => p.id === cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)} (missing)</option>`);
        return `<label class="wp-field"><span>${esc(r.label)}</span><select name="${esc(r.key)}">${opts.join("")}</select><small class="wc-hint">${esc(r.hint ?? "")}${packs.length ? "" : " Create a Journal Entry compendium in this world first."}</small></label>`;
      }
      if (r.type === "bool") return `<label class="wp-field wp-check"><input type="checkbox" name="${esc(r.key)}"${v ? " checked" : ""}><span>${esc(r.label)}</span><small class="wc-hint">${esc(r.hint ?? "")}</small></label>`;
      return `<label class="wp-field"><span>${esc(r.label)}</span><input type="number" name="${esc(r.key)}" value="${esc(String(v))}" min="${r.min ?? ""}" max="${r.max ?? ""}" step="${r.step ?? 1}"><small class="wc-hint">${esc(r.hint ?? "")}</small></label>`;
    };
    const rows = Cleanup.dryRunRows();
    div.innerHTML = `<section class="wc-panel"><div class="wc-panel-head"><h3>Rules</h3></div><div class="wc-panel-body">${basic.length ? basic.map(row).join("") : `<p class="wc-hint">Talents are turned off (Features).</p>`}
        <div class="wc-row"><button type="button" class="wc-btn wc-btn-primary" data-action="save"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button></div></div></section>
      ${F.on("editor") ? `<section class="wc-panel"><div class="wc-panel-head"><h3>Tree editor</h3></div><div class="wc-panel-body"><p class="wc-hint">Make and change talent trees: drop items and effects onto a grid, link requirements, ${F.on("builder") ? "build effects from templates (AC, speed, senses, roll bonuses, uses per rest, granted spells, …), " : ""}save drafts and publish them for players.</p>
        <div class="wc-row"><button type="button" class="wc-btn wc-btn-primary" data-action="editor"><i class="fa-solid fa-sitemap" aria-hidden="true"></i> Open the tree editor</button></div></div></section>` : ""}
      <section class="wc-panel"><div class="wc-panel-head"><h3>Health check</h3></div><div class="wc-panel-body">${this.fixed ? `<ul class="wc-lines">${statusLine(this.fixed.level, this.fixed.text)}</ul>` : ""}${reportHTML(this.report, { busy: this.busy })}
        <div class="wc-row"><button type="button" class="wc-btn" data-action="health"><i class="fa-solid fa-stethoscope" aria-hidden="true"></i> ${this.report ? "Run again" : "Run check"}</button></div></div></section>
      <section class="wc-panel"><div class="wc-panel-head"><h3>Remove Wanderer's Path data</h3></div><div class="wc-panel-body">
        ${rows.map(r => `<label class="wp-check"><input type="checkbox" name="rm-${esc(r.key)}"${r.ticked && r.count ? " checked" : ""}${Cleanup.REMOVABLE.includes(r.key) && r.count ? "" : " disabled"}> ${esc(r.text)}</label>`).join("")}
        <label class="wp-check"><input type="checkbox" data-change="moduleData"${S.get("showModuleData") === true ? " checked" : ""}> Show the Module data folder in the Journal sidebar (this browser; it holds the drafts journal)</label>
        <label class="wp-field"><span>Type ${CONFIRM_WORD} to confirm</span><input type="text" name="confirm" autocomplete="off"></label>
        <div class="wc-row"><button type="button" class="wc-btn wc-btn-danger" data-action="remove"><i class="fa-solid fa-trash" aria-hidden="true"></i> Remove</button></div></div></section>`;
    return div;
  }

  /** @param {HTMLElement} result @param {HTMLElement} content */
  _replaceHTML(result, content) { content.replaceChildren(result); }

  static async #onSave() {
    const self = /** @type {SettingsWindow} */ (/** @type {unknown} */ (this));
    const form = /** @type {HTMLFormElement} */ (self.element);
    const { basic } = tabRows(S.ROWS, "rules", spec => F.allOn(spec));
    for (const r of basic) {
      const el = /** @type {any} */ (form.elements.namedItem(r.key)); if (!el) continue;
      const v = r.key === "treePack" ? String(el.value ?? "") : convert(r, r.type === "bool" ? el.checked : el.value);
      if (v === null || v === S.get(r.key)) continue;
      await S.set(r.key, v);
    }
    ui.notifications.info(`${TITLE}: settings saved.`);
    self.render();
  }

  /** @param {any} context @param {any} options */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // This browser's "Show the Module data folder" switch (core's hideDataFolder reads it).
    this.element.addEventListener("change", (/** @type {Event} */ ev) => {
      const el = /** @type {HTMLInputElement} */ (ev.target);
      if (el?.dataset?.change === "moduleData") S.set("showModuleData", !!el.checked);
    });
  }

  static async #onHealth() {
    const self = /** @type {SettingsWindow} */ (/** @type {unknown} */ (this));
    self.fixed = null; self.report = await Health.report(); self.render();
  }

  /**
   * A line's Fix button (GM click): confirm (DialogV2), run the fix (ours wait for the GM client that applies changes, see health.mjs
   * `runAndWait`), then run the report again so the window shows the new state. @param {PointerEvent} _ev @param {HTMLElement} target
   */
  static async #onFix(_ev, target) {
    const self = /** @type {SettingsWindow} */ (/** @type {unknown} */ (this));
    if (!game.user?.isGM || self.busy) return;
    const key = String(target?.dataset?.fix ?? ""); const f = fixAt(self.report, key);
    if (!f) { ui.notifications.warn(`${TITLE}: that fix is no longer offered; run the check again.`); return; }
    if (f.confirm) {
      const ok = await DialogV2.confirm({ classes: ["wp-window", ...UI_CLASSES], window: { title: f.label }, content: `<p>${esc(f.confirm)}</p>`, rejectClose: false });
      if (!ok) return;
    }
    self.busy = key; self.render();
    try { self.fixed = fixNotice(f.label, await f.run()); }
    catch (e) { console.warn(`${ID} | fix`, e); self.fixed = { level: "warn", text: `${f.label}: failed (${String(/** @type {any} */ (e)?.message ?? e).slice(0, 120)}).` }; }
    try { self.report = await Health.report(); } catch (e) { console.warn(`${ID} | health`, e); }
    self.busy = null; self.render();
  }

  static async #onRemove() {
    const self = /** @type {SettingsWindow} */ (/** @type {unknown} */ (this));
    const form = /** @type {HTMLFormElement} */ (self.element);
    /** @type {Record<string, boolean>} */ const pick = {};
    for (const [k] of Cleanup.CATEGORIES) pick[k] = !!(/** @type {any} */ (form.elements.namedItem(`rm-${k}`))?.checked);
    const word = String(/** @type {any} */ (form.elements.namedItem("confirm"))?.value ?? "");
    const r = await Cleanup.remove(pick, word);
    if (r !== null) self.render();
  }
}

/** Opens the Settings window (GM). */
export function openSettings() {
  if (!game.user?.isGM) { ui.notifications.warn(`${TITLE}: GM only.`); return null; }
  app ??= new SettingsWindow();
  app.render({ force: true });
  return app;
}

/** The Configure Settings menu entry (init). */
export function registerMenu() {
  class Opener extends ApplicationV2 {
    async render() { openSettings(); return this; }
  }
  game.settings.registerMenu(ID, "settings", { name: TITLE, label: "Open settings", hint: "Tree compendium, points, respec, the tree editor, health check and Remove data.", icon: "fa-solid fa-route", type: Opener, restricted: true });
}
