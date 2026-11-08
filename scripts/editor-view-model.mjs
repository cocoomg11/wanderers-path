/**
 * The GM tree editor's markup, pure (tested in Node: tests/v060.test.mjs). No Foundry calls: editor.mjs gathers plain facts, this
 * file turns them into HTML. Every value from the world is escaped with core's `esc`; names in tooltips go through
 * `data-tooltip-text` (plain text), never `data-tooltip`.
 *
 * Three columns: the tree list and the document browser (left), the tiered canvas with its toolbar and issues (middle), and the
 * inspector (right: the selected talent, or the tree's settings when none is selected). Clicks are `data-action` buttons handled by
 * the window; fields carry `name="tree.<field>"` / `name="node.<field>"` and are read on change.
 */
import { esc, statusLine } from "../vendor/wanderers-core/index.mjs";
import { GRID, nodePos, arrowPath } from "./view-model.mjs";
import { MAX_RANKS, MAX_COST, MAX_LEVEL } from "./tree-model.mjs";
import { MAX_COLUMNS, MAX_TIERS, MAX_TIER_SIZE, slotLabel, requires } from "./editor-model.mjs";

/** @typedef {import("./tree-model.mjs").Tree} Tree */
/** @typedef {import("./tree-model.mjs").TalentNode} TalentNode */
/**
 * @typedef {object} EditorFacts
 * @property {{ id: string, name: string, state: string, label: string, stale: boolean, published: boolean, draft: boolean }[]} list
 * @property {Tree | null} tree the working copy
 * @property {{ state: string, label: string, stale: boolean, tip?: string } | null} status
 * @property {boolean} dirty unsaved edits
 * @property {boolean} canUndo
 * @property {string | null} selected
 * @property {boolean} linkMode
 * @property {{ uuid: string, name: string, img: string, type: string, documentName: string, from: string }[]} sources
 * @property {string} search
 * @property {Record<string, { name: string, img?: string }>} labels names of linked documents
 * @property {{ classes: { id: string, name: string }[], subclasses: { id: string, name: string }[] }} classes
 * @property {{ errors: { node?: string, text: string }[], warnings: { node?: string, text: string }[] } | null} plan
 * @property {boolean} builder the feature builder is on
 * @property {string} packName the tree compendium's title ("" = none chosen)
 * @property {boolean} packLocked
 * @property {boolean} busy
 */

/** @param {string} icon */
const ic = icon => `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
/** @param {string} action @param {string} label @param {{ icon?: string, primary?: boolean, danger?: boolean, disabled?: boolean, data?: Record<string, string>, pressed?: boolean, tip?: string, small?: boolean }} [o] */
function btn(action, label, o = {}) {
  const cls = ["wc-btn", o.small ? "wc-btn-sm" : "", o.primary ? "wc-btn-primary" : "", o.danger ? "wc-btn-danger" : ""].filter(Boolean).join(" ");
  const data = Object.entries(o.data ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
  return `<button type="button" class="${cls}" data-action="${esc(action)}"${data}${o.pressed !== undefined ? ` aria-pressed="${o.pressed}"` : ""}${o.tip ? ` data-tooltip-text="${esc(o.tip)}"` : ""}${o.disabled ? " disabled" : ""}>${o.icon ? `${ic(o.icon)} ` : ""}${esc(label)}</button>`;
}
/** @param {string} name @param {string} label @param {[string, string][]} opts @param {string} cur @param {{ disabled?: boolean }} [o] */
const select = (name, label, opts, cur, o = {}) => `<label class="wp-field"><span>${esc(label)}</span><select name="${esc(name)}"${o.disabled ? " disabled" : ""}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
/** @param {string} name @param {string} label @param {number | string} value @param {number} min @param {number} max @param {string} [hint] */
const number = (name, label, value, min, max, hint = "") => `<label class="wp-field"><span>${esc(label)}</span><input type="number" name="${esc(name)}" value="${esc(String(value))}" min="${min}" max="${max}" step="1">${hint ? `<small class="wc-hint">${esc(hint)}</small>` : ""}</label>`;
/** @param {string} name @param {string} label @param {string} value @param {{ max?: number, hint?: string, placeholder?: string }} [o] */
const textIn = (name, label, value, o = {}) => `<label class="wp-field"><span>${esc(label)}</span><input type="text" name="${esc(name)}" value="${esc(value)}" maxlength="${o.max ?? 120}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ""}>${o.hint ? `<small class="wc-hint">${esc(o.hint)}</small>` : ""}</label>`;
/** @param {string} img @param {string} fallback */
const pic = (img, fallback) => (img ? `<img src="${esc(img)}" alt="">` : ic(fallback));

/** The state badge of a tree row. @param {string} state */
const TONE = /** @type {Record<string, string>} */ ({ published: "wc-ok", same: "wc-ok", new: "wc-warn", differs: "wc-warn", unsaved: "wc-bad" });

/** Left column: trees and the document browser. @param {EditorFacts} f */
function leftHTML(f) {
  const cur = f.tree?.id ?? "";
  const rows = f.list.length ? f.list.map(t => `<li><button type="button" class="wp-ed-tree${t.id === cur ? " wp-on" : ""}" data-action="pickTree" data-tree="${esc(t.id)}" aria-pressed="${t.id === cur}">
      <span>${esc(t.name)}</span><small class="wc-badge ${TONE[t.state] ?? ""}">${esc(t.state === "published" ? "Published" : t.state === "new" ? "Draft" : t.state === "same" ? "Draft (same)" : "Draft (changed)")}</small></button></li>`).join("")
    : `<li class="wc-hint">No trees yet: make one with New tree.</li>`;
  const docs = sourcesHTML(f);
  return `<aside class="wp-ed-left">
    <section class="wp-box"><h3>Trees</h3><ul class="wp-ed-trees">${rows}</ul>
      <div class="wp-ed-btns">${btn("newTree", "New tree…", { icon: "fa-plus", small: true })}${btn("duplicateTree", "Duplicate", { icon: "fa-clone", small: true, disabled: !f.tree })}${btn("deleteTree", "Delete", { icon: "fa-trash", small: true, danger: true, disabled: !f.tree })}</div></section>
    <section class="wp-box wp-ed-src"><h3>Add talents</h3>
      <input type="search" name="search" value="${esc(f.search)}" placeholder="Search items…" aria-label="Search items" autocomplete="off">
      <ul class="wp-ed-docs">${docs}</ul>
      <p class="wc-hint">Drag an item onto an empty spot to make a talent from it. You can also drop items and active effects straight from Foundry's sidebar or any compendium window.</p></section>
  </aside>`;
}

/** The tiered canvas. @param {EditorFacts} f @param {Tree} tree */
function canvasHTML(f, tree) {
  if (tree.layout === "board") return `<div class="wp-empty"><i class="fa-solid fa-diagram-project" aria-hidden="true"></i><p>Board editing comes later.</p><p class="wc-hint">This tree uses the free-form board layout. Its settings can be changed here; switch the layout to Tiered to edit its talents on a grid.</p></div>`;
  const cols = tree.tiered.columns, tiers = tree.tiered.tiers;
  const w = GRID.ox + cols * GRID.cw, h = GRID.oy + tiers * GRID.rh;
  const byId = new Map(tree.nodes.map(n => [n.id, n]));
  const sel = f.selected ? byId.get(f.selected) ?? null : null;
  const reqs = new Set(sel?.prereqs.map(p => p.node) ?? []); const exs = new Set(sel?.excludes ?? []);
  const labels = Array.from({ length: tiers }, (_, t) => `<span class="wp-tier wp-open" style="top:${GRID.oy + t * GRID.rh + 18}px">${t * tree.tiered.tierSize} pts</span>`).join("");
  const arrows = tree.nodes.flatMap(n => n.prereqs.map(p => { const a = byId.get(p.node); return a ? `<path d="${arrowPath(a, n)}"${sel && (sel.id === n.id || sel.id === a.id) ? ` class="wp-met"` : ""} marker-end="url(#wp-ed-ah)"/>` : ""; })).join("");
  const svg = `<svg class="wp-links" width="${w}" height="${h}" aria-hidden="true"><defs><marker id="wp-ed-ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>${arrows}</svg>`;
  /** @type {string[]} */ const cells = [];
  for (let t = 0; t < tiers; t++) for (let c = 0; c < cols; c++) {
    const n = tree.nodes.find(x => x.tier === t && x.col === c);
    const x = GRID.ox + c * GRID.cw, y = GRID.oy + t * GRID.rh;
    if (!n) { cells.push(`<button type="button" class="wp-ed-slot" style="left:${x}px;top:${y}px" data-action="addNode" data-cell="${t}:${c}" aria-label="Empty spot, tier ${t + 1}, column ${c + 1}: add a talent" data-tooltip-text="Empty spot: click to add a blank talent, or drop an item or effect here">${ic("fa-plus")}</button>`); continue; }
    const p = nodePos(n);
    const cls = ["wp-node", "wp-ed-node", n.keystone ? "wp-key" : "", n.id === f.selected ? "wp-sel" : "", reqs.has(n.id) ? "wp-req" : "", exs.has(n.id) ? "wp-ex" : "", f.plan?.errors.some(e => e.node === n.id) ? "wp-bad" : ""].filter(Boolean).join(" ");
    const tip = `${n.name} · ${n.maxRanks} ${n.maxRanks === 1 ? "rank" : "ranks"}${f.linkMode && sel && sel.id !== n.id ? (reqs.has(n.id) ? " · click: no longer required" : " · click: make it required") : ""}`;
    cells.push(`<button type="button" class="${cls}" style="left:${p.x}px;top:${p.y}px" draggable="true" data-action="selectNode" data-node="${esc(n.id)}" data-cell="${t}:${c}" aria-pressed="${n.id === f.selected}" aria-label="${esc(`${n.name}, tier ${t + 1}, column ${c + 1}`)}" data-tooltip-text="${esc(tip)}">${pic(n.img, n.keystone ? "fa-star" : "fa-circle-dot")}<span class="wp-rk">${n.maxRanks}</span></button>`);
  }
  return `<div class="wp-scroll-x"><div class="wp-grid wp-ed-grid" style="width:${w}px;height:${h}px">${labels}${svg}${cells.join("")}</div></div>`;
}

/** The issues under the canvas. @param {EditorFacts} f */
function issuesHTML(f) {
  if (!f.plan) return "";
  const { errors, warnings } = f.plan;
  if (!errors.length && !warnings.length) return `<ul class="wc-lines wp-ed-issues">${statusLine("ok", "No problems found: ready to publish.")}</ul>`;
  return `<ul class="wc-lines wp-ed-issues">${errors.map(e => statusLine("bad", e.text)).join("")}${warnings.map(w => statusLine("warn", w.text)).join("")}</ul>`;
}

/** Middle column. @param {EditorFacts} f */
function mainHTML(f) {
  if (!f.tree) return `<main class="wp-ed-main"><div class="wp-empty">${ic("fa-route")}<p>Choose a tree on the left, or make a new one.</p><p class="wc-hint">${f.packName ? `Published trees go to ${esc(f.packName)}.` : "No tree compendium is chosen yet: Publish offers to make one."}</p></div></main>`;
  const t = f.tree; const tiered = t.layout === "tiered";
  const status = f.dirty ? { label: "Unsaved changes", tone: TONE.unsaved, tip: "" } : { label: f.status?.label ?? "", tone: TONE[f.status?.state ?? ""] ?? "", tip: f.status?.tip ?? "" };
  const canPublish = !f.busy && !!f.plan && !f.plan.errors.length;
  const bar = `<div class="wp-ed-bar">
      <span class="wp-ed-title">${pic(t.img, "fa-route")}<b>${esc(t.name)}</b><small class="wc-badge ${status.tone}" data-tooltip-text="${esc(status.tip || status.label)}">${esc(status.label)}</small></span>
      <span class="wp-ed-btns">
        ${tiered ? btn("addTier", "Tier", { icon: "fa-plus", small: true, tip: "Add a tier at the bottom" }) + btn("removeTier", "Tier", { icon: "fa-minus", small: true, tip: "Remove the last tier (it must be empty)", disabled: t.tiered.tiers <= 1 }) : ""}
        ${tiered ? btn("linkMode", "Link mode", { icon: "fa-link", small: true, pressed: f.linkMode, tip: "Select a talent, then click the talents it requires (click again to unlink)" }) : ""}
        ${btn("undo", "Undo", { icon: "fa-rotate-left", small: true, disabled: !f.canUndo, tip: "Undo the last change (Ctrl+Z)" })}
      </span></div>`;
  const hint = f.linkMode ? `<p class="wp-ed-hint">${ic("fa-link")} ${f.selected ? "Link mode: click the talents the selected one requires. Click a linked one again to unlink it." : "Link mode: select a talent first, then click the talents it requires."}</p>` : "";
  const stale = f.status?.stale ? `<p class="wp-warn">${ic("fa-triangle-exclamation")} The published tree changed since this draft was started; publishing replaces it with the draft.</p>` : "";
  const foot = `<footer class="wp-ed-foot">
      <span class="wc-hint">${f.packName ? `Publishes to ${esc(f.packName)}${f.packLocked ? " (locked: you'll be asked to unlock it)" : ""}.` : "No tree compendium yet: Publish offers to make one."}</span>
      <span class="wp-ed-btns">
        ${btn("discardDraft", "Discard draft", { icon: "fa-xmark", disabled: f.busy || (!f.dirty && !(f.status && f.status.state !== "published")), tip: "Drop the saved draft and unsaved changes (back to the published tree)" })}
        ${btn("saveDraft", "Save draft", { icon: "fa-floppy-disk", disabled: f.busy || !f.dirty })}
        ${btn("publish", f.busy ? "Working…" : "Publish", { icon: "fa-upload", primary: true, disabled: !canPublish, tip: canPublish ? "Players see the tree after it is published" : "Fix the problems listed first" })}
      </span></footer>`;
  return `<main class="wp-ed-main">${bar}${hint}${stale}<div class="wp-ed-canvas">${canvasHTML(f, t)}</div>${issuesHTML(f)}${foot}</main>`;
}

/** Chips of a tree's assignment, an add select and a custom box. @param {EditorFacts} f @param {"classes" | "subclasses"} kind */
function assignHTML(f, kind) {
  const t = /** @type {Tree} */ (f.tree);
  const label = kind === "classes" ? "Classes" : "Subclasses";
  const names = new Map(f.classes[kind].map(c => [c.id, c.name]));
  const chips = t.assign[kind].map(id => `<span class="wp-chip">${esc(names.get(id) ?? id)} <small>${esc(id)}</small><button type="button" class="wp-chip-x" data-action="removeAssign" data-kind="${kind}" data-ident="${esc(id)}" aria-label="${esc(`Remove ${id}`)}">${ic("fa-xmark")}</button></span>`).join("") || `<span class="wc-hint">None</span>`;
  const opts = f.classes[kind].filter(c => !t.assign[kind].includes(c.id));
  return `<div class="wp-field"><span>${label}</span><div class="wp-chips">${chips}</div>
    ${opts.length ? `<select name="assign.${kind}" aria-label="${esc(`Add a ${kind === "classes" ? "class" : "subclass"}`)}"><option value="">Add from your ${kind}…</option>${opts.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.id)})</option>`).join("")}</select>` : ""}
    <div class="wp-ed-add"><input type="text" name="custom.${kind}" placeholder="or type an identifier" maxlength="64" aria-label="${esc(`${label}: type an identifier`)}">${btn("addAssign", "Add", { small: true, data: { kind } })}</div></div>`;
}

/** The tree's settings (inspector with no talent selected). @param {EditorFacts} f */
function treeSettingsHTML(f) {
  const t = /** @type {Tree} */ (f.tree);
  return `<h3>Tree settings</h3>
    ${textIn("tree.name", "Name", t.name)}
    <div class="wp-field"><span>Image</span><div class="wp-ed-add"><input type="text" name="tree.img" value="${esc(t.img)}" maxlength="500" placeholder="icons/…" aria-label="Image path">${btn("pickImg", "", { icon: "fa-file-image", small: true, data: { target: "tree" }, tip: "Browse images" })}</div></div>
    <p class="wc-hint">Id: <code>${esc(t.id)}</code> (characters' picks are stored under it, so it never changes).</p>
    ${select("tree.layout", "Layout", [["tiered", "Tiered (rows that open with points)"], ["board", "Board (free-form, edited in a later version)"]], t.layout)}
    ${t.layout === "tiered" ? `<div class="wp-ed-row">${number("tree.columns", "Columns", t.tiered.columns, 1, MAX_COLUMNS)}${number("tree.tiers", "Tiers", t.tiered.tiers, 1, MAX_TIERS)}</div>
      ${number("tree.tierSize", "Points per tier", t.tiered.tierSize, 1, MAX_TIER_SIZE, "Points spent in this tree that open each next tier.")}` : ""}
    ${number("tree.unlockLevel", "Opens at level", t.unlockLevel ?? 0, 0, MAX_LEVEL, "0 = the world's Talents open at level.")}
    <label class="wp-check"><input type="checkbox" name="tree.enabled"${t.enabled ? " checked" : ""}><span>Offered to characters</span><small class="wc-hint">Off: no one gets the tree; characters who learned talents in it keep them, locked.</small></label>
    <h4>Who gets it</h4>
    ${assignHTML(f, "classes")}${assignHTML(f, "subclasses")}
    <p class="wc-hint">A character with any of these identifiers sees the tree. A GM can also add it to a character by hand (talent window, GM box).</p>
    <p class="wc-hint">Select a talent on the grid to edit it.</p>`;
}

/** The selected talent. @param {EditorFacts} f @param {TalentNode} n */
function nodeHTML(f, n) {
  const t = /** @type {Tree} */ (f.tree);
  const byId = new Map(t.nodes.map(x => [x.id, x]));
  const replace = n.grant.perRank === "replace";
  const slots = replace ? Math.min(n.maxRanks, n.grant.ranks.length + 1) : 1;
  const noneHint = n.grant.mode === "none" ? `<p class="wc-hint">Grants nothing: a talent that only opens others, or one you handle by hand. Drop an item or effect on the slot below to make it grant one.</p>` : "";
  const rankRows = Array.from({ length: slots }, (_, i) => {
    const r = n.grant.ranks[i]; const k = String(i + 1);
    const label = r ? slotLabel(r, replace ? 1 : n.maxRanks, f.labels) : "";
    return `<li class="wp-ed-rank" data-wp-slot="${k}"><span class="wp-ed-rk">${replace ? `Rank ${k}` : n.maxRanks > 1 ? "All ranks" : "Grant"}</span>
      <span class="wp-ed-rv${r ? "" : " wc-hint"}"${r && "uuid" in r ? ` data-tooltip-text="${esc(r.uuid)}"` : ""}>${esc(label || "Drop an item or effect here")}</span>
      <span class="wp-ed-btns">${f.builder ? btn("buildSlot", "Build…", { small: true, data: { slot: k }, tip: "Build an effect or feature from a template" }) : ""}${r ? btn("clearSlot", "", { icon: "fa-xmark", small: true, data: { slot: k }, tip: "Empty this slot" }) : ""}</span></li>`;
  }).join("");
  const reqs = n.prereqs.map(p => { const o = byId.get(p.node); return `<span class="wp-chip">${esc(o?.name ?? p.node)} <input type="number" name="req.${esc(p.node)}" value="${p.ranks}" min="1" max="${o?.maxRanks ?? MAX_RANKS}" step="1" aria-label="${esc(`Ranks of ${o?.name ?? p.node} needed`)}"><small>/${o?.maxRanks ?? ""}</small><button type="button" class="wp-chip-x" data-action="unlink" data-other="${esc(p.node)}" aria-label="${esc(`No longer requires ${o?.name ?? p.node}`)}">${ic("fa-xmark")}</button></span>`; }).join("") || `<span class="wc-hint">None</span>`;
  const reqOpts = t.nodes.filter(o => o.id !== n.id && !n.prereqs.some(p => p.node === o.id) && !requires(t, o.id, n.id));
  const exs = n.excludes.map(x => `<span class="wp-chip">${esc(byId.get(x)?.name ?? x)}<button type="button" class="wp-chip-x" data-action="unexclude" data-other="${esc(x)}" aria-label="${esc(`Allow with ${byId.get(x)?.name ?? x}`)}">${ic("fa-xmark")}</button></span>`).join("") || `<span class="wc-hint">None</span>`;
  const exOpts = t.nodes.filter(o => o.id !== n.id && !n.excludes.includes(o.id) && !requires(t, o.id, n.id) && !requires(t, n.id, o.id));
  const opt = (/** @type {TalentNode[]} */ list, /** @type {string} */ first) => `<option value="">${esc(first)}</option>${list.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}`;
  return `<div class="wp-ed-ihead"><h3>Talent</h3>${btn("deselect", "Tree settings", { small: true, icon: "fa-sliders" })}</div>
    ${textIn("node.name", "Name", n.name)}
    <div class="wp-field"><span>Image</span><div class="wp-ed-add"><input type="text" name="node.img" value="${esc(n.img)}" maxlength="500" placeholder="icons/…" aria-label="Image path">${btn("pickImg", "", { icon: "fa-file-image", small: true, data: { target: "node" }, tip: "Browse images" })}</div></div>
    <label class="wp-field"><span>Text (tooltip, and the granted item's description when built)</span><textarea name="node.text" rows="3" maxlength="4000">${esc(n.text)}</textarea></label>
    <div class="wp-ed-row">${number("node.maxRanks", "Max ranks", n.maxRanks, 1, MAX_RANKS)}${number("node.cost", "Points a rank", n.cost, 1, MAX_COST)}</div>
    ${t.layout === "tiered" ? `<div class="wp-ed-row">${number("node.tier", "Tier", n.tier + 1, 1, t.tiered.tiers)}${number("node.col", "Column", n.col + 1, 1, t.tiered.columns)}</div>` : ""}
    <label class="wp-check"><input type="checkbox" name="node.keystone"${n.keystone ? " checked" : ""}><span>Keystone (drawn round)</span></label>
    <h4>What it grants</h4>
    <div class="wp-ed-row">${select("node.mode", "Grants", [["item", "An item (copied to the character)"], ["effect", "An effect on the character"], ["none", "Nothing"]], n.grant.mode)}
      ${n.grant.mode === "none" ? "" : select("node.perRank", "Ranks", [["scale", "One grant for every rank"], ["replace", "A different one per rank"]], n.grant.perRank, { disabled: n.maxRanks < 2 })}</div>
    ${noneHint}<ul class="wp-ed-ranks">${rankRows}</ul>
    ${n.automation ? `<p class="wc-hint">Automation key: <code>${esc(n.automation.key)}</code> (set by the builder).</p>` : ""}
    <h4>Requirements</h4>
    <div class="wp-field"><span>Requires</span><div class="wp-chips">${reqs}</div>${reqOpts.length ? `<select name="addReq" aria-label="Add a required talent">${opt(reqOpts, "Add a required talent…")}</select>` : ""}<small class="wc-hint">Or use Link mode and click talents on the grid. The number is the ranks needed.</small></div>
    <div class="wp-ed-row">${number("node.gateTreePoints", "Points in the tree", n.gate.treePoints ?? 0, 0, 999, "0 = none")}${number("node.gateLevel", "Character level", n.gate.level ?? 0, 0, MAX_LEVEL, "0 = none")}</div>
    <div class="wp-field"><span>Can't be learned with</span><div class="wp-chips">${exs}</div>${exOpts.length ? `<select name="addEx" aria-label="Add an exclusive talent">${opt(exOpts, "Add a talent…")}</select>` : ""}</div>
    <div class="wp-ed-btns wp-ed-del">${btn("deleteNode", "Delete talent", { icon: "fa-trash", small: true, danger: true })}</div>`;
}

/** Right column. @param {EditorFacts} f */
function inspectorHTML(f) {
  if (!f.tree) return `<aside class="wp-ed-insp"><p class="wc-hint">No tree chosen.</p></aside>`;
  const n = f.selected ? f.tree.nodes.find(x => x.id === f.selected) ?? null : null;
  return `<aside class="wp-ed-insp">${n ? nodeHTML(f, n) : treeSettingsHTML(f)}</aside>`;
}

/** The whole window. @param {EditorFacts} f */
export function editorHTML(f) {
  return `<div class="wp-editor">${leftHTML(f)}${mainHTML(f)}${inspectorHTML(f)}</div>`;
}

/** The document browser's list items (also redrawn alone while typing, so the search box keeps focus). @param {Pick<EditorFacts, "sources" | "search">} f */
export function sourcesHTML(f) {
  return f.sources.length ? f.sources.map(d => `<li class="wp-ed-doc" draggable="true" data-uuid="${esc(d.uuid)}" data-doc="${esc(d.documentName)}" data-tooltip-text="${esc(`${d.name} · drag onto an empty spot or a rank slot`)}">
      <span class="wp-ed-ic">${pic(d.img, d.documentName === "ActiveEffect" ? "fa-wand-sparkles" : "fa-scroll")}</span><span class="wp-ed-dn">${esc(d.name)}<small>${esc([d.type, d.from].filter(Boolean).join(" · "))}</small></span></li>`).join("")
    : `<li class="wc-hint">${f.search ? "Nothing matches." : "Type to search your items."}</li>`;
}

/**
 * Filters browsable documents by a search text (every word must appear in the name or type), at most `limit`.
 * @template {{ name: string, type?: string }} D @param {D[]} docs @param {string} text @param {number} [limit]
 */
export function searchDocs(docs, text, limit = 60) {
  const words = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return docs.slice(0, limit);
  return docs.filter(d => { const s = `${d.name} ${d.type ?? ""}`.toLowerCase(); return words.every(w => s.includes(w)); }).slice(0, limit);
}

/**
 * Reads the editor's field names: "tree.name" → { scope: "tree", key: "name" }, "node.maxRanks", "req.<id>", "assign.classes",
 * "addReq", "addEx", "search". Null for anything else. @param {unknown} name
 */
export function readFieldName(name) {
  const s = typeof name === "string" ? name : "";
  const m = /^(tree|node|req|assign|custom)\.([A-Za-z0-9_-]{1,64})$/.exec(s);
  if (m) return { scope: m[1], key: m[2] };
  if (["addReq", "addEx", "search"].includes(s)) return { scope: s, key: "" };
  return null;
}
