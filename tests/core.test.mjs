import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { F, S, REQUESTS } from "../scripts/core.mjs";
import { ID, HOOKS } from "../scripts/const.mjs";
import { CATEGORIES } from "../scripts/cleanup.mjs";

// core.mjs binds core to this module. These definitions throw on a typo (duplicate key, bad type, a need that isn't a feature), so
// importing them here catches the mistake in CI instead of in a live world.
test("features, settings and requests are well formed", () => {
  assert.ok(F.FEATURES.length >= 1);
  assert.ok(F.FEATURES.every(f => f.key === `feature-${f.id}`));
  assert.ok(S.ROWS.some(r => r.key === "debugLog"));
  assert.ok(Object.hasOwn(REQUESTS, "exampleNote"));
  assert.equal(HOOKS.ready, `${ID}.ready`);
});

test("module.json agrees with const.mjs and enables the socket", () => {
  const m = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(m.id, ID);
  assert.equal(m.socket, true);
  assert.deepEqual(m.compatibility, { minimum: "13", verified: "14.369" });
  assert.equal(m.manifest, `https://github.com/cocoomg11/${ID}/releases/latest/download/module.json`);
  assert.ok(!("maximum" in m.compatibility));
});

test("cleanup lists a category for every record the module writes", () => {
  assert.deepEqual(CATEGORIES.map(c => c[0]), ["notes", "settings"]);
});
