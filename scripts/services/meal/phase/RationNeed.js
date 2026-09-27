/**
 * One-day food and water owed at the current camp.
 * Terrain meal rules are the base. Actor modifiers sit on top of that base.
 */

import { TerrainRegistry } from "../../events/resolve/TerrainRegistry.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MODULE_ID } from "../inventory/MealConstants.js";
import { actorMealSlots } from "./MealContextBuilder.js";

/**
 * Terrain for the rest that is actually running.
 * The engine tag is the camp. The picker is the fallback before the engine exists.
 * @param {object} app
 * @returns {string}
 */
export function restTerrainTag(app) {
    const tag = app?._engine?.terrainTag || app?._selectedTerrain || app?._restData?.terrainTag;
    return tag || "forest";
}

/**
 * @param {object} app
 * @returns {object}
 */
export function restTerrainMealRules(app) {
    return TerrainRegistry.getDefaults(restTerrainTag(app))?.mealRules ?? {};
}

/**
 * Water pints credited by food already in the meal (stews, porridge, and similar).
 * @param {Actor|null} actor
 * @param {string[]} foodIds
 * @param {Map<string, string[]>|null} satiatesLookup
 * @returns {number}
 */
export function countMealWaterCredit(actor, foodIds, satiatesLookup = null) {
    if (!actor) return 0;
    let bonus = 0;
    for (const itemId of foodIds ?? []) {
        if (!itemId || itemId === "skip" || String(itemId).startsWith("__")) continue;
        const item = actor.items?.get?.(itemId);
        if (!item) continue;
        let satiates = item.flags?.[MODULE_ID]?.satiates;
        if (!Array.isArray(satiates) && satiatesLookup) {
            satiates = satiatesLookup.get(item.name.toLowerCase().trim()) ?? null;
        }
        if (Array.isArray(satiates) && satiates.includes("water")) bonus++;
    }
    return bonus;
}

/**
 * @param {Actor|null} actor
 * @param {{ food?: string[], water?: string[] }} [choice]
 * @param {object} [terrainMealRules]
 * @param {Map<string, string[]>|null} [satiatesLookup]
 */
export function evaluateDayRations(actor, choice = {}, terrainMealRules = {}, satiatesLookup = null) {
    const needs = actorMealSlots(actor, terrainMealRules);
    const foodArr = Array.isArray(choice.food) ? choice.food : [];
    const waterArr = Array.isArray(choice.water) ? choice.water : [];
    const foodFilled = foodArr.filter(id => ItemClassifier.isMealSlotSelection(actor, id)).length;
    const waterFilled = waterArr.filter(id => id && id !== "skip" && !String(id).startsWith("__")).length;
    const bonusWater = countMealWaterCredit(actor, foodArr, satiatesLookup);
    return {
        foodPerDay: needs.foodPerDay,
        waterPerDay: needs.waterPerDay,
        foodFilled,
        waterFilled,
        bonusWater,
        foodShort: Math.max(0, needs.foodPerDay - foodFilled),
        waterShort: Math.max(0, needs.waterPerDay - waterFilled - bonusWater)
    };
}

/**
 * Skip-meal lines for one character. Empty when the terrain requirement is met.
 * A tavern (nothing owed) stays quiet. A desert short on water names the pint gap.
 * @param {Actor|null} actor
 * @param {object} choice
 * @param {object} terrainMealRules
 * @param {Map<string, string[]>|null} [satiatesLookup]
 * @returns {string[]}
 */
export function rationSkipLines(actor, choice, terrainMealRules = {}, satiatesLookup = null) {
    const gap = evaluateDayRations(actor, choice, terrainMealRules, satiatesLookup);
    const name = actor?.name ?? "Character";
    const lines = [];
    if (gap.foodShort > 0) {
        lines.push(gap.foodFilled === 0
            ? `${name}: no food`
            : `${name}: ${gap.foodShort} food slot${gap.foodShort > 1 ? "s" : ""} empty`);
    }
    if (gap.waterShort > 0) {
        const covered = gap.waterFilled + gap.bonusWater;
        lines.push(covered === 0
            ? `${name}: no water`
            : `${name}: ${gap.waterShort} water pint${gap.waterShort > 1 ? "s" : ""} still needed`);
    }
    return lines;
}
