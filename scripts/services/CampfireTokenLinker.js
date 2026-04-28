/**
 * CampfireTokenLinker
 * Finds a campfire token on the active scene and toggles its light source
 * in sync with the Respite campfire's lit/unlit state.
 *
 * Light config source (in priority order):
 *   1. A world Actor whose name matches the setting -- reads prototypeToken.light
 *   2. Built-in defaults (warm campfire glow)
 *   3. Make Camp fire tier (embers / campfire / bonfire) overrides bright, dim,
 *      colour, and token footprint so the canvas matches the committed level.
 *
 * Token name is configurable via the `campfireTokenName` module setting
 * (default: "Campfire"). Matching is case-insensitive.
 *
 * Only the GM may update tokens. Players emit a socket request and the
 * GM-side handler calls these methods.
 */
import { CampGearScanner } from "./CampGearScanner.js";

const MODULE_ID = "ionrift-respite";

/** Default pit art for the cold campfire base token (placed campfires). Lit overlay uses flame asset or template actor. */
export const CAMPFIRE_TOKEN_IMG = `modules/${MODULE_ID}/assets/tokens/campfire_dead_a.png`;

/** Sensible fallback if no template actor exists. */
const DEFAULT_LIGHT = {
    bright: 20,
    dim: 40,
    color: "#ff9329",
    alpha: 0.4,
    angle: 360,
    coloration: 1,
    luminosity: 0.5,
    saturation: 0,
    contrast: 0,
    shadows: 0,
    animation: {
        type: "torch",
        speed: 3,
        intensity: 4,
        reverse: false
    },
    darkness: { min: 0, max: 1 }
};

export class CampfireTokenLinker {

    /**
     * Get the configured campfire token name.
     * @returns {string}
     */
    static getTokenName() {
        try {
            return game.settings.get(MODULE_ID, "campfireTokenName") ?? "Campfire";
        } catch {
            return "Campfire";
        }
    }

    /**
     * Find the respite flame token (light source) on the active scene.
     * Prefers module flags from CompoundCampPlacer; falls back to name match.
     * @returns {TokenDocument|null}
     */
    static findCampfireToken() {
        const scene = canvas?.scene;
        if (!scene) return null;
        const byFlag = scene.tokens.find(t => t.flags?.[MODULE_ID]?.isCampfireToken === true);
        if (byFlag) return byFlag;
        const targetName = CampfireTokenLinker.getTokenName().toLowerCase();
        return scene.tokens.find(t => t.name?.toLowerCase() === targetName) ?? null;
    }

    /**
     * Find the world Actor whose name matches the setting.
     * Prefers an actor inside a folder named "Ionrift" (case-insensitive)
     * to keep the world root clean. Falls back to any matching actor.
     * @returns {Actor|null}
     */
    static findTemplateActor() {
        const targetName = CampfireTokenLinker.getTokenName().toLowerCase();
        const matches = game.actors?.filter(a => a.name?.toLowerCase() === targetName) ?? [];

        if (matches.length === 0) return null;

        // Prefer actor in an Ionrift folder
        const inFolder = matches.find(a =>
            a.folder?.name?.toLowerCase().includes("ionrift")
        );
        return inFolder ?? matches[0];
    }

    /**
     * Read the light config from the template actor's prototype token,
     * falling back to built-in defaults.
     * @returns {Object} Light data suitable for token.update({ light: ... })
     */
    static getTemplateLightData() {
        const actor = CampfireTokenLinker.findTemplateActor();
        if (actor) {
            const proto = actor.prototypeToken?.light;
            if (proto && (proto.bright > 0 || proto.dim > 0)) {
                // Clone to avoid mutating the actor data
                const light = foundry.utils.deepClone(proto.toObject?.() ?? proto);
                console.log(`${MODULE_ID} | CampfireTokenLinker: using template from actor "${actor.name}"`, light);
                return light;
            }
        }
        console.log(`${MODULE_ID} | CampfireTokenLinker: no template actor with light config, using defaults`);
        return foundry.utils.deepClone(DEFAULT_LIGHT);
    }

    /**
     * Merge template (or default) light with tier-specific bright/dim/colour.
     * @param {string} fireLevel - embers | campfire | bonfire
     * @returns {Object}
     */
    static getLightDataForFireLevel(fireLevel = "campfire") {
        const base = CampfireTokenLinker.getTemplateLightData();
        const tierKey = ["embers", "campfire", "bonfire"].includes(fireLevel) ? fireLevel : "campfire";
        const tier = CampGearScanner.FIRE_TOKEN_VISUAL_BY_LEVEL[tierKey];
        if (!tier?.light) return base;
        return foundry.utils.mergeObject(base, tier.light, { inplace: false, overwrite: true });
    }

    /**
     * @param {string} fireLevel
     * @returns {{ width: number, height: number, textureScale: number }}
     */
    static getVisualSizingForFireLevel(fireLevel = "campfire") {
        const tierKey = ["embers", "campfire", "bonfire"].includes(fireLevel) ? fireLevel : "campfire";
        return CampGearScanner.FIRE_TOKEN_VISUAL_BY_LEVEL[tierKey]
            ?? CampGearScanner.FIRE_TOKEN_VISUAL_BY_LEVEL.campfire;
    }

    static #gridSize() {
        return canvas?.dimensions?.size ?? 100;
    }

    /**
     * Shift top-left so the token center stays fixed when width/height change.
     * @param {TokenDocument} token
     * @param {number} newW
     * @param {number} newH
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    static #patchCenterPreserving(token, newW, newH) {
        const gs = CampfireTokenLinker.#gridSize();
        const oldW = token.width ?? 1;
        const oldH = token.height ?? 1;
        const dx = ((oldW - newW) * gs) / 2;
        const dy = ((oldH - newH) * gs) / 2;
        return { x: token.x + dx, y: token.y + dy, width: newW, height: newH };
    }

    /**
     * Toggle the campfire token's light on or off.
     * When lit, applies template light merged with the given fire tier (size, tint, radii).
     * When unlit, zeroes light and resets footprint to 1x1.
     * Only the GM should call this directly; players route through socket.
     * @param {boolean} lit - true to turn light on, false to turn off
     * @param {string|null} [fireLevel] - embers | campfire | bonfire when lit; defaults to campfire if omitted
     */
    static async setLightState(lit, fireLevel = null) {
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campfireTokenSync",
                lit,
                fireLevel: lit ? (fireLevel ?? "campfire") : null
            });
            return;
        }

        const token = CampfireTokenLinker.findCampfireToken();
        if (!token) {
            console.log(`${MODULE_ID} | CampfireTokenLinker: no campfire token found on scene`);
            return;
        }

        if (lit) {
            const tierKey = fireLevel && ["embers", "campfire", "bonfire"].includes(fireLevel)
                ? fireLevel
                : "campfire";
            const lightData = CampfireTokenLinker.getLightDataForFireLevel(tierKey);
            const vis = CampfireTokenLinker.getVisualSizingForFireLevel(tierKey);
            const { x, y, width, height } = CampfireTokenLinker.#patchCenterPreserving(
                token,
                vis.width ?? 1,
                vis.height ?? 1
            );
            const scale = vis.textureScale ?? 1;
            await token.update({
                hidden: false,
                x,
                y,
                width,
                height,
                light: lightData,
                "texture.scaleX": scale,
                "texture.scaleY": scale
            });
            console.log(`${MODULE_ID} | CampfireTokenLinker: light ON (${tierKey}), token visible`);
        } else {
            const { x, y, width, height } = CampfireTokenLinker.#patchCenterPreserving(token, 1, 1);
            await token.update({
                hidden: true,
                x,
                y,
                width,
                height,
                "texture.scaleX": 1,
                "texture.scaleY": 1,
                "light.bright": 0,
                "light.dim": 0
            });
            console.log(`${MODULE_ID} | CampfireTokenLinker: light OFF, token hidden`);
        }

        // Auto-link: sync perimeter torches when campfire state changes
        try {
            const autoLink = game.settings.get(MODULE_ID, "torchAutoLink");
            if (autoLink !== false) {
                const { TorchTokenLinker } = await import("./TorchTokenLinker.js");
                await TorchTokenLinker.setLightState(lit);
            }
        } catch (e) {
            // Silently ignore if torch setting not registered yet (first load)
            console.debug(`${MODULE_ID} | CampfireTokenLinker: torch auto-link skipped`, e.message);
        }
    }

    /**
     * Check whether a campfire token exists on the active scene.
     * @returns {boolean}
     */
    static hasCampfireToken() {
        return CampfireTokenLinker.findCampfireToken() !== null;
    }
}
