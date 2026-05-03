import { ResourcePoolRoller } from "./ResourcePoolRoller.js";

/**
 * Gates travel forage and camp act_forage on drawable resource pools from imported packs.
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
     * True when a content-pack pool or compendium base pool can supply forage for this terrain.
     * @param {import("./TravelResolver.js").TravelResolver} travelResolver
     * @param {string} terrainTag
     */
    static isForageAvailable(travelResolver, terrainTag) {
        if (!travelResolver || !terrainTag) return false;
        const hasPackPool = ForageActivityValidator.hasValidPool(
            travelResolver.resourcePoolRoller,
            terrainTag
        );
        const hasBasePool = travelResolver.basePoolCoverage.includes(`${terrainTag}_forage`)
            || travelResolver.basePoolCoverage.includes("wilderness_forage");
        return hasPackPool || hasBasePool;
    }
}
