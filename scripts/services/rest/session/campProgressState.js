/**
 * Camp-tab progress for the one-window rest.
 *
 * Gather results, skips, the open tab, and ready marks live on the rest
 * host (the saved session and the snapshot). A render or a reconnect must
 * not turn a finished gather or a locked activity back into an open draft.
 */

import { emitCampProgress, emitRestSnapshot } from "../../socket/SocketController.js";

const GATHER_ACTIVITIES = new Set(["act_forage", "act_hunt"]);

/** Forage and hunt are the day's gather choice. They do not spend the activity choice. */
export function isGatherActivityId(activityId) {
    return GATHER_ACTIVITIES.has(activityId);
}

/**
 * Move a leftover forage or hunt id out of the activity map.
 * The activity slot stays open so the same day can still take an activity.
 * @param {object} app
 * @param {string} actorId
 */
export function releaseGatherFromActivity(app, actorId) {
    if (!app || !actorId) return;
    ensureCollections(app);
    let moved = null;
    for (const map of [app._gmOverrides, app._characterChoices]) {
        const id = map.get(actorId);
        if (!isGatherActivityId(id)) continue;
        if (!moved) moved = id;
        map.delete(actorId);
    }
    if (moved && !app._gatherChoices.has(actorId)) app._gatherChoices.set(actorId, moved);
    const activityId = app._gmOverrides.get(actorId) ?? app._characterChoices.get(actorId);
    if (!activityId || isGatherActivityId(activityId)) app._lockedCharacters.delete(actorId);
}

/**
 * Gather and the activity are separate daily choices.
 * Gather is done when the haul is in or the day was skipped.
 * The activity is done when a non-gather choice is stored.
 * @param {object} app
 * @param {string} actorId
 * @param {boolean} [gatherOn]
 * @returns {{ choice: string|null, gatherDone: boolean, activityDone: boolean }}
 */
export function dailyChoiceStatus(app, actorId, gatherOn = true) {
    if (!app || !actorId) return { choice: null, gatherDone: !gatherOn, activityDone: false };
    releaseGatherFromActivity(app, actorId);
    const choice = app._gmOverrides.get(actorId) ?? app._characterChoices.get(actorId) ?? null;
    const gatherDone = !gatherOn
        || app._gatherSkipIds.has(actorId)
        || app._gatherResults.has(actorId);
    const activityDone = Boolean(choice) && !isGatherActivityId(choice);
    return { choice: activityDone ? choice : null, gatherDone, activityDone };
}

function ensureCollections(app) {
    if (!app._gatherResults) app._gatherResults = new Map();
    if (!app._gatherChoices) app._gatherChoices = new Map();
    if (!app._gatherSkipIds) app._gatherSkipIds = new Set();
    if (!app._finishedActorIds) app._finishedActorIds = new Set();
    if (!app._lockedCharacters) app._lockedCharacters = new Set();
    if (!app._characterChoices) app._characterChoices = new Map();
    if (!app._gmOverrides) app._gmOverrides = new Map();
}

function asEntries(value) {
    if (!value) return [];
    if (value instanceof Map) return [...value.entries()];
    if (Array.isArray(value)) return value;
    if (typeof value === "object") return Object.entries(value);
    return [];
}

/**
 * Drop the in-flight flag so a pending gather can be stored.
 * @param {object|null|undefined} pending
 * @returns {object|null}
 */
export function gatherPendingPatch(pending) {
    if (!pending) return null;
    const { _findingsBusy, ...rest } = pending;
    return rest;
}

/**
 * @param {object} app
 * @returns {object}
 */
export function campProgressPayload(app) {
    ensureCollections(app);
    return {
        gatherResults: [...app._gatherResults.entries()],
        gatherChoices: [...app._gatherChoices.entries()],
        gatherSkipIds: [...app._gatherSkipIds],
        gatherPending: gatherPendingPatch(app._gatherPending),
        finishedActorIds: [...app._finishedActorIds],
        selectedWorkflowStep: app._selectedWorkflowStep ?? null
    };
}

/**
 * Snapshot copy. The open tab stays on each client.
 * @param {object} app
 * @returns {object}
 */
export function campProgressForSnapshot(app) {
    const payload = campProgressPayload(app);
    delete payload.selectedWorkflowStep;
    return payload;
}

/**
 * @param {object} app
 * @param {object|null|undefined} payload
 * @param {{ merge?: boolean }} [options]
 */
export function applyCampProgress(app, payload, { merge = false } = {}) {
    if (!payload || typeof payload !== "object") return;
    ensureCollections(app);

    if (payload.gatherResults != null) {
        const entries = asEntries(payload.gatherResults);
        if (merge) {
            for (const [id, result] of entries) app._gatherResults.set(id, result);
        } else {
            app._gatherResults = new Map(entries);
        }
    } else if (payload.gatherResult && payload.characterId) {
        app._gatherResults.set(payload.characterId, payload.gatherResult);
    }

    if (payload.gatherChoices != null) {
        const entries = asEntries(payload.gatherChoices);
        if (merge) {
            for (const [id, choice] of entries) app._gatherChoices.set(id, choice);
        } else {
            app._gatherChoices = new Map(entries);
        }
    } else if (payload.gatherChoice && payload.characterId) {
        app._gatherChoices.set(payload.characterId, payload.gatherChoice);
    }

    if (payload.gatherSkipIds != null) {
        const ids = Array.isArray(payload.gatherSkipIds) ? payload.gatherSkipIds : [...payload.gatherSkipIds];
        if (merge) {
            for (const id of ids) app._gatherSkipIds.add(id);
        } else {
            app._gatherSkipIds = new Set(ids);
        }
    } else if (payload.gatherSkip && payload.characterId) {
        app._gatherSkipIds.add(payload.characterId);
        app._gatherChoices.delete(payload.characterId);
    }

    if (payload.gatherPending) {
        const incoming = payload.gatherPending;
        const characterId = incoming.characterId;
        const current = app._gatherPending;
        const alreadyResolved = !!(characterId && app._gatherResults?.has(characterId));
        const rollInFlight = !!(
            current?._findingsBusy
            && current.characterId === characterId
            && current.phase === incoming.phase
        );
        if (alreadyResolved) {
            if (current?.characterId === characterId) app._gatherPending = null;
        } else if (!rollInFlight) {
            app._gatherPending = { ...incoming };
        }
    } else if (payload.gatherPending === null && payload.characterId && app._gatherPending?.characterId === payload.characterId) {
        app._gatherPending = null;
    } else if (!merge && "gatherPending" in payload) {
        app._gatherPending = null;
    }

    if (payload.finishedActorIds != null) {
        const ids = Array.isArray(payload.finishedActorIds) ? payload.finishedActorIds : [...payload.finishedActorIds];
        app._finishedActorIds = new Set(ids);
    } else if (payload.finishedActorId) {
        if (payload.finished) app._finishedActorIds.add(payload.finishedActorId);
        else app._finishedActorIds.delete(payload.finishedActorId);
    }

    if (!merge && typeof payload.selectedWorkflowStep === "string" && payload.selectedWorkflowStep) {
        app._selectedWorkflowStep = payload.selectedWorkflowStep;
    }
}

/**
 * A finished haul or a confirmed skip cannot be rolled again.
 * @param {object} app
 * @param {string} characterId
 * @returns {boolean}
 */
export function gatherAlreadyResolved(app, characterId) {
    if (!characterId) return false;
    return !!(app._gatherResults?.has(characterId) || app._gatherSkipIds?.has(characterId));
}

/**
 * A finished activity or craft spends the activity choice, not the gather choice.
 * Gather closes once this rest has a haul or a skip, or while a craft drawer is open.
 * @param {object} app
 * @param {string} actorId
 * @returns {boolean}
 */
export function gatherSelectionBlocked(app, actorId) {
    if (!app || !actorId) return true;
    if (app._craftingInProgress?.has(actorId)) return true;
    return gatherAlreadyResolved(app, actorId);
}

/**
 * Activity cards stay closed once that character's choice is locked on the host.
 * Forage and hunt are gather, not activity offerings.
 * @param {object} app
 * @param {string} characterId
 * @returns {boolean}
 */
export function activityOfferingsClosed(app, characterId) {
    if (!characterId) return false;
    const choice = app._gmOverrides?.get(characterId) ?? app._characterChoices?.get(characterId);
    if (!choice || GATHER_ACTIVITIES.has(choice)) return false;
    return !!(app._lockedCharacters?.has(characterId) || app._gmOverrides?.has(characterId));
}

/**
 * Record a player submission on the host so the offerings stay closed
 * after the snapshot comes back.
 * @param {object} app
 * @param {object|null|undefined} choices
 */
export function lockSubmittedActivities(app, choices) {
    if (!choices || typeof choices !== "object") return;
    ensureCollections(app);
    for (const [charId, actId] of Object.entries(choices)) {
        if (!actId || GATHER_ACTIVITIES.has(actId)) continue;
        app._lockedCharacters.add(charId);
    }
}

/**
 * Station canvas moves the GM to the next character who still needs a pick.
 * The one-window rest stays on the character who just committed, or the
 * finished gather and the closed offerings disappear behind someone else.
 * @param {object} params
 * @returns {string|null}
 */
export function activityFocusAfterCommit({ isGM, isTotM, phase, partyIds, choices, currentId }) {
    if (!(isGM && phase === "activity" && !isTotM)) return currentId ?? null;
    const next = (partyIds ?? []).find(id => !choices?.has(id));
    return next ?? currentId ?? null;
}

/**
 * GM writes the host copy and pushes a snapshot. A player sends the patch
 * so the host can store it.
 * @param {object} app
 * @param {object} patch
 */
export function publishCampProgress(app, patch) {
    if (game.user?.isGM) {
        void app._saveRestState?.();
        const snapshot = app.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
        return;
    }
    emitCampProgress(patch);
}
