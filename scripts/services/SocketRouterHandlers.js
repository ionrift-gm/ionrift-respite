/**
 * SocketRouterHandlers — handler functions for inbound socket messages.
 * Extracted from module.js (Phase 2.2).
 *
 * Each handler receives (data, ctx) where ctx is a live context accessor
 * providing getters/setters for module-scoped mutable state.
 *
 * @module SocketRouterHandlers
 */

import { RestSetupApp } from "../apps/RestSetupApp.js";
import { ShortRestApp } from "../apps/ShortRestApp.js";
import * as RestAfkState from "./RestAfkState.js";
import { refreshAfterAfkChange } from "./restSessionAfkEmit.js";
import { CopySpellHandler } from "./CopySpellHandler.js";
import { CampfireTokenLinker } from "./CampfireTokenLinker.js";
import { TorchTokenLinker } from "./TorchTokenLinker.js";
import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "./DetectMagicInventoryGlowBridge.js";
import { deactivateStationLayer } from "./StationInteractionLayer.js";
import {
    placePlayerGear, placeStation, canPlaceStation,
    clearPlayerCampGear, clearPlayerCampGearType, clearSharedCampStation
} from "./CompoundCampPlacer.js";
import {
    emitShortRestStarted, emitRestStarted, emitShortRestWorkbenchSync,
    emitCampGearPlaced, emitCampStationPlaced, emitCampSceneCleared
} from "./SocketController.js";
import {
    showRejoinNotification, removeRejoinNotification,
    showShortRestRejoinNotification, removeShortRestRejoinNotification,
    showPrepNotification, removePrepNotification,
    removeGmRestIndicator
} from "./RejoinManager.js";
import { emitRequestRestState, emitRequestShortRestState } from "./SocketController.js";
import { resolvePlayerCloseOptions } from "./playerClosePolicy.js";

const MODULE_ID = "ionrift-respite";

// ── Rest Lifecycle ──────────────────────────────────────────────────────────

export function handleRestStarted(data, ctx) {
    if (data.targetUserId && data.targetUserId !== game.user.id) return;
    try {
        ctx.setPlayerRestActive(true);
        removeRejoinNotification();
        removeGmRestIndicator();
        // eslint-disable-next-line no-console
        console.debug(`${MODULE_ID} | [REJOIN] handleRestStarted: targetUserId=${data.targetUserId ?? "all"}, hasExisting=${!!ctx.activePlayerRestApp}`);

        const existing = ctx.activePlayerRestApp;
        if (existing) {
            const isNewRest = !data.restData?.restId || existing._restId !== data.restData.restId;
            // eslint-disable-next-line no-console
            console.debug(`${MODULE_ID} | [SYNC-BISECT] handleRestStarted: isNewRest=${isNewRest}, existingResolverSize=${existing._activityResolver?.activities?.size ?? 0}, incomingActivities=${data.restData?.activities?.length ?? 0}`);
            if (!isNewRest) {
                // Re-hydrate resolver if GM is advancing the same rest (e.g. to activity phase)
                // but the existing player RSA has an empty resolver (built before activities arrived).
                if (Array.isArray(data.restData?.activities) && data.restData.activities.length > 0
                    && !(existing._activityResolver?.activities?.size)) {
                    existing._activities = data.restData.activities;
                    existing._activityResolver.load(existing._activities);
                    // eslint-disable-next-line no-console
                    console.debug(`${MODULE_ID} | [SYNC-BISECT] handleRestStarted: hydrated existing resolver from restData (${existing._activityResolver.activities.size} activities)`);
                }
                if (data.snapshot && existing.receiveRestSnapshot) {
                    existing.receiveRestSnapshot(data.snapshot);
                } else {
                    existing.render({ force: true });
                }
                ctx.showAfkPanel();
                return;
            }
            console.log(`${MODULE_ID} | Closing stale rest window for new rest`);
            ui.notifications.info("The GM has started a new rest. Refreshing your window.");
            existing.close({ skipRejoin: true });
            ctx.setActivePlayerRestApp(null);
        }

        const app = new RestSetupApp({}, data.restData);
        const origClose = app.close.bind(app);
        app.close = async (options = {}) => {
            // Activity-phase closes (X-button) are auto-promoted to retainPlayerApp so
            // the canvas station layer stays wired and choices aren't lost.
            // See: scripts/services/playerClosePolicy.js for the rule + unit tests.
            options = resolvePlayerCloseOptions(options, app._phase);
            // eslint-disable-next-line no-console
            console.debug(`${MODULE_ID} | [REJOIN] playerRSA.close: retain=${options.retainPlayerApp ?? false}, phase=${app._phase}, rendered=${app.rendered}`);
            try {
                await origClose(options);
            } finally {
                if (options.retainPlayerApp) {
                    if (ctx.playerRestActive && !options.skipRejoin) {
                        showRejoinNotification(ctx.activePlayerRestApp, () => {
                            removeRejoinNotification();
                            emitRequestRestState(game.user.id);
                        });
                    }
                    return;
                }
                ctx.setActivePlayerRestApp(null);
                if (ctx.playerRestActive && !options.skipRejoin) {
                    showRejoinNotification(null, () => {
                        removeRejoinNotification();
                        emitRequestRestState(game.user.id);
                    });
                }
            }
        };
        ctx.setActivePlayerRestApp(app);
        console.log(`${MODULE_ID} | RestSetupApp created in player mode, rendering...`);
        app.render({ force: true });
        ctx.showAfkPanel();

        if (data.snapshot && app.receiveRestSnapshot) {
            Promise.resolve().then(() => { app.receiveRestSnapshot(data.snapshot); });
        }
        setTimeout(() => {
            if (ctx.activePlayerRestApp?._openCampfire) {
                console.log(`${MODULE_ID} | Opening campfire for player on rest start`);
                ctx.activePlayerRestApp._openCampfire();
            }
        }, 500);
    } catch (err) {
        console.error(`${MODULE_ID} | Error in handleRestStarted:`, err);
    }
}


export function handleActivityChoice(data, ctx) {
    if (!ctx.activeRestSetupApp) return;
    ctx.activeRestSetupApp.receivePlayerChoices(data.userId, data.choices, data.craftingResults ?? null, data.followUps ?? null, data.earlyResults ?? null);
}

export function handleRestResolved(data, ctx) {
    ctx.setPlayerRestActive(false);
    removeRejoinNotification();
    removeGmRestIndicator();
    notifyDetectMagicScanCleared();
    try {
        deactivateStationLayer();
    } catch { /* canvas may not be ready */ }
    const app = ctx.activePlayerRestApp;
    if (app) {
        app.close({ skipRejoin: true });
        ctx.setActivePlayerRestApp(null);
    }
    ctx.hideAfkPanelAfterRest();
}

export function handleSubmissionUpdate(data, ctx) {
    // eslint-disable-next-line no-console
    console.debug(`${MODULE_ID} | [SYNC] handleSubmissionUpdate: hasApp=${!!ctx.activePlayerRestApp}, keys=${Object.keys(data.submissions ?? {}).join(",") || "none"}`);
    ctx.activePlayerRestApp?.receiveSubmissionUpdate?.(data.submissions);
}

export function handleRequestRestState(data, ctx) {
    if (!ctx.activeRestData) return;
    const snapshot = ctx.activeRestSetupApp?.getRestSnapshot?.() ?? null;
    emitRestStarted(ctx.activeRestData, { snapshot, targetUserId: data.userId ?? null });
}

// ── Short Rest ──────────────────────────────────────────────────────────────

export function handleShortRestStarted(data, ctx) {
    removeShortRestRejoinNotification();
    removePrepNotification();
    const existing = ctx.activeShortRestApp;
    // GM re-renders emit shortRestStarted often (rolls, hooks). Replacing the app
    // recreated ShortRestApp and reset each client's tab to recovery. Merge into
    // an already-open window when it is still on screen.
    const reuseExisting = !!(
        existing
        && existing.rendered === true
        && !existing._isTerminating
        && typeof existing.receiveStarted === "function"
    );
    if (reuseExisting) {
        existing.receiveStarted(data);
        ctx.showAfkPanel();
        void existing.render({ force: true });
        return;
    }
    if (existing) {
        existing._isTerminating = true;
        void existing.close();
    }
    const app = new ShortRestApp();
    app.receiveStarted(data);
    ctx.setActiveShortRestApp(app);
    void app.render({ force: true });
    ctx.showAfkPanel();
}

export function handleShortRestCompletionSummary(data, ctx) {
    ctx.activeShortRestApp?.receiveCompletionSummary?.(data);
}

export function handleShortRestComplete(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (app) {
        ui.notifications.info("Short rest complete. Class features recovered.");
        app._isTerminating = true;
        app.close();
        ctx.setActiveShortRestApp(null);
    }
    removeShortRestRejoinNotification();
    ctx.hideAfkPanelAfterRest();
}

export function handleShortRestAbandoned(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (app) {
        ui.notifications.info("The GM has abandoned the short rest.");
        app._isTerminating = true;
        app.close();
        ctx.setActiveShortRestApp(null);
    }
    removeShortRestRejoinNotification();
    ctx.hideAfkPanelAfterRest();
}

export function handleShortRestDismissed(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (app) {
        app._isTerminating = true;
        app.close();
        ctx.setActiveShortRestApp(null);
    }
    showShortRestRejoinNotification(() => {
        removeShortRestRejoinNotification();
        emitRequestShortRestState(game.user.id);
    });
}

function _workbenchStateFromApp(app) {
    if (!app?._serializeWorkbenchStateForNet) return undefined;
    return app._serializeWorkbenchStateForNet();
}

export function handleRequestShortRestState(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (!app) {
        const saved = game.settings.get(MODULE_ID, "activeShortRest");
        if (!saved?.timestamp) return;
        const newApp = new ShortRestApp({ initialShelter: saved.activeShelter ?? "none" });
        const restored = newApp._loadShortRestState();
        if (!restored) return;
        ctx.registerActiveShortRestApp(newApp);
        emitShortRestStarted({
            targetUserId: data.userId ?? null,
            rolls: newApp._serializeRolls(),
            songBonuses: newApp._serializeSongBonuses(),
            afkCharacterIds: RestAfkState.getAfkCharacterIds(),
            finishedUserIds: [...newApp._finishedUsers],
            activeShelter: newApp._activeShelter,
            rpPrompt: newApp._rpPrompt,
            songVolunteer: newApp._songVolunteer,
            workbench: _workbenchStateFromApp(newApp),
        });
        return;
    }
    emitShortRestStarted({
        targetUserId: data.userId ?? null,
        rolls: app._serializeRolls(),
        songBonuses: app._serializeSongBonuses(),
        afkCharacterIds: RestAfkState.getAfkCharacterIds(),
        finishedUserIds: [...app._finishedUsers],
        activeShelter: app._activeShelter,
        rpPrompt: app._rpPrompt,
        songVolunteer: app._songVolunteer,
        workbench: _workbenchStateFromApp(app),
    });
}

/**
 * @param {object} data
 * @param {import("./SocketRouter.js").SocketContext} ctx
 */
export function handleShortRestWorkbenchStagingFromPlayer(data, ctx) {
    if (!game.user.isGM) return;
    const app = ctx.activeShortRestApp;
    if (!app?.applyWorkbenchStagingFromPlayer) return;
    app.applyWorkbenchStagingFromPlayer(data, emitShortRestWorkbenchSync);
}

/**
 * @param {object} data
 * @param {import("./SocketRouter.js").SocketContext} ctx
 */
export function handleShortRestWorkbenchSync(data, ctx) {
    if (game.user.isGM) return;
    const app = ctx.activeShortRestApp;
    if (!app?.applyWorkbenchStateFromHost) return;
    app.applyWorkbenchStateFromHost(data);
    if (app.rendered) void app.render();
}

// ── AFK / Armor ─────────────────────────────────────────────────────────────

export function handleAfkUpdate(data) {
    RestAfkState.applyUpdate(data.characterId, data.isAfk);
    refreshAfterAfkChange();
}

export function handleArmorToggle(data, ctx) {
    const app = game.user.isGM ? ctx.activeRestSetupApp : ctx.activePlayerRestApp;
    if (app) app.receiveArmorToggle(data.actorId, data.itemId, data.isDoffed);
}

// ── Firewood ────────────────────────────────────────────────────────────────

export async function handleConsumeFirewood(data) {
    const actor = game.actors.get(data.actorId);
    if (!actor) return;
    const firewood = actor.items.get(data.itemId);
    if (!firewood) return;
    const qty = firewood.system?.quantity ?? 1;
    if (qty <= 1) { await firewood.delete(); }
    else { await firewood.update({ "system.quantity": qty - 1 }); }
    console.log(`${MODULE_ID} | GM consumed firewood for ${actor.name} (remaining: ${qty - 1})`);
}

// ── Camp Gear / Stations ────────────────────────────────────────────────────

export async function handleCampGearPlace(data, ctx) {
    const { actorId, gearType, x, y } = data;
    if (!actorId || !gearType || x == null || y == null) return;
    const placed = await placePlayerGear(x, y, gearType, actorId);
    if (placed) {
        emitCampGearPlaced({ actorId, gearType });
        if (ctx.activeRestSetupApp) {
            void ctx.activeRestSetupApp.render();
            ctx.activeRestSetupApp.refreshCanvasStationOverlaysIfActivity?.();
        }
    }
}

export async function handleCampStationPlace(data, ctx) {
    const { actorId, stationKey, x, y, userId } = data;
    if (!actorId || !stationKey || x == null || y == null || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campStationPlace rejected (not owner)`);
        return;
    }
    if (!canPlaceStation(actor, stationKey)) {
        ui.notifications.warn("That character cannot place this station.");
        return;
    }
    const placed = await placeStation(x, y, stationKey);
    if (placed) {
        emitCampStationPlaced();
        if (ctx.activeRestSetupApp) {
            void ctx.activeRestSetupApp.render();
            ctx.activeRestSetupApp.refreshCanvasStationOverlaysIfActivity?.();
        }
        void ctx.activePlayerRestApp?.render();
    }
}

export async function handleCampGearReclaim(data, ctx) {
    const { actorId, gearType, userId, sceneId } = data;
    if (!actorId || !gearType || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campGearReclaim rejected (not owner)`);
        return;
    }
    const n = await clearPlayerCampGearType(actorId, gearType, sceneId ?? null);
    if (n > 0) emitCampGearPlaced({ actorId, gearType });
    ctx.activeRestSetupApp?.render();
    ctx.activePlayerRestApp?.render();
}

export async function handleCampStationReclaim(data, ctx) {
    const { actorId, stationKey, userId } = data;
    if (!actorId || !stationKey || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campStationReclaim rejected (not owner)`);
        return;
    }
    if (!canPlaceStation(actor, stationKey)) {
        ui.notifications.warn("That character cannot pick up this station.");
        return;
    }
    const n = await clearSharedCampStation(stationKey);
    if (n > 0) { emitCampStationPlaced(); }
    else { ui.notifications.info("Nothing to pick up on the scene for that station."); }
    ctx.activeRestSetupApp?.render();
    ctx.activePlayerRestApp?.render();
}

export async function handleCampGearClearPlayer(data, ctx) {
    const { actorId, userId, sceneId } = data;
    if (!actorId || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campGearClearPlayer rejected (not owner)`);
        return;
    }
    const n = await clearPlayerCampGear(actorId, sceneId ?? null);
    if (n > 0) emitCampSceneCleared({ actorId });
    ctx.activeRestSetupApp?.render();
    ctx.activePlayerRestApp?.render();
}


// ── Copy Spell Routing ──────────────────────────────────────────────────────

export function handleCopySpellProposal(data, ctx) {
    if (game.user.isGM) {
        CopySpellHandler.receiveProposalAsGM(data, ctx.activeRestSetupApp);
    } else {
        CopySpellHandler.receiveProposal(data, ctx.activePlayerRestApp);
    }
}

export function handleCopySpellBusy(data, ctx) {
    ui.notifications.warn("The GM is processing another Copy Spell transaction. Please wait and try again.");
    if (ctx.activePlayerRestApp && data.actorId) {
        ctx.activePlayerRestApp._lockedCharacters?.delete(data.actorId);
        ctx.activePlayerRestApp._earlyResults?.delete(data.actorId);
        ctx.activePlayerRestApp.render();
    }
}
