/**
 * Soft dependency on Resonance ambient API. No-ops when Resonance is inactive.
 */
export class SoundDelegate {

    static MIN_RESONANCE_VERSION = "2.11.10";

    /** Resonance bag first; legacy alias until dependents migrate. */
    static _handler() {
        return game.ionrift?.resonance?.handler ?? game.ionrift?.handler ?? null;
    }

    static get isResonanceInstalled() {
        return game.modules.has("ionrift-resonance");
    }

    static get isResonanceActive() {
        return game.modules.get("ionrift-resonance")?.active ?? false;
    }

    static get isResonanceCompatible() {
        if (!this.isResonanceActive) return false;
        const ver = game.modules.get("ionrift-resonance")?.version;
        if (!ver) return true;
        return !foundry.utils.isNewerVersion(this.MIN_RESONANCE_VERSION, ver);
    }

    static get available() {
        return !!(
            this.isResonanceActive &&
            this._handler()?.playAmbient
        );
    }

    static stopAll() {
        Hooks.callAll("ionrift.respite.restCleanup");
        Hooks.callAll("ionrift.respite.campfireStateChanged", { lit: false, fireLevel: "unlit", token: null, inHud: false });
        if (!this.available) return;
        const handler = this._handler();
        handler.stopAmbient("AMBIENT_CAMPFIRE", { fadeOutMs: 1500 });
        handler.stopAmbient("AMBIENT_CAMPFIRE_COOKING", { fadeOutMs: 1000 });
        handler.stopAmbient("AMBIENT_NIGHT_FOREST", { fadeOutMs: 2000 });
    }
}
