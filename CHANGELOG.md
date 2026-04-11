# Changelog

## [1.0.24] - 2026-04-11

### Added
- Two-phase disaster roll workflow. The GM now configures roll modifiers before dispatching a roll request to players. Phase 1 shows a \"Configure\" header with per-character selectors. Phase 2 shows a dispatched confirmation so the GM knows the request is live.
- Per-character roll modifier selectors in the disaster decision tree. GMs can set Normal, Advantage, Disadvantage, Force Pass, or Force Fail per character before sending the roll.
- Force Pass / Force Fail outcomes. When forced, no dice are rolled — the result is synthetic, posted immediately, and shown to the player as a confirmed outcome rather than a standard roll.
- GM Guidance flyout. A body-level panel opens alongside the disaster tree showing GM-only scene-setting notes and tactical guidance. Tears down cleanly when the rest window closes.
- `random` effect scope in disaster JSON. Effects with `"scope": "random"` now resolve to a single consistent target across all character outcome calculations. Stable per effect key; re-rolls are deterministic within a single rest.
- Stall penalty hint text. A permanent muted label lists common stall triggers (repeating questions, third option bids) so the GM knows when to apply a stall.
- Spell rulings advisory in the tree panel. If a choice has `pendingChoiceSpellRulings`, a wizard-hat advisory appears below the choice header for the configuring GM.

### Fixed
- Exhaustion resolution display now shows net exhaustion change rather than raw save outcome. Characters whose long rest recovery offsets a failed CON save no longer display "+1 Exhaustion" when the net result is zero.
- Empty event pool chat message now shows the actual watch roll (via `roll.toMessage()`) alongside the advisory. GMs can see the roll that would have triggered an event alongside the \"no events available\" notice.
- Dice So Nice integration for empty-pool event rolls. The GM's watch roll now waits for the animation to complete before continuing.
- Roll modifier state (`rollModes`) is now persisted in the tree roll snapshot. If a player client refreshes after a roll request is sent, their roll mode is correctly restored from the GM's state.

## [1.0.20] - 2026-04-08


### Added
- 4-tier event outcome resolution. Events now resolve as triumph, success, mixed, or failure based on how far the party's roll beats the DC. Triumph triggers at DC+5 and above, mixed at DC-3 and above. Events that only define two tiers still work as before.
- Event Browser. GMs can open a read-only event viewer from the Pack Registry to browse every loaded event with terrain filter, sentiment badge, and full outcome narratives.
- Core event toggle. The base event pack can now be disabled in the Pack Registry, allowing GMs to run purely custom content packs. A confirmation dialog warns when a terrain has zero enabled events.
- Clear Stuck Rest button in module settings (GM only). Shows a confirmation, then wipes the active rest state and reloads all clients. Also available in the console as `game.ionrift.respite.resetFlowState()`.

### Fixed
- Empty event pool handling. If no events are enabled for a terrain, the GM receives a whispered notice instead of a silent failure.

## [1.0.19] - 2026-04-07

### Fixed
- HP and exhaustion suppression now correctly handles DnD5e v5 nested update data. The system's `mergeObject` call expands dot-notation keys into a nested object tree, so the previous flat-key deletion (`"system.attributes.hp.value"`) never matched. HP is no longer silently reset to max after a Respite rest. This is the real fix for the issue reported in v1.0.18.

## [1.0.18] - 2026-04-07

### Fixed
- Hit Dice recovery now works correctly with DnD5e v4+ (2024 PHB and later). The system changed its internal field name from `hitDiceUsed` to `hd.spent`, which caused Respite's comfort-based recovery to silently fail. Hostile and rough conditions now correctly limit HD recovery as intended.
- Exhaustion suppression updated for DnD5e v5+. The system now reads exhaustion recovery from the rest config rather than just the update payload. Hostile conditions now correctly block exhaustion reduction.
- RecoveryHandler HD restoration updated to read and write the correct field for DnD5e v4+ class items. Previously, HD recovery would find 0 spent dice and restore nothing.

## [1.0.17] - 2026-04-07

### Added
- Custom Food Items setting. GMs can add a comma-separated list of item names that count as food in the meal phase. Works for homebrew diets, Gatherer output, and any non-standard food.
- Custom Water Items setting. Same idea for water. A Warforged that drinks oil? Add "oil" to the list and it appears in the water lane.

## [1.0.16] - 2026-04-07

### Fixed
- Event item grants (rusty pitons, crate wood, cached gold, potions, antitoxin) no longer fail with "Could not resolve item". Added built-in fallback definitions for items that lack compendium entries. Any unrecognised itemRef now creates a named loot item instead of throwing an error.

## [1.0.15] - 2026-04-07

### Added
- Tavern hearth auto-fire. Resting in a tavern lights the campfire automatically (no kindling or cantrip needed). The linked scene token now syncs correctly with the hearth state.
- Food and water detection overhaul. The meal phase now recognises items by three methods: DnD5e consumable subtype (`food`), Respite item flags (`ionrift-respite.foodType`), and the existing name fallback. Custom food items from content packs, homebrew, and crafting outputs appear in the meal picker without renaming.
- Water detection extended. Waterskins, Water Flasks, Canteens, and pint-type water items are now detected. Content packs and GMs can flag custom water sources for non-standard characters.
- Short rest terrain banner support in the art pack system.

### Fixed
- Stale rest guard no longer auto-discards after 24 hours. Interrupted rests persist across sessions regardless of how long the gap is. The resume dialog now shows how long ago the rest was interrupted.
- Resume dialog failure no longer permanently blocks new rests. If the dialog fails to render, the flow flag resets cleanly.
- Art pack uninstall now requires confirmation and prevents double-clicking.

## [1.0.14] - 2026-04-06

### Added
- Player-driven disaster rolls. When the GM picks a disaster choice, each player now rolls their own skill check instead of the GM auto-rolling for them. Players see their result (total, pass/fail) inline.
- "Roll for them" fallback on all roll contexts. If a player is disconnected or unresponsive, the GM can roll on their behalf during disaster checks, event group checks, and camp activity checks.
- Resend button for disaster roll requests. If a player refreshes mid-roll, the GM can re-broadcast the roll request.
- Per-character pending roll tracker for the GM during event group checks (replaces the old generic "Still waiting: X roll(s)" counter).
- Shared roll utilities via RollRequestManager for consistent roll construction, Dice So Nice integration, and button disabling across all roll contexts.

### Fixed
- Exhaustion from failed CON saves now persists. The native DnD5e long rest was silently reverting Respite's exhaustion changes because the suppression hook had a faulty guard clause. Exhaustion set by RecoveryHandler is no longer overwritten.
- Stalling during an active disaster roll now correctly bumps the pending DC for remaining rolls. Previously the stall penalty only updated the option DCs but not the in-flight roll target.
- Player tree roll state now survives a client refresh. The pending roll request is reconstructed from the GM's snapshot, preserving already-rolled results.

### Changed
- DecisionTreeResolver split into two phases: `prepareChoice()` for roll request preparation and `resolveWithResults()` for final state resolution. The old synchronous `resolveChoice()` is kept only for Force Pass/Fail overrides.

## [1.0.13] - 2026-04-06

### Fixed
- Forage activity no longer appears in the activity picker. It was leaking past the disabled flag into the UI despite being marked as unavailable.
- Kindling detection now works when the player's character is not linked in User Configuration. The campfire checks the party roster as a fallback.
- Kindling name matching is now case-insensitive.

### Changed
- Fire-starting cantrip list moved from a hardcoded constant to the system adapter. Elementalism (2024 PHB) and Thaumaturgy are now recognised for lighting the campfire. Other system adapters can supply their own fire spells.

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