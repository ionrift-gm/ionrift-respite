/**
 * playerClosePolicy — pure close-option resolution helpers.
 *
 * Extracted from the player RSA close override in SocketRouterHandlers.js
 * so the activity-phase retain rule can be unit-tested without pulling
 * Foundry APIs into the test harness.
 *
 * Invariant: during the activity phase, player RSA closes triggered by the
 * X-button (options = {}) must retain the app ref so the canvas station
 * interaction layer stays wired. Only explicit system closes (skipRejoin,
 * resolved) should fully clear the reference.
 *
 * @module playerClosePolicy
 */

/**
 * Resolves the effective close options for a player RSA.
 *
 * If the RSA is in activity phase and the close was not explicitly flagged
 * as a system action (skipRejoin / resolved), injects retainPlayerApp: true
 * so the close override takes the "retain" path instead of clearing the ref.
 *
 * @param {object} options - Original close options from the caller.
 * @param {string|null} phase - Current RSA _phase value.
 * @returns {object} Options with retainPlayerApp injected if appropriate.
 *                   Returns the original object unmodified if no change needed.
 */
export function resolvePlayerCloseOptions(options, phase) {
    if (
        phase === "activity" &&
        !options.skipRejoin &&
        !options.resolved &&
        !options.retainPlayerApp
    ) {
        return { ...options, retainPlayerApp: true };
    }
    return options;
}
