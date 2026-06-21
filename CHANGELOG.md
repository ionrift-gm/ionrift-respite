# Changelog

## [3.3.2] - 2026-06-21

### Fixed
- Cooking and other camp crafting activities open again. Selecting one no longer makes the rest window fail to render.
- The campfire panel no longer sits beside the crafting view. Crafting takes the full width again.
- Opening a crafting activity now preselects a craftable recipe so the panel shows details right away. When nothing can be made, it says so instead of sitting on an empty prompt.

### Removed
- Brewing as a separate camp activity. Cooking stays the camp provisioning profession. Brewing will return once it has a complete recipe set.
- Tailoring as a camp activity. Cooking is the only crafting profession in the base module for now.

## [3.3.1] - 2026-06-21

### Added
- **Homebrew recipe editor.** GMs can author custom recipes per profession that merge with any installed content pack. Crafted results sync into a world compendium so they resolve to real items.
- **Terrain foraging.** Foraging now rolls from per-terrain tables built from the compendium, with a find-rate slider to tune how generous the rolls are. A camp fuel table lets the party gather firewood and kindling while travelling.
- **Chef feat support.** Enables raw-cooking mode and chef treat effects so characters with the Chef feat get meaningful benefits at camp.
- **Player loot rolls.** Players roll their own d100 loot after a successful travel leg.

### Changed
- Travel and professions are decoupled, so foraging and crafting no longer depend on each other being set up.
- Copy Spell is now limited to wizards and Pact of the Tome warlocks.

### Fixed
- Bolstering treat now resolves as an automatic success and shows the correct icon.
- PF2e proficiency bonus scaling is bounded to a 5e-equivalent range so cross-system rest checks stay balanced.

## [3.2.0] - 2026-06-15

### Fixed
- Rest setup now correctly guards the phase transition when the setup window is closed before the phase completes, preventing a stale state on re-open.
- The GM guide compendium now only compiles pages that have substantive content, removing blank pages from the in-game journal.

## [3.1.6] - 2026-06-12

### Fixed
- **Campfire placement.** Dragging the campfire onto the map and clicking Place fire both work again. A broken guard was silently discarding every placement attempt.
- **Fire lighting.** Players can use their tinderbox and fire cantrips to light the campfire again. The strike and cantrip buttons were blocked by a stale placement check that prevented the ceremony from advancing.

## [3.1.5] - 2026-06-11

### Added
- **Custom event import.** GMs can import JSON event packs directly from the Curate Event Pool panel in the Respite config menu.
- **Legacy pack terrain filters.** Community packs that share a core terrain tag (e.g. Tavern) appear as a separate filter entry rather than mixing with core events in the pool.
- Imported packs with unknown terrain tags register as custom terrains for curation purposes - travel and forage stay off by default.

### Changed
- Content pack import and event pool import now share the same validation and review flow.

## [3.1.4] - 2026-06-09

### Fixed
- **GM rest session.** Player travel declarations, activity choices, and fire-level requests now reach the GM correctly even if the rest window was minimised or had a render error during setup.
- Travel-to-camp transition now advances player UIs in sync with the GM instead of occasionally leaving players stuck on the travel phase.
- Players who reload mid-travel now rejoin the rest session immediately rather than waiting for the next snapshot.

## [3.1.3] - 2026-06-09

### Fixed
- **Player rest window sync loop.** The player-side rest window no longer repeatedly requests state from the GM when a rest starts. It now hydrates from the broadcast payload directly.
- **Travel gather options not syncing to players.** Forage, hunt, and scout availability now reflects what the GM has configured, correctly, on the player side.

## [3.1.2] - 2026-06-09

### Fixed
- **PF2e actor sheet.** The diet button and inventory controls on the PF2e character sheet now display and function correctly during the rest flow. A layout clash with PF2e's native sheet structure was preventing them from rendering.
- **PF2e status effects.** The unconscious and prone conditions now apply correctly at rest completion on PF2e. PF2e stores status effects as an object rather than an array, which was causing the bedding-down effects to silently fail.

## [3.1.0] - 2026-06-07

### Added
- **Expanded system support.** Added full compatibility adapters for Starfinder Roleplaying Game (SFRPG), Pathfinder 1e, D&D 3.5e, and Old-School Essentials (OSE).
- **System-native recovery.** Short and long rest recovery correctly maps Hit Dice, HP, spell slots, and condition effects (e.g. fatigue/exhaustion) to the newly supported systems natively.

## [3.0.4] - 2026-06-07

### Added
- **System support.** Added initial compatibility adapters for Old-School Essentials (OSE), Starfinder Roleplaying Game (SFRPG), Pathfinder 1e, and D&D 3.5e.

### Changed
- **Campfire minigame.** The interactive campfire lighting ceremony is now fully available in Stations mode when comfort features are enabled.
- **Campfire management.** Players can now light, douse, and rebuild the fire directly during the Activity phase.

### Fixed
- Fixed a crash that could occur during the travel resolution phase when certain activities were undefined.
- Fixed the campfire heat meter occasionally highlighting the incorrect temperature tier.
- Fixed state desyncs during the campfire minigame and when players rejoin an active Make Camp session.

## [3.0.3] - 2026-06-06

### Fixed
- **Closing the event picker no longer soft-locks the rest.** Dismissing the event selection dialog during the event phase now cancels cleanly instead of leaving the rest unable to proceed.
- **Tavern rests now work correctly in station mode.** Running a tavern rest while the interface is set to Stations mode previously caused the activity phase to break. Tavern terrain now forces Theater of the Mind for the duration of the rest automatically.
- Players rejoining mid-rest while a campfire is lit no longer see the fire as unlit until the next GM action. The campfire state now syncs immediately on reconnect.

### Changed
- **Travel & Activities settings split into two columns.** Travel options (foraging, hunting, scouting) and activity options (pray/meditate, training) are now grouped separately. Each can be toggled on or off independently.
- Training and Pray / Meditate default to off for all Quick Setup profiles and new worlds. Turn them on under Travel & Activities when wanted.
- **Tavern terrain locks Safe Rest on** for the duration of setup. The toggle stays visible but cannot be unchecked while Tavern is selected. Switching away from Tavern clears Safe Rest automatically.
- Tavern rests now include a full activity phase. Workbench and room stations are available; watch, defenses, campfire, and Rest Fully are withheld.
- Setup badges (Comfort, Professions, Meals) fade when Tavern is selected to reflect what actually runs at an inn.

## [3.0.2] - 2026-06-03

### Added
- **Campfire ceremony.** Lighting a fire in Theater of the Mind mode is now a hands-on moment - players place kindling, choose their fire tier, and light it via tinderbox strike or a fire cantrip before the rest advances to activities. The campfire panel stays open in the activities sidebar while the rest is running.
- The campfire minigame setting is on by default for Standard and Survival profiles and can be toggled from Quick Setup.

### Changed
- **Simple profile with map stations limits the camp layout.** When running the Simple profile with canvas stations enabled, only the bedroll and workbench are placed. Other activities are auto-assigned.
- The meal phase now shows one terrain alert at the top rather than repeating it per slot.

### Fixed
- Detect Magic at rest no longer prompts for spell slots or concentration, cleans up its template and effects when dismissed or when the phase changes, and shows animated workbench cues during the scan.
- Encounter DC preview now updates live as you pick a fire tier during Make Camp.

## [3.0.1] - 2026-06-03

### Added
- **Travel scouting toggle.** GMs can enable a scouting phase during travel, accessible from Quick Setup and the Advanced drawer.
- **Copy Spell setting.** Copy Spell can now be enabled or disabled independently in Activity Config and respects Quick Setup profiles.

### Changed
- **Comfort rules now live in the Survival profile.** Simple and Standard rests no longer surface comfort mechanics - comfort tracking, terrain penalties, and the exhaustion save are Survival-only. Tables that want the full ruleset pick Survival; everyone else gets a cleaner setup screen.
- **Simple profile has no event phase.** The rest moves straight from activities to resolution. No rolls, no encounters, no decision trees - just the party asleep and a continue button.

### Fixed
- Training rolls now run inline in the rest panel with correct state persistence across page refreshes. XP awards, the tier slider, and diminishing returns for back-to-back sessions all work as intended.
- Food and water are no longer consumed twice when using day-by-day meal tracking across a multi-day rest.
- Well Fed chat summaries now appear correctly for advantage and resistance buffs.
- HP, skill checks, level reads, Hit Die spending, short rest recovery, currency, and tool proficiency lookups all route through the system adapter - removing hardcoded 5e paths that would have silently broken on PF2e and Daggerheart.

## [3.0.0] - 2026-06-02

### Added
- **Foundry v14 compatible.** Party roster uses the native v14 party system on DnD5e. Existing v13 worlds are unaffected.
- **Rest setup profiles.** Three presets - Simple, Standard, and Survival - replace the wall of checkboxes when starting a rest. Pick a profile that matches how much detail your table wants and the rest configures itself. A custom card is there for anything that deviates. Settings are reorganized into Rest Activities, Recovery Rules, and Player Restrictions submenus so the full configuration is reachable without being in your face.
- **Built-in help.** A question-mark button in the rest header opens the Respite guide at any time. Players land on the quick reference, the GM on the full reference. The guide has been rewritten from five pages to three. Comfort badges, terrain indicators, and phase dots now show context on hover across every dialog.

### Changed
- **Event cards reworked.** When an event puts gear or coin at risk, the GM rolls which items are affected, can re-roll if the result doesn't fit, and confirms before anything is actually removed. Nothing leaves a character sheet without GM sign-off. Narration and guidance now read as plain instructions instead of surfacing internal rule names. Non-combat events no longer open the combat tracker.
- **UI pass for readability.** Every panel in the rest flow has been revisited for spacing, hierarchy, and legibility. Nothing has moved or been renamed - the layout is the same flow you know, just easier to read and less cluttered at a glance.
- **Training redesigned.** Training runs as three separate sets per rest. The player rolls each set, filling a progress bar - every landed set earns 10 XP, a missed set earns 3. XP is now actually written to the character sheet, and the diminishing-returns penalty for consecutive training rests works as intended.
- **Rest summary split into recovered and setbacks.** What went well and what went wrong show separately instead of mixing into a single list.
- Comfort rules are now a homebrew toggle that can be disabled entirely.
- Reflection phase removed from the rest flow.

### Fixed
- Theft events no longer take ammunition. Item selection no longer fixates on the cheapest stack, so the loot taken is more believable.
- A partial success on a rest event now applies its own lighter consequences instead of the full failure result.
- Cooking, foraging, feast servings, and party discoveries use a per-rest grant ledger, so no reward can be claimed twice by refreshing or resubmitting. Travel declarations and forage results also survive browser refreshes.
- Party feast recipes now scale to the whole party from every cooking screen.
- Safe rest spots waive meals - no dehydration or starvation saves at a non-tavern safe location.

## [2.4.0] - 2026-05-26

### Changed
- Terrain data is plug-and-play. The module ships only its base terrains; Ruins, Catacombs, Arctic, and Mountain now travel with their content overlays. Installing an overlay adds its terrains and events automatically, with no module patch required.
- Module settings now expose one **Reset Rest State** button instead of separate daily cooldown and full reset controls.

## [2.3.0] - 2026-05-24

### Added
- **Simple Calendar Reborn compatibility.** Respite now detects both the original Simple Calendar and the Reborn fork, so date tracking works whichever version you run.
- **Unclean condition.** A new rest event outcome can impose the Unclean condition, giving disadvantage on Charisma checks until the character bathes or the condition is removed.

### Fixed
- **Ruins and Catacombs** now appear in the rest setup Environment dropdown and in Quartermaster terrain lists. Terrain data and events were already in the module; they were omitted from the release manifest, so the registry never loaded them.
- **Bone & Dust terrain banners** now resolve from the overlay install path. The art resolver only probed the core and Frost & Stone supplements, so Ruins and Catacombs kept the placeholder banner after pack install.
- Environment and Cache Generator terrain dropdowns are grouped into **Dungeon** (Dungeon, Ruins, Catacombs), **Safe Haven** (Tavern), and **Wilderness** (outdoor terrains).
- **Event Browser** terrain filter now uses the same `TerrainRegistry` list and grouping as rest setup, and loads event files from each released terrain's `eventsFile` path so Ruins, Catacombs, and Tavern events appear in the browser.
- Party-wide events now correctly target all eligible characters instead of only the watch character when the event scope calls for it.
- Event tier and failure outcomes now route to the correct scope, fixing cases where a mixed result would apply effects intended for the failure tier.
- Terrain banners now display correctly when the Respite content pack is installed through the Patreon Library. Previously the rest setup screen kept showing the placeholder banner even with the pack present, because the art resolver only looked at the older zip-import folder.

## [2.2.6] - 2026-05-20

### Added
- Content packs now correctly populate and report their status against the remote manifest. The Library shows the full set of available packs, and each can be toggled on or off independently.
- A reminder appears in Module Settings when default token art is in use and the Respite art pack has not been installed. The reminder shares dismiss and snooze state with the existing in-app camp-phase prompt.

### Changed
- The art and content nudges now use the shared Ionrift Library banner. Existing snooze and dismiss choices carry over.

## [2.2.4] - 2026-05-17

### Fixed
- **Rest Fully is now available during safe rests.** Characters with exhaustion can choose Rest Fully at a tavern or safe campsite to reduce an extra exhaustion level. The activity card shows an advisory when this matters - urgent yellow at 2+ exhaustion, informational at 1.
- Sleeping in medium or heavy armor now correctly blocks the base exhaustion reduction on a long rest outside a safe location, as per the Xanathar's variant rule. The Rest Fully bonus still applies on top.
- Armor sleep penalties no longer apply at safe rest spots. Characters at a tavern or allied camp are assumed to manage their own gear - no Hit Die penalty, no exhaustion block.
- Party portraits now appear on activity cards even when the card is greyed out for the currently selected character. Randal choosing Rest Fully was invisible to the rest of the party.

## [2.2.3] - 2026-05-17

### Fixed
- **Detect Magic no longer lingers after a rest.** The scan glow and any active effects from a Detect Magic cast during the workbench session are now stripped from all party members when the rest concludes - whether completed or abandoned. Previously the effect would persist on actor sheets with no way to clear it short of a world reload.
- Abandoning a short rest now clears the Detect Magic scan state. The glow and dismiss toggle no longer carry over to the next session.
- The Workbench Detect Magic button now shows players which character has the spell available and why, instead of showing nothing when a player can use it.
- Workbench focus hint updated to cite the correct rule reference (DMG p.136).
- The Abandon Rest button on the short rest screen is now consistently aligned with the rest header, matching the long rest layout.
- New worlds now default to Theater of the Mind mode for the rest interface. Worlds that already have a saved setting are not affected.

## [2.2.2] - 2026-05-14

### Fixed
- **Fresh installs now load all compendium data.** Installing Respite for the first time (or reinstalling) resulted in empty compendiums: no campfire actor, no forage items, no guide journal. Camp stations would not place, and foraging was greyed out with a "requires content pack" tooltip. Existing installs that had been updated in-place were unaffected. This has been broken since v2.0.3.
- All camp station actors are now present in the Respite Actors compendium: Campfire, Arcane Workbench, Medical Bedding, Weapon Rack, Cooking Station, Bedroll, Tent, and Mess Kit. Previously only the Workbench survived the packaging step.

## [2.2.0] - 2026-05-13

### Added
- **Safe Rest Spot.** A new toggle in the setup phase that marks the campsite as safe. Encounter rolls, night events, comfort penalties, and camp defense are all disabled. Activities like cooking, crafting, and identification still work normally. Useful for taverns you want to control, allied fortresses, or any location where the party is genuinely secure.
- Safe rest spots skip the entire event phase and suppress comfort-tier penalties. Recovery uses the "safe" tier regardless of terrain, so characters heal fully with no exhaustion risk.
- Activities that only matter when there is danger - Keep Watch, Set Up Defenses, Scout Perimeter, Tend Wounds, and Rest Fully - are hidden from the activity picker during a safe rest.
- The setting persists between rests, so the GM does not need to re-check it if the party stays in the same location.

### Changed
- Party roster portraits moved into the Advanced drawer to keep the main setup screen focused.

## [2.1.5] - 2026-05-12

### Fixed
- Foraging is no longer blocked during camp rests. Supersedes v2.1.4, which had the same fix but a broken release build. No other changes.

## [2.1.4] - 2026-05-12

### Fixed
- **Foraging is no longer blocked during camp rests.** A fresh install without a content pack imported would grey out the Forage activity with a "requires pack" tooltip. The gate was designed for travel-phase foraging and was incorrectly applied to camp rests. Forage now works out of the box on any terrain that has items in the shipped compendium.
- Revelation cards no longer incorrectly show "Requires Attunement" for identified items that don't need it.

## [2.1.3] - 2026-05-08

### Fixed
- Module failed to load on startup. The v2.1.0 release shipped with source files that were out of sync, causing a cascade of silent import errors. Supersedes v2.1.1 and v2.1.2 which each partially fixed the issue. This release ships the complete, consistent codebase.

## [2.1.0] - 2026-05-07

### Added
- **Theater of the Mind mode.** All rest activities - weapons rack, workbench, bedroll, first aid, cooking, fire setup, and crafting - now work without placing a camp on the map. Enable it in module settings under "Rest Interface Mode". Stations (canvas overlays) remain the default for tables that use a prepared scene; TotM is opt-in.
- **TotM crafting inline.** Crafting activities resolve inside the TotM panel instead of opening a separate dialog. Roll outcomes, blocking overlays, and the feast disposition flow ("Serve Now" vs. "Keep in inventory") all work the same as the station-based flow.
- **TotM fire setup.** Lighting the campfire in TotM mode uses the same firewood spend logic as the spatial mode - prioritising the player who set the fire level, then falling back to other party members, with an error prompt if there is not enough wood.
- **TotM meal phase.** Food and water submission, feast serving, and the water pool bar work inline in TotM without canvas interaction.
- **Detect Magic in TotM.** The animated scan, item glow, and dismiss toggle all work in TotM mode.

### Changed
- The GM minimised rest indicator no longer requires meal submission in TotM mode - it reads readiness directly from activity state.
- `_mealSubmitted` is now synced across the party during feast-serving flows so the submit button and navigation gates respond correctly on all clients.

### Fixed
- Ration submission in the station activity dialog now triggers an immediate UI refresh across all clients instead of waiting for the next polling cycle.
- Water slots fulfilled by a feast sentinel value (`__feast_water`) now correctly bypass the dehydration check for all party members.
- False-positive "skip meal" warnings no longer fire when bonus water from food credits covers the full water requirement.

## [2.0.8] - 2026-05-04

### Fixed
- Drinking water now spends pints from your waterskin charges instead of consuming whole waterskins. A full waterskin (8 pints) lasts 4 days at 2 pints per day, as intended by the v2.0.6 rework.
- Failing a CON save in rough terrain now actually imposes exhaustion. Previously, the long rest's natural recovery cancelled the penalty before it was applied, making the save meaningless.

## [2.0.7] - 2026-05-04

### Fixed
- Players cooking a feast and clicking "Serve Now" no longer get a permission error. The feast serve and party meal distribution now route through the host, so players don't need direct ownership of every party member's character sheet.
- After serving a feast, players can interact with other stations again. The permission failure was cascading into a broken activity state that blocked all further station clicks.

## [2.0.6] - 2026-05-04

### Changed
- **Water consumption reworked.** Each character now drinks 2 pints per day instead of consuming a whole container. Waterskins hold 8 pints, flasks hold 2. The station meal embed shows a pool bar that fills as you pour water from inventory, so you can see exactly how much is left.
- Arctic terrain now doubles water and food requirements. The station rations embed shows terrain alerts when requirements are increased.
- Cooking recipes that need water now call for pints as a generic ingredient instead of requiring a whole waterskin.

### Fixed
- Players could not see foraging or hunting options during the travel phase. The GM saw all travel activities but player clients showed "Foraging and hunting are not available" for every terrain except dungeon. Mountain, forest, swamp, desert, arctic, tavern, and urban were all affected.
- Station rations embed no longer clips the submit button when the meal card is tall. The submit row is now pinned to the bottom of the panel.
- Station water pool bar no longer stretches across the full column width on wide screens.
- Campfire drawer no longer logs a warning on player clients during the travel phase. The auto-open was firing regardless of which phase the rest was in.

## [2.0.5] - 2026-05-03

### Fixed
- Construct characters using custom diet items (Scrap Metal, Oil, Iron Filings, etc.) now see those items in the correct meal tray lanes. Oil no longer duplicates across both food and water slots when the diet does not allow it.
- Water classification no longer skips Oil when the item classifier returns null for a non-standard item.
- Spoilage timers no longer error when a food item has no spoilsAfter flag set.
- The art pack update nudge now appears for users who have an older art pack installed. Previously it only checked whether any art pack existed - so users with v1.0 terrain art were never prompted to update for station token support. The banner now shows "A newer art pack is available" with an "Update Art Pack" button when the installed pack is missing station tokens.

## [2.0.4] - 2026-05-03

### Fixed
- Construct (and other essence-based) characters now correctly see their custom essence items in the Rations picker. Items listed in the Essence Items field of the Diet Configuration were not appearing because the classifier wasn't checking the character's diet when scanning inventory, only the built-in essence name list. Scrap Metal, Iron Filings, and any other custom essence items now show up as expected.

## [2.0.3] - 2026-05-03

### Changed
- **Published bundle matches the shipped compendium set.** The install archive only includes compendiums that are cleared for distribution.

### Added
- **Tavern resting.** Selecting a tavern terrain now skips campfire setup and station placement. All characters are automatically set to Rest Fully, meals are waived, and the flow advances straight to reflection or resolution.
- Tavern stations are filtered to context-appropriate options - campfire and weapon rack are hidden, bedroll becomes "Your Room", and the cooking station becomes "Hearth & Table".

### Fixed
- Skip button on the camp placement phase no longer soft-locks the rest flow.
- Activities and meals are now optional in tavern environments, preventing soft-locks when no workstations are placed.

## [2.0.2] - 2026-05-03

### Fixed
- The art pack nudge and Content Packs screen incorrectly linked to a Patreon-gated collection. The core art pack is free; all download links now point to the public post.
- Pack registry marked the core art pack as Acolyte tier. Corrected to Free.

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
- **Durable feat support.** Characters with the Durable feat now have a minimum healing floor of 2x their CON modifier on each Hit Die roll. Detected automatically from the character sheet.
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
- Force Pass / Force Fail outcomes. When forced, no dice are rolled. The result is synthetic, posted immediately, and shown to the player as a confirmed outcome rather than a standard roll.
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
