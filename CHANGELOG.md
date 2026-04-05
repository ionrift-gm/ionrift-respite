# Changelog

## [1.0.12] - 2026-04-05

### Fixed
- Spell slots, pact slots, and class features (Channel Divinity, Action Surge, etc.) now recover after a Respite rest. Previously only HP, Hit Dice, and exhaustion were handled. Tables without the rest-recovery module were silently broken.

### Added
- Party Roster. GMs can now choose which characters participate in Respite rests via Module Settings. Summons, familiars, and sidekick tokens with player ownership are no longer included automatically. The roster persists across rests and shows a compact indicator in the setup wizard.


## [1.0.11] - 2026-04-04

### Fixed
- Rest Fully activity comfort boost now applies mechanically. Previously the "+1 comfort tier" effect was display-only. Choosing Rest Fully at a Hostile camp now gives you Rough-tier recovery (full HP, fewer HD lost, DC 10 exhaustion instead of DC 15).
- Resolution badges in the action bar now show event damage alongside recovery (e.g. "+12 HP, +1 HD, -10 dmg"). Characters with residual damage get a red-tinted badge.

### Changed
- "Rest disrupted by event" banner renamed to "Complications during rest". The rest still completes (spell slots and HD restored), damage is a consequence, not an interruption.
- Comfort badge on each character card now shows their effective personal comfort tier (after activity bonuses) instead of the raw camp comfort.
- Exhaustion CON save advisory now includes a short note explaining why the save is required (e.g. "Rough rest conditions require a Constitution save to avoid exhaustion").

## [1.0.10] - 2026-04-04

### Added
- Unified Disaster Loss Approval modal. When a disaster resolves, the GM sees every proposed loss grouped by actor: supplies, inventory items, and gold. Each row has a checkbox, a live item icon, and before/after quantities. Select All/None and a running tally let the GM curate the list before anything is deducted.
- Broad "disaster" item filter for item_at_risk effects. A flood now threatens rations, torches, rope, bedrolls, and mess kits instead of just generic supplies. Weapons, armor, profession kits, and high-value uniques stay protected. Type bias weights loot highest, consumables close behind, tools last.
- Gold loss proposals. The GM previews per-actor gold deductions in the same approval modal before they are applied.
- Per-actor whispered chat messages on confirmation. Each player receives a private summary of exactly what they lost.
- Disaster exhaustion now applied and persisted. The rest's natural exhaustion recovery is offset by the disaster gain, so a +1 from a flood cancels the -1 from resting. Exhaustion from disasters sticks.
- Severity tiers 4 and 5 for catastrophic disasters (5 and 8 items at risk, respectively).

### Changed
- Flash Flood disaster outcomes updated: success path risks 3 items, failed brace risks 5, and total failure risks 8 items plus gold loss and exhaustion.

## [1.0.9] - 2026-04-04

### Added
- Animated campfire token shipped in the module with a compendium Actor in the new "Respite Actors" pack. Drag the "Campfire" actor onto any scene. The prototype token is hidden by default so players do not see it until the fire is lit.
- When the campfire is lit, the CampfireTokenLinker reveals the token to players and applies its light. When the fire goes out, the token goes back to hidden and the light switches off.

### Fixed
- Flash Flood disaster now includes GM guidance for deployment context and skill check framing text for all six decision branches.

## [1.0.8] - 2026-04-02

### Fixed
- Changelog placeholder entry.

## [1.0.7] - 2026-03-30

### Fixed
- Activity follow-up radio buttons (study skill, crafting type) were misaligned inside their pill containers. Foundry's default radio input styling was bleeding through behind the custom circles. Replaced with fully custom-drawn radios using `appearance: none`.

## [1.0.6] - 2026-03-29

### Fixed
- Content packs could not be re-enabled after being disabled. Foundry V12 core CSS applies `pointer-events: none` to elements with the `.disabled` class, which blocked clicks on the toggle switch inside a disabled pack card. Added an explicit override.

## [1.0.5] - 2026-03-29

### Fixed
- All HP damage from rest events (Widowmaker, Scorpion Nest, Leech Infestation) now applies after the rest resolves instead of healing during it. Morning wounds feel like morning wounds now.
- Scorpion Nest and Foul Miasma poisoned conditions changed from 4 hours to next rest. Previously the condition cleared mid-sleep and never mattered.
- Stale Air (dungeon) and Water Shortage (desert) GM guidance rewritten for clarity.
- Widowmaker check context reworded from question form to direct skill-check framing.

### Changed
- All five core swamp events rebuilt to v2 event schema. They now have full GM prompts, check context, tactical guidance, and four outcome tiers (triumph/success/mixed/failure). Previously they only had success/failure with no GM-facing text. Swamp rests should feel much more complete now.
- Speak with Animals notes added to GM guidance for all core events with creatures (wolves, scorpions, leeches, wisps, tavern cat).
- Flash Flood disaster now includes stall penalty data (DC bump and upfront supply loss when the party delays choosing). The UI toggle for this is coming in a future update.

### Added
- Item category flags (`itemCategory: food/loot`) on foraged rations and buried trade goods for future mechanical discovery.

## [1.0.4] - 2026-03-28

### Added
- Exhaustion save results now show clearly in the resolution UI for both GM and players: CON DC, passed/failed, and whether hostile conditions block recovery.
- Players now see gear descriptors (Bedroll, Cook's Utensils), exhaustion advisories, and hostile condition warnings in the resolution view. Previously these were GM-only.
- Abstract outcome text for players during event resolution so the card isn't empty while the GM narrates.

### Fixed
- Event titles and narratives are now redacted from the player view to prevent spoilers. Players see a generic label while the GM narrates.
- Resolved event cards no longer auto-collapse on the GM view, keeping the narrative accessible.
- Campfire cantrip and tinderbox checks now use the player's actual party characters instead of relying on `game.user.character`. Fixes a bug where Produce Flame could appear for characters that don't have it.
- GM can no longer interact with campfire lighting (Strike Flint, cantrip). Lighting the fire is a player action.
- Exhaustion recovery chip wording clarified: shows CON DC and advantage pre-save, then passed/failed post-save with explicit context about what "passed" means in hostile conditions.

## [1.0.3] - 2026-03-28

### Fixed
- Rewrote all `checkContext` fields across core events to use direct skill-check framing instead of the juvenile "Can the watch...?" question pattern. Affects 15 events across desert, dungeon, forest, and urban terrains. No mechanical changes; text only.

## [1.0.2] - 2026-03-27

### Added
- Respite Guide compendium journal with quick-start instructions and event reference.

### Fixed
- Event count display now reflects actual loaded event pool size.
- Tone cleanup pass on user-facing text.

## [1.0.1] - 2026-03-26

### Changed
- Removed AI-generated terrain banners and item icons from the base module to comply with Foundry VTT AI Content Policy. Replaced with compliant placeholder assets. Original art available via the optional `ionrift-respite-art` add-on.

## [1.0.0] - 2026-03-24

Initial public release.

### Core
- Four-phase rest flow: Setup, Activities, Events, Resolution
- Terrain-driven event system with weighted random selection
- 12 rest activities across camp, personal, arcane, and recovery categories (Keep Watch, Scout Perimeter, Set Up Defenses, Rest Fully, Study, Tell Tales, Pray/Meditate, Fletch Arrows, Training, Tend Wounds, Attune Item, Copy Spell)
- Comfort-tier recovery model (Safe, Sheltered, Rough, Hostile)
- Structured meal phase with multi-day tracking and starvation/dehydration consequences
- Short rest support with per-die HD rolling

### Events
- Pool-based event resolution with terrain tags, tiers, and sentiment
- Disaster events with decision tree mechanics and GM choice
- GM event outcome override
- Immunity-based advantage (damage resistance grants advantage on event saves)
- Disaster history tracking (prevents repeat events)
- Scouting modifiers (nat 1 / nat 20 bonus events)

### Camp Systems
- Encounter DC calculated from shelter, weather, fire, scouting, and defenses
- Campfire roll with terrain-specific difficulty
- Resource loss effects (consume_resource, supply_loss, consume_gold, item_at_risk)
- Personal gear bonuses (bedroll, mess kit, cook's utensils)
- Armor sleep penalty (Xanathar's variant)

### Infrastructure
- Pack Registry for enabling/disabling content packs
- Compendium builder with folder organisation
- Simple Calendar integration for date tracking
- Socket-based multiplayer synchronisation
- Centralized Logger gated on debug setting
- DnD5e system adapter with PF2e and Daggerheart stubs

  
 