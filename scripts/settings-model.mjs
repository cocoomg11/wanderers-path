/**
 * The Settings window's health report, pure (tested in Node: tests/v050.test.mjs). No Foundry calls at import or call time.
 *
 * Lines are core's report lines (`{ level, text, fix? }`, the fix read by core's `readFix`). A line with a usable fix (one with a
 * `run` function: ours always are) gets a button whose `data-fix` is its key "section:line"; `fixAt(report, key)` finds that fix
 * again on click. Everything is escaped (core's `statusLine` / `esc`).
 */
import { esc, statusLine, readFix } from "../vendor/wanderers-core/index.mjs";

/** "s:l": section and line index. */
export const FIX_KEY_RE = /^\d{1,3}:\d{1,4}$/;

/**
 * The fix of the line at `key`, or null (bad key, no line, no fix, or a fix without `run`: an action id only the Satchel resolves).
 * @param {unknown} report @param {unknown} key @returns {{ label: string, run: () => unknown, confirm?: string } | null}
 */
export function fixAt(report, key) {
  if (typeof key !== "string" || !FIX_KEY_RE.test(key) || !Array.isArray(report)) return null;
  const [s, l] = key.split(":").map(Number);
  const f = readFix(report[s]?.lines?.[l]?.fix);
  return f && typeof f.run === "function" ? /** @type {any} */ (f) : null;
}

/**
 * The report as HTML: one heading and list per section, a Fix button (`data-action="fix"`, `data-fix`) on lines that have one.
 * `busy` is the key of a fix that is running (its button is disabled and says so).
 * @param {unknown} report @param {{ busy?: string | null }} [o] @returns {string}
 */
export function reportHTML(report, { busy = null } = {}) {
  if (!Array.isArray(report)) return `<p class="wc-hint">Not run yet.</p>`;
  if (!report.length) return `<p class="wc-hint">Nothing to report.</p>`;
  return report.map((sec, s) => {
    const lines = (Array.isArray(sec?.lines) ? sec.lines : []).map((/** @type {any} */ line, /** @type {number} */ l) => {
      const key = `${s}:${l}`; const f = fixAt(report, key);
      const btn = f ? ` <button type="button" class="wc-btn wc-btn-sm wp-fix" data-action="fix" data-fix="${key}"${busy === key ? " disabled" : ""}>${esc(busy === key ? "Working…" : f.label)}</button>` : "";
      return statusLine(String(line?.level ?? "info"), line?.text, { html: btn });
    }).join("");
    return `${sec?.title ? `<h4>${esc(sec.title)}</h4>` : ""}<ul class="wc-lines">${lines}</ul>`;
  }).join("");
}

/** The notice after a fix ran: its own text when it returned one, else a generic line. @param {string} label @param {unknown} result */
export function fixNotice(label, result) {
  if (result === false) return { level: "warn", text: `${label}: nothing was sent.` };
  if (typeof result === "string" && result.trim()) return { level: "info", text: result.trim().slice(0, 300) };
  return { level: "info", text: `${label}: done.` };
}
