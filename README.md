# Ionrift Respite
![Downloads](https://img.shields.io/github/downloads/ionrift-gm/ionrift-respite/total?color=violet&label=Downloads)
![Version](https://img.shields.io/github/v/release/ionrift-gm/ionrift-respite?color=violet&label=Latest%20Version)
![Foundry Version](https://img.shields.io/badge/Foundry-v12-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/system-dnd5e-blue)

**Structured rest phases for Foundry VTT.**

Replaces the default long rest dialog with a phased flow. The party sets camp, picks activities, rolls for encounters, and resolves recovery together. Events are driven by terrain and camp conditions, not random tables bolted on.

Built for DnD 5e. System stubs exist for PF2e and Daggerheart but they're proof-of-concept only.

[![Respite preview](https://img.youtube.com/vi/uAOHxdlr7rg/maxresdefault.jpg)](https://youtu.be/uAOHxdlr7rg)

![Setup phase showing terrain, comfort, and encounter DC](assets/screenshots/setup.png)

## How it works

The rest runs in four phases:

1. **Setup** - Pick terrain, shelter type, set the watch roster. The module calculates encounter difficulty from the conditions (shelter quality, campfire, scouting, weather).
2. **Activities** - Each character picks a camp activity: Guard, Scout, Rest Fully, Fortify, Train, or tend the Campfire. Activities modify the encounter roll and grant individual bonuses.
3. **Events** - The GM rolls for encounters. Events are pulled from terrain-specific pools with weighted selection. Events include decision trees, resource loss, and condition effects. The GM can override outcomes.
4. **Resolution** - HP and HD recovery, exhaustion changes, and a summary whispered to each player privately.

![Activity selection grid](assets/screenshots/Activities.png)

## Camp systems

- **Encounter DC** - Calculated from terrain baseline, shelter, fire, scouting, defenses, and weather. Visible breakdown in the UI so the GM sees how each factor shifts the odds.
- **Meal tracking** - Multi-day food and water consumption. Starvation and dehydration kick in when supplies run out, with exhaustion consequences matching the variant rules.
- **Campfire** - Terrain-specific difficulty roll. Affects encounter modifiers and morale. Magical shelter and taverns skip it automatically.
- **Resource loss** - Events can consume supplies, gold, or put specific items at risk. Loss scales with event severity.
- **Personal gear** - Bedrolls, mess kits, and cook's utensils provide small bonuses when present in inventory. Sleeping in heavy armor applies the Xanathar's penalty.

![Campfire lit with firewood](assets/screenshots/fire_lit.png)

## Events

Events are selected from terrain-tagged pools (forest, desert, swamp, urban, dungeon, tavern, and more). Each event has a tier, sentiment (positive/negative/neutral), and weighted probability. The system tracks disaster history so the same disaster doesn't repeat until the pool cycles.

Decision tree events present the GM with choices that branch into different outcomes. The GM can also override any event's outcome after the fact.

Characters with relevant damage resistances get advantage on event saves (e.g. fire resistance against a wildfire event).

![Scout event with skill check](assets/screenshots/scout_event.png)

## Meals and rations

When meal tracking is enabled, characters need food and water for each rest period. Drag rations from inventory to fill plates. Missing meals trigger Constitution saves or exhaustion, following the standard 5e variant rules.

![Meal phase with empty plates](assets/screenshots/meal_empty.png)
![Meal phase with rations applied](assets/screenshots/meal_full.png)

## Resolution

Recovery is calculated from the comfort level and applied automatically. Each player gets a private whisper with their personal results. The GM sees the full party breakdown.

![Resolution summary with recovery details](assets/screenshots/resolution.png)

## Short rest

Separate short rest dialog with per-die HD rolling. Simpler flow, no phases.

## Dependencies

- **[Ionrift Library](https://github.com/ionrift-gm/ionrift-library)** - Required.

### Optional

- **[Simple Calendar](https://foundryvtt.com/packages/foundryvtt-simple-calendar)** - Enables date tracking and "already rested today" checks.

## Settings

All configuration is under **Game Settings > Module Settings > Ionrift Respite**.

- Default comfort level (Safe, Sheltered, Rough, Exposed)
- Intercept player long rests (redirect through Respite instead of the default dialog)
- Armor doff/don advisory
- Study activity toggle
- Food and water tracking (with partial sustenance option)
- Content Packs registry for expansion event pools
- Debug logging (off by default)

## Bug reports

1. Check the **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)** for common fixes.
2. Post to the **[Ionrift Discord](https://discord.gg/8p9Fp6wa)** with Foundry version, module versions, and any console errors (F12).
3. Or open a **[GitHub Issue](https://github.com/ionrift-gm/ionrift-respite/issues)**.

## License

Source code (scripts, styles, templates) is released under the [MIT License](./LICENSE).

Event narratives, terrain data, and item descriptions in the `data/` directory are copyright Ionrift and are not covered by the MIT license. They ship with the module for a functional base experience but may not be extracted or redistributed separately.

---

**Part of the [Ionrift Module Suite](https://github.com/ionrift-gm)**

[Wiki / Guides](https://github.com/ionrift-gm/ionrift-library/wiki) · [Discord](https://discord.gg/8p9Fp6wa) · [Patreon](https://patreon.com/ionrift)
