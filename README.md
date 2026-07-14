# Ionrift Respite
![Downloads](https://img.shields.io/github/downloads/ionrift-gm/ionrift-respite/latest/total?color=violet&label=Downloads)
![Version](https://img.shields.io/github/v/release/ionrift-gm/ionrift-respite?color=violet&label=Latest%20Version)
![Foundry Version](https://img.shields.io/badge/Foundry-v12-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/system-dnd5e%20%7C%20pf2e-blue)

**Structured long and short rest phases for DnD 5e and Pathfinder 2e.**

### Support Ionrift

[![Patreon](https://img.shields.io/badge/Patreon-ionrift-ff424d?logo=patreon&logoColor=white)](https://patreon.com/ionrift)
[![Discord](https://img.shields.io/badge/Discord-Ionrift-5865F2?logo=discord&logoColor=white)](https://discord.gg/vFGXf7Fncj)

> Documentation, setup guides, and troubleshooting: **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)**

Long rests have a bottleneck. Everyone wants to do something during downtime: identify a ring, copy a spell, attune new gear, cook for the party. The GM has to field each request one at a time or cut the whole thing short to keep the session moving.

Breaking out of character to run rest logistics player by player is the problem most tables solve by skipping the interesting parts entirely.

Respite replaces the default rest dialog with a guided flow. Players pick their own activities and handle their own downtime. The GM runs the encounter roll and the events. The bookkeeping that can eat the better part of an hour is handled by the module.

---

## Rest profiles

Starting a rest opens one of three presets instead of a configuration screen. Pick the one that matches how much detail the table wants and the rest configures itself.

- **Simple.** Activities then recovery. No rolls, no encounters, no decision trees. Just the party asleep and a continue button.
- **Standard.** The full phased flow with events and the campfire, without the survival bookkeeping.
- **Survival.** Adds comfort tiers, terrain penalties, the exhaustion save, and meal tracking for tables that want the whole ruleset.

A custom card covers anything that deviates. Full settings live in three tidy submenus: Rest Activities, Recovery Rules, and Player Restrictions.

---

## How it works

1. **Setup.** The GM picks terrain, weather, and shelter. The module calculates an encounter DC and shows the breakdown.
2. **Activities.** Each player picks what they are doing. Keep watch, rest fully, or specialist options like Attune, Identify, and Copy Spell.
3. **Events.** The GM rolls against the encounter threshold. Events pull from terrain-specific pools with four outcome tiers, or suggest a combat outcome with surprise and initiative.
4. **Resolution.** HP and Hit Die recovery scale with comfort level. Each player sees the full results of their rest privately.

There is tension between guarding the camp and getting rest. Someone on watch is ready if combat breaks out but recovers less. Someone resting fully recovers better but wakes up groggy. Sleeping in armor avoids the scramble to gear up but costs recovery (optional Xanathar's rule). These tradeoffs are shown to the player with buttons to decide, so the GM does not have to explain or manage them.

---

## Identify and attune without the GM running each request

Casters scan the party's gear from the workbench. Detect Magic sweeps inventory with animated cues. Identify resolves names and properties in a Revelation card. Copy Spell runs the full gold cost, Arcana DC, and approval flow. Most of this is self-serve; the GM only steps in where the rules require it.

---

## Events

Hand-written rest events across forest, desert, swamp, urban, dungeon, and tavern, collected over years of running a primitive version of this module at the table. Events have tiers, weighted probability, and narrative branching. The GM chooses how events are picked: random roll, improvise, or pick from the pool.

When an event puts gear or coin at risk, the module rolls which items are affected and proposes the loss. The GM reviews, can re-roll a result that does not fit, and confirms before anything is removed. Nothing leaves a character sheet without GM sign-off. Force Pass or Force Fail is always available.

---

## Meals

When meal tracking is enabled in the Survival profile, players drag rations from inventory to fill plates and pour water from a shared pool. Missing meals trigger CON saves, and exhaustion stacks following the standard 5e variant rules.

---

## Camp systems

- **Encounter DC.** Terrain baseline plus shelter, fire, scouting, defenses, and weather, with a visible breakdown in the UI.
- **Comfort tiers.** Hostile, Rough, Sheltered, Safe. Drives HP and Hit Die recovery scaling.
- **Safe Rest Spot.** Mark a tavern or allied fortress as safe to skip encounters, comfort penalties, and meals while activities still work.
- **Shelter spells.** Tiny Hut, Rope Trick, and Mansion auto-detected from party spell lists.
- **Gear badges.** Bedroll, Mess Kit, and Tent benefits detected from inventory.
- **Campfire.** Interactive fire panel with a whittle mechanic and three stages: embers, campfire, bonfire.

---

## Short rest

A separate single-screen flow with per-die Hit Die spending and live HP tracking. Bards can volunteer Song of Rest, wizards and druids get an Arcane or Natural Recovery picker, and supported feats and items (Durable, Periapt of Wound Closure) are detected from the sheet.

---

## System support

- **DnD 5e.** Full. Activities, recovery, events, campfire, cooking, and short rest. Verified on Foundry v14, compatible back to v12.
- **Pathfinder 2e.** Early. Core rest flow, campfire, events, activity grid, and HP/Focus recovery. PF2e-specific activities and condition automation are in progress.
- **Starfinder 1e.** Initial. Core rest flow, campfire, and Stamina-aware HD recovery. 
- **Pathfinder 1e & D&D 3.5e.** Initial. Core rest flow, campfire, and HP recovery. (Native rest flows are suppressed to prevent double-dipping).
- **Old-School Essentials.** Initial. Core rest flow, campfire, HP/scores recovery, and spell slot refresh on long rest.

---

## Requirements

- **[Ionrift Library](https://github.com/ionrift-gm/ionrift-library)**: Required dependency.
- **System:** One of the 6 supported game systems listed above.
- **[Simple Calendar](https://foundryvtt.com/packages/foundryvtt-simple-calendar)** (optional): Date tracking and "already rested today" checks.

---

## Settings

All under **Game Settings > Module Settings > Ionrift Respite**: default comfort level, rest interception, armor advisory, meal tracking, content packs, debug logging.

---

## Bug reports

1. **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)** for common fixes.
2. **[Ionrift Discord](https://discord.gg/vFGXf7Fncj)** with Foundry version, module versions, and console errors.
3. **[GitHub Issues](https://github.com/ionrift-gm/ionrift-respite/issues)**.

---

## License

Source code (scripts, styles, templates) is released under the [MIT License](./LICENSE).

Event narratives, terrain data, and item descriptions in `data/` are copyright Ionrift and may not be extracted or redistributed separately.

---

**Part of the [Ionrift Module Suite](https://github.com/ionrift-gm)**

[Wiki](https://github.com/ionrift-gm/ionrift-library/wiki) · [Discord](https://discord.gg/vFGXf7Fncj) · [Patreon](https://patreon.com/ionrift)
