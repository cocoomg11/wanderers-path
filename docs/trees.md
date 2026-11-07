# Setting up a tree

Wanderer's Path ships with no talent content. This guide shows how to make your own tree, publish it and give it to characters. Every name below ("Example Tree", "Steady Guard", …) is a placeholder: use your own.

Until the tree editor arrives, a tree is written as data on a Journal Entry. The feature builder can then fill in a talent's effect for you.

## 1. The tree compendium

1. In the **Compendium Packs** sidebar, choose **Create Compendium**. Pick the document type **Journal Entry** and give it a name, e.g. "Talent trees". It must be a world compendium.
2. Right-click it and open **Configure Ownership**. Set **Player** to **Observer**. Without this, players see no trees. The health check warns when this is wrong.
3. Go to **Configure Settings › Wanderer's Path › Open settings**, choose the compendium under **Tree compendium** and click **Save**.

Wanderer's Path never deletes this compendium. *Remove Wanderer's Path data* lists it and leaves it alone.

## 2. A tree's data

Each tree is one Journal Entry in that compendium. Its data lives in the flag `flags.wanderers-path.tree`. Pages in the entry are yours: write the tree's description there if you like.

Create the entry, then set the flag from the browser console (F12) as a GM:

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

Changes show at once: the tree cache reloads when a compendium entry changes.

### Tree fields

| Field | Meaning |
| --- | --- |
| `id` | Unique id. Characters' picks are stored under it, so don't change it once players have learned talents. |
| `name`, `img` | Shown on the tree's tab. |
| `layout` | `"tiered"` (rows that open with points). `"board"` is reserved for a later version. |
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

## 3. Linking items and effects

`grant.mode` says what a talent gives:

- `"item"`: a copy of an Item (a feat, a feature, a weapon…) on the character, with its effects.
- `"effect"`: a copy of an Active Effect on the character. From an Item UUID, its first transferable effect is used.
- `"none"`: nothing (a talent that only opens others, or that you handle by hand).

`grant.ranks` holds one slot per rank: `{ uuid }` for a document, or `{ built }` from the builder.

- `perRank: "scale"` (default): one copy, kept as ranks rise. A multi-rank item is renamed "Name (2/3)". Only the first slot is used unless the slot is built.
- `perRank: "replace"`: one slot per rank. Rank 2 swaps the rank-1 copy for the rank-2 document.

To find a UUID, open the item or effect and use *Copy UUID* in its header menu (or the id icon in the header). Compendium effect UUIDs look like `Compendium.<package>.<pack>.Item.<id>.ActiveEffect.<id>`.

Copies are tagged with `flags.wanderers-path.granted`. Only tagged documents are ever changed or removed. When you edit a source, the copies stay as they are until **Refresh granted items** (a character's talent window, GM box, or the health check's Fix).

Items with dnd5e advancement (hit points, scale values, item choices) are copied, but their advancement doesn't run. The GM gets a notice and the health check warns.

## 4. Build a talent effect

**Open settings › Build a talent effect** writes a built slot into a published talent (Foundry 14 and dnd5e 6). Pick the tree, the talent, the rank slot, an effect or a feature item, then a template:

- Armor Class, speed, senses, a roll bonus, advantage, proficiency or expertise, resistance / immunity / vulnerability, an ability score, hit points, critical range, extra damage dice.
- Feature item only: *Uses per rest*, *Grant a spell*, *Described in the talent's text*.

X scales with the rank: *X at rank 1* + *added per rank* × (rank − 1). The preview shows every rank. Characters get the change on their next learn or refund, or with **Refresh granted items**.

The saved slot is `{ built: { template, params, base, step } }`. If you edit one by hand, the health check tells you when a value isn't valid or was replaced (for example a `base` that isn't a number).

## 5. Who gets a tree

- **By class or subclass:** the tree's `assign` lists identifiers; a character with any of them sees it.
- **By hand:** in a character's talent window, the GM box lists every tree with *Add*, *Remove* and *Automatic* (back to the class rule).
- **Talents on or off:** the world setting *Talents for every character*, and a per-character switch in the GM box (World setting / On / Off).
- A tree opens at its `unlockLevel` (or the world's *Talents open at level*). Before that it shows as locked.

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
| No trees are published yet | Add a tree flag to an entry (section 2). |
| … require each other / is in a tier that opens at … / share a spot in the grid | Fix the tree data: prereqs, tiers, `col`. |
| … grants a document that no longer exists | The UUID is wrong or the source was deleted: fix the slot. |
| … has a built effect, which needs Foundry 14 and dnd5e 6 | Built slots grant nothing on older versions. |
| … makes a feature item, but the talent grants an effect | Set the talent's `grant.mode` to `"item"` (or build it again). |
| … isn't a number / isn't a whole number: … is used | A hand-edited built slot was replaced; fix `base` / `step`. |
| … grants an item with advancement | Advancement doesn't run on grants; add what it would give by hand. |
| … has points in trees no longer published | **Refund orphans**, or publish the tree again. |
| … has spent more points than they have | Lower level or smaller award: refund some talents or award points. |
| … granted documents are out of step | **Refresh granted items**. |
| No tree compendium is chosen: granted items are kept | Nothing is removed until a compendium is chosen again. |
| … names an automation no module has registered | Install the module that provides the key, or ignore (the feature still shows its text). |
| The request handler hasn't started | Reload; a GM must be connected for learning. |
