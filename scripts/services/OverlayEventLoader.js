/**
 * OverlayEventLoader
 * Discovers and loads event data from Patreon Library overlay packs.
 *
 * Overlay packs (e.g. Frost & Stone) deliver terrain-specific event JSON
 * to `ionrift-data/overlays/ionrift-respite/{sublayer}/events/{packDir}/events.json`.
 * This service bridges the OverlayService API (ionrift-library) with Respite's
 * event consumers (EventBrowserApp, RestSetupApp, PackRegistryApp).
 *
 * Caches loaded data per session; invalidated on `ionrift.overlayContentChanged`.
 */
import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-respite";

/** @type {{ packId: string, sublayer: string, data: object }[] | null} */
let _cache = null;

export class OverlayEventLoader {

    /**
     * Loads all event data from active overlay packs.
     * Returns cached results after the first successful scan.
     * @returns {Promise<{ packId: string, sublayer: string, data: object }[]>}
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

                // Scan events/ subdirectory for pack folders
                const listing = await overlay.listOverlayDir(MODULE_ID, sublayer, "events");
                const packDirs = listing?.dirs ?? [];

                for (const packDir of packDirs) {
                    try {
                        const data = await overlay.readOverlayFile(
                            MODULE_ID, sublayer, `events/${packDir}/events.json`
                        );
                        if (data?.events?.length) {
                            results.push({
                                packId: data.id ?? `overlay_${sublayer}_${packDir}`,
                                sublayer,
                                data
                            });
                        }
                    } catch (e) {
                        console.warn(`${MODULE_ID} | OverlayEventLoader: Failed to read events/${packDir}/events.json in ${sublayer}:`, e);
                    }
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | OverlayEventLoader: Scan failed:`, e);
        }

        _cache = results;

        if (results.length > 0) {
            const totalEvents = results.reduce((s, r) => s + (r.data.events?.length ?? 0), 0);
            Logger.log(`${MODULE_ID} | OverlayEventLoader: Loaded ${totalEvents} events from ${results.length} overlay pack(s)`);
        }

        return results;
    }

    /**
     * Invalidates the cached overlay data.
     * Called when `ionrift.overlayContentChanged` fires for this module.
     */
    static invalidate() {
        _cache = null;
    }

    /**
     * Whether cached data is available (avoids re-scan).
     * @returns {boolean}
     */
    static get isCached() {
        return _cache !== null;
    }
}
