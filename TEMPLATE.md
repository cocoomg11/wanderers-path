# New module from this template

Checklist for starting a Foundry module from `wanderers-module-template`. This file stays in the new repo until you have finished it; then delete it (`git rm TEMPLATE.md`).

## Part A: rename (once, right after "Use this template")

1. On GitHub: **Use this template › Create a new repository**. Owner `cocoomg11`, name = the module id (lowercase, hyphens, for example `loot-ledger`). Public if it will be released; the repo name must equal the module id because the manifest and download URLs are built from it.
2. Clone it and open a terminal in the folder.
3. Pick the module id, the title and a short CSS prefix, then run (replace the values):

   ```
   node tools/init-module.mjs --id loot-ledger --title "Loot Ledger" --prefix ll --description "One sentence for module.json and the README."
   ```

   `--prefix` (2 to 6 letters) is optional; the default is the initials of the id's words. Add `--dry-run` first to see what would change. The script:
   - replaces `my-module` (id), `My Module` (title), `tpl-` (CSS class prefix) and `myModule` (camelCase of the id) in every file;
   - renames `styles/my-module.css` to `styles/<id>.css`;
   - deletes itself and `tests/init-module.test.mjs`.
   It does not touch this file.
4. By hand: check `module.json` (`description`, the `url`/`manifest`/`download`/`bugs` links now name your repo), the README intro and first sentence of `CLAUDE.md`, and delete or reshape the example tool (`scripts/example.mjs`, `scripts/example-model.mjs`, `tests/example.test.mjs`, the example feature, rows and request in `scripts/core.mjs`, the button in `scripts/main.mjs`, the `exampleNotes` setting and the lines in `health.mjs`, `cleanup.mjs`, README and CHANGELOG).
5. System-specific module? Add to `module.json` (verify the version you use against the system's repo; for dnd5e, https://github.com/foundryvtt/dnd5e):

   ```json
   "relationships": { "systems": [{ "id": "dnd5e", "type": "system", "compatibility": { "minimum": "5.0.0", "verified": "6.0.6" } }] }
   ```

   Optional integrations go in `relationships.recommends`, never `requires`. By default the module is system-agnostic.
6. Do Part B now (nothing runs before core is vendored), then commit (author `cocoomg11 <cocoomg11@users.noreply.github.com>`) and push to `main`.

## Part B: Adopt core (wanderers-core)

`wanderers-core` (https://github.com/cocoomg11/wanderers-core) is not a Foundry module. Each module vendors a pinned copy into `vendor/wanderers-core/` and ships its runtime in its own zip (the release zip leaves out core's `config/` and `vendor.mjs`, which Foundry never loads; the folder in the repo stays complete); a lock file (`wanderers-core.lock.json`: version, content hash, source) pins it, and CI fails if the copy differs from the pin. The template's `scripts/` already import from `../vendor/wanderers-core/`, so **nothing runs until this part is done** (tests, lint and type check all need the vendored copy). Never edit `vendor/` by hand.

1. **Vendor core** (from the module's root folder, Node 22):
   - With core published as a GitHub release (0.3.1 or later): with a clone of core next to the module,

     ```
     node ../wanderers-core/tools/vendor.mjs install 0.3.1
     ```

   - Before that (core is not released yet): pin the local clone instead,

     ```
     node ../wanderers-core/tools/vendor.mjs install --from ../wanderers-core
     ```

     The lock then says `"source": "local"`. CI passes with a warning, and the reusable workflow in `test.yml` (pinned `@v0.3.1`) cannot start until the `v0.3.1` tag exists in the core repo. Replace the local pin with the release (`node vendor/wanderers-core/vendor.mjs update 0.3.1`) before the module's first release.

   Either way this writes `vendor/wanderers-core/` and `wanderers-core.lock.json`. Commit both together.
2. **Install the dev tools and run the checks** (they use core's shared ESLint and type-check configs):

   ```
   npm install
   npm run ci
   ```

   `npm run ci` = `check`, `lint`, `types` (also `npm run typecheck`), `test` and `core:verify`. Commit the generated `package-lock.json`.
3. **Read** core's `CONVENTIONS.md` (house practices, shared by every module) and `STABILITY.md` (semver and the stable/experimental policy). `CLAUDE.md` in this repo only adds what is specific to the module.
4. **Bind core to the module** in `scripts/core.mjs` (the one place that calls `createFeatures`, `createSettings`, `createLogger`, `createLeader`): replace the example feature, settings rows and socket request with the real ones. Automatic document writes run only when `leader.isLeader()`; players send choices with `leader.request(kind, data)` against a schema in `REQUESTS`.
5. **Updating core later:** `node vendor/wanderers-core/vendor.mjs update X.Y.Z`, read core's CHANGELOG, run `npm run ci`, commit `vendor/` with the lock. Dependabot bumps the `@vX.Y.Z` of the reusable workflow in `test.yml`; keep it equal to the pinned core version.
6. **Branch protection** (optional, user): require the check `checks / Core pin, lint, types and tests`; see core's `docs/branch-protection.md`.
7. Delete this file.

## Later, for every release

See `CLAUDE.md`, "Release process". In short: bump `module.json`, add a CHANGELOG section with an "Untested in Foundry" list, push to `main`, then publish a GitHub release tagged `vMAJOR.MINOR.PATCH` (for example `v0.1.0`) yourself. Agents never tag or publish.
