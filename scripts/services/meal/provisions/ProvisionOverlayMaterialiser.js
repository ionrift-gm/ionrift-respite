/** Respite wiring for library OverlayItemMaterialiser (provisions + tables). */

import {
    registerProvisionPack,
    unregisterProvisionPack
} from "../../travel/resolve/TravelProvisionIndex.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { ItemArtSync } from "../../art/ItemArtSync.js";

/** Cooking overlay packDirs with fixed wrapper labels. */
const COOKING_SECTION_LABELS = Object.freeze({
    forage: "Forage",
    hunting: "Hunting",
    outputs: "Cooking Outputs"
});

function titleCase(value) {
    return String(value ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function isRespiteSublayerIncubating(manifest, sublayer) {
    if (manifest) {
        if (manifest.incubation === true) return true;
        if (manifest.releaseStatus === "incubating") return true;
        if (String(manifest.tier ?? "").toLowerCase() === "incubation") return true;
        if (String(manifest.classification ?? "").toLowerCase() === "incubation") return true;
    }
    if (String(sublayer ?? "").startsWith("incuba")) return true;
    return false;
}

function formatRespiteSublayerLabel(sublayer, manifest = null) {
    const baseTitle = manifest?.packLabel || titleCase(sublayer);
    if (!manifest) return `Respite: ${baseTitle}`;

    const version = manifest.version ?? "0.0.0";
    if (isRespiteSublayerIncubating(manifest, sublayer)) {
        return `Respite: ${baseTitle} [v${version} · Incubating]`;
    }
    const tier = manifest.tier ? ` ${manifest.tier}` : "";
    const preview = manifest.preview ? " Preview" : "";
    return `Respite: ${baseTitle} [v${version} · Public${tier}${preview}]`;
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
        labelForSublayer: (sublayer, manifest) => formatRespiteSublayerLabel(sublayer, manifest),
        sectionWrapperName: respiteSectionWrapperName,
        sidebarFolderResolver: async (_pack, context = {}) => {
            const { ContentPackCompiler } = await import("../../packs/registry/ContentPackCompiler.js");
            return ContentPackCompiler.ensureRespiteOverlayFolderId({
                incubating: Boolean(context.incubating)
            });
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
        await ItemArtSync.apply();
    }

    /**
     * React to a Library overlay enable/disable/uninstall for this module.
     * Item icon sync runs afterwards from the module.js overlay hook.
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
