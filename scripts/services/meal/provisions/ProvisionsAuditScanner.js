/**
 * ProvisionsAuditScanner
 * Scans the active Foundry world (world items, actor inventories, and active
 * scene unlinked tokens) to locate all items carrying custom Respite provisions,
 * spoilage, or dietary flags.
 */

import { MODULE_ID } from "../../../data/moduleId.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { refreshSpoilageBadgesOnOpenSheets } from "../../ui/sheet/UiInjections.js";

/** Flag keys considered custom provisions overrides. */
const OVERRIDE_KEYS = [
    "resourceType",
    "foodTag",
    "drinkType",
    "spoilsAfter",
    "spoilsAfterHours",
    "satiates"
];

export class ProvisionsAuditScanner {

    /**
     * Determine whether an item carries any explicit Respite provisions overrides.
     * @param {Item|object} item
     * @returns {boolean}
     */
    static hasProvisionOverrides(item) {
        if (!item?.flags?.[MODULE_ID]) return false;
        const flags = item.flags[MODULE_ID];
        return OVERRIDE_KEYS.some(k => flags[k] !== undefined && flags[k] !== null);
    }

    /**
     * Format an item document into a clean audit display entry.
     * @param {Item} item
     * @param {string} sourceLocation - Human-readable origin label
     * @param {Actor|null} actor - Owning actor, if any
     * @returns {object}
     */
    static formatAuditEntry(item, sourceLocation, actor = null) {
        const flags = item.flags?.[MODULE_ID] ?? {};

        // Sustenance classification
        const rawType = flags.resourceType;
        let typeLabel = "Auto-Detect";
        let typeIcon = "fa-wand-magic-sparkles";

        if (rawType === "food") {
            typeLabel = "Ration / Food";
            typeIcon = "fa-utensils";
        } else if (rawType === "water") {
            typeLabel = "Drinking Water";
            typeIcon = "fa-tint";
        } else if (rawType === "ingredient") {
            typeLabel = "Ingredient";
            typeIcon = "fa-mortar-pestle";
        } else if (rawType === "fuel") {
            typeLabel = "Camp Fuel";
            typeIcon = "fa-fire";
        } else if (rawType === "none") {
            typeLabel = "Inedible";
            typeIcon = "fa-ban";
        }

        // Dietary tag / liquid classification
        let detailLabel = "-";
        if (flags.foodTag === "meat") detailLabel = "Meat / Protein";
        else if (flags.foodTag === "plant") detailLabel = "Foraged Plant";
        else if (flags.foodTag === "prepared") detailLabel = "Prepared Dish";
        else if (flags.drinkType === "fresh") detailLabel = "Fresh Water";
        else if (flags.drinkType === "water") detailLabel = "Drinking Water";
        else if (flags.drinkType === "alcohol") detailLabel = "Alcohol";
        else if (flags.drinkType === "oil") detailLabel = "Oil";

        // Spoilage
        let spoilageLabel = "Default";
        if (flags.spoilsAfterHours !== null && flags.spoilsAfterHours !== undefined) {
            const h = Number(flags.spoilsAfterHours);
            spoilageLabel = `${h} hr${h === 1 ? "" : "s"}`;
        } else if (flags.spoilsAfter !== null && flags.spoilsAfter !== undefined) {
            const d = Number(flags.spoilsAfter);
            spoilageLabel = d === 0 ? "Shelf-Stable" : `${d} day${d === 1 ? "" : "s"}`;
        }

        // Satiates
        let satiatesLabel = "-";
        if (Array.isArray(flags.satiates)) {
            const hasFood = flags.satiates.includes("food");
            const hasWater = flags.satiates.includes("water");
            if (hasFood && hasWater) satiatesLabel = "Food & Water";
            else if (hasFood) satiatesLabel = "Food";
            else if (hasWater) satiatesLabel = "Water";
        }

        return {
            id: item.id,
            uuid: item.uuid,
            name: item.name,
            img: item.img ?? "icons/svg/item-bag.svg",
            itemType: item.type,
            location: sourceLocation,
            actorId: actor?.id ?? null,
            actorName: actor?.name ?? null,
            rawType: rawType ?? "",
            typeLabel,
            typeIcon,
            detailLabel,
            foodTag: flags.foodTag ?? "",
            drinkType: flags.drinkType ?? "",
            spoilageLabel,
            isShelfStable: flags.spoilsAfter === 0,
            satiatesLabel,
            flags: foundry.utils?.deepClone ? foundry.utils.deepClone(flags) : { ...flags }
        };
    }

    /**
     * Scan the world for all items with custom Respite provisions overrides.
     * @returns {object[]} Sorted array of formatted audit entries.
     */
    static scanWorldOverrides() {
        const results = [];

        // 1. World Items (item directory)
        if (game?.items) {
            for (const item of game.items) {
                if (this.hasProvisionOverrides(item)) {
                    results.push(this.formatAuditEntry(item, "World Item", null));
                }
            }
        }

        // 2. World Actors
        if (game?.actors) {
            for (const actor of game.actors) {
                if (!actor.items) continue;
                for (const item of actor.items) {
                    if (this.hasProvisionOverrides(item)) {
                        results.push(this.formatAuditEntry(item, `Carried by ${actor.name}`, actor));
                    }
                }
            }
        }

        // 3. Unlinked scene token actors (synthetic actors on active scene)
        if (game?.scenes?.active?.tokens) {
            for (const tokenDoc of game.scenes.active.tokens) {
                if (tokenDoc.isLinked) continue; // linked tokens already scanned in game.actors
                const actor = tokenDoc.actor;
                if (!actor?.items) continue;
                for (const item of actor.items) {
                    if (this.hasProvisionOverrides(item)) {
                        results.push(this.formatAuditEntry(item, `Token: ${tokenDoc.name}`, actor));
                    }
                }
            }
        }

        // Sort alphabetically by item name
        results.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        return results;
    }

    /**
     * Remove all Respite provisions flags from an item document.
     * @param {Item} item
     * @returns {Promise<Item>}
     */
    static async clearItemOverrides(item) {
        if (!item?.update) return item;
        const updates = {
            [`flags.-=${MODULE_ID}`]: null
        };
        const result = await item.update(updates);
        refreshSpoilageBadgesOnOpenSheets();
        return result;
    }
}
