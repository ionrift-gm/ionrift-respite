import { isHomebrewProvisionOnly, getTerrainGatherAvailability } from "../settings/TravelSettings.js";
import { ForageTableSync } from "./ForageTableSync.js";

/**
 * Gates travel forage and hunt on drawable compendium or pack data.
 */
export class ForageActivityValidator {

    /**
     * True when the effective primary forage pool (terrain-specific or wilderness fallback)
     * exists on the roller and has at least one weighted entry.
     * @param {ResourcePoolRoller} poolRoller
     * @param {string} terrainTag
     */
    static hasValidPool(poolRoller, terrainTag) {
        if (!poolRoller || !terrainTag) return false;
        const pool = poolRoller.getEffectiveForagePool(terrainTag);
        const entries = pool?.entries;
        return Array.isArray(entries) && entries.length > 0;
    }

    /**
     * True when a forage RollTable, content-pack pool, or compendium base pool can supply forage.
     * @param {import("../resolve/TravelResolver.js").TravelResolver} travelResolver
     * @param {string} terrainTag
     */
    static isForageAvailable(travelResolver, terrainTag) {
        if (!travelResolver || !terrainTag) return false;
        if (!getTerrainGatherAvailability(terrainTag).canForage) return false;
        if (ForageTableSync.tableHasDrawableResults(terrainTag)) return true;

        const hasPackPool = ForageActivityValidator.hasValidPool(
            travelResolver.resourcePoolRoller,
            terrainTag
        );
        const hasBasePool = travelResolver.basePoolCoverage.includes(`${terrainTag}_forage`)
            || travelResolver.basePoolCoverage.includes("wilderness_forage");
        return hasPackPool || hasBasePool;
    }

    /**
     * True when hunt can produce yields for this terrain.
     * Built/safe-haven terrains (e.g. dungeon, urban, tavern) never offer hunting.
     * @param {import("../resolve/TravelResolver.js").TravelResolver} travelResolver
     * @param {string} terrainTag
     */
    static isHuntAvailable(travelResolver, terrainTag) {
        if (!travelResolver || !terrainTag) return false;
        if (!getTerrainGatherAvailability(terrainTag).canHunt) return false;
        if (!isHomebrewProvisionOnly()) return true;

        const hasBasePool = travelResolver.basePoolCoverage.includes(`${terrainTag}_hunt`)
            || travelResolver.basePoolCoverage.includes("wilderness_hunt");
        return hasBasePool;
    }
}

