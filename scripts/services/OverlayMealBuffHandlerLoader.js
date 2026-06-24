/**
 * OverlayMealBuffHandlerLoader
 *
 * Dynamically loads meal buff handler plugins from ionrift-data overlay
 * sublayers at world-ready time (GM only). Hot-swaps on overlay changes.
 */

import { Logger } from "../lib/Logger.js";
import {
    getMealBuffHandler,
    registerMealBuffHandler,
    unregisterMealBuffHandlersForOverlay
} from "./MealBuffHandlerRegistry.js";

const MODULE_ID = "ionrift-respite";
const HANDLER_PATH_RE = /^plugins\/meal-buffs\/handlers\/([^/]+)\.mjs$/;
const REQUIRED_KEYS = ["id", "label", "resolve"];

export class OverlayMealBuffHandlerLoader {

    /**
     * Entry point. Called from the ready hook (GM only).
     */
    static async loadAll() {
        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) {
            Logger.info("Meal buff handler loader: overlay API unavailable.");
            return;
        }

        const sublayers = await overlay.listInstalledSublayers(MODULE_ID);
        if (!sublayers?.length) return;

        Logger.info(`Meal buff handler loader: scanning ${sublayers.length} sublayer(s).`);
        for (const sublayer of sublayers) {
            await OverlayMealBuffHandlerLoader._loadSublayer(sublayer);
        }

        OverlayMealBuffHandlerLoader._registerChangeHook();
    }

    /**
     * @param {string} sublayer
     * @private
     */
    static async _loadSublayer(sublayer) {
        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) return;

        let manifest;
        try {
            manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
        } catch (err) {
            Logger.warn(`Meal buff handler loader: manifest read failed for "${sublayer}".`, err);
            return;
        }
        if (!manifest?.overlayId) return;

        const active = await overlay.isOverlayActive(manifest.overlayId, MODULE_ID, sublayer);
        if (!active) return;

        unregisterMealBuffHandlersForOverlay(manifest.overlayId);

        const handlerNames = await OverlayMealBuffHandlerLoader._discoverHandlerNames(overlay, sublayer);
        if (!handlerNames.length) return;

        let registered = 0;
        for (const handlerName of handlerNames) {
            const importPath = `/ionrift-data/overlays/${MODULE_ID}/${sublayer}/plugins/meal-buffs/handlers/${handlerName}.mjs`;
            try {
                const mod = await import(importPath);
                const handler = mod.default ?? mod.handler ?? mod;

                const missing = REQUIRED_KEYS.filter(key => {
                    if (key === "id" || key === "label") return typeof handler[key] !== "string" || !handler[key].trim();
                    return typeof handler[key] !== "function";
                });
                if (missing.length) {
                    Logger.warn(`Meal buff handler "${handlerName}" missing keys: ${missing.join(", ")}. Skipped.`);
                    continue;
                }

                if (getMealBuffHandler(handler.id)) {
                    Logger.info(`Meal buff handler "${handler.id}" already registered. Skipped.`);
                    continue;
                }

                registerMealBuffHandler(handler, {
                    overlayId: manifest.overlayId,
                    pluginId: handlerName
                });
                registered++;
                Logger.info(`Registered meal buff handler "${handler.id}" from "${manifest.overlayId}/${sublayer}".`);
            } catch (err) {
                Logger.warn(`Failed to import meal buff handler at "${importPath}".`, err);
            }
        }

        if (registered > 0) {
            Hooks.callAll("ionrift.mealBuffHandlersChanged");
        }
    }

    /**
     * @param {object} overlay
     * @param {string} sublayer
     * @returns {Promise<string[]>}
     * @private
     */
    static async _discoverHandlerNames(overlay, sublayer) {
        const fileIndex = typeof overlay.readFileIndex === "function"
            ? await overlay.readFileIndex(MODULE_ID, sublayer)
            : null;

        if (fileIndex) {
            const found = new Set();
            for (const filePath of fileIndex) {
                const match = HANDLER_PATH_RE.exec(filePath);
                if (match && !match[1].startsWith("_")) found.add(match[1]);
            }
            return [...found];
        }

        try {
            const listing = await overlay.listOverlayDir(
                MODULE_ID,
                sublayer,
                "plugins/meal-buffs/handlers"
            );
            return (listing?.files ?? [])
                .filter(name => (name.endsWith(".mjs") || name.endsWith(".js")) && !name.startsWith("_"))
                .map(name => name.replace(/\.(mjs|js)$/, ""));
        } catch {
            return [];
        }
    }

    /** @private */
    static _registerChangeHook() {
        if (OverlayMealBuffHandlerLoader._hookRegistered) return;
        OverlayMealBuffHandlerLoader._hookRegistered = true;

        Hooks.on("ionrift.overlayContentChanged", async (payload) => {
            if (payload?.moduleId !== MODULE_ID) return;

            const { overlayId, sublayer, active, installed } = payload;
            if (!overlayId) return;

            if (active === false) {
                Logger.info(`Overlay "${overlayId}" deactivated. Unregistering meal buff handlers.`);
                unregisterMealBuffHandlersForOverlay(overlayId);
                Hooks.callAll("ionrift.mealBuffHandlersChanged");
                return;
            }

            if (active === true && installed === true && sublayer) {
                await OverlayMealBuffHandlerLoader._loadSublayer(sublayer);
            }
        });
    }
}

/** @private */
OverlayMealBuffHandlerLoader._hookRegistered = false;
