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
     * Used for **travel** forage gating (requires drawable pool items).
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

    /**
     * True when camp forage should be available. Less strict than {@link isForageAvailable}:
     * checks content-pack pools first, then falls back to the shipped compendium base pool
     * index. A fresh install with no content pack can still forage if the compendium has
     * forage-category items for this terrain.
     * @param {import("./TravelResolver.js").TravelResolver} [travelResolver]
     * @param {string} terrainTag
     */
    static isCampForageAvailable(travelResolver, terrainTag) {
        if (!terrainTag) return false;

        // Content-pack pools are the richest data source — prefer them
        if (travelResolver) {
            if (ForageActivityValidator.hasValidPool(
                travelResolver.resourcePoolRoller, terrainTag
            )) return true;

            const coverage = travelResolver.basePoolCoverage ?? [];
            if (coverage.includes(`${terrainTag}_forage`)
                || coverage.includes("wilderness_forage")) return true;
        }

        // Fall back to the startup-loaded compendium index
        const idx = game.ionrift?.respite?.travelBasePoolIndex;
        if (idx) {
            for (const entry of idx) {
                const rf = entry.flags?.["ionrift-respite"];
                if (rf?.category !== "forage") continue;
                const terrains = rf.terrain === "any"
                    ? ["forest", "swamp", "desert", "mountain", "arctic", "wilderness"]
                    : String(rf.terrain).split(",").map(t => t.trim());
                if (terrains.includes(terrainTag) || terrains.includes("wilderness")) return true;
            }
        }

        return false;
    }
}
