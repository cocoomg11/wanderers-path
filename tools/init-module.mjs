#!/usr/bin/env node
/**
 * Run once, right after "Use this template": replaces the placeholder module id, title and CSS prefix everywhere, renames the
 * stylesheet, then deletes itself and its test. TEMPLATE.md stays until you have finished its checklist (delete it then).
 *
 *   node tools/init-module.mjs --id my-new-module --title "My New Module" [--prefix mn] [--description "One sentence."] [--dry-run]
 *
 * Placeholders it replaces:  my-module (id)   My Module (title)   tpl- (CSS class prefix)   myModule (camelCase of the id)
 */
import { readFileSync, writeFileSync, readdirSync, renameSync, rmSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER = { id: "my-module", title: "My Module", prefix: "tpl", camel: "myModule", description: "One or two sentences on what this module does for the GM. Works with any game system." };
const SKIP_DIRS = new Set([".git", "node_modules", "vendor"]);
const SELF_DELETE = ["tools/init-module.mjs", "tests/init-module.test.mjs"];
/** Kept after init (its checklist is finished by hand, then the file is deleted) and never rewritten. */
const KEEP_AS_IS = new Set(["TEMPLATE.md"]);

/** @param {string} id */
export const camelOf = id => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Default CSS prefix: the initials of the id's words ("wanderers-satchel" gives "ws"), or the first three letters of a one-word id. */
/** @param {string} id */
export function defaultPrefix(id) {
  const parts = id.split("-").filter(Boolean);
  return parts.length > 1 ? parts.map(p => p[0]).join("").slice(0, 5) : id.slice(0, 3);
}

/**
 * Checks the answers; returns a list of problems (empty when fine).
 * @param {{ id?: string, title?: string, prefix?: string }} o
 */
export function validate(o) {
  const errors = [];
  if (!o.id || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(o.id)) errors.push("--id must be lowercase letters, digits and single hyphens, starting with a letter (for example my-new-module).");
  else if (o.id === PLACEHOLDER.id) errors.push("--id must differ from the placeholder 'my-module'.");
  if (!o.title || !o.title.trim()) errors.push("--title is required (for example \"My New Module\").");
  else if (/[<>"\\]/.test(o.title)) errors.push("--title must not contain < > \" or backslash.");
  if (!o.prefix || !/^[a-z][a-z0-9]{1,5}$/.test(o.prefix)) errors.push("--prefix must be 2 to 6 lowercase letters or digits, starting with a letter.");
  return errors;
}

/**
 * Pure text replacement.
 * @param {string} text
 * @param {{ id: string, title: string, prefix: string, description?: string }} o
 */
export function replaceTokens(text, o) {
  let out = text;
  if (o.description) out = out.split(PLACEHOLDER.description).join(o.description);
  return out
    .split(PLACEHOLDER.title).join(o.title)
    .split(PLACEHOLDER.id).join(o.id)
    .split(PLACEHOLDER.camel).join(camelOf(o.id))
    .split(`${PLACEHOLDER.prefix}-`).join(`${o.prefix}-`);
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */ const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */ const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; if (!k.startsWith("--")) continue;
    const name = k.slice(2);
    if (name === "dry-run") a[name] = true; else a[name] = argv[++i] ?? "";
  }
  return a;
}

/**
 * Applies the replacement to a folder. Returns { changed, renamed, deleted, leftovers }.
 * @param {string} root
 * @param {{ id: string, title: string, prefix: string, description?: string }} o
 * @param {{ dryRun?: boolean }} [opts]
 */
export function apply(root, o, opts = {}) {
  const selfAbs = new Set(SELF_DELETE.map(f => join(root, ...f.split("/"))));
  /** @type {string[]} */ const changed = []; /** @type {string[]} */ const leftovers = [];
  for (const file of walk(root)) {
    if (selfAbs.has(file) || KEEP_AS_IS.has(relative(root, file))) continue;
    if (/\.(png|jpg|jpeg|gif|webp|zip|woff2?)$/i.test(file)) continue;
    const before = readFileSync(file, "utf8"); const after = replaceTokens(before, o);
    if (after !== before) { changed.push(relative(root, file)); if (!opts.dryRun) writeFileSync(file, after); }
    if (!opts.dryRun && /my-module|My Module|\btpl-/.test(after)) leftovers.push(relative(root, file));
  }
  const css = join(root, "styles", `${PLACEHOLDER.id}.css`);
  /** @type {string[]} */ const renamed = [];
  if (existsSync(css)) { renamed.push(`styles/${PLACEHOLDER.id}.css -> styles/${o.id}.css`); if (!opts.dryRun) renameSync(css, join(root, "styles", `${o.id}.css`)); }
  /** @type {string[]} */ const deleted = [];
  for (const f of selfAbs) if (existsSync(f)) { deleted.push(relative(root, f).split(sep).join("/")); if (!opts.dryRun) rmSync(f); }
  return { changed, renamed, deleted, leftovers };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = parseArgs(process.argv.slice(2));
  const id = String(a.id ?? ""); const title = String(a.title ?? "");
  const prefix = String(a.prefix ?? (id ? defaultPrefix(id) : ""));
  const description = a.description ? String(a.description) : undefined;
  const errors = validate({ id, title, prefix });
  if (errors.length) { console.error(`${errors.join("\n")}\n\nUsage: node tools/init-module.mjs --id my-new-module --title "My New Module" [--prefix mn] [--description "..."] [--dry-run]`); process.exit(1); }
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (!existsSync(join(root, "styles", `${PLACEHOLDER.id}.css`))) { console.error("This copy looks already initialised (styles/my-module.css is gone). Nothing to do."); process.exit(1); }
  const r = apply(root, { id, title, prefix, description }, { dryRun: !!a["dry-run"] });
  console.log(`${a["dry-run"] ? "Dry run: would change" : "Changed"} ${r.changed.length} files; ${r.renamed.join("; ")}; ${a["dry-run"] ? "would delete" : "deleted"}: ${r.deleted.join(", ")}.`);
  if (r.leftovers.length) console.warn(`Placeholders still found in: ${r.leftovers.join(", ")}`);
  if (!a["dry-run"]) console.log(`\nDone. Next: review "git diff", set the description in module.json and README.md, then commit.\nThen follow the rest of TEMPLATE.md (install, Adopt core, then delete TEMPLATE.md).`);
}
