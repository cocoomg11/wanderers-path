import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { F, S } from "../scripts/core.mjs";
import { HOOKS, ID } from "../scripts/const.mjs";
import * as Cleanup from "../scripts/cleanup.mjs";

const src = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const scripts = readdirSync(new URL("../scripts/", import.meta.url)).filter(f => f.endsWith(".mjs"));

test("features, settings and hooks (0.2.0)", () => {
  assert.deepEqual(F.FEATURES.map(f => f.id), ["talents", "sheetButton", "keybindings", "moduleHooks"]);
  for (const f of F.FEATURES.slice(1)) assert.deepEqual(f.needs, ["talents"]);
  const keys = S.ROWS.map(r => r.key);
  for (const k of ["treePack", "enabledForAll", "unlockLevel", "pointsFromLevel", "pointsPerLevel", "playerRespec", "debugLog"]) assert.ok(keys.includes(k), k);
  const d = Object.fromEntries(S.ROWS.map(r => [r.key, r.default]));
  assert.deepEqual([d.treePack, d.enabledForAll, d.unlockLevel, d.pointsFromLevel, d.pointsPerLevel, d.playerRespec], ["", true, 1, 2, 1, false]);
  assert.deepEqual(HOOKS, { ready: `${ID}.ready`, learned: `${ID}.learned`, respec: `${ID}.respec` });
});

test("no module code calls game.socket (requests go through core's leader)", () => {
  for (const f of scripts) assert.doesNotMatch(src(`scripts/${f}`), /game\.socket/, f);
});

test("pure models import nothing from Foundry and call no Foundry globals", () => {
  for (const f of scripts.filter(f => f.endsWith("-model.mjs"))) {
    const s = src(`scripts/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(s, /\b(game|canvas|ui|CONFIG|foundry|Hooks|fromUuid|fromUuidSync)\b\s*[.(]/, f);
    assert.doesNotMatch(s, /wanderers-core\/foundry/, f);
  }
});

test("every window carries core's UI_CLASSES and wp-window; no literal revision", () => {
  for (const f of scripts) {
    const s = src(`scripts/${f}`);
    for (const m of s.matchAll(/classes: \[("wp-[^\]]*)\]/g)) { assert.match(m[1], /\.\.\.UI_CLASSES/, `${f}: ${m[0]}`); assert.match(m[1], /"wp-window"/, `${f}: ${m[0]}`); }
    assert.doesNotMatch(s, /wc-r\d/, f);
  }
  assert.match(src("scripts/window.mjs"), /RememberedWindow\(ApplicationV2, \{ moduleId: ID, key: WINDOW_KEY \}\)/);
  assert.match(src("scripts/window.mjs"), /export const WINDOW_KEY = "path"/);
});

test("css: every rule scoped to our windows or our tooltip, no backdrop blur", () => {
  const css = src("styles/wanderers-path.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, "$1");
  for (const rule of css.split("}").map(r => r.split("{")[0].trim()).filter(Boolean)) {
    for (const sel of rule.split(",")) assert.match(sel.trim(), /^(\.wp-window|\.wp-path-window|#tooltip\.wp-tip|\.locked-tooltip\.wp-tip)\b/, sel);
  }
  assert.match(css, /backdrop-filter: none/);
});

// CLAUDE.md is left out: its own rule names the words to avoid.
test("public repo: no publisher or campaign words; no talent content", () => {
  const files = [...scripts.map(f => `scripts/${f}`), "styles/wanderers-path.css", "README.md", "CHANGELOG.md", "module.json",
    ...readdirSync(new URL("./", import.meta.url)).map(f => `tests/${f}`)];
  const word = ["war" + "craft", "bliz" + "zard", "azer" + "oth", "def" + "ias", "ony" + "xia", "world of " + "war"].join("|");
  for (const f of files) assert.doesNotMatch(src(f), new RegExp(word, "i"), f);
  assert.ok(!("packs" in JSON.parse(src("module.json"))));
});

test("cleanup: picks, granted documents and settings removable, tree compendium only listed", () => {
  assert.deepEqual(Cleanup.CATEGORIES.map(c => c[0]), ["picks", "granted", "settings", "trees"]);
  assert.deepEqual([...Cleanup.REMOVABLE], ["picks", "granted", "settings"]);
  assert.match(src("scripts/cleanup.mjs"), /never deleted/);
  assert.match(src("scripts/cleanup.mjs"), /if \(keys\.includes\("granted"\)\) done\.granted = await removeGranted\(\);[\s\S]*?keys\.includes\("picks"\)/, "granted documents go before the picks");
});

test("grant engine: leader-only writes, sources loaded in bulk, reconcile after every picks write", () => {
  const g = src("scripts/grants.mjs");
  assert.match(g, /export async function applyPlan[\s\S]*?if \(!leader\.isLeader\(\)\) throw/);
  assert.doesNotMatch(g, /\bfromUuid\(/, "no async fromUuid per node");
  assert.match(g, /getDocuments\(\{ _id__in:/);
  for (const f of scripts.filter(f => !["grants.mjs", "cleanup.mjs"].includes(f))) assert.doesNotMatch(src(`scripts/${f}`), /(create|update|delete)EmbeddedDocuments/, f);
  const p = src("scripts/path.mjs");
  assert.equal((p.match(/await writePicks\(/g) ?? []).length, (p.match(/await writePicks\([^)]*\);\s*await syncGrants\(/g) ?? []).length, "every picks write is followed by a reconcile");
  assert.match(p, /leader\.handle\("pathLearn", one\(onLearn\)\)/, "requests run one at a time per character");
  assert.match(src("scripts/main.mjs"), /get refresh\(\) \{\s*if \(!F\.on\("talents"\)\) return undefined;/);
});

test("leader writes only: picks are written in one place, after the leader check", () => {
  const p = src("scripts/path.mjs");
  assert.equal((p.match(/actor\.update\(/g) ?? []).length, 1);
  assert.match(p, /async function writePicks[\s\S]*?if \(!leader\.isLeader\(\)\) throw/);
  for (const f of scripts.filter(f => f !== "path.mjs")) assert.doesNotMatch(src(`scripts/${f}`), /\.update\(\{|setFlag\(/, f);
  assert.match(p, /if \(!user\.isGM && !st\.rules\.playerRespec\)/, "players refund only with player respec on");
  assert.match(p, /testUserPermission\(user, "OWNER"\)/);
  assert.match(p, /if \(!F\.on\("moduleHooks"\)\) return;/);
});

test("sheet button, key binding and API are gated by their features", () => {
  const m = src("scripts/main.mjs");
  assert.match(m, /if \(F\.on\("sheetButton"\)\) Hooks\.on\("getHeaderControlsActorSheetV2"/);
  assert.match(m, /if \(F\.on\("keybindings"\)\)[\s\S]*?action: "path"/);
  assert.doesNotMatch(m, /editable:/, "no default key");
  assert.match(m, /get open\(\) \{ return F\.on\("talents"\)/);
  assert.match(m, /get trees\(\) \{ return F\.on\("talents"\)/);
  assert.match(m, /if \(!F\.on\("talents"\)\) return undefined;/);
});
