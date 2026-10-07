# Ionrift Respite
![Downloads](https://img.shields.io/github/downloads/ionrift-gm/ionrift-respite/total?color=violet&label=Downloads)
![Version](https://img.shields.io/github/v/release/ionrift-gm/ionrift-respite?color=violet&label=Latest%20Version)
![Foundry Version](https://img.shields.io/badge/Foundry-v12-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/systems-dnd5e%20%7C%20pf2e-blue)

**Structured rest phases and 7-day downtime management for DnD 5e and Pathfinder 2e.**

### Support Ionrift

[![Patreon](https://img.shields.io/badge/Patreon-ionrift-ff424d?logo=patreon&logoColor=white)](https://patreon.com/ionrift)
[![Discord](https://img.shields.io/badge/Discord-Ionrift-5865F2?logo=discord&logoColor=white)](https://discord.gg/vFGXf7Fncj)

> Documentation, setup guides, and troubleshooting: **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)**

Respite replaces the default rest dialog with guided tabletop rest workflows. Players choose camp activities and manage their downtime independently. The GM adjudicates danger rolls, events, and camp progression.

---

## Rest Profiles

Opening a rest presents setup presets tailored to table detail level:

- **Simple.** Quick recovery without encounter checks or survival tracking.
- **Standard.** Activities, events, and campfire management.
- **Survival.** Comfort tiers, weather penalties, exhaustion saves, and meal tracking.
- **Gritty Realism.** Automatically active when the DnD 5e Gritty Realism variant rule is selected. Long rests scale to the 7-day Downtime Ledger, and short rests use the overnight Bivouac HUD.

---

## Gritty Realism Downtime

When Gritty Realism is active, rest flows adapt automatically:

- **7-Day Downtime Ledger.** Allocates activities across three views:
  - **Gather.** Multi-day foraging and hunting checks.
  - **Activities.** Crafting queues, spell copying, wound tending, study, training, and defenses.
  - **Sustenance.** Daily ration and water pips with starvation alerts.
- **Camp Logistics Drawer.** Slide-out panel tracking party firewood reserves, water stocks, and gear condition waivers.
- **Nightly Vigils.** Step-by-step night pacing (Nights 1 to 7) showing active sentry tokens, passive perception scores, and danger DC modifiers. The GM rolls danger checks or declares quiet nights, while players see a sanitized timeline.
- **Dawn Finalization.** Automated Constitution saving throws for exhaustion recovery, departure meal and drink selections providing persistent travel buffs, and a Master Downtime chat log card.
- **Bivouac HUD.** Single-screen 8-hour overnight rest for short rests in gritty campaigns. Includes Camp Stances: **Warm Camp** (consumes 1 firewood, enables cooking, grants bonus warmth healing per spent Hit Die) or **Cold & Dark** (stealth rest, reduces encounter DC by 3).

---

## Standard Rest Flow

1. **Setup.** The GM selects terrain, shelter, and weather. The encounter DC updates live with a visible modifier breakdown under a 120px terrain artwork banner.
2. **Camp.** Optional on-scene station tokens (campfire, workbench, medical bedding). Campfire token linking syncs ignition and canvas lights to scene tokens named `Campfire` and auto-links `Perimeter Torch` tokens.
3. **Activities.** Players select tasks: Keep Watch, Set Defenses, Tend Wounds, Rest Fully, Fletch Arrows, Pray, or Train.
4. **Identify & Workbench.** Three examination paths:
   - **Identify Spell.** Casters scan party inventory. Follows 2024 RAW rules where Wizards with Ritual Adept cast from unmemorized spellbooks.
   - **Focus.** Physical examination.
   - **Taste.** Potion identification.
5. **Resolution.** Scales HP, Hit Die, and exhaustion recovery to camp comfort and meal status.

---

## Provisions, Spoilage & Cold Storage

- **World Provisions Auditor.** Centralized GM interface to audit, search, and override food, water, shelf life, and dietary flags across world items.
- **Sheet Actions.** Item sheet header button and inventory context menu entries open provision settings directly.
- **Cold Storage Containers.** Toggles on container items (e.g. Ice Chest, Bag of Holding) with configurable shelf-life multipliers or total stasis (0x spoilage).
- **Perishable Cohorts.** Optional setting appends shelf-life suffixes to perishable item names on grant (e.g. `Bird Eggs (3d)`), preventing automated inventory stacking from wiping timers.

---

## Short Rest Panel

Single-screen rest panel featuring:
- **Live Hit Die Spending.** Interactive dice rolling with instant HP updates.
- **Campfire Warmth.** Optional warmth bonus (+1 or +1d4 HP per Hit Die) when an overnight campfire is maintained.
- **Class Recovery.** Integrated Arcane Recovery and Natural Recovery selectors.
- **Song of Rest & Chef Feats.** Support for Bard Song of Rest timing and Chef treat distribution.

---

## System Support

- **DnD 5e.** Complete support. Activities, recovery, events, campfire, cooking, gritty realism, and short rest. Verified on Foundry v14, compatible back to v12.
- **Pathfinder 2e.** Core rest flow, campfire, events, activity grid, and HP/Focus recovery.
- **Starfinder 1e.** Core rest flow, campfire, and Stamina-aware Hit Die recovery.
- **DnD 3.5e & Pathfinder 1e.** Core rest flow, campfire, and HP recovery.
- **Old-School Essentials.** Core rest flow, campfire, HP/scores recovery, and spell slot refresh.

---

## Requirements

- **[Ionrift Library](https://github.com/ionrift-gm/ionrift-library)**: Required kernel dependency.
- **Game System:** One of the supported game systems listed above.
- **[Simple Calendar](https://foundryvtt.com/packages/foundryvtt-simple-calendar)** (optional): Calendar date integration and rest cooldown tracking.
- **[Monstrous Feast](https://github.com/ionrift-gm/ionrift-monstrous-feast)** (optional): Monster harvesting, party cookbook, and camp meal buffs.

---

## Settings & Maintenance

Configurable under **Game Settings > Module Settings > Ionrift Respite**:
- **Interface Themes:** Select between translucent Ionrift Glass and opaque Gilded Slate.
- **Compact Banners:** Toggle the 120px terrain artwork banner.
- **Watch Alert Benefit:** Configure sentry bonuses: immune to surprise, advantage on rolls, or flat bonus (+1 to +20).
- **Reset Rest State:** Clean maintenance tool to clear rest locks, cooldown locks, and orphaned tokens, then reload connected clients.

---

## Bug Reports

1. Check the **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)** for common fixes.
2. Post to the **[Ionrift Discord](https://discord.gg/vFGXf7Fncj)** with Foundry version, module versions, and any console errors (F12).
3. Open a **[GitHub Issue](https://github.com/ionrift-gm/ionrift-respite/issues)**.

---

## License

Source code (scripts, styles, templates) is released under the [MIT License](./LICENSE).

Terrain data and item descriptions in `data/` are copyright Ionrift and may not be extracted or redistributed separately.

---

**Part of the [Ionrift Module Suite](https://github.com/ionrift-gm)**

[Wiki](https://github.com/ionrift-gm/ionrift-library/wiki) · [Discord](https://discord.gg/vFGXf7Fncj) · [Patreon](https://patreon.com/ionrift)
