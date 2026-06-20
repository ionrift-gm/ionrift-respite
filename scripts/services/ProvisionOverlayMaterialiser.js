/**
 * Respite adapter for the shared library OverlayItemMaterialiser.
 *
 * Turns overlay item payloads (ionrift-data/overlays/ionrift-respite/{sublayer}/
 * items/...) into world compendiums and registers them with the travel
 * provision pipeline, so an active overlay's forage/hunt items feed the
 * terrain RollTables. All the heavy lifting lives in the library service; this
 * file only supplies Respite's naming and consumer wiring.
 */

import {
    registerProvisionPack,
    unregisterProvisionPack
} from "./TravelProvisionIndex.js";

const MODULE_ID = "ionrift-respite";

function titleCase(value) {
    return String(value ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Register or withdraw materialised packs from the forage pipeline, then
 * schedule a debounced table resync. Shared by activate/deactivate/remove.
 * @param {string[]} collectionIds
 * @param {boolean} active
 */
async function applyForageSources(collectionIds, active) {
    for (const id of collectionIds) {
        if (active) registerProvisionPack(id);
        else unregisterProvisionPack(id);
    }
    try {
        const { ForageTableSync } = await import("./ForageTableSync.js");
        ForageTableSync.scheduleSync();
    } catch {
        /* sync unavailable; pipeline will pick up registration on next sync */
    }
}

function respiteMaterialiserConfig() {
    return {
        moduleId: MODULE_ID,
        compendiumPrefix: "respite",
        logLabel: "Respite",
        notifyLabel: "Respite",
        labelForSublayer: (sublayer) => `Respite: ${titleCase(sublayer)}`,
        sectionWrapperName: (packDir) => {
            if (packDir === "forage") return "Forage";
            if (packDir === "hunting") return "Hunting";
            return null;
        },
        sidebarFolderResolver: async () => {
            const { ContentPackCompiler } = await import("./ContentPackCompiler.js");
            return ContentPackCompiler.findRespiteCompendiumFolderId();
        },
        onActiveChange: (collectionIds, active) => applyForageSources(collectionIds, active),
        onRemove: (collectionIds) => applyForageSources(collectionIds, false)
    };
}

export class ProvisionOverlayMaterialiser {

    static config() {
        return respiteMaterialiserConfig();
    }

    /**
     * Materialise every installed, active overlay sublayer. Call from `ready`
     * before the travel provision index loads so registered packs are included.
     */
    static async materialiseAll() {
        const materialiser = game.ionrift?.library?.materialiser;
        if (!materialiser) return;
        await materialiser.materialiseAll(this.config());
    }

    /**
     * React to a Library overlay enable/disable/uninstall for this module.
     * @param {{ moduleId?: string, sublayer?: string, overlayId?: string, installed?: boolean, active?: boolean }} detail
     */
    static async onOverlayContentChanged(detail) {
        const materialiser = game.ionrift?.library?.materialiser;
        if (!materialiser || detail?.moduleId !== MODULE_ID) return;

        const config = this.config();
        if (detail.installed && detail.active) {
            await materialiser.materialiseSublayer(detail.sublayer, config);
        } else if (detail.installed && detail.overlayId) {
            await materialiser.setOverlayActive(detail.overlayId, false, config);
        } else if (!detail.installed && detail.overlayId) {
            await materialiser.removeForOverlay(detail.overlayId, config);
        }
    }
}
