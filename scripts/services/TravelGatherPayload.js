import { getTravelGatherAvailability } from "./TravelSettings.js";
import { isScoutingEnabled } from "./ScoutingSettings.js";

/**
 * GM-authoritative travel gather flags for player sync (restricted settings safe).
 * @param {object} params
 * @param {string[]|undefined} params.terrainActivities
 * @param {boolean} [params.safeRestSpot]
 * @param {boolean} [params.scoutingAllowed]
 * @returns {{ canForage: boolean, canHunt: boolean, canScout: boolean, hasTravelOptions: boolean }}
 */
export function buildTravelGatherPayload({
    terrainActivities,
    safeRestSpot = false,
    scoutingAllowed = true
} = {}) {
    const allowed = terrainActivities ?? ["forage", "hunt", "scout"];
    const { canForage, canHunt } = getTravelGatherAvailability(terrainActivities);
    const canScout = !safeRestSpot && allowed.includes("scout") && isScoutingEnabled() && scoutingAllowed;
    return {
        canForage,
        canHunt,
        canScout,
        hasTravelOptions: canForage || canHunt || canScout
    };
}
