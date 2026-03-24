/**
 * Local Logger wrapper for ionrift-respite.
 * Routes through ionrift-lib Logger when available, falls back to console.
 * `log()` is gated on the module's "debug" setting.
 */
const MODULE_ID = "ionrift-respite";
const MODULE_LABEL = "Respite";

export const Logger = {
    get _lib() {
        return game.ionrift?.library?.Logger;
    },

    get _debug() {
        try {
            return game.settings.get(MODULE_ID, "debug");
        } catch { return false; }
    },

    /** Debug log. Hidden unless debug setting is enabled. */
    log(...args) {
        if (!this._debug) return;
        if (this._lib) return this._lib.log(MODULE_LABEL, ...args);
        console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
    },

    /** Informational. Always visible. */
    info(...args) {
        if (this._lib) return this._lib.info(MODULE_LABEL, ...args);
        console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
    },

    /** Warning. Always visible. */
    warn(...args) {
        if (this._lib) return this._lib.warn(MODULE_LABEL, ...args);
        console.warn(`Ionrift ${MODULE_LABEL} |`, ...args);
    },

    /** Error. Always visible. */
    error(...args) {
        if (this._lib) return this._lib.error(MODULE_LABEL, ...args);
        console.error(`Ionrift ${MODULE_LABEL} |`, ...args);
    }
};
