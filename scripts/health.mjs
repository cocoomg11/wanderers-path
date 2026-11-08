/**
 * The read-only health check (core's healthCollector): never throws, never writes. GM only (players get []): it names trees and
 * characters. Sections: Trees (compendium chosen, found, readable by players, published count, issues, granted items with
 * advancement), Drafts (0.6.0: unpublished drafts, the GM-only drafts journal), Characters (orphan picks, overspent, granted documents out of step), Learning (a GM is needed to learn). Lines that
 * have a safe fix carry it (core's `fix`): Refresh granted items, Refund orphans. Untested in Node: needs a live world (the checks' rules are in the models).
 */
import { healthCollector } from "../vendor/wanderers-core/index.mjs";
import { ID, PICKS_FLAG } from "./const.mjs";
import { F, AUTOMATIONS, leader } from "./core.mjs";
import { automationNodes, automationLines } from "./automation-model.mjs";
import { treeIssues } from "./tree-model.mjs";
import * as P from "./picks-model.mjs";
import { loadTrees, pack, packId } from "./trees.mjs";
import { rules, actorFacts, stateOf, grantSummaryOf, sendAndWait, builtOk, desiredOf } from "./path.mjs";
import { loadTreesChecked, uuidExists } from "./trees.mjs";
import * as Drafts from "./drafts.mjs";
import { draftLines } from "./draft-model.mjs";
import { hasAdvancement, missingSources } from "./grants-model.mjs";
import { existingOf } from "./grants.mjs";
import * as SheetPage from "./sheet-page.mjs";
import { pageStatus } from "./sheet-page-model.mjs";
import { specIssues, specWarnings, templateOf } from "./builder-model.mjs";

/** Default per-section limit when the caller gives none; the caller's own (e.g. the Satchel's) is clamped to 1 s – 5 min. */
export const REPORT_TIMEOUT_MS = 20000;
/** @param {unknown} ms */
export const reportTimeout = ms => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.min(300000, Math.max(1000, Math.round(ms))) : REPORT_TIMEOUT_MS);

const exists = uuidExists;

/** Characters that carry picks or granted documents. */
const withPicks = () => (game.actors?.contents ?? []).filter((/** @type {any} */ a) => a.flags?.[ID]?.[PICKS_FLAG] || existingOf(a).length);

/**
 * A fix's run: sends the request and resolves only after the leader's reconcile finished (or ~30 s), so the Satchel's re-check sees
 * the result. False when nothing could be sent. @param {"pathRefresh" | "pathOrphans"} kind @param {string} label
 */
const runAndWait = async (kind, label) => {
  const r = await sendAndWait(kind, {});
  if (r === false) return false;
  return r === "timeout" ? `${label}: sent; the GM client hasn't answered yet (check again shortly).` : `${label}: done.`;
};

/** The fixes health lines offer (each sends a GM request; the leader applies it; run resolves when it is done). */
export const FIXES = {
  refresh: () => ({ label: "Refresh granted items", confirm: "Make every character's granted items and effects match their learned talents again (copies whose source changed are made again; untagged items are never touched)?", run: () => runAndWait("pathRefresh", "Refresh granted items") }),
  orphans: () => ({ label: "Refund orphans", confirm: "Refund every rank in trees or talents that are no longer published, for every character, and remove what those ranks granted?", run: () => runAndWait("pathOrphans", "Refund orphans") })
};

/** The missing UUID sources of a character's desired grants (never throws). @param {any} st */
function missingOf(st) {
  try { return missingSources(desiredOf(st), exists); } catch { return []; }
}

/**
 * Whether a world item (by UUID, already loaded) carries dnd5e advancement; undefined for compendium documents (only their index is
 * at hand: the GM is told when the grant is made). @param {string} uuid
 */
function worldAdvancement(uuid) {
  if (uuid.startsWith("Compendium.")) return undefined;
  try { const d = fromUuidSync(uuid, { strict: false }); return d?.documentName === "Item" ? hasAdvancement(d._source ?? d) : undefined; } catch { return undefined; }
}

/**
 * The report: [{ title, lines: [{ level, text }] }].
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function report({ timeoutMs } = {}) {
  if (!game.user?.isGM) return [];
  const c = healthCollector({ timeoutMs: reportTimeout(timeoutMs) });
  if (!F.on("talents")) {
    c.section("Talents"); c.add("off", "Talents are turned off (Features).");
    return c.report();
  }
  await c.checkAsync("Trees", async add => {
    const id = packId();
    if (!id) return add("warn", "No tree compendium is chosen yet (Wanderer's Path settings).");
    const p = pack();
    if (!p) return add("bad", `The tree compendium ${id} isn't in this world.`);
    if (p.documentName !== "JournalEntry") return add("bad", `${p.title} holds ${p.documentName} documents; trees are Journal Entries.`);
    add("ok", `Tree compendium: ${p.title}.`);
    // The pack's role → level map (CompendiumCollection#ownership); an unset Player level counts as unknown, not as a problem.
    const own = String(p.ownership?.PLAYER ?? "");
    if (own) add(["OBSERVER", "OWNER"].includes(own) ? "ok" : "warn", ["OBSERVER", "OWNER"].includes(own) ? "Players can read it." : "Players can't read it: set its Player ownership to Observer, or players see no trees.");
    const trees = await loadTrees();
    add(trees.length ? "ok" : "info", trees.length ? `${trees.length} published ${trees.length === 1 ? "tree" : "trees"}.` : "No trees are published yet.");
    for (const t of trees) {
      const issues = treeIssues(t, { has: exists });
      for (const i of issues.slice(0, 10)) add(i.level, i.text);
      if (issues.length > 10) add("warn", `${t.name}: ${issues.length - 10} more issues.`);
      for (const n of t.nodes) {
        const built = n.grant.ranks.filter(r => "built" in r);
        if (built.length && !builtOk()) add("warn", `${t.name} › ${n.name} has a built effect, which needs Foundry 14 and dnd5e 6: it grants nothing here.`);
        for (const r of built) {
          const raw = /** @type {any} */ (r).built;
          const i = specIssues(raw, { maxRanks: n.maxRanks }); if (i.length) { add("bad", `${t.name} › ${n.name}: ${i[0]}`); continue; }
          for (const w of specWarnings(raw)) add("warn", `${t.name} › ${n.name}: ${w}`);
          const tpl = templateOf(raw?.template);
          if (tpl?.itemOnly && n.grant.mode !== "item") add("bad", `${t.name} › ${n.name}: ${tpl.label} makes a feature item, but the talent grants an effect: it grants nothing.`);
          if (tpl?.id === "spell" && exists(String(raw.params?.spell ?? "")) === false) add("warn", `${t.name} › ${n.name}: the granted spell's UUID points at nothing.`);
        }
        if (n.grant.mode !== "item") continue;
        if (n.grant.ranks.some(r => "uuid" in r && worldAdvancement(r.uuid))) add("warn", `${t.name} › ${n.name} grants an item with advancement, which doesn't run on talent grants.`);
      }
    }
  });
  if (F.on("editor")) await c.checkAsync("Drafts", async add => {
    const trees = await loadTrees();
    for (const l of draftLines(trees, Drafts.read())) add(l.level, l.text);
    const st = Drafts.status();
    if (!st.exists) return add("info", "The drafts journal is made on the first Save draft (GM only, in the Module data folder).");
    if (st.count > 1) add("warn", `${st.count} drafts journals exist; only the first is used. Delete the others in the Module data folder.`);
    if (st.playersCanSee.length) add("warn", `The drafts journal "${st.name}" is shared with ${st.playersCanSee.join(", ")}: set its ownership back to None for players.`);
    else add("ok", "The drafts journal is GM only.");
    const j = Drafts.Store.entry();
    if (j && !j.folder) add("info", "The drafts journal sits at the top of the Journal sidebar; the acting GM files it into the Module data folder on their next load.");
  });
  await c.checkAsync("Characters", async add => {
    const { trees, ok } = await loadTreesChecked(); const known = new Set(trees.map(t => t.id)); const r = rules();
    const list = withPicks(); let bad = 0; let outOfSync = 0, grantedChars = 0, granted = 0, missing = 0;
    for (const a of list) {
      const picks = P.normalizePicks(a.flags?.[ID]?.[PICKS_FLAG]);
      const orphans = Object.keys(picks.ranks).filter(id => !known.has(id));
      const lost = Object.entries(picks.ranks).filter(([id]) => known.has(id)).reduce((s, [id, m]) => { const t = trees.find(x => x.id === id); return s + Object.keys(m).filter(n => !t?.nodes.some(x => x.id === n)).length; }, 0);
      if (ok && (orphans.length || lost)) { bad++; add("warn", `${a.name} has points in ${orphans.length ? `${orphans.length === 1 ? "a tree" : "trees"} no longer published (${orphans.join(", ")})` : `${lost} ${lost === 1 ? "talent" : "talents"} a tree no longer has`}.`, FIXES.orphans()); }
      const pts = P.pointsFor({ level: actorFacts(a).level, picks, trees, rules: r });
      if (pts.available < 0) { bad++; add("warn", `${a.name} has spent ${-pts.available} more ${pts.available === -1 ? "point" : "points"} than they have (a lower level or a smaller award?).`); }
      const st = await stateOf(a);
      const g = grantSummaryOf(a, st, ok);
      const gone = ok ? missingOf(st) : [];
      if (gone.length) { missing++; bad++; add("warn", `${a.name}: ${gone.length} granted ${gone.length === 1 ? "source no longer exists" : "sources no longer exist"} (${gone.slice(0, 3).join(", ")}${gone.length > 3 ? ", …" : ""}). Existing copies are kept; Refresh can't make them again. Point the talent at another document (Tree editor) and publish.`); }
      granted += g.count; if (g.count) grantedChars++;
      if (g.outOfSync) { outOfSync++; bad++; add("warn", `${a.name}: ${g.outOfSync} granted ${g.outOfSync === 1 ? "document is" : "documents are"} out of step with the learned talents.`, FIXES.refresh()); }
      if (g.advancement.length) add("warn", `${a.name}: ${g.advancement.join(", ")} ${g.advancement.length === 1 ? "has" : "have"} advancement, which doesn't run on talent grants.`);
    }
    if (granted) add("info", `${granted} granted ${granted === 1 ? "item or effect" : "items and effects"} on ${grantedChars} ${grantedChars === 1 ? "character" : "characters"}${outOfSync || missing ? "" : ", all in step"}. A copy whose source changed is made again only by Refresh granted items.`, outOfSync ? undefined : FIXES.refresh());
    if (!ok && packId()) add("warn", "The tree compendium can't be read: granted items are kept as they are until it can.");
    else if (!packId() && granted) add("info", "No tree compendium is chosen: granted items are kept as they are until one is.");
    if (!bad) add("ok", list.length ? `${list.length} ${list.length === 1 ? "character has" : "characters have"} talents; nothing to fix.` : "No character has learned talents yet.");
  });
  await c.checkAsync("Automation", async add => {
    const trees = await loadTrees();
    for (const l of automationLines(AUTOMATIONS.keys(), automationNodes(trees, k => AUTOMATIONS.has(k)))) add(l.level, l.text);
  });
  c.section("Toolkit sheet page");
  c.check(add => {
    const st = SheetPage.status();
    const line = pageStatus({ feature: F.on("toolkitPage"), toolkit: st.toolkit, toolkitVersion: st.toolkitVersion, sheet: st.sheet, result: st.result });
    add(line.level, line.text);
  });
  c.section("Learning");
  c.check(add => {
    const i = leader.info();
    add("info", "Players learn through a connected GM: without one, Learn waits.");
    add(i.started ? "ok" : "warn", i.started ? `This client ${i.leader ? "applies" : "doesn't apply"} learn requests (${i.sessions} GM ${i.sessions === 1 ? "session" : "sessions"} of yours).` : "The request handler hasn't started.");
  });
  return c.report();
}
