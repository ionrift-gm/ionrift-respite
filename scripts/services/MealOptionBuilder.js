/**
 * Build per-actor meal option lists (food, water, essence) from inventory, and
 * the reactive advisory messages shown alongside the current selections.
 */

import { ItemClassifier } from "./ItemClassifier.js";
import { MODULE_ID } from "./MealConstants.js";
import {
    iterInventoryItems,
    isContainerType,
    getContainerParentId,
    collectWaterSourceContainerIds
} from "./MealInventoryHelpers.js";

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

        options.push({
            value: item.id,
            label: `${item.name} (\u00d7${qty})`,
            name: item.name,
            itemId: item.id,
            available: qty,
            icon: (item.img && !item.img.includes("mystery-man")) ? item.img : defaultFoodIcon,
            partyMeal: item.flags?.[MODULE_ID]?.partyMeal ?? false
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

        // Only skip items stored inside a water-source container
        // (e.g. Water Pints inside a Waterskin container); their
        // pints are accounted for by the parent container entry.
        // Items inside mundane containers (backpacks) pass through.
        const parentId = getContainerParentId(item);
        if (parentId && waterContainerIds.has(parentId)) continue;

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
            const rc = (rcRaw !== null && rcRaw !== undefined) ? Math.max(0, rcRaw) : avail;
            totalPints = Math.min(avail, rc);
            label = `${item.name} (${totalPints} pint${totalPints === 1 ? "" : "s"})`;
        } else {
            maxCharges = rawMax;
            const top = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);
            remainingCharges = Math.max(0, top);
            totalPints = remainingCharges + (avail - 1) * rawMax;
            label = `${item.name} (${totalPints} pints)`;
        }

        // Container-type items (DnD5e Waterskin as container): count
        // contained water items instead of the container's own quantity.
        if (isContainerType(item) && rawMax <= 0) {
            let containedPints = 0;
            for (const child of inventoryItems) {
                if (getContainerParentId(child) !== item.id) continue;
                if (!ItemClassifier.isWater(child, actor)) continue;
                containedPints += child.system?.quantity ?? 1;
            }
            if (containedPints <= 0) continue;
            totalPints = containedPints;
            label = `${item.name} (${totalPints} pint${totalPints === 1 ? "" : "s"})`;
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
            icon: (item.img && !item.img.includes("mystery-man")) ? item.img : "icons/magic/water/water-drop-swirl-blue.webp"
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
