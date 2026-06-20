/**
 * Chef feat (Tasha's): detection and scaling helpers.
 * Cooking DC -2 and nat-20 ambitious output live in CraftingEngine.
 */

const MODULE_ID = "ionrift-respite";

/**
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasChefFeat(actor) {
    return actor?.items?.some(i =>
        i.type === "feat" && String(i.name ?? "").toLowerCase() === "chef"
    ) ?? false;
}

/**
 * @param {Actor} actor
 * @returns {number}
 */
export function getChefProficiencyBonus(actor) {
    const adapter = game.ionrift?.respite?.adapter;
    if (adapter) {
        const pb = adapter.getProficiencyBonus(actor);
        if (pb) return pb;
    }
    const prof = Number(actor?.system?.attributes?.prof);
    if (Number.isFinite(prof) && prof > 0) return prof;
    return 2;
}

/**
 * Replenishing Meal: 4 + proficiency bonus eaters on a short rest.
 * @param {Actor} actor
 * @returns {number}
 */
export function getChefMealCapacity(actor) {
    return 4 + getChefProficiencyBonus(actor);
}

/**
 * Bolstering Treats: number of treats equal to proficiency bonus.
 * @param {Actor} actor
 * @returns {number}
 */
export function getChefTreatOutputQuantity(actor) {
    return getChefProficiencyBonus(actor);
}

/**
 * @param {Actor[]} actors
 * @returns {Array<{ actorId: string, chefName: string, mealCapacity: number, treatQuantity: number }>}
 */
export function scanEligibleChefs(actors) {
    const chefs = [];
    for (const actor of actors ?? []) {
        if (!hasChefFeat(actor)) continue;
        chefs.push({
            actorId: actor.id,
            chefName: actor.name ?? "",
            mealCapacity: getChefMealCapacity(actor),
            treatQuantity: getChefTreatOutputQuantity(actor),
        });
    }
    return chefs;
}

/**
 * @returns {Promise<{ total: number, formula: string }>}
 */
export async function rollChefMealBonus() {
    const roll = await new Roll("1d8").evaluate();
    return { total: Number(roll.total) || 0, formula: roll.formula };
}
