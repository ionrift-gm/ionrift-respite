/**
 * MealPhaseHandler
 * Manages food and water consumption during the Meal phase of a long rest.
 *
 * Responsibilities:
 * - Track rests since last meal/drink per character (actor flags)
 * - Build meal options for each character (rations, waterskins, foraged, skip)
 * - Consume selected items from inventory (multi-day aware, handles partial supply)
 * - Generate advisories about starvation/dehydration consequences
 * - Apply exhaustion at resolution when thresholds are exceeded
 *
 * Item classification is delegated to ItemClassifier. Diet-aware filtering
 * ensures each character only sees items compatible with their diet profile.
 */

import { ItemClassifier } from "./ItemClassifier.js";

const MODULE_ID = "ionrift-respite";

/** Default meal requirements (PHB RAW baseline). */
const MEAL_DEFAULTS = {
    waterPerDay: 1,
    foodPerDay: 1,
    essencePerDay: 2,
    dehydrationDC: 15,
    foodGraceDays: null  // null = 3 + CON mod (calculated per character)
};

export class MealPhaseHandler {

    /**
     * Resolve food spoilage across all party members before the meal phase.
     * Checks every inventory item with a `spoilsAfter` flag against
     * `daysSinceLastRest`. Items that have expired are removed. Items
     * foraged/hunted during this rest (flagged `foragedThisRest`) are skipped.
     *
     * @param {string[]} characterIds - Actor IDs in the rest
     * @param {number} daysSinceLastRest - Days elapsed since last rest
     * @returns {Object[]} Spoilage report per character: { actorName, spoiled: [{ name, qty }] }
     */
    static async resolveSpoilage(characterIds, daysSinceLastRest = 1) {
        const report = [];

        for (const charId of characterIds) {
            const actor = game.actors.get(charId);
            if (!actor) continue;

            const spoiled = [];
            const deletes = [];
            const updates = [];

            for (const item of actor.items) {
                const flags = item.flags?.[MODULE_ID] ?? {};
                if (flags.foragedThisRest) continue;

                const spoilsAfter = flags.spoilsAfter;
                if (spoilsAfter == null || spoilsAfter <= 0) continue;

                if (daysSinceLastRest >= spoilsAfter) {
                    const qty = item.system?.quantity ?? 1;
                    spoiled.push({ name: item.name, qty });
                    deletes.push(item.id);
                }
            }

            if (deletes.length) {
                await actor.deleteEmbeddedDocuments("Item", deletes);
            }

            if (spoiled.length) {
                report.push({ characterId: charId, actorName: actor.name, spoiled });
            }
        }

        if (report.length) {
            const lines = report.flatMap(r =>
                r.spoiled.map(s => `<strong>${r.actorName}</strong> lost ${s.qty}x ${s.name}`)
            );
            const dayLabel = daysSinceLastRest === 1 ? "1 day" : `${daysSinceLastRest} days`;
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><p><i class="fas fa-skull-crossbones"></i> <strong>Spoilage</strong></p><p>After ${dayLabel} of travel, perishable food has gone off:</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul></div>`,
                speaker: { alias: "Respite" }
            });
        }

        return report;
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
    static buildMealContext(characterIds, terrainTag, terrainMealRules = {}, daysSinceLastRest = 1, mealChoices = new Map()) {
        const rules = { ...MEAL_DEFAULTS, ...terrainMealRules };
        const cards = [];
        const totalDays = daysSinceLastRest;

        for (const charId of characterIds) {
            const actor = game.actors.get(charId);
            if (!actor) continue;

            const currentChoice = mealChoices.get(charId) ?? { food: [], water: [], consumedDays: [], currentDay: 0 };
            const consumedDays = currentChoice.consumedDays ?? [];
            const currentDay = currentChoice.currentDay ?? consumedDays.length;

            // Get tracking flags, adjusted for days already consumed
            // If character ate on any consumed day, counter resets to days since last meal
            // Otherwise, full historical count + all elapsed days
            let restsSinceFood, restsSinceWater;

            const lastFedDay = (() => {
                for (let i = consumedDays.length - 1; i >= 0; i--) {
                    if ((consumedDays[i].food ?? []).some(v => v && v !== "skip")) return i;
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
            const foodOptions = this._buildFoodOptions(actor);
            const waterOptions = this._buildWaterOptions(actor, rules);

            // Calculate food grace period (3 + CON mod)
            const conMod = actor.system?.abilities?.con?.mod ?? 0;
            const foodGrace = rules.foodGraceDays ?? (3 + Math.max(0, conMod));

            // Build food slots for the ACTIVE day
            const foodArr = Array.isArray(currentChoice.food) ? currentChoice.food : (currentChoice.food && currentChoice.food !== "skip" ? [currentChoice.food] : []);
            const foodSlots = [];
            for (let i = 0; i < rules.foodPerDay; i++) {
                const sel = foodArr[i] ?? "skip";
                foodSlots.push({
                    index: i,
                    selected: sel,
                    filled: sel && sel !== "skip"
                });
            }
            const foodFilledCount = foodSlots.filter(s => s.filled).length;
            const foodSufficient = foodFilledCount >= rules.foodPerDay;

            // Build water slots (1 per unit required)
            const waterArr = Array.isArray(currentChoice.water) ? currentChoice.water : (currentChoice.water && currentChoice.water !== "skip" ? [currentChoice.water] : []);
            const waterSlots = [];
            for (let i = 0; i < rules.waterPerDay; i++) {
                const sel = waterArr[i] ?? "skip";
                waterSlots.push({
                    index: i,
                    selected: sel,
                    filled: sel && sel !== "skip"
                });
            }
            const waterFilledCount = waterSlots.filter(s => s.filled).length;
            const waterSufficient = waterFilledCount >= rules.waterPerDay;

            // Build advisories (reactive to current selections)
            const partialSustenance = game.settings.get(MODULE_ID, "partialSustenance") ?? true;
            const advisories = this._buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient, foodFilledCount, waterSufficient, waterFilledCount, partialSustenance);

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
            let summaryFoodRequired = rules.foodPerDay;
            let summaryWaterFilled = waterFilledCount;
            let summaryWaterSufficient = waterSufficient;
            let summaryWaterRequired = rules.waterPerDay;
            if (allDaysConsumed && consumedDays.length > 0) {
                summaryFoodFilled = consumedDays.reduce((sum, d) =>
                    sum + (d.food ?? []).filter(v => v && v !== "skip").length, 0);
                summaryWaterFilled = consumedDays.reduce((sum, d) =>
                    sum + (d.water ?? []).filter(v => v && v !== "skip").length, 0);
                summaryFoodRequired = rules.foodPerDay * totalDays;
                summaryWaterRequired = rules.waterPerDay * totalDays;
                summaryFoodSufficient = summaryFoodFilled >= summaryFoodRequired;
                summaryWaterSufficient = summaryWaterFilled >= summaryWaterRequired;
            }

            // Essence tracking for non-biological characters (slot-based, like food/water)
            const needsEssence = ItemClassifier.requiresEssence(actor);
            const essenceOptions = needsEssence ? this._buildEssenceOptions(actor) : [];

            const essenceArr = Array.isArray(currentChoice.essence) ? currentChoice.essence : [];
            const essenceSlots = [];
            const essRequired = rules.essencePerDay;
            if (needsEssence) {
                for (let i = 0; i < essRequired; i++) {
                    const sel = essenceArr[i] ?? "skip";
                    essenceSlots.push({ index: i, selected: sel, filled: sel && sel !== "skip" });
                }
            }
            const essenceFilledCount = essenceSlots.filter(s => s.filled).length;
            const essenceSufficient = essenceFilledCount >= essRequired;

            // Essence consumed-days summary
            let lastEssenceDay = -1;
            for (let i = consumedDays.length - 1; i >= 0; i--) {
                if ((consumedDays[i].essence ?? []).some(v => v && v !== "skip")) { lastEssenceDay = i; break; }
            }
            let restsSinceEssence;
            if (lastEssenceDay >= 0) {
                restsSinceEssence = currentDay - (lastEssenceDay + 1);
            } else {
                restsSinceEssence = (actor.getFlag(MODULE_ID, "restsSinceEssence") ?? 0) + daysSinceLastRest;
            }

            let summaryEssenceFilled = essenceFilledCount;
            let summaryEssenceSufficient = essenceSufficient;
            let summaryEssenceRequired = essRequired;
            if (allDaysConsumed && consumedDays.length > 0 && needsEssence) {
                summaryEssenceFilled = consumedDays.reduce((sum, d) =>
                    sum + (d.essence ?? []).filter(v => v && v !== "skip").length, 0);
                summaryEssenceRequired = essRequired * totalDays;
                summaryEssenceSufficient = summaryEssenceFilled >= summaryEssenceRequired;
            }

            // Essence uses the same grace period as food (3 + CON mod)
            if (needsEssence) {
                const essenceGrace = rules.foodGraceDays ?? (3 + Math.max(0, conMod));
                if (restsSinceEssence > 0 && restsSinceEssence <= essenceGrace) {
                    const remaining = essenceGrace - restsSinceEssence;
                    advisories.push({
                        level: essenceSufficient ? "ok" : "warning",
                        icon: essenceSufficient ? "fas fa-check-circle" : "fas fa-bolt",
                        message: essenceSufficient
                            ? `Recharging this rest. All ${essRequired} essence slots filled.`
                            : `Has not recharged since ${restsSinceEssence === 1 ? "last rest" : `${restsSinceEssence} rests ago`}. Can go ${remaining} more rest${remaining !== 1 ? "s" : ""} before exhaustion.`
                    });
                } else if (restsSinceEssence > essenceGrace) {
                    advisories.push({
                        level: essenceSufficient ? "ok" : "danger",
                        icon: essenceSufficient ? "fas fa-check-circle" : "fas fa-skull",
                        message: essenceSufficient
                            ? `Recharging this rest. Was depleted (${restsSinceEssence} rests without essence).`
                            : `Depleted. Has not recharged in ${restsSinceEssence} rests. Skipping causes 1 level of exhaustion.`
                    });
                }
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
                advisories,
                foodSlots,
                foodFilledCount: allDaysConsumed ? summaryFoodFilled : foodFilledCount,
                foodSufficient: allDaysConsumed ? summaryFoodSufficient : foodSufficient,
                foodRequired: allDaysConsumed ? summaryFoodRequired : rules.foodPerDay,
                waterSlots,
                waterFilledCount: allDaysConsumed ? summaryWaterFilled : waterFilledCount,
                waterSufficient: allDaysConsumed ? summaryWaterSufficient : waterSufficient,
                waterRequired: allDaysConsumed ? summaryWaterRequired : rules.waterPerDay,
                terrainNote: rules.note ?? null,
                totalDays,
                currentDay: currentDay + 1,
                consumedDaysCount: consumedDays.length,
                daySegments,
                allDaysConsumed,
                isMultiDay: totalDays > 1,
                needsEssence,
                essenceOptions,
                hasEssence: essenceOptions.length > 0,
                essenceSlots,
                essenceFilledCount: allDaysConsumed ? summaryEssenceFilled : essenceFilledCount,
                essenceSufficient: allDaysConsumed ? summaryEssenceSufficient : essenceSufficient,
                essenceRequired: allDaysConsumed ? summaryEssenceRequired : essRequired,
                restsSinceEssence: needsEssence ? restsSinceEssence : 0
            });
        }

        return cards;
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
    static async applyMealChoices(mealChoices, daysSinceLastRest = 1, terrainMealRules = {}) {
        const rules = { ...MEAL_DEFAULTS, ...terrainMealRules };
        const results = [];

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
                dehydrationAutoFail: false,
                essenceConsumed: 0,
                essenceShortfall: 0,
                essenceDeprivation: false,
                essenceExhaustion: 0
            };

            // Count filled slots across all consumed days
            let totalFoodFilled = 0;
            let totalWaterFilled = 0;
            for (const day of consumedDays) {
                totalFoodFilled += (day.food ?? []).filter(id => id && id !== "skip").length;
                totalWaterFilled += (day.water ?? []).filter(id => id && id !== "skip").length;
            }

            // Days that were skipped (not consumed at all)
            const skippedDays = totalDays - consumedDays.length;

            const foodNeeded = totalDays * rules.foodPerDay;
            const waterNeeded = totalDays * rules.waterPerDay;

            result.foodConsumed = totalFoodFilled;
            result.waterConsumed = totalWaterFilled;
            result.ate = totalFoodFilled > 0;
            result.drank = totalWaterFilled > 0;
            result.foodShortfall = Math.max(0, foodNeeded - totalFoodFilled);
            result.waterShortfall = Math.max(0, waterNeeded - totalWaterFilled);

            // --- Actually consume items from inventory ---
            // Tally how many times each item ID was used across all consumed days
            const foodUsage = new Map();
            const waterUsage = new Map();
            for (const day of consumedDays) {
                for (const id of (day.food ?? [])) {
                    if (id && id !== "skip") foodUsage.set(id, (foodUsage.get(id) ?? 0) + 1);
                }
                for (const id of (day.water ?? [])) {
                    if (id && id !== "skip") waterUsage.set(id, (waterUsage.get(id) ?? 0) + 1);
                }
            }
            for (const [itemId, amount] of foodUsage) {
                const consumed = await this._consumeItem(actor, itemId, amount);
                console.log(`[Respite:Meal] Consumed ${consumed}x food item ${itemId} from ${actor.name}`);
            }
            for (const [itemId, amount] of waterUsage) {
                const consumed = await this._consumeItem(actor, itemId, amount);
                console.log(`[Respite:Meal] Consumed ${consumed}x water item ${itemId} from ${actor.name}`);
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

            // --- Essence / Recharge ---
            const needsEssence = ItemClassifier.requiresEssence(actor);
            if (needsEssence) {
                let totalEssenceFilled = 0;
                const essenceUsage = new Map();
                for (const day of consumedDays) {
                    for (const id of (day.essence ?? [])) {
                        if (id && id !== "skip") {
                            essenceUsage.set(id, (essenceUsage.get(id) ?? 0) + 1);
                            totalEssenceFilled++;
                        }
                    }
                }
                for (const [itemId, amount] of essenceUsage) {
                    await this._consumeItem(actor, itemId, amount);
                }

                const essenceNeeded = totalDays * rules.essencePerDay;
                result.essenceConsumed = totalEssenceFilled;
                result.essenceShortfall = Math.max(0, essenceNeeded - totalEssenceFilled);

                if (result.essenceShortfall === 0) {
                    await actor.setFlag(MODULE_ID, "restsSinceEssence", 0);
                } else {
                    const current = actor.getFlag(MODULE_ID, "restsSinceEssence") ?? 0;
                    await actor.setFlag(MODULE_ID, "restsSinceEssence", current + 1);
                    result.essenceDeprivation = true;
                }

                // Exhaustion from essence deprivation — same grace period as food
                const essConMod = actor.system?.abilities?.con?.mod ?? 0;
                const essGrace = rules.foodGraceDays ?? (3 + Math.max(0, essConMod));
                const restsSinceEssence = actor.getFlag(MODULE_ID, "restsSinceEssence") ?? 0;
                if (restsSinceEssence > essGrace) {
                    result.essenceExhaustion = restsSinceEssence - essGrace;
                }
            }

            // --- Starvation / Dehydration ---
            // Skip penalties for characters whose diet does not require sustenance
            const needsSustenance = ItemClassifier.requiresSustenance(actor);

            // Grace period: 3 + CON mod days without food before consequences
            // Each day past grace = 1 level of exhaustion (auto-applied)
            const conMod = actor.system?.abilities?.con?.mod ?? 0;
            const foodGrace = rules.foodGraceDays ?? (3 + Math.max(0, conMod));
            const restsSinceFood = actor.getFlag(MODULE_ID, "restsSinceFood") ?? 0;
            if (needsSustenance && restsSinceFood > foodGrace) {
                result.starvationExhaustion = restsSinceFood - foodGrace;
            }

            // Any day without water: CON save DC 15 or gain 1 exhaustion
            // If already dehydrated (2+ rests): auto-fail (no save)
            const restsSinceWater = actor.getFlag(MODULE_ID, "restsSinceWater") ?? 0;
            if (needsSustenance && restsSinceWater > 0) {
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
    static async processAndApply(mealChoices, totalDays = 1, terrainMealRules = {}) {
        // Auto-consume: if a character has active food/water selections but hasn't
        // consumed all days, fold those selections into consumedDays.
        for (const [charId, choice] of mealChoices) {
            const consumed = choice.consumedDays ?? [];
            const food = Array.isArray(choice.food) ? choice.food : [];
            const water = Array.isArray(choice.water) ? choice.water : [];
            const essence = Array.isArray(choice.essence) ? choice.essence : [];
            const hasActiveSelections = food.some(id => id && id !== "skip")
                || water.some(id => id && id !== "skip")
                || essence.some(id => id && id !== "skip");

            if (consumed.length < totalDays && hasActiveSelections) {
                consumed.push({ food: [...food], water: [...water], essence: [...essence] });
                mealChoices.set(charId, {
                    ...choice,
                    consumedDays: consumed,
                    currentDay: consumed.length,
                    food: [],
                    water: [],
                    essence: []
                });
                console.log(`[Respite:Meal] Auto-consumed active selections for ${charId} (day ${consumed.length})`);
            }
        }

        const results = await MealPhaseHandler.applyMealChoices(mealChoices, totalDays, terrainMealRules);
        return { mealChoices, results };
    }

    // ── Internal Helpers ─────────────────────────────────────────

    /**
     * Build food options from actor inventory.
     * Delegates classification to ItemClassifier with diet-aware filtering.
     */
    static _buildFoodOptions(actor) {
        const options = [];

        for (const item of actor.items) {
            const qty = item.system?.quantity ?? 1;
            if (qty <= 0) continue;

            if (!ItemClassifier.isFood(item, actor)) continue;

            options.push({
                value: item.id,
                label: `${item.name} (\u00d7${qty})`,
                itemId: item.id,
                available: qty,
                icon: item.img ?? "icons/consumables/food/bread-loaf-round-white.webp"
            });
        }

        return options;
    }

    /**
     * Check if an item qualifies as food for the meal phase.
     * Thin wrapper around ItemClassifier for backward compatibility.
     * @param {Item} item - Foundry Item document
     * @returns {boolean}
     */
    static _isFoodItem(item) {
        return ItemClassifier.isFood(item);
    }

    /**
     * Build water options from actor inventory.
     * Delegates classification to ItemClassifier with diet-aware filtering.
     */
    static _buildWaterOptions(actor, rules) {
        const options = [];

        for (const item of actor.items) {
            const qty = item.system?.quantity ?? 1;
            const uses = item.system?.uses;
            if (qty <= 0 && (!uses || uses.value <= 0)) continue;

            if (!ItemClassifier.isWater(item, actor)) continue;

            const avail = uses ? (uses.value > 0 ? qty : Math.max(0, qty - 1)) : qty;
            options.push({
                value: item.id,
                label: `${item.name} (\u00d7${avail})`,
                itemId: item.id,
                available: avail,
                icon: item.img ?? "icons/consumables/drinks/waterskin-leather-tan.webp"
            });
        }

        return options;
    }

    /**
     * Check if an item qualifies as water/drink for the meal phase.
     * Thin wrapper around ItemClassifier for backward compatibility.
     * @param {Item} item - Foundry Item document
     * @returns {boolean}
     */
    static _isWaterItem(item) {
        return ItemClassifier.isWater(item);
    }

    /**
     * Build advisory messages about current hunger/thirst status.
     */
    static _buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient = false, foodFilledCount = 0, waterSufficient = false, waterFilledCount = 0, partialSustenance = true) {
        const advisories = [];
        const isPartialFood = !foodSufficient && foodFilledCount > 0 && rules.foodPerDay > 1;
        const isPartialWater = !waterSufficient && waterFilledCount > 0 && rules.waterPerDay > 1;

        // Food advisories
        if (restsSinceFood > 0 && restsSinceFood <= foodGrace) {
            const remaining = foodGrace - restsSinceFood;
            let partialNote = "";
            if (isPartialFood) {
                partialNote = partialSustenance
                    ? ` ${foodFilledCount} of ${rules.foodPerDay} filled. Counts as half a day (grace extended).`
                    : ` Only ${foodFilledCount} of ${rules.foodPerDay} filled.`;
            }
            advisories.push({
                level: foodSufficient ? "ok" : (isPartialFood && partialSustenance ? "warning" : "warning"),
                icon: foodSufficient ? "fas fa-check-circle" : "fas fa-drumstick-bite",
                message: foodSufficient
                    ? `Eating this rest.${rules.foodPerDay > 1 ? ` All ${rules.foodPerDay} portions filled.` : ""} Was ${restsSinceFood} rest${restsSinceFood !== 1 ? "s" : ""} without food.`
                    : `Has not eaten since ${restsSinceFood === 1 ? "last rest" : `${restsSinceFood} rests ago`}.${partialNote} Can go ${remaining} more rest${remaining !== 1 ? "s" : ""} without food before exhaustion.`
            });
        } else if (restsSinceFood > foodGrace) {
            let partialNote = "";
            if (isPartialFood) {
                partialNote = partialSustenance
                    ? ` ${foodFilledCount} of ${rules.foodPerDay} filled. Counts as half a day (grace extended).`
                    : ` Only ${foodFilledCount} of ${rules.foodPerDay} filled.`;
            }
            advisories.push({
                level: foodSufficient ? "ok" : "danger",
                icon: foodSufficient ? "fas fa-check-circle" : "fas fa-skull",
                message: foodSufficient
                    ? `Eating this rest.${rules.foodPerDay > 1 ? ` All ${rules.foodPerDay} portions filled.` : ""} Was starving (${restsSinceFood} rests without food).`
                    : `Starving. Has not eaten in ${restsSinceFood} rests.${partialNote} Skipping this meal causes 1 level of exhaustion.`
            });
        }

        // Water advisories
        if (restsSinceWater > 0) {
            const reducedDC = rules.dehydrationDC - 2;
            let partialNote = "";
            if (isPartialWater) {
                partialNote = partialSustenance
                    ? ` ${waterFilledCount} of ${rules.waterPerDay} filled. CON save at DC ${reducedDC} (+2 bonus from partial hydration).`
                    : ` Only ${waterFilledCount} of ${rules.waterPerDay} units. Partial water gives no benefit per RAW.`;
            }
            advisories.push({
                level: waterSufficient ? "ok" : (isPartialWater && partialSustenance ? "warning" : "danger"),
                icon: waterSufficient ? "fas fa-check-circle" : "fas fa-tint-slash",
                message: waterSufficient
                    ? `Drinking this rest.${rules.waterPerDay > 1 ? ` All ${rules.waterPerDay} units filled.` : ""}`
                    : `Has not had water since ${restsSinceWater === 1 ? "last rest" : `${restsSinceWater} rests ago`}.${partialNote}${!isPartialWater ? ` Skipping triggers CON save DC ${rules.dehydrationDC} or exhaustion.` : ""}`
            });
        }

        // Terrain note
        if (rules.note && rules.waterPerDay > 1) {
            advisories.push({
                level: "info",
                icon: "fas fa-sun",
                message: rules.note
            });
        }

        return advisories;
    }

    /**
     * Build essence/recharge options from actor inventory.
     * For non-biological characters that require essence.
     */
    static _buildEssenceOptions(actor) {
        const options = [];

        for (const item of actor.items) {
            const qty = item.system?.quantity ?? 1;
            if (qty <= 0) continue;

            if (!ItemClassifier.isEssence(item)) continue;

            options.push({
                value: item.id,
                label: `${item.name} (\u00d7${qty})`,
                itemId: item.id,
                available: qty,
                icon: item.img ?? "icons/commodities/gems/gem-rough-white-blue.webp"
            });
        }

        return options;
    }

    /**
     * Consume up to `amount` units of an item (decrement quantity or uses).
     * Returns the number of units actually consumed (handles partial supply).
     *
     * Supports both DnD5e legacy (uses.value writable) and v5+
     * (uses.spent/uses.max, where value = max - spent and is read-only).
     *
     * @param {Actor} actor
     * @param {string} itemId - Item ID to consume
     * @param {number} amount - Number of units to consume
     * @returns {number} Units actually consumed
     */
    static async _consumeItem(actor, itemId, amount = 1) {
        const item = actor.items.get(itemId);
        if (!item) return 0;

        const uses = item.system?.uses;
        const qty = item.system?.quantity ?? 1;
        let consumed = 0;

        // Items with charges (waterskin 4/4, rations 1/1)
        if (uses && uses.max > 0) {
            // DnD5e v5+: uses.spent exists, value = max - spent (read-only)
            // Legacy: uses.value is directly writable
            const isV5 = ("spent" in uses);
            const currentCharges = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);

            if (currentCharges > 0) {
                consumed = Math.min(amount, currentCharges);
                const remaining = currentCharges - consumed;

                if (remaining <= 0 && qty > 1) {
                    // Charges depleted: use next unit (decrement qty, reset charges)
                    const resetUpdate = isV5
                        ? { "system.uses.spent": 0, "system.quantity": qty - 1 }
                        : { "system.uses.value": uses.max, "system.quantity": qty - 1 };
                    await item.update(resetUpdate);
                } else if (remaining <= 0 && qty <= 1) {
                    // Last unit, last charge: delete item
                    await actor.deleteEmbeddedDocuments("Item", [item.id]);
                } else {
                    const chargeUpdate = isV5
                        ? { "system.uses.spent": (uses.spent ?? 0) + consumed }
                        : { "system.uses.value": remaining };
                    await item.update(chargeUpdate);
                }
                return consumed;
            }
            // No charges but qty > 0: reset charges and consume from next unit
            if (qty > 1) {
                const resetConsumeUpdate = isV5
                    ? { "system.uses.spent": 1, "system.quantity": qty - 1 }
                    : { "system.uses.value": uses.max - 1, "system.quantity": qty - 1 };
                await item.update(resetConsumeUpdate);
                return 1;
            }
            // qty <= 1 and no charges left: nothing to consume
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
            return 0;
        }

        // Items with only quantity (no uses system)
        consumed = Math.min(amount, qty);
        if (qty - consumed > 0) {
            await item.update({ "system.quantity": qty - consumed });
        } else {
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
        }
        return consumed;
    }
}
