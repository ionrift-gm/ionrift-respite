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
import { CalendarHandler } from "./CalendarHandler.js";

const MODULE_ID = "ionrift-respite";

const SPOILED_FOOD_TEMPLATE = {
    name: "Spoiled Food",
    type: "consumable",
    img: "icons/consumables/food/berries-ration-round-red.webp",
    system: {
        description: { value: "Rotten, inedible remains. Might have been something good once." },
        quantity: 1,
        weight: 0.5,
        rarity: "common",
        type: { value: "food" }
    },
    flags: { [MODULE_ID]: { spoiled: true } }
};

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
     * `daysSinceLastRest`. Spoiled items are replaced with a stacking
     * "Spoiled Food" loot item rather than silently deleted.
     * Items foraged/hunted during this rest (flagged `foragedThisRest`) are skipped.
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

            const result = await this._spoilActorItems(actor, (item, flags) => {
                if (flags.foragedThisRest) return false;
                const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
                if (spoilsAfter == null || spoilsAfter <= 0) return false;
                return daysSinceLastRest >= spoilsAfter;
            });

            if (result.spoiled.length) {
                report.push({ characterId: charId, actorName: actor.name, spoiled: result.spoiled });
            }
        }

        if (report.length) {
            const lines = report.flatMap(r =>
                r.spoiled.map(s => `<strong>${r.actorName}</strong> lost ${s.qty}x ${s.name}`)
            );
            const dayLabel = daysSinceLastRest === 1 ? "1 day" : `${daysSinceLastRest} days`;

            // Public thematic chat card
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><p><i class="fas fa-skull-crossbones"></i> <strong>Spoilage</strong></p><p>After ${dayLabel} of travel, perishable food has gone off:</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul></div>`,
                speaker: { alias: "Respite" }
            });

            // GM-only whispered summary
            const totalSpoiled = report.reduce((sum, r) => sum + r.spoiled.reduce((s, i) => s + i.qty, 0), 0);
            await ChatMessage.create({
                content: `<p><i class="fas fa-info-circle"></i> <strong>Spoilage Report:</strong> ${totalSpoiled} item(s) spoiled across ${report.length} character(s) after ${dayLabel}.</p>`,
                speaker: { alias: "Respite" },
                whisper: game.users.filter(u => u.isGM).map(u => u.id),
                type: CONST.CHAT_MESSAGE_TYPES.WHISPER ?? 4
            });
        }

        return report;
    }

    /**
     * Calendar-driven spoilage. Called when world time advances.
     * Uses harvestedDate + spoilsAfter to determine expiry.
     *
     * @param {Actor[]} actors - Party actors to check
     * @returns {Object[]} Spoilage report
     */
    static async resolveCalendarSpoilage(actors) {
        const now = CalendarHandler.getCurrentDate();
        const nowEpoch = game.time.worldTime;
        const report = [];

        // First pass: stamp harvestedDate on any perishable items that lack one
        for (const actor of actors) {
            if (!actor) continue;
            const toStamp = [];
            for (const item of actor.items) {
                const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
                if (spoilsAfter == null || spoilsAfter <= 0) continue;
                const flags = item.flags?.[MODULE_ID] ?? {};
                if (flags.harvestedDate) continue;
                toStamp.push({ _id: item.id, [`flags.${MODULE_ID}.harvestedDate`]: now ?? String(nowEpoch) });
            }
            if (toStamp.length) {
                await actor.updateEmbeddedDocuments("Item", toStamp);
            }
        }

        // Second pass: check for expired items
        for (const actor of actors) {
            if (!actor) continue;

            const result = await this._spoilActorItems(actor, (item, flags) => {
                const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
                if (spoilsAfter == null || spoilsAfter <= 0) return false;

                const harvested = flags.harvestedDate;
                if (!harvested) return false;

                // Calendar-based: compare date strings (Y-M-D format)
                if (now && harvested.includes("-")) {
                    const daysPassed = this._dateDiffDays(harvested, now);
                    return daysPassed >= spoilsAfter;
                }

                // Epoch-based fallback: harvestedDate stored as worldTime seconds
                const harvestedEpoch = parseInt(harvested, 10);
                if (!isNaN(harvestedEpoch)) {
                    const secondsPerDay = 86400;
                    const daysPassed = Math.floor((nowEpoch - harvestedEpoch) / secondsPerDay);
                    return daysPassed >= spoilsAfter;
                }

                return false;
            });

            if (result.spoiled.length) {
                report.push({ characterId: actor.id, actorName: actor.name, spoiled: result.spoiled });
            }
        }

        return report;
    }

    /**
     * Core spoilage processor for a single actor. Replaces spoiled items
     * with a stacking "Spoiled Food" loot item.
     *
     * @param {Actor} actor
     * @param {Function} shouldSpoil - (item, flags) => boolean predicate
     * @returns {{ spoiled: Array<{name: string, qty: number}> }}
     */
    static async _spoilActorItems(actor, shouldSpoil) {
        const spoiled = [];
        const deletes = [];
        let spoiledQty = 0;

        for (const item of actor.items) {
            const flags = item.flags?.[MODULE_ID] ?? {};
            if (!shouldSpoil(item, flags)) continue;

            const qty = item.system?.quantity ?? 1;
            spoiled.push({ name: item.name, qty });
            deletes.push(item.id);
            spoiledQty += qty;
        }

        if (deletes.length) {
            await actor.deleteEmbeddedDocuments("Item", deletes);

            // Stack onto existing Spoiled Food or create a new one
            const existing = actor.items.find(
                i => i.name === "Spoiled Food" && i.flags?.[MODULE_ID]?.spoiled
            );
            if (existing) {
                const currentQty = existing.system?.quantity ?? 0;
                await existing.update({ "system.quantity": currentQty + spoiledQty });
            } else {
                const data = foundry.utils.deepClone(SPOILED_FOOD_TEMPLATE);
                data.system.quantity = spoiledQty;
                await actor.createEmbeddedDocuments("Item", [data]);
            }
        }

        return { spoiled };
    }

    /**
     * Compute the difference in days between two date strings (YYYY-MM-DD or Y-M-D).
     * Falls back to 0 on parse failure.
     */
    static _dateDiffDays(dateA, dateB) {
        try {
            const partsA = dateA.split("-").map(Number);
            const partsB = dateB.split("-").map(Number);
            const a = new Date(partsA[0], partsA[1], partsA[2]);
            const b = new Date(partsB[0], partsB[1], partsB[2]);
            return Math.floor((b - a) / 86400000);
        } catch { return 0; }
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
                for (const id of (day.food ?? [])) {
                    if (id && id !== "skip") foodUsage.set(id, (foodUsage.get(id) ?? 0) + 1);
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
                    MealPhaseHandler._accumulateMealSatiation(
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

            const foodNeeded = totalDays * rules.foodPerDay;
            const waterNeeded = totalDays * rules.waterPerDay;

            const effectiveFood = totalFoodFilled + (extraFoodByChar.get(charId) ?? 0);
            const effectiveWater = totalWaterFilled + (extraWaterByChar.get(charId) ?? 0);

            result.foodConsumed = effectiveFood;
            result.waterConsumed = effectiveWater;
            result.ate = effectiveFood > 0;
            result.drank = effectiveWater > 0;
            result.foodShortfall = Math.max(0, foodNeeded - effectiveFood);
            result.waterShortfall = Math.max(0, waterNeeded - effectiveWater);

            // --- Actually consume items from inventory ---
            const foodUsage = mealSnapshotsByChar.get(charId)?.foodUsage ?? new Map();
            const snapMap = mealSnapshotsByChar.get(charId)?.snapMap ?? new Map();
            const waterUsage = new Map();
            for (const day of consumedDays) {
                for (const id of (day.water ?? [])) {
                    if (id && id !== "skip") waterUsage.set(id, (waterUsage.get(id) ?? 0) + 1);
                }
            }
            for (const [itemId, amount] of foodUsage) {
                const snapshot = snapMap.get(itemId);
                const consumed = await this._consumeItem(actor, itemId, amount);
                console.log(`[Respite:Meal] Consumed ${consumed}x food item ${itemId} from ${actor.name}`);
                if (snapshot && consumed > 0) {
                    for (let u = 0; u < consumed; u++) {
                        await MealPhaseHandler._dispatchWellFedMealServing({
                            consumerActor: actor,
                            itemSnapshot: snapshot,
                            partyIds
                        });
                    }
                }
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

    /**
     * Wet meals and party meals credit water (and party meals credit food for allies
     * who did not spend a food slot on the shared dish).
     */
    static _accumulateMealSatiation(snapshot, amount, consumerCharId, partyIds, extraWaterByChar, extraFoodByChar) {
        const rf = snapshot.flags?.[MODULE_ID] ?? {};
        const targets = rf.partyMeal ? [...partyIds] : [consumerCharId];
        for (let u = 0; u < amount; u++) {
            for (const tid of targets) {
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
     * Apply Well Fed + optional chat after one serving is removed from inventory.
     */
    static async _dispatchWellFedMealServing({ consumerActor, itemSnapshot, partyIds }) {
        const rf = itemSnapshot.flags?.[MODULE_ID] ?? {};
        const itemName = itemSnapshot.name ?? "Meal";
        if (rf.partyMeal) {
            const summaries = [];
            for (const pid of partyIds) {
                const member = game.actors.get(pid);
                if (!member) continue;
                const part = await MealPhaseHandler._applyWellFedEffect(member, itemSnapshot);
                if (part?.length) summaries.push(`<strong>${member.name}</strong>: ${part.join("; ")}`);
            }
            if (summaries.length) {
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${consumerActor.name}</strong>'s <strong>${itemName}</strong> feeds the whole party.</p><p>${summaries.join("<br>")}</p></div>`,
                    speaker: ChatMessage.getSpeaker({ actor: consumerActor })
                });
            }
        } else {
            const lines = await MealPhaseHandler._applyWellFedEffect(consumerActor, itemSnapshot);
            if (lines?.length) {
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${consumerActor.name}</strong> eats <strong>${itemName}</strong>. Well Fed: ${lines.join("; ")}</p></div>`,
                    speaker: ChatMessage.getSpeaker({ actor: consumerActor })
                });
            }
        }
    }

    /**
     * Well Fed exclusive slot: remove prior AE, resolve buffs, create replacement AE when needed.
     * @param {Actor} actor
     * @param {Item|object} item - Item document or plain item data (e.g. toObject snapshot)
     * @returns {Promise<string[]>} Chat lines for buff summaries (empty if skipped)
     */
    static async _applyWellFedEffect(actor, item) {
        const flags = item?.flags?.[MODULE_ID] ?? {};
        if (flags.wellFed !== true) return [];
        const buffRaw = flags.buff;
        if (buffRaw == null) return [];

        const buffs = Array.isArray(buffRaw) ? buffRaw : [buffRaw];
        await MealPhaseHandler._removeWellFedEffects(actor);

        const immediateLines = [];
        const deferredBuffs = [];
        for (const buff of buffs) {
            if (!buff?.type) continue;
            const duration = buff.duration ?? "untilLongRest";
            const forceImmediate = buff.type === "heal";
            if (duration === "immediate" || forceImmediate) {
                const line = await MealPhaseHandler._resolveBuff(actor, buff, { chatDetail: true });
                if (line) immediateLines.push(line);
            } else {
                deferredBuffs.push(buff);
            }
        }

        const aeChanges = [];
        const aeDescriptions = [];
        for (const buff of deferredBuffs) {
            const built = await MealPhaseHandler._buffToActiveEffectPartsAsync(actor, buff);
            if (built.changes?.length) aeChanges.push(...built.changes);
            if (built.description) aeDescriptions.push(built.description);
        }

        const itemName = item.name ?? "Meal";
        if (deferredBuffs.length && (aeChanges.length || aeDescriptions.length)) {
            const durationTag = deferredBuffs[0]?.duration ?? "untilLongRest";
            const dndFlags = MealPhaseHandler._wellFedDnd5eDurationFlags(durationTag);
            const desc = [aeDescriptions.filter(Boolean).join(" "), dndFlags.manualNote].filter(Boolean).join("\n");
            await actor.createEmbeddedDocuments("ActiveEffect", [{
                name: `Well Fed: ${itemName}`,
                img: item.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                origin: actor.uuid,
                transfer: false,
                disabled: false,
                duration: dndFlags.duration ?? {},
                changes: aeChanges,
                description: desc || undefined,
                flags: {
                    [MODULE_ID]: { wellFed: true, expiresAt: "nextRestStart" },
                    core: { overlay: false },
                    "dfreds-convenient-effects": { isConvenient: true },
                    ...dndFlags.effectFlags
                }
            }]);
        }

        const deferredSummaries = deferredBuffs.map(b => MealPhaseHandler._buffSummaryLabel(b)).filter(Boolean);
        return [...immediateLines, ...deferredSummaries];
    }

    static async _removeWellFedEffects(actor) {
        const toDelete = actor.effects?.filter(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? [];
        if (toDelete.length) {
            await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete.map(e => e.id));
        }
    }

    /**
     * Strip all Well Fed effects from party actors at the start of a new rest.
     * Called from RestSetupApp.#onBeginRest so the effect persists between
     * sessions but is cleaned up when the next long rest begins.
     * @param {Actor[]} actors - Party actors starting a new rest.
     * @returns {Promise<number>} Count of effects removed.
     */
    static async cleanupWellFedEffects(actors) {
        let removed = 0;
        for (const actor of actors) {
            const wellFedEffects = actor.effects?.filter(
                e => e.flags?.[MODULE_ID]?.wellFed === true
            ) ?? [];
            if (wellFedEffects.length) {
                await actor.deleteEmbeddedDocuments(
                    "ActiveEffect", wellFedEffects.map(e => e.id)
                );
                removed += wellFedEffects.length;
            }
        }
        if (removed > 0) {
            console.log(`[Respite:Meal] Cleaned ${removed} Well Fed effect(s) at rest start`);
        }
        return removed;
    }

    /**
     * @returns {Promise<string|null>}
     */
    static async _resolveBuff(actor, buff, { chatDetail = false } = {}) {
        if (!buff?.type) return null;

        switch (buff.type) {
            case "temp_hp": {
                const total = await MealPhaseHandler._rollBuffFormula(actor, buff.formula);
                if (total <= 0) return null;
                if (game.system.id === "dnd5e") {
                    const cur = foundry.utils.getProperty(actor, "system.attributes.hp.temp") ?? 0;
                    const next = Math.max(cur, total);
                    await actor.update({ "system.attributes.hp.temp": next });
                }
                return chatDetail ? `temp HP +${total}` : `temp HP +${total}`;
            }
            case "heal": {
                const heal = await MealPhaseHandler._rollBuffFormula(actor, buff.formula);
                if (heal <= 0) return null;
                if (game.system.id === "dnd5e") {
                    const hp = foundry.utils.getProperty(actor, "system.attributes.hp.value") ?? 0;
                    const max = foundry.utils.getProperty(actor, "system.attributes.hp.effectivemax")
                        ?? foundry.utils.getProperty(actor, "system.attributes.hp.max") ?? hp;
                    await actor.update({ "system.attributes.hp.value": Math.min(max, hp + heal) });
                }
                return chatDetail ? `healing +${heal}` : `healing +${heal}`;
            }
            case "exhaustion_save": {
                const dc = Number(buff.save?.dc ?? buff.formula ?? 15);
                const roll = await new Roll(`1d20 + @abilities.con.save`, actor.getRollData?.() ?? {}).evaluate();
                const total = roll.total;
                const pass = total >= dc;
                if (pass && game.system.id === "dnd5e") {
                    const ex = foundry.utils.getProperty(actor, "system.attributes.exhaustion") ?? 0;
                    if (ex > 0) await actor.update({ "system.attributes.exhaustion": ex - 1 });
                }
                const detail = `${roll.formula} = ${total} vs DC ${dc} (${pass ? "pass" : "fail"})`;
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-dice-d20"></i> <strong>${actor.name}</strong> ${detail}. ${pass ? "Removes 1 exhaustion." : "No exhaustion removed."}</p></div>`,
                    speaker: ChatMessage.getSpeaker({ actor })
                });
                return chatDetail ? `exhaustion save (${detail})` : `exhaustion save (${pass ? "pass" : "fail"})`;
            }
            case "hit_die": {
                const raw = buff.formula ?? "1";
                let n = parseInt(raw, 10);
                if (Number.isNaN(n) || n <= 0) {
                    const r = await new Roll(String(raw), actor.getRollData()).evaluate();
                    n = Math.max(0, Math.floor(Number(r.total) || 0));
                }
                const restored = await MealPhaseHandler._restoreHitDice(actor, n);
                if (restored > 0) {
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><p><i class="fas fa-heart"></i> <strong>${actor.name}</strong> restores <strong>${restored}</strong> hit die.</p></div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                }
                return chatDetail ? `hit die +${restored}` : `hit die +${restored}`;
            }
            case "advantage":
            case "resistance":
                return null;
            default:
                return null;
        }
    }

    static _buffSummaryLabel(buff) {
        if (!buff?.type) return "";
        if (buff.type === "temp_hp") return `temp HP (${buff.formula ?? "?"})`;
        if (buff.type === "heal") return `healing (${buff.formula ?? "?"})`;
        if (buff.type === "advantage") {
            const ab = buff.save?.ability ?? "con";
            return `advantage on ${String(ab).toUpperCase()} saves (${buff.duration ?? "nextSave"})`;
        }
        if (buff.type === "resistance") {
            const dt = buff.damageType ?? buff.formula ?? "?";
            return `resistance (${dt}, ${buff.duration ?? "untilLongRest"})`;
        }
        return buff.type;
    }

    static async _rollBuffFormula(actor, formula) {
        if (!formula) return 0;
        try {
            const roll = await new Roll(String(formula), actor.getRollData?.() ?? {}).evaluate();
            return Math.floor(Number(roll.total) || 0);
        } catch {
            return 0;
        }
    }

    static async _restoreHitDice(actor, amount) {
        if (amount <= 0 || game.system.id !== "dnd5e") return 0;
        let remaining = amount;
        const classes = actor.items.filter(i => i.type === "class");
        classes.sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0));
        let restored = 0;
        for (const cls of classes) {
            if (remaining <= 0) break;
            const used = cls.system?.hitDiceUsed ?? 0;
            if (used <= 0) continue;
            const delta = Math.min(used, remaining);
            await cls.update({ "system.hitDiceUsed": used - delta });
            remaining -= delta;
            restored += delta;
        }
        return restored;
    }

    /**
     * Map duration tag to dnd5e ActiveEffect hints (best-effort across system versions).
     *
     * specialDuration is intentionally omitted here. Eating happens before native
     * longRest()/shortRest() runs, so setting specialDuration at creation time would
     * cause dnd5e to strip the AE the moment the rest fires — before recovery is
     * visible to the player. stampWellFedDuration() adds the correct specialDuration
     * after longRest() completes, so it only triggers on the NEXT rest.
     */
    static _wellFedDnd5eDurationFlags(durationTag) {
        const out = { duration: {}, effectFlags: {}, manualNote: "" };
        if (game.system.id !== "dnd5e") {
            out.manualNote = "Remove this Well Fed effect when the listed rest ends (or replace with another meal).";
            return out;
        }
        if (durationTag === "untilLongRest" || durationTag === "untilShortRest") {
            // No specialDuration on creation. stampWellFedDuration() sets it post-rest.
            foundry.utils.mergeObject(out.effectFlags, {
                dnd5e: { duration: { type: "none" } }
            });
            return out;
        }
        if (durationTag === "nextSave" || durationTag === "nextCheck") {
            out.manualNote = "Expires after the next qualifying save (remove manually if needed).";
            return out;
        }
        out.manualNote = "Remove when the buff would end per the recipe.";
        return out;
    }

    /**
     * Stamp specialDuration onto Well Fed AEs after longRest()/shortRest() has run.
     * Called after the native rest loop in RestSetupApp so the duration flag only
     * triggers on the NEXT rest rather than the one that just completed.
     *
     * @param {Actor[]} actors
     */
    static async stampWellFedDuration(actors) {
        for (const actor of actors) {
            const wellFedEffects = actor.effects?.filter(
                e => e.flags?.[MODULE_ID]?.wellFed === true
            ) ?? [];
            for (const ae of wellFedEffects) {
                const existing = ae.flags?.dnd5e?.specialDuration ?? [];
                if (!existing.includes("longRest")) {
                    await ae.update({ "flags.dnd5e.specialDuration": ["longRest"] });
                }
            }
        }
    }

    /**
     * Build ActiveEffect change list for deferred (non-immediate) buffs.
     */
    static async _buffToActiveEffectPartsAsync(actor, buff) {
        const changes = [];
        const descriptions = [];
        if (!buff?.type) return { changes, description: "" };

        if (buff.type === "temp_hp") {
            const total = await MealPhaseHandler._rollBuffFormula(actor, buff.formula);
            if (total <= 0) return { changes, description: "" };
            if (game.system.id === "dnd5e") {
                changes.push({
                    key: "system.attributes.hp.temp",
                    mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
                    value: String(total),
                    priority: 20
                });
                descriptions.push(`Temporary hit points: ${total}.`);
            }
            return { changes, description: descriptions.join(" ") };
        }

        if (buff.type === "advantage") {
            const ab = (buff.save?.ability ?? "con").toLowerCase();
            descriptions.push(
                `Advantage on ${ab.toUpperCase()} saving throws (${buff.duration ?? "nextSave"}). `
                + "Add the bonus via Convenient Effects or a manual modifier if the sheet does not pick this up."
            );
            return { changes, description: descriptions.join(" ") };
        }

        if (buff.type === "resistance") {
            const dtype = String(buff.damageType ?? buff.formula ?? "poison").toLowerCase();
            descriptions.push(
                `Damage resistance (${dtype}). Apply via Convenient Effects or manual resistance if needed.`
            );
            return { changes, description: descriptions.join(" ") };
        }

        return { changes, description: "" };
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
                name: item.name,
                itemId: item.id,
                available: qty,
                icon: item.img ?? "icons/consumables/food/bread-loaf-round-white.webp",
                partyMeal: item.flags?.[MODULE_ID]?.partyMeal ?? false
            });
        }

        return options;
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
                name: item.name,
                itemId: item.id,
                available: avail,
                icon: item.img ?? "icons/consumables/drinks/waterskin-leather-tan.webp"
            });
        }

        return options;
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
