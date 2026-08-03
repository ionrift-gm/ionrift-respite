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
} from "../../travel/resolve/TravelProvisionIndex.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import {
    COOKING_OVERLAY_ID,
    COOKING_ART_OVERLAY_ID,
    COOKING_ART_SUBLAYER,
    CookingArtPreference
} from "./CookingArtPreference.js";
import {
    CRAFT_PROFESSIONS_OVERLAY_ID,
    CRAFT_PROFESSIONS_ART_OVERLAY_ID,
    CRAFT_PROFESSIONS_ART_SUBLAYER,
    CraftProfessionsArtPreference
} from "./CraftProfessionsArtPreference.js";

/** Cooking overlay packDirs with fixed wrapper labels. */
const COOKING_SECTION_LABELS = Object.freeze({
    forage: "Forage",
    hunting: "Hunting",
    outputs: "Cooking Outputs"
});

function titleCase(value) {
    return String(value ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Top-level folder label for an items/ packDir inside a materialised overlay.
 * Cooking keeps fixed labels. Other packDirs (e.g. brewing under craft-professions)
 * become profession roots so the sidebar nests Standard/Ambitious underneath.
 *
 * @param {string} packDir
 * @returns {string|null}
 */
export function respiteSectionWrapperName(packDir) {
    if (!packDir) return null;
    if (Object.prototype.hasOwnProperty.call(COOKING_SECTION_LABELS, packDir)) {
        return COOKING_SECTION_LABELS[packDir];
    }
    return titleCase(packDir);
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
        const { ForageTableSync } = await import("../../travel/forage/ForageTableSync.js");
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
        sectionWrapperName: respiteSectionWrapperName,
        sidebarFolderResolver: async () => {
            const { ContentPackCompiler } = await import("../../packs/registry/ContentPackCompiler.js");
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
        await CookingArtPreference.ensureAvailable();
        await CraftProfessionsArtPreference.ensureAvailable();
        await materialiser.materialiseAll(this.config());
        const cookingImages = await CookingArtPreference.synchronizeCompendium();
        await CookingArtPreference.synchronizeActorItems(cookingImages);
        const craftImages = await CraftProfessionsArtPreference.synchronizeCompendium();
        await CraftProfessionsArtPreference.synchronizeActorItems(craftImages);
    }

    /**
     * React to a Library overlay enable/disable/uninstall for this module.
     * @param {{ moduleId?: string, sublayer?: string, overlayId?: string, installed?: boolean, active?: boolean }} detail
     */
    static async onOverlayContentChanged(detail) {
        const materialiser = game.ionrift?.library?.materialiser;
        if (!materialiser || detail?.moduleId !== MODULE_ID) return;

        if (
            detail.overlayId === COOKING_ART_OVERLAY_ID
            || detail.sublayer === COOKING_ART_SUBLAYER
            || detail.overlayId === COOKING_OVERLAY_ID
        ) {
            await CookingArtPreference.ensureAvailable();
            if (detail.overlayId === COOKING_ART_OVERLAY_ID
                || detail.sublayer === COOKING_ART_SUBLAYER) {
                return;
            }
        }

        if (
            detail.overlayId === CRAFT_PROFESSIONS_ART_OVERLAY_ID
            || detail.sublayer === CRAFT_PROFESSIONS_ART_SUBLAYER
            || detail.overlayId === CRAFT_PROFESSIONS_OVERLAY_ID
        ) {
            await CraftProfessionsArtPreference.ensureAvailable();
            if (detail.overlayId === CRAFT_PROFESSIONS_ART_OVERLAY_ID
                || detail.sublayer === CRAFT_PROFESSIONS_ART_SUBLAYER) {
                const images = await CraftProfessionsArtPreference.synchronizeCompendium();
                await CraftProfessionsArtPreference.synchronizeActorItems(images);
                return;
            }
        }

        const config = this.config();
        if (detail.installed && detail.active) {
            await materialiser.materialiseSublayer(detail.sublayer, config);
            if (detail.sublayer === "cooking") {
                const images = await CookingArtPreference.synchronizeCompendium();
                await CookingArtPreference.synchronizeActorItems(images);
            }
            if (detail.sublayer === "craft-professions") {
                const images = await CraftProfessionsArtPreference.synchronizeCompendium();
                await CraftProfessionsArtPreference.synchronizeActorItems(images);
            }
        } else if (detail.installed && detail.overlayId) {
            await materialiser.setOverlayActive(detail.overlayId, false, config);
        } else if (!detail.installed && detail.overlayId) {
            await materialiser.removeForOverlay(detail.overlayId, config);
        }
    }
}
