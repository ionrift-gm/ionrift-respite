/**
 * Local Logger proxy for ionrift-respite.
 * Routes through the kernel Logger factory when available,
 * falls back to console with the correct prefix.
 */
const MODULE_LABEL = "Respite";

export const Logger = game.ionrift?.library?.createLogger?.(MODULE_LABEL) ?? {
    log() {},
    info(...args) { console.log(`Ionrift ${MODULE_LABEL} |`, ...args); },
    warn(...args) { console.warn(`Ionrift ${MODULE_LABEL} |`, ...args); },
    error(...args) { console.error(`Ionrift ${MODULE_LABEL} |`, ...args); }
};
