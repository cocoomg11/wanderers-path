# Wanderer's Path

Customizable talent trees and spec boards for the dnd5e system in [Foundry VTT](https://foundryvtt.com). The GM builds the boards (the base shape, the nodes, what each node grants); each character spends points on them.

**Status: in development.** Version 0.1.0: trees from your compendium, the classic tiered talent window, learning and refunds through the GM. Nothing is granted to the character yet (a later version adds the grant engine, the tree editor, the board layout and a Wanderer's Toolkit sheet page). What changed in each version: [CHANGELOG](CHANGELOG.md).

## No content included

The module is the logic only. It ships with no talent trees, specs or rules text: your boards and their contents live in your own world (or your own world compendium).

## Requirements

- Foundry VTT v13 or v14 (verified on 14.370).
- The dnd5e system (5.0.0 or later; verified on 6.0.6).
- Optional: [Wanderer's Toolkit](https://github.com/cocoomg11/wayfarers-toolkit).

## Install

Not released yet. Once it is, in Foundry's **Add-on Modules › Install Module**, paste the manifest URL:

`https://github.com/cocoomg11/wanderers-path/releases/latest/download/module.json`

## Setting up (0.1.0)

1. Create a world compendium of **Journal Entries** (e.g. "Talent trees"), set its Player ownership to **Observer**, and choose it in **Configure Settings › Wanderer's Path › Open settings › Tree compendium**.
2. Each tree is one Journal Entry with its data in the flag `flags.wanderers-path.tree` (the editor comes in a later version). Shape: `{ v: 1, id, name, layout: "tiered", assign: { classes: ["<class identifier>"], subclasses: [] }, unlockLevel, tiered: { columns: 3, tierSize: 5 }, nodes: [{ id, name, text, tier, col, maxRanks, prereqs: [{ node, ranks }], gate: { level }, excludes: [] }] }`.
3. Characters open their talents from the sheet's header menu (Talents) or the *Open talents* key binding.

## Public API and hooks

`const mod = game.modules.get("wanderers-path").api;` (set in our `init` hook).

| Member | | What it does |
| --- | --- | --- |
| `version` | stable | The installed version. |
| `isReady` | stable | Whether our ready hook ran. |
| `features` | experimental | The feature registry (`FEATURES`, `on(id)`, `list()`). |
| `open(actor?)` | experimental | Opens a character's talent window (Actor, id or UUID; default: your character or the selected token's). Undefined when Talents is off. |
| `trees()` | experimental | Promise of the published trees (copies, normalized). Undefined when Talents is off. |
| `points(actor)` | experimental | Promise of `{ level, fromLevel, awards, total, spent, available, byTree }`, or null when you can't view the actor. Undefined when Talents is off. |
| `healthReport({ timeoutMs })` | experimental | Promise of the read-only health report `[{ title, lines: [{ level, text }] }]` (GM; players get `[]`). |
| `cleanup` | experimental | GM: `plan()`, `dryRun()`, `remove(pick, "REMOVE")` (picks and settings; the tree compendium is never deleted). |
| `settings()` | experimental | GM: opens the Settings window. |

**Hooks** (fired on every client, by the GM's client that saved the change):

- `wanderers-path.ready` (stable): fired once, with the api, in our `ready` hook.
- `wanderers-path.learned` (experimental): `{ actorId, userId, changes: [{ tree, node, from, to }] }` after a Learn is saved. Only with *Hooks for other modules* on.
- `wanderers-path.respec` (experimental): `{ actorId, userId, tree, removed: [{ tree, node, from, to }] }` after a refund or respec is saved (`tree` null = every tree). Only with *Hooks for other modules* on.

Stable members keep their name and shape within a major version; experimental ones may change in any release.

## Development

```
npm ci             # once: ESLint and TypeScript for the checks
npm run ci         # syntax check, lint, JSDoc type check, tests, vendored core pin
```

Shared code and the shared window look come from [wanderers-core](https://github.com/cocoomg11/wanderers-core), vendored in `vendor/wanderers-core/` (never edited by hand; update with `node vendor/wanderers-core/vendor.mjs update X.Y.Z`). Conventions for contributors and agents are in [CLAUDE.md](CLAUDE.md).

## License

MIT. See [LICENSE](LICENSE).
