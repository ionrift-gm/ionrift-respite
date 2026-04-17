/**
 * SoundDelegate
 * Soft-dependency bridge to Ionrift Resonance ambient API.
 * All methods are safe no-ops when Resonance is not installed.
 */
export class SoundDelegate {

    /** @returns {boolean} True if Resonance is active and the ambient API exists. */
    static get available() {
        return !!(
            game.modules.get("ionrift-resonance")?.active &&
            game.ionrift?.handler?.playAmbient
        );
    }

    /**
     * Start the campfire ambient loop.
     * Called when the fire is ignited in CampfireApp.
     * @param {string} fireLevel - "embers" | "campfire" | "bonfire"
     */
    static startCampfire(fireLevel = "campfire") {
        if (!this.available) return;
        const volume = fireLevel === "bonfire" ? 0.5
                     : fireLevel === "campfire" ? 0.3
                     : 0.15;
        game.ionrift.handler.playAmbient("AMBIENT_CAMPFIRE", {
            volume,
            fadeInMs: 2000
        });
    }

    /**
     * Update campfire volume based on fire level changes.
     * @param {string} fireLevel
     */
    static updateCampfireLevel(fireLevel) {
        if (!this.available) return;
        game.ionrift.handler.stopAmbient("AMBIENT_CAMPFIRE", { fadeOutMs: 500 });
        setTimeout(() => this.startCampfire(fireLevel), 600);
    }

    /**
     * Stop all rest-related ambient sounds.
     * Called when rest ends or CampfireApp closes.
     */
    static stopAll() {
        if (!this.available) return;
        game.ionrift.handler.stopAmbient("AMBIENT_CAMPFIRE", { fadeOutMs: 1500 });
        game.ionrift.handler.stopAmbient("AMBIENT_CAMPFIRE_COOKING", { fadeOutMs: 1000 });
        game.ionrift.handler.stopAmbient("AMBIENT_NIGHT_FOREST", { fadeOutMs: 2000 });
    }

    /**
     * Start cooking ambient when a Cooking activity is active.
     */
    static startCooking() {
        if (!this.available) return;
        game.ionrift.handler.playAmbient("AMBIENT_CAMPFIRE_COOKING", {
            volume: 0.2,
            fadeInMs: 1500
        });
    }

    /**
     * Stop cooking ambient.
     */
    static stopCooking() {
        if (!this.available) return;
        game.ionrift.handler.stopAmbient("AMBIENT_CAMPFIRE_COOKING", { fadeOutMs: 1000 });
    }
}
