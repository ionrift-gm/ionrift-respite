import { PackManifestSchema } from "../../../../../ionrift-library/scripts/data/PackManifestSchema.js";
import { TerrainRegistry } from "../resolve/TerrainRegistry.js";
import {
    detectLegacyTerrainBinding,
    LEGACY_SCHEMA_VERSION
} from "./EventPackCatalog.js";
import {
    validateEventPackData,
    validateEventPackFull,
    confirmEventPackImport,
    showEventPackImportFailure
} from "./EventPackValidation.js";
import { MODULE_ID } from "../../../data/moduleId.js";

/**
 * Writes an imported event pack into world settings and enables it.
 *
 * @param {object} data
 * @returns {Promise<{ packId: string, name: string, eventCount: number, eventIds: string[] }>}
 */
export async function persistImportedEventPack(data, importMeta = {}) {
    const packId = data.id;
    const isLegacy = importMeta.isLegacy === true;
    const schemaVersion = data.schemaVersion ?? (isLegacy ? LEGACY_SCHEMA_VERSION : "2");

    for (const evt of (data.events ?? [])) {
        if (!evt.pack) evt.pack = packId;
    }

    await TerrainRegistry.init();
    const legacyTerrainBinding = detectLegacyTerrainBinding({
        ...data,
        schemaVersion
    });

    const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};
    importedPacks[packId] = {
        name: data.name ?? packId,
        description: data.description ?? "",
        icon: data.icon ?? "fas fa-hiking",
        terrains: data.terrains ?? [],
        events: data.events,
        tables: data.tables ?? null,
        version: data.version ?? "1.0.0",
        schemaVersion,
        legacyTerrainBinding,
        importedAt: new Date().toISOString()
    };
    await game.settings.set(MODULE_ID, "importedPacks", importedPacks);

    const enabledPacks = game.settings.get(MODULE_ID, "enabledPacks") ?? {};
    enabledPacks[packId] = true;
    await game.settings.set(MODULE_ID, "enabledPacks", enabledPacks);

    TerrainRegistry.syncCustomTerrainsFromPacks();

    const eventIds = (data.events ?? []).map(evt => evt.id).filter(Boolean);

    return {
        packId,
        name: data.name ?? packId,
        eventCount: eventIds.length,
        eventIds
    };
}

/**
 * @param {object} data
 * @param {boolean} isLegacy
 * @param {object} manifest
 */
async function storeLibraryPackMetadata(data, isLegacy, manifest) {
    if (isLegacy) return;

    const installedPacks = game.settings.get("ionrift-library", "installedPacks") ?? {};
    installedPacks[manifest.packId] = {
        version: manifest.version,
        tier: manifest.tier,
        packType: manifest.packType,
        format: "json",
        installedAt: new Date().toISOString(),
        fileCount: 1
    };
    await game.settings.set("ionrift-library", "installedPacks", installedPacks);
}

/**
 * @returns {Promise<File|null>}
 */
function pickJsonFile() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.addEventListener("change", (event) => {
            resolve(event.target.files?.[0] ?? null);
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
    });
}

/**
 * Opens a file picker and imports a custom event pack JSON file.
 *
 * @returns {Promise<{ success: boolean, packId: string|null, eventIds: string[], eventCount: number, errors: string[], warnings: string[], info: string[] }|null>}
 */
export async function importEventPackFromFile() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can import packs.");
        return null;
    }

    if (!game.ionrift?.library?.importJsonPack) {
        ui.notifications.error("Ionrift Library v1.6.0+ is required for event pack imports.");
        return null;
    }

    const file = await pickJsonFile();
    if (!file) return null;

    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (error) {
        const msg = `Failed to parse JSON: ${error.message}`;
        ui.notifications.error(msg);
        return { success: false, packId: null, eventIds: [], eventCount: 0, errors: [msg], warnings: [], info: [] };
    }

    const extracted = PackManifestSchema.extractFromJson(data);
    if (!extracted.valid || !extracted.manifest) {
        const manifestErrors = extracted.errors.length
            ? extracted.errors
            : ["Missing or invalid _manifest object."];
        await showEventPackImportFailure({ valid: false, errors: manifestErrors, warnings: [], info: [], terrainTags: { core: [], custom: [] } });
        return { success: false, packId: null, eventIds: [], eventCount: 0, errors: manifestErrors, warnings: [], info: [] };
    }

    const validation = await validateEventPackFull(data);
    validation.packId = data.id;
    validation.eventCount = data.events?.length ?? 0;

    if (!validation.valid) {
        await showEventPackImportFailure(validation);
        return {
            success: false,
            packId: data.id ?? null,
            eventIds: [],
            eventCount: 0,
            errors: validation.errors,
            warnings: validation.warnings,
            info: validation.info
        };
    }

    const needsReview = validation.warnings.length > 0 || validation.info.length > 0;
    if (needsReview) {
        const confirmed = await confirmEventPackImport(validation);
        if (!confirmed) return null;
    }

    try {
        const imported = await persistImportedEventPack(data, { isLegacy: extracted.legacy === true });
        await storeLibraryPackMetadata(data, extracted.legacy === true, extracted.manifest);

        return {
            success: true,
            packId: imported.packId,
            eventIds: imported.eventIds,
            eventCount: imported.eventCount,
            errors: [],
            warnings: validation.warnings,
            info: validation.info,
            terrainTags: validation.terrainTags
        };
    } catch (error) {
        const msg = `Import failed: ${error.message}`;
        ui.notifications.error(msg);
        return {
            success: false,
            packId: data.id ?? null,
            eventIds: [],
            eventCount: 0,
            errors: [msg],
            warnings: validation.warnings,
            info: validation.info
        };
    }
}

export { validateEventPackData };
