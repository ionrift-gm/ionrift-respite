import { Logger } from "../../utils/Logger.js";
import { refreshGmRestIndicator } from "../ui/sheet/RejoinManager.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { RestSetupApp } from "../../apps/rest/RestSetupApp.js";
import { ShortRestApp } from "../../apps/rest/ShortRestApp.js";
import * as RestAfkState from "../rest/session/RestAfkState.js";
import { setCharacterAfk } from "../afk/AfkBridgeService.js";
import { CopySpellHandler } from "../crafting/outcomes/CopySpellHandler.js";
import { CampfireTokenLinker } from "../camp/fire/CampfireTokenLinker.js";
import { TorchTokenLinker } from "../camp/props/TorchTokenLinker.js";
import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "../crafting/detectMagic/DetectMagicInventoryGlowBridge.js";
import { closeOpenStationDialog } from "../../apps/camp/StationActivityDialog.js";
import { GrantLedger } from "../crafting/outcomes/GrantLedger.js";
import { ItemOutcomeHandler } from "../crafting/outcomes/ItemOutcomeHandler.js";
import { guardEmbedItems } from "../crafting/outcomes/MintGuard.js";
import { deactivateStationLayer } from "../camp/props/StationInteractionLayer.js";
import {
    placePlayerGear, placeStation, canPlaceStation,
    clearPlayerCampGear, clearPlayerCampGearType, clearSharedCampStation
} from "../camp/props/CompoundCampPlacer.js";
import {
    emitShortRestStarted, emitRestStarted, emitShortRestWorkbenchSync,
    emitCampGearPlaced, emitCampStationPlaced, emitCampSceneCleared,
    emitRequestRestState, emitRequestShortRestState
} from "./SocketController.js";
import {
    showRejoinNotification, removeRejoinNotification,
    showShortRestRejoinNotification, removeShortRestRejoinNotification,
    showPrepNotification, removePrepNotification,
    removeGmRestIndicator
} from "../ui/sheet/RejoinManager.js";
import { resolvePlayerCloseOptions } from "../ui/sheet/playerClosePolicy.js";
import { logCampfireReconnect } from "../camp/fire/CampfireReconnectLog.js";
import {
    applyRestDataToExistingPlayerApp,
    shouldRequestRestStateForExistingApp
} from "../rest/flow/restStartedPlayerSync.js";
import { buildTravelGatherPayload } from "../travel/resolve/TravelGatherPayload.js";
import { TerrainRegistry } from "../events/resolve/TerrainRegistry.js";

export function handleRestStarted(data, ctx) {
    if (data.targetUserId && data.targetUserId !== game.user.id) return;
    try {
        logCampfireReconnect("handleRestStarted:enter", {
            targetUserId: data.targetUserId ?? null,
            hasSnapshot: !!data.snapshot,
            snapshotPhase: data.snapshot?.phase ?? null,
            snapshotFireLevel: data.snapshot?.fireLevel ?? null,
            incomingRestId: data.restData?.restId ?? null,
            restDataPhase: data.restData?.phase ?? null,
            hasExistingApp: !!ctx.activePlayerRestApp,
            existingRestId: ctx.activePlayerRestApp?._restId ?? null,
            existingPhase: ctx.activePlayerRestApp?._phase ?? null,
            existingFireLevel: ctx.activePlayerRestApp?._fireLevel ?? null
        });
        ctx.setPlayerRestActive(true);
        removeRejoinNotification();
        removeGmRestIndicator();

        const existing = ctx.activePlayerRestApp;
        if (existing) {
            const incomingId = data.restData?.restId ?? null;
            const existingId = existing._restId ?? null;
            // Missing restId on a broadcast is a resync, not a new session. Treating
            // it as new rest closed the player app and destroyed the campfire embed.
            const isNewRest = !!(incomingId && existingId && incomingId !== existingId);
            logCampfireReconnect("handleRestStarted:existingApp", {
                incomingId,
                existingId,
                isNewRest,
                hasSnapshot: !!data.snapshot
            });
            if (!isNewRest) {
                if (incomingId && !existingId) {
                    existing._restId = incomingId;
                }
                // Re-hydrate resolver if GM is advancing the same rest (e.g. to activity phase)
                // but the existing player RSA has an empty resolver (built before activities arrived).
                if (Array.isArray(data.restData?.activities) && data.restData.activities.length > 0
                    && !(existing._activityResolver?.activities?.size)) {
                    existing._activities = data.restData.activities;
                    existing._activityResolver.load(existing._activities);
                }
                if (data.restData?.tavernTotmOverride !== undefined) {
                    existing._tavernTotmOverride = !!data.restData.tavernTotmOverride;
                } else if (data.restData?.terrainTag === "tavern") {
                    existing._applyTavernTotmOverrideForRestStart?.("tavern");
                }
                if (data.snapshot && existing.receiveRestSnapshot) {
                    logCampfireReconnect("handleRestStarted:receiveRestSnapshot", {
                        snapshotFireLevel: data.snapshot?.fireLevel ?? null
                    });
                    existing.receiveRestSnapshot(data.snapshot);
                } else {
                    applyRestDataToExistingPlayerApp(existing, data.restData);
                    const needsSnapshot = shouldRequestRestStateForExistingApp({
                        restId: incomingId ?? existingId,
                        app: existing,
                        restData: data.restData
                    });
                    if (needsSnapshot) {
                        logCampfireReconnect("handleRestStarted:requestState", {
                            reason: "no snapshot on REST_STARTED for existing app"
                        });
                        emitRequestRestState(game.user.id);
                    } else {
                        logCampfireReconnect("handleRestStarted:restDataHydrate", {
                            phase: existing._phase ?? null,
                            restId: existing._restId ?? null
                        });
                    }
                    if (existing.rendered) {
                        existing.render({ force: true });
                    }
                }
                ctx.showAfkPanel();
                return;
            }

            logCampfireReconnect("handleRestStarted:closeForNewRest", {
                incomingId,
                existingId
            });
            Logger.log(`${MODULE_ID} | Closing stale rest window for new rest`);
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
                    showRejoinNotification(app, () => {
                        removeRejoinNotification();
                        emitRequestRestState(game.user.id);
                    });
                }
            }
        };
        ctx.setActivePlayerRestApp(app);
        ctx.showAfkPanel();

        if (data.snapshot && app.receiveRestSnapshot) {
            logCampfireReconnect("handleRestStarted:newAppDeferredSnapshot", {
                restId: data.restData?.restId ?? null,
                snapshotFireLevel: data.snapshot?.fireLevel ?? null
            });
            Logger.log(`${MODULE_ID} | RestSetupApp created in player mode, deferring render to snapshot handler`);
            Promise.resolve().then(() => { app.receiveRestSnapshot(data.snapshot); });
        } else {
            logCampfireReconnect("handleRestStarted:awaitSnapshot", {
                restId: data.restData?.restId ?? null,
                restDataPhase: data.restData?.phase ?? null,
                restDataFireLevel: data.restData?.fireLevel ?? null
            });
            Logger.log(`${MODULE_ID} | RestSetupApp created in player mode, awaiting snapshot before render`);
            // Open the window now with restData hydration. Without this, a player
            // F5 mid-rest (especially travel) leaves the snapshot-arrival path as
            // the only render trigger; if the snapshot races or never arrives the
            // rest UI never opens.
            if (data.restData?.phase && data.restData.phase !== "setup") {
                try { app.render({ force: true }); } catch (err) {
                    console.warn(`${MODULE_ID} | new player app initial render failed`, err);
                }
            }
            emitRequestRestState(game.user.id);
        }
        setTimeout(() => {
            const phase = ctx.activePlayerRestApp?._phase;
            const app = ctx.activePlayerRestApp;
            if (!app || phase !== "meal" && phase !== "activity") return;
            // TotM uses the side-panel embed, not the legacy drawer.
            if (app._isTotM) return;
            if (app._openCampfire) {
                Logger.log(`${MODULE_ID} | Opening campfire for player on rest start`);
                app._openCampfire();
            }
        }, 500);
    } catch (err) {

        console.error(`${MODULE_ID} | Error in handleRestStarted:`, err);
    }
}

export function handleActivityChoice(data, ctx) {
    // Silent drop was the previous behaviour and is the worst failure mode:
    // the player submits, the GM never sees it, and there's no diagnostic.
    // Warn instead so the GM can recover (resetFlowState / refresh).
    if (!ctx.activeRestSetupApp) {
        console.warn(`${MODULE_ID} | handleActivityChoice: no activeRestSetupApp on GM; dropping submission from ${data.userId}`);
        ui?.notifications?.warn?.("Player activity submission dropped: GM rest session not registered. Reopen the rest sheet.");
        return;
    }
    ctx.activeRestSetupApp.receivePlayerChoices(data.userId, data.choices, data.craftingResults ?? null, data.followUps ?? null, data.earlyResults ?? null);
    // If the GM minimised the RSA to the footer, receivePlayerChoices' render()
    // is a no-op. Update the footer bar so the GM still sees the latest count.
    refreshGmRestIndicator(ctx.activeRestSetupApp);
}

export function handleRestResolved(data, ctx) {

    ctx.setPlayerRestActive(false);
    removeRejoinNotification();
    removeGmRestIndicator();
    void closeOpenStationDialog().catch(err => console.warn(`${MODULE_ID} | closeOpenStationDialog`, err));
    notifyDetectMagicScanCleared();
    try {
        deactivateStationLayer();
    } catch { /* canvas may not be ready */ }
    let app = ctx.activePlayerRestApp;
    if (!app) {
        app = foundry.applications.instances.get("ionrift-respite-setup") ?? null;
    }

    if (app) {
        app._terminated = true;
        app.close({ skipRejoin: true }).then(() => {

        }).catch(err => {

            console.warn(`${MODULE_ID} | app.close() REJECTED:`, err);
            try { app.element?.remove(); } catch { /* best effort */ }
        });
        ctx.setActivePlayerRestApp(null);
    }
    ctx.hideAfkPanelAfterRest();
}

export function handleSubmissionUpdate(data, ctx) {
    ctx.activePlayerRestApp?.receiveSubmissionUpdate?.(data.submissions);
}

export function handleRequestRestState(data, ctx) {
    if (!ctx.activeRestData) {
        logCampfireReconnect("handleRequestRestState:skip", { reason: "no activeRestData" });
        return;
    }
    const userId = data.userId ?? null;
    const gmApp = ctx.activeRestSetupApp;
    const snapshot = (userId && gmApp?.getRestSnapshotForUser)
        ? gmApp.getRestSnapshotForUser(userId)
        : (gmApp?.getRestSnapshot?.() ?? null);
    const gmPhase = gmApp?._phase ?? ctx.activeRestData.phase;
    const gmTerrain = gmApp?._engine?.terrainTag ?? gmApp?._selectedTerrain ?? ctx.activeRestData.terrainTag;
    let resolvedTravelGather = null;
    if (gmApp && gmPhase === "travel") {
        const terrainTag = gmTerrain ?? "forest";
        const terrain = TerrainRegistry.get(terrainTag);
        resolvedTravelGather = buildTravelGatherPayload({
            terrainActivities: terrain?.travelActivities,
            safeRestSpot: !!(gmApp._engine?.safeRestSpot ?? gmApp._restData?.safeRestSpot),
            scoutingAllowed: gmApp._travel?.scoutingAllowed ?? true
        });
    }
    const restData = {
        ...ctx.activeRestData,
        ...(gmApp ? {
            phase: gmPhase,
            fireLevel: gmApp._fireLevel ?? ctx.activeRestData.fireLevel,
            coldCampDecided: !!gmApp._coldCampDecided,
            comfort: gmApp._engine?.comfort ?? ctx.activeRestData.comfort,
            safeRestSpot: !!(gmApp._engine?.safeRestSpot ?? ctx.activeRestData.safeRestSpot),
            terrainTag: gmTerrain,
            activities: gmApp._activities?.length ? gmApp._activities : ctx.activeRestData.activities,
            ...(resolvedTravelGather ? { travelGather: resolvedTravelGather } : {})
        } : {})
    };
    logCampfireReconnect("handleRequestRestState:emit", {
        targetUserId: userId,
        hasSnapshot: !!snapshot,
        snapshotPhase: snapshot?.phase ?? null,
        snapshotFireLevel: snapshot?.fireLevel ?? null,
        snapshotRestId: snapshot?.restId ?? null,
        gmPhase: gmApp?._phase ?? null,
        gmFireLevel: gmApp?._fireLevel ?? null,
        restDataPhase: restData.phase ?? null
    });
    // Snapshot rides on REST_STARTED; handleRestStarted applies it once via
    // receiveRestSnapshot. A delayed REST_SNAPSHOT duplicated that work and
    // could overwrite player state that changed between the two applies.
    emitRestStarted(restData, { snapshot, targetUserId: userId });
}

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
    void closeOpenStationDialog().catch(err => console.warn(`${MODULE_ID} | closeOpenStationDialog`, err));
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
            chefVolunteer: newApp._chefVolunteer,
            chefMealServedCount: newApp._chefMealServedCount,
            chefMealBonuses: newApp._serializeChefMealBonuses(),
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
        chefVolunteer: app._chefVolunteer,
        chefMealServedCount: app._chefMealServedCount,
        chefMealBonuses: app._serializeChefMealBonuses(),
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

export function handleAfkUpdate(data) {
    setCharacterAfk(data.characterId, data.isAfk, "socket", { emitSocket: false });
}

export function handleArmorToggle(data, ctx) {
    const app = game.user.isGM ? ctx.activeRestSetupApp : ctx.activePlayerRestApp;
    if (app) app.receiveArmorToggle(data.actorId, data.itemId, data.isDoffed);
}

export async function handleConsumeFirewood(data) {
    const actor = game.actors.get(data.actorId);
    if (!actor) return;
    const firewood = actor.items.get(data.itemId);
    if (!firewood) return;
    const qty = firewood.system?.quantity ?? 1;
    if (qty <= 1) { await firewood.delete(); }
    else { await firewood.update({ "system.quantity": qty - 1 }); }

    Logger.log(`${MODULE_ID} | GM consumed firewood for ${actor.name} (remaining: ${qty - 1})`);
}

export async function handleCampGearPlace(data, ctx) {
    const { actorId, gearType, x, y } = data;
    if (!actorId || !gearType || x === null || y === null) return;
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
    if (!actorId || !stationKey || x === null || y === null || !userId) return;
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

/**
 * GM-side handler for feast/party meal serving.
 * Players cannot create ActiveEffects or Items on actors they do not own,
 * so the entire serve + Well Fed dispatch runs here on the GM client.
 *
 * @param {object} data - { cookActorId, itemSnapshot, partyIds, feastMode }
 * @param {SocketContext} ctx
 */
export async function handleFeastServeRequest(data, ctx) {
    const { MealPhaseHandler } = await import("../meal/phase/MealPhaseHandler.js");

    const { cookActorId, itemSnapshot, partyIds, feastMode } = data;
    const cookActor = game.actors.get(cookActorId);
    if (!cookActor) {

        console.warn(`ionrift-respite | feastServeRequest: cook actor ${cookActorId} not found`);
        return;
    }

    try {
        if (feastMode === "partyServe") {
            // Distribute individual portions to party members (non-feast craft output)
            const itemData = foundry.utils.duplicate(itemSnapshot);
            delete itemData._id;
            itemData.system = { ...itemData.system, quantity: 1 };

            const recipients = partyIds
                .filter(id => id !== cookActorId)
                .map(id => game.actors.get(id))
                .filter(Boolean);

            const ledger = game.ionrift?.respite?.getActiveApp?.()?._grantLedger;
            const itemRef = itemData.flags?.["ionrift-respite"]?.itemRef ?? itemData.name ?? "feast_serving";
            for (const recipient of recipients) {
                const slotKey = GrantLedger.mealSlotKey(recipient.id, itemRef);
                const grant = [{
                    name: itemData.name,
                    type: itemData.type ?? "loot",
                    img: itemData.img ?? "icons/svg/item-bag.svg",
                    quantity: 1,
                    system: { ...(itemData.system ?? {}), quantity: 1 },
                    flags: itemData.flags ?? {}
                }];
                guardEmbedItems(grant);
                const perform = () => ItemOutcomeHandler.grantItemsToActor(recipient, grant);
                if (ledger) {
                    await ledger.grantOnce(slotKey, perform);
                } else {
                    await perform();
                }
            }
        } else {
            // Feast mode: dispatch Well Fed effects + item creation for the full party
            await MealPhaseHandler._dispatchWellFedMealServing({
                consumerActor: cookActor,
                itemSnapshot,
                partyIds
            });
        }
    } catch (err) {

        console.error("ionrift-respite | feastServeRequest handler error", err);
    }
}

export function handleTrainingStateUpdate(data, ctx) {
    if (!game.user.isGM || !ctx.activeRestSetupApp) return;
    const { characterId, trainingState } = data;
    if (!characterId || !trainingState) return;
    ctx.activeRestSetupApp._trainingStates = ctx.activeRestSetupApp._trainingStates ?? new Map();
    ctx.activeRestSetupApp._trainingStates.set(characterId, { ...trainingState, rolling: false });
    void ctx.activeRestSetupApp._saveRestState?.();
    ctx.activeRestSetupApp.render();
}

export function handleTrainingComplete(data, ctx) {
    if (!game.user.isGM || !ctx.activeRestSetupApp) return;
    const { characterId, earlyResult } = data;
    if (!characterId || !earlyResult) return;
    ctx.activeRestSetupApp._earlyResults = ctx.activeRestSetupApp._earlyResults ?? new Map();
    ctx.activeRestSetupApp._earlyResults.set(characterId, earlyResult);
    ctx.activeRestSetupApp._trainingStates?.delete(characterId);
    void ctx.activeRestSetupApp._saveRestState?.();
    ctx.activeRestSetupApp.render();
    refreshGmRestIndicator(ctx.activeRestSetupApp);
}
