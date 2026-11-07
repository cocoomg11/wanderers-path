# My Module

One or two sentences on what this module does for the GM. Works with any game system.

A [Foundry VTT](https://foundryvtt.com) module (v13 and v14). What changed in each version: [CHANGELOG](CHANGELOG.md).

## Contents

- [Quick start](#quick-start)
- [How to use](#how-to-use)
- [Settings](#settings)
- [Public API and hooks](#public-api-and-hooks)
- [Data My Module writes](#data-my-module-writes)
- [Install](#install)
- [Development](#development)
- [License](#license)

## Quick start

1. Install and enable the module in your world (GM).
2. Open the example tool: the note button in the token controls, or `game.modules.get("my-module").api.example.open()`.
3. Turn tools on or off under **Game Settings › My Module** (each switch reloads Foundry).

<!-- screenshot: the example window with two notes -->

## How to use

### Example tool

GM only. A small window to add and read notes. It exists to show the pattern (a switchable tool, a capped and versioned store, a pure model with tests); replace it with the real tools.

<!-- screenshot: the token controls with the note button -->

## Settings

World settings (Game Settings › My Module):

| Setting | Default | Off means |
| --- | --- | --- |
| Feature: Example tool | on | no button, no window, `api.example` is undefined |
| Debug logging | off | (on) the module writes its automatic decisions to the browser console. Not shown in Configure Settings (no control panel yet); set it with `game.settings.set("my-module", "debugLog", true)` |

## Public API and hooks

`const mod = game.modules.get("my-module").api;` (set in our `init` hook).

| Member | | What it does |
| --- | --- | --- |
| `version` | stable | The installed version. |
| `health()` | stable | Read-only report: `[{ title, lines: [{ level, text }] }]`, `level` is `ok`, `warn`, `bad`, `off` or `info`. |
| `cleanup` | stable | `{ plan(), dryRun(), remove(pick, "REMOVE") }`: counts what the module stored; removes the picked categories after the word REMOVE is given (GM). |
| `example` | experimental | `{ open(), notes(), add(text) }` (`add` works from any client through the one-writer leader). Undefined when the feature is off. |
| `isReady` | stable | Whether our ready hook ran. |
| `features` | experimental | The feature registry (`FEATURES`, `on(id)`, `list()`). |

**Hook** `my-module.ready` (stable): fired once, with the api, in our `ready` hook.

Stable members keep their name and shape within a major version; experimental ones may change in any release.

## Data My Module writes

- World settings under `my-module.*`: the feature switches, Debug logging and `exampleNotes` (the example tool's notes, capped at 50).
- Nothing on actors, items, scenes or chat messages.

Removing all of it: `game.modules.get("my-module").api.cleanup` (a dry-run `plan()`, then `remove({ notes: true, settings: true }, "REMOVE")`).

## Install

In Foundry's **Add-on Modules › Install Module**, paste the manifest URL:

`https://github.com/cocoomg11/my-module/releases/latest/download/module.json`

## Development

```
npm install        # once: ESLint and TypeScript for the checks
npm test           # unit tests (Node's built-in runner)
npm run check      # syntax check
npm run lint       # core's shared ESLint config
npm run types      # JSDoc type check
npm run core:verify  # vendored wanderers-core matches its pin
npm run ci         # all of the above
```

Shared code, and the shared window look (core's stylesheet, listed first in `module.json` `styles`; windows carry core's `UI_CLASSES`), come from [wanderers-core](https://github.com/cocoomg11/wanderers-core), vendored in `vendor/wanderers-core/` (never edited by hand; update with `node vendor/wanderers-core/vendor.mjs update X.Y.Z`). Conventions for contributors and agents are in [CLAUDE.md](CLAUDE.md) and core's CONVENTIONS.md.

## License

MIT. See [LICENSE](LICENSE).
