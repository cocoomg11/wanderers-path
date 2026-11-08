/**
 * The GM's "Build a talent effect" window, pure (tested in Node: tests/builder-model.test.mjs). No Foundry calls: builder.mjs gathers
 * the published trees and the form values; this file turns them into the window's state and HTML. Everything from the world is
 * escaped with core's `esc`.
 */
import { esc } from "../vendor/wanderers-core/index.mjs";
import { TEMPLATES, templateOf, activeParams, optionsOf, normalizeSpec, previewLine, specIssues, scalesFor, ITEM_UUID_RE } from "./builder-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/**
 * @typedef {object} BuildState
 * @property {string} tree @property {string} node @property {number} slot 1-based @property {"item" | "effect"} mode
 * @property {string} template @property {Record<string, string>} params @property {number} base @property {number} step
 */

/**
 * What the window knows about the chosen spell (builder.mjs looks it up in a compendium index or the world's items, never with
 * fromUuid): `ok` = an Item of type "spell".
 * @typedef {{ uuid: string, ok: boolean, name: string, error: string }} SpellInfo
 */

/**
 * Where an Item UUID points: `{ pack, id }` for a compendium item, `{ pack: null, id }` for a world item, null otherwise.
 * @param {unknown} uuid @returns {{ pack: string | null, id: string } | null}
 */
export function parseItemUuid(uuid) {
  const u = typeof uuid === "string" ? uuid.trim() : "";
  if (!ITEM_UUID_RE.test(u)) return null;
  const p = u.split(".");
  return p[0] === "Compendium" ? { pack: `${p[1]}.${p[2]}`, id: p[4] } : { pack: null, id: p[1] };
}

/**
 * The spell picker's verdict on an index entry (or world item) found for a UUID: { ok, name, error }.
 * @param {string} uuid @param {{ name?: string, type?: string } | null | undefined} entry
 * @returns {SpellInfo}
 */
export function spellInfo(uuid, entry) {
  if (!uuid) return { uuid, ok: false, name: "", error: "Drop a spell here or paste its UUID." };
  if (!parseItemUuid(uuid)) return { uuid, ok: false, name: "", error: "That isn't an item UUID." };
  if (!entry) return { uuid, ok: false, name: "", error: "No item has that UUID (or its compendium isn't in this world)." };
  if (entry.type !== "spell") return { uuid, ok: false, name: String(entry.name ?? ""), error: `${entry.name ?? "That item"} isn't a spell.` };
  return { uuid, ok: true, name: String(entry.name ?? ""), error: "" };
}

/** @param {unknown} v @param {number} d */
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : d; };

/**
 * The window's state made consistent with the trees: a tree and node that exist (else the first), a slot the node takes, the
 * template's parameters filled. `raw` is what the form holds (strings), merged over the previous state.
 * @param {Partial<BuildState> & Record<string, any>} raw @param {Tree[]} trees @returns {BuildState}
 */
export function buildState(raw, trees) {
  const tree = trees.find(t => t.id === raw.tree) ?? trees[0];
  const node = tree?.nodes.find(n => n.id === raw.node) ?? tree?.nodes[0];
  const replace = node?.grant.perRank === "replace";
  const maxSlot = replace ? Math.min(node.maxRanks, node.grant.ranks.length + 1) : 1;
  const slot = Math.min(maxSlot, Math.max(1, num(raw.slot, 1)));
  const template = templateOf(raw.template) ? String(raw.template) : TEMPLATES[0].id;
  // Item-only templates (uses, spell, described) always make a feature item.
  const mode = templateOf(template)?.itemOnly ? "item" : raw.mode === "item" || raw.mode === "effect" ? raw.mode : node?.grant.mode === "item" ? "item" : "effect";
  // Changing the template starts from its own defaults.
  const keep = raw.prevTemplate === undefined || raw.prevTemplate === template;
  const spec = /** @type {import("./builder-model.mjs").Spec} */ (normalizeSpec({ template, params: raw.params ?? {}, ...(keep ? { base: raw.base, step: raw.step } : {}) }, { fit: true }));
  return { tree: tree?.id ?? "", node: node?.id ?? "", slot, mode, template, params: spec.params, base: spec.base, step: spec.step };
}

/** The spec the state builds. @param {BuildState} s */
export const stateSpec = s => normalizeSpec({ template: s.template, params: s.params, base: s.base, step: s.step });

/**
 * The window's HTML. `data-action` on our own window's buttons (save); fields carry `name`.
 * `spell` is the spell picker's lookup of the "spell" parameter (Grant a spell); without it the spell counts as unchecked.
 * `fixed` (0.6.0, the tree editor's Build…): the tree, talent and rank slot are given, so they are shown, not chosen, and Save hands
 * the result back to the editor.
 * @param {BuildState} s @param {Tree[]} trees @param {{ supported: boolean, packLocked?: boolean, fixed?: boolean, spell?: SpellInfo | null }} o
 */
export function builderHTML(s, trees, o) {
  if (!trees.length) return `<div class="wp-build"><p class="wc-hint">${o.fixed ? "Open the tree editor and click Build… on a talent's rank slot." : "No trees are published yet. Choose the tree compendium in the settings and publish a tree first."}</p></div>`;
  const tree = /** @type {Tree} */ (trees.find(t => t.id === s.tree));
  const node = tree.nodes.find(n => n.id === s.node);
  const sel = (/** @type {string} */ name, /** @type {[string, string][]} */ opts, /** @type {string} */ cur, /** @type {string} */ label) =>
    `<label class="wp-field"><span>${esc(label)}</span><select name="${esc(name)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const rows = o.fixed ? [] : [sel("tree", trees.map(t => [t.id, t.name]), s.tree, "Tree")];
  if (!node) rows.push(`<p class="wc-hint">This tree has no talents yet.</p>`);
  else {
    const replace = node.grant.perRank === "replace";
    const maxSlot = replace ? Math.min(node.maxRanks, node.grant.ranks.length + 1) : 1;
    if (o.fixed) rows.push(`<h3 class="wp-build-for">${esc(tree.name)} › ${esc(node.name)}${replace ? ` · rank ${s.slot}` : node.maxRanks > 1 ? ` · all ${node.maxRanks} ranks` : ""}</h3>${node.grant.ranks[s.slot - 1] ? `<p class="wc-hint">This replaces what the slot holds now.</p>` : ""}`);
    else rows.push(sel("node", tree.nodes.map(n => [n.id, `${n.name}${n.maxRanks > 1 ? ` (${n.maxRanks} ranks)` : ""}`]), s.node, "Talent"));
    if (o.fixed) { /* the slot is given */ }
    else if (replace) rows.push(sel("slot", Array.from({ length: maxSlot }, (_, i) => [String(i + 1), `Rank ${i + 1}${i < node.grant.ranks.length ? " (replaces what is there)" : " (new)"}`]), String(s.slot), "Rank slot"));
    else if (node.grant.ranks[0]) rows.push(`<p class="wc-hint">This replaces what the talent grants now (one grant that scales with its rank).</p>`);
    const t = /** @type {import("./builder-model.mjs").Template} */ (templateOf(s.template));
    rows.push(sel("template", TEMPLATES.map(x => [x.id, `${x.label}${x.itemOnly ? " (feature item)" : ""}`]), s.template, "What it does"));
    if (t.itemOnly) rows.push(`<input type="hidden" name="mode" value="item"><p class="wc-hint">Grants a feature item on the character.</p>`);
    else rows.push(sel("mode", [["effect", "An effect on the character"], ["item", "A feature item (with the effect)"]], s.mode, "Grants"));
    rows.push(`<p class="wc-hint">${esc(t.hint)}</p>`);
    for (const d of activeParams(t, s.params)) {
      const opts = optionsOf(d, s.params); const v = s.params[d.key] ?? d.dflt;
      if (opts && !d.free) { rows.push(sel(`p.${d.key}`, Object.entries(opts), v, d.label)); continue; }
      const input = `<input type="text" name="p.${esc(d.key)}" value="${esc(v)}" maxlength="${d.max ?? 40}"${d.ui === "spell" ? ` placeholder="Compendium.….Item.…"` : ""}>`;
      if (d.ui === "spell") {
        const sp = o.spell && o.spell.uuid === v ? o.spell : null;
        const state = sp ? (sp.ok ? `<span class="wp-ok"><i class="fa-solid fa-check" aria-hidden="true"></i> ${esc(sp.name)}</span>` : `<span class="wp-warn">${esc(sp.error)}</span>`) : `<span class="wc-hint">Drop a spell here or paste its UUID.</span>`;
        rows.push(`<div class="wp-field wp-drop" data-wp-drop="spell"><span>${esc(d.label)}</span>${input}<small>${state}</small></div>`);
        continue;
      }
      rows.push(`<label class="wp-field"><span>${esc(d.label)}</span>${input}<small class="wc-hint">${esc(d.free ?? d.bad ?? "")}</small></label>`);
    }
    if (t.describe) rows.push(`<p class="wc-hint">The item's description is the talent's own text${node.text ? "" : " (this talent has none yet)"}. Nothing runs an automation key in this version; other modules can register one (<code>api.registerAutomation</code>).</p>`);
    if (scalesFor(t, s.params)) {
      rows.push(`<div class="wp-row"><label class="wp-field"><span>X at rank 1</span><input type="number" name="base" value="${s.base}" step="1"></label>
        <label class="wp-field"><span>Added per rank</span><input type="number" name="step" value="${s.step}" step="1"></label></div>`);
    }
    const spec = stateSpec(s);
    const issues = specIssues(spec, { maxRanks: node.maxRanks });
    const spellParam = activeParams(t, s.params).find(d => d.ui === "spell");
    if (spellParam && !issues.length) { const sp = o.spell && o.spell.uuid === s.params[spellParam.key] ? o.spell : null; if (!sp?.ok) issues.push(sp?.error || "Checking the spell…"); }
    rows.push(`<section class="wp-box wp-preview"><h3>Preview</h3><p class="${issues.length ? "wp-warn" : ""}">${esc(previewLine(spec, replace ? 1 : node.maxRanks))}</p></section>`);
    if (!o.supported) rows.push(`<p class="wp-warn">Built talents need Foundry 14 and dnd5e 6; in this world they are saved but grant nothing.</p>`);
    if (o.packLocked) rows.push(`<p class="wp-warn">The tree compendium is locked: unlock it to save.</p>`);
    rows.push(`<div class="wc-row"><button type="button" class="wc-btn wc-btn-primary" data-action="save"${issues.length || o.packLocked ? " disabled" : ""}><i class="fa-solid fa-${o.fixed ? "check" : "floppy-disk"}" aria-hidden="true"></i> ${o.fixed ? "Use for this rank" : "Save to the talent"}</button></div>`);
  }
  return `<div class="wp-build">${rows.join("")}</div>`;
}

/**
 * Form values (name → string) read into a partial state: `p.<key>` fields become params.
 * @param {Record<string, string>} values @returns {Record<string, any>}
 */
export function readForm(values) {
  /** @type {Record<string, any>} */ const out = { params: {} };
  for (const [k, v] of Object.entries(values ?? {})) {
    if (k.startsWith("p.")) out.params[k.slice(2)] = String(v);
    else if (["tree", "node", "slot", "mode", "template", "base", "step"].includes(k)) out[k] = String(v);
  }
  return out;
}
