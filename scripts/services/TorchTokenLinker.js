/**
 * TorchTokenLinker
 * Finds all perimeter torch tokens on the active scene and toggles their
 * light sources in batch. Mirrors CampfireTokenLinker but operates on
 * multiple tokens simultaneously.
 *
 * Light config source (in priority order):
 *   1. A world Actor whose name matches the setting — reads prototypeToken.light
 *   2. Built-in defaults (warm torch glow, smaller than campfire)
 *
 * Token name is configurable via the `torchTokenName` module setting
 * (default: "Perimeter Torch"). Matching is case-insensitive.
 *
 * Only the GM may update tokens. Players emit a socket request and the
 * GM-side handler calls these methods.
 */
const MODULE_ID = "ionrift-respite";

/** Path to the shipped torch flame sprite (placeholder, scaled campfire glow). */
export const TORCH_FLAME_IMG = `modules/${MODULE_ID}/assets/tokens/torches/torch_flame_128x128.webm`;

/** Sensible fallback if no template actor exists — smaller/tighter than campfire. */
const DEFAULT_LIGHT = {
    bright: 10,
    dim: 20,
    color: "#e87020",
    alpha: 0.35,
    angle: 360,
    coloration: 1,
    luminosity: 0.5,
    saturation: 0,
    contrast: 0,
    shadows: 0,
    animation: {
        type: "torch",
        speed: 4,
        intensity: 5,
        reverse: false
    },
    darkness: { min: 0, max: 1 }
};

export class TorchTokenLinker {

    /**
     * Get the configured perimeter torch token name.
     * @returns {string}
     */
    static getTokenName() {
        try {
            return game.settings.get(MODULE_ID, "torchTokenName") ?? "Perimeter Torch";
        } catch {
            return "Perimeter Torch";
        }
    }

    /**
     * Find ALL tokens on the active scene whose name matches the setting.
     * Unlike CampfireTokenLinker (which returns the first), this returns an array.
     * @returns {TokenDocument[]}
     */
    static findAllTorchTokens() {
        const targetName = TorchTokenLinker.getTokenName().toLowerCase();
        const scene = canvas?.scene;
        if (!scene) return [];
        return scene.tokens.filter(t => t.name?.toLowerCase() === targetName);
    }

    /**
     * Find the world Actor whose name matches the setting.
     * Prefers an actor inside a folder named "Ionrift" (case-insensitive).
     * @returns {Actor|null}
     */
    static findTemplateActor() {
        const targetName = TorchTokenLinker.getTokenName().toLowerCase();
        const matches = game.actors?.filter(a => a.name?.toLowerCase() === targetName) ?? [];
        if (matches.length === 0) return null;

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
        const actor = TorchTokenLinker.findTemplateActor();
        if (actor) {
            const proto = actor.prototypeToken?.light;
            if (proto && (proto.bright > 0 || proto.dim > 0)) {
                const light = foundry.utils.deepClone(proto.toObject?.() ?? proto);
                console.log(`${MODULE_ID} | TorchTokenLinker: using template from actor "${actor.name}"`, light);
                return light;
            }
        }
        console.log(`${MODULE_ID} | TorchTokenLinker: no template actor with light config, using defaults`);
        return foundry.utils.deepClone(DEFAULT_LIGHT);
    }

    /**
     * Toggle ALL perimeter torch tokens' light on or off.
     * Uses batch updateEmbeddedDocuments for a single DB write.
     * Only the GM should call this directly; players route through socket.
     * @param {boolean} lit - true to turn light on, false to turn off
     */
    static async setLightState(lit) {
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "torchTokenSync",
                lit
            });
            return;
        }

        const torches = TorchTokenLinker.findAllTorchTokens();
        if (!torches.length) {
            console.log(`${MODULE_ID} | TorchTokenLinker: no perimeter torch tokens found on scene`);
            return;
        }

        if (lit) {
            const lightData = TorchTokenLinker.getTemplateLightData();
            const updates = torches.map(t => ({
                _id: t.id,
                hidden: false,
                light: lightData
            }));
            await canvas.scene.updateEmbeddedDocuments("Token", updates);
            console.log(`${MODULE_ID} | TorchTokenLinker: ${torches.length} torch(es) light ON, visible`);
        } else {
            const updates = torches.map(t => ({
                _id: t.id,
                hidden: true,
                "light.bright": 0,
                "light.dim": 0
            }));
            await canvas.scene.updateEmbeddedDocuments("Token", updates);
            console.log(`${MODULE_ID} | TorchTokenLinker: ${torches.length} torch(es) light OFF, hidden`);
        }
    }

    /**
     * Check whether any perimeter torch tokens exist on the active scene.
     * @returns {boolean}
     */
    static hasTorchTokens() {
        return TorchTokenLinker.findAllTorchTokens().length > 0;
    }

    /**
     * Get current light state of the torches (based on first found torch).
     * @returns {boolean} true if torches are lit
     */
    static areTorchesLit() {
        const torches = TorchTokenLinker.findAllTorchTokens();
        if (!torches.length) return false;
        return torches[0].light?.bright > 0;
    }
}
