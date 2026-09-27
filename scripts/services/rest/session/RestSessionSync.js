import { MODULE_ID } from "../../../data/moduleId.js";
import { REST_SESSION_SCHEMAS, getRestSessionSchema } from "./restSessionSchemas.js";

/**
 * Socket message types for rest sessions.
 *
 * The wire strings are deliberately unchanged from when this layer only
 * served the gritty flows. They are not persisted anywhere, but leaving them
 * alone keeps the rename free of behaviour.
 */
export const REST_SESSION_SOCKET_TYPES = Object.freeze({
    DELTA: "grittyDelta",
    SYNC: "grittySync",
    STARTED: "grittyRestStarted",
    RESOLVED: "grittyRestResolved",
    ABANDONED: "grittyRestAbandoned",
    REQUEST_STATE: "grittyRequestState",
    SNAPSHOT: "grittySnapshot",
    DISMISSED: "grittyRestDismissed"
});

/** @type {Map<string, object>} restType -> active Application instance */
const activeSessionApps = new Map();

/**
 * Player deltas that arrive before the session window exists. A world that
 * is still booting, or a GM resume that has not constructed the app yet,
 * used to drop these. The player kept the optimistic ready mark and the
 * GM stayed at zero.
 *
 * @type {Map<string, Array<{action: string, payload: object, userId: string|undefined}>>}
 */
const pendingDeltas = new Map();

/**
 * Descriptor for the hooks a session broadcasts. Both values come off the
 * schema so a new session type never needs an entry here.
 *
 * @param {string} restType
 * @returns {{ restType: "short"|"long", isGritty: boolean, grittyMode: string }}
 */
function hookIdentity(restType) {
    const schema = getRestSessionSchema(restType);
    return {
        restType: schema?.systemRestType ?? "long",
        isGritty: schema?.gritty ?? false,
        grittyMode: restType
    };
}

/**
 * Whether a user may act on an actor. Incoming deltas name an actor, so the
 * GM has to check the sender owns it rather than trusting the payload.
 *
 * @param {string} userId
 * @param {string} actorId
 * @returns {boolean}
 */
export function userControlsActor(userId, actorId) {
    if (!userId || !actorId) return false;
    const user = game.users?.get(userId);
    if (!user) return false;
    if (user.isGM) return true;
    const actor = game.actors?.get(actorId);
    return actor?.testUserPermission?.(user, "OWNER") ?? false;
}

/**
 * Registers an active session app for socket message routing.
 *
 * @param {string} restType
 * @param {object} appInstance
 */
export function registerRestSessionApp(restType, appInstance) {
    activeSessionApps.set(restType, appInstance);
}

/**
 * Unregisters an active session app.
 *
 * @param {string} restType
 */
export function unregisterRestSessionApp(restType) {
    activeSessionApps.delete(restType);
    pendingDeltas.delete(restType);
}

/**
 * Applies deltas that were held because no session app was registered.
 * Render is suppressed while they land so a drain from inside context
 * prep cannot re-enter the window. The caller renders once afterwards.
 *
 * @param {string} restType
 */
export function drainPendingRestSessionDeltas(restType) {
    const queued = pendingDeltas.get(restType);
    if (!queued?.length) return;
    pendingDeltas.delete(restType);
    const app = activeSessionApps.get(restType);
    if (!app?.onReceiveDelta) {
        pendingDeltas.set(restType, queued);
        return;
    }
    const render = app.render;
    app.render = () => app;
    try {
        for (const item of queued) {
            app.onReceiveDelta(item.action, item.payload, item.userId);
        }
    } finally {
        app.render = render;
    }
}

/**
 * Returns the currently registered app for the given restType.
 *
 * @param {string} restType
 * @returns {object|null}
 */
export function getActiveRestSessionApp(restType) {
    return activeSessionApps.get(restType) ?? null;
}

/**
 * Emits a player delta (or processes it immediately if executed on the GM host).
 *
 * @param {string} restType
 * @param {string} action
 * @param {object} payload
 */
export function emitRestSessionDelta(restType, action, payload = {}) {
    const isGM = game.user?.isGM ?? false;
    const message = {
        type: REST_SESSION_SOCKET_TYPES.DELTA,
        restType,
        action,
        userId: game.user?.id,
        payload
    };

    if (isGM) {
        // Direct local dispatch on GM client
        handleRestSessionSocketMessage(message);
        return;
    }

    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Emits an authoritative sync state update from the GM to all connected clients.
 *
 * @param {string} restType
 * @param {object} state
 */
export function emitRestSessionSync(restType, state = {}) {
    const message = {
        type: REST_SESSION_SOCKET_TYPES.SYNC,
        restType,
        state
    };

    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Emits notification that a rest session has started (opens UI on player clients).
 *
 * @param {string} restType
 * @param {object} data
 */
export function emitRestSessionStarted(restType, data = {}) {
    Hooks.callAll("ionrift.respite.sleepStarted", hookIdentity(restType));
    const message = {
        type: REST_SESSION_SOCKET_TYPES.STARTED,
        restType,
        data
    };
    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Emits notification that a rest session has resolved.
 *
 * @param {string} restType
 * @param {object} result
 */
export function emitRestSessionResolved(restType, result = {}) {
    Hooks.callAll("ionrift.respite.resolutionEntered", { ...hookIdentity(restType), result });
    const message = {
        type: REST_SESSION_SOCKET_TYPES.RESOLVED,
        restType,
        result
    };
    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Emits notification that a rest session was abandoned.
 *
 * @param {string} restType
 */
/**
 * GM closed the window without ending the session. Players drop their copy
 * and get the rejoin bar; the GM keeps the registered app.
 *
 * @param {string} restType
 */
export function emitRestSessionDismissed(restType) {
    const message = {
        type: REST_SESSION_SOCKET_TYPES.DISMISSED,
        restType
    };
    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

export function emitRestSessionAbandoned(restType) {
    Hooks.callAll("ionrift.respite.restCleanup");
    const message = {
        type: REST_SESSION_SOCKET_TYPES.ABANDONED,
        restType
    };
    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Emits a request from a player client for current rest session state.
 * @param {string} userId The requesting player's user ID
 */
export function emitRestSessionRequestState(userId) {
    const message = {
        type: REST_SESSION_SOCKET_TYPES.REQUEST_STATE,
        userId
    };
    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Emits a rest session snapshot from GM to a specific player or all players.
 * @param {string} restType
 * @param {object} state Full snapshot state
 * @param {string} [targetUserId] Optional target user ID
 */
export function emitRestSessionSnapshot(restType, state = {}, targetUserId = null) {
    const message = {
        type: REST_SESSION_SOCKET_TYPES.SNAPSHOT,
        restType,
        state,
        targetUserId
    };
    if (game.socket) {
        game.socket.emit(`module.${MODULE_ID}`, message);
    }
}

/**
 * Top-level message router for rest session socket types.
 * Invoked by SocketRouter ahead of the per-flow switch.
 *
 * @param {object} data
 * @returns {boolean} True if handled
 */
export function handleRestSessionSocketMessage(data) {
    if (!data?.type || !Object.values(REST_SESSION_SOCKET_TYPES).includes(data.type)) {
        return false;
    }

    const isGM = game.user?.isGM ?? false;
    const { restType, action, payload, state, data: restData } = data;
    const app = getActiveRestSessionApp(restType);

    switch (data.type) {
        case REST_SESSION_SOCKET_TYPES.DELTA: {
            if (!isGM) return true; // Only GM processes incoming deltas
            if (app?.onReceiveDelta) {
                app.onReceiveDelta(action, payload, data.userId);
            } else if (restType && action) {
                const queued = pendingDeltas.get(restType) ?? [];
                queued.push({ action, payload, userId: data.userId });
                pendingDeltas.set(restType, queued);
            }
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.SYNC: {
            if (isGM) return true; // GM already has authoritative state
            if (app?.onReceiveSync) {
                app.onReceiveSync(state);
            }
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.STARTED: {
            if (isGM) return true;
            // Notify or open matching app on player client if configured
            Hooks.callAll("ionrift.respite.sleepStarted", hookIdentity(restType));
            Hooks.callAll("respite:grittyRestStarted", { restType, data: restData });
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.RESOLVED: {
            if (app && typeof app.close === "function") {
                app.close({ resolved: true });
            }
            Hooks.callAll("ionrift.respite.resolutionEntered", {
                ...hookIdentity(restType),
                result: data.result
            });
            Hooks.callAll("respite:grittyRestResolved", { restType, result: data.result });
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.DISMISSED: {
            if (isGM) return true;
            if (app && typeof app.close === "function") app.close();
            Hooks.callAll("respite:restSessionDismissed", { restType });
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.ABANDONED: {
            if (app && typeof app.close === "function") {
                app.close({ abandoned: true });
            }
            Hooks.callAll("ionrift.respite.restCleanup");
            Hooks.callAll("respite:grittyRestAbandoned", { restType });
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.REQUEST_STATE: {
            if (!isGM) return true;
            // Answer for whichever session is live. Only one is ever open, but
            // reply per registered app rather than assuming which one wins.
            for (const type of Object.keys(REST_SESSION_SCHEMAS)) {
                const active = getActiveRestSessionApp(type);
                if (typeof active?._exportSnapshot === "function") {
                    emitRestSessionSnapshot(type, active._exportSnapshot(), data.userId);
                }
            }
            return true;
        }

        case REST_SESSION_SOCKET_TYPES.SNAPSHOT: {
            if (isGM) return true;
            if (data.targetUserId && data.targetUserId !== (game.user?.id)) return true;
            const existingApp = getActiveRestSessionApp(data.restType);
            if (existingApp?.onReceiveSync) {
                existingApp.onReceiveSync(data.state);
            } else {
                Hooks.callAll("respite:grittySnapshot", { restType: data.restType, state: data.state });
            }
            return true;
        }

        default:
            return false;
    }
}
