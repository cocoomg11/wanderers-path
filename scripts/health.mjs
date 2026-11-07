/**
 * The read-only health check (core's healthCollector): never throws, never writes. GM only (players get []): it names trees and
 * characters. Sections: Trees (compendium chosen, found, readable by players, published count, issues), Characters (orphan picks,
 * overspent), Learning (a GM is needed to learn). Untested in Node: needs a live world (the checks' rules are in the models).
 */
import { healthCollector } from "../vendor/wanderers-core/index.mjs";
import { ID, PICKS_FLAG } from "./const.mjs";
import { F, leader } from "./core.mjs";
import { treeIssues } from "./tree-model.mjs";
import * as P from "./picks-model.mjs";
import { loadTrees, pack, packId } from "./trees.mjs";
import { rules, actorFacts } from "./path.mjs";

/** Default per-section limit when the caller gives none; the caller's own (e.g. the Satchel's) is clamped to 1 s – 5 min. */
export const REPORT_TIMEOUT_MS = 20000;
/** @param {unknown} ms */
export const reportTimeout = ms => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.min(300000, Math.max(1000, Math.round(ms))) : REPORT_TIMEOUT_MS);

/**
 * Whether a granted document exists, without loading it: a world document or a compendium index entry. Unknown (undefined) when
 * a compendium's index isn't loaded, so nothing is reported wrongly. @param {string} uuid
 */
function exists(uuid) {
  try {
    if (fromUuidSync(uuid, { strict: false })) return true;
    const p = uuid.split(".");
    if (p[0] !== "Compendium") return false;
    const pk = game.packs?.get(`${p[1]}.${p[2]}`);
    if (!pk) return false;
    return pk.index?.size ? false : undefined;
  } catch { return undefined; }
}

/** Characters that carry picks. */
const withPicks = () => (game.actors?.contents ?? []).filter((/** @type {any} */ a) => a.flags?.[ID]?.[PICKS_FLAG]);

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
    }
  });
  await c.checkAsync("Characters", async add => {
    const trees = await loadTrees(); const known = new Set(trees.map(t => t.id)); const r = rules();
    const list = withPicks(); let bad = 0;
    for (const a of list) {
      const picks = P.normalizePicks(a.flags[ID][PICKS_FLAG]);
      const orphans = Object.keys(picks.ranks).filter(id => !known.has(id));
      if (orphans.length) { bad++; add("warn", `${a.name} has points in ${orphans.length === 1 ? "a tree" : "trees"} no longer published (${orphans.join(", ")}): a free respec gives them back.`); }
      const pts = P.pointsFor({ level: actorFacts(a).level, picks, trees, rules: r });
      if (pts.available < 0) { bad++; add("warn", `${a.name} has spent ${-pts.available} more ${pts.available === -1 ? "point" : "points"} than they have (a lower level or a smaller award?).`); }
    }
    if (!bad) add("ok", list.length ? `${list.length} ${list.length === 1 ? "character has" : "characters have"} talents; nothing to fix.` : "No character has learned talents yet.");
  });
  c.section("Learning");
  c.check(add => {
    const i = leader.info();
    add("info", "Players learn through a connected GM: without one, Learn waits.");
    add(i.started ? "ok" : "warn", i.started ? `This client ${i.leader ? "applies" : "doesn't apply"} learn requests (${i.sessions} GM ${i.sessions === 1 ? "session" : "sessions"} of yours).` : "The request handler hasn't started.");
  });
  return c.report();
}
