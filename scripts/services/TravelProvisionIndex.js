/**
 * Build merged travel provision index from module pack + world custom pack.
 */

import { buildFolderPathMap } from "./CompendiumFolderIndex.js";
import { ProvisionsCustomPack, PROVISIONS_CUSTOM_PACK_ID } from "./ProvisionsCustomPack.js";

const MODULE_ID = "ionrift-respite";
const MODULE_PACK_ID = "ionrift-respite.respite-items";

const INDEX_FIELDS = ["flags", "name", "img", "type", "system", "folder"];

/**
 * @param {object} entry
 * @returns {string}
 */
export function travelEntryItemRef(entry) {
    const rf = entry?.flags?.[MODULE_ID];
    return rf?.itemRef
        ?? String(entry?.name ?? "").toLowerCase().trim().replace(/\s+/g, "_");
}

/**
 * Load module + custom compendium indexes for travel pool resolution.
 * Custom entries override shipped entries with the same itemRef.
 * @returns {Promise<{ batches: Array<{ entries: Iterable<object>, folderPathMap: object, overrideRefs: boolean }>, totalEntries: number }>}
 */
export async function loadTravelProvisionBatches() {
    const batches = [];

    const modulePack = game.packs.get(MODULE_PACK_ID);
    if (modulePack) {
        const index = await modulePack.getIndex({ fields: INDEX_FIELDS });
        batches.push({
            entries: index,
            folderPathMap: buildFolderPathMap(modulePack.collection),
            overrideRefs: false
        });
    }

    let customPack = game.packs.get(PROVISIONS_CUSTOM_PACK_ID);
    if (game.user?.isGM && !customPack) {
        customPack = await ProvisionsCustomPack.ensurePack();
    }
    if (customPack) {
        const customIndex = await customPack.getIndex({ fields: INDEX_FIELDS });
        batches.push({
            entries: customIndex,
            folderPathMap: buildFolderPathMap(customPack.collection),
            overrideRefs: true
        });
    }

    let totalEntries = 0;
    for (const batch of batches) {
        totalEntries += [...batch.entries].length;
    }

    return { batches, totalEntries };
}

/**
 * Apply travel provision batches onto a TravelResolver (clears prior base pools).
 * @param {import("./TravelResolver.js").TravelResolver} resolver
 */
export async function applyTravelProvisionBatches(resolver) {
    if (!resolver) return { batches: [], totalEntries: 0 };

    const loaded = await loadTravelProvisionBatches();
    resolver.clearBasePools();
    for (const batch of loaded.batches) {
        resolver.loadBaseItems(batch.entries, batch.folderPathMap, { overrideRefs: batch.overrideRefs });
    }
    return loaded;
}
