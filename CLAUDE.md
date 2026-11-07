# CLAUDE.md: My Module

Foundry VTT module (v13 minimum, verified v14 build 369; any game system): ONE SENTENCE ON WHAT IT DOES. Logic only; campaign content stays in each world. Public repo, MIT.

> Seeded from the private `wanderers-module-template` (finish TEMPLATE.md first). Keep this file current: it is the first thing an agent reads. Replace the example tool's lines as you replace the tool.

## File map (`scripts/`)
- `main.mjs` entry: settings (`init`), hooks and buttons gated by `F.on(...)`, the API (`game.modules.get("my-module").api`, set in `init`), `leader.start()` and request handlers in `ready`, hook `my-module.ready`; registers with the Wanderer's Satchel hub when it is installed.
- `const.mjs` module id, title, hook names; re-exports `esc`/`plural` from core. The id lives only here (and module.json).
- `core.mjs` the one place that binds the vendored wanderers-core to this module: `F` (feature registry), `S` (settings table), `log`/`warn`, `REQUESTS` (socket schemas) and `leader` (one-writer election). Other files import these, never core's Foundry halves directly (except `cleanup.mjs` helpers).
- `example.mjs` / `example-model.mjs` the example tool (a GM notes window; a leader handler) / its pure model (core's `versioned` and `addCapped`). Replace with the real tools.
- `health.mjs` read-only health check on core's `healthCollector`, `api.health()`.
- `cleanup.mjs` "Remove module data": `CATEGORIES`, `plan()`, dry run, `remove(pick, "REMOVE")` on core's cleanup helpers.
- `vendor/wanderers-core/` vendored core, never edited by hand; `wanderers-core.lock.json` its pin (version, hash, source).
- `styles/my-module.css` (window class `tpl-window`; the module's own rules only, the shared look comes from core's `vendor/wanderers-core/styles/wanderers-ui.css`, listed first in `module.json` `styles`), `lang/en.json` (empty: strings are plain English in code).
- `eslint.config.mjs` and `tsconfig.json` extend core's shared configs. `tools/init-module.mjs` one-time rename script (deletes itself).

## Key patterns
- **Core conventions:** read core's CONVENTIONS.md and STABILITY.md (https://github.com/cocoomg11/wanderers-core); they are not repeated here. Only what is specific to this module is below.
- **Feature registry** (`F` in `core.mjs`): a turned-off tool registers no hooks, buttons, key bindings or socket handlers; its API getter returns undefined. Gate registration with `on("<id>")`, API entry points with `need("<id>")`.
- **Settings keys are stable** across versions (never rename). A new setting is a row in `S` (`core.mjs`), not a loose submenu.
- **Pure logic** lives in `*-model.mjs` files with no Foundry calls at import time, so Node can test it. UI, hooks, sockets and documents live in the other files.
- **Stored shapes are versioned:** a shape that has changed, or likely will, carries `v` and is read through one normalizer; every list-like store has a cap and a test. No migrations without something to migrate.
- **Health check** never throws and never changes anything; add a line when adding a feature with setup needs.
- **Cleanup covers everything we write:** a new flag, setting, status effect, folder or document must be found by `cleanup.mjs` `plan()`, removed by `remove()` and listed in `CATEGORIES`.
- **One writer:** anything that writes documents automatically runs only when `leader.isLeader()`; other clients (GM tabs, players) call `leader.request(kind, data)` with a schema in `REQUESTS`; the handler checks the sending user's rights (the user core passes, never a payload field).
- **Hot hooks** (`updateActor`, `updateToken`, `updateItem`, `renderChatMessageHTML`, canvas and refresh hooks) bail out in their first lines when the change is irrelevant (`foundry.utils.hasProperty(changes, …)`, our flag, whether the UI is showing) before any loop.
- Flags live only under `flags.my-module.*`, settings only under `my-module.*`. We never write another module's flags except through its API.
- Windows are ApplicationV2 with the `tpl-window` class and core's `...UI_CLASSES` (never a literal `wc-r<N>`); markup uses core's `wc-*` classes and helpers (`badge`, `icon`, `dot`, `statusLine`, `navItem`), see core's `docs/ui.md`; module CSS holds only what is specific to the module. Moving core means a new stylesheet revision: check the windows live in both themes. Backdrop blur is disabled on purpose: it tanks FPS in v14.
- **Docs:** README *Public API and hooks* lists every `api.*` entry and every hook we fire, each marked stable or experimental. Update it with any change.

## Tests
- `npm test` = `node --test tests/*.test.mjs`; `npm run check` syntax-checks scripts, tests and tools; `npm run lint` (ESLint, core's shared config); `npm run types` (JSDoc checked by `tsc`; `typecheck` is an alias); `npm run core:verify` (vendored core matches its pin); `npm run ci` runs all. CI calls core's reusable `module-checks.yml` pinned to a core release tag (`test.yml`); the Release workflow runs the checks and the pin check again.
- Pure and tested: the example model; `tests/core.test.mjs` imports `core.mjs`, so a bad feature, setting or request definition fails in CI. Add a test file per pure model.
- Not testable in Node: hooks, sockets, ApplicationV2 windows, document writes, chat cards. List what is untested in the changelog's live checklist.
- Install dev tools once with `npm install` (commit `package-lock.json`); the module itself has no install step. Move to a newer core with `node vendor/wanderers-core/vendor.mjs update X.Y.Z`, then test and commit `vendor/` with the lock.

## Release process
1. Bump `version` in `module.json` and the `download` URL (`.../releases/download/vX.Y.Z/module.zip`); the manifest URL stays `https://github.com/cocoomg11/my-module/releases/latest/download/module.json`.
2. Add a `CHANGELOG.md` section with an "Untested in Foundry" checklist.
3. Commit and push to main. **Agents never tag or publish.** The user publishes the GitHub release with a tag `vMAJOR.MINOR.PATCH` only (`v0.1.0`; never `0.1` or `v0.1`); the Release workflow fails early on anything else, runs the checks, sets version and URLs from the tag and uploads `module.json` + `module.zip` (`module.json scripts styles lang vendor README.md CHANGELOG.md LICENSE`, with `vendor/wanderers-core/config/` and `vendor/wanderers-core/vendor.mjs` excluded: Foundry never loads them, and the committed `vendor/` stays complete for the pin check). A new top-level folder must be added to the zip step. The Release workflow also runs `vendor.mjs verify --remote`: pin a published core version, not a local one, before releasing.
4. Keep `compatibility` honest: minimum 13, verified = newest Foundry build checked live, no maximum unless something is known to break. System relationships (`relationships.systems`) only when the module needs one; optional modules go in `relationships.recommends`, never `requires`.
5. End each release with a live checklist: what was not run in Foundry and needs checking in a live world.

## Rules
- Public repo: no campaign names, no game-publisher wording in user-facing text, no private details (IPs, domains, local paths). Use generic wording.
- No official non-SRD rules text. Never use 5etools or other unofficial rules sites; SRD 5.2 only. Verify Foundry APIs at foundryvtt.com/api and dnd5e at github.com/foundryvtt/dnd5e; do not guess an API.
- Every feature toggleable; strings plain English in code (`lang/en.json` stays empty). Do not put macros on hotbars automatically.
- Commit author `cocoomg11 <cocoomg11@users.noreply.github.com>`; end commit messages with the attribution trailers given by the session.
- Another agent may be committing to main: `git fetch origin main` and rebase before pushing.
