/**
 * Build merged travel provision index from module pack + world custom pack.
 */

import { buildFolderPathMap } from "./CompendiumFolderIndex.js";
import { ProvisionsCustomPack, PROVISIONS_CUSTOM_PACK_ID } from "./ProvisionsCustomPack.js";
import { isHomebrewProvisionOnly } from "./TravelSettings.js";

const MODULE_ID = "ionrift-respite";
const MODULE_PACK_ID = "ionrift-respite.respite-items";

const INDEX_FIELDS = ["flags", "name", "img", "type", "system", "folder"];

/**
 * Extra provision compendiums registered at runtime (e.g. world compendiums
 * materialised from active overlays by the library materialiser). These ride
 * the same forage/hunt pipeline as the shipped module pack, gated by the
 * homebrew-only toggle. Registration is idempotent.
 */
const extraProvisionPackIds = new Set();

/**
 * Register a compendium so its forage/hunt items feed the travel pipeline.
 * @param {string} packId
 */
export function registerProvisionPack(packId) {
    if (packId) extraProvisionPackIds.add(packId);
}

/**
 * Stop sourcing forage/hunt items from a previously registered compendium.
 * @param {string} packId
 */
export function unregisterProvisionPack(packId) {
    if (packId) extraProvisionPackIds.delete(packId);
}

/**
 * @returns {string[]} Currently registered extra provision pack ids.
 */
export function getRegisteredProvisionPackIds() {
    return [...extraProvisionPackIds];
}

/**
 * Document id from a compendium index row (Foundry may use id or _id).
 * @param {object} entry
 * @returns {string|null}
 */
export function compendiumIndexDocumentId(entry) {
    const raw = entry?._id ?? entry?.id;
    return raw ? String(raw) : null;
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 */
async function ensurePackUnlocked(pack) {
    if (!pack) return pack;
    if (pack.locked) await pack.configure({ locked: false });
    return pack;
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 * @param {string} docId
 * @returns {Promise<object|null>}
 */
async function getPackItemData(pack, docId) {
    if (!pack || !docId) return null;
    await ensurePackUnlocked(pack);
    try {
        const doc = await pack.getDocument(docId);
        return doc?.toObject() ?? null;
    } catch {
        return null;
    }
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 * @param {string} itemRef
 * @returns {Promise<object|null>}
 */
async function findPackItemDataByItemRef(pack, itemRef) {
    if (!pack || !itemRef) return null;
    await ensurePackUnlocked(pack);
    const index = await pack.getIndex({ fields: ["flags", "name"] });
    const rows = compendiumIndexToArray(index);
    const ref = String(itemRef).trim().toLowerCase();
    const byFlag = rows.find(row => row.flags?.[MODULE_ID]?.itemRef === itemRef);
    const flagId = compendiumIndexDocumentId(byFlag);
    if (flagId) {
        const data = await getPackItemData(pack, flagId);
        if (data) return data;
    }

    const normalizedName = ref.replace(/_/g, " ");
    const byName = rows.find(row => {
        const name = String(row.name ?? "").trim().toLowerCase();
        return name === ref || name === normalizedName;
    });
    const nameId = compendiumIndexDocumentId(byName);
    if (nameId) return await getPackItemData(pack, nameId);

    try {
        const docs = await pack.getDocuments();
        const doc = docs.find(row => {
            const flagRef = row.getFlag(MODULE_ID, "itemRef");
            if (flagRef === itemRef) return true;
            const name = String(row.name ?? "").trim().toLowerCase();
            return name === ref || name === normalizedName;
        });
        return doc?.toObject() ?? null;
    } catch {
        return null;
    }
}

/**
 * Normalize a compendium index to an array of entries.
 * @param {object|Array} index
 * @returns {object[]}
 */
export function compendiumIndexToArray(index) {
    if (!index) return [];
    if (Array.isArray(index)) return index;
    if (typeof index.values === "function") return Array.from(index.values());
    if (index.contents && Array.isArray(index.contents)) return index.contents;
    if (typeof index === "object") return Object.values(index);
    return [];
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").Item} doc
 * @returns {string|null}
 */
function documentFolderId(doc) {
    const folder = doc.folder;
    if (!folder) return null;
    if (typeof folder === "string") return folder;
    return folder.id ?? null;
}

/**
 * Build travel index rows from live compendium documents (reliable for GM-placed items).
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 * @returns {Promise<object[]>}
 */
export async function buildProvisionEntriesFromPack(pack) {
    if (!pack) return [];
    await ensurePackUnlocked(pack);
    const docs = await pack.getDocuments();
    return docs.map(doc => ({
        _id: doc.id,
        id: doc.id,
        name: doc.name,
        folder: documentFolderId(doc),
        flags: foundry.utils.deepClone(doc.flags ?? {})
    }));
}

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
 * @returns {Promise<{ batches: Array<{ entries: Iterable<object>, folderPathMap: object, overrideRefs: boolean, packId?: string }>, totalEntries: number }>}
 */
export async function loadTravelProvisionBatches() {
    const batches = [];
    const homebrewOnly = isHomebrewProvisionOnly();

    if (!homebrewOnly) {
        const shippedPackIds = [MODULE_PACK_ID, ...getRegisteredProvisionPackIds()];
        for (const packId of shippedPackIds) {
            const pack = game.packs.get(packId);
            if (!pack) continue;
            const index = await pack.getIndex({ fields: INDEX_FIELDS });
            batches.push({
                entries: compendiumIndexToArray(index),
                folderPathMap: buildFolderPathMap(pack),
                overrideRefs: false,
                packId
            });
        }
    }

    let customPack = game.packs.get(PROVISIONS_CUSTOM_PACK_ID);
    if (game.user?.isGM && !customPack) {
        customPack = await ProvisionsCustomPack.ensurePack();
    }
    if (customPack) {
        const folderPathMap = buildFolderPathMap(customPack);
        const entries = await buildProvisionEntriesFromPack(customPack);
        batches.push({
            entries,
            folderPathMap,
            overrideRefs: true,
            packId: PROVISIONS_CUSTOM_PACK_ID
        });
    }

    let totalEntries = 0;
    for (const batch of batches) {
        totalEntries += compendiumIndexToArray(batch.entries).length;
    }

    return { batches, totalEntries };
}

/**
 * Resolve a compendium pool entry to item data (custom pack first when packId set).
 * @param {{ _id?: string, id?: string, packId?: string, itemRef?: string }} entry
 * @returns {Promise<object|null>}
 */
export async function resolveProvisionPoolEntry(entry) {
    if (!entry) return null;

    const docId = compendiumIndexDocumentId(entry);
    const itemRef = entry.itemRef ?? null;
    if (!docId && !itemRef) return null;

    const homebrewOnly = isHomebrewProvisionOnly();
    const packIds = entry.packId
        ? [
            entry.packId,
            ...(homebrewOnly ? [] : [MODULE_PACK_ID]),
            PROVISIONS_CUSTOM_PACK_ID
        ]
        : homebrewOnly
            ? [PROVISIONS_CUSTOM_PACK_ID]
            : [PROVISIONS_CUSTOM_PACK_ID, MODULE_PACK_ID];

    for (const packId of packIds) {
        const pack = game.packs.get(packId);
        if (!pack) continue;

        if (docId) {
            const byId = await getPackItemData(pack, docId);
            if (byId) return byId;
        }

        if (itemRef) {
            const byRef = await findPackItemDataByItemRef(pack, itemRef);
            if (byRef) return byRef;
        }
    }

    if (itemRef) {
        const { ItemOutcomeHandler } = await import("./ItemOutcomeHandler.js");
        return await ItemOutcomeHandler._resolveItemRef({ itemRef });
    }
    return null;
}

/**
 * Default pool weight per dnd5e rarity. Higher weight = larger range = more common.
 * Rarer items get smaller ranges, so they sit at the scarce (and on a yield roll,
 * the "better") end of the distribution.
 */
const RARITY_WEIGHTS = {
    common: 10,
    uncommon: 5,
    rare: 3,
    veryrare: 2,
    legendary: 1
};

/**
 * Weight for a provision pool entry. GM override flag wins, else derived from rarity.
 * @param {object} itemData
 * @returns {number}
 */
export function provisionEntryWeight(itemData) {
    const flagWeight = itemData?.flags?.[MODULE_ID]?.poolWeight;
    if (typeof flagWeight === "number" && flagWeight > 0) return flagWeight;

    const rarity = String(itemData?.system?.rarity ?? "").toLowerCase().replace(/\s+/g, "");
    return RARITY_WEIGHTS[rarity] ?? 10;
}

/**
 * Rank for ordering yields low (common) to high (better). Higher = better/rarer.
 * @param {object} itemData
 * @returns {number}
 */
export function provisionQualityRank(itemData) {
    const rarity = String(itemData?.system?.rarity ?? "").toLowerCase().replace(/\s+/g, "");
    const order = ["", "common", "uncommon", "rare", "veryrare", "legendary"];
    const idx = order.indexOf(rarity);
    return idx < 0 ? 1 : idx;
}

/**
 * Merge compendium base pools into imported content-pack resource pools.
 * Travel forage rolls use ResourcePoolRoller first; base pools are only a fallback
 * unless compendium entries are injected here.
 * @param {import("./TravelResolver.js").TravelResolver} resolver
 */
export async function syncBasePoolsIntoResourcePools(resolver) {
    const roller = resolver?.resourcePoolRoller;
    if (!roller) return;

    for (const poolKey of resolver.basePoolCoverage) {
        if (!poolKey.endsWith("_forage")) continue;

        const terrain = poolKey.slice(0, -"_forage".length);
        const poolId = `resource_pool_${terrain}`;
        const baseEntries = resolver.getBasePoolEntries(poolKey);
        if (!baseEntries.length) continue;

        let pool = roller.pools.get(poolId);
        if (!pool) {
            pool = { id: poolId, entries: [] };
            roller.pools.set(poolId, pool);
        }
        if (!Array.isArray(pool.entries)) pool.entries = [];

        for (const entry of baseEntries) {
            pool.entries = pool.entries.filter(row => row.itemRef !== entry.itemRef);
            const itemData = await resolveProvisionPoolEntry(entry);
            if (!itemData) continue;
            pool.entries.push({
                itemRef: entry.itemRef,
                weight: provisionEntryWeight(itemData),
                quantity: entry.quantity ?? 1,
                itemData
            });
        }
    }
}

/**
 * Apply travel provision batches onto a TravelResolver (clears prior base pools).
 * @param {import("./TravelResolver.js").TravelResolver} resolver
 */
export async function applyTravelProvisionBatches(resolver) {
    if (!resolver) return { batches: [], totalEntries: 0 };

    const loaded = await loadTravelProvisionBatches();
    resolver.clearBasePools();
    if (isHomebrewProvisionOnly()) {
        resolver.resourcePoolRoller.pools.clear();
    }
    for (const batch of loaded.batches) {
        resolver.loadBaseItems(batch.entries, batch.folderPathMap, {
            overrideRefs: batch.overrideRefs,
            packId: batch.packId
        });
    }
    await syncBasePoolsIntoResourcePools(resolver);
    return loaded;
}
