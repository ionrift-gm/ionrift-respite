/**
 * OverlayProfessionPluginLoader
 *
 * Loads profession root plugins from overlay sublayers (plugins/profession.mjs).
 */

import { Logger } from "../../../utils/Logger.js";
import { registerMealBuffHandler } from "../../meal/buffs/MealBuffHandlerRegistry.js";
import {
    getProfessionPlugin,
    registerProfessionPlugin,
    unregisterProfessionPluginsForOverlay
} from "../registry/ProfessionPluginRegistry.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const PROFESSION_PATH = "plugins/profession.mjs";
const PROFESSION_PATH_RE = /^plugins\/profession\.mjs$/;
const REQUIRED_KEYS = ["id", "label"];

export class OverlayProfessionPluginLoader {

    /**
     * Entry point. Called from the ready hook (GM only).
     */
    static async loadAll() {
        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) {
            Logger.info("Profession plugin loader: overlay API unavailable.");
            return;
        }

        const sublayers = await overlay.listInstalledSublayers(MODULE_ID);
        if (!sublayers?.length) return;

        for (const sublayer of sublayers) {
            await OverlayProfessionPluginLoader._loadSublayer(sublayer);
        }

        OverlayProfessionPluginLoader._registerChangeHook();
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
            Logger.warn(`Profession plugin loader: manifest read failed for "${sublayer}".`, err);
            return;
        }
        if (!manifest?.overlayId) return;

        const active = await overlay.isOverlayActive(manifest.overlayId, MODULE_ID, sublayer);
        if (!active) return;

        unregisterProfessionPluginsForOverlay(manifest.overlayId);

        const hasProfessionPlugin = await OverlayProfessionPluginLoader._hasProfessionPlugin(overlay, sublayer);
        if (!hasProfessionPlugin) return;

        const platform = game.ionrift?.library?.platform;
        const rawPath = `ionrift-data/overlays/${MODULE_ID}/${sublayer}/${PROFESSION_PATH}`;
        const importPath = platform
            ? await platform.resolveAssetUrl(rawPath)
            : `/${rawPath}`;
        try {
            const mod = await import(importPath);
            const plugin = mod.default ?? mod.profession ?? mod;

            const missing = REQUIRED_KEYS.filter(key => typeof plugin[key] !== "string" || !plugin[key].trim());
            if (missing.length) {
                Logger.warn(`Profession plugin in "${manifest.overlayId}" missing keys: ${missing.join(", ")}. Skipped.`);
                return;
            }

            if (getProfessionPlugin(plugin.id)) {
                Logger.info(`Profession plugin "${plugin.id}" already registered. Skipped.`);
                return;
            }

            registerProfessionPlugin(plugin, {
                overlayId: manifest.overlayId,
                sublayer
            });

            const ctx = OverlayProfessionPluginLoader._buildRegisterContext(manifest.overlayId, sublayer, plugin.id);
            try {
                await plugin.onRegister?.(ctx);
            } catch (err) {
                Logger.warn(`Profession plugin "${plugin.id}" onRegister failed.`, err);
            }

            Logger.info(`Registered profession plugin "${plugin.id}" from "${manifest.overlayId}/${sublayer}".`);
            Hooks.callAll("ionrift.professionPluginsChanged");
        } catch (err) {
            Logger.warn(`Failed to import profession plugin at "${importPath}".`, err);
        }
    }

    /**
     * @param {object} overlay
     * @param {string} sublayer
     * @returns {Promise<boolean>}
     * @private
     */
    static async _hasProfessionPlugin(overlay, sublayer) {
        const fileIndex = typeof overlay.readFileIndex === "function"
            ? await overlay.readFileIndex(MODULE_ID, sublayer)
            : null;

        if (fileIndex?.length) {
            return fileIndex.some(path => PROFESSION_PATH_RE.test(path));
        }

        try {
            const listing = await overlay.listOverlayDir(MODULE_ID, sublayer, "plugins");
            return (listing?.files ?? []).includes("profession.mjs");
        } catch {
            return false;
        }
    }

    /**
     * @param {string} overlayId
     * @param {string} sublayer
     * @param {string} pluginId
     * @private
     */
    static _buildRegisterContext(overlayId, sublayer, pluginId) {
        return {
            overlayId,
            sublayer,
            registerMealBuffHandler(handler) {
                registerMealBuffHandler(handler, { overlayId, pluginId });
            }
        };
    }

    /** @private */
    static _registerChangeHook() {
        if (OverlayProfessionPluginLoader._hookRegistered) return;
        OverlayProfessionPluginLoader._hookRegistered = true;

        Hooks.on("ionrift.overlayContentChanged", async (payload) => {
            if (payload?.moduleId !== MODULE_ID) return;

            const { overlayId, sublayer, active, installed } = payload;
            if (!overlayId) return;

            if (active === false) {
                unregisterProfessionPluginsForOverlay(overlayId);
                Hooks.callAll("ionrift.professionPluginsChanged");
                return;
            }

            if (active === true && installed === true && sublayer) {
                await OverlayProfessionPluginLoader._loadSublayer(sublayer);
            }
        });
    }
}

/** @internal Test helper for profession plugin discovery. */
export async function hasOverlayProfessionPlugin(overlay, sublayer) {
    return OverlayProfessionPluginLoader._hasProfessionPlugin(overlay, sublayer);
}

/** @private */
OverlayProfessionPluginLoader._hookRegistered = false;
