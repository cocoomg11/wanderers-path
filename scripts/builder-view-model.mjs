/**
 * The GM's "Build a talent effect" window, pure (tested in Node: tests/builder-model.test.mjs). No Foundry calls: builder.mjs gathers
 * the published trees and the form values; this file turns them into the window's state and HTML. Everything from the world is
 * escaped with core's `esc`.
 */
import { esc } from "../vendor/wanderers-core/index.mjs";
import { TEMPLATES, templateOf, activeParams, optionsOf, normalizeSpec, previewLine, specIssues } from "./builder-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/**
 * @typedef {object} BuildState
 * @property {string} tree @property {string} node @property {number} slot 1-based @property {"item" | "effect"} mode
 * @property {string} template @property {Record<string, string>} params @property {number} base @property {number} step
 */

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
  const mode = raw.mode === "item" || raw.mode === "effect" ? raw.mode : node?.grant.mode === "item" ? "item" : "effect";
  const template = templateOf(raw.template) ? String(raw.template) : TEMPLATES[0].id;
  // Changing the template starts from its own defaults.
  const keep = raw.prevTemplate === undefined || raw.prevTemplate === template;
  const spec = /** @type {import("./builder-model.mjs").Spec} */ (normalizeSpec({ template, params: raw.params ?? {}, ...(keep ? { base: raw.base, step: raw.step } : {}) }, { fit: true }));
  return { tree: tree?.id ?? "", node: node?.id ?? "", slot, mode, template, params: spec.params, base: spec.base, step: spec.step };
}

/** The spec the state builds. @param {BuildState} s */
export const stateSpec = s => normalizeSpec({ template: s.template, params: s.params, base: s.base, step: s.step });

/**
 * The window's HTML. `data-action` on our own window's buttons (save); fields carry `name`.
 * @param {BuildState} s @param {Tree[]} trees @param {{ supported: boolean, packLocked?: boolean }} o
 */
export function builderHTML(s, trees, o) {
  if (!trees.length) return `<div class="wp-build"><p class="wc-hint">No trees are published yet. Choose the tree compendium in the settings and publish a tree first.</p></div>`;
  const tree = /** @type {Tree} */ (trees.find(t => t.id === s.tree));
  const node = tree.nodes.find(n => n.id === s.node);
  const sel = (/** @type {string} */ name, /** @type {[string, string][]} */ opts, /** @type {string} */ cur, /** @type {string} */ label) =>
    `<label class="wp-field"><span>${esc(label)}</span><select name="${esc(name)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const rows = [sel("tree", trees.map(t => [t.id, t.name]), s.tree, "Tree")];
  if (!node) rows.push(`<p class="wc-hint">This tree has no talents yet.</p>`);
  else {
    rows.push(sel("node", tree.nodes.map(n => [n.id, `${n.name}${n.maxRanks > 1 ? ` (${n.maxRanks} ranks)` : ""}`]), s.node, "Talent"));
    const replace = node.grant.perRank === "replace";
    const maxSlot = replace ? Math.min(node.maxRanks, node.grant.ranks.length + 1) : 1;
    if (replace) rows.push(sel("slot", Array.from({ length: maxSlot }, (_, i) => [String(i + 1), `Rank ${i + 1}${i < node.grant.ranks.length ? " (replaces what is there)" : " (new)"}`]), String(s.slot), "Rank slot"));
    else if (node.grant.ranks[0]) rows.push(`<p class="wc-hint">This replaces what the talent grants now (one grant that scales with its rank).</p>`);
    rows.push(sel("mode", [["effect", "An effect on the character"], ["item", "A feature item (with the effect)"]], s.mode, "Grants"));
    rows.push(sel("template", TEMPLATES.map(t => [t.id, t.label]), s.template, "What it does"));
    const t = /** @type {import("./builder-model.mjs").Template} */ (templateOf(s.template));
    rows.push(`<p class="wc-hint">${esc(t.hint)}</p>`);
    for (const d of activeParams(t, s.params)) {
      const opts = optionsOf(d, s.params); const v = s.params[d.key] ?? d.dflt;
      if (opts && !d.free) rows.push(sel(`p.${d.key}`, Object.entries(opts), v, d.label));
      else rows.push(`<label class="wp-field"><span>${esc(d.label)}</span><input type="text" name="p.${esc(d.key)}" value="${esc(v)}" maxlength="40"><small class="wc-hint">${esc(d.free ?? "")}</small></label>`);
    }
    if (t.scales) {
      rows.push(`<div class="wp-row"><label class="wp-field"><span>X at rank 1</span><input type="number" name="base" value="${s.base}" step="1"></label>
        <label class="wp-field"><span>Added per rank</span><input type="number" name="step" value="${s.step}" step="1"></label></div>`);
    }
    const spec = stateSpec(s);
    const issues = specIssues(spec, { maxRanks: node.maxRanks });
    rows.push(`<section class="wp-box wp-preview"><h3>Preview</h3><p class="${issues.length ? "wp-warn" : ""}">${esc(previewLine(spec, replace ? 1 : node.maxRanks))}</p></section>`);
    if (!o.supported) rows.push(`<p class="wp-warn">Built talents need Foundry 14 and dnd5e 6; in this world they are saved but grant nothing.</p>`);
    if (o.packLocked) rows.push(`<p class="wp-warn">The tree compendium is locked: unlock it to save.</p>`);
    rows.push(`<div class="wc-row"><button type="button" class="wc-btn wc-btn-primary" data-action="save"${issues.length || o.packLocked ? " disabled" : ""}><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save to the talent</button></div>`);
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
