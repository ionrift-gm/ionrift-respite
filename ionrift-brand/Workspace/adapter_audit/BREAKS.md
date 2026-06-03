# BREAKS — Adapter Audit Critical Findings

## 2026-06-03

### R8 — PF2e rest hook names do not exist
- **File:** `scripts/adapters/PF2eAdapter.js:199-206`
- **Impact:** Rest hook interception is silently broken on PF2e. Respite cannot intercept or suppress native PF2e rest recovery. The hook names `pf2e.preShortRest`, `pf2e.preLongRest`, `pf2e.preRestCompleted` are not fired by the PF2e system.
- **Fix:** Replace with `game.pf2e.actions.restForTheNight()` call at rest completion. Redesign rest interception for PF2e since hookable rest flow does not exist.

### R9 — `suppressDefaultRecovery()` is a no-op on PF2e
- **File:** `scripts/adapters/PF2eAdapter.js:209-219`
- **Impact:** PF2e does not use the same rest result structure as DnD5e. `result.updateData` and `result.updateItems` do not exist in PF2e's rest flow. Double recovery (Respite + native PF2e) is possible.
- **Fix:** Dependent on R8. Once rest interception is redesigned, suppression logic must match PF2e's actual recovery mechanism.

### B5 — Temp HP application skipped on PF2e (MealPhaseHandler)
- **File:** `scripts/services/MealPhaseHandler.js:1007-1011`
- **Impact:** Meal buff "temp_hp" type computes the value but only applies it when `game.system.id === "dnd5e"`. PF2e players see the buff summary in chat but receive no temp HP.
- **Fix:** Add `applyTempHP(actor, amount)` adapter method and route through it.

### B6 — Healing application skipped on PF2e (MealPhaseHandler)
- **File:** `scripts/services/MealPhaseHandler.js:1018-1023`
- **Impact:** Meal buff "heal" type is gated behind `game.system.id === "dnd5e"`. PF2e players see healing chat messages but HP is not restored.
- **Fix:** Route through `adapter.applyHPRestore()`.

### B8 — Recovery calculation uses raw system paths (RestFlowEngine)
- **File:** `scripts/services/RestFlowEngine.js:235-237`
- **Impact:** Reads `actor.system.attributes.hd.max` which does not exist in PF2e (returns undefined). Recovery math produces 0 HD recovery and may produce NaN. Also reads `actor.system.details.level` which is wrong for PF2e (should be `system.details.level.value`).
- **Fix:** Replace with `adapter.getHP()`, `adapter.getHitDice()`, `adapter.getLevel()`.

### B11 — Chef temp HP write uses DnD5e path (ShortRestApp)
- **File:** `scripts/apps/ShortRestApp.js:1423`
- **Impact:** Writes `system.attributes.hp.temp` directly. While the path may exist in PF2e, the Chef feat logic is also gated behind `game.system.id === "dnd5e"` (line 1418), so this is effectively dead code on PF2e. Not a crash risk but a broken feature.
- **Fix:** Route through adapter. Consider PF2e equivalent (no Chef feat in PF2e).

### B15 — Exhaustion save outcome uses DnD5e paths (MealPhaseHandler)
- **File:** `scripts/services/MealPhaseHandler.js:1045-1047`
- **Impact:** Exhaustion save resolution (meal buff) reads and writes `system.attributes.exhaustion` directly, gated behind `game.system.id === "dnd5e"`. On PF2e, a successful exhaustion save has no effect — the exhaustion is not reduced.
- **Fix:** Route through `adapter.getExhaustion()` + `adapter.applyExhaustionDelta()`.

### B18 — Skill proficiency uses DnD5e field (ActivityResolver)
- **File:** `scripts/services/ActivityResolver.js:637-638`
- **Impact:** Checks `actor.system.skills[s].proficient > 0`. PF2e skills do not have a `.proficient` field — they use `.rank`. This check returns false for all PF2e skills, blocking activities that require skill proficiency.
- **Fix:** Replace with `adapter.isSkillProficient()`.

### B28 — CON save computation uses DnD5e paths (MealDelegate)
- **File:** `scripts/apps/delegates/MealDelegate.js:579-581, 884-886`
- **Impact:** Reads `actor.system.abilities.con.mod`, `actor.system.abilities.con.save`, `actor.system.attributes.prof`. On PF2e, `con.save` does not exist at this path (PF2e uses `actor.saves.fortitude`). The computed save bonus will be 0 + 0 = 0, making all CON saves trivially easy or hard depending on the DC.
- **Fix:** Add `getSaveBonus(actor, saveKey)` adapter method, or use PF2e's `actor.saves.fortitude.totalModifier`.

### B31 — All meal buff types skip PF2e (MealPhaseHandler)
- **File:** `scripts/services/MealPhaseHandler.js:1007-1239` (8 separate `game.system.id === "dnd5e"` gates)
- **Impact:** The entire meal buff system is non-functional on PF2e. Temp HP, healing, exhaustion saves, hit dice restoration, advantage AEs, and resistance AEs are all gated behind DnD5e system checks. PF2e players see buff descriptions in chat but receive no mechanical effects.
- **Fix:** Route all buff application through adapter methods.

### B43/B44 — ActiveEffect keys are DnD5e-specific (MealPhaseHandler)
- **File:** `scripts/services/MealPhaseHandler.js:1219, 1241`
- **Impact:** AE change keys `system.abilities.${ab}.save.roll.mode` and `system.traits.dr.value` do not exist in PF2e's data model. If these AEs are somehow created on PF2e actors, they will have no mechanical effect. PF2e uses Rule Elements for most bonuses, not ActiveEffect change keys.
- **Fix:** Add adapter method for AE key mapping, or use PF2e Rule Elements for buff application.
