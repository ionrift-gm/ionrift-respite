/**
 * Meal choice application: consume selected items from inventory (multi-day,
 * partial-supply aware), credit cross-satiation, update hunger/thirst tracking
 * flags, and compute starvation/dehydration consequences.
 */

import { Logger } from "../lib/Logger.js";
import { ItemClassifier } from "./ItemClassifier.js";
import { consumeItem } from "./MealItemConsumer.js";
import { dispatchWellFedMealServing } from "./WellFedService.js";
import { MODULE_ID, MEAL_DEFAULTS } from "./MealConstants.js";

/**
 * Wet meals and party meals credit water (and party meals credit food for allies
 * who did not spend a food slot on the shared dish).
 */
export function accumulateMealSatiation(snapshot, amount, consumerCharId, partyIds, extraWaterByChar, extraFoodByChar) {
    const rf = snapshot.flags?.[MODULE_ID] ?? {};
    if (rf.chefTreat) return;
    const targets = rf.partyMeal ? [...partyIds] : [consumerCharId];
    for (let u = 0; u < amount; u++) {
        for (const tid of targets) {
            const targetActor = game.actors.get(tid);
            if (!targetActor || !ItemClassifier.requiresSustenance(targetActor)) continue;
            if (rf.satiates?.includes("water")) {
                extraWaterByChar.set(tid, (extraWaterByChar.get(tid) ?? 0) + 1);
            }
            if (rf.partyMeal && rf.satiates?.includes("food")) {
                if (tid === consumerCharId) continue;
                extraFoodByChar.set(tid, (extraFoodByChar.get(tid) ?? 0) + 1);
            }
        }
    }
}

/**
 * Apply meal choices: consume items from inventory and update tracking flags.
 * Supports multi-day consumption: consumes min(needed, available) units.
 * Shortfall (needed - consumed) becomes hungry/thirsty days that increment the flags.
 *
 * @param {Map} mealChoices - characterId -> { food, water }
 * @param {number} daysSinceLastRest - Days elapsed (units needed = days * terrain rate)
 * @param {Object} terrainMealRules - Terrain overrides for per-day requirements
 * @returns {Object[]} Results summary per character
 */
export async function applyMealChoices(mealChoices, daysSinceLastRest = 1, terrainMealRules = {}) {
    const rules = { ...MEAL_DEFAULTS, ...terrainMealRules };
    const results = [];
    const partyIds = [...mealChoices.keys()];
    const extraWaterByChar = new Map();
    const extraFoodByChar = new Map();

    /** @type {Map<string, { foodUsage: Map<string, number>, snapMap: Map<string, object> }>} */
    const mealSnapshotsByChar = new Map();

    for (const [charId, choice] of mealChoices) {
        const actor = game.actors.get(charId);
        if (!actor) continue;

        const foodUsage = new Map();
        for (const day of (choice.consumedDays ?? [])) {
            if (day.itemsConsumed) continue;
            for (const id of (day.food ?? [])) {
                if (ItemClassifier.isMealSlotSelection(actor, id)) {
                    foodUsage.set(id, (foodUsage.get(id) ?? 0) + 1);
                }
            }
        }
        const snapMap = new Map();
        for (const itemId of foodUsage.keys()) {
            const it = actor.items.get(itemId);
            if (it) snapMap.set(itemId, it.toObject(false));
        }
        mealSnapshotsByChar.set(charId, { foodUsage, snapMap });

        for (const [itemId, amount] of foodUsage) {
            const snap = snapMap.get(itemId);
            if (snap) {
                accumulateMealSatiation(
                    snap, amount, charId, partyIds, extraWaterByChar, extraFoodByChar
                );
            }
        }
    }

    for (const [charId, choice] of mealChoices) {
        const actor = game.actors.get(charId);
        if (!actor) continue;

        const totalDays = daysSinceLastRest;
        const consumedDays = choice.consumedDays ?? [];

        const result = {
            characterId: charId,
            actorName: actor.name,
            ate: false,
            drank: false,
            foodConsumed: 0,
            waterConsumed: 0,
            foodShortfall: 0,
            waterShortfall: 0,
            starvationExhaustion: 0,
            dehydrationSaveDC: 0,
            dehydrationAutoFail: false
        };

        if (!ItemClassifier.participatesInSustenance(actor)) {
            result.exempt = true;
            results.push(result);
            continue;
        }

        // Count filled slots across all consumed days
        let totalFoodFilled = 0;
        let totalWaterFilled = 0;
        for (const day of consumedDays) {
            totalFoodFilled += (day.food ?? []).filter(id => ItemClassifier.isMealSlotSelection(actor, id)).length;
            totalWaterFilled += (day.water ?? []).filter(id => id && id !== "skip").length;
        }

        const foodNeeded = totalDays * rules.foodPerDay;
        const waterNeeded = totalDays * rules.waterPerDay;

        const effectiveFood = totalFoodFilled + (extraFoodByChar.get(charId) ?? 0);

        // Station-submitted (itemsConsumed) days are skipped by the foodUsage path
        // that feeds extraWaterByChar, so their wet-meal water would otherwise be
        // dropped. Credit the persisted per-day bonusWater here so the dehydration
        // decision uses the same water total as the Hydrated badge. This is additive
        // to extraWaterByChar (non-consumed days only) and totalWaterFilled (waterskin
        // slots only), so no source is double-counted.
        let consumedMealWater = 0;
        for (const day of consumedDays) {
            if (!day.itemsConsumed) continue;
            if (typeof day.bonusWater === "number") {
                consumedMealWater += day.bonusWater;
            } else {
                // Fallback for older/edge submissions without a stored bonusWater:
                // recompute from meal-slot food items that satiate water, matching
                // the non-consumed foodUsage path above.
                for (const id of (day.food ?? [])) {
                    if (!ItemClassifier.isMealSlotSelection(actor, id)) continue;
                    const it = actor.items.get(id);
                    const satiates = it?.flags?.[MODULE_ID]?.satiates;
                    if (Array.isArray(satiates) && satiates.includes("water")) consumedMealWater++;
                }
            }
        }

        const effectiveWater = totalWaterFilled + (extraWaterByChar.get(charId) ?? 0) + consumedMealWater;

        result.foodConsumed = effectiveFood;
        result.waterConsumed = effectiveWater;
        result.ate = effectiveFood > 0;
        result.drank = effectiveWater > 0;
        result.foodShortfall = Math.max(0, foodNeeded - effectiveFood);
        result.waterShortfall = Math.max(0, waterNeeded - effectiveWater);

        // --- Actually consume items from inventory ---
        // Skip if items were already consumed at station submission time

        if (!choice.itemsConsumed) {
            const foodUsage = mealSnapshotsByChar.get(charId)?.foodUsage ?? new Map();
            const snapMap = mealSnapshotsByChar.get(charId)?.snapMap ?? new Map();
            const waterUsage = new Map();
            for (const day of consumedDays) {
                if (day.itemsConsumed) continue;
                for (const id of (day.water ?? [])) {
                    if (id && id !== "skip" && !id.startsWith("__")) waterUsage.set(id, (waterUsage.get(id) ?? 0) + 1);
                }
            }
            for (const [itemId, amount] of foodUsage) {
                const snapshot = snapMap.get(itemId);
                const consumed = await consumeItem(actor, itemId, amount);
                Logger.log(`[Respite:Meal] Consumed ${consumed}x food item ${itemId} from ${actor.name}`);
                if (snapshot && consumed > 0) {
                    for (let u = 0; u < consumed; u++) {
                        await dispatchWellFedMealServing({
                            consumerActor: actor,
                            itemSnapshot: snapshot,
                            partyIds
                        });
                    }
                }
            }
            for (const [itemId, amount] of waterUsage) {
                const consumed = await consumeItem(actor, itemId, amount);
                Logger.log(`[Respite:Meal] Consumed ${consumed} pint(s) from water item ${itemId} from ${actor.name}`);
            }
        }

        // Update tracking flags (tracks DAYS without adequate food/water, not units)
        if (result.foodShortfall === 0) {
            await actor.setFlag(MODULE_ID, "restsSinceFood", 0);
        } else {
            const current = actor.getFlag(MODULE_ID, "restsSinceFood") ?? 0;
            await actor.setFlag(MODULE_ID, "restsSinceFood", current + 1);
        }

        if (result.waterShortfall === 0) {
            await actor.setFlag(MODULE_ID, "restsSinceWater", 0);
        } else {
            const current = actor.getFlag(MODULE_ID, "restsSinceWater") ?? 0;
            await actor.setFlag(MODULE_ID, "restsSinceWater", current + 1);
        }

        // --- Starvation exhaustion (PHB p.185) ---
        // Grace period: 3 + CON mod days without food before consequences
        // Each day past grace = 1 level of exhaustion (auto-applied)
        const conMod = actor.system?.abilities?.con?.mod ?? 0;
        const foodGrace = rules.foodGraceDays ?? (3 + Math.max(0, conMod));
        const restsSinceFood = actor.getFlag(MODULE_ID, "restsSinceFood") ?? 0;
        if (restsSinceFood > foodGrace) {
            result.starvationExhaustion = restsSinceFood - foodGrace;
        }

        // --- Dehydration consequences (PHB p.185) ---
        // Any day without water: CON save DC 15 or gain 1 exhaustion
        // If already dehydrated (2+ rests): auto-fail (no save)
        const restsSinceWater = actor.getFlag(MODULE_ID, "restsSinceWater") ?? 0;
        if (restsSinceWater > 0) {
            if (restsSinceWater >= 2) {
                result.dehydrationAutoFail = true;
            } else {
                result.dehydrationSaveDC = rules.dehydrationDC ?? 15;
            }
        }

        results.push(result);
    }

    return results;
}

/**
 * Process and apply meal choices: auto-consume active selections, then compute consequences.
 * This is the testable orchestration method called by #onProceedFromMeal.
 *
 * @param {Map} mealChoices - characterId -> { food, water, consumedDays, currentDay }
 * @param {number} totalDays - Days elapsed since last rest
 * @param {Object} terrainMealRules - Terrain overrides (waterPerDay, foodPerDay, etc.)
 * @returns {{ mealChoices: Map, results: Object[] }} Updated choices and consequence results
 */
export async function processAndApply(mealChoices, totalDays = 1, terrainMealRules = {}) {
    // Auto-consume: if a character has active food/water selections but hasn't
    // consumed all days, fold those selections into consumedDays.
    for (const [charId, choice] of mealChoices) {
        const actor = game.actors.get(charId);
        const consumed = choice.consumedDays ?? [];
        const food = Array.isArray(choice.food) ? choice.food : [];
        const water = Array.isArray(choice.water) ? choice.water : [];
        const hasActiveSelections = actor
            ? (food.some(id => ItemClassifier.isMealSlotSelection(actor, id))
                || water.some(id => id && id !== "skip"))
            : (food.some(id => id && id !== "skip") || water.some(id => id && id !== "skip"));

        if (consumed.length < totalDays && hasActiveSelections) {
            consumed.push({ food: [...food], water: [...water] });
            mealChoices.set(charId, {
                ...choice,
                consumedDays: consumed,
                currentDay: consumed.length,
                food: [],
                water: []
            });
            Logger.log(`[Respite:Meal] Auto-consumed active selections for ${charId} (day ${consumed.length})`);
        }
    }

    const results = await applyMealChoices(mealChoices, totalDays, terrainMealRules);
    return { mealChoices, results };
}
