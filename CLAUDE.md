# CLAUDE.md: Wanderer's Path

Foundry VTT module (v13 minimum, verified v14 build 370; dnd5e): customizable talent trees and spec boards. The GM sets up a base board, its nodes and what they grant; each character has their own board and spends points on it. Logic only: the module ships with **no talent content**; boards and their contents live in the user's own world (a private world compendium). Public repo, MIT.

Status: 0.0.1 scaffold (no tools yet). A build plan is written separately; follow it for the first features.

## File map
- `scripts/main.mjs` entry: settings (`init`), the API (`game.modules.get("wanderers-path").api`, set in `init`), hook `wanderers-path.ready` (fired once in `ready`). Hooks and buttons are gated by `F.on(...)`.
- `scripts/const.mjs` module id, title, hook names; re-exports `esc`/`plural` from core. The id lives only here (and module.json).
- `scripts/core.mjs` the one place that binds the vendored wanderers-core: `F` (feature registry, empty so far), `S` (settings table: `debugLog`), `log`/`warn` (core `createLogger`; `log` prints only with Debug logging on). Add core's `createLeader` (one-writer election, `REQUESTS` socket schemas) here with the first tool that writes automatically or takes player requests.
- `vendor/wanderers-core/` vendored core 0.6.0, never edited by hand; `wanderers-core.lock.json` its pin (version, hash, source: release).
- `styles/wanderers-path.css` (window class `wp-window`, CSS prefix `wp-`; module rules only, the shared look is core's `vendor/wanderers-core/styles/wanderers-ui.css`, listed first in `module.json` `styles`). `lang/en.json` stays empty (strings are plain English in code).
- `tests/*.test.mjs` Node tests; `types/globals.d.ts` extra Foundry globals for the type check; `eslint.config.mjs` / `tsconfig.json` extend core's shared configs.

## Key patterns to follow
- **Core conventions:** read core's CONVENTIONS.md and STABILITY.md (https://github.com/cocoomg11/wanderers-core). Copy patterns from Wanderer's Toolkit (`cocoomg11/wayfarers-toolkit`) rather than inventing.
- **Feature registry** (`F`): every tool is a feature; a turned-off tool registers no hooks, buttons, key bindings or socket handlers and its API getter returns undefined. Gate registration with `F.on("<id>")`, API entry points with `F.need("<id>")`.
- **Settings keys are stable** (never rename). A new setting is a row in `S` (`core.mjs`).
- **Pure logic** lives in `*-model.mjs` files with no Foundry calls at import time, so Node can test it. UI, hooks, sockets and documents live in the other files.
- **Stored shapes are versioned** (`v`, one normalizer, core's `versioned`); every list-like store has a cap (core's `addCapped`) and a test.
- **One writer:** automatic document writes run only when `leader.isLeader()`; players send choices with `leader.request(kind, data)` against a schema; the handler checks the sending user's rights (never a payload field).
- **Health and cleanup** (add with the first stored data, as in the template and the toolkit): `health.mjs` on core's `healthCollector` (never throws, never writes) and `cleanup.mjs` (`CATEGORIES`, `plan()`, `remove(pick, "REMOVE")`) covering every flag, setting and document we write.
- Windows are ApplicationV2 with `wp-window` plus core's `...UI_CLASSES` (never a literal `wc-r<N>`); markup uses core's `wc-*` classes (core `docs/ui.md`). No backdrop blur.
- Flags only under `flags.wanderers-path.*`, settings only under `wanderers-path.*`. Talk to Wanderer's Toolkit only through its public API (`api.sheet`, `wayfarers-toolkit.sheetReady`), and only when it is active (it is a recommends, not a requires).

## House practices
- **CI:** `test.yml` calls core's `module-checks.yml@v0.6.0` (types on: keep `npm run types` at zero errors; new code gets JSDoc types). Keep the `@vX.Y.Z` equal to the vendored core version. `release.yml` = read-only build job + upload job (only writer), actions pinned by SHA, `npm ci` from the committed `package-lock.json` (lockfileVersion 3; regenerate with `npm install --package-lock-only --ignore-scripts` when dev dependencies change).
- **Tests:** `npm run ci` = `check`, `lint`, `types`, `test`, `core:verify`. Hooks, sockets, windows and document writes are not testable in Node: list them in the changelog's live checklist.
- **Compatibility:** `module.json` `compatibility` minimum 13, verified = newest Foundry checked live, no maximum; dnd5e `relationships.systems` (`minimum` 5.0.0, `verified` 6.0.6 = last checked live). Optional modules go in `relationships.recommends`, never `requires`.
- **Hot hooks** (`updateActor`, `updateItem`, render and canvas hooks) bail out in their first lines when the change is irrelevant.
- **Docs:** README *Public API and hooks* lists every `api.*` entry and every hook we fire, marked stable or experimental. Update it with any change.
- **Updating core:** `node vendor/wanderers-core/vendor.mjs update X.Y.Z` (behind the agent proxy: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`), read core's CHANGELOG, run `npm run ci`, commit `vendor/` with the lock and bump `test.yml`.

## Release process
1. Bump `version` in `module.json` and the `download` URL (`.../releases/download/vX.Y.Z/module.zip`); the manifest URL stays `https://github.com/cocoomg11/wanderers-path/releases/latest/download/module.json`.
2. Add a `CHANGELOG.md` section `## X.Y.Z` with an "Untested in Foundry" checklist (the Release workflow fails without the section).
3. Commit and push to main. **Agents never tag or publish.** The user publishes the GitHub release tagged `vMAJOR.MINOR.PATCH` only (`v0.1.0`; never `0.1` or `v0.1`). The workflow checks the tag, the core pin (`verify --remote`) and the checks, sets version and URLs from the tag, and uploads `module.json` + `module.zip` (`module.json scripts styles lang vendor README.md CHANGELOG.md LICENSE`, minus `vendor/wanderers-core/config/`, `testing/` and `vendor.mjs`). A new top-level folder referenced by `module.json` must be added to the zip step.

## Rules
- Public repo: no campaign names, no game-publisher (WoW/Blizzard) wording in user-facing text, code, docs or commit messages, no private details (IPs, domains, local paths). Use generic wording ("classic MMO", "talent tree", "spec").
- **No talent content in the module:** no trees, specs, class or talent names, or rules text ship here. Content lives in the user's private world compendium; examples in tests and docs are generic placeholders.
- No official non-SRD rules text. SRD 5.2 only; never 5etools or other unofficial rules sites. Verify Foundry APIs at foundryvtt.com/api and dnd5e at github.com/foundryvtt/dnd5e; do not guess an API.
- Every feature toggleable; strings plain English in code (`lang/en.json` stays empty). Do not put macros on hotbars automatically.
- Commit author `cocoomg11 <cocoomg11@users.noreply.github.com>`; end commit messages with the attribution trailers given by the session.
- Another agent may be committing to main: `git fetch origin main` and rebase before pushing.
