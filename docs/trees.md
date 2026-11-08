# Setting up a tree

Wanderer's Path ships with no talent content. This guide shows how to make your own tree, publish it and give it to characters. Every name below ("Example Tree", "Steady Guard", …) is a placeholder: use your own.

You build trees in the **tree editor**: drop items and effects onto a grid, link requirements, save drafts and publish them. Nobody needs to edit data by hand (the data format is in the appendix, for scripts).

## 1. The tree compendium

The tree editor can make this for you: the first **Publish** without a compendium offers to create a world compendium *Talent trees* (players: Observer) and choose it. To make it yourself:

1. In the **Compendium Packs** sidebar, choose **Create Compendium**. Pick the document type **Journal Entry** and give it a name, e.g. "Talent trees". It must be a world compendium.
2. Right-click it and open **Configure Ownership**. Set **Player** to **Observer**. Without this, players see no trees. The health check warns when this is wrong.
3. Go to **Configure Settings › Wanderer's Path › Open settings**, choose the compendium under **Tree compendium** and click **Save**.

Wanderer's Path never deletes this compendium. *Remove Wanderer's Path data* lists it and leaves it alone.

## 2. The tree editor

Open it from **Configure Settings › Wanderer's Path › Open settings › Open the tree editor** (GM only; also the Wanderer's Satchel's Settings button, or `game.modules.get("wanderers-path").api.editor.open()`). The feature *Tree editor* turns it on and off.

**Left: trees and items.**

- The list shows every published tree and every draft: *Published*, *Draft* (never published), *Draft (same)* (saved, nothing to publish) or *Draft (changed)*.
- **New tree…** asks for a name. The tree's id is made from it and never changes (characters' picks are stored under it). The new tree is saved as a draft at once.
- **Duplicate** copies the open tree under a new id ("… (copy)"), as a draft.
- **Delete** asks first. A published tree is removed from the compendium (and its draft). If characters have points in it, the dialog names them: their ranks become orphans, and the editor offers **Refund orphans** right away (the health check offers it later too).
- **Add talents** searches your world's items and the world's item compendiums. Drag one onto an empty spot of the grid. You can also drop items and active effects straight from Foundry's sidebar or any compendium window.

**Middle: the grid.**

- Rows are tiers (the number on the left is the points spent in this tree that open it), columns are spots.
- Drop an item or effect on an empty spot: a talent named after it, with its image, granting it (an item is copied to the character, an effect is put on them). Click an empty spot for a blank talent that grants nothing yet.
- Drag a talent to another spot; onto another talent, the two swap.
- **+ Tier** / **− Tier** (only an empty last tier), **Link mode** (select a talent, then click the talents it requires; click a linked one again to unlink; Escape leaves link mode), **Undo** (the last 20 changes; Ctrl+Z).
- Problems are listed under the grid while you edit; a talent with a blocking problem has a red mark.

**Right: the inspector.** Select a talent to edit:

- Name, image (the file button opens Foundry's file picker), text (the tooltip, and the description of a built feature), max ranks (1–5), points a rank (1–5), tier and column, keystone.
- **What it grants:** an item, an effect, or nothing; *One grant for every rank* (scale) or *A different one per rank* (replace). Each rank slot takes a dropped item or effect, **Build…** (the feature builder, section 4) or × to empty it.
- **Requirements:** talents it requires (with the ranks needed), points in the tree, character level, and talents it can't be learned with (shown on both).
- **Delete talent** removes it and every link to it (Undo brings it back while the editor is open).

With no talent selected the inspector shows the **tree settings**: name, image, layout, columns, tiers, points per tier, *Opens at level* (0 = the world's setting), *Offered to characters* and who gets it (section 5). The *Board* layout is kept for a later version: a board tree shows "Board editing comes later", but its settings can be changed.

**Save draft, Publish, Discard.**

- Edits stay in the window until **Save draft**, which keeps them in a GM-only journal in the hidden *Module data* folder (at most 50 drafts). Closing the editor or switching trees with unsaved changes asks first.
- **Publish** checks the tree. Errors (talents that require each other, a tier the tiers below can't open, a document that no longer exists, a broken built slot) block it until fixed; warnings are shown and allowed. The confirm lists what changes, and names characters with ranks in talents you removed (those ranks become orphans: health check › Refund orphans). Publishing writes the tree and a readable *Talents* page into its Journal Entry in the tree compendium (a locked compendium is unlocked only if you agree, then locked again), and drops the draft. Players see the change at once.
- **Discard draft** drops the draft and unsaved changes and goes back to the published tree (a never-published tree is deleted).
- The title bar says *Unsaved changes*, *Draft differs from published* or *Draft, same as published*; a warning shows when the published tree changed since your draft started (publishing replaces it).

## 3. Linking items and effects

*Grants* (`grant.mode` in the data) says what a talent gives:

- *An item* (`"item"`): a copy of an Item (a feat, a feature, a weapon…) on the character, with its effects.
- *An effect* (`"effect"`): a copy of an Active Effect on the character. From an Item UUID, its first transferable effect is used.
- *Nothing* (`"none"`): nothing (a talent that only opens others, or that you handle by hand).

Each rank slot holds a document, or a built effect from the builder.

An *item* talent can't hold an active effect (it would grant nothing): dropping an effect onto one switches it to *An effect*, or is refused when another rank slot holds an item. Drag documents from the Items sidebar or a compendium, not from a character sheet: a grant must not depend on one actor.

- *One grant for every rank* (`perRank: "scale"`, default): one copy, kept as ranks rise. A multi-rank item is renamed "Name (2/3)". Only the first slot is used unless the slot is built.
- *A different one per rank* (`perRank: "replace"`): one slot per rank. Rank 2 swaps the rank-1 copy for the rank-2 document.

In the editor you drop the item or effect onto the grid or a rank slot; the talent keeps its UUID (a reference, not a copy), so editing the source changes what new grants copy. In the data, compendium effect UUIDs look like `Compendium.<package>.<pack>.Item.<id>.ActiveEffect.<id>`.

Copies are tagged with `flags.wanderers-path.granted`. Only tagged documents are ever changed or removed. When you edit a source, the copies stay as they are until **Refresh granted items** (a character's talent window, GM box, or the health check's Fix).

Items with dnd5e advancement (hit points, scale values, item choices) are copied, but their advancement doesn't run. The GM gets a notice and the health check warns.

## 4. Build a talent effect

In the tree editor, select a talent and click **Build…** on a rank slot (Foundry 14 and dnd5e 6; feature *Feature builder*). Choose an effect or a feature item, then a template:

- Armor Class, speed, senses, a roll bonus, advantage, proficiency or expertise, resistance / immunity / vulnerability, an ability score, hit points, critical range, extra damage dice.
- Feature item only: *Uses per rest*, *Grant a spell*, *Described in the talent's text*.

X scales with the rank: *X at rank 1* + *added per rank* × (rank − 1). The preview shows every rank. **Use for this rank** puts it into the tree you are editing; save the draft and publish. Characters get the change on their next learn or refund, or with **Refresh granted items**.

The saved slot is `{ built: { template, params, base, step } }`. If you edit one by hand, the health check tells you when a value isn't valid or was replaced (for example a `base` that isn't a number).

## 5. Who gets a tree

- **By class or subclass:** in the tree settings, add classes and subclasses from your class items (or type an identifier, the class item's *Identifier*, e.g. `fighter`); a character with any of them sees the tree.
- **By hand:** in a character's talent window, the GM box lists every tree with *Add*, *Remove* and *Automatic* (back to the class rule).
- **Talents on or off:** the world setting *Talents for every character*, and a per-character switch in the GM box (World setting / On / Off).
- A tree opens at its *Opens at level* (or the world's *Talents open at level*). Before that it shows as locked.
- **Offered to characters** off: no one gets the tree; a character who already learned talents in it keeps them (and what they grant), shown locked.

## 6. Points

- One pool per character, shared by every tree.
- Points from level: *Points per level* from *First point at level* on. With the defaults (1 from level 2) a level 20 character has 19.
- GM awards: *Award points* in the GM box, with a reason; they show in the character's log.
- Tiers count points spent in that tree only.
- Picks are a preview until **Learn**. Learning needs a connected GM: the GM's client checks the rules and writes the picks.

## 7. Refunds and respec

- A GM can always refund for free: right-click a talent, *Reset tree*, or *Free respec* (every tree).
- Players refund their own talents only with *Players may refund* on (an honour system).
- A refund also refunds anything that then breaks a rule: talents that need it, higher tiers.
- When a tree or talent is unpublished, its ranks stay counted as spent ("orphans") until refunded. The health check offers **Refund orphans**.

## Troubleshooting

Run the check in **Open settings › Health check** (or in the Wanderer's Satchel). Lines with a **Fix** button can be fixed from there; the check runs again afterwards.

| Line | What to do |
| --- | --- |
| No tree compendium is chosen yet | Section 1, step 3. |
| The tree compendium … isn't in this world / holds … documents | Pick a world compendium of Journal Entries. |
| Players can't read it | Set the compendium's Player ownership to Observer. |
| No trees are published yet | Make a tree in the tree editor and publish it (section 2). |
| … drafts aren't published yet | Open them in the tree editor and Publish (or Discard). |
| The drafts journal … is shared with … | Set its ownership back to None for players (Module data folder). |
| … require each other / is in a tier that opens at … / share a spot in the grid | Fix it in the editor: requirements, tiers, spots. The editor lists the same problems. |
| … grants a document that no longer exists | The source was deleted: drop another one on the slot. |
| … has a built effect, which needs Foundry 14 and dnd5e 6 | Built slots grant nothing on older versions. |
| … makes a feature item, but the talent grants an effect | Set the talent's *Grants* to an item (or build it again). |
| … isn't a number / isn't a whole number: … is used | A hand-edited built slot was replaced; fix `base` / `step`. |
| … grants an item with advancement | Advancement doesn't run on grants; add what it would give by hand. |
| … has points in trees no longer published | **Refund orphans**, or publish the tree again. |
| … has spent more points than they have | Lower level or smaller award: refund some talents or award points. |
| … granted documents are out of step | **Refresh granted items**. |
| No tree compendium is chosen: granted items are kept | Nothing is removed until a compendium is chosen again. |
| … names an automation no module has registered | Install the module that provides the key, or ignore (the feature still shows its text). |
| The request handler hasn't started | Reload; a GM must be connected for learning. |

## Appendix: a tree's data

Each tree is one Journal Entry in that compendium. Its data lives in the flag `flags.wanderers-path.tree`. Pages in the entry are yours: write the tree's description there if you like.

The tree editor writes this for you. For scripts, or to see what is stored: create the entry, then set the flag from the browser console (F12) as a GM:

```js
const pack = game.packs.get("world.talent-trees");          // your compendium's id
const entry = (await pack.getDocuments()).find(e => e.name === "Example Tree");
await entry.update({ "flags.wanderers-path.tree": {
  v: 1,
  id: "example",                       // unique; letters, digits, _ and -
  name: "Example Tree",
  layout: "tiered",
  assign: { classes: ["fighter"], subclasses: [] },   // dnd5e identifiers
  unlockLevel: null,                   // null = the world's "Talents open at level"
  tiered: { columns: 3, tierSize: 5 }, // a tier opens every 5 points spent in this tree
  nodes: [
    { id: "guard", name: "Steady Guard", text: "+1 AC per rank.", tier: 0, col: 0, maxRanks: 3,
      grant: { mode: "effect", perRank: "scale", ranks: [] } },
    { id: "reach", name: "Long Reach", text: "A feature you made.", tier: 0, col: 2, maxRanks: 1,
      grant: { mode: "item", perRank: "scale", ranks: [{ uuid: "Compendium.world.talent-sources.Item.abcdefghijklmnop" }] } },
    { id: "focus", name: "Inner Focus", tier: 1, col: 1, maxRanks: 2,
      prereqs: [{ node: "guard", ranks: 3 }], excludes: [],
      grant: { mode: "none", perRank: "scale", ranks: [] } }
  ]
}});
```

Changes show at once: the tree cache reloads when a compendium entry changes. A hand-written tree opens in the editor like any other (Publish there rewrites the flag in the same shape).

`grant.ranks` holds one slot per rank: `{ uuid }` for a document, or `{ built: { template, params, base, step } }` from the builder.

### Tree fields

| Field | Meaning |
| --- | --- |
| `id` | Unique id. Characters' picks are stored under it, so don't change it once players have learned talents. |
| `name`, `img` | Shown on the tree's tab. |
| `layout` | `"tiered"` (rows that open with points). `"board"` is reserved for a later version. |
| `enabled` | `false`: offered to no one (characters with ranks keep them, locked). Missing = `true`. |
| `assign` | `classes` / `subclasses`: dnd5e identifiers (the class item's *Identifier*, e.g. `fighter`). Characters with one of them get the tree. |
| `unlockLevel` | Character level the tree opens at; `null` uses the world setting. |
| `tiered.columns` | Columns in the grid (default 3). |
| `tiered.tierSize` | Points spent in this tree that open each next tier (default 5). |
| `tiered.tiers` | Optional row count; without it, as many rows as the talents use. |

### Talent (node) fields

| Field | Meaning |
| --- | --- |
| `id`, `name`, `img`, `text` | Ids are unique in the tree; the text is the tooltip and the granted item's description. |
| `tier`, `col` | Row (0 = first) and column (0 = left). |
| `maxRanks`, `cost` | 1–5 each. Cost is points per rank. |
| `prereqs` | `[{ node, ranks }]`: other talents (in a lower tier) and how many ranks they need (0 = all). |
| `gate` | `{ treePoints, level }`: points spent in the tree and a character level, both optional. |
| `excludes` | Talents that can't be learned together with this one (mirrored both ways). |
| `grant` | What it gives: see below. |

The normalizer never throws: a bad field gets a default. The health check lists what it found wrong (cycles, unreachable tiers, grid clashes, missing documents).
