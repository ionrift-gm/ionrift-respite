/**
 * Sync the camp fuel RollTable from kindling compendium items.
 * Design: 5% of successful forages roll this table; when rolled, outcome is always kindling (d100 1-100).
 */

import { Logger } from "../lib/Logger.js";
import {
    scaleWeightsToTarget,
    sortForageEntries,
    ROLL_TABLE_GM_ONLY_OWNERSHIP
} from "./ForageTableSync.js";
import {
    compendiumIndexDocumentId,
    compendiumIndexToArray,
    loadTravelProvisionBatches,
    provisionEntryWeight,
    provisionQualityRank,
    resolveProvisionPoolEntry,
    travelEntryItemRef
} from "./TravelProvisionIndex.js";
import { PROVISIONS_CUSTOM_PACK_ID } from "./ProvisionsCustomPack.js";
import { getCampFuelFindPercent } from "./TravelSettings.js";

const MODULE_ID = "ionrift-respite";
const MODULE_PACK_ID = "ionrift-respite.respite-items";
const PARENT_FOLDER = "Ionrift";
const CHILD_FOLDER = "Respite";
const TABLE_NAME = "Respite: Camp Fuel";

function buildCampFuelTableDescription() {
    const pct = getCampFuelFindPercent();
    return (
        `Successful forage: ${pct}% chance to roll this table (Configure Travel & Activities).`
        + " When rolled, the result is always kindling (faces 1-100 on d100)."
        + ` Net: about ${pct}% kindling per successful forage when foraging is enabled.`
        + " Add kindling variants in the Camp Fuel compendium folder to split the 1-100 band."
    );
}
/** Kindling occupies the full d100 when the table is rolled. */
export const CAMP_FUEL_KINDLING_WEIGHT_D100 = 100;

const WATCHED_PACK_IDS = [PROVISIONS_CUSTOM_PACK_ID, MODULE_PACK_ID];
const CAMP_FUEL_D100_TARGET = 100;
const CAMP_FUEL_MAX_KINDLING_VARIANTS = 20;

const EMPTY_RESULT_TEXT = "—";

/**
 * @param {RollTable|null|undefined} table
 * @returns {number}
 */
function tableResultCount(table) {
    const results = table?.results;
    if (!results) return 0;
    if (typeof results.size === "number") return results.size;
    if (typeof results.length === "number") return results.length;
    return 0;
}

/**
 * True when a compendium row is kindling for the camp fuel table (not firewood).
 * @param {object} entry
 * @param {string} [folderPath]
 * @returns {boolean}
 */
export function isCampFuelKindlingEntry(entry, folderPath = "") {
    const rf = entry.flags?.[MODULE_ID];
    if (rf?.firewoodType === "firewood" || rf?.itemRef === "firewood") return false;
    if (rf?.firewoodType === "kindling" || rf?.itemRef === "kindling") return true;
    if (rf?.category === "camp_fuel") return true;

    const parts = String(folderPath).split("/").map(s => s.trim()).filter(Boolean);
    return parts.some(part => part.toLowerCase() === "camp fuel");
}

/**
 * @deprecated Use isCampFuelKindlingEntry. Kept for tests naming continuity.
 */
export function isCampFuelEntry(entry, folderPath = "") {
    return isCampFuelKindlingEntry(entry, folderPath);
}

/**
 * Shipped kindling default when compendiums have not loaded yet.
 * @returns {object[]}
 */
export function builtInCampFuelEntries() {
    return [
        {
            itemRef: "kindling",
            quantity: 1,
            packId: MODULE_PACK_ID,
            weight: 10,
            rank: 1,
            itemData: {
                name: "Kindling",
                type: "loot",
                img: "icons/commodities/wood/kindling-sticks-brown.webp",
                system: {
                    description: { value: "<p>Dry twigs and bark strips.</p>" },
                    rarity: "common"
                },
                flags: {
                    [MODULE_ID]: {
                        itemRef: "kindling",
                        category: "camp_fuel",
                        firewoodType: "kindling"
                    }
                }
            }
        }
    ];
}

/**
 * Plan d100 ranges: kindling rows fill 1-100 (no empty band; the 5% gate is the miss chance).
 * @param {object[]} kindlingEntries
 * @returns {Array<{ entry?: object, empty?: boolean, range: [number, number], weight: number }>}
 */
export function planCampFuelTableRows(kindlingEntries) {
    const source = kindlingEntries.length ? kindlingEntries : builtInCampFuelEntries();
    const capped = source.slice(0, CAMP_FUEL_MAX_KINDLING_VARIANTS);
    const scaled = sortForageEntries([...capped]);
    scaleWeightsToTarget(scaled, CAMP_FUEL_KINDLING_WEIGHT_D100);

    const rows = [];
    let cursor = 1;
    for (const entry of scaled) {
        const weight = entry.weight ?? 1;
        const end = cursor + weight - 1;
        rows.push({ entry, range: [cursor, end], weight });
        cursor = end + 1;
    }

    return rows;
}

/**
 * Module + custom compendiums. Kindling lives in the module pack's Camp Fuel folder.
 * @returns {Promise<object[]>}
 */
async function loadCampFuelSourceBatches() {
    const { batches } = await loadTravelProvisionBatches();
    return batches;
}

/**
 * @returns {Promise<object[]>}
 */
export async function collectCampFuelEntries() {
    const batches = await loadCampFuelSourceBatches();
    const byRef = new Map();

    for (const batch of batches) {
        const entries = compendiumIndexToArray(batch.entries);
        for (const entry of entries) {
            const folderPath = entry.folder && batch.folderPathMap?.pathFor
                ? batch.folderPathMap.pathFor(entry.folder)
                : "";

            if (!isCampFuelKindlingEntry(entry, folderPath)) continue;

            const itemRef = travelEntryItemRef(entry);
            const docId = compendiumIndexDocumentId(entry);
            const itemData = await resolveProvisionPoolEntry({
                _id: docId,
                itemRef,
                packId: batch.packId
            });
            if (!itemData) continue;

            byRef.set(itemRef, {
                itemRef,
                itemData,
                quantity: 1,
                packId: batch.packId,
                weight: provisionEntryWeight(itemData),
                rank: provisionQualityRank(itemData)
            });
        }
    }

    for (const def of builtInCampFuelEntries()) {
        if (!byRef.has(def.itemRef)) {
            byRef.set(def.itemRef, { ...def });
        }
    }

    return Array.from(byRef.values());
}

export class CampFuelTableSync {

    /**
     * @returns {RollTable|null}
     */
    static getTable() {
        const table = game.tables?.find(row =>
            row.flags?.[MODULE_ID]?.isCampFuelTable === true
        );
        return tableResultCount(table) > 0 ? table : table ?? null;
    }

    /**
     * @param {number} [draws]
     * @returns {Promise<Array<{ itemRef: string, quantity: number, itemData: object }>>}
     */
    static async drawCampFuelResults(draws = 1) {
        const table = CampFuelTableSync.getTable();
        if (tableResultCount(table) === 0 || draws <= 0) return [];

        const merged = [];
        for (let index = 0; index < draws; index++) {
            const draw = await table.draw({ rollMode: "gmroll", displayChat: false });
            for (const result of draw?.results ?? []) {
                if (result.getFlag(MODULE_ID, "isEmptyResult")) continue;

                const itemRef = result.getFlag(MODULE_ID, "itemRef") ?? String(result.text ?? "").trim();
                if (!itemRef || itemRef === EMPTY_RESULT_TEXT) continue;

                const quantity = result.getFlag(MODULE_ID, "quantity") ?? 1;
                const packId = result.getFlag(MODULE_ID, "packId");
                let itemData = result.getFlag(MODULE_ID, "itemData");
                if (!itemData) {
                    itemData = await resolveProvisionPoolEntry({ itemRef, packId });
                }
                if (!itemData) continue;

                const existing = merged.find(row => row.itemRef === itemRef);
                if (existing) existing.quantity += quantity;
                else merged.push({ itemRef, quantity, itemData });
            }
        }
        return merged;
    }

    /**
     * @param {{ notify?: boolean }} [options]
     */
    static async syncAll({ notify = false } = {}) {
        if (!game.user?.isGM) return { entryCount: 0 };

        const folder = await CampFuelTableSync._ensureRollTableFolder();
        const entries = await collectCampFuelEntries();
        const table = await CampFuelTableSync._ensureTable(folder.id);
        const result = await CampFuelTableSync._syncTable(table, entries);

        if (notify && result.entryCount > 0) {
            ui.notifications.info("Respite: Synced camp fuel roll table.");
        }
        if (result.entryCount === 0) {
            console.warn(`${MODULE_ID} | Camp fuel table sync produced no rows.`);
        }
        Logger.log(`Camp fuel table sync complete (${result.entryCount} kindling rows).`);
        return result;
    }

    /**
     * @param {RollTable} table
     * @param {object[]} entries
     */
    static async _syncTable(table, entries) {
        const isModuleManaged = (row) =>
            row.getFlag(MODULE_ID, "isCampFuelSynced") === true
            || row.getFlag(MODULE_ID, "isEmptyResult") === true
            || Boolean(row.getFlag(MODULE_ID, "itemRef"));

        const manualResults = table.results.filter(row => !isModuleManaged(row));
        if (manualResults.length) {
            Logger.log(`Camp fuel table: preserving ${manualResults.length} manual row(s).`);
        }

        const planned = planCampFuelTableRows(entries);

        const staleIds = table.results
            .filter(row => isModuleManaged(row))
            .map(row => row.id);
        if (staleIds.length) await table.deleteEmbeddedDocuments("TableResult", staleIds);

        if (table.formula !== "1d100") {
            await table.update({ formula: "1d100" });
        }

        const creates = planned.map(row => {
            if (row.empty) return CampFuelTableSync._buildEmptyResultData(row.range, row.weight);
            return CampFuelTableSync._buildResultData(row.entry, row.range, row.weight);
        });

        if (creates.length) await table.createEmbeddedDocuments("TableResult", creates);
        if (tableResultCount(table) > 0) await table.normalize();

        await table.update({
            formula: "1d100",
            description: buildCampFuelTableDescription(),
            ownership: { default: ROLL_TABLE_GM_ONLY_OWNERSHIP },
            displayRoll: true
        });

        const kindlingRows = planned.filter(row => !row.empty).length;
        return { truncated: 0, entryCount: kindlingRows };
    }

    /**
     * @param {object} entry
     * @param {[number, number]} range
     * @param {number} weight
     * @returns {object}
     */
    static _buildResultData(entry, range, weight) {
        const displayName = entry.itemData?.name ?? entry.itemRef;
        return {
            type: CONST.TABLE_RESULT_TYPES.TEXT,
            text: displayName,
            weight,
            range,
            flags: {
                [MODULE_ID]: {
                    itemRef: entry.itemRef,
                    isCampFuelSynced: true,
                    quantity: entry.quantity ?? 1,
                    packId: entry.packId ?? null
                }
            }
        };
    }

    /**
     * @param {[number, number]} range
     * @param {number} weight
     * @returns {object}
     */
    static _buildEmptyResultData(range, weight) {
        return {
            type: CONST.TABLE_RESULT_TYPES.TEXT,
            text: EMPTY_RESULT_TEXT,
            weight,
            range,
            flags: {
                [MODULE_ID]: {
                    isCampFuelSynced: true,
                    isEmptyResult: true
                }
            }
        };
    }

    /**
     * @returns {Promise<Folder>}
     */
    static async _ensureRollTableFolder() {
        let parent = game.folders.find(folder =>
            folder.name === PARENT_FOLDER && folder.type === "RollTable" && !folder.folder
        );
        if (!parent) {
            parent = await Folder.create({
                name: PARENT_FOLDER,
                type: "RollTable",
                parent: null
            });
        }

        const parentId = parent.id ?? parent._id;
        let child = game.folders.find(folder =>
            folder.name === CHILD_FOLDER
            && folder.type === "RollTable"
            && (folder.folder?.id === parentId || folder.folder === parentId)
        );
        if (!child) {
            child = await Folder.create({
                name: CHILD_FOLDER,
                type: "RollTable",
                folder: parentId
            });
        }
        return child;
    }

    /**
     * @param {string} folderId
     * @returns {Promise<RollTable>}
     */
    static async _ensureTable(folderId) {
        let table = game.tables.find(row => row.flags?.[MODULE_ID]?.isCampFuelTable === true);
        if (!table) {
            table = game.tables.find(row => row.name === TABLE_NAME);
        }
        if (!table) {
            table = await RollTable.create({
                name: TABLE_NAME,
                description: buildCampFuelTableDescription(),
                formula: "1d100",
                replacement: true,
                displayRoll: true,
                folder: folderId,
                ownership: { default: ROLL_TABLE_GM_ONLY_OWNERSHIP },
                flags: {
                    [MODULE_ID]: {
                        isCampFuelTable: true
                    }
                }
            });
            Logger.log(`Created camp fuel table: ${TABLE_NAME}`);
        } else if (table.folder !== folderId) {
            await table.update({ folder: folderId });
        }
        return table;
    }

    /**
     * Open the camp fuel table sheet for the current user.
     * @returns {Promise<boolean>}
     */
    static async openSheet() {
        const table = CampFuelTableSync.getTable();
        if (!table) {
            ui.notifications.warn("Respite: Camp fuel table is not ready yet.");
            return false;
        }
        await table.sheet.render({ force: true });
        return true;
    }
}

export { WATCHED_PACK_IDS as CAMP_FUEL_WATCHED_PACK_IDS };
