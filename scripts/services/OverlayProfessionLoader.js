/**
 * OverlayProfessionLoader
 * Discovers and loads profession recipe data from Patreon Library overlay packs.
 *
 * Profession overlays deliver recipe JSON to
 * `ionrift-data/overlays/ionrift-respite/{sublayer}/professions/recipes.json`,
 * shaped as `{ id, name, recipes: { <professionId>: [recipe, ...] } }`.
 * This is the recipe-side counterpart to OverlayEventLoader: it bridges the
 * OverlayService API (ionrift-library) with Respite's crafting engine.
 *
 * Only installed overlays that are active for the world are read. Results are
 * cached per session and invalidated on `ionrift.overlayContentChanged`.
 */
import { Logger } from "../lib/Logger.js";
import { PROFESSION_TOOL_REQUIRED } from "./RecipeCatalog.js";

const MODULE_ID = "ionrift-respite";

/** @type {{ packId: string, sublayer: string, name: string, recipes: Object }[] | null} */
let _cache = null;

export class OverlayProfessionLoader {

    /**
     * Loads profession recipe data from all active overlay packs.
     * @returns {Promise<{ packId: string, sublayer: string, name: string, recipes: Object }[]>}
     */
    static async loadAll() {
        if (_cache) return _cache;

        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) return [];

        const results = [];

        try {
            const sublayers = await overlay.listInstalledSublayers(MODULE_ID);

            for (const sublayer of sublayers) {
                const manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
                if (!manifest?.overlayId) continue;

                const active = await overlay.isOverlayActive(
                    manifest.overlayId, MODULE_ID, sublayer
                );
                if (!active) continue;

                let data;
                try {
                    data = await overlay.readOverlayFile(
                        MODULE_ID, sublayer, "professions/recipes.json"
                    );
                } catch (e) {
                    console.warn(`${MODULE_ID} | OverlayProfessionLoader: Failed to read professions/recipes.json in ${sublayer}:`, e);
                    continue;
                }

                if (data?.recipes && typeof data.recipes === "object") {
                    results.push({
                        packId: data.id ?? manifest.overlayId,
                        sublayer,
                        name: data.name ?? manifest.overlayId,
                        recipes: data.recipes
                    });
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | OverlayProfessionLoader: Scan failed:`, e);
        }

        _cache = results;

        if (results.length > 0) {
            const totalRecipes = results.reduce((sum, r) =>
                sum + Object.values(r.recipes).reduce((s, list) => s + (Array.isArray(list) ? list.length : 0), 0), 0);
            Logger.log(`${MODULE_ID} | OverlayProfessionLoader: Loaded ${totalRecipes} recipes from ${results.length} overlay pack(s)`);
        }

        return results;
    }

    /**
     * True when any active overlay supplies recipes. Cheap presence check used to
     * decide whether the built-in stub fallback should apply.
     * @returns {Promise<boolean>}
     */
    static async hasRecipes() {
        const loaded = await this.loadAll();
        return loaded.some(r =>
            Object.values(r.recipes).some(list => Array.isArray(list) && list.length)
        );
    }

    /**
     * Professions covered by any active overlay that loaded recipes this session.
     * @returns {Promise<Set<string>>}
     */
    static async activeRecipeProfessions() {
        const loaded = await this.loadAll();
        const professions = new Set();
        for (const pack of loaded) {
            const recipes = pack.recipes ?? {};
            if (Array.isArray(recipes)) continue;
            for (const [profId, list] of Object.entries(recipes)) {
                if (!Array.isArray(list) || !list.length) continue;
                if (!Object.prototype.hasOwnProperty.call(PROFESSION_TOOL_REQUIRED, profId)) continue;
                professions.add(profId);
            }
        }
        return professions;
    }

    /**
     * Professions present in any installed overlay manifest on disk, regardless
     * of whether the overlay is active. Prefer {@link activeRecipeProfessions}
     * when deciding whether stub fallback should apply.
     * @returns {Promise<Set<string>>}
     */
    static async installedRecipeProfessions() {
        const overlay = game.ionrift?.library?.overlay;
        const professions = new Set();
        if (!overlay) return professions;
        try {
            const sublayers = await overlay.listInstalledSublayers(MODULE_ID);
            for (const sublayer of sublayers) {
                const manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
                if (!manifest?.overlayId) continue;
                const data = await overlay.readOverlayFile(MODULE_ID, sublayer, "professions/recipes.json");
                if (data?.recipes && typeof data.recipes === "object") {
                    for (const [profId, list] of Object.entries(data.recipes)) {
                        if (Array.isArray(list) && list.length) professions.add(profId);
                    }
                }
            }
        } catch {
            // best effort; treat as none installed
        }
        return professions;
    }

    /** Invalidates the cached overlay data. Called on `ionrift.overlayContentChanged`. */
    static invalidate() {
        _cache = null;
    }

    /**
     * Merged hunt yield tables from all active overlay sublayers that ship
     * `hunt_yields.json`. Later sublayers override the same terrain key.
     * @returns {Promise<Object|null>}
     */
    static async loadHuntYields() {
        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) return null;

        const merged = {};
        try {
            const sublayers = await overlay.listInstalledSublayers(MODULE_ID);
            for (const sublayer of sublayers) {
                const manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
                if (!manifest?.overlayId) continue;

                const active = await overlay.isOverlayActive(
                    manifest.overlayId, MODULE_ID, sublayer
                );
                if (!active) continue;

                try {
                    const data = await overlay.readOverlayFile(
                        MODULE_ID, sublayer, "hunt_yields.json"
                    );
                    if (data && typeof data === "object" && !Array.isArray(data)) {
                        Object.assign(merged, data);
                    }
                } catch {
                    // hunt_yields.json is optional per overlay
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | OverlayProfessionLoader: hunt yield scan failed:`, e);
        }

        return Object.keys(merged).length ? merged : null;
    }

    /** @returns {boolean} */
    static get isCached() {
        return _cache !== null;
    }
}
