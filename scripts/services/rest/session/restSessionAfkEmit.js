/** @type {null | ((characterId: string, isAfk: boolean) => void)} */
let impl = null;

/** @type {null | (() => void)} */
let refreshImpl = null;

/**
 * Wired from module.js after active rest refs exist (avoids import cycle with AfkPanelApp).
 * @param {(characterId: string, isAfk: boolean) => void} fn
 */
export function setRestSessionAfkEmitter(fn) {
    impl = fn;
}

/**
 * Re-renders rest windows and the AFK panel after AFK state changes.
 * @param {() => void} fn
 */
export function setAfkUiRefresh(fn) {
    refreshImpl = fn;
}

/**
 * Broadcasts AFK for the active long or short rest (socket type chosen in module).
 * @param {string} characterId
 * @param {boolean} isAfk
 */
export function emitRestSessionAfk(characterId, isAfk) {
    impl?.(characterId, isAfk);
}

/** Re-renders open rest UIs and the AFK HUD. */
export function refreshAfterAfkChange() {
    refreshImpl?.();
}
