/**
 * Shared forage and hunt yield resolution.
 *
 * Both the travel phase and the seven day downtime ledger answer the same
 * question: a character spent a day gathering, what did they come back with.
 * This service owns the success tiers and routes the actual loot through the
 * same terrain tables the travel phase uses, so authored forage content is
 * reachable from either rest style.
 */

import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { TravelResolver } from "../../travel/resolve/TravelResolver.js";

/**
 * Gritty week forage is stamped on the morning the rest opens, then the
 * calendar jumps seven days. Say so before that looks like a lost haul.
 */
export const FRESH_FORAGE_NOTE =
    "Fresh forage is dated from the first morning. Meat and berries are usually spoiled when the week ends. Rations and preserves last.";

/** @type {TravelResolver|null} */
let sharedResolver = null;

/**
 * A resolver loaded from the global provision index. The travel phase builds
 * its own with pack pools layered on; this one covers the compendium base
 * pools, which is what the terrain tables draw from.
 *
 * @returns {TravelResolver}
 */
function getResolver() {
    if (sharedResolver) return sharedResolver;
    sharedResolver = new TravelResolver();
    try {
        const index = game.ionrift?.respite?.travelBasePoolIndex;
        if (index) {
            sharedResolver.loadBaseItems(index, game.ionrift?.respite?.travelFolderPathMap);
        }
    } catch (err) {
        Logger.warn(`${MODULE_ID} | Gather yield: base pool load failed`, err);
    }
    return sharedResolver;
}

/** Drops the cached resolver. Call when provision content is reloaded. */
export function resetGatherResolver() {
    sharedResolver = null;
}

export { getResolver as getGatherResolver };

/**
 * Display name for a gathered row. Authored items keep their name.
 * A bare item ref is spaced out so the roll card is readable.
 * @param {object} entry
 * @returns {string}
 */
const KNOWN_PROVISIONS = {
    fresh_meat: { name: "Fresh Meat", img: "icons/consumables/meat/steak-raw-red-pink.webp" },
    fresh_fish: { name: "Fresh Fish", img: "icons/consumables/meat/fish-whole-blue.webp" },
    choice_cut: { name: "Choice Cut", img: "icons/consumables/meat/steak-marbled.webp" },
    animal_fat: { name: "Animal Fat", img: "icons/commodities/biological/shell-tan.webp" },
    venom_sac: { name: "Venom Sac", img: "icons/consumables/potions/bottle-round-corked-red.webp" }
};

function readableProvisionName(entry) {
    const named = String(entry?.itemData?.name ?? "").trim();
    if (named) return named;
    const ref = String(entry?.itemRef ?? "").trim();
    if (!ref) return "provisions";
    if (KNOWN_PROVISIONS[ref]) return KNOWN_PROVISIONS[ref].name;
    const words = ref.split(/[_-]+/).filter(Boolean);
    if (!words.length) return "provisions";
    return words.map((word, index) => {
        const lower = word.toLowerCase();
        if (index === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
        return lower;
    }).join(" ");
}

export class GatherYieldService {

    /**
     * Shared travel resolver with base compendium items loaded.
     * @returns {TravelResolver}
     */
    static getResolver() {
        return getResolver();
    }


    /**
     * Ration equivalent for one day of gathering. This is the single
     * definition; the ledger preview and the batch resolver both read it.
     *
     * @param {object} params
     * @param {"forage"|"hunt"} params.mode
     * @param {number} params.total Skill check total.
     * @param {number} params.dc
     * @returns {number}
     */
    static rationsForCheck({ mode, total, dc }) {
        if (!Number.isFinite(total) || !Number.isFinite(dc)) return 0;
        if (total < dc) return 0;
        const isHunt = mode === "hunt";
        if (total >= 20) return isHunt ? 5 : 4;
        if (total >= dc + 5) return isHunt ? 4 : 3;
        return isHunt ? 3 : 2;
    }

    /**
     * Resolves one gathering day into concrete items where terrain content
     * exists, falling back to the ration equivalent where it does not.
     *
     * Does not touch inventory. The caller grants.
     *
     * @param {object} params
     * @param {Actor} params.actor
     * @param {"forage"|"hunt"} params.mode
     * @param {string} params.terrainTag
     * @param {number} params.total
     * @param {number} params.dc
     * @param {number[]} [params.lootRolls] Player d100 faces for the findings table.
     * @returns {Promise<{success: boolean, rations: number, items: Array<object>, fromTable: boolean}>}
     */
    static async resolveGatherDay({ actor, mode, terrainTag, total, dc, lootRolls = [] }) {
        const rations = GatherYieldService.rationsForCheck({ mode, total, dc });
        const success = rations > 0;
        const empty = { success, rations, items: [], fromTable: false, mishap: "" };
        if (!actor) return empty;

        try {
            const resolver = getResolver();
            const isHunt = mode === "hunt";
            const skillEval = isHunt
                ? resolver.evaluateHuntSkill(actor, total, dc)
                : resolver.evaluateForageSkill(actor, total, dc);
            const result = isHunt
                ? await resolver.buildHuntResult(actor, terrainTag, total, dc, skillEval, lootRolls)
                : await resolver.buildForageResult(actor, terrainTag, total, dc, skillEval, lootRolls);

            const items = result?.items ?? [];
            const mishap = result?.mishap?.description ?? "";
            if (!items.length && !mishap) return empty;
            return { success, rations, items, fromTable: items.length > 0, mishap };
        } catch (err) {
            // Content gaps must not stall a seven night resolution. Fall back
            // to the ration equivalent and keep going.
            Logger.warn(`${MODULE_ID} | Gather yield: table draw failed for ${mode}/${terrainTag}`, err);
            return empty;
        }
    }

    /**
     * Grants a resolved item list to an actor, with the same spoilage and
     * stacking handling the travel phase uses.
     *
     * @param {Actor} actor
     * @param {Array<object>} items
     */
    static async grantGatheredItems(actor, items = []) {
        if (!actor || !items.length) return;
        await getResolver().grantItems(actor, items);
    }

    /**
     * Total quantity across a resolved item list, for summary lines.
     *
     * @param {Array<{quantity?: number}>} items
     * @returns {number}
     */
    static countUnits(items = []) {
        return items.reduce((sum, entry) => sum + (entry?.quantity ?? 1), 0);
    }

    /**
     * True when a haul includes food that spoils in a few days.
     * Ration fallbacks have no item data and are treated as stores that keep.
     * @param {Array<{ itemData?: object }>} items
     * @returns {boolean}
     */
    static includesPerishable(items = []) {
        return items.some(entry => {
            const data = entry?.itemData;
            if (!data) return false;
            const days = ItemClassifier.getSpoilsAfter({
                name: data.name,
                type: data.type ?? "loot",
                flags: data.flags ?? {}
            });
            return typeof days === "number" && days > 0;
        });
    }

    /**
     * Comma separated item names for a summary line.
     *
     * @param {Array<{itemData?: {name?: string}, quantity?: number}>} items
     * @returns {string}
     */
    static describeItems(items = []) {
        return items
            .map(entry => {
                const name = readableProvisionName(entry);
                const qty = entry?.quantity ?? 1;
                return qty > 1 ? `${name} x${qty}` : name;
            })
            .join(", ");
    }

    /**
     * Table name for one findings draw, before the d100 is rolled.
     * @param {object} params
     * @returns {string}
     */
    static findingsTableLabel(params = {}) {
        return getResolver().findingsTableLabel(params);
    }

    /**
     * What one findings d100 lands on. Same row the grant will use.
     * @param {object} params
     * @returns {Promise<{ tableLabel: string, outcome: string }>}
     */
    static async describeFindingsDraw(params = {}) {
        const described = await getResolver().describeFindingsDraw(params);
        const items = described?.items ?? [];
        return {
            tableLabel: described?.tableLabel ?? "",
            outcome: items.length ? GatherYieldService.describeItems(items) : "Nothing on this row"
        };
    }

    /**
     * Item chips for a gather result. Rations stand in when the table did not draw items.
     * @param {Array<{itemData?: {name?: string, img?: string}, itemRef?: string, quantity?: number}>} items
     * @param {{ rations?: number }} [options]
     * @returns {Array<{name: string, img: string, qty: number, qtyLabel: string}>}
     */
    static presentItems(items = [], { rations = 0 } = {}) {
        const rows = [];
        for (const entry of items) {
            const data = entry?.itemData ?? {};
            const ref = String(entry?.itemRef ?? "").trim();
            const known = KNOWN_PROVISIONS[ref];
            const name = readableProvisionName(entry);
            if (!name || name === "provisions") continue;
            const qty = entry?.quantity ?? 1;
            const rawImg = data.img && !String(data.img).includes("mystery-man") ? data.img : "";
            const img = rawImg || known?.img || "";
            rows.push({
                name,
                img,
                qty,
                qtyLabel: qty > 1 ? `x${qty}` : ""
            });
        }
        if (!rows.length && rations > 0) {
            rows.push({
                name: "Rations",
                img: "icons/consumables/food/bread-loaf-round-white.webp",
                qty: rations,
                qtyLabel: rations > 1 ? `x${rations}` : ""
            });
        }
        return rows;
    }
}
