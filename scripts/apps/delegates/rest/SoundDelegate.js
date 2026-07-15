/**
 * Soft dependency on Resonance ambient API. No-ops when Resonance is inactive.
 */
export class SoundDelegate {

    /** Resonance bag first; legacy alias until dependents migrate. */
    static _handler() {
        return game.ionrift?.resonance?.handler ?? game.ionrift?.handler ?? null;
    }

    static get available() {
        return !!(
            game.modules.get("ionrift-resonance")?.active &&
            this._handler()?.playAmbient
        );
    }

    static stopAll() {
        if (!this.available) return;
        const handler = this._handler();
        handler.stopAmbient("AMBIENT_CAMPFIRE", { fadeOutMs: 1500 });
        handler.stopAmbient("AMBIENT_CAMPFIRE_COOKING", { fadeOutMs: 1000 });
        handler.stopAmbient("AMBIENT_NIGHT_FOREST", { fadeOutMs: 2000 });
    }
}
