# Changelog

All notable changes to Wanderer's Path. Versions follow the `version` in `module.json`.

## 0.3.0

A Talents page on Wanderer's Toolkit's character sheet, and part A of the feature builder: talents can now grant effects built from plain-language templates, whose values scale with the rank.

- **Toolkit sheet page** (feature *Toolkit sheet page*, Wanderer's Toolkit 2.3.0+ with its character sheet on; still a `recommends`): page `wanderers-path.talents`, *Talents*, between Reputation and Bastion (order 77), shown for characters with talents on and a tree assigned. It shows points available and spent, points per tree (click a tree to preview it), a small preview of the tree (learned, open and locked talents), *Active from talents* (built effects read as "+2 AC"), the five latest log lines and *Open full window*. Registered on `wayfarers-toolkit.sheetReady`, or at our ready when the toolkit's `api.sheet` is already there; registered again (a replace) when the trees change so the bookmark follows. Health: one line for the page.
- **Feature builder, part A** (feature *Feature builder*): a rank slot can hold `{ built: { template, params, base, step } }` instead of a UUID. X = base + step × (rank − 1). Templates: Armor Class bonus, speed bonus by kind, darkvision and other senses (range upgrade), bonus to a skill / an ability's checks or saves / all skills, checks or saves / initiative, advantage (an ability's saves or checks, a skill, initiative), proficiency or expertise (skills, saving throws, tools, weapons, armor, languages), resistance / immunity / vulnerability to a damage type and condition immunity, ability score bonus, extra hit points (per level or in total), wider weapon critical range. Each has a validator and a preview line ("+X AC per rank: 1 / 2 / 3"). Every key was checked against dnd5e 6.0.6's data models (no legacy keys dnd5e shims); changes use Foundry 14's `{ key, type, value, phase: "initial" }` in `system.changes`.
- **Grant engine:** built slots grant a tagged Active Effect (grant mode "effect") or a feat item carrying one transfer effect (mode "item"), named after the talent. `src` = `built:<hash of the spec>` (another spec replaces the copy); a rank change in "scale" mode rewrites the effect's values in place (same copy); Refresh re-builds a copy whose talent name, image or text changed. Built grants need Foundry 14 and dnd5e 6; elsewhere they grant nothing (health says so).
- **Build a talent effect** (GM; Settings window, `api.builder.open()`): until the tree editor exists, this writes a built spec into a node's rank slot in the tree compendium (the tree's `flags.wanderers-path.tree`).
- API: `builder.templates()`, `builder.preview(spec, rank, maxRanks)`, `builder.open()`. Health: built specs that don't validate, built talents in a world that can't run them.

### Untested in Foundry

- [ ] Toolkit 2.3+ active, sheet on: a character with an assigned tree shows the Talents bookmark after Reputation; one without a tree (or with talents off) doesn't; publishing or assigning a tree makes it appear without a reload.
- [ ] The page draws inside the toolkit's dark sheet in light and dark Foundry themes; the mini tree matches the window's learned / open / locked states; tooltips on the mini cells show name and rank.
- [ ] Clicking a tree name on the page switches the preview; *Open full window* opens our window; nothing on the page triggers the toolkit's own `data-action` buttons; Enter does nothing odd.
- [ ] Learn in the window: the page's points, active list and log update (the toolkit redraws on the actor change).
- [ ] Toolkit missing / inactive / sheet off: no errors; health shows the info line. The toolkit loading after us: registered on `sheetReady`.
- [ ] Settings › Build a talent effect: pick tree, talent, slot, mode, template; the preview and the fields follow each change; Save writes the slot (check the journal flag) and is disabled for an invalid spec or a locked compendium.
- [ ] A built "+X AC" effect (scale, 3 ranks, X 1/2/3): Learn rank 1 → effect "Talent name" on the actor, AC +1; rank 2 → same effect id, AC +2; refund → effect gone.
- [ ] Each template live on a dnd5e 6.0.6 character: speed (walk and fly), darkvision upgrade (a longer racial range stays), skill / check / save / all-skills / initiative bonus shows in the roll, advantage on a save / skill / initiative (roll dialog defaults to advantage), skill expertise and save / tool proficiency, weapon / armor / language trait added, resistance / immunity / vulnerability / condition immunity on the sheet, ability score +X, HP per level and overall, crit on 19–20 for weapon attacks.
- [ ] Item mode: a feat "Talent name" with the description and one transfer effect; a rank change updates the item's effect values and description.
- [ ] Changing a built slot's template after characters learned it: the next reconcile replaces the copy.
- [ ] Health: an invalid built spec (edit the flag by hand) shows a "bad" line; on a v13 world the built talent shows the "needs Foundry 14" warning and grants nothing.
- [ ] `api.builder.templates()`, `api.builder.preview({ template: "ac", base: 1, step: 1 }, 2)`; with *Feature builder* off `api.builder` is undefined and the Settings section is gone.

## 0.2.0

The grant engine: learned talents now give the character what their node grants (items or effects from your own compendiums or world), and refunds take it back. Nothing new in the window for players; the GM box gains the granted items' state and a Refresh button.

- **Grants:** after every saved Learn, refund, respec, award, tree change or talents on / off, the GM's client makes the character's granted documents match the learned talents (one idempotent reconcile, one request at a time per character). Copies carry the tag `flags.wanderers-path.granted = { tree, node, rank, key, src, hash }`; items and effects without the tag are never touched, so a respec removes only what talents granted.
- **Item grants** are copies (`toObject()`, new id, `_stats.compendiumSource` for a compendium source, `_stats.duplicateSource` for a world one); their effects keep `transfer`. A multi-rank node in "scale" mode keeps one copy named "Name (rank/max)" and records the rank (values that scale with the rank come with the feature builder); a "replace" node swaps the copy for each rank's own document. Sources are loaded once per compendium (`getDocuments({ _id__in })`) or synchronously from the world, never one by one.
- **Effect grants:** an Active Effect on the character, copied from the source effect (or from an item's first effect that transfers), with the character as its origin.
- **Advancement:** dnd5e advancement doesn't run on talent grants. The GM is told when a granted item has advancement (notice, GM box, health check).
- **Refresh granted items** (GM box, `api.refresh(actor)`, `api.refresh()` for every character, and the health check's fix): copies whose source changed since they were made (the `hash`) are made again; anything missing is added and anything no learned talent grants is removed. Learning alone never re-copies a changed source.
- **Orphans:** grants from trees or talents that are no longer published are removed on the next reconcile. The health check's *Refund orphans* fix refunds those ranks for every character. While the tree compendium can't be read, nothing is removed.
- **Health:** granted documents out of step (fix: Refresh granted items), points in unpublished trees or talents (fix: Refund orphans), items with advancement.
- **Remove data:** new category *granted* deletes the tagged items and effects on world actors and unlinked tokens' actors (before the picks).
- API: `refresh(actor?)`. Hooks unchanged (ids only); a Refund orphans fires `wanderers-path.respec` with `tree: null`.

### Untested in Foundry

- [ ] A tree node with `grant: { mode: "item", ranks: [{ uuid: "<a compendium feat>" }] }`: Learn adds a copy to the character (name, effects, `_stats.compendiumSource` = the UUID, flag `granted`); a second Learn elsewhere doesn't add it twice.
- [ ] A 3-rank "scale" node: rank 1 adds "Name (1/3)", rank 2 renames it to "Name (2/3)" (same item id, tag rank 2); a single-rank node keeps the plain name.
- [ ] A "replace" node with a document per rank: rank 2 deletes the rank-1 copy and adds the rank-2 one.
- [ ] Effect grants: from an Active Effect UUID (world item's effect and a compendium item's effect) and from an item UUID (its first transfer effect); the effect sits on the actor with origin = the actor and applies its changes.
- [ ] A granted item whose effects transfer: the effects apply to the character (v13 and v14).
- [ ] Refund one rank, Reset tree, Free respec: only tagged copies go; an item added by hand with the same name stays.
- [ ] Remove a tree from a character (GM tools) or turn talents off: its grants go; add it back: they return.
- [ ] Unpublish a tree / delete a node from it: next reconcile (any change, or Refresh) removes those grants; health shows the orphans with *Refund orphans*; the fix refunds them and fires `wanderers-path.respec`.
- [ ] Unset the tree compendium: a Learn or Refresh removes nothing; health says granted items are kept.
- [ ] Edit a source item after granting: health shows nothing out of step (it's not structural), Refresh re-copies it (new id), a plain Learn doesn't.
- [ ] Delete a granted copy by hand: the GM box and health show it out of step; Refresh adds it back.
- [ ] A granted class-feature item with advancement: the GM gets the notice and the GM box / health line; nothing breaks.
- [ ] A missing source UUID: the GM gets "wasn't found"; an existing copy stays.
- [ ] Two GM tabs: grants are created once (leader only); a player's Learn grants through the GM's client; quick double Learns don't create duplicates.
- [ ] `api.refresh(actor)`, `api.refresh()` as GM send the request; as a player they warn and return false.
- [ ] Remove data › granted: the dry run lists the copies; REMOVE deletes them (world actors and an unlinked token's actor) and leaves hand-made items.
- [ ] The GM box redraws when a granted item is added or removed.

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
