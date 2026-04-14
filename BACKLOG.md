# Ionrift Respite -- Backlog

Canonical backlog for the Respite module. Tracks features, bugs, and technical debt.

---

## Planned

### Flora & Ingredient System (Brewing Pack)

Respite owns all flora/ingredient items. These have mechanical value (foraging results, recipe inputs, profession crafting). Workshop discovers them via its existing "Configure Sources" menu.

- [ ] **Define `ingredientMeta` flag schema** -- `type` (herb/root/bark/fungus/creature_part/fruit), `biomes` (universal/forest/coastal/etc.), `uses` (brewing/cooking/alchemy/poultice/component), `potency` (1-3)
- [ ] **Author core flora compendium** (~25 items, original Ionrift IP) in a `respite-flora` or `brewing-flora` pack
  - Wild Herbs (8): Ashbloom, Thornbloom, Stonecress, Duskpetal, Silverleaf, Whisperthorn, Moonwhisper Bloom, Brine Sage
  - Roots & Bark (6): Ashroot, Greyroot, Dustroot, Emberbark, Coldvein Root, Ironbark Strip
  - Fungi & Moulds (5): Glowcap, Staghorn Mushroom, Dustcap, Velvet Rot, Bloodmould
  - Creature Parts (6): Raptor Feather, Boar Tusk Chip, Wolf Spider Silk, Bat Wing Membrane, Giant Crab Claw, Serpent Gland Sac
- [ ] **Wire foraging activity to flora pool** -- `IngredientResolver` queries compendium by biome + use flags
- [ ] **Define starter recipe set** -- Recipes reference ingredients by `type` + `potency`, not by name
- [ ] **Cooking vs Brewing split** -- Determine if these are separate profession activities or one combined crafting phase

### Jungle Content Pack (Future)
- [ ] Analogue items from riftitems_export.json (ToA-adjacent flora renamed to Ionrift-original names)
- [ ] Biome-tagged `["jungle"]` so they auto-slot into foraging pools via flag filter
- [ ] Reference list of items to analogue documented in Workshop BACKLOG.md

### Situational Gear Enrichments
- [ ] Expand `ItemEnrichmentRegistry` to cover more situational mundane gear.
- [ ] Evaluate items like **Blanket**, **Winter Blanket**, or **Cold Weather Clothing** to provide advantage on specific event saves (e.g. cold-weather exposure events during resolution).
- [ ] Review **Healer's Kit** mechanical use to ensure it actively triggers logic in the `Tend Wounds` activity.
- [ ] Ensure `RestFlowEngine` checks for these specific items when applying event DCs or save modifiers.

### Content Pack Update Mechanism
- [ ] **Add `packVersion` field to content pack JSON schema** -- semver string, compared on import
- [ ] **Version check on load** -- when `_loadContentPacks` runs, compare stored `packVersion` against any embedded minimum version from the module release
- [ ] **"Check for Updates" button in Content Packs settings UI** -- re-download or prompt re-import when a newer pack version is available
- [ ] **Design decision:** pull-based (user re-imports from Patreon) vs push-based (module ships a manifest of current pack versions and flags outdated ones)
  - Pull is simpler and avoids network calls. Ship a `pack_versions.json` with each module release listing the latest version per pack ID. On load, compare stored pack version against the shipped manifest and show a warning badge in the Content Packs UI if outdated.
- [ ] **Migration path** -- if pack schema changes (new fields, renamed keys), the import handler should apply migration transforms so old packs still load but get flagged for update

---

## Bugs / QoL

### Reset "Already Rested Today" Flag
- [ ] **Add a config menu button (or extend "Clear Stuck Rest") to clear `lastRestDate`**
  - Reported by Kingsmin (2026-04-10): did a test rest, locked out of resting again on the same in-game day
  - Current workaround: `game.settings.set("ionrift-respite", "lastRestDate", "")` in console
  - Promised in Discord: "I'll add a button to do this from the config menu in the next patch"
  - Consider: fold into the existing `clearRestState` menu, or add a separate lighter-weight "Reset Rest Date" button that doesn't nuke the whole flow

### ~~Triumph Verdict Shows "Check Failed"~~ (FIXED)
- [x] **Template missing `triumph` outcome handling** -- resolved in v1.0.21
  - Events with `onTriumph` blocks whose group average exceeded DC+5 were classified as `"triumph"` by the resolver but the template only checked for `"success"` and `"partial"`, causing the triumph to fall through to the failure display
  - Fix: added `triumph` branches to all four `resolvedOutcome` conditionals in `rest-setup.hbs`
  - Also fixed: encounter DC tooltip said "Higher DC = safer camp" when lower DC is actually safer

### ~~Sticky restRecoveryDetected Flag~~ (FIXED, awaiting reporter confirmation)
- [x] **Native rest skipped permanently after rest-recovery uninstall** -- resolved in v1.0.21
  - Reported by irie707 (2026-04-11): "it didn't update their character sheets or roll charges for magic weapons" (dnd5e 5.3, Foundry v13)
  - Root cause: `restRecoveryDetected` world setting was set to `true` when rest-recovery was detected but never cleared when it was removed. The flag persists across sessions, permanently skipping `actor.longRest()` (spell slots, item charges, class features)
  - Fix: added `else` branch in module init to clear the flag when rest-recovery is not active
  - Regression test: `test_passthrough_sticky_recovery_flag` (12/12 passing on both dnd5e 5.2.5 and 5.3.0)
  - Awaiting confirmation from reporter -- if they never had rest-recovery, the root cause may be different

### ~~Missing Dice So Nice Animation on Empty Pools~~ (FIXED)
- [x] **Event roll swallowed when no events available** -- resolved in v1.0.21
  - When the encounter roll fell below the DC but no events were loaded for that terrain, `roll.toMessage()` was skipped entirely. No dice animation, no chat message. GM saw "Quiet Rest" with no evidence a roll happened
  - Fix: moved `roll.toMessage()` before the early return in the "no events" path of `EventResolver.roll()`

---

## Cross-Module Integration Notes

### Workshop Discovery (Loose Coupling)
- Workshop's `ItemPoolResolver` + `lootPoolSources` setting already supports discovering any compendium
- When GM enables a Respite flora pack in Workshop's "Configure Sources", flora items appear in loot caches
- **No Workshop code changes required** for this integration
- Workshop never imports Respite code; it reads compendium indexes by flag values only

### Dependency Direction
```
Respite (publishes items) ──compendium──> Workshop (discovers via lootPoolSources)
```
Workshop has no hard dependency on Respite. Respite has no hard dependency on Workshop.
