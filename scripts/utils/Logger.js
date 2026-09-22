/**
 * Local Logger proxy for ionrift-respite.
 * Routes through the kernel Logger factory when available,
 * falls back to console with the correct prefix.
 */
const MODULE_LABEL = "Respite";

function verbose() {
    try {
        const bag = game.settings?.settings;
        if (!bag) return false;
        if (bag.has("ionrift-library.debug") && game.settings.get("ionrift-library", "debug")) return true;
        if (bag.has("ionrift-respite.debug") && game.settings.get("ionrift-respite", "debug")) return true;
    } catch { /* setting not registered yet */ }
    return false;
}

export const Logger = game.ionrift?.library?.createLogger?.(MODULE_LABEL) ?? {
    log(...args) {
        if (!verbose()) return;
        console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
    },
    info(...args) {
        if (!verbose()) return;
        console.log(`Ionrift ${MODULE_LABEL} |`, ...args);
    },
    warn(...args) { console.warn(`Ionrift ${MODULE_LABEL} |`, ...args); },
    error(...args) { console.error(`Ionrift ${MODULE_LABEL} |`, ...args); }
};
