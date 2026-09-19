/**
 * When the rest window already hosts Make Camp lighting, token station overlays
 * must stay off. Move fire relocates the pit; it must not arm fire-station UI.
 *
 * @param {object} state
 * @param {string} state.phase
 * @param {boolean} state.campToActivityDone
 * @param {boolean} state.isTotM
 * @param {boolean} state.showFullMakeCampPanel
 * @param {boolean} state.comfortEnabled
 * @param {boolean} state.campfirePlaced
 * @param {boolean} state.canvasReady
 * @returns {boolean}
 */
export function shouldShowCampPitNoticeLayer(state = {}) {
    if (state.phase !== "camp" || state.campToActivityDone) return false;
    if (state.isTotM || state.showFullMakeCampPanel) return false;
    if (!state.comfortEnabled || !state.campfirePlaced || !state.canvasReady) return false;
    return true;
}
