# Changelog

All notable changes to Wanderer's Path. Versions follow the `version` in `module.json`.

## 0.1.0

First tools: talent trees from your own compendium, the classic tiered talent window, learning and refunds through the GM. Nothing is granted to the character yet (that comes with the grant engine in a later version). Compatibility stays at Foundry v13 minimum: nothing here needs a v14-only API (v14's deletion operator is used when it exists, else the v13 `-=` key).

- **Trees** are read from a world Journal Entry compendium you choose (setting *Tree compendium*), one entry per tree with its data in `flags.wanderers-path.tree`. Loaded with one index read, cached, and re-read when the compendium or one of its entries changes. A tree is checked by one normalizer (ranks 1 to 5, bad references dropped, exclusions mirrored both ways).
- **Talent window** (layout 1A, a classic tiered tree): spec tabs, tiers that open at 5 points in the tree (per tree), prerequisite arrows, rank counters, points available and spent, tooltips. Clicks are a preview until **Learn**; right-click takes a new rank back. Trees with the board layout show "Board view coming soon".
- **Points:** 1 per level from level 2 (19 at level 20), plus GM awards with a reason. Settings *First point at level*, *Points per level*.
- **Which trees:** by class and subclass identifier, plus trees a GM adds or removes per character. *Talents for every character* (on), a per-character switch, *Talents open at level* (1; a tree may set its own).
- **Learning** goes through the connected GM (core's one-writer leader): the GM's client checks ownership and every rule before it writes `flags.wanderers-path.picks`. Without a GM, Learn waits.
- **Refunds:** players refund only with *Players may refund* on (honour system, off by default); a GM always refunds for free. Refunding a talent refunds the talents that need it.
- **GM tools** in the window: award points (with a reason), talents on / off / world setting for the character, add / remove / automatic trees, free respec.
- **Entry points:** a Talents entry in the dnd5e character sheet's header menu (feature *Character sheet button*), the *Open talents* key binding (no default key), `api.open(actor)`.
- **Settings window** (Configure Settings › Wanderer's Path, and the Satchel's Settings button): the rules, the health check and Remove Wanderer's Path data (picks and settings; your tree compendium is listed but never deleted).
- **Health check** (`api.healthReport({ timeoutMs })`, GM; `[]` for players): tree compendium chosen / found / readable by players, published trees, tree issues (missing documents, cycles, impossible gates, tiers too high), characters with points in unpublished trees or overspent, learning needs a GM.
- **Wanderer's Satchel:** registers itself (Open = the selected character's talents, Settings, health, debug switch).
- **Hooks** `wanderers-path.learned` and `wanderers-path.respec` (ids only, after the save; feature *Hooks for other modules*).
- API: `open`, `trees`, `points`, `healthReport`, `cleanup`, `settings`.

### Untested in Foundry

- [ ] The module loads in v13 and v14 with dnd5e, no console errors; with Talents off, no sheet button, no key binding, `api.open` is undefined.
- [ ] Settings window: Configure Settings › Wanderer's Path › Open settings; the tree compendium list shows world Journal Entry compendiums; Save keeps the values.
- [ ] A JournalEntry in that compendium with `flags.wanderers-path.tree` (a placeholder tree, `assign.classes` = a class identifier on a test character) shows up; editing or deleting the entry refreshes an open window.
- [ ] Player with Observer on the compendium sees the tree; with None, the health check warns.
- [ ] dnd5e character sheet header menu has Talents; it opens the window for that character. The key binding (set a key in Configure Controls) opens the player's own character, and the GM's selected token's character; a second press closes it.
- [ ] Window: tabs switch trees; tier labels light up; arrows turn gold when met; locked nodes are grey with the reason in the tooltip; clicks add pending ranks (dashed outline); right-click takes them back (and dependants in the preview); Undo changes clears them.
- [ ] Learn as a player with a GM connected: the picks flag is written by the GM's client, the player gets "learned" and the window updates; with no GM connected the button is disabled and says so. A second GM tab doesn't write twice.
- [ ] A player can't learn for a character they don't own (request refused), can't overspend, can't learn past a tier or prerequisite (the GM's check refuses even if the client is bypassed).
- [ ] Refunds: with *Players may refund* off, players see no Reset tree and right-click on learned ranks does nothing; on, right-click refunds one rank (with dependants) and Reset tree refunds the tree. A GM always can.
- [ ] GM tools: Award points (positive and negative, with reason) changes Available; the enable select (World / On / Off) hides and shows the trees; Add / Remove / Automatic trees; Free respec empties every tree including unpublished ones.
- [ ] Changing a character's level or class refreshes the open window (points and trees).
- [ ] With *Hooks for other modules* on, `wanderers-path.learned` / `wanderers-path.respec` fire on every client after the save, with ids only; off, they don't.
- [ ] Health check (Settings window, and `await game.modules.get("wanderers-path").api.healthReport()`): lines for the pack, tree count, issues, orphan picks; `[]` for a player.
- [ ] Remove data: dry run counts characters with picks; REMOVE strips only our flags; the settings category resets settings and reloads; the tree compendium stays.
- [ ] Wanderer's Satchel (0.7.2): Wanderer's Path shows as registered (not the built-in adapter); Open opens the selected token's character's talents (none selected: our Settings window); Settings opens our Settings window; its health runs our report; its Debug logging switch toggles ours.
- [ ] Tooltips show HTML (name, rank, text, requirement in red); the window looks right in both the light and dark UI themes.

## 0.0.1

Repository scaffold. No tools yet; not released.

- Module manifest (Foundry v13 to v14.370, dnd5e 5.0.0 to 6.0.6; recommends Wanderer's Toolkit).
- wanderers-core 0.6.0 vendored and pinned (`wanderers-core.lock.json`); shared stylesheet listed first.
- Entry point registers the Debug logging setting and the API (`version`, `isReady`, `features`) and fires `wanderers-path.ready`.
- CI: core's module checks (pin, syntax, lint, types, tests); Release workflow (tag `vX.Y.Z`, build and upload jobs).

### Untested in Foundry

- [ ] The module loads in v13 and v14 with dnd5e and logs no console errors.
- [ ] With Debug logging on (`game.settings.set("wanderers-path", "debugLog", true)`, reload), the console shows the init and ready lines.
- [ ] `game.modules.get("wanderers-path").api.isReady` is true after load.
