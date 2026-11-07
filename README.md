# Wanderer's Path

Customizable talent trees and spec boards for the dnd5e system in [Foundry VTT](https://foundryvtt.com). The GM builds the boards (the base shape, the nodes, what each node grants); each character spends points on them.

**Status: in development.** Version 0.0.1 is an empty scaffold: it loads and does nothing yet. What changed in each version: [CHANGELOG](CHANGELOG.md).

## No content included

The module is the logic only. It ships with no talent trees, specs or rules text: your boards and their contents live in your own world (or your own world compendium).

## Requirements

- Foundry VTT v13 or v14 (verified on 14.370).
- The dnd5e system (5.0.0 or later; verified on 6.0.6).
- Optional: [Wanderer's Toolkit](https://github.com/cocoomg11/wayfarers-toolkit).

## Install

Not released yet. Once it is, in Foundry's **Add-on Modules › Install Module**, paste the manifest URL:

`https://github.com/cocoomg11/wanderers-path/releases/latest/download/module.json`

## Public API and hooks

`const mod = game.modules.get("wanderers-path").api;` (set in our `init` hook).

| Member | | What it does |
| --- | --- | --- |
| `version` | stable | The installed version. |
| `isReady` | stable | Whether our ready hook ran. |
| `features` | experimental | The feature registry (`FEATURES`, `on(id)`, `list()`). No tools yet. |

**Hook** `wanderers-path.ready` (stable): fired once, with the api, in our `ready` hook.

Stable members keep their name and shape within a major version; experimental ones may change in any release.

## Development

```
npm ci             # once: ESLint and TypeScript for the checks
npm run ci         # syntax check, lint, JSDoc type check, tests, vendored core pin
```

Shared code and the shared window look come from [wanderers-core](https://github.com/cocoomg11/wanderers-core), vendored in `vendor/wanderers-core/` (never edited by hand; update with `node vendor/wanderers-core/vendor.mjs update X.Y.Z`). Conventions for contributors and agents are in [CLAUDE.md](CLAUDE.md).

## License

MIT. See [LICENSE](LICENSE).
