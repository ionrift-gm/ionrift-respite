/**
 * When true, dnd5e preRestCompleted suppression in module.js is skipped. Used for the
 * final native `actor.shortRest()` after Respite-managed hit dice, so class features
 * and wild shape (among others) still apply.
 */
let nativeShortRestUnsuppressed = false;

/**
 * @param {boolean} value
 */
export function setNativeShortRestUnsuppressed(value) {
    nativeShortRestUnsuppressed = !!value;
}

/**
 * @returns {boolean}
 */
export function isNativeShortRestUnsuppressed() {
    return nativeShortRestUnsuppressed;
}
