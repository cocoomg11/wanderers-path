/**
 * Health check (read-only, never throws, never changes anything). Returns sections of { title, lines: [{ level, text }] } with level
 * ok / warn / bad / off / info, the shape the Wanderer's Satchel hub understands. Core's collector wraps each check, so one that
 * throws becomes a warning line instead of breaking the report. Add a check when adding a feature with setup needs.
 */
import { healthCollector } from "../vendor/wanderers-core/index.mjs";
import { ID, TITLE } from "./const.mjs";
import { F, leader } from "./core.mjs";
import * as Example from "./example.mjs";
import * as M from "./example-model.mjs";

export function run() {
  const h = healthCollector();
  h.section(TITLE);
  h.check(add => add("info", `Version ${game.modules.get(ID)?.version ?? "?"}, Foundry ${game.version}.`));
  h.section("Features");
  for (const f of F.list()) h.check(add => add(f.on ? "ok" : "off", `${f.label}: ${f.on ? "on" : "off"}`));
  h.section("Writing client");
  h.check(add => {
    const i = leader.info();
    add(i.started ? "ok" : "warn", i.started ? `${i.sessions} GM session(s) heard; this client ${i.leader ? "writes" : "does not write"}.` : "The one-writer election has not started.");
  });
  if (F.on("example")) { h.section("Example tool"); h.check(add => add("ok", M.summary(Example.notes()))); }
  return h.report();
}
