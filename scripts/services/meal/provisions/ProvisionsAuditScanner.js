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
    "satiates",
    "coldStorage",
    "preservationMultiplier"
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

        // Container items: special audit display
        if (ItemClassifier.isContainer(item)) {
            const isCold = flags.coldStorage === true;
            const mult = Number(flags.preservationMultiplier ?? 2);
            const multLabel = mult === 0
                ? (game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.multStasis") : "Stasis (indefinite)")
                : (game.i18n?.format ? game.i18n.format("ionrift-respite.provisionsAudit.multShelfLife", { mult }) : `${mult}× shelf life`);
            const typeLabel = isCold
                ? (game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeColdStorage") : "Cold Storage")
                : (game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeContainer") : "Container");
            const detailLabel = isCold
                ? multLabel
                : (game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailNormalStorage") : "Normal Storage");
            return {
                id: item.id,
                uuid: item.uuid,
                name: item.name,
                img: item.img ?? "icons/svg/item-bag.svg",
                itemType: item.type,
                location: sourceLocation,
                actorId: actor?.id ?? null,
                actorName: actor?.name ?? null,
                rawType: "container",
                typeLabel,
                typeIcon: isCold ? "fa-snowflake" : "fa-box-archive",
                detailLabel,
                foodTag: "",
                drinkType: "",
                spoilageLabel: isCold ? multLabel : "-",
                isShelfStable: false,
                satiatesLabel: "-",
                flags: foundry.utils?.deepClone ? foundry.utils.deepClone(flags) : { ...flags }
            };
        }

        // Sustenance classification
        const rawType = flags.resourceType;
        let typeLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeAutoDetect") : "Auto-Detect";
        let typeIcon = "fa-wand-magic-sparkles";

        if (rawType === "food") {
            typeLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeRationFood") : "Ration / Food";
            typeIcon = "fa-utensils";
        } else if (rawType === "water") {
            typeLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeDrinkingWater") : "Drinking Water";
            typeIcon = "fa-tint";
        } else if (rawType === "ingredient") {
            typeLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeIngredient") : "Ingredient";
            typeIcon = "fa-mortar-pestle";
        } else if (rawType === "fuel") {
            typeLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeCampFuel") : "Camp Fuel";
            typeIcon = "fa-fire";
        } else if (rawType === "none") {
            typeLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeInedible") : "Inedible";
            typeIcon = "fa-ban";
        }

        // Dietary tag / liquid classification
        let detailLabel = "-";
        if (flags.foodTag === "meat") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailMeatProtein") : "Meat / Protein";
        else if (flags.foodTag === "plant") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailForagedPlant") : "Foraged Plant";
        else if (flags.foodTag === "prepared") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailPreparedDish") : "Prepared Dish";
        else if (flags.drinkType === "fresh") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailFreshWater") : "Fresh Water";
        else if (flags.drinkType === "water") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.typeDrinkingWater") : "Drinking Water";
        else if (flags.drinkType === "alcohol") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailAlcohol") : "Alcohol";
        else if (flags.drinkType === "oil") detailLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.detailOil") : "Oil";

        // Spoilage
        let spoilageLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.spoilageDefault") : "Default";
        if (flags.spoilsAfterHours !== null && flags.spoilsAfterHours !== undefined) {
            const h = Number(flags.spoilsAfterHours);
            spoilageLabel = `${h} hr${h === 1 ? "" : "s"}`;
        } else if (flags.spoilsAfter !== null && flags.spoilsAfter !== undefined) {
            const d = Number(flags.spoilsAfter);
            spoilageLabel = d === 0
                ? (game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.spoilageShelfStable") : "Shelf-Stable")
                : `${d} day${d === 1 ? "" : "s"}`;
        }

        // Satiates
        let satiatesLabel = "-";
        if (Array.isArray(flags.satiates)) {
            const hasFood = flags.satiates.includes("food");
            const hasWater = flags.satiates.includes("water");
            if (hasFood && hasWater) satiatesLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.satiatesFoodWater") : "Food & Water";
            else if (hasFood) satiatesLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.satiatesFood") : "Food";
            else if (hasWater) satiatesLabel = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.satiatesWater") : "Water";
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
            const worldItemLoc = game.i18n?.localize ? game.i18n.localize("ionrift-respite.provisionsAudit.locWorldItem") : "World Item";
            for (const item of game.items) {
                if (this.hasProvisionOverrides(item)) {
                    results.push(this.formatAuditEntry(item, worldItemLoc, null));
                }
            }
        }

        // 2. World Actors
        if (game?.actors) {
            for (const actor of game.actors) {
                if (!actor.items) continue;
                const carriedLoc = game.i18n?.format
                    ? game.i18n.format("ionrift-respite.provisionsAudit.locCarriedBy", { name: actor.name })
                    : `Carried by ${actor.name}`;
                for (const item of actor.items) {
                    if (this.hasProvisionOverrides(item)) {
                        results.push(this.formatAuditEntry(item, carriedLoc, actor));
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
                const tokenLoc = game.i18n?.format
                    ? game.i18n.format("ionrift-respite.provisionsAudit.locToken", { name: tokenDoc.name })
                    : `Token: ${tokenDoc.name}`;
                for (const item of actor.items) {
                    if (this.hasProvisionOverrides(item)) {
                        results.push(this.formatAuditEntry(item, tokenLoc, actor));
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
