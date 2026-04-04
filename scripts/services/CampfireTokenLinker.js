/**
 * CampfireTokenLinker
 * Finds a campfire token on the active scene and toggles its light source
 * in sync with the Respite campfire's lit/unlit state.
 *
 * Light config source (in priority order):
 *   1. A world Actor whose name matches the setting -- reads prototypeToken.light
 *   2. Built-in defaults (warm campfire glow)
 *
 * Token name is configurable via the `campfireTokenName` module setting
 * (default: "Campfire"). Matching is case-insensitive.
 *
 * Only the GM may update tokens. Players emit a socket request and the
 * GM-side handler calls these methods.
 */
const MODULE_ID = "ionrift-respite";

/** Path to the shipped campfire token sprite. */
export const CAMPFIRE_TOKEN_IMG = `modules/${MODULE_ID}/assets/tokens/campfire_topdown_128x128.webm`;

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
     * Find the first token on the active scene whose name matches the setting.
     * @returns {TokenDocument|null}
     */
    static findCampfireToken() {
        const targetName = CampfireTokenLinker.getTokenName().toLowerCase();
        const scene = canvas?.scene;
        if (!scene) return null;
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
     * Toggle the campfire token's light on or off.
     * When lit, applies the template actor's light config (or defaults).
     * When unlit, zeroes out bright and dim.
     * Only the GM should call this directly; players route through socket.
     * @param {boolean} lit - true to turn light on, false to turn off
     */
    static async setLightState(lit) {
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campfireTokenSync",
                lit
            });
            return;
        }

        const token = CampfireTokenLinker.findCampfireToken();
        if (!token) {
            console.log(`${MODULE_ID} | CampfireTokenLinker: no campfire token found on scene`);
            return;
        }

        if (lit) {
            const lightData = CampfireTokenLinker.getTemplateLightData();
            await token.update({ hidden: false, light: lightData });
            console.log(`${MODULE_ID} | CampfireTokenLinker: light ON, token visible`);
        } else {
            await token.update({
                hidden: true,
                "light.bright": 0,
                "light.dim": 0
            });
            console.log(`${MODULE_ID} | CampfireTokenLinker: light OFF, token hidden`);
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
