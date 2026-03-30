# Ionrift Respite
![Downloads](https://img.shields.io/github/downloads/ionrift-gm/ionrift-respite/total?color=violet&label=Downloads)
![Version](https://img.shields.io/github/v/release/ionrift-gm/ionrift-respite?color=violet&label=Latest%20Version)
![Foundry Version](https://img.shields.io/badge/Foundry-v12-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/system-dnd5e-blue)

**Structured rest phases for DnD 5e.**

[![Watch the trailer](https://img.youtube.com/vi/-juG6sDkabU/maxresdefault.jpg)](https://youtu.be/-juG6sDkabU)

Long rests have a bottleneck. Everyone wants to do something - identify that ring, copy a spell, attune new gear - but the GM has to manage each request one by one or cut things short to keep the session moving. The GM is already overloaded, and breaking out of character to manage rest logistics one player at a time is a problem most tables solve by just skipping the interesting parts.

Respite replaces the default long rest dialog with a phased flow. Players pick their own activities and handle their own downtime. The GM runs the encounter roll and events. The bookkeeping that can eat the better part of an hour gets handled by the module.

![Activity selection with campfire and self-serve options](assets/screenshots/pure/13_activities_caster.png)

## How it works

1. **Environment** - Terrain, weather, shelter. The module calculates an encounter DC and shows the breakdown.
2. **Activities** - Each player picks what they're doing. Camp duties, personal activities, or spell-gated options like Identify and Copy Spell.
3. **Events** - GM rolls against the encounter threshold. Events pull from terrain-specific pools with narrative outcomes, skill checks, and decision trees.
4. **Resolution** - HP/HD recovery based on comfort level. Each player is presented with the full results of their rest privately.

There's a tension between guarding the camp and getting rest. Someone on watch is safe if combat breaks out but recovers less. Someone resting fully recovers better but wakes up groggy. Sleeping in armor avoids the scramble to gear up but costs recovery (optional Xanathar's rules). These tradeoffs are shown to the player up front so the GM doesn't have to explain them.

## Activities

Players pick from a grid and it handles the mechanics. Most activities are fully self-serve; Copy Spell still needs some GM interaction with an agreement/transaction flow, but the spell level, gold cost, and Arcana DC are calculated and deducted for you.

Camp duties (Keep Watch, Scout, Set Defenses, Tend Wounds) protect the party. Personal activities (Train, Rest Fully, Forage, Fletch Arrows) are for your own character. Spell-gated activities (Identify, Attune, Copy Spell) only show up if you have the right spells.

![Copy Spell - full PHB workflow with gold cost, Arcana DC, and GM approval](assets/screenshots/pure/activities/activity_copy_spell.png)

Copy Spell runs the full PHB workflow. Pick a spell level, the system works out the gold cost, rolls Arcana, and sends the GM an approval request. Identify lets casters ritual-scan the party's gear without using up their activity slot. Attune shows un-attuned items with slot tracking.

**[See all activities with screenshots](assets/screenshots/pure/activities/README.md)**


## Events

30+ events across 6 terrains (forest, desert, swamp, urban, dungeon, tavern), each with multiple outcome tiers. Collected over years of running a primitive version of this module at the table. Events have weighted probability and narrative branching. The GM can Force Pass or Force Fail any outcome.

![Vermin Nest event with group Nature check](assets/screenshots/pure/12_events_vermin.png)

## Meals

![Rations phase with drag-and-drop food and water](assets/screenshots/pure/06_rations.png)

When meal tracking is enabled, drag rations from inventory to fill plates - water and food can now be self-served, if you'll forgive the pun 😬

Missing meals trigger CON saves. Exhaustion stacks following the standard 5e variant rules.

## Camp systems

- **Encounter DC** - Terrain baseline + shelter + fire + scouting + defenses + weather. Visible breakdown in the UI.
- **Comfort tiers** - Hostile, Rough, Sheltered, Safe. Drives HP/HD recovery scaling.
- **Shelter spells** - Tiny Hut, Rope Trick, Mansion auto-detected from party spell lists.
- **Gear badges** - Bedroll (+1 HD), Mess Kit (advantage on exhaustion saves with fire), Tent (weather shield) detected from inventory.
- **Campfire** - Interactive fire panel with whittle mechanic and three stages (embers, campfire, bonfire).
- **Armor penalty** - Xanathar's sleeping-in-armor rule. Warns players before they commit.

## Short rest

Separate single-screen wizard. Per-die HD spending, shelter detection, RP prompt.

## Dependencies

- **[Ionrift Library](https://github.com/ionrift-gm/ionrift-library)** - Required.
- **[Simple Calendar](https://foundryvtt.com/packages/foundryvtt-simple-calendar)** - Optional. Date tracking and "already rested today" checks.

## Settings

All under **Game Settings > Module Settings > Ionrift Respite**: default comfort level, rest interception, armor advisory, study toggle, meal tracking, content packs, debug logging.

## Bug reports

1. **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)** for common fixes.
2. **[Ionrift Discord](https://discord.gg/vFGXf7Fncj)** with Foundry version, module versions, and console errors.
3. **[GitHub Issues](https://github.com/ionrift-gm/ionrift-respite/issues)**.

## License

Source code (scripts, styles, templates) is released under the [MIT License](./LICENSE).

Event narratives, terrain data, and item descriptions in `data/` are copyright Ionrift and may not be extracted or redistributed separately.

---

**Part of the [Ionrift Module Suite](https://github.com/ionrift-gm)**

[Wiki](https://github.com/ionrift-gm/ionrift-library/wiki) · [Discord](https://discord.gg/vFGXf7Fncj) · [Patreon](https://patreon.com/ionrift)
