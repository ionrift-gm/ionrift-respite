/**
 * OverlayMealBuffPresetLoader
 *
 * Loads meal buff presets authored by overlay packs (e.g. Core Cooking Pack)
 * into the homebrew recipe editor preset registry.
 */

import { Logger } from "../utils/Logger.js";
import {
    registerOverlayMealBuffPreset,
    unregisterOverlayMealBuffPresetsForOverlay
} from "./MealBuffPresets.js";

const MODULE_ID = "ionrift-respite";
const PRESETS_PATH = "meal-buffs/presets.json";
const REQUIRED_PRESET_KEYS = ["id", "label", "description"];

export class OverlayMealBuffPresetLoader {

    /**
     * Entry point. Loads presets from all active overlay sublayers.
     */
    static async loadAll() {
        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) {
            Logger.log(`${MODULE_ID} | Meal buff preset loader: overlay API unavailable.`);
            return;
        }

        const sublayers = await overlay.listInstalledSublayers(MODULE_ID);
        if (!sublayers?.length) return;

        for (const sublayer of sublayers) {
            await OverlayMealBuffPresetLoader._loadSublayer(sublayer);
        }

        OverlayMealBuffPresetLoader._registerChangeHook();
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
            console.warn(`${MODULE_ID} | Meal buff preset loader: manifest read failed for "${sublayer}".`, err);
            return;
        }
        if (!manifest?.overlayId) return;

        const active = await overlay.isOverlayActive(manifest.overlayId, MODULE_ID, sublayer);
        if (!active) return;

        unregisterOverlayMealBuffPresetsForOverlay(manifest.overlayId);

        let doc;
        try {
            doc = await overlay.readOverlayFile(MODULE_ID, sublayer, PRESETS_PATH);
        } catch {
            return;
        }

        const presets = Array.isArray(doc?.presets) ? doc.presets : [];
        if (!presets.length) return;

        const packLabel = doc.packLabel ?? doc.name ?? manifest.overlayId;
        let registered = 0;

        for (const raw of presets) {
            const missing = REQUIRED_PRESET_KEYS.filter(k => typeof raw?.[k] !== "string" || !raw[k].trim());
            if (missing.length) {
                console.warn(
                    `${MODULE_ID} | Meal buff preset skipped in "${manifest.overlayId}": missing ${missing.join(", ")}.`
                );
                continue;
            }
            if (typeof raw.wellFed !== "boolean") {
                console.warn(`${MODULE_ID} | Meal buff preset "${raw.id}" skipped: wellFed must be boolean.`);
                continue;
            }

            registerOverlayMealBuffPreset(raw, {
                overlayId: manifest.overlayId,
                packLabel
            });
            registered++;
        }

        if (registered > 0) {
            Logger.log(
                `${MODULE_ID} | Meal buff preset loader: registered ${registered} preset(s) from "${manifest.overlayId}".`
            );
            Hooks.callAll("ionrift.mealBuffPresetsChanged");
        }
    }

    /**
     * @private
     */
    static _registerChangeHook() {
        if (OverlayMealBuffPresetLoader._hookRegistered) return;
        OverlayMealBuffPresetLoader._hookRegistered = true;

        Hooks.on("ionrift.overlayContentChanged", async (payload) => {
            if (payload?.moduleId !== MODULE_ID) return;

            const { overlayId, sublayer, active, installed } = payload;
            if (!overlayId) return;

            if (active === false) {
                unregisterOverlayMealBuffPresetsForOverlay(overlayId);
                Hooks.callAll("ionrift.mealBuffPresetsChanged");
                return;
            }

            if (active === true && installed === true && sublayer) {
                await OverlayMealBuffPresetLoader._loadSublayer(sublayer);
            }
        });
    }
}

/** @private */
OverlayMealBuffPresetLoader._hookRegistered = false;
