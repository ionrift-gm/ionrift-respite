import { MODULE_ID } from "../data/moduleId.js";
import { ArtOverlayCatalog } from "../services/art/ArtOverlayCatalog.js";

/**
 * Resolves Respite banner and station token art.
 * Discovery lives in ArtOverlayCatalog; this class only turns the merged
 * catalog into paths, with Foundry core fallbacks when no art is installed.
 */

const FALLBACK_BANNER = `modules/${MODULE_ID}/assets/placeholder-banner.webp`;

/**
 * Station token filename map.
 * Keys match CompoundCampPlacer FURNITURE / PLAYER_GEAR keys.
 * Values are the image filename inside an installed tokens folder.
 */
const STATION_TOKEN_FILES = {
    table:       "workbench.webp",
    weaponRack:  "weapon_rack.webp",
    medicalBed:  "medical_bed.webp",
    cookingArea: "cooking_utensils.webp",
    cookingBasic:"cooking_basic.webp",
    bedroll:     "bedroll.webp",
    sharedBedroll: "bedroll.webp",
    tent:        "tent.webp",
    messkit:     "messkit.webp",
    campfire:    "campfire_pit.webp",
    buildSite:   "build_site.webp"
};

/** Foundry core SVG fallbacks (used when no art is installed). */
const STATION_CORE_FALLBACKS = {
    table:       "icons/svg/chest.svg",
    weaponRack:  "icons/svg/sword.svg",
    medicalBed:  "icons/svg/heal.svg",
    cookingArea: "icons/svg/fire.svg",
    cookingBasic:"icons/svg/fire.svg",
    bedroll:     "icons/svg/sleep.svg",
    sharedBedroll: "icons/svg/sleep.svg",
    tent:        "icons/svg/house.svg",
    messkit:     "icons/svg/tankard.svg",
    campfire:    "icons/svg/fire.svg",
    buildSite:   "icons/svg/circle.svg"
};

export class ImageResolver {

    /**
     * Call once during the ready hook, and again whenever installed
     * overlays change. GM scans disk; players read the GM's cache.
     */
    static async init() {
        await ArtOverlayCatalog.refresh();
    }

    /**
     * Resolve a terrain banner path, or the universal fallback when no
     * installed art covers that terrain.
     */
    static terrainBanner(terrain, filename) {
        const root = ArtOverlayCatalog.current.terrainRootsByTag[terrain];
        if (root) return `${root}/${terrain}/${filename}`;
        return FALLBACK_BANNER;
    }

    /**
     * Resolve a camp station token path.
     *
     * Installed art has this token: returns its path.
     * Otherwise: returns the Foundry core SVG fallback.
     *
     * For the cooking station, pass `hasCookingUtensils` to select the
     * correct variant (full utensils vs basic cooking area).
     *
     * @param {string} stationKey - FURNITURE/PLAYER_GEAR key (e.g. "table", "weaponRack")
     * @param {{ hasCookingUtensils?: boolean }} [options]
     * @returns {string} Resolved image path
     */
    static resolveStationToken(stationKey, options = {}) {
        let resolvedKey = stationKey;
        if (stationKey === "cookingArea") {
            resolvedKey = options.hasCookingUtensils ? "cookingArea" : "cookingBasic";
        }

        const fallback = STATION_CORE_FALLBACKS[resolvedKey]
            ?? STATION_CORE_FALLBACKS[stationKey]
            ?? "icons/svg/circle.svg";

        const filename = STATION_TOKEN_FILES[resolvedKey];
        if (!filename) return fallback;

        return ArtOverlayCatalog.current.tokenPaths[filename] ?? fallback;
    }

    /**
     * Resolve unified rest banner presentation data for templates.
     * @param {string} [terrainTag="forest"]
     * @param {string} [phase="camp"]
     * @returns {{
     *   terrainBanner: string,
     *   terrainBannerFallback: string,
     *   terrainBannerPos: string,
     *   hideTerrainBanner: boolean,
     *   banner: string,
     *   bannerFallback: string
     * }}
     */
    static resolveRestBannerContext(terrainTag = "forest", phase = "camp") {
        const t = terrainTag || "forest";
        let filename;
        if (phase === "rope_trick") {
            filename = "rope_trick.png";
        } else if (phase === "resolve" || phase === "dawn" || phase === "resolution") {
            filename = "resolve.png";
        } else if (phase === "events" || phase === "night" || phase === "reflection" || phase === "bivouac") {
            filename = "events.png";
        } else if (phase === "setup") {
            filename = "setup.png";
        } else {
            filename = "banner.png";
        }

        const terrainBanner = this.terrainBanner(t, filename);
        const terrainBannerFallback = filename !== "banner.png"
            ? this.terrainBanner(t, "banner.png")
            : this.fallbackBanner;
        let hideTerrainBanner = false;
        try {
            hideTerrainBanner = !!game.settings?.get(MODULE_ID, "hideTerrainBanners");
        } catch {
            hideTerrainBanner = false;
        }

        return {
            terrainBanner,
            terrainBannerFallback,
            terrainBannerPos: "center",
            hideTerrainBanner,
            banner: terrainBanner,
            bannerFallback: terrainBannerFallback
        };
    }

    /**
     * Saturation class for the terrain banner.
     * Cold and unlit sit at the floor, embers sit between, and campfire
     * and bonfire share the ceiling.
     * @param {string|null|undefined} fireLevel
     * @returns {"is-fire-cold"|"is-fire-embers"|"is-fire-lit"}
     */
    static bannerFireClass(fireLevel) {
        if (fireLevel === "embers") return "is-fire-embers";
        if (fireLevel === "campfire" || fireLevel === "bonfire") return "is-fire-lit";
        return "is-fire-cold";
    }

    /** Universal fallback banner path. */
    static get fallbackBanner() {
        return FALLBACK_BANNER;
    }

    /** Whether any installed art was found. */
    static get hasArtPack() {
        return ArtOverlayCatalog.current.active;
    }

    /** Whether installed art provides station tokens. */
    static get hasStationTokens() {
        return Object.keys(ArtOverlayCatalog.current.tokenPaths).length > 0;
    }

    /** Terrain tags covered by installed art. */
    static get artTerrains() {
        return Object.keys(ArtOverlayCatalog.current.terrainRootsByTag).sort();
    }
}
