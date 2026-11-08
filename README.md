# Wanderer's Path

Customizable talent trees and spec boards for the dnd5e system in [Foundry VTT](https://foundryvtt.com). The GM builds the boards (the base shape, the nodes, what each node grants); each character spends points on them.

**Status: in development.** Version 0.6.0: the GM tree editor (drop items and effects onto a grid, link requirements, save drafts, publish), the classic tiered talent window, learning and refunds through the GM, the grant engine (learned talents give the character copies of the items or effects their nodes point to; refunds take them back), a Talents page on Wanderer's Toolkit's character sheet, and the feature builder (talent effects and features built from plain-language templates). A later version adds the board layout. What changed in each version: [CHANGELOG](CHANGELOG.md).

## No content included

The module is the logic only. It ships with no talent trees, specs or rules text: your boards and their contents live in your own world (or your own world compendium).

## Requirements

- Foundry VTT v13 or v14 (verified on 14.370).
- The dnd5e system (5.0.0 or later; verified on 6.0.6).
- Optional: [Wanderer's Toolkit](https://github.com/cocoomg11/wayfarers-toolkit).

## Install

Not released yet. Once it is, in Foundry's **Add-on Modules › Install Module**, paste the manifest URL:

`https://github.com/cocoomg11/wanderers-path/releases/latest/download/module.json`

## Setting up a tree

The full guide is **[docs/trees.md](docs/trees.md)**. In short:

1. **Open the tree editor:** **Configure Settings › Wanderer's Path › Open settings › Open the tree editor** (GM).
2. **New tree…**, give it a name. In the tree settings (right, with no talent selected), add the classes or subclasses that get it, picked from your class items.
3. **Add talents:** drag items or active effects (from the editor's search, Foundry's sidebar or any compendium window) onto empty spots of the grid. Each becomes a talent that grants it. Click a talent to edit its ranks, cost, text, requirements and exclusions; **Link mode** draws requirements by clicking. **Build…** on a rank slot makes an effect or feature from a template instead (AC, speed, senses, roll bonuses, advantage, proficiencies, resistances, ability scores, hit points, critical range, extra damage dice, uses per rest, a granted spell, a described feature; X scales with the rank; Foundry 14 and dnd5e 6).
4. **Save draft** keeps your work private (a GM-only journal). **Publish** checks the tree, then writes it to the tree compendium, where players see it. With no compendium chosen yet, Publish offers to create one (*Talent trees*, players: Observer).
5. **Points:** one pool per character, *Points per level* from *First point at level* on (default 1 from level 2: 19 at level 20), plus GM awards. Tiers count points spent in that tree. Learning needs a connected GM.
6. **Respec:** a GM refunds for free (right-click, *Reset tree*, *Free respec*); players only with *Players may refund* on.

Characters open their talents from the sheet's header menu (**Talents**), the *Open talents* key binding (no key by default) or, with Wanderer's Toolkit 2.3.0 or later (its sheet on), the **Talents** bookmark on the toolkit sheet. Writing a tree as data (for scripts) is in the guide's appendix.

## Troubleshooting

Run **Open settings › Health check** (or the check in the Wanderer's Satchel). Lines that can be fixed safely have a **Fix** button (*Refresh granted items*, *Refund orphans*); after you confirm, the fix runs on the GM client that applies changes and the check runs again. The table in [docs/trees.md](docs/trees.md#troubleshooting) says what each line means and what to do.

- **Players see no trees:** the tree must be published (a draft is GM only), the compendium's Player ownership must be Observer, *Offered to characters* on, and the tree's classes must include the character's class identifier (or add the tree by hand).
- **Learn does nothing:** a GM must be connected.
- **Granted items didn't change after editing a source:** click *Refresh granted items*.
- **Remove everything:** **Open settings › Remove Wanderer's Path data** (picks, granted items and effects, the tree drafts journal, settings; your tree compendium is never deleted).

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
| `refresh(actor?)` | experimental | GM: makes granted items and effects match the learned talents again, re-copying those whose source changed (Actor, id or UUID; none or `"all"`: every character). Returns whether the request was sent. Undefined when Talents is off. |
| `healthReport({ timeoutMs })` | experimental | Promise of the read-only health report `[{ title, lines: [{ level, text, fix? }] }]` (GM; players get `[]`). `timeoutMs` is the per-section limit (1 s – 5 min, default 20 s). A `fix` is core's `{ label, confirm, run }`; `run()` resolves once the GM client that applies changes has finished (or after 30 s). |
| `cleanup` | experimental | GM (players get a warning and null): `plan()`, `dryRun()`, `remove(pick, "REMOVE")` (picks, granted items and effects, drafts, settings; the tree compendium is never deleted). |
| `settings()` | experimental | GM: opens the Settings window. |
| `builder` | experimental | The feature builder (feature *Feature builder*; undefined when off): `templates()` lists the templates as plain data (`{ id, label, hint, scales, range, itemOnly, params }`; `itemOnly` templates make a feature item only); `preview(spec, rank?, maxRanks?)` returns `{ ok, issues, text, line, changes, spec }` for a spec `{ template, params, base, step }` (X = base + step × (rank − 1)); `open(treeId?, nodeId?, slot?)` (GM) opens the tree editor there, and with a talent the builder on its rank slot (default 1). |
| `editor` | experimental | The tree editor (feature *Tree editor*; undefined when off): `open(treeId?)` (GM) opens it, at that tree; `drafts()` (GM; players get a warning and null) resolves to every published tree and draft: `[{ id, name, state, label, stale, published, draft }]` (`state`: `"published"`, `"new"`, `"same"` or `"differs"`). |
| `registerAutomation(key, handler)` | experimental | Stores a function for the automation key that talents name (`automation: { kind: "external", key, data }` on a node, set by *Described in the talent's text*). Keys: letters, digits, `.`, `-`, `_` (up to 100); the same key again replaces the handler. Returns whether it was stored. **Nothing invokes handlers in this version** (the call shape is not decided); the health report lists registered keys and talents waiting on one. Undefined when Talents is off. |

**Hooks** (fired on every client, by the GM's client that saved the change):

- `wanderers-path.ready` (stable): fired once, with the api, in our `ready` hook.
- `wanderers-path.learned` (experimental): `{ actorId, userId, changes: [{ tree, node, from, to }] }` after a Learn is saved. Only with *Hooks for other modules* on.
- `wanderers-path.respec` (experimental): `{ actorId, userId, tree, removed: [{ tree, node, from, to }] }` after a refund or respec is saved (`tree` null = every tree, also after *Refund orphans*). Only with *Hooks for other modules* on.

Internal (not for other modules): `wanderers-path.notice` (a notice for one user) and `wanderers-path.done` (`{ ticket }`, the leader's answer once a Refresh / Refund orphans health fix has finished).

Stable members keep their name and shape within a major version; experimental ones may change in any release.

## Development

```
npm ci             # once: ESLint and TypeScript for the checks
npm run ci         # syntax check, lint, JSDoc type check, tests, vendored core pin
```

Shared code and the shared window look come from [wanderers-core](https://github.com/cocoomg11/wanderers-core), vendored in `vendor/wanderers-core/` (never edited by hand; update with `node vendor/wanderers-core/vendor.mjs update X.Y.Z`). Conventions for contributors and agents are in [CLAUDE.md](CLAUDE.md).

## License

MIT. See [LICENSE](LICENSE).
