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
     * Stop all rest-related ambient sounds.
     * Called when rest ends or CampfireApp closes.
     */
    static stopAll() {
        if (!this.available) return;
        game.ionrift.handler.stopAmbient("AMBIENT_CAMPFIRE", { fadeOutMs: 1500 });
        game.ionrift.handler.stopAmbient("AMBIENT_CAMPFIRE_COOKING", { fadeOutMs: 1000 });
        game.ionrift.handler.stopAmbient("AMBIENT_NIGHT_FOREST", { fadeOutMs: 2000 });
    }
}
