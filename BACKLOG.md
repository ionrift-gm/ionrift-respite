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
- [ ] Ensure `RestFlowEngine` checks for these specific items when applying event DCs or save modifiers.

---

## Bugs / QoL

### Reset "Already Rested Today" Flag
- [ ] **Add a config menu button (or extend "Clear Stuck Rest") to clear `lastRestDate`**
  - Reported by Kingsmin (2026-04-10): did a test rest, locked out of resting again on the same in-game day
  - Current workaround: `game.settings.set("ionrift-respite", "lastRestDate", "")` in console
  - Promised in Discord: "I'll add a button to do this from the config menu in the next patch"
  - Consider: fold into the existing `clearRestState` menu, or add a separate lighter-weight "Reset Rest Date" button that doesn't nuke the whole flow

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
