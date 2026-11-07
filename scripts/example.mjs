/**
 * The example tool (feature "example"): a small GM window to read and add notes, stored in the hidden world setting "exampleNotes".
 * Delete this file, example-model.mjs, its test and its feature entry when you build the real module, or reshape it into your first
 * tool. It shows the one-writer pattern: every client (a GM tab, a player) asks the leader to add a note, and only the leader writes.
 */
import { UI_CLASSES } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE, esc } from "./const.mjs";
import { S, leader, log } from "./core.mjs";
import * as M from "./example-model.mjs";

export const notes = () => M.normalizeNotes(S.get("exampleNotes"));

/**
 * The leader's handler for the "exampleNote" request. Check the sender's rights here (Foundry gives us the user), never a payload field.
 * @param {{ text: string }} data
 * @param {any} user
 */
export async function handleNote(data, user) {
  if (!user?.active) return;
  const next = M.addNote(S.get("exampleNotes"), data.text);
  if (!next.added) return;
  await S.set("exampleNotes", { v: next.v, notes: next.notes });
  log("note added by", user.name, next.notes.length);
}

/**
 * Asks the leader to add a note (works from any client). Returns false when no GM is connected or the text is empty.
 * @param {string} text
 */
export function add(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return leader.request("exampleNote", { text: t });
}

export class ExampleApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: `${ID}-example`, classes: ["tpl-window", ...UI_CLASSES], window: { title: `${TITLE} · Example`, icon: "fa-solid fa-note-sticky", resizable: true }, position: { width: 420, height: 360 } };
  async _renderHTML() {
    const div = document.createElement("div"); div.className = "tpl-scroll";
    if (!game.user.isGM) { div.textContent = "GM only."; return div; }
    const list = notes().notes;
    div.innerHTML = `<p class="wc-hint">${esc(M.summary(list))}</p>
      <ul>${list.map(n => `<li>${esc(n.text)}</li>`).join("")}</ul>
      <form class="tpl-footer"><input type="text" name="text" placeholder="A note" autocomplete="off"><button type="submit" class="wc-btn wc-btn-primary"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add</button></form>`;
    return div;
  }
  /**
   * @param {HTMLElement} result
   * @param {HTMLElement} content
   */
  _replaceHTML(result, content) {
    content.replaceChildren(result);
    const form = content.querySelector("form");
    form?.addEventListener("submit", ev => {
      ev.preventDefault();
      const input = /** @type {HTMLInputElement | null} */ (form.elements.namedItem("text"));
      if (add(input?.value ?? "")) setTimeout(() => this.render(), 400);
      else ui.notifications.warn(`${TITLE}: nothing added (empty text, or no GM connected).`);
    });
  }
}

export function open() { return new ExampleApp().render({ force: true }); }
