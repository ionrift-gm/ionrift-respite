/**
 * SocketRouter — inbound socket message dispatcher.
 * Extracted from module.js (Phase 2.2).
 *
 * Receives raw socket data and routes to handler functions.
 * Module-scoped mutable state is accessed through a context object
 * passed at wire-up time, avoiding circular imports.
 *
 * @module SocketRouter
 */

import { SOCKET_TYPES } from "./SocketController.js";
import { CopySpellHandler } from "./CopySpellHandler.js";
import { CampfireTokenLinker } from "./CampfireTokenLinker.js";
import { TorchTokenLinker } from "./TorchTokenLinker.js";
import { isMonsterCookingUnlocked } from "../FeatureFlags.mjs";
import * as RestAfkState from "./RestAfkState.js";
import { refreshAfterAfkChange } from "./restSessionAfkEmit.js";
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
    handleShortRestStarted, handleShortRestComplete, handleShortRestAbandoned,
    handleShortRestDismissed, handleRequestShortRestState,
    handleAfkUpdate, handleArmorToggle, handleConsumeFirewood,
    handleCampGearPlace, handleCampStationPlace,
    handleCampGearReclaim, handleCampStationReclaim, handleCampGearClearPlayer,
    showButcherPopup, handleCopySpellProposal, handleCopySpellBusy
} from "./SocketRouterHandlers.js";

const MODULE_ID = "ionrift-respite";

/**
 * @typedef {object} SocketContext
 * @property {object|null} activeRestSetupApp
 * @property {object|null} activePlayerRestApp
 * @property {object|null} activeShortRestApp
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
    console.log(`${MODULE_ID} | Socket received:`, data.type, `isGM=${game.user.isGM}`);

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
            ctx.activePlayerRestApp?.receiveRestSnapshot?.(data.snapshot);
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
            if (ctx.activeRestSetupApp?._runSetCampFireLevelForGm) {
                void ctx.activeRestSetupApp._runSetCampFireLevelForGm(data.fireLevel, data.userId ?? null).catch(err => {
                    console.error(`${MODULE_ID} | campFireLevelRequest:`, err);
                    ui.notifications.error("Could not set fire level. Check the console.");
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.ACTIVITY_FIRE_LEVEL_REQUEST:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?.changeFireLevelDuringActivity) {
                void ctx.activeRestSetupApp.changeFireLevelDuringActivity(data.fireLevel).catch(err => {
                    console.error(`${MODULE_ID} | activityFireLevelRequest:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

        case SOCKET_TYPES.CAMP_LIGHT_FIRE:
            if (!game.user.isGM) return;
            if (ctx.activeRestSetupApp?._campCeremony) {
                void ctx.activeRestSetupApp._campCeremony.lightFire(data.userId, data.actorId, data.method ?? "Tinderbox").catch(err => {
                    console.error(`${MODULE_ID} | campLightFire:`, err);
                });
            } else { ui.notifications.warn("Open the rest session on the GM client first."); }
            break;

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
            const dmApp = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp;
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
            const clrApp = ctx.activeRestSetupApp ?? ctx.activePlayerRestApp;
            if (clrApp) {
                clrApp._magicScanResults = null;
                clrApp._magicScanComplete = false;
                clrApp._workbenchIdentifyStaging?.clear();
                clrApp._workbenchIdentifyAcknowledge?.clear();
                if (clrApp.rendered) void clrApp.render(false);
            }
            Hooks.callAll(`${MODULE_ID}.workbenchIdentifyStagingTouched`);
            notifyDetectMagicScanCleared();
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
                ctx.activePlayerRestApp._syncedTravelDeclarations = data.declarations ?? {};
                if (data.activeDay != null) ctx.activePlayerRestApp._travelActiveDay = data.activeDay;
                if (data.totalDays != null) ctx.activePlayerRestApp._travelTotalDays = data.totalDays;
                if (data.scoutingAllowed != null) ctx.activePlayerRestApp._travelScoutingAllowed = data.scoutingAllowed;
                if (data.forageDC != null) ctx.activePlayerRestApp._travelForageDC = data.forageDC;
                if (data.huntDC != null) ctx.activePlayerRestApp._travelHuntDC = data.huntDC;
                ctx.activePlayerRestApp.render();
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
                if (!ctx.activePlayerRestApp._travelDebrief) ctx.activePlayerRestApp._travelDebrief = [];
                ctx.activePlayerRestApp._travelDebrief.push(...(data.results ?? []));
                ctx.activePlayerRestApp._travelFullyResolved = !!data.fullyResolved;
                ctx.activePlayerRestApp._travelScoutingDone = !!data.scoutingDone;
                ctx.activePlayerRestApp.render();
            }
            break;

        case SOCKET_TYPES.TRAVEL_INDIVIDUAL_DEBRIEF:
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            if (ctx.activePlayerRestApp) {
                if (!ctx.activePlayerRestApp._travelDebrief) ctx.activePlayerRestApp._travelDebrief = [];
                if (data.result) ctx.activePlayerRestApp._travelDebrief.push(data.result);
                ctx.activePlayerRestApp.render();
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

        case SOCKET_TYPES.TORCH_TOKEN_SYNC:
            if (!game.user.isGM) return;
            TorchTokenLinker.setLightState(data.lit);
            break;

        case SOCKET_TYPES.FORCE_RELOAD:
            console.log(`${MODULE_ID} | Received forceReload, refreshing page...`);
            setTimeout(() => window.location.reload(), 200);
            break;

        // ── Short Rest ───────────────────────────────────────────────
        case SOCKET_TYPES.SHORT_REST_STARTED:
            if (game.user.isGM) return;
            if (data.targetUserId && data.targetUserId !== game.user.id) return;
            handleShortRestStarted(data, ctx);
            break;

        case SOCKET_TYPES.SHORT_REST_AFK_UPDATE:
            RestAfkState.applyUpdate(data.characterId, data.isAfk);
            refreshAfterAfkChange();
            break;

        case SOCKET_TYPES.SHORT_REST_PLAYER_FINISHED:
            ctx.activeShortRestApp?.receivePlayerFinished?.(data);
            break;

        case SOCKET_TYPES.SHORT_REST_SONG_VOLUNTEER:
            ctx.activeShortRestApp?.receiveSongVolunteer?.(data);
            break;

        case SOCKET_TYPES.SHORT_REST_HD_SPENT:
            ctx.activeShortRestApp?.receiveHdSpent?.(data);
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

        // ── Monster Cooking ──────────────────────────────────────────
        case SOCKET_TYPES.BUTCHER_PROMPT_POPUP:
            if (game.user.isGM) return;
            if (!isMonsterCookingUnlocked()) return;
            showButcherPopup(data);
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
