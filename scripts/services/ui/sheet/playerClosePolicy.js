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
