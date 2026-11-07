import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as I from "../tools/init-module.mjs";

test("validate", () => {
  assert.deepEqual(I.validate({ id: "good-id", title: "Good", prefix: "gi" }), []);
  assert.equal(I.validate({ id: "Bad_Id", title: "x", prefix: "gi" }).length, 1);
  assert.equal(I.validate({ id: "my-module", title: "x", prefix: "gi" }).length, 1);
  assert.equal(I.validate({ id: "ok", title: " ", prefix: "gi" }).length, 1);
  assert.equal(I.validate({ id: "ok", title: "x", prefix: "G" }).length, 1);
});

test("prefix and camel defaults", () => {
  assert.equal(I.defaultPrefix("wanderers-satchel"), "ws");
  assert.equal(I.defaultPrefix("ringmaker"), "rin");
  assert.equal(I.camelOf("loot-ledger-two"), "lootLedgerTwo");
});

test("replaceTokens", () => {
  const out = I.replaceTokens("my-module | My Module | tpl-window | myModuleExample", { id: "red-book", title: "Red Book", prefix: "rb" });
  assert.equal(out, "red-book | Red Book | rb-window | redBookExample");
});

test("apply on a scratch folder renames, replaces and deletes itself", () => {
  const dir = mkdtempSync(join(tmpdir(), "init-"));
  mkdirSync(join(dir, "styles")); mkdirSync(join(dir, "tools")); mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "module.json"), '{"id":"my-module","title":"My Module"}');
  writeFileSync(join(dir, "styles", "my-module.css"), ".tpl-window{}");
  writeFileSync(join(dir, "TEMPLATE.md"), "my-module"); writeFileSync(join(dir, "tools", "init-module.mjs"), "x"); writeFileSync(join(dir, "tests", "init-module.test.mjs"), "x");
  const r = I.apply(dir, { id: "a-b", title: "A B", prefix: "ab" });
  assert.deepEqual(r.leftovers, []);
  assert.equal(readFileSync(join(dir, "module.json"), "utf8"), '{"id":"a-b","title":"A B"}');
  assert.equal(readFileSync(join(dir, "styles", "a-b.css"), "utf8"), ".ab-window{}");
  assert.equal(readFileSync(join(dir, "TEMPLATE.md"), "utf8"), "my-module");
  assert.ok(!existsSync(join(dir, "tools", "init-module.mjs")) && !existsSync(join(dir, "tests", "init-module.test.mjs")));
});
