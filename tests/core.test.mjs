import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { F, S } from "../scripts/core.mjs";
import { ID, HOOKS } from "../scripts/const.mjs";

// core.mjs binds core to this module. These definitions throw on a typo (duplicate key, bad type, a need that isn't a feature), so
// importing them here catches the mistake in CI instead of in a live world.
test("features and settings are well formed", () => {
  assert.ok(F.FEATURES.every(f => f.key === `feature-${f.id}`));
  assert.ok(S.ROWS.some(r => r.key === "debugLog"));
  assert.equal(HOOKS.ready, `${ID}.ready`);
});

test("module.json agrees with const.mjs", () => {
  const m = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  assert.equal(m.id, ID);
  assert.deepEqual(m.compatibility, { minimum: "13", verified: "14.370" });
  assert.equal(m.manifest, `https://github.com/cocoomg11/${ID}/releases/latest/download/module.json`);
  assert.equal(m.download, `https://github.com/cocoomg11/${ID}/releases/download/v${m.version}/module.zip`);
  assert.equal(m.relationships.systems[0].id, "dnd5e");
  assert.ok(!m.relationships.requires, "optional modules go in recommends, never requires");
  assert.equal(m.styles[0], "vendor/wanderers-core/styles/wanderers-ui.css");
  assert.ok(!("packs" in m), "the module ships no content");
});
