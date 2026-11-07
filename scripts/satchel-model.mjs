/**
 * Wanderer's Satchel registration, pure (tested in Node: tests/satchel.test.mjs). The Satchel is an optional GM hub (module id
 * `wanderers-satchel`); when it is active, Wanderer's Path registers itself through its `api.register()` (see the Satchel's README,
 * "Registration fields"). No hard dependency: nothing here runs without the Satchel. Same shape as Wanderer's Guild's registration.
 */
export const SATCHEL_ID = "wanderers-satchel";
/** The hook the Satchel fires once, with its api, when it is ready. */
export const SATCHEL_READY = `${SATCHEL_ID}.ready`;

/**
 * The object passed to `api.register()`. Only fields the Satchel knows are passed (it warns about unknown ones).
 * `open`: the talent window (false when there's nothing to open, so the Satchel opens Settings instead); `openPanel`: our Settings
 * window (rules, health, Remove data); `health({ timeoutMs })`: our core report; `records`: hidden record settings.
 * @param {{ id: string, title: string, open: () => unknown, openLabel?: string, openPanel: () => unknown, health: (o?: { timeoutMs?: number }) => unknown, records: readonly string[], debugKey: string }} o
 */
export function registration({ id, title, open, openLabel, openPanel, health, records, debugKey }) {
  return {
    id, title,
    open: () => open(),
    ...(openLabel ? { openLabel: String(openLabel).slice(0, 40) } : {}),
    openPanel: () => openPanel(),
    health: (/** @type {{ timeoutMs?: number }} */ opts = {}) => health(opts),
    debugSetting: { namespace: id, key: debugKey },
    skipSettings: [...new Set(records)]
  };
}

/**
 * Registers with the Satchel when it is active: at once when its api is there, and again on its ready hook (a second registration
 * for the same id just replaces the first). Returns what register() returned, or null.
 * @param {object} reg
 * @param {{ active: () => boolean, api: () => any, once: (hook: string, fn: (api: any) => void) => void, warn: (msg: string, e?: unknown) => void }} env
 */
export function registerWith(reg, env) {
  if (!env.active()) return null;
  const go = (/** @type {any} */ api) => {
    if (typeof api?.register !== "function") return null;
    try {
      const r = api.register(reg);
      if (r && r.ok === false) env.warn(`Wanderer's Satchel refused the registration: ${r.error}`);
      else if (r?.warnings?.length) env.warn(`Wanderer's Satchel: ${r.warnings.join("; ")}`);
      return r ?? null;
    } catch (e) { env.warn("Wanderer's Satchel registration failed", e); return null; }
  };
  env.once(SATCHEL_READY, api => go(api ?? env.api()));
  return go(env.api());
}
