# Changelog

## [2.0.1] - 2026-05-03

### Fixed
- Clicking a token while a rest was active could crash with "this._isFoodItem is not a function". The meal builder now routes through the shared item classifier correctly.

## [2.0.0] - 2026-05-02

### Added
- **Camp scene placement.** Starting a long rest now deploys a camp directly onto the scene. A campfire, workbench, weapon rack, medical bedding, and cooking station appear around the party. Player gear (bedrolls, tents, mess kits) is placed automatically based on inventory. Station tokens use art pack assets when available, Foundry core icons otherwise.
- **Campfire interaction.** The campfire is now a physical token on the map. Click it to open the Campfire Station - adjust the fire level mid-rest, spend firewood, and view fire tier effects. Players can request fire level changes through GM approval.
- **Cooking profession.** Characters with Cook's Utensils can select "Cook a Meal" as their rest activity. The Workbench cooking tab shows available recipes, required ingredients, and a crafting interface. Completed meals go into the cook's inventory and can be served to the party.
- **Feast distribution.** Cooked meals flagged as feasts can be served to the entire party from a dedicated success screen. Each party member either eats immediately or receives the meal in their inventory for later. Feast ingredient costs scale with party size using an offset formula.
- **Well Fed buffs.** Certain cooked meals grant a "Well Fed" ActiveEffect when consumed. Buffs include mechanical benefits (advantage on Constitution saves, bonus temp HP) and persist until the next long rest. The effect is stamped with duration data after rest completion so it survives the rest cycle.
- **Rations and hydration.** The Workbench meals tab shows food and water slots that characters fill by dragging consumables. Consuming rations from inventory automatically syncs with the rest state - no double counting. Locked slots prevent further changes once an item has been consumed.
- **Identify sharing.** Characters with the Identify spell prepared can offer identification services to other party members through the Workbench. Unidentified items from the party are pooled into a shared view, and the caster can identify them on behalf of their owners.
- **Detect Magic overhaul.** Casting Detect Magic at the Workbench now triggers a visual cast animation with expanding rings. All magic items in the caster's inventory glow, and the scan highlights both identified and unidentified magical items. A dismiss toggle lets the caster end the effect.
- **Campfire Cooking recipe book.** A compendium item that serves as the starter reference for available recipes. Future terrain and content packs will include their own recipe books.
- **AFK tracking.** Characters can now be marked as AFK at any time during the session. The rest flow recognises AFK characters and prompts the GM before including them. State persists through page refreshes.
- **Travel mishap effects.** Travel events can now apply mechanical consequences (conditions, HP loss, resource depletion) in addition to narrative outcomes.
- **Workbench hub.** The Activities phase now splits into three dedicated tabs - Identify, Activity, and Meals - each with a consistent card-based layout.
- **Potion tasting.** Unidentified potions can be tasted at the Workbench to attempt identification. Limited to one potion at a time.
- Activity confirmation is blocked when an armor penalty is active. The resume button animates when all tasks are complete.

### Changed
- Fletching activity now correctly uses the ammo item type and respects output quantity.

### Fixed
- Host and player clients no longer desync on activity selection.
- Rest bar no longer shows a stale activity count after returning from activities.
- Watch advisory now correctly accounts for confirmed activity choices.
- Terrain selection is saved when the rest begins, not after the step completes.
- Detect Magic now recognises ritual casters.
- Dual rest-bar rendering on player clients is fixed.
- Artificer class-name detection guard now handles edge cases correctly.
- Characters not participating in the rest no longer receive meal or dehydration save prompts.
- Perfect Campsite now triggers on a natural 20 only, not a modified total of 20.
- Encounter DC modifier no longer shows contradictory values in the UI.
- Single-day travel now advances directly to camp after resolving - no redundant second button.
- GM footer task count now updates immediately after serving a feast.

## [1.2.2] - 2026-04-20

### Fixed
- Art pack detection on The Forge when running Foundry v13. The v13 namespaced FilePicker bypasses the Forge module's monkey-patch, so browse calls for the Forge asset library silently failed. Now uses the correct (patched) FilePicker on Forge instances.

## [1.2.1] - 2026-04-19

### Fixed
- Art pack detection now works on The Forge. The terrain images were uploaded correctly but Respite was searching the wrong file source, so the Content Packs screen showed 0 terrains and 0 files. Self-hosted installs were unaffected.

## [1.2.0] - 2026-04-17

### Added
- **Pathfinder 2e support (early).** The core rest flow now works with PF2e. Activities, campfire, terrain events, comfort tiers, and the encounter DC system all function as expected. HP recovery maps to the PF2e actor model. Focus Points stand in for Hit Dice in the recovery display. The fatigued condition is toggled in place of 5e's numeric exhaustion. Fire cantrips (Produce Flame, Ignition, Prestidigitation) are recognised for campfire lighting. D&D-specific activities (Attune Item, Copy Spell) are hidden from the PF2e activity grid.
- PF2e-unique rest activities (Treat Wounds, Refocus, Repair, Subsist) are planned for a future update. If you run PF2e and try this, report what breaks.

### Fixed
- Resolved a crash at rest resolution on non-5e systems. The native `actor.longRest()` call is now gated to DnD5e only.
- All exhaustion reads and writes throughout the rest flow (recovery, meals, starvation, dehydration, disaster events) now route through the system adapter instead of hardcoding the 5e data path. PF2e toggles the "fatigued" condition correctly.
- Shelter spell detection now recognises PF2e equivalents: Cozy Cabin (maps to Tiny Hut) and Resplendent Mansion (maps to Mansion).

## [1.1.2] - 2026-04-15

### Fixed
- Discord patch-notes embed now shows the module icon. The icon was stored in Git LFS which raw.githubusercontent.com serves as a pointer stub - moved to standard git tracking so the image resolves correctly.
- Training activity setting was already present but undocumented. The "Training Activity" toggle in module settings gates the training option during long rests for characters level 5 and below.

## [1.1.1] - 2026-04-15

### Added
- **Pack update notifications.** The Content Packs screen now shows when a newer version of an installed pack is available - with a Patreon download link if you're on the free tier, or a one-click install button if you're connected to Ionrift Cloud. No more guessing whether your packs are current.
- **JSON pack import.** Content packs can now ship as standalone JSON files and import through the same unified pack service as ZIP packs - manifest validation, version tracking, and all.

### Changed
- The settings panel now uses the standardised Ionrift layout - support links and diagnostics live at the bottom behind a visual divider, consistent with the rest of the suite.

### Fixed
- LevelDB runtime files are no longer tracked in the repository.
- Strict equality checks throughout - no more `==` where `===` belongs.

## [1.1.0] - 2026-04-12

### Added
- **Short Rest Overhaul.** The short rest flow is now a full-featured screen with per-die HD spending, live HP tracking, and hit die pip display. Players spend their own dice; the GM oversees and completes the rest.
- **Durable feat support.** Characters with the Durable feat now have a minimum healing floor of 2× their CON modifier on each Hit Die roll. Detected automatically from the character sheet.
- **Periapt of Wound Closure support.** Characters attuned to a Periapt of Wound Closure now double their Hit Die healing. Detected automatically from attunement state.
- **Song of Rest (Bard).** If a bard (level 2+) is in the party, they can volunteer their Song of Rest. A bonus healing die (d6 to d12 by bard level) is rolled for each character who spent at least one Hit Die. Configurable timing: applied at end of rest (strict) or with each character's first Hit Die (immediate).
- **Arcane Recovery / Natural Recovery.** Wizards and druids with these features now get a spell slot recovery picker during the short rest. Budget-limited (half class level, rounded up), with commit/edit flow so players can lock in their choices. GM receives a warning if anyone has unconfirmed selections when completing the rest.
- **Player readiness signals.** AFK toggle and "I'm done" button let players signal their status. GM sees a roster strip with readiness indicators. AFK characters trigger a confirmation before rest completion.
- **GM completion guard.** If any players haven't signalled "done" when the GM completes the rest, a confirmation modal warns before proceeding.
- **Short rest session persistence.** Interrupted short rests survive page refreshes and GM disconnects. The GM sees a resume prompt on reconnect with elapsed time.
- **Song of Rest Timing setting.** GM can choose between strict (end of rest) and immediate (with first Hit Die) timing for the Song of Rest bonus.
- **Spell Recovery Max Level setting.** Maximum spell slot level for Arcane/Natural Recovery (default 5, configurable 1-9 for homebrew rules).
- **Art pack detection caching.** Player clients now read cached art pack state from a world setting instead of calling FilePicker.browse (which is GM-only). Fixes art pack detection for players.

### Fixed
- Mountain terrain comfort corrected from "exposed" to "rough".
- Discord patch notes embed thumbnail URL now references the correct branch.
- RestSetupApp session recovery now restores terrain and rest type selections when resuming an interrupted long rest.
- Tab visibility re-sync now handles long rest and short rest states independently instead of only checking long rests.

### Changed
- Test suites moved to private repository for IP isolation.

## [1.0.26] - 2026-04-11

### Added
- Mountain and Arctic terrain stubs. These terrains are now registered in the engine and appear in the environment dropdown when a content pack provides events for them.
- Terrain dropdown gating. Terrains without event coverage (core or content pack) are now hidden from the environment dropdown, preventing users from selecting non-viable terrains.

### Fixed
- Duplicate `_onRender` override. A second method definition was silently overriding the first, which caused terrain change listeners, rest type toggles, activity tile clicks, campfire drawer mounting, and meal drag-drop bindings to never execute. All setup-phase interactivity is now restored.
- Banner art now updates immediately when changing the environment dropdown during setup. Previously the banner was stale until the next phase.
- Short rest shelter options now correctly show Rope Trick instead of the long rest set (Tent, Tiny Hut, Mansion). The rest type was being read from the DOM before it existed, always defaulting to "long".
- Content pack event data is now awaited before building the terrain dropdown, fixing a race condition where pack-dependent terrains were excluded on first render.

## [1.0.25] - 2026-04-11

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