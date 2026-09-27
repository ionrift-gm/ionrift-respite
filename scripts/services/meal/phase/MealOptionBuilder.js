/**
 * Build per-actor meal option lists (food, water, essence) from inventory, and
 * the reactive advisory messages shown alongside the current selections.
 */

import { ItemClassifier } from "../../party/ItemClassifier.js";
import { SpoilageClock } from "../spoilage/SpoilageClock.js";
import { MODULE_ID } from "../inventory/MealConstants.js";
import { describeItemMealBuff } from "../buffs/MealBuffPresets.js";
import {
    iterInventoryItems,
    collectWaterSourceContainerIds
} from "../inventory/MealInventoryHelpers.js";

/**
 * Build food options from actor inventory.
 *
 * Biological diets: ItemClassifier.isFood (resource type + tags + exclusions).
 * Essence diets (construct, undead, etc.): ItemClassifier.isEssenceMealFoodOption
 * (customFoodNames + fuel; oil flasks live under water only when diet allows oil).
 */
export function buildFoodOptions(actor) {
    const options = [];
    const useEssenceTray = ItemClassifier.requiresEssence(actor);
    const defaultFoodIcon = useEssenceTray
        ? "icons/commodities/gems/gem-rough-white-blue.webp"
        : "icons/consumables/food/bread-loaf-round-white.webp";

    for (const item of iterInventoryItems(actor)) {
        const qty = item.system?.quantity ?? 1;
        if (qty <= 0) continue;

        // Food inside any container (backpack, bag of holding, etc.)
        // is accessible and should appear in the meal tray.

        const allowed = useEssenceTray
            ? ItemClassifier.isEssenceMealFoodOption(item, actor)
            : ItemClassifier.isMealSubstitute(item, actor);
        if (!allowed) continue;

        const mealBuff = describeItemMealBuff(item.flags?.[MODULE_ID]);
        options.push({
            value: item.id,
            label: `${item.name} (\u00d7${qty})`,
            name: item.name,
            itemId: item.id,
            available: qty,
            icon: (item.img && !item.img.includes("mystery-man")) ? item.img : defaultFoodIcon,
            partyMeal: item.flags?.[MODULE_ID]?.partyMeal ?? false,
            hasBuff: mealBuff.hasBuff,
            buffSummary: mealBuff.buffSummary,
            ...SpoilageClock.chipFields(item)
        });
    }

    return options;
}

/**
 * Build water options from actor inventory.
 * Delegates to {@link ItemClassifier.isWater} for diet-aware filtering.
 */
export function buildWaterOptions(actor, rules) {
    const options = [];
    const inventoryItems = iterInventoryItems(actor);
    const waterContainerIds = collectWaterSourceContainerIds(inventoryItems, actor);

    for (const item of inventoryItems) {
        const qty = item.system?.quantity ?? 1;
        if (qty <= 0) continue;

        // A waterskin container is the vessel. Offer the pints inside it
        // so drinking does not consume the container. Items in a mundane
        // backpack still pass through on their own.
        if (waterContainerIds.has(item.id)) continue;

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

        if (rawMax <= 1) {
            const rcRaw = rawMax <= 0
                ? avail
                : (isV5 ? (uses.max - (uses.spent ?? 0)) : uses.value);
            const rc = (rcRaw !== null && rcRaw !== undefined) ? Math.max(0, rcRaw) : avail;
            // max of 1 means each item in the stack is one pint. A stack of
            // four is four drinks. Only a lone empty charge is nothing.
            totalPints = avail > 1 ? avail : Math.min(avail, rc);
            label = rawMax <= 0
                ? `${item.name} (\u00d7${totalPints})`
                : `${item.name} (${totalPints} pint${totalPints === 1 ? "" : "s"})`;
        } else {
            maxCharges = rawMax;
            const top = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);
            remainingCharges = Math.max(0, top);
            totalPints = remainingCharges + (avail - 1) * rawMax;
            label = `${item.name} (${totalPints} pints)`;
        }

        if (totalPints <= 0) continue;

        const mealBuff = describeItemMealBuff(item.flags?.[MODULE_ID]);
        options.push({
            value: item.id,
            label,
            name: item.name,
            itemId: item.id,
            available: totalPints,
            maxCharges,
            remainingCharges,
            totalPints,
            icon: (item.img && !item.img.includes("mystery-man")) ? item.img : "icons/magic/water/water-drop-swirl-blue.webp",
            hasBuff: mealBuff.hasBuff,
            buffSummary: mealBuff.buffSummary,
            ...SpoilageClock.chipFields(item)
        });
    }

    return options;
}

/**
 * Build advisory messages about current hunger/thirst status.
 */
export function buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient = false, foodFilledCount = 0, waterSufficient = false, waterFilledCount = 0, partialSustenance = true) {
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
 * Send-off card for food or drink already placed on the night.
 * A buffed portion wins over a plain one.
 * @param {object[]} placedOptions
 * @returns {{ empty: boolean, itemName?: string, hasBuff?: boolean, buffSummary?: string }}
 */
export function sendoffFromPlaced(placedOptions) {
    const placed = (placedOptions ?? []).filter(option => option?.name);
    const withBuff = placed.find(option => option.hasBuff && option.buffSummary);
    if (withBuff) {
        return {
            empty: false,
            itemName: withBuff.name,
            hasBuff: true,
            buffSummary: withBuff.buffSummary
        };
    }
    if (placed.length) {
        return { empty: false, itemName: placed[0].name, hasBuff: false, buffSummary: "" };
    }
    return { empty: true };
}

/**
 * Build essence/recharge options from actor inventory.
 * For non-biological characters that require essence.
 */
export function buildEssenceOptions(actor) {
    const options = [];

    for (const item of actor.items) {
        const qty = item.system?.quantity ?? 1;
        if (qty <= 0) continue;

        if (!ItemClassifier.isEssenceMealFoodOption(item, actor)) continue;

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
 * Normalize an item name into a CSS beverage class.
 * Matches: waterskin, canteen, flask, wine, ale, tea, broth.
 * Defaults to "waterskin".
 *
 * @param {string} [name=""]
 * @returns {"waterskin"|"canteen"|"flask"|"wine"|"ale"|"tea"|"broth"}
 */
export function normalizeBeverageClass(name = "") {
    const n = String(name || "").toLowerCase().trim();
    if (n.includes("canteen")) return "canteen";
    if (n.includes("flask")) return "flask";
    if (n.includes("wine")) return "wine";
    if (n.includes("ale") || n.includes("beer") || n.includes("mead")) return "ale";
    if (n.includes("tea")) return "tea";
    if (n.includes("broth") || n.includes("soup")) return "broth";
    return "waterskin";
}
