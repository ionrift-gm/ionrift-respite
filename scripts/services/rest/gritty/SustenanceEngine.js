import { MODULE_ID } from "../../../data/moduleId.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { consumeItem } from "../../meal/inventory/MealItemConsumer.js";
import { scanEligibleChefs } from "../../meal/buffs/ChefFeat.js";
import { getActorMealNeeds } from "../../meal/phase/MealContextBuilder.js";
import { dehydrationOutcome } from "../../meal/phase/DehydrationCheck.js";
import { TerrainRegistry } from "../../events/resolve/TerrainRegistry.js";

/** Terrains where passive wild foraging (e.g. Outlander Wanderer) cannot gather forage. */
export const INELIGIBLE_FORAGE_TERRAINS = Object.freeze(new Set([
    "dungeon", "underdark", "urban", "barren", "astral", "abyss", "wasteland"
]));

/**
 * Sustenance and food priority engine for Gritty Realism rests (Bivouac and Downtime).
 * Centralises Outlander trait detection, Chef feat volunteering, Protected Shelf consumption,
 * and daily starvation accounting.
 */
export class SustenanceEngine {

    /**
     * Checks if any party member possesses the Outlander background or Wanderer feature,
     * and evaluates whether the current terrain allows passive foraging.
     *
     * @param {Actor[]} partyActors
     * @param {string} [terrainTag]
     * @returns {{ isEligible: boolean, hasOutlander: boolean, outlanderActor: Actor|null, shieldedCount: number, label: string }}
     */
    static scanOutlander(partyActors = [], terrainTag = "") {
        const cleanTerrain = String(terrainTag ?? "").toLowerCase().trim();
        const terrainBlocked = INELIGIBLE_FORAGE_TERRAINS.has(cleanTerrain);

        let outlanderActor = null;
        for (const actor of partyActors) {
            if (!actor?.items) continue;

            const bg = actor.system?.details?.background ?? "";
            const isOutlanderBg = typeof bg === "string" && bg.toLowerCase().includes("outlander");

            const hasWandererFeat = actor.items.some(i => {
                const name = (i.name ?? "").toLowerCase();
                return (i.type === "feat" || i.type === "background") &&
                    (name.includes("outlander") || name.includes("wanderer") || name.includes("natural explorer"));
            });

            if (isOutlanderBg || hasWandererFeat) {
                outlanderActor = actor;
                break;
            }
        }

        const hasOutlander = !!outlanderActor;
        const isEligible = hasOutlander && !terrainBlocked;

        return {
            isEligible,
            hasOutlander,
            outlanderActor,
            shieldedCount: isEligible ? 6 : 0,
            label: isEligible ? `Outlander (Wanderer: ${outlanderActor?.name})` : "Outlander (Inactive)"
        };
    }

    /**
     * Scans for eligible chefs in the party, accounting for whether camp stance permits cooking.
     *
     * @param {Actor[]} partyActors
     * @param {string} [campStance="warm"]
     * @returns {{ eligible: boolean, chefs: Array<{ actorId: string, chefName: string, mealCapacity: number }>, leadChef: object|null, cookingDisabled: boolean }}
     */
    static getChefStatus(partyActors = [], campStance = "warm") {
        const cookingDisabled = campStance === "cold_dark";
        const chefs = scanEligibleChefs(partyActors);

        return {
            eligible: chefs.length > 0 && !cookingDisabled,
            chefs,
            leadChef: chefs[0] ?? null,
            cookingDisabled
        };
    }

    /**
     * Evaluates an actor's inventory and selects the best candidate food according to the
     * Protected Shelf hierarchy:
     * 1. Expiring perishable food (spoils within 1 day)
     * 2. Plain rations / hardtack
     * 3. Bulk / raw foraged food
     * 4. Unbuffed cooked food
     * (Items with active buffs, Chef treats, or magical properties are PROTECTED and ignored)
     *
     * @param {Actor} actor
     * @returns {{ item: Item|null, isProtected: boolean, isStarving: boolean }}
     */
    static getProtectedShelfCandidate(actor) {
        if (!actor?.items) return { item: null, isProtected: false, isStarving: true };

        const items = actor.items.filter(i => {
            if (!ItemClassifier.isFood(i, actor)) return false;
            if (ItemClassifier.isSpoiled(i)) return false;

            // Protected Shelf: Skip buff-granting meals, magic food, chef treats
            const flags = i.flags?.[MODULE_ID] ?? {};
            if (flags.chefTreat || flags.buff || flags.wellFedBuff) return false;
            if (flags.magicFood || i.system?.properties?.has?.("mgc") || i.system?.magical) return false;

            const qty = i.system?.quantity ?? 1;
            const uses = i.system?.uses?.value ?? (i.system?.uses?.max ? i.system?.uses.max - (i.system?.uses.spent ?? 0) : 1);
            return qty > 0 && uses > 0;
        });

        if (!items.length) {
            return { item: null, isProtected: false, isStarving: true };
        }

        // 1. Spoilage priority: expiring within 1 day
        const expiring = items.find(i => {
            const daysLeft = i.flags?.[MODULE_ID]?.spoilage?.daysRemaining;
            return typeof daysLeft === "number" && daysLeft <= 1;
        });
        if (expiring) return { item: expiring, isProtected: false, isStarving: false };

        // 2. Plain rations / hardtack
        const ration = items.find(i => {
            const name = (i.name ?? "").toLowerCase();
            return name.includes("ration") || name.includes("hardtack") || name.includes("iron ration");
        });
        if (ration) return { item: ration, isProtected: false, isStarving: false };

        // 3. Raw/bulk forage
        const raw = items.find(i => {
            const name = (i.name ?? "").toLowerCase();
            return name.includes("berry") || name.includes("meat") || name.includes("nut") || name.includes("root");
        });
        if (raw) return { item: raw, isProtected: false, isStarving: false };

        // 4. Default to first unbuffed food item
        return { item: items[0], isProtected: false, isStarving: false };
    }

    /**
     * Resolves single-day sustenance consumption for an actor during a Bivouac overnight rest.
     * Updates restsSinceFood tracking flag honestly.
     *
     * @param {Actor} actor
     * @param {object} [options]
     * @param {boolean} [options.isChefFed=false]
     * @param {boolean} [options.isOutlanderShielded=false]
     * @param {string} [options.selectedItemId=null]
     * @param {Actor} [options.sharedProviderActor=null]
     * @param {string} [options.sharedItemId=null]
     * @returns {Promise<{
     *   ate: boolean,
     *   source: "outlander"|"chef"|"inventory"|"none",
     *   itemName: string,
     *   rationsDeducted: number,
     *   starving: boolean,
     *   restsSinceFood: number
     * }>}
     */
    static async resolveBivouacActorMeal(actor, {
        isChefFed = false,
        isOutlanderShielded = false,
        selectedItemId = null
    } = {}) {
        if (!actor) {
            return { ate: false, source: "none", itemName: "", rationsDeducted: 0, starving: true, restsSinceFood: 1 };
        }

        // Outlander shield overrides
        if (isOutlanderShielded) {
            await actor.setFlag(MODULE_ID, "restsSinceFood", 0);
            return {
                ate: true,
                source: "outlander",
                itemName: "Foraged Provisions",
                rationsDeducted: 0,
                starving: false,
                restsSinceFood: 0
            };
        }

        // Chef Replenishing Meal overrides
        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (isChefFed && treatsProvideSustenance) {
            await actor.setFlag(MODULE_ID, "restsSinceFood", 0);
            return {
                ate: true,
                source: "chef",
                itemName: "Chef's Replenishing Meal",
                rationsDeducted: 0,
                starving: false,
                restsSinceFood: 0
            };
        }

        // Personal inventory consumption
        let candidateItem = null;
        if (selectedItemId) {
            candidateItem = actor.items?.get(selectedItemId) ?? null;
        } else {
            const shelf = this.getProtectedShelfCandidate(actor);
            candidateItem = shelf.item;
        }

        if (candidateItem) {
            const consumed = await consumeItem(actor, candidateItem.id, 1);
            if (consumed > 0) {
                await actor.setFlag(MODULE_ID, "restsSinceFood", 0);
                return {
                    ate: true,
                    source: "inventory",
                    itemName: candidateItem.name,
                    rationsDeducted: consumed,
                    starving: false,
                    restsSinceFood: 0
                };
            }
        }

        // Starvation: no food available or selected
        const currentRests = Number(actor.getFlag(MODULE_ID, "restsSinceFood") ?? 0);
        const newRests = currentRests + 1;
        await actor.setFlag(MODULE_ID, "restsSinceFood", newRests);

        return {
            ate: false,
            source: "none",
            itemName: "",
            rationsDeducted: 0,
            starving: true,
            restsSinceFood: newRests
        };
    }

    /**
     * Evaluates an actor's inventory and selects the best candidate drink/water item:
     * 1. Waterskins with remaining uses/charges
     * 2. Plain water items / rations
     * 3. Custom diet-appropriate drinks (e.g. oil for constructs)
     *
     * @param {Actor} actor
     * @returns {Item|null}
     */
    static getCandidateWater(actor) {
        if (!actor?.items) return null;
        const waters = (actor.items ?? []).filter(i => {
            if (!ItemClassifier.isWater(i, actor)) return false;
            if (ItemClassifier.isSpoiled(i)) return false;
            const qty = i.system?.quantity ?? 1;
            const uses = i.system?.uses?.value ?? (i.system?.uses?.max ? i.system?.uses.max - (i.system?.uses.spent ?? 0) : 1);
            return qty > 0 && uses > 0;
        });
        if (!waters.length) return null;

        // 1. Prioritise waterskins
        const waterskin = waters.find(i => (i.name ?? "").toLowerCase().includes("waterskin"));
        if (waterskin) return waterskin;

        // 2. Plain water
        const plainWater = waters.find(i => (i.name ?? "").toLowerCase().includes("water"));
        if (plainWater) return plainWater;

        // 3. Fallback to first available drink
        return waters[0];
    }

    /**
     * Resolves single-day water consumption for an actor during a Bivouac overnight rest.
     * Updates restsSinceWater tracking flag honestly.
     *
     * @param {Actor} actor
     * @param {object} [options]
     * @param {boolean} [options.isOutlanderShielded=false]
     * @param {string} [options.selectedItemId=null]
     * @param {string} [options.terrainTag]
     * @returns {Promise<{
     *   drank: boolean,
     *   source: "outlander"|"inventory"|"none",
     *   itemName: string,
     *   unitsDeducted: number,
     *   dehydrated: boolean,
     *   restsSinceWater: number,
     *   dehydrationSaveDC: number,
     *   dehydrationAutoFail: boolean
     * }>}
     */
    static async resolveBivouacActorWater(actor, {
        isOutlanderShielded = false,
        selectedItemId = null,
        terrainTag = null
    } = {}) {
        const clear = {
            dehydrationSaveDC: 0,
            dehydrationAutoFail: false
        };
        if (!actor) {
            return { drank: false, source: "none", itemName: "", unitsDeducted: 0, dehydrated: true, restsSinceWater: 1, ...clear, dehydrationAutoFail: true };
        }

        // Outlander shield covers fresh water for the camp
        if (isOutlanderShielded) {
            await actor.setFlag(MODULE_ID, "restsSinceWater", 0);
            return {
                drank: true,
                source: "outlander",
                itemName: "Fresh Spring Water",
                unitsDeducted: 0,
                dehydrated: false,
                restsSinceWater: 0,
                ...clear
            };
        }

        const mealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const needed = getActorMealNeeds(actor, mealRules).waterPerDay;
        if (needed <= 0) {
            await actor.setFlag(MODULE_ID, "restsSinceWater", 0);
            return {
                drank: false,
                source: "none",
                itemName: "",
                unitsDeducted: 0,
                dehydrated: false,
                restsSinceWater: 0,
                ...clear
            };
        }

        // Personal water consumption. One pint does not clear a gallon.
        let candidateItem = null;
        if (selectedItemId) {
            candidateItem = actor.items?.get(selectedItemId) ?? null;
        } else {
            candidateItem = this.getCandidateWater(actor);
        }

        let consumed = 0;
        if (candidateItem && needed > 0) {
            consumed = await consumeItem(actor, candidateItem.id, needed);
        }

        const band = dehydrationOutcome(consumed, needed);
        if (!band.dehydrationAutoFail && band.dehydrationSaveDC === 0) {
            await actor.setFlag(MODULE_ID, "restsSinceWater", 0);
            return {
                drank: true,
                source: consumed > 0 ? "inventory" : "none",
                itemName: candidateItem?.name ?? "",
                unitsDeducted: consumed,
                dehydrated: false,
                restsSinceWater: 0,
                ...band
            };
        }

        const currentRests = Number(actor.getFlag(MODULE_ID, "restsSinceWater") ?? 0);
        const newRests = currentRests + 1;
        await actor.setFlag(MODULE_ID, "restsSinceWater", newRests);

        return {
            drank: consumed > 0,
            source: consumed > 0 ? "inventory" : "none",
            itemName: candidateItem?.name ?? "",
            unitsDeducted: consumed,
            dehydrated: true,
            restsSinceWater: newRests,
            ...band
        };
    }
}
