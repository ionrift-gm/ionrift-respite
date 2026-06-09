/**
 * Player-side REST_STARTED merge for an already-open RestSetupApp.
 * Extracted for headless tests (resync loop regression class).
 */

/** @type {Map<string, number>} */
const restStateRequestAtByRestId = new Map();

export const REST_STATE_REQUEST_COOLDOWN_MS = 5000;

/** @param {string} [restId] */
export function clearRestStateRequestCooldown(restId) {
    if (restId) restStateRequestAtByRestId.delete(restId);
    else restStateRequestAtByRestId.clear();
}

/**
 * @param {object|null|undefined} app
 * @param {object|null|undefined} restData
 * @returns {boolean} true when any field was written
 */
export function applyRestDataToExistingPlayerApp(app, restData) {
    if (!app || !restData) return false;
    let changed = false;

    if (restData.phase) {
        app._phase = restData.phase;
        changed = true;
    }
    if (restData.restId) {
        app._restId = restData.restId;
    }
    if (restData.terrainTag) {
        app._selectedTerrain = restData.terrainTag;
        app._restData = { ...(app._restData ?? {}), terrainTag: restData.terrainTag };
        changed = true;
    }
    if (restData.fireLevel !== undefined && restData.fireLevel !== null) {
        app._fireLevel = restData.fireLevel;
        if (app._engine) app._engine.fireLevel = restData.fireLevel;
        changed = true;
    }
    if (restData.comfort && app._engine) {
        app._engine.comfort = restData.comfort;
        changed = true;
    }
    if (restData.safeRestSpot !== undefined) {
        const safe = !!restData.safeRestSpot;
        if (app._engine) app._engine.safeRestSpot = safe;
        app._restData = { ...(app._restData ?? {}), safeRestSpot: safe };
        changed = true;
    }
    if (restData.travelGather && typeof restData.travelGather === "object") {
        app._syncedTravelGather = { ...restData.travelGather };
        changed = true;
    }

    return changed;
}

/**
 * @param {object} params
 * @param {string|null|undefined} params.restId
 * @param {object|null|undefined} params.app
 * @param {object|null|undefined} params.restData
 * @param {number} [params.now]
 * @returns {boolean}
 */
export function shouldRequestRestStateForExistingApp({ restId, app, restData, now = Date.now() }) {
    if (restData?.phase || app?._phase) return false;

    const key = restId ?? app?._restId ?? "";
    if (!key) return true;

    const last = restStateRequestAtByRestId.get(key);
    if (last != null && now - last < REST_STATE_REQUEST_COOLDOWN_MS) return false;

    restStateRequestAtByRestId.set(key, now);
    return true;
}
