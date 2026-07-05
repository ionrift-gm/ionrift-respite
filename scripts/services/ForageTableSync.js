/**
 * Sync Respite forage RollTables from compendium folders (rarity-weighted).
 * Tables are the draw source for travel forage; compendium edits trigger a debounced rebuild.
 */

import { Logger } from "../lib/Logger.js";
import { resolvePoolFromFolderPath } from "./CompendiumFolderIndex.js";
import {
    compendiumIndexDocumentId,
    compendiumIndexToArray,
    getRegisteredProvisionPackIds,
    loadTravelProvisionBatches,
    provisionEntryWeight,
    provisionQualityRank,
    resolveProvisionPoolEntry,
    travelEntryItemRef
} from "./TravelProvisionIndex.js";
import { PROVISIONS_CUSTOM_PACK_ID } from "./ProvisionsCustomPack.js";
import { TerrainRegistry } from "./TerrainRegistry.js";

const MODULE_ID = "ionrift-respite";
const MODULE_PACK_ID = "ionrift-respite.respite-items";
const PARENT_FOLDER = "Ionrift";
const CHILD_FOLDER = "Respite";
const TABLE_PREFIX = "Respite: Forage";

/** Max synced rows per terrain table (Foundry dice + sheet usability). */
export const FORAGE_TABLE_MAX_ENTRIES = 100;

const WATCHED_PACK_IDS = [PROVISIONS_CUSTOM_PACK_ID, MODULE_PACK_ID];

/** Roll tables stay GM-only; players roll d100 in chat and the GM client maps the value. */
export const ROLL_TABLE_GM_ONLY_OWNERSHIP =
    (typeof CONST !== "undefined" && CONST.DOCUMENT_OWNERSHIP_LEVELS?.NONE) ?? 0;

/**
 * Ownership payload that hides roll tables from players and strips legacy per-user Observer grants.
 * @param {Record<string, number>} [existing]
 * @returns {Record<string, number|null>}
 */
export function buildGmOnlyRollTableOwnership(existing = {}) {
    const ownerLevel = (typeof CONST !== "undefined" && CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER) ?? 3;
    const ownership = { default: ROLL_TABLE_GM_ONLY_OWNERSHIP };

    for (const user of game.users ?? []) {
        if (user.isGM) ownership[user.id] = ownerLevel;
    }

    for (const [userId, level] of Object.entries(existing)) {
        if (userId === "default") continue;
        const user = game.users.get(userId);
        if (!user?.isGM && (level ?? 0) > ROLL_TABLE_GM_ONLY_OWNERSHIP) {
            ownership[`-${userId}`] = null;
        }
    }

    return ownership;
}

/**
 * @param {RollTable|null|undefined} table
 * @param {number} rollValue - d100 face (1-100)
 * @returns {TableResult|null}
 */
export function findTableResultForRoll(table, rollValue) {
    if (!table?.results?.length) return null;
    const value = Math.max(1, Math.min(100, Math.floor(Number(rollValue) || 0)));
    for (const result of table.results) {
        const range = result.range;
        if (!Array.isArray(range) || range.length < 2) continue;
        if (value >= range[0] && value <= range[1]) return result;
    }
    return null;
}

let syncTimer = null;
let syncInFlight = false;

/**
 * True when a terrain offers travel forage. Only the wilderness supercategory does;
 * built/safe-haven terrains (dungeon, urban, tavern) have no foraging concept.
 * Unregistered tags (e.g. drafted underdark) default to forageable so dormant
 * shipped data still builds a dormant table.
 * @param {string} terrainTag
 * @returns {boolean}
 */
export function isForageTerrain(terrainTag) {
    if (!terrainTag) return false;
    const registered = TerrainRegistry.get?.(terrainTag);
    if (!registered) return true;
    return TerrainRegistry.getCategory(terrainTag) === "wilderness";
}

/**
 * Count results on a RollTable, handling both Foundry's EmbeddedCollection (.size)
 * and plain-array shapes used in tests.
 * @param {RollTable|null|undefined} table
 * @returns {number}
 */
export function tableResultCount(table) {
    const results = table?.results;
    if (!results) return 0;
    if (typeof results.size === "number") return results.size;
    if (typeof results.length === "number") return results.length;
    return 0;
}

/**
 * Shared Ionrift > Respite roll-table folder bootstrap.
 * Creates the parent Ionrift and child Respite folders if absent,
 * and enforces GM-only ownership on both.
 * @returns {Promise<Folder>} The Respite child folder.
 */
export async function ensureRespiteRollTableFolder() {
    let parent = game.folders.find(folder =>
        folder.name === PARENT_FOLDER && folder.type === "RollTable" && !folder.folder
    );
    if (!parent) {
        parent = await Folder.create({
            name: PARENT_FOLDER,
            type: "RollTable",
            parent: null,
            ownership: buildGmOnlyRollTableOwnership()
        });
    } else {
        await parent.update({
            ownership: buildGmOnlyRollTableOwnership(parent.ownership ?? {})
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
            folder: parentId,
            ownership: buildGmOnlyRollTableOwnership()
        });
    } else {
        await child.update({
            ownership: buildGmOnlyRollTableOwnership(child.ownership ?? {})
        });
    }
    return child;
}

/**
 * Sort forage rows common-first so normalize assigns low numbers to common loot.
 * @param {object[]} entries
 * @returns {object[]}
 */
export function sortForageEntries(entries) {
    return [...entries].sort((left, right) => {
        const rankDelta = (left.rank ?? 0) - (right.rank ?? 0);
        if (rankDelta !== 0) return rankDelta;
        return String(left.itemRef).localeCompare(String(right.itemRef));
    });
}

/**
 * Cap entry count; drops common items first when over limit.
 * @param {object[]} entries
 * @param {number} [max]
 * @returns {{ entries: object[], truncated: number }}
 */
export function capForageEntries(entries, max = FORAGE_TABLE_MAX_ENTRIES) {
    if (!Array.isArray(entries) || entries.length <= max) {
        return { entries: entries ?? [], truncated: 0 };
    }
    const sorted = sortForageEntries(entries);
    const truncated = sorted.length - max;
    return { entries: sorted.slice(-max), truncated };
}

/**
 * Scale entry weights so they sum to a target (default 100 → a d100 table),
 * preserving relative proportions and giving every entry at least weight 1.
 * Uses largest-remainder distribution so the sum lands exactly on target.
 * @param {object[]} entries - mutated in place; each gets an integer `weight`
 * @param {number} [target]
 * @returns {object[]}
 */
export function scaleWeightsToTarget(entries, target = 100) {
    const count = entries.length;
    if (count === 0) return entries;

    const effectiveTarget = Math.max(target, count);
    const totalRaw = entries.reduce((sum, entry) => sum + (entry.weight ?? 1), 0) || count;
    const remaining = effectiveTarget - count;

    const shares = entries.map(entry => {
        const ideal = remaining * ((entry.weight ?? 1) / totalRaw);
        const base = Math.floor(ideal);
        return { entry, base, frac: ideal - base };
    });

    let leftover = remaining - shares.reduce((sum, share) => sum + share.base, 0);
    [...shares]
        .sort((left, right) => right.frac - left.frac)
        .forEach(share => {
            if (leftover > 0) {
                share.base += 1;
                leftover -= 1;
            }
        });

    for (const share of shares) share.entry.weight = 1 + share.base;
    return entries;
}

/**
 * Build compendium-driven forage rows grouped by terrain tag.
 * @returns {Promise<Record<string, object[]>>}
 */
export async function collectForageEntriesByTerrain() {
    const { batches } = await loadTravelProvisionBatches();
    const byTerrain = new Map();

    const put = (terrain, row) => {
        if (!terrain || terrain.endsWith("_rare")) return;
        if (!byTerrain.has(terrain)) byTerrain.set(terrain, new Map());
        byTerrain.get(terrain).set(row.itemRef, row);
    };

    for (const batch of batches) {
        const entries = compendiumIndexToArray(batch.entries);
        for (const entry of entries) {
            const rf = entry.flags?.[MODULE_ID];
            let category = null;
            let terrains = null;

            if (entry.folder && batch.folderPathMap?.pathFor) {
                const folderPath = batch.folderPathMap.pathFor(entry.folder);
                const fromFolder = resolvePoolFromFolderPath(folderPath);
                if (fromFolder) {
                    category = fromFolder.category;
                    terrains = fromFolder.terrains;
                }
            }

            if (!category && rf?.category) category = rf.category;
            if (!category || category !== "forage") continue;

            if (!terrains?.length) {
                if (!rf?.terrain) continue;
                terrains = rf.terrain === "any"
                    ? ["forest", "swamp", "desert", "mountain", "arctic", "wilderness"]
                    : String(rf.terrain).split(",").map(part => part.trim()).filter(Boolean);
            }

            const itemRef = travelEntryItemRef(entry);
            const docId = compendiumIndexDocumentId(entry);
            const itemData = await resolveProvisionPoolEntry({
                _id: docId,
                itemRef,
                packId: batch.packId
            });
            if (!itemData) continue;

            const row = {
                itemRef,
                itemData,
                quantity: 1,
                packId: batch.packId,
                weight: provisionEntryWeight(itemData),
                rank: provisionQualityRank(itemData)
            };

            for (const terrain of terrains) put(terrain, row);
        }
    }

    const out = {};
    for (const [terrain, map] of byTerrain) out[terrain] = Array.from(map.values());
    return out;
}

export class ForageTableSync {

    /**
     * Debounced compendium change handler (GM only).
     */
    static scheduleSync() {
        if (!game.user?.isGM) return;
        if (syncTimer) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            syncTimer = null;
            ForageTableSync.syncAll().catch(err => {
                console.error(`${MODULE_ID} | Forage table sync failed:`, err);
            });
        }, 750);
    }

    /**
     * Register hooks for watched compendium packs.
     */
    static registerHooks() {
        const onPackChange = (doc, _options, userId) => {
            if (userId !== game.user?.id) return;
            const packId = doc?.pack?.collection
                ?? doc?.collection?.metadata?.id
                ?? null;
            if (!packId) return;
            const watched = WATCHED_PACK_IDS.includes(packId)
                || getRegisteredProvisionPackIds().includes(packId);
            if (!watched) return;
            ForageTableSync.scheduleSync();
        };

        Hooks.on("createItem", onPackChange);
        Hooks.on("updateItem", onPackChange);
        Hooks.on("deleteItem", onPackChange);
    }

    /**
     * @param {string} terrainTag
     * @returns {RollTable|null}
     */
    static getTableForTerrain(terrainTag) {
        if (!terrainTag) return null;
        const table = game.tables?.find(row =>
            row.flags?.[MODULE_ID]?.isForageTable
            && row.flags?.[MODULE_ID]?.terrainTag === terrainTag
        );
        if (tableResultCount(table) > 0) return table;
        if (terrainTag !== "wilderness") return ForageTableSync.getTableForTerrain("wilderness");
        return table ?? null;
    }

    /**
     * @param {string} terrainTag
     * @returns {boolean}
     */
    static tableHasDrawableResults(terrainTag) {
        const table = ForageTableSync.getTableForTerrain(terrainTag);
        return tableResultCount(table) > 0;
    }

    /**
     * Draw forage loot from the terrain RollTable.
     * @param {string} terrainTag
     * @param {number} draws
     * @returns {Promise<Array<{ itemRef: string, quantity: number, itemData: object }>>}
     */
    static async drawForageResults(terrainTag, draws = 1) {
        const table = ForageTableSync.getTableForTerrain(terrainTag);
        if (tableResultCount(table) === 0 || draws <= 0) return [];

        const merged = [];
        for (let index = 0; index < draws; index++) {
            const draw = await table.draw({ rollMode: "gmroll", displayChat: false });
            for (const row of draw?.results ?? []) {
                const grant = await ForageTableSync._tableResultToGrant(row);
                if (!grant) continue;
                const existing = merged.find(entry => entry.itemRef === grant.itemRef);
                if (existing) existing.quantity += grant.quantity;
                else merged.push(grant);
            }
        }
        return merged;
    }

    /**
     * Resolve player d100 rolls against the terrain forage table (GM-only document).
     * @param {string} terrainTag
     * @param {number[]} rollValues - One face per draw (1-100).
     * @returns {Promise<Array<{ itemRef: string, quantity: number, itemData: object }>>}
     */
    static async resolveRollValues(terrainTag, rollValues = []) {
        const table = ForageTableSync.getTableForTerrain(terrainTag);
        if (tableResultCount(table) === 0 || !rollValues?.length) return [];

        const merged = [];
        for (const raw of rollValues) {
            const result = findTableResultForRoll(table, raw);
            if (!result) continue;
            const grant = await ForageTableSync._tableResultToGrant(result);
            if (!grant) continue;
            const existing = merged.find(entry => entry.itemRef === grant.itemRef);
            if (existing) existing.quantity += grant.quantity;
            else merged.push(grant);
        }
        return merged;
    }

    /**
     * @param {TableResult} result
     * @returns {Promise<{ itemRef: string, quantity: number, itemData: object }|null>}
     */
    static async _tableResultToGrant(result) {
        const itemRef = result.getFlag(MODULE_ID, "itemRef") ?? String(result.text ?? "").trim();
        if (!itemRef) return null;

        const quantity = result.getFlag(MODULE_ID, "quantity") ?? 1;
        const packId = result.getFlag(MODULE_ID, "packId");
        let itemData = result.getFlag(MODULE_ID, "itemData");
        if (!itemData) {
            itemData = await resolveProvisionPoolEntry({ itemRef, packId });
        }
        if (!itemData) return null;

        return { itemRef, quantity, itemData };
    }

    /**
     * Hide Respite roll tables and folders from non-GM clients.
     * Clears legacy per-user Observer grants from earlier builds.
     * @returns {Promise<{ tables: number, folders: number }>}
     */
    static async lockDownRollTableVisibility() {
        if (!game.user?.isGM) return { tables: 0, folders: 0 };

        let tables = 0;
        for (const table of game.tables) {
            if (!table.flags?.[MODULE_ID]?.isForageTable && !table.flags?.[MODULE_ID]?.isCampFuelTable) {
                continue;
            }
            await table.update({
                ownership: buildGmOnlyRollTableOwnership(table.ownership ?? {})
            });
            tables++;
        }

        let folders = 0;
        for (const folder of game.folders) {
            if (folder.type !== "RollTable") continue;
            const isRespiteRollFolder = folder.name === PARENT_FOLDER
                || folder.name === CHILD_FOLDER
                || (folder.folder && game.folders.get(folder.folder)?.name === PARENT_FOLDER);
            if (!isRespiteRollFolder) continue;
            await folder.update({
                ownership: buildGmOnlyRollTableOwnership(folder.ownership ?? {})
            });
            folders++;
        }

        return { tables, folders };
    }

    /**
     * Rebuild all terrain forage tables from compendium data.
     * @param {{ notify?: boolean }} [options]
     */
    static async syncAll({ notify = false } = {}) {
        if (!game.user?.isGM) return { terrains: 0, truncated: 0 };
        if (syncInFlight) {
            ForageTableSync.scheduleSync();
            return { terrains: 0, truncated: 0, skipped: true };
        }

        syncInFlight = true;
        try {
            await ForageTableSync.purgeLegacyRareTables();
            await ForageTableSync.purgeNonForageTerrainTables();
            const folder = await ForageTableSync._ensureFolder();
            const byTerrain = await collectForageEntriesByTerrain();
            const terrainTags = new Set([
                ...Object.keys(byTerrain),
                ...ForageTableSync._installedTerrainTags()
            ]);

            let totalTruncated = 0;
            let synced = 0;

            for (const terrainTag of terrainTags) {
                if (terrainTag.endsWith("_rare")) continue;
                if (!isForageTerrain(terrainTag)) continue;
                const entries = byTerrain[terrainTag] ?? [];
                const result = await ForageTableSync.syncTerrainTable(
                    terrainTag,
                    entries,
                    folder.id
                );
                if (result) {
                    synced++;
                    totalTruncated += result.truncated ?? 0;
                }
            }

            if (notify && synced > 0) {
                ui.notifications.info(`Respite: Synced ${synced} forage roll table(s).`);
            }
            if (totalTruncated > 0) {
                ui.notifications.warn(
                    `Respite: Some forage tables exceeded ${FORAGE_TABLE_MAX_ENTRIES} items.`
                    + ` Rarer entries were kept; common rows were omitted.`
                );
            }

            Logger.log(`Forage table sync complete (${synced} terrains).`);

            const { CampFuelTableSync } = await import("./CampFuelTableSync.js");
            await CampFuelTableSync.syncAll();
            await ForageTableSync.lockDownRollTableVisibility();

            return { terrains: synced, truncated: totalTruncated };
        } finally {
            syncInFlight = false;
        }
    }

    /**
     * Delete forage tables for terrains that no longer offer foraging
     * (e.g. legacy dungeon/urban tables from the old installer).
     */
    static async purgeNonForageTerrainTables() {
        const stale = game.tables.filter(table => {
            if (!table.flags?.[MODULE_ID]?.isForageTable) return false;
            const tag = table.flags[MODULE_ID].terrainTag ?? "";
            if (tag.endsWith("_rare")) return false;
            return !isForageTerrain(tag);
        });
        for (const table of stale) {
            await table.delete();
            Logger.log(`Removed forage table for non-forage terrain: ${table.name}`);
        }
    }

    /**
     * Delete legacy separate rare tables (merged into main tables).
     */
    static async purgeLegacyRareTables() {
        const legacy = game.tables.filter(table => {
            if (!table.flags?.[MODULE_ID]?.isForageTable) return false;
            const tag = table.flags[MODULE_ID].terrainTag ?? "";
            return tag.endsWith("_rare") || /_rare\)/i.test(table.name);
        });
        for (const table of legacy) {
            await table.delete();
            Logger.log(`Removed legacy forage table: ${table.name}`);
        }
    }

    /**
     * @param {string} terrainTag
     * @param {object[]} entries
     * @param {string} folderId
     * @returns {Promise<{ truncated: number, entryCount: number }|null>}
     */
    static async syncTerrainTable(terrainTag, entries, folderId) {
        const table = await ForageTableSync._ensureTable(terrainTag, folderId);
        if (!table) return null;

        // Module-managed rows are anything the sync owns now (isForageSynced) plus
        // legacy installer rows (carry an itemRef flag but predate the synced flag).
        // Genuine hand-authored GM rows have no module itemRef flag and are preserved.
        const isModuleManaged = (row) =>
            row.getFlag(MODULE_ID, "isForageSynced") === true
            || Boolean(row.getFlag(MODULE_ID, "itemRef"));

        const manualResults = table.results.filter(row => !isModuleManaged(row));
        const manualWeight = manualResults.reduce((sum, row) => sum + (row.weight ?? 1), 0);
        const maxSynced = Math.max(0, FORAGE_TABLE_MAX_ENTRIES - manualResults.length);
        const { entries: capped, truncated } = capForageEntries(entries, maxSynced);
        const sorted = sortForageEntries(capped);

        // Weight is item-driven (rarity / poolWeight flag), scaled so the table
        // totals 100 for percentile ranges. Manual rows keep their own weight.
        const target = Math.max(sorted.length, 100 - manualWeight);
        scaleWeightsToTarget(sorted, target);

        const staleIds = table.results
            .filter(row => isModuleManaged(row))
            .map(row => row.id);
        if (staleIds.length) await table.deleteEmbeddedDocuments("TableResult", staleIds);

        // TableResult requires a valid two-element range at create time, before
        // normalize() recomputes them. Seed contiguous ranges from the weights.
        let cursor = 1;
        const creates = sorted.map(entry => {
            const weight = entry.weight ?? provisionEntryWeight(entry.itemData);
            const start = cursor;
            const end = cursor + Math.max(1, weight) - 1;
            cursor = end + 1;
            return ForageTableSync._buildResultData(entry, [start, end]);
        });

        if (creates.length) await table.createEmbeddedDocuments("TableResult", creates);
        // normalize() divides by total weight; skip on an empty table to avoid 1d0.
        if (tableResultCount(table) > 0) await table.normalize();

        await table.update({
            ownership: buildGmOnlyRollTableOwnership(table.ownership ?? {}),
            displayRoll: true
        });

        return { truncated, entryCount: sorted.length };
    }

    /**
     * @param {object} entry
     * @param {[number, number]} range - contiguous seed range (normalize recomputes)
     * @returns {object}
     */
    static _buildResultData(entry, range = [1, 1]) {
        return {
            type: CONST.TABLE_RESULT_TYPES.TEXT,
            text: entry.itemRef,
            weight: entry.weight ?? provisionEntryWeight(entry.itemData),
            range,
            flags: {
                [MODULE_ID]: {
                    itemRef: entry.itemRef,
                    isForageSynced: true,
                    quantity: entry.quantity ?? 1,
                    packId: entry.packId ?? null
                }
            }
        };
    }

    /**
     * @returns {string[]}
     */
    static _installedTerrainTags() {
        return game.tables
            .filter(table => table.flags?.[MODULE_ID]?.isForageTable)
            .map(table => table.flags[MODULE_ID].terrainTag)
            .filter(tag => tag && !String(tag).endsWith("_rare"));
    }

    static _tableName(terrainTag) {
        const label = terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1);
        return `${TABLE_PREFIX} (${label})`;
    }

    /** @returns {Promise<Folder>} */
    static async _ensureFolder() {
        return ensureRespiteRollTableFolder();
    }

    /**
     * @param {string} terrainTag
     * @param {string} folderId
     * @returns {Promise<RollTable>}
     */
    static async _ensureTable(terrainTag, folderId) {
        const tableName = ForageTableSync._tableName(terrainTag);
        let table = game.tables.find(row => row.name === tableName);
        if (!table) {
            table = game.tables.find(row =>
                row.flags?.[MODULE_ID]?.isForageTable
                && row.flags?.[MODULE_ID]?.terrainTag === terrainTag
            );
        }
        if (!table) {
            table = await RollTable.create({
                name: tableName,
                description: `Forage results for ${terrainTag} terrain. Edit rows here or add items to Forage compendium folders.`,
                formula: "1d1",
                replacement: true,
                displayRoll: true,
                folder: folderId,
                ownership: buildGmOnlyRollTableOwnership(),
                flags: {
                    [MODULE_ID]: {
                        terrainTag,
                        isForageTable: true
                    }
                }
            });
            Logger.log(`Created forage table: ${tableName}`);
        } else {
            await table.update({
                ownership: buildGmOnlyRollTableOwnership(table.ownership ?? {})
            });
        }
        return table;
    }
}
