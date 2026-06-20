import { Logger } from "../lib/Logger.js";
/**
 * SocketRouter: inbound socket message dispatcher.
 * Extracted from module.js (Phase 2.2).
 *
 * Receives raw socket data and routes to handler functions.
 * Module-scoped mutable state is accessed through a context object
 * passed at wire-up time, avoiding circular imports.
 *
 * @module SocketRouter
 */

import { logCampfireReconnect } from "./CampfireReconnectLog.js";
import { buildCampCeremonyPhasePayload } from "./campCeremonySync.js";
import { SOCKET_TYPES, emitRequestRestState, emitWorkbenchIdentifyResult, emitPhaseChanged } from "./SocketController.js";
import { isCampfireMinigameEnabled } from "./RestProfileSettings.js";
import { WorkbenchDelegate } from "../apps/delegates/WorkbenchDelegate.js";
import { CopySpellHandler } from "./CopySpellHandler.js";
import { CampfireTokenLinker } from "./CampfireTokenLinker.js";
import { TorchTokenLinker } from "./TorchTokenLinker.js";
import * as RestAfkState from "./RestAfkState.js";
import { setCharacterAfk } from "./afk/AfkBridgeService.js";
import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "./DetectMagicInventoryGlowBridge.js";
import {
    showPrepNotification, removePrepNotification
} from "./RejoinManager.js";
import {
    handleRestStarted, handleActivityChoice, handleRestResolved,
    handleSubmissionUpdate, handleRequestRestState,
    handleShortRestStarted, handleShortRestCompletionSummary, handleShortRestComplete, handleShortRestAbandoned,
    handleShortRestDismissed, handleRequestShortRestState,
    handleShortRestWorkbenchStagingFromPlayer, handleShortRestWorkbenchSync,
    handleAfkUpdate, handleArmorToggle, handleConsumeFirewood,
    handleCampGearPlace, handleCampStationPlace,
    handleCampGearReclaim, handleCampStationReclaim, handleCampGearClearPlayer,
    handleCopySpellProposal, handleCopySpellBusy,
    handleFeastServeRequest,
    handleTrainingStateUpdate, handleTrainingComplete
} from "./SocketRouterHandlers.js";

const MODULE_ID = "ionrift-respite";

/**
 * @typedef {object} SocketContext
 * @property {object|null} activeRestSetupApp
 * @property {object|null} activePlayerRestApp
 * @property {object|null} activeShortRestApp
 * @property {object|null} activeCampfireEmbed
 * @property {boolean} playerRestActive
 * @property {object|null} activeRestData
 * @property {function} setActivePlayerRestApp
 * @property {function} setActiveShortRestApp
 * @property {function} setPlayerRestActive
 * @property {function} registerActiveShortRestApp
 * @property {function} showAfkPanel
 * @property {function} hideAfkPanelAfterRest
 */

/**
 * Central socket message dispatcher.
 * @param {object} data - Raw socket message.
 * @param {SocketContext} ctx - Live context accessor for module-scoped state.
 */
export function dispatch(data, ctx) {
    if (!data?.type) return;
        Logger.log(`${MODULE_ID} | Socket received:`, data.type, `isGM=${game.user.isGM}`);

    switch (data.type) {
        // ── Rest Lifecycle ───────────────────────────────────────────
        case SOCKET_TYPES.REST_STARTED:
            if (game.user.isGM) return;
            removePrepNotification();
            handleRestStarted(data, ctx);
            break;

        case SOCKET_TYPES.REST_PREPARING:
            if (game.user.isGM) return;
            showPrepNotification();
            break;

        case SOCKET_TYPES.ACTIVITY_CHOICE:
            if (!game.user.isGM) return;
            handleActivityChoice(data, ctx);
            break;

        case SOCKET_TYPES.TRAINING_STATE_UPDATE:
            if (!game.user.isGM) return;
            handleTrainingStateUpdate(data, ctx);
            break;

        case SOCKET_TYPES.TRAINING_COMPLETE:
            if (!game.user.isGM) return;
            handleTrainingComplete(data, ctx);
            break;

        case SOCKET_TYPES.REST_RESOLVED:
            if (game.user.isGM) return;
            handleRestResolved(data, ctx);
            break;

        case SOCKET_TYPES.REST_ABANDONED:
            if (game.user.isGM) return;
            ui.notifications.info("The GM has abandoned the rest.");
            handleRestResolved(data, ctx);
            break;

        case SOCKET_TYPES.PHASE_CHANGED:
            if (game.user.isGM) return;
            if (ctx.activePlayerRestApp?.receivePhaseChange) {
                void ctx.activePlayerRestApp.receivePhaseChange(data.phase, data.phaseData ?? {}).catch(err => {

                    console.error(`${MODULE_ID} | receivePhaseChange failed`, err);
                });
            } else if (!ctx.activePlayerRestApp && data.phase && data.phase !== "setup") {
                // F5 during Make Camp (or any post-setup phase) may arrive before REST_STARTED.
                // Re-request the full rest state so the player RSA opens without waiting on GM input.

                Logger.log(`${MODULE_ID} | PHASE_CHANGED received but no player app, requesting state resync`);
                emitRequestRestState(game.user.id);
            }
            break;

        case SOCKET_TYPES.SUBMISSION_UPDATE:
            if (game.user.isGM) return;
            handleSubmissionUpdate(data, ctx);
            break;

        case SOCKET_TYPES.REQUEST_REST_STATE:
            if (!game.user.isGM) return;
            handleRequestRestState(data, ctx);
            break;

        case SOCKET_TYPES.REST_SNAPSHOT:
            if (game.user.isGM) return;
            logCampfireReconnect("socket:REST_SNAPSHOT", {
                hasApp: !!ctx.activePlayerRestApp,
                snapshotPhase: data.snapshot?.phase ?? null,
                snapshotFireLevel: data.snapshot?.fireLevel ?? null,
                snapshotRestId: data.snapshot?.restId ?? null
            });
            if (ctx.activePlayerRestApp?.receiveRestSnapshot) {
                ctx.activePlayerRestApp.receiveRestSnapshot(data.snapshot);
            } else if (data.snapshot?.phase && data.snapshot.phase !== "setup") {
                logCampfireReconnect("socket:REST_SNAPSHOT:orphan", {
                    snapshotPhase: data.snapshot.phase,
                    snapshotRestId: data.snapshot.restId ?? null
                });
                const restData = {
                    restId: data.snapshot.restId ?? null,
                    phase: data.snapshot.phase,
                    fireLevel: data.snapshot.fireLevel ?? "unlit",
                    coldCampDecided: !!data.snapshot.coldCampDecided,
                    terrainTag: data.snapshot.selectedTerrain ?? "forest",
                    comfort: data.snapshot.comfort ?? "rough",
                    safeRestSpot: !!data.snapshot.safeRestSpot,
                    activities: data.snapshot.activities ?? []
                };
                handleRestStarted({ restData, snapshot: data.snapshot, targetUserId: game.user.id }, ctx);
            }
            break;

        // ── Camp Ceremony ────────────────────────────────────────────
        case SOCKET_TYPES.CAMP_LIGHT_FIRE_REQUEST:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?._runSetCampFireLevelForGm) {
                void ctx.activeRestSetupApp._runSetCampFireLevelForGm("campfire", data.userId ?? null).catch(err => {

                    console.error(`${MODULE_ID} | campLightFireRequest:`, err);
                    ui.notifications.error("Could not set fire level. Check the console.");
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.CAMP_FIRE_LEVEL_REQUEST:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp) {
                ctx.activeRestSetupApp._maybeClearStagedWoodOnTierChange(data.fireLevel);
                ctx.activeRestSetupApp._campFirePreviewLevel = data.fireLevel;
                ctx.activeRestSetupApp._coldCampPreview = false;
                ctx.activeRestSetupApp._coldCampDecided = false;
                emitPhaseChanged(ctx.activeRestSetupApp._phase, {
                    campFirePreviewLevel: data.fireLevel,
                    coldCampPreview: false,
                    coldCampDecided: false,
                    makeCampStagedWood: [...(ctx.activeRestSetupApp._makeCampStagedWood ?? [])],
                    selectedTerrain: ctx.activeRestSetupApp._selectedTerrain ?? null
                });
                ctx.activeRestSetupApp._syncCampCeremonyPreviewToEmbed?.();
                ctx.activeRestSetupApp.render();
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.CAMP_COLD_CAMP:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp) {
                ctx.activeRestSetupApp._maybeClearStagedWoodOnTierChange("cold_camp");
                ctx.activeRestSetupApp._coldCampPreview = true;
                ctx.activeRestSetupApp._campFirePreviewLevel = "cold_camp";
                ctx.activeRestSetupApp._makeCampStagedWood = [];
                emitPhaseChanged(ctx.activeRestSetupApp._phase, {
                    coldCampPreview: true,
                    campFirePreviewLevel: "cold_camp",
                    makeCampStagedWood: [],
                    selectedTerrain: ctx.activeRestSetupApp._selectedTerrain ?? null
                });
                ctx.activeRestSetupApp._syncCampCeremonyPreviewToEmbed?.();
                ctx.activeRestSetupApp.render();
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case "campCeremonyStageWood":
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp && data.slot) {
                const app = ctx.activeRestSetupApp;
                const cost = app._campPreviewFirewoodCost?.() ?? 0;
                if ((app._makeCampStagedWood?.length ?? 0) >= cost) break;
                app._makeCampStagedWood = [...(app._makeCampStagedWood ?? []), data.slot];
                emitPhaseChanged(app._phase, buildCampCeremonyPhasePayload(app));
                app._syncCampCeremonyPreviewToEmbed?.();
                if (app._campfireApp) void app._campfireApp.render();
                else app.render();
            }
            break;

        case "campCeremonyUnstageWood":
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp && data.slotId) {
                const app = ctx.activeRestSetupApp;
                app._makeCampStagedWood = (app._makeCampStagedWood ?? []).filter(s => s.id !== data.slotId);
                emitPhaseChanged(app._phase, buildCampCeremonyPhasePayload(app));
                app._syncCampCeremonyPreviewToEmbed?.();
                if (app._campfireApp) void app._campfireApp.render();
                else app.render();
            }
            break;

        case SOCKET_TYPES.CAMP_COLD_CAMP_COMMIT:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?._campCeremony) {
                void ctx.activeRestSetupApp._campCeremony.selectColdCamp().catch(err => {

                    console.error(`${MODULE_ID} | campColdCampCommit:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.ACTIVITY_COLD_CAMP_REQUEST:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?.setColdCampDuringActivity) {
                void ctx.activeRestSetupApp.setColdCampDuringActivity({ fromPlayer: true }).catch(err => {

                    console.error(`${MODULE_ID} | activityColdCampRequest:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.ACTIVITY_FIRE_LEVEL_REQUEST:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?.changeFireLevelDuringActivity) {
                void ctx.activeRestSetupApp.changeFireLevelDuringActivity(data.fireLevel, { fromPlayer: true, requestingUserId: data.userId ?? null }).catch(err => {

                    console.error(`${MODULE_ID} | activityFireLevelRequest:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.CAMP_LIGHT_FIRE: {
            if (!game.user.isGM) return;
            if (!ctx.activeRestSetupApp?._campCeremony) {
                ui.notifications.warn("Open the rest session on the GM client first.");
                break;
            }
            const chosenLevel = ["embers", "campfire", "bonfire"].includes(data.previewLevel)
                ? data.previewLevel
                : "embers";
            const method = data.method ?? "Tinderbox";
            const app = ctx.activeRestSetupApp;
            if (method === "Minigame" && isCampfireMinigameEnabled()) {
                void app._commitMakeCampCeremonyIgnite()
                    .catch(err => console.error(`${MODULE_ID} | campCeremonyIgnite:`, err));
                break;
            }
            void app._campCeremony
                .lightFire(data.userId, data.actorId, method, chosenLevel)
                .catch(err => console.error(`${MODULE_ID} | campLightFire:`, err));
            break;
        }

        case SOCKET_TYPES.CAMP_FIREWOOD_PLEDGE:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?._campCeremony) {
                void ctx.activeRestSetupApp._campCeremony.addFirewoodPledge(data.userId, data.actorId).catch(err => {

                    console.error(`${MODULE_ID} | campFirewoodPledge:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.CAMP_FIREWOOD_RECLAIM:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?._campCeremony) {
                void ctx.activeRestSetupApp._campCeremony.removeFirewoodPledge(data.userId).catch(err => {

                    console.error(`${MODULE_ID} | campFirewoodReclaim:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        // ── Meal ─────────────────────────────────────────────────────
        case SOCKET_TYPES.MEAL_CHOICE:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveMealChoices?.(data.userId, data.choices);
            break;

        case SOCKET_TYPES.FEAST_SERVE_REQUEST:
            if (!game.user.isGM) return;
            handleFeastServeRequest(data, ctx);
            break;

        case SOCKET_TYPES.MEAL_DAY_CONSUME_REQUEST:
            if (!game.user.isGM) return;
            void ctx.activeRestSetupApp?.receiveMealDayConsumeRequest?.(data.userId, data.consumeByCharacter)
                .catch(err => {

                    console.error(`${MODULE_ID} | mealDayConsumeRequest`, err);
                });
            break;

        case SOCKET_TYPES.MEAL_DAY_CONSUMED:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveMealDayConsumed?.(data.userId, data.mealChoices);
            break;

        case SOCKET_TYPES.DEHYDRATION_SAVE_REQUEST: {
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            const dehydApp = ctx.activePlayerRestApp ?? ctx.activeRestSetupApp;
            dehydApp?.receiveDehydrationPrompt?.(data.characterId, data.actorName, data.dc);
            break;
        }

        case SOCKET_TYPES.DEHYDRATION_SAVE_RESULT:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveDehydrationResult?.(data);
            break;

        case SOCKET_TYPES.DEHYDRATION_RESULTS_BROADCAST:
            if (game.user.isGM) return;
            if (ctx.activePlayerRestApp) {
                ctx.activePlayerRestApp._dehydrationResults = data.results ?? [];
                ctx.activePlayerRestApp.render();
            }
            break;

        // ── Detect Magic ─────────────────────────────────────────────
        case SOCKET_TYPES.DETECT_MAGIC_SCAN_BROADCAST: {
            const results = data.results ?? [];
            const partyActorIds = data.partyActorIds ?? [];
            const dmApp = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp ?? ctx.activeShortRestApp;
            if (dmApp) {
                dmApp._magicScanResults = results;
                dmApp._magicScanComplete = !!data.magicScanComplete;
                if (dmApp.rendered) void dmApp.render(false);
            }
            notifyDetectMagicScanApplied(
                { _magicScanResults: results, _magicScanComplete: !!data.magicScanComplete },
                partyActorIds
            );
            break;
        }

        case SOCKET_TYPES.DETECT_MAGIC_SCAN_CLEARED: {
            const clrApp = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp ?? ctx.activeShortRestApp;
            if (clrApp) {
                clrApp._magicScanResults = null;
                clrApp._magicScanComplete = false;
                clrApp._workbenchIdentifyStaging?.clear();
                clrApp._workbenchIdentifyAcknowledge?.clear();
                clrApp._workbenchIdentifySubmitPending?.clear();
                if (clrApp.rendered && !clrApp._terminated) void clrApp.render(false);
            }
            Hooks.callAll(`${MODULE_ID}.workbenchIdentifyStagingTouched`);
            notifyDetectMagicScanCleared();
            break;
        }

        case SOCKET_TYPES.WORKBENCH_IDENTIFY_REQUEST: {
            if (!game.user.isGM) break;
            const { actorId, itemId, requestId, targetUserId } = data;
        Logger.log(`[Respite] WB-IDENTIFY GM received req=${requestId} actor=${actorId} item=${itemId} target=${targetUserId}`);
            void (async () => {
                const actor = game.actors.get(actorId);
                const item = actor?.items?.get(itemId);
                if (!item) {

                    console.warn(`[Respite] WB-IDENTIFY GM: item not found. actor=${actorId} item=${itemId}`);
                    emitWorkbenchIdentifyResult({ requestId, success: false, targetUserId });
                    return;
                }
                const qmActive = game.modules?.get("ionrift-quartermaster")?.active;
        Logger.log(`[Respite] WB-IDENTIFY GM: qmActive=${qmActive} item.name=${item.name} identified=${item.system?.identified}`);
                const latentFlag = item.getFlag?.("ionrift-quartermaster", "latentMagic");
                const cursedFlag = item.getFlag?.("ionrift-quartermaster", "cursedMeta");
        Logger.log(`[Respite] WB-IDENTIFY GM: latentMagic=${!!latentFlag} cursedMeta=${!!cursedFlag}`);
                let success = false;
                if (qmActive) {
                    try {
                        const { IdentificationService } = await import(
                            "/modules/ionrift-quartermaster/scripts/services/IdentificationService.js"
                        );
        Logger.log(`[Respite] WB-IDENTIFY GM: calling IdentificationService.identify`);
                        const result = await IdentificationService.identify(item, { silent: true });
        Logger.log(`[Respite] WB-IDENTIFY GM: QM result →`, result);
                        success = result.identified;
                    } catch (err) {

                        console.error("[Respite] WB-IDENTIFY GM: QM import/identify failed", err);
                    }
                }
                if (!success) {

                    Logger.log(`[Respite] WB-IDENTIFY GM: QM did not identify, trying curseBypass update`);
                    try {
                        await item.update({ "system.identified": true }, { curseBypass: true });
                        success = true;
        Logger.log(`[Respite] WB-IDENTIFY GM: curseBypass update succeeded`);
                    } catch (err) {

                        console.error("[Respite] WB-IDENTIFY GM: raw update failed", err);
                    }
                }

                Logger.log(`[Respite] WB-IDENTIFY GM: emitting result success=${success} req=${requestId}`);
                emitWorkbenchIdentifyResult({ requestId, success, targetUserId });
            })();
            break;
        }

        case SOCKET_TYPES.WORKBENCH_IDENTIFY_RESULT: {
            if (data.targetUserId !== null && data.targetUserId !== game.user.id) break;
            const { requestId, success } = data;
            const pendingCount = WorkbenchDelegate._pendingIdentifyRequests?.size ?? -1;
        Logger.log(`[Respite] WB-IDENTIFY player: result received success=${success} req=${requestId} pendingMapSize=${pendingCount}`);
            WorkbenchDelegate._resolveIdentifyRequest(requestId, success);
            break;
        }

        // ── Event / Tree Rolls ───────────────────────────────────────
        case SOCKET_TYPES.EVENT_ROLL_REQUEST:
            if (game.user.isGM) return;
            ctx.activePlayerRestApp?.receiveRollRequest?.(data);
            break;

        case SOCKET_TYPES.EVENT_ROLL_RESULT:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveRollResult?.(data);
            break;

        case SOCKET_TYPES.TREE_ROLL_REQUEST:
            if (game.user.isGM) return;
            ctx.activePlayerRestApp?.receiveTreeRollRequest?.(data);
            break;

        case SOCKET_TYPES.TREE_ROLL_RESULT:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveTreeRollResult?.(data);
            break;

        case SOCKET_TYPES.CAMP_ROLL_RESULT:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveCampRollResult?.(data);
            break;

        // ── Travel ───────────────────────────────────────────────────
        case SOCKET_TYPES.TRAVEL_DECLARATION:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveTravelDeclaration?.(data);
            break;

        case SOCKET_TYPES.TRAVEL_DECLARATIONS_SYNC:
            if (game.user.isGM) return;
            if (ctx.activePlayerRestApp) {
                const app = ctx.activePlayerRestApp;
                app._syncedTravelDeclarations = data.declarations ?? {};
                app._syncedTravelRolled = data.rolled ?? {};
                app._syncedTravelResolved = data.resolved ?? {};
                if (data.activeDay !== null) app._travelActiveDay = data.activeDay;
                if (data.totalDays !== null) app._travelTotalDays = data.totalDays;
                if (data.scoutingAllowed !== null) app._travelScoutingAllowed = data.scoutingAllowed;
                if (data.forageDC !== null) app._travelForageDC = data.forageDC;
                if (data.huntDC !== null) app._travelHuntDC = data.huntDC;
                if (data.travelGather && typeof data.travelGather === "object") {
                    app._syncedTravelGather = { ...data.travelGather };
                }
                if (!app._playerTravelRolled) app._playerTravelRolled = {};
                for (const [dayKey, actors] of Object.entries(data.rolled ?? {})) {
                    const day = parseInt(dayKey, 10);
                    if (!day) continue;
                    app._playerTravelRolled[day] ??= {};
                    for (const actorId of Object.keys(actors ?? {})) {
                        if (actors[actorId]) app._playerTravelRolled[day][actorId] = true;
                    }
                }
                app.render();
            }
            break;

        case SOCKET_TYPES.TRAVEL_ROLL_REQUEST:
            if (game.user.isGM) return;
            ctx.activePlayerRestApp?.receiveTravelRollRequest?.(data);
            break;

        case SOCKET_TYPES.TRAVEL_ROLL_RESULT:
            if (!game.user.isGM) return;
            ctx.activeRestSetupApp?.receiveTravelRollResult?.(data);
            break;

        case SOCKET_TYPES.TRAVEL_DEBRIEF:
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            if (ctx.activePlayerRestApp) {
                const results = data.results ?? [];
                const declarations = {};
                const confirmed = {};
                const rolled = {};
                for (const row of results) {
                    const day = row.day;
                    const actorId = row.result?.actorId;
                    if (!day || !actorId) continue;
                    declarations[day] ??= {};
                    declarations[day][actorId] = row.activity ?? "nothing";
                    confirmed[day] ??= {};
                    confirmed[day][actorId] = true;
                    rolled[day] ??= {};
                    rolled[day][actorId] = true;
                }
                ctx.activePlayerRestApp.receiveTravelPlayerState?.({
                    debrief: results,
                    declarations: Object.keys(declarations).length ? declarations : null,
                    confirmed: Object.keys(confirmed).length ? confirmed : null,
                    rolled: Object.keys(rolled).length ? rolled : null,
                    fullyResolved: !!data.fullyResolved,
                    scoutingDone: !!data.scoutingDone
                });
            }
            break;

        case SOCKET_TYPES.TRAVEL_INDIVIDUAL_DEBRIEF:
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            if (ctx.activePlayerRestApp) {
                if (data.playerTravel) {
                    ctx.activePlayerRestApp.receiveTravelPlayerState?.(data.playerTravel);
                } else if (data.result) {
                    ctx.activePlayerRestApp.receiveTravelPlayerState?.({
                        debrief: [data.result],
                        declarations: data.result.day != null && data.result.result?.actorId
                            ? { [data.result.day]: { [data.result.result.actorId]: data.result.activity } }
                            : null,
                        confirmed: data.result.day != null && data.result.result?.actorId
                            ? { [data.result.day]: { [data.result.result.actorId]: true } }
                            : null,
                        rolled: data.result.day != null && data.result.result?.actorId
                            ? { [data.result.day]: { [data.result.result.actorId]: true } }
                            : null
                    });
                } else {
                    ctx.activePlayerRestApp.render();
                }
            }
            break;

        // ── AFK / Armor ──────────────────────────────────────────────
        case SOCKET_TYPES.AFK_UPDATE:
            handleAfkUpdate(data);
            break;

        case SOCKET_TYPES.ARMOR_TOGGLE:
            handleArmorToggle(data, ctx);
            break;

        // ── Copy Spell ───────────────────────────────────────────────
        case SOCKET_TYPES.COPY_SPELL_PROPOSAL:
            handleCopySpellProposal(data, ctx);
            break;

        case SOCKET_TYPES.COPY_SPELL_APPROVED:
            if (!game.user.isGM) return;
            CopySpellHandler.handleApproval(data);
            break;

        case SOCKET_TYPES.COPY_SPELL_DECLINED:
            if (!game.user.isGM) return;
            CopySpellHandler.handleDecline(data);
            break;

        case SOCKET_TYPES.COPY_SPELL_ROLL_PROMPT:
            if (game.user.isGM) return;
            CopySpellHandler.handleRollPrompt(data, ctx.activePlayerRestApp);
            break;

        case SOCKET_TYPES.COPY_SPELL_RESULT:
            CopySpellHandler.receiveResult(data, game.user.isGM ? ctx.activeRestSetupApp : ctx.activePlayerRestApp);
            break;

        case SOCKET_TYPES.COPY_SPELL_BUSY:
            if (game.user.isGM) return;
            handleCopySpellBusy(data, ctx);
            break;

        // ── Firewood / Token Sync ────────────────────────────────────
        case SOCKET_TYPES.CONSUME_FIREWOOD:
            if (!game.user.isGM) return;
            handleConsumeFirewood(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_TOKEN_SYNC:
            if (!game.user.isGM) return;
            CampfireTokenLinker.setLightState(data.lit, data.fireLevel ?? null);
            break;

        // ── Campfire minigame (TotM embed) ─────────────────────────────
        case SOCKET_TYPES.CAMPFIRE_STRIKE:
            ctx.activeCampfireEmbed?.receiveStrike?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_STICK:
            ctx.activeCampfireEmbed?.receiveStick?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_POKE:
            ctx.activeCampfireEmbed?.receivePoke?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_TRINKET:
            ctx.activeCampfireEmbed?.receiveTrinket?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_EMOTE:
            ctx.activeCampfireEmbed?.receiveEmote?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_WHITTLE:
            ctx.activeCampfireEmbed?.receiveWhittle?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_WHITTLE_DROP:
            ctx.activeCampfireEmbed?.receiveWhittleDrop?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_PILE_IGNITE:
            ctx.activeCampfireEmbed?.receivePileIgnite?.(data);
            break;

        case SOCKET_TYPES.CAMPFIRE_WHITTLE_SETTLE:
            ctx.activeCampfireEmbed?.receiveWhittleSettle?.(data);
            break;

        case SOCKET_TYPES.TORCH_TOKEN_SYNC:
            if (!game.user.isGM) return;
            TorchTokenLinker.setLightState(data.lit);
            break;

        case SOCKET_TYPES.FORCE_RELOAD:

            Logger.log(`${MODULE_ID} | Received forceReload, refreshing page...`);
            setTimeout(() => window.location.reload(), 200);
            break;

        // ── Short Rest ───────────────────────────────────────────────
        case SOCKET_TYPES.SHORT_REST_STARTED:
            if (game.user.isGM) return;
            if (data.targetUserId && data.targetUserId !== game.user.id) return;
            handleShortRestStarted(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_AFK_UPDATE:
            setCharacterAfk(data.characterId, data.isAfk, "socket", { emitSocket: false });
            break;

        case SOCKET_TYPES.SHORT_REST_PLAYER_FINISHED:
            ctx.activeShortRestApp?.receivePlayerFinished?.(data);
            break;

        case SOCKET_TYPES.SHORT_REST_SONG_VOLUNTEER:
            ctx.activeShortRestApp?.receiveSongVolunteer?.(data);
            break;

        case SOCKET_TYPES.SHORT_REST_CHEF_VOLUNTEER:
            ctx.activeShortRestApp?.receiveChefVolunteer?.(data);
            break;

        case SOCKET_TYPES.SHORT_REST_HD_SPENT:
            ctx.activeShortRestApp?.receiveHdSpent?.(data);
            break;

        case SOCKET_TYPES.SHORT_REST_COMPLETION_SUMMARY:
            if (game.user.isGM) return;
            handleShortRestCompletionSummary(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_COMPLETE:
            if (game.user.isGM) return;
            handleShortRestComplete(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_ABANDONED:
            if (game.user.isGM) return;
            handleShortRestAbandoned(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_DISMISSED:
            if (game.user.isGM) return;
            handleShortRestDismissed(data, ctx);
            break;

        case SOCKET_TYPES.REQUEST_SHORT_REST_STATE:
            if (!game.user.isGM) return;
            handleRequestShortRestState(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_WORKBENCH_STAGING:
            handleShortRestWorkbenchStagingFromPlayer(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_WORKBENCH_SYNC:
            handleShortRestWorkbenchSync(data, ctx);
            break;


        // ── Camp Gear / Stations ─────────────────────────────────────
        case SOCKET_TYPES.CAMP_GEAR_PLACE:
            if (!game.user.isGM) return;
            handleCampGearPlace(data, ctx);
            break;

        case SOCKET_TYPES.CAMP_STATION_PLACE:
            if (!game.user.isGM) return;
            handleCampStationPlace(data, ctx);
            break;

        case SOCKET_TYPES.CAMP_GEAR_CLEAR_PLAYER:
            if (!game.user.isGM) return;
            handleCampGearClearPlayer(data, ctx);
            break;

        case SOCKET_TYPES.CAMP_GEAR_RECLAIM:
            if (!game.user.isGM) return;
            handleCampGearReclaim(data, ctx);
            break;

        case SOCKET_TYPES.CAMP_STATION_RECLAIM:
            if (!game.user.isGM) return;
            handleCampStationReclaim(data, ctx);
            break;

        case SOCKET_TYPES.CAMP_GEAR_PLACED: {
            const campApp = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp;
            if (campApp) {
                void campApp.render();
                campApp.refreshCanvasStationOverlaysIfActivity?.();
                campApp.refreshOpenStationDialogAfterCampGear?.();
            }
            break;
        }

        case SOCKET_TYPES.CAMP_STATION_PLACED: {
            const campAppStation = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp;
            if (campAppStation) {
                void campAppStation.render();
                campAppStation.refreshCanvasStationOverlaysIfActivity?.();
            }
            break;
        }

        case SOCKET_TYPES.CAMP_SCENE_CLEARED: {
            const campApp2 = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp;
            if (data.resetFireLevel && campApp2) {
                campApp2._fireLevel = "unlit";
                campApp2._campFirePreviewLevel = null;
                if (campApp2._engine) {
                    campApp2._engine.fireLevel = "unlit";
                    campApp2._engine.fireRollModifier = 0;
                }
            }
            if (campApp2) campApp2.render();
            break;
        }
    }
}
