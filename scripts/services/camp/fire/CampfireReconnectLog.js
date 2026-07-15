/**
 * Client-side diagnostics for TotM campfire restore after F5 / rejoin.
 * Grep Foundry console or foundrylog.txt for: CampfireReconnect
 */

const TAG = "CampfireReconnect";

/**
 * @param {string} step
 * @param {Record<string, unknown>} [detail]
 */
export function logCampfireReconnect(step, detail = {}) {
    const user = game.user?.name ?? "?";
    const isGM = !!game.user?.isGM;
    const payload = {
        user,
        isGM,
        phase: detail.phase ?? undefined,
        ...detail
    };
    console.info(`[Respite:${TAG}] ${step}`, payload);
}
