/**
 * Build per-character meal cards for the Meal phase: slot layout, satiation
 * cross-credit preview, advisories, day segments, and terrain alerts.
 */

import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MODULE_ID, MEAL_DEFAULTS } from "../inventory/MealConstants.js";
import { buildFoodOptions, buildWaterOptions, buildAdvisories } from "./MealOptionBuilder.js";

/**
 * Compute total per-actor food and water needs per day taking into account:
 * - Base terrain/world rules
 * - Actor flags (foodMultiplier, waterMultiplier, foodModifier, waterModifier, foodPerDay, waterPerDay)
 * - Essence actor requirements
 * - Sustenance ceiling caps (maxWaterPerDay, maxFoodPerDay)
 * - Module hook `ionrift-respite.getActorMealNeeds`
 *
 * @param {Object} actor - Foundry Actor instance
 * @param {Object} rules - Effective rules merged with terrain overrides
 * @returns {Object} { foodPerDay, waterPerDay, needsEssence, foodMultiplier, waterMultiplier, foodModifier, waterModifier, isModified }
 */
export function getActorMealNeeds(actor, rules = {}) {
    const effectiveRules = { ...MEAL_DEFAULTS, ...rules };
    const baseFood = effectiveRules.foodPerDay ?? MEAL_DEFAULTS.foodPerDay;
    const baseWater = effectiveRules.waterPerDay ?? MEAL_DEFAULTS.waterPerDay;

    const rf = actor?.flags?.[MODULE_ID] ?? {};
    const foodMult = typeof rf.foodMultiplier === "number" ? rf.foodMultiplier : 1;
    const waterMult = typeof rf.waterMultiplier === "number" ? rf.waterMultiplier : 1;
    const foodMod = typeof rf.foodModifier === "number" ? rf.foodModifier : 0;
    const waterMod = typeof rf.waterModifier === "number" ? rf.waterModifier : 0;

    let maxWaterCap = effectiveRules.maxWaterPerDay ?? MEAL_DEFAULTS.maxWaterPerDay ?? 4;
    let maxFoodCap = effectiveRules.maxFoodPerDay ?? MEAL_DEFAULTS.maxFoodPerDay ?? 3;
    try {
        if (typeof game !== "undefined" && game?.settings?.get) {
            const settingWaterCap = game.settings.get(MODULE_ID, "maxWaterPerDayCap");
            if (typeof settingWaterCap === "number" && settingWaterCap > 0) maxWaterCap = settingWaterCap;
            const settingFoodCap = game.settings.get(MODULE_ID, "maxFoodPerDayCap");
            if (typeof settingFoodCap === "number" && settingFoodCap > 0) maxFoodCap = settingFoodCap;
        }
    } catch (_) {}

    // Calculate actor extra from multipliers/modifiers relative to PHB baseline
    const actorFoodExtra = Math.round(MEAL_DEFAULTS.foodPerDay * (foodMult - 1)) + foodMod;
    const actorWaterExtra = Math.round(MEAL_DEFAULTS.waterPerDay * (waterMult - 1)) + waterMod;

    let calculatedFood = baseFood + actorFoodExtra;
    let calculatedWater = baseWater + actorWaterExtra;

    if (typeof rf.foodPerDay === "number") calculatedFood = rf.foodPerDay;
    if (typeof rf.waterPerDay === "number") calculatedWater = rf.waterPerDay;

    let foodPerDay = Math.max(0, Math.min(maxFoodCap, calculatedFood));
    let waterPerDay = Math.max(0, Math.min(maxWaterCap, calculatedWater));

    const isEssence = actor ? ItemClassifier.requiresEssence(actor) : false;
    if (isEssence) {
        foodPerDay = Math.max(1, foodPerDay);
        const diet = ItemClassifier.getDiet(actor);
        const needsExoticDrink = diet.canDrink?.length > 0 && !diet.canDrink.includes("water");
        if (needsExoticDrink) {
            waterPerDay = Math.max(1, waterPerDay);
        }
    }

    const isModified = foodMult !== 1 || waterMult !== 1 || foodMod !== 0 || waterMod !== 0 || typeof rf.foodPerDay === "number" || typeof rf.waterPerDay === "number";

    const result = {
        foodPerDay,
        waterPerDay,
        needsEssence: isEssence,
        foodMultiplier: foodMult,
        waterMultiplier: waterMult,
        foodModifier: foodMod,
        waterModifier: waterMod,
        isModified
    };

    if (typeof Hooks !== "undefined" && Hooks.callAll) {
        Hooks.callAll(`${MODULE_ID}.getActorMealNeeds`, actor, result, effectiveRules);
    }

    return result;
}

/**
 * Compute per-actor food/water slot counts. Essence actors always need at
 * least 1 food slot (terrain cannot "provide" custom essence items). For
 * water, essence actors with only exotic drinks (oil, not water) also need
 * at least 1 slot since the terrain only covers standard water.
 */
export function actorMealSlots(actor, rules) {
    const needs = getActorMealNeeds(actor, rules);
    return {
        foodPerDay: needs.foodPerDay,
        waterPerDay: needs.waterPerDay,
        needsEssence: needs.needsEssence,
        isModified: needs.isModified
    };
}

/**
 * Build meal context for all characters in the rest.
 * Returns per-character meal cards with options, advisories, and current status.
 *
 * @param {string[]} characterIds - IDs of characters in the rest
 * @param {string} terrainTag - Current terrain (for mealRules lookup)
 * @param {Object} terrainMealRules - Terrain-specific overrides (from TerrainRegistry.getDefaults)
 * @param {number} daysSinceLastRest - Days elapsed since last rest (GM override, default 1)
 * @param {Map} mealChoices - Current selections (characterId -> { food, water })
 * @returns {Object[]} Per-character meal card data
 */
export function buildMealContext(characterIds, terrainTag, terrainMealRules = {}, daysSinceLastRest = 1, mealChoices = new Map(), satiatesLookup = null) {
    const rules = { ...MEAL_DEFAULTS, ...terrainMealRules };
    const cards = [];
    const totalDays = daysSinceLastRest;

    for (const charId of characterIds) {
        const actor = game.actors.get(charId);
        if (!actor) continue;
        if (!ItemClassifier.participatesInSustenance(actor)) continue;

        const currentChoice = mealChoices.get(charId) ?? { food: [], water: [], consumedDays: [], currentDay: 0 };
        const consumedDays = currentChoice.consumedDays ?? [];
        const currentDay = currentChoice.currentDay ?? consumedDays.length;

        // Get tracking flags, adjusted for days already consumed
        // If character ate on any consumed day, counter resets to days since last meal
        // Otherwise, full historical count + all elapsed days
        let restsSinceFood, restsSinceWater;

        const lastFedDay = (() => {
            for (let i = consumedDays.length - 1; i >= 0; i--) {
                if ((consumedDays[i].food ?? []).some(v => ItemClassifier.isMealSlotSelection(actor, v))) return i;
            }
            return -1;
        })();
        const lastWateredDay = (() => {
            for (let i = consumedDays.length - 1; i >= 0; i--) {
                if ((consumedDays[i].water ?? []).some(v => v && v !== "skip")) return i;
            }
            return -1;
        })();

        if (lastFedDay >= 0) {
            // Ate on consumed day: counter = days elapsed since that meal
            restsSinceFood = currentDay - (lastFedDay + 1);
        } else {
            restsSinceFood = (actor.getFlag(MODULE_ID, "restsSinceFood") ?? 0) + daysSinceLastRest;
        }

        if (lastWateredDay >= 0) {
            restsSinceWater = currentDay - (lastWateredDay + 1);
        } else {
            restsSinceWater = (actor.getFlag(MODULE_ID, "restsSinceWater") ?? 0) + daysSinceLastRest;
        }

        // Build food/water options from inventory (already reflects consumed items)
        const foodOptions = buildFoodOptions(actor);
        const waterOptions = buildWaterOptions(actor, rules);

        // Per-actor slot counts: essence actors always need at least 1
        // food slot (terrain cannot provide custom essence items).
        const actorSlots = actorMealSlots(actor, rules);
        const fpd = actorSlots.foodPerDay;
        const wpd = actorSlots.waterPerDay;

        // Calculate food grace period (3 + CON mod)
        const conMod = actor.system?.abilities?.con?.mod ?? 0;
        const foodGrace = rules.foodGraceDays ?? (3 + Math.max(0, conMod));

        // Build food slots for the ACTIVE day
        const foodArr = Array.isArray(currentChoice.food) ? currentChoice.food : (currentChoice.food && currentChoice.food !== "skip" ? [currentChoice.food] : []);
        const foodLockedSlots = Array.isArray(currentChoice.foodLockedSlots) ? currentChoice.foodLockedSlots : [];
        const foodSlots = [];
        for (let i = 0; i < fpd; i++) {
            const sel = foodArr[i] ?? "skip";
            foodSlots.push({
                index: i,
                selected: sel,
                filled: sel && sel !== "skip" && ItemClassifier.isMealSlotSelection(actor, sel),
                locked: foodLockedSlots.includes(i)
            });
        }
        const foodFilledCount = foodSlots.filter(s => s.filled).length;
        const foodSufficient = foodFilledCount >= fpd;

        // Build water slots (1 per unit required)
        const waterArr = Array.isArray(currentChoice.water) ? currentChoice.water : (currentChoice.water && currentChoice.water !== "skip" ? [currentChoice.water] : []);
        const waterLockedSlots = Array.isArray(currentChoice.waterLockedSlots) ? currentChoice.waterLockedSlots : [];
        const waterSlots = [];
        for (let i = 0; i < wpd; i++) {
            const sel = waterArr[i] ?? "skip";
            waterSlots.push({
                index: i,
                selected: sel,
                filled: sel && sel !== "skip",
                locked: waterLockedSlots.includes(i)
            });
        }
        const waterFilledCount = waterSlots.filter(s => s.filled).length;

        // If any food slot contains an item whose flags include
        // satiates: ["water"], credit that as bonus water for the UI.
        // (The authoritative credit happens in _accumulateMealSatiation
        //  at resolution; this is purely for live UI accuracy.)
        let bonusWater = 0;
        for (const slot of foodSlots) {
            if (!slot.filled || !slot.selected || slot.selected === "skip") continue;
            if (slot.selected.startsWith?.("__")) continue;
            const foodItem = actor.items.get(slot.selected);
            if (!foodItem) continue;
            const itemFlags = foodItem.flags?.[MODULE_ID] ?? {};
            let satiates = itemFlags.satiates;
            // Fallback: item may lack flags if crafted before outputFlags were applied.
            // Check the recipe registry by output name.
            if (!Array.isArray(satiates) && satiatesLookup) {
                satiates = satiatesLookup.get(foodItem.name.toLowerCase().trim()) ?? null;
            }
            if (Array.isArray(satiates) && satiates.includes("water")) {
                bonusWater++;
            }
        }
        const effectiveWaterFilled = waterFilledCount + bonusWater;
        const waterSufficient = effectiveWaterFilled >= wpd;

        // Build advisories (reactive to current selections)
        const partialSustenance = game.settings.get(MODULE_ID, "partialSustenance") ?? true;
        const advisories = buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient, foodFilledCount, waterSufficient, effectiveWaterFilled, partialSustenance);

        // Build day segments for progress bar
        const daySegments = [];
        for (let d = 0; d < totalDays; d++) {
            if (d < consumedDays.length) {
                daySegments.push({ day: d + 1, status: "completed" });
            } else if (d === currentDay) {
                daySegments.push({ day: d + 1, status: "active" });
            } else {
                daySegments.push({ day: d + 1, status: "pending" });
            }
        }
        const allDaysConsumed = consumedDays.length >= totalDays;

        // When all days consumed, summarize from consumedDays (active selections are cleared)
        let summaryFoodFilled = foodFilledCount;
        let summaryFoodSufficient = foodSufficient;
        let summaryFoodRequired = fpd;
        let summaryWaterFilled = waterFilledCount;
        let summaryWaterSufficient = waterSufficient;
        let summaryWaterRequired = wpd;
        if (allDaysConsumed && consumedDays.length > 0) {
            summaryFoodFilled = consumedDays.reduce((sum, d) =>
                sum + (d.food ?? []).filter(id => ItemClassifier.isMealSlotSelection(actor, id)).length, 0);
            summaryWaterFilled = consumedDays.reduce((sum, d) =>
                sum + (d.water ?? []).filter(v => v && v !== "skip").length, 0);

            // Credit bonus water from consumed food items that satiate water.
            // Prefer the stored bonusWater field (persisted at consumption time);
            // fall back to item lookup for legacy data without the field.
            let summaryBonusWater = 0;
            for (const day of consumedDays) {
                if (typeof day.bonusWater === "number") {
                    summaryBonusWater += day.bonusWater;
                } else {
                    // Legacy: try item lookup + satiatesLookup fallback
                    for (const foodId of (day.food ?? [])) {
                        if (!foodId || foodId === "skip" || foodId.startsWith?.("__")) continue;
                        const foodItem = actor.items.get(foodId);
                        if (!foodItem) continue;
                        let sats = foodItem.flags?.[MODULE_ID]?.satiates;
                        if (!Array.isArray(sats) && satiatesLookup) {
                            sats = satiatesLookup.get(foodItem.name.toLowerCase().trim()) ?? null;
                        }
                        if (Array.isArray(sats) && sats.includes("water")) summaryBonusWater++;
                    }
                }
            }
            // Also include bonusWater from the active food slots (non-consumed day preview)
            summaryBonusWater += bonusWater;
            summaryWaterFilled += summaryBonusWater;

            summaryFoodRequired = fpd * totalDays;
            summaryWaterRequired = wpd * totalDays;
            summaryFoodSufficient = summaryFoodFilled >= summaryFoodRequired;
            summaryWaterSufficient = summaryWaterFilled >= summaryWaterRequired;
        }

        const poolWaterRequired = allDaysConsumed ? summaryWaterRequired : wpd;
        const poolWaterFilled = allDaysConsumed ? summaryWaterFilled : effectiveWaterFilled;
        const poolManualFilled = allDaysConsumed ? summaryWaterFilled : waterFilledCount;
        const waterPoolSegments = [];
        for (let i = 0; i < poolWaterRequired; i++) {
            const filled = i < poolWaterFilled;
            const isBonus = filled && i >= poolManualFilled;
            waterPoolSegments.push({ index: i, filled, bonus: isBonus });
        }

        const waterPoolSources = [];
        const sourceMap = new Map();
        for (const slot of waterSlots) {
            if (!slot.filled || !slot.selected || slot.selected === "skip") continue;
            if (slot.selected.startsWith?.("__")) {
                if (!sourceMap.has("__feast")) sourceMap.set("__feast", { name: "Feast", pintsUsed: 0 });
                sourceMap.get("__feast").pintsUsed++;
                continue;
            }
            const item = actor.items.get(slot.selected);
            const key = slot.selected;
            if (!sourceMap.has(key)) sourceMap.set(key, { name: item?.name ?? "Unknown", pintsUsed: 0 });
            sourceMap.get(key).pintsUsed++;
        }
        for (const src of sourceMap.values()) waterPoolSources.push(src);
        if (bonusWater > 0) {
            waterPoolSources.push({ name: "Covered by meal", pintsUsed: bonusWater, isMealCredit: true });
        }

        const isNonStandard = rules.waterPerDay > 2 || rules.foodPerDay > 1;
        let terrainAlertClass = "";
        let terrainAlertIcon = "fas fa-info-circle";
        if (rules.waterPerDay >= 4) {
            terrainAlertClass = "terrain-desert";
            terrainAlertIcon = "fas fa-sun";
        } else if (rules.foodPerDay >= 2) {
            terrainAlertClass = "terrain-arctic";
            terrainAlertIcon = "fas fa-snowflake";
        } else if (isNonStandard) {
            terrainAlertClass = "terrain-extreme";
            terrainAlertIcon = "fas fa-exclamation-triangle";
        }

        cards.push({
            characterId: charId,
            actorName: actor.name,
            actorImg: actor.img,
            restsSinceFood,
            restsSinceWater,
            foodGrace,
            foodOptions,
            waterOptions,
            hasFood: foodOptions.length > 0,
            hasWater: waterOptions.length > 0,
            needsEssence: actorSlots.needsEssence,
            essenceRequired: actorSlots.needsEssence ? fpd : 0,
            advisories,
            foodSlots,
            foodFilledCount: allDaysConsumed ? summaryFoodFilled : foodFilledCount,
            foodSufficient: allDaysConsumed ? summaryFoodSufficient : foodSufficient,
            foodRequired: allDaysConsumed ? summaryFoodRequired : fpd,
            waterSlots,
            waterFilledCount: allDaysConsumed ? summaryWaterFilled : effectiveWaterFilled,
            waterSufficient: allDaysConsumed ? summaryWaterSufficient : waterSufficient,
            waterRequired: allDaysConsumed ? summaryWaterRequired : wpd,
            bonusWater,
            waterPoolSegments,
            waterPoolSources,
            terrainAlertClass,
            terrainAlertIcon,
            terrainNote: rules.note ?? null,
            totalDays,
            currentDay: currentDay + 1,
            consumedDaysCount: consumedDays.length,
            daySegments,
            allDaysConsumed,
            isMultiDay: totalDays > 1
        });
    }

    return cards;
}
