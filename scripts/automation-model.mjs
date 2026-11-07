/**
 * External automation, pure (tested in Node: tests/builder-model.test.mjs). A node may carry `automation: { kind: "external", key,
 * data }` (the builder's "Described in the talent's text" template sets it): a name for behaviour the builder can't make, which another
 * module may one day supply. `api.registerAutomation(key, handler)` (experimental) stores a handler under that key. **Nothing invokes
 * handlers in this version**: the registry only records them, and health lists the registered keys and the nodes still waiting on one.
 */
import { AUTOMATION_KEY_RE } from "./builder-model.mjs";

/** At most this many keys are kept. */
export const MAX_AUTOMATIONS = 200;

/** A registry of automation handlers (never invoked in this version). */
export function createAutomationRegistry() {
  /** @type {Map<string, Function>} */ const map = new Map();
  return {
    /**
     * Stores `handler` under `key` (a later call with the same key replaces it). Returns whether it was stored.
     * @param {unknown} key @param {unknown} handler
     */
    register(key, handler) {
      if (typeof key !== "string" || !key.trim() || !AUTOMATION_KEY_RE.test(key.trim()) || typeof handler !== "function") return false;
      const k = key.trim();
      if (!map.has(k) && map.size >= MAX_AUTOMATIONS) return false;
      map.set(k, handler);
      return true;
    },
    /** @param {string} key */
    has: key => map.has(key),
    /** The registered keys, sorted. */
    keys: () => [...map.keys()].sort()
  };
}

/**
 * Nodes that name an automation key: [{ tree, node, key, registered }] (trees as normalized by tree-model).
 * @param {import("./tree-model.mjs").Tree[]} trees @param {(key: string) => boolean} has
 */
export function automationNodes(trees, has) {
  return trees.flatMap(t => t.nodes.filter(n => n.automation?.key).map(n => ({ tree: t.name, node: n.name, key: /** @type {any} */ (n.automation).key, registered: has(/** @type {any} */ (n.automation).key) })));
}

/**
 * Health lines: [{ level, text }] (info only: nothing runs them yet).
 * @param {string[]} keys registered keys @param {ReturnType<typeof automationNodes>} nodes
 */
export function automationLines(keys, nodes) {
  /** @type {{ level: "info", text: string }[]} */ const out = [];
  if (keys.length) out.push({ level: "info", text: `Automation handlers registered (not run in this version): ${keys.slice(0, 20).join(", ")}${keys.length > 20 ? ` and ${keys.length - 20} more` : ""}.` });
  const waiting = nodes.filter(n => !n.registered);
  if (waiting.length) out.push({ level: "info", text: `${waiting.length === 1 ? "A talent names" : `${waiting.length} talents name`} an automation no module has registered: ${waiting.slice(0, 10).map(n => `${n.tree} › ${n.node} (${n.key})`).join(", ")}${waiting.length > 10 ? ", …" : ""}. They grant their text only.` });
  if (!keys.length && !nodes.length) out.push({ level: "info", text: "No talent uses external automation." });
  return out;
}
