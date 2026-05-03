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
 */

import { ItemClassifier } from "./ItemClassifier.js";
import { CalendarHandler } from "./CalendarHandler.js";
import { SpoilageClock } from "./SpoilageClock.js";

/**
 * Compute per-actor food/water slot counts. Essence actors always need at
 * least 1 food slot (terrain cannot "provide" custom essence items). For
 * water, essence actors with only exotic drinks (oil, not water) also need
 * at least 1 slot since the terrain only covers standard water.
 */
function _actorMealSlots(actor, rules) {
    const isEssence = ItemClassifier.requiresEssence(actor);
    if (!isEssence) return { foodPerDay: rules.foodPerDay, waterPerDay: rules.waterPerDay, needsEssence: false };
    const diet = ItemClassifier.getDiet(actor);
    const needsExoticDrink = diet.canDrink.length > 0 && !diet.canDrink.includes("water");
    return {
        foodPerDay: Math.max(1, rules.foodPerDay),
        waterPerDay: needsExoticDrink ? Math.max(1, rules.waterPerDay) : rules.waterPerDay,
        needsEssence: true
    };
}

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
    waterPerDay: 2,
    foodPerDay: 1,
    dehydrationDC: 15,
    foodGraceDays: null  // null = 3 + CON mod (calculated per character)
};

export class MealPhaseHandler {

    /**
     * Resolve food spoilage across all party members before the meal phase.
     *
     * Rest-phase spoilage uses **elapsed rests since last long rest**, not the
     * calendar `harvestedDate`. Calendar-driven spoilage (`resolveCalendarSpoilage`)
     * runs on world time advances and uses `harvestedDate` when present. Both can
     * apply to the same item in worlds that use calendar tracking; GMs should treat
     * whichever fires first as authoritative for that beat.
     *
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
                if (spoilsAfter === null || spoilsAfter <= 0) return false;
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
     * Rest-phase spoilage (`resolveSpoilage`) uses rests since last long rest instead;
     * both can apply in the same world. See note on `resolveSpoilage`.
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
                if (spoilsAfter === null || spoilsAfter <= 0) continue;
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
                if (spoilsAfter === null || spoilsAfter <= 0) return false;

                const harvested = flags.harvestedDate;
                if (!harvested) return false;

                // Calendar-based: compare date strings (Y-M-D format)
                if (now && harvested.includes("-")) {
                    const daysPassed = SpoilageClock.dateDiffDays(harvested, now);
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

            // Per-actor slot counts: essence actors always need at least 1
            // food slot (terrain cannot provide custom essence items).
            const actorSlots = _actorMealSlots(actor, rules);
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
                    filled: sel && sel !== "skip",
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

            // ── Satiation cross-credit preview ──────────────────────────
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
                if (Array.isArray(itemFlags.satiates) && itemFlags.satiates.includes("water")) {
                    bonusWater++;
                }
            }
            const effectiveWaterFilled = waterFilledCount + bonusWater;
            const waterSufficient = effectiveWaterFilled >= wpd;

            // Build advisories (reactive to current selections)
            const partialSustenance = game.settings.get(MODULE_ID, "partialSustenance") ?? true;
            const advisories = this._buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient, foodFilledCount, waterSufficient, effectiveWaterFilled, partialSustenance);

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
                    sum + (d.food ?? []).filter(v => v && v !== "skip").length, 0);
                summaryWaterFilled = consumedDays.reduce((sum, d) =>
                    sum + (d.water ?? []).filter(v => v && v !== "skip").length, 0);
                summaryFoodRequired = fpd * totalDays;
                summaryWaterRequired = wpd * totalDays;
                summaryFoodSufficient = summaryFoodFilled >= summaryFoodRequired;
                summaryWaterSufficient = summaryWaterFilled >= summaryWaterRequired;
            }

            const poolWaterRequired = allDaysConsumed ? summaryWaterRequired : wpd;
            const poolWaterFilled = allDaysConsumed ? summaryWaterFilled : effectiveWaterFilled;
            const waterPoolSegments = [];
            for (let i = 0; i < poolWaterRequired; i++) {
                waterPoolSegments.push({ index: i, filled: i < poolWaterFilled });
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
                dehydrationAutoFail: false
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
            // Skip if items were already consumed at station submission time
            if (!choice.itemsConsumed) {
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
                    const consumed = await this._consumeItem(actor, itemId, amount, { wholeUnit: true });
                    console.log(`[Respite:Meal] Consumed ${consumed}x water item ${itemId} from ${actor.name}`);
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
    static async processAndApply(mealChoices, totalDays = 1, terrainMealRules = {}) {
        // Auto-consume: if a character has active food/water selections but hasn't
        // consumed all days, fold those selections into consumedDays.
        for (const [charId, choice] of mealChoices) {
            const consumed = choice.consumedDays ?? [];
            const food = Array.isArray(choice.food) ? choice.food : [];
            const water = Array.isArray(choice.water) ? choice.water : [];
            const hasActiveSelections = food.some(id => id && id !== "skip") || water.some(id => id && id !== "skip");

            if (consumed.length < totalDays && hasActiveSelections) {
                consumed.push({ food: [...food], water: [...water] });
                mealChoices.set(charId, {
                    ...choice,
                    consumedDays: consumed,
                    currentDay: consumed.length,
                    food: [],
                    water: []
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
     * Clone a crafted meal snapshot as a single leftover portion (not a whole-party dish).
     * @param {object} itemSnapshot
     * @returns {object}
     */
    static _mealSnapshotAsSingleLeftover(itemSnapshot) {
        const data = foundry.utils.duplicate(itemSnapshot);
        delete data._id;
        data.system = foundry.utils.mergeObject(data.system ?? {}, { quantity: 1 });
        const flags = foundry.utils.duplicate(data.flags ?? {});
        flags[MODULE_ID] = { ...(flags[MODULE_ID] ?? {}), partyMeal: false };
        data.flags = flags;
        return data;
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
                const alreadyWellFed = member.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false;
                if (alreadyWellFed) {
                    const doc = MealPhaseHandler._mealSnapshotAsSingleLeftover(itemSnapshot);
                    await member.createEmbeddedDocuments("Item", [doc]);
                    summaries.push(`<strong>${member.name}</strong>: packed serving (already Well Fed)`);
                } else {
                    const part = await MealPhaseHandler._applyWellFedEffect(member, itemSnapshot);
                    if (part?.length) summaries.push(`<strong>${member.name}</strong>: ${part.join("; ")}`);
                }
            }
            if (summaries.length) {
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${consumerActor.name}</strong>'s <strong>${itemName}</strong> feeds the whole party.</p><p>${summaries.join("<br>")}</p></div>`,
                    speaker: ChatMessage.getSpeaker({ actor: consumerActor })
                });
            }
        } else {
            const alreadyWellFed = consumerActor.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false;
            if (alreadyWellFed) {
                const doc = MealPhaseHandler._mealSnapshotAsSingleLeftover(itemSnapshot);
                await consumerActor.createEmbeddedDocuments("Item", [doc]);
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-box-open"></i> <strong>${consumerActor.name}</strong> could not eat another full meal yet. <strong>${itemName}</strong> was packed away.</p></div>`,
                    speaker: ChatMessage.getSpeaker({ actor: consumerActor })
                });
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
        if (buffRaw === null) return [];

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
        const aeDaeSpecials = [];
        for (const buff of deferredBuffs) {
            const built = await MealPhaseHandler._buffToActiveEffectPartsAsync(actor, buff);
            if (built.changes?.length) aeChanges.push(...built.changes);
            if (built.description) aeDescriptions.push(built.description);
            if (built.daeSpecialDuration?.length) aeDaeSpecials.push(...built.daeSpecialDuration);
        }

        const itemName = item.name ?? "Meal";
        if (deferredBuffs.length && (aeChanges.length || aeDescriptions.length)) {
            const durationTag = deferredBuffs[0]?.duration ?? "untilLongRest";
            const dndFlags = MealPhaseHandler._wellFedDnd5eDurationFlags(durationTag);

            // CE availability detection
            const ceActive = !!game.modules?.get?.("dfreds-convenient-effects")?.active;
            if (!ceActive && aeChanges.length) {
                aeDescriptions.push(
                    "Convenient Effects is not installed. This effect applies basic roll mode changes only — "
                    + "conditional automation (Midi-QoL triggers, advantage reminders) will not function."
                );
            }

            const desc = [aeDescriptions.filter(Boolean).join(" "), dndFlags.manualNote].filter(Boolean).join("\n");
            const aeFlags = {
                [MODULE_ID]: { wellFed: true, expiresAt: "nextRestStart" },
                core: { overlay: false },
                "dfreds-convenient-effects": { isConvenient: true },
                ...dndFlags.effectFlags
            };

            // Merge DAE specialDuration from buff builders
            if (aeDaeSpecials.length) {
                const existing = aeFlags.dae?.specialDuration ?? [];
                aeFlags.dae = { specialDuration: [...new Set([...existing, ...aeDaeSpecials])] };
            }

            await actor.createEmbeddedDocuments("ActiveEffect", [{
                name: `Well Fed: ${itemName}`,
                img: item.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                origin: actor.uuid,
                transfer: false,
                disabled: false,
                duration: dndFlags.duration ?? {},
                changes: aeChanges,
                description: desc || undefined,
                flags: aeFlags
            }]);

            // GM fallback chat when CE is missing
            if (!ceActive) {
                const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
                if (gmIds.length) {
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><p><i class="fas fa-exclamation-triangle"></i> <strong>Well Fed: ${itemName}</strong> applied to <strong>${actor.name}</strong> with basic AE changes. <em>Convenient Effects</em> is not installed — conditional triggers (expire on next save, advantage reminders) require CE + DAE/Midi-QoL.</p></div>`,
                        whisper: gmIds,
                        speaker: { alias: "Respite" }
                    });
                }
            }
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
            const ab = buff.save?.ability ?? buff.formula ?? "con";
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
     * cause DAE to strip the AE the moment the rest fires — before recovery is
     * visible to the player. stampWellFedDuration() adds the correct DAE specialDuration
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
                const existing = ae.flags?.dae?.specialDuration ?? [];
                if (!existing.includes("longRest")) {
                    const merged = [...new Set([...existing, "longRest"])];
                    await ae.update({ "flags.dae.specialDuration": merged });
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
            const ab = (buff.save?.ability ?? buff.formula ?? "con").toLowerCase();
            if (game.system.id === "dnd5e") {
                changes.push({
                    key: `system.abilities.${ab}.save.roll.mode`,
                    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                    value: "1",
                    priority: 20
                });
            }
            descriptions.push(
                `Advantage on ${ab.toUpperCase()} saving throws (${buff.duration ?? "nextSave"}).`
            );
            // DAE specialDuration for auto-expiry on next qualifying save
            const daeSpecialDuration = [];
            if (buff.duration === "nextSave") {
                daeSpecialDuration.push(`isSave.${ab}`);
            }
            return { changes, description: descriptions.join(" "), daeSpecialDuration };
        }

        if (buff.type === "resistance") {
            const dtype = String(buff.damageType ?? buff.formula ?? "poison").toLowerCase();
            if (game.system.id === "dnd5e") {
                changes.push({
                    key: `system.traits.dr.value`,
                    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                    value: dtype,
                    priority: 20
                });
            }
            descriptions.push(
                `Damage resistance (${dtype}).`
            );
            return { changes, description: descriptions.join(" "), daeSpecialDuration: [] };
        }

        return { changes, description: "", daeSpecialDuration: [] };
    }

    // ── Internal Helpers ─────────────────────────────────────────

    /** Known food item names (lowercase). Used as fallback when type/flag detection misses. */
    static FOOD_NAMES = new Set([
        "rations", "rations (1 day)", "trail rations", "iron rations"
    ]);

    /**
     * Build food options from actor inventory.
     *
     * Biological diets: ItemClassifier.isFood (resource type + tags + exclusions).
     * Essence diets (construct, undead, etc.): ItemClassifier.isEssenceMealFoodOption
     * (customFoodNames + fuel; oil flasks live under water only when diet allows oil).
     */
    static _buildFoodOptions(actor) {
        const options = [];
        const useEssenceTray = ItemClassifier.requiresEssence(actor);
        const defaultFoodIcon = useEssenceTray
            ? "icons/commodities/gems/gem-rough-white-blue.webp"
            : "icons/consumables/food/bread-loaf-round-white.webp";

        for (const item of actor.items) {
            const qty = item.system?.quantity ?? 1;
            if (qty <= 0) continue;

            const allowed = useEssenceTray
                ? ItemClassifier.isEssenceMealFoodOption(item, actor)
                : ItemClassifier.isFood(item, actor);
            if (!allowed) continue;

            options.push({
                value: item.id,
                label: `${item.name} (\u00d7${qty})`,
                name: item.name,
                itemId: item.id,
                available: qty,
                icon: item.img ?? defaultFoodIcon,
                partyMeal: item.flags?.[MODULE_ID]?.partyMeal ?? false
            });
        }

        return options;
    }



    /** Known water item names (lowercase). Used as fallback when flag detection misses. */
    static WATER_NAMES = new Set([
        "waterskin", "water flask", "canteen",
        "water (pint)", "water, fresh (pint)", "water, salt (pint)"
    ]);

    /**
     * Build water options from actor inventory.
     * Delegates to {@link ItemClassifier.isWater} for diet-aware filtering.
     */
    static _buildWaterOptions(actor, rules) {
        const options = [];

        for (const item of actor.items) {
            const qty = item.system?.quantity ?? 1;
            if (qty <= 0) continue;

            const isWater = ItemClassifier.isWater(item, actor);
            if (!isWater) continue;

            const avail = qty;
            const uses = item.system?.uses;
            const rawMax = uses && uses.max > 0 ? uses.max : 0;
            const isV5 = uses && ("spent" in uses);

            let totalPints;
            let maxCharges = null;
            let remainingCharges = null;
            let label;

            if (rawMax <= 0) {
                totalPints = avail;
                label = `${item.name} (\u00d7${avail})`;
            } else if (rawMax <= 1) {
                const rcRaw = isV5 ? (uses.max - (uses.spent ?? 0)) : uses.value;
                const rc = rcRaw != null ? Math.max(0, rcRaw) : avail;
                totalPints = Math.min(avail, rc);
                label = `${item.name} (${totalPints} pint${totalPints === 1 ? "" : "s"})`;
            } else {
                maxCharges = rawMax;
                const top = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);
                remainingCharges = Math.max(0, top);
                totalPints = remainingCharges + (avail - 1) * rawMax;
                label = `${item.name} (${totalPints} pints)`;
            }

            if (totalPints <= 0) continue;

            options.push({
                value: item.id,
                label,
                name: item.name,
                itemId: item.id,
                available: avail,
                maxCharges,
                remainingCharges,
                totalPints,
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
     * Consume up to `amount` units of an item (decrement quantity or uses).
     * Returns the number of units actually consumed (handles partial supply).
     *
     * Supports both DnD5e legacy (uses.value writable) and v5+
     * (uses.spent/uses.max, where value = max - spent and is read-only).
     *
     * @param {Actor} actor
     * @param {string} itemId - Item ID to consume
     * @param {number} amount - Number of units to consume
     * @param {object} [opts]
     * @param {boolean} [opts.wholeUnit=false] - Skip charge tracking and
     *   decrement quantity directly. Used for water/drink consumption where
     *   1 slot = 1 whole container regardless of internal pint charges.
     * @returns {number} Units actually consumed
     */
    static async _consumeItem(actor, itemId, amount = 1, { wholeUnit = false } = {}) {
        const item = actor.items.get(itemId);
        if (!item) return 0;

        const uses = item.system?.uses;
        const qty = item.system?.quantity ?? 1;
        let consumed = 0;

        if (wholeUnit) {
            consumed = Math.min(amount, qty);
            if (qty - consumed > 0) {
                await item.update({ "system.quantity": qty - consumed });
            } else {
                await actor.deleteEmbeddedDocuments("Item", [item.id]);
            }
            return consumed;
        }

        // Items with charges (rations bundles, etc.)
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
