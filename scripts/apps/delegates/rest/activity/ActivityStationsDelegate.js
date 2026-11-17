import { ActivityStationsDetailMethods } from "./ActivityStationsDetailHelper.js";
import { Logger } from "../../../../utils/Logger.js";
import { CopySpellHandler } from "../../../../services/crafting/outcomes/CopySpellHandler.js";
import { MealPhaseHandler } from "../../../../services/meal/phase/MealPhaseHandler.js";
import {
    evaluateDayRations,
    restTerrainMealRules,
    restTerrainTag
} from "../../../../services/meal/phase/RationNeed.js";
import {
    activateStationLayer,
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationDetectMagicGlow,
    refreshStationMealPortraits,
    refreshStationPortraitsFromChoices,
    resetStationOverlaysLocal,
    setStationPlayerState
} from "../../../../services/camp/props/StationInteractionLayer.js";
import {
    refreshOpenStationDialog,
    StationActivityDialog
} from "../../../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import {
    getStationsForTerrain,
    buildPartyState,
    isWorkbenchExamineUiEnabled,
    inferCanvasStationForActivity
} from "../../../../data/RestConstants.js";
import { isSimpleStationsMode } from "../../../../services/rest/flow/RestProfileSettings.js";
import {
    collectPartyIdentifyEmbedData,
    computeCanShowDetectMagicScanButton,
    computeCanTriggerDetectMagicScan
} from "../../crafting/DetectMagicDelegate.js";
import {
    emitActivityChoice,
    emitCopySpellProposal
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { _refreshGmRestIndicator, _refreshRejoinBar } from "../../../../module.js";
import { _noteEngineFreePath } from "../../../rest/RestSetupApp.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { activityFocusAfterCommit } from "../../../../services/rest/session/campProgressState.js";
import { getFletchingTier, getFletchingTierLabel } from "../../../../services/crafting/settings/FletchingSettings.js";

export class ActivityStationsDelegate {
    constructor(app) {
        this._app = app;
    }

    async finalizeActivityChoiceFromStation(characterId, activityId, canvasStationId = null, options = {}) {
        const app = this._app;

        if (!characterId || !activityId) return null;
        if (activityId === "act_forage" || activityId === "act_hunt") {
            await app._totm?.selectGatherChoice?.(characterId, activityId);
            return { source: "gather", activityId };
        }
        if (app._craftingInProgress?.has(characterId)) return null;

        // Look up activity from the resolver, then fall back to known crafting IDs
        const CRAFTING_PROFESSIONS = { act_cook: "cooking", act_brew: "brewing" };
        const activity = app._activityResolver?.activities?.get(activityId);
        const craftingProfession = activity?.crafting?.profession ?? CRAFTING_PROFESSIONS[activityId];
        const isCrafting = !!(activity?.crafting?.enabled || craftingProfession);

        if (!isCrafting && (app._lockedCharacters?.has(characterId) || app.hasCompletedCrafting?.(characterId))) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.activityStations.alreadySubmitted"));
            return null;
        }

        if (isCrafting) {
            const syntheticTarget = { dataset: { characterId, profession: craftingProfession } };
            app.openCraftingDrawer(null, syntheticTarget);
            return { source: "activity", activityId, result: "crafting_redirect" };
        }

        app._characterChoices.set(characterId, activityId);
        app._lockedCharacters.add(characterId);
        app._pendingSelections?.delete(characterId);

        const actor = game.actors.get(characterId);
        let activityResult = null;

        if (activityId === "act_scribe" && actor) {
            const followUpValue = options.followUpValue ?? app._gmFollowUps?.get(characterId) ?? app._getFollowUpForCharacter(characterId);
            const spellLevel = parseInt(followUpValue, 10) || 1;
            const cost = spellLevel * 50;
            const dc = 10 + spellLevel;

            if (game.user.isGM) {
                CopySpellHandler.sendProposal(characterId, spellLevel);
            } else {
                emitCopySpellProposal({
                    actorId: characterId,
                    actorName: actor.name,
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });
            }

            activityResult = {
                source: "activity",
                activityId,
                result: "pending_approval",
                narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
            };
            app._earlyResults.set(characterId, activityResult);
            if (app.rendered) app.render();
        } else if (activityId === "act_train" && actor && app._engine) {
            app._initTrainingState(characterId, activityId, actor);
            ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.trainingStarted", { actor: actor.name }));
            if (app.rendered) app.render();
        } else if (actor && (app._engine || app._activityResolver)) {
            const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? app._selectedTerrain ?? "forest";
            const comfort = app._engine?.comfort ?? app._restData?.comfort ?? "rough";
            const safeRestSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot);
            const followUpValue = options.followUpValue ?? app._gmFollowUps?.get(characterId) ?? app._getFollowUpForCharacter?.(characterId);

            const checkDetails = app._activityResolver?.getCheckDetails?.(activityId, actor, comfort, {
                followUpValue,
                safeRestSpot
            });

            let rollTotal = null;
            if (checkDetails) {
                const travelPenalty = typeof actor.getFlag === "function"
                    ? (actor.getFlag(MODULE_ID, "travelMishapPenalty") ?? null)
                    : null;
                const hadTravelDis = travelPenalty === "activity_disadvantage";
                const rollMode = checkDetails.rollAdvantage && hadTravelDis
                    ? "normal"
                    : (hadTravelDis ? "disadvantage" : (checkDetails.rollAdvantage ? "advantage" : "normal"));

                const rollRequestFn = game.ionrift?.library?.rollRequest?.request;
                if (typeof rollRequestFn === "function") {
                    try {
                        const actName = checkDetails.activity?.name ?? "Activity";
                        let flavor = `${actName} Check (DC ${checkDetails.adjustedDc})`;
                        if (activityId === "act_fletch") {
                            const yieldLabel = getFletchingTierLabel();
                            const kind = followUpValue === "bolts" ? "bolts" : "arrows";
                            if (yieldLabel && getFletchingTier() > 0) {
                                flavor = `Pass DC ${checkDetails.adjustedDc}. Then roll ${yieldLabel} for how many ${kind}.`;
                            }
                        }
                        const reqResult = await rollRequestFn({
                            actorId: actor.id,
                            actorUuid: actor.uuid,
                            type: checkDetails.type,
                            key: checkDetails.key,
                            dc: checkDetails.adjustedDc,
                            rollMode,
                            title: actName,
                            flavor
                        });
                        rollTotal = reqResult?.total ?? null;
                    } catch (err) {
                        if (err?.code === "dismissed" || err?.message === "declined" || err?.message?.includes?.("dismissed")) {
                            app._characterChoices.delete(characterId);
                            app._lockedCharacters.delete(characterId);
                            if (app.rendered) app.render();
                            return null;
                        }
                        Logger.warn("ActivityStationsDelegate", "Roll request rejected or failed:", err);
                    }
                }
            }

            activityResult = await app._activityResolver.resolve(
                activityId, actor, terrainTag, comfort, {
                    rollTotal,
                    preEvaluated: Number.isFinite(rollTotal),
                    followUpValue,
                    safeRestSpot
                }
            );
            app._earlyResults.set(characterId, activityResult);
            const tier = activityResult.result === "exceptional" ? game.i18n.localize("ionrift-respite.activityStations.tierExceptional")
                : activityResult.result === "success" ? game.i18n.localize("ionrift-respite.activityStations.tierSuccess")
                : activityResult.result === "failure_complication" ? game.i18n.localize("ionrift-respite.activityStations.tierFailedComplication")
                : activityResult.result === "failure" ? game.i18n.localize("ionrift-respite.activityStations.tierFailed") : activityResult.result;
            const actName = activity?.name ?? activityId;
            ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.resultNotification", { actor: actor.name, activity: actName, tier }));
            if (app.rendered) app.render();
        }

        const mySub = app._playerSubmissions.get(game.user.id) || { choices: {}, userName: game.user.name, timestamp: Date.now() };
        mySub.choices[characterId] = activityId;
        app._playerSubmissions.set(game.user.id, mySub);
        app.checkAndAutoMarkCharacterReady?.(characterId);
        app._saveRestState();

        const followUps = {};
        for (const [cid] of app._characterChoices) {
            const fu = app._gmFollowUps?.get(cid);
            if (fu !== null && fu !== undefined) followUps[cid] = fu;
        }
        emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(app._characterChoices),
                    null,
                    Object.keys(followUps).length ? followUps : null,
                    app._earlyResults?.size ? Object.fromEntries(app._earlyResults) : null
                );

        const actName = activity?.name ?? activityId;
        ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.willDoActivity", { actor: game.actors.get(characterId)?.name ?? game.i18n.localize("ionrift-respite.common.characterFallback"), activity: actName }));

        if (canvasStationId) {
            app._stationCanvasIdByCharacter.set(characterId, canvasStationId);
            setStationPlayerState(characterId, canvasStationId, app._characterChoices, app._stationCanvasIdByCharacter);
        } else {
            app._stationCanvasIdByCharacter.delete(characterId);
        }

        app._updateRestBarProgress();
        _refreshRejoinBar(app);

        // Station canvas advances to the next unchosen member so the overlays
        // show who still needs to pick. The one-window rest stays put: jumping
        // here reopens gather and the activity cards for someone else.
        app._selectedCharacterId = activityFocusAfterCommit({
            isGM: app._isGM,
            isTotM: app._isTotM,
            phase: app._phase,
            partyIds: getPartyActors().map(actor => actor.id),
            choices: app._characterChoices,
            currentId: app._selectedCharacterId
        });

        if (app._phase === "activity" && isStationLayerActive()) {
            resetStationOverlaysLocal();
            refreshStationEmptyNoticeFade(app);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            this._refreshStationOverlayMeals();
        }

        if (!app._isGM && app._phase === "activity") {
            app._postStationChoiceReview = true;
            app._stationReviewCharacterId = characterId;
            app._activitySubTab = "activity";
            app._activitySubTabUserSet = true;
            app._selectedCharacterId = characterId;
            app._activityDetailId = null;
            // Do NOT force-open the window ,  the player chose from the canvas and
            // should stay there. State is staged so the review panel shows when
            // they voluntarily resume via the footer bar.
            if (app.rendered) app.render();
        } else if (app.rendered) {
            app.render();
        }

        return activityResult;
    
    }

    _refreshStationOverlayForFocusChange() {
        const app = this._app;

        if (app._phase !== "activity" || !isStationLayerActive()) return;
        const partyActors = getPartyActors();
        const viewer = this._resolveStationActorForUser(partyActors, app);
        const choices = app._characterChoices;
        if (!(choices instanceof Map)) return;

        resetStationOverlaysLocal();
        refreshStationEmptyNoticeFade(app);
        this._refreshStationOverlayMeals();

        if (game.user.isGM) {
            refreshStationPortraitsFromChoices(choices, app._stationCanvasIdByCharacter);
            return;
        }
        const vid = viewer?.id;
        if (vid && viewer.isOwner && choices.has(vid)) {
            const actId = choices.get(vid);
            const sid = app._stationCanvasIdByCharacter.get(vid)
                ?? inferCanvasStationForActivity(actId, vid);
            setStationPlayerState(vid, sid, choices, app._stationCanvasIdByCharacter);
        } else {
            refreshStationPortraitsFromChoices(choices, app._stationCanvasIdByCharacter);
        }
    
    }

    _actorOwesActivityPhaseMealRations(actorId) {
        const app = this._app;

        _noteEngineFreePath("_actorOwesActivityPhaseMealRations", app);
        if (!actorId || !game.settings.get(MODULE_ID, "trackFood") || app._phase !== "activity") {
            return false;
        }
        const card = this.getStationMealCardForActor(actorId);
        if (!card || card.playerSubmitted) return false;
        const owed = evaluateDayRations(game.actors.get(actorId), {}, restTerrainMealRules(app));
        if (owed.foodPerDay <= 0 && owed.waterPerDay <= 0) return false;
        return true;
    
    }

    _buildStationEmptyNoticeMap() {
        const app = this._app;

        const map = {};
        const partyActors = getPartyActors();
        if (!app._activityResolver) return map;

        const restType = app._engine?.restType ?? "long";
        const fireLevel = app._fireLevel ?? "unlit";
        const isFireLit = !!(app._fireLevel && app._fireLevel !== "unlit");
        const safeRestSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot);
        const choices = app._characterChoices;
        const unchosen = partyActors.filter(a => a?.id && !choices?.has(a.id));

        // For GM: any unchosen party member who owes rations keeps the cooking station bright.
        // For players: only the viewer's own actor matters ,  other players' ration debts are
        // opaque to app client and must not hold the station bright after the viewer has eaten.
        // Bug history: before app fix, mealBrightParty evaluated ALL unchosen actors,
        // keeping the cooking station bright on the submitting player's client because the
        // other players hadn't submitted yet ,  even when app player had no remaining ration debt.
        const viewer = this._resolveStationActorForUser(partyActors, app);
        let mealBrightParty;
        if (app._isGM) {
            mealBrightParty = unchosen.some(a => this._actorOwesActivityPhaseMealRations(a.id));
        } else {
            mealBrightParty = !!viewer
                && unchosen.some(a => a.id === viewer.id)
                && this._actorOwesActivityPhaseMealRations(viewer.id);
        }

        Logger.log(
            `viewer=${viewer?.name ?? "none"}`,
            `isGM=${app._isGM}`,
            `unchosenCount=${unchosen.length}`
        );

        const hasAvailableAtStation = (actor, stationIdSet) => {
            const { available: allAvail } = app._activityResolver.getAvailableActivitiesWithFaded(
                actor, restType, app._activityResolverOpts({ isFireLit, fireLevel })
            );
            return allAvail.some(a => stationIdSet.has(a.id));
        };

        const terrainStationsForMap = getStationsForTerrain(app._selectedTerrain ?? app._engine?.terrainTag ?? "forest", safeRestSpot);

        if (viewer && app._characterChoices.has(viewer.id)) {
            for (const station of terrainStationsForMap) {
                if (!station.furnitureKey) continue;
                if (station.id === "workbench") {
                    map[station.id] = false;
                    continue;
                }
                if ((station.id === "cooking_station" || station.id === "campfire")
                    && this._actorOwesActivityPhaseMealRations(viewer.id)) {
                    map[station.id] = false;
                    continue;
                }
                // One major activity per rest: the station dialog offers no further picks for
                // app actor (lists cleared), even when the raw resolver would still return some.
                map[station.id] = true;
            }
            map.bedroll = true;
            return map;
        }

        for (const station of terrainStationsForMap) {
            if (!station.furnitureKey) continue;
            const stationIds = new Set(station.activities ?? []);

            const hasAny = unchosen.some(a => hasAvailableAtStation(a, stationIds));
            let empty = !hasAny;
            if (empty && mealBrightParty && station.id === "cooking_station") {
                empty = false;
            }
            if (station.id === "workbench" && isWorkbenchExamineUiEnabled()) {
                empty = false;
            }
            map[station.id] = empty;
        }

        const bedrollStation = terrainStationsForMap.find(s => s.id === "bedroll");
        if (bedrollStation) {
            const stationIds = new Set(bedrollStation.activities ?? []);
            map.bedroll = !unchosen.some(a => hasAvailableAtStation(a, stationIds));
        }

        if (app._phase === "activity") {
            map.campfire = false;
        }

        return map;
    
    }

    _refreshStationOverlayMeals() {
        const app = this._app;

        if (isStationLayerActive()) refreshStationMealPortraits(app);
    
    }

    _getPendingMealCanvasPlan() {
        const app = this._app;

        _noteEngineFreePath("_getPendingMealCanvasPlan", app);
        const empty = { stationId: null, urls: [] };
        if (!game.settings.get(MODULE_ID, "trackFood") || app._phase !== "activity") {
            return empty;
        }
        const urls = [];
        for (const actor of getPartyActors()) {
            if (!this._actorOwesActivityPhaseMealRations(actor.id)) continue;
            urls.push(actor.img ?? "icons/svg/mystery-man.svg");
        }
        if (!urls.length) return empty;

        const hasCooking = canvas?.ready && canvas.tokens.placeables.some(t => {
            const f = t.document.flags?.[MODULE_ID];
            return f?.isCampFurniture && f?.furnitureKey === "cookingArea";
        });
        const stationId = hasCooking ? "cooking_station" : "campfire";
        return { stationId, urls };
    
    }

    _activateCanvasStationLayer() {
        const app = this._app;

        if (app._isTotM) return;
        if (!canvas?.ready) return;
        // Make Camp pit dialog is camp-phase only; close any stray instance before activity station UI.
        CampfireMakeCampDialog.closeIfOpen();

        const partyActors = getPartyActors();
        const actorMap = {};
        for (const actor of partyActors) {
            const items = actor.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
            const hasBedroll = items.some(n => n.includes("bedroll"));
            const sceneToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            actorMap[actor.id] = {
                hasBedroll,
                assignedTokenId: sceneToken?.id ?? null
            };
        }

        const restSession = {
            fireLevel: app._fireLevel,
            restType:  app._engine?.restType
                ?? app._selectedRestType
                ?? app._restData?.restType
                ?? "long"
        };
        /* restSession.fireLevel is refreshed on each station click; the object is created once
         * when the layer activates and would otherwise keep the tier from that moment only. */

        const proximityOpts = app._isGM
            ? {
                getProximityActorId: () => {
                    const roster = getPartyActors();
                    const a = this._resolveStationActorForUser(roster, app);
                    return a?.id ?? null;
                }
            }
            : {};

        const stationEmptyNoticeFade = this._buildStationEmptyNoticeMap();

        activateStationLayer(actorMap, async (stationId, token) => {
            const roster = getPartyActors();
            const actor = this._resolveStationActorForUser(roster, app);
            if (!actor) {

                console.warn(`${MODULE_ID} | Station click: no party actor for app user (assign a character or fix roster)`, {
                    userId: game.user.id,
                    partyIds: roster.map(a => a.id)
                });
                ui.notifications.warn(game.i18n.localize("ionrift-respite.activityStations.noCharacterAssigned"));
                return;
            }
            const terrainTagForStation = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const safeSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot);
            const effectiveStations = getStationsForTerrain(terrainTagForStation, safeSpot);
            const station = effectiveStations.find(s => s.id === stationId);
            if (!station) return;

            const tokenFlags = token?.document?.flags?.[MODULE_ID];
            const isSharedBedroll = tokenFlags?.furnitureKey === "sharedBedroll";

            if (stationId === "bedroll" && !isSharedBedroll) {
                const bedrollOwnerActorId = tokenFlags?.ownerActorId;
                if (bedrollOwnerActorId !== actor.id) {
                    if (!game.user.isGM) {
                        const ownerName = bedrollOwnerActorId
                            ? (game.actors.get(bedrollOwnerActorId)?.name ?? game.i18n.localize("ionrift-respite.activityStations.someoneElse"))
                            : game.i18n.localize("ionrift-respite.activityStations.someoneElse");
                        ui.notifications.warn(game.i18n.format("ionrift-respite.activityStations.bedrollBelongsTo", { owner: ownerName }));
                    }
                    return;
                }
            }

            if (stationId === "campfire" && isSimpleStationsMode()) {
                return;
            }

            Logger.log(`${MODULE_ID} | Station overlay click`, { stationId, actorId: actor.id, tokenId: token?.id });
            app._canvasFocusedStationId = stationId;
            app._activitySubTab = "activity";

            restSession.fireLevel = app._fireLevel ?? "unlit";
            restSession.restType = app._engine?.restType
                ?? app._selectedRestType
                ?? app._restData?.restType
                ?? "long";

            const dialogStation = (stationId === "bedroll" && !isSharedBedroll)
                ? { ...station, label: game.i18n.format("ionrift-respite.activityStations.actorsStationLabel", { actor: actor.name, label: station.label }) }
                : station;

            try {
                const restType = restSession.restType ?? "long";
                const fireLevel = app._fireLevel ?? restSession.fireLevel ?? "unlit";
                const isFireLit = !!(fireLevel && fireLevel !== "unlit");
                const resolverLoaded = !!(app._activityResolver?.activities?.size);
                const resolvedAvail = resolverLoaded
                    ? app._activityResolver.getAvailableActivitiesWithFaded(actor, restType, app._activityResolverOpts({ isFireLit, fireLevel }))
                    : { available: [], faded: [] };
                const stationActIds = new Set(station.activities ?? []);
                await StationActivityDialog.openForStation(
                    dialogStation, actor, app._activityResolver, restSession, token, app, stationId
                );
            } catch (e) {

                console.warn(`${MODULE_ID} | Station activity dialog`, e);
            }
        }, {
            ...proximityOpts,
            stationEmptyNoticeFade,
            terrainTag: app._selectedTerrain ?? app._engine?.terrainTag ?? "forest",
            onLayerReady: () => {
                this._refreshStationOverlayMeals();
                refreshStationDetectMagicGlow(app);
                if (app._characterChoices?.size) {
                    refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
                    refreshStationEmptyNoticeFade(app);
                }
            }
        });

        app._installGmStationTokenSyncHook();
    
    }

    refreshCanvasStationOverlaysIfActivity() {
        const app = this._app;

        if (app._phase !== "activity") return;
        if (app._isTotM) return;
        if (canvas?.ready) {
            this._activateCanvasStationLayer();
        } else {
            Hooks.once("canvasReady", () => {
                if (app._phase === "activity") this._activateCanvasStationLayer();
            });
        }
    
    }

    refreshOpenStationDialogAfterCampGear() {
        const app = this._app;

        void refreshOpenStationDialog();
    
    }

    static resolveStationActorForUser(partyActors, restApp = null) {
        const inParty = (a) => a && partyActors.some(p => p.id === a.id);

        if (game.user?.isGM && restApp) {
            const fromTok = canvas.tokens?.controlled?.[0]?.actor;
            if (fromTok?.type === "character" && inParty(fromTok)) return fromTok;
            if (restApp._selectedCharacterId) {
                const sel = game.actors.get(restApp._selectedCharacterId);
                if (sel?.type === "character" && inParty(sel)) return sel;
            }
        }

        const assigned = game.user?.character;
        if (assigned && partyActors.some(a => a.id === assigned.id) && assigned.isOwner) {
            return assigned;
        }
        const owned = partyActors.filter(a => a.isOwner);
        if (owned.length === 1) return owned[0];
        if (owned.length > 1) {
            const fromToken = canvas.tokens?.controlled?.[0]?.actor;
            if (fromToken && owned.some(a => a.id === fromToken.id)) return fromToken;
            return owned[0];
        }
        const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
        const playable = partyActors.find(a => a.testUserPermission(game.user, OBS));
        return playable ?? null;
    }

    _resolveStationActorForUser(partyActors, restApp = null) {
        return ActivityStationsDelegate.resolveStationActorForUser(partyActors, restApp);
    }

    _rebuildCharacterChoices() {
        const app = this._app;

        app._characterChoices.clear();

        for (const [userId, submission] of app._playerSubmissions) {
            if (!submission?.choices || typeof submission.choices !== "object") continue;
            for (const [charId, actId] of Object.entries(submission.choices)) {
                app._characterChoices.set(charId, actId);
            }
        }

        for (const [charId, actId] of app._gmOverrides) {
            app._characterChoices.set(charId, actId);
        }
    
    }

    getPartyStateForAdvisory() {
        const app = this._app;

        const partyActors = getPartyActors();
        const _currentDC = app._engine?.getEffectiveEncounterDC?.({ earlyResults: app._earlyResults }) ?? 15;
        // Merge confirmed choices, GM overrides, and pending selections into one view.
        // Pending wins over confirmed (latest player intent); GM overrides win over both.
        const allSelections = new Map([
            ...(app._characterChoices ?? []),
            ...(app._pendingSelections ?? []),
            ...(app._gmOverrides ?? []),
        ]);
        return buildPartyState(partyActors, allSelections, _currentDC, app._engine?.comfort);
    
    }

    getStationMealCardForActor(actorId) {
        const app = this._app;

        if (!actorId || !game.settings.get(MODULE_ID, "trackFood")) return null;
        // Players don't have a RestFlowEngine ,  derive terrainTag from snapshot state instead.
        const terrainTag = restTerrainTag(app);
        const terrainMealRules = restTerrainMealRules(app);
        const cards = MealPhaseHandler.buildMealContext(
            [actorId],
            terrainTag,
            terrainMealRules,
            app._daysSinceLastRest ?? 1,
            app._mealChoices ?? new Map(),
            this._buildSatiatesLookup()
        );
        const card = cards[0] ?? null;
        if (!card) return null;
        if (app._activityMealRationsSubmitted?.has(actorId)) card.playerSubmitted = true;
        if (!app._isGM && app._mealSubmitted && app._meals._mealObligatedOwnedCharacterIds(app).has(actorId)) {
            card.playerSubmitted = true;
        }
        return card;
    
    }

    _buildSatiatesLookup() {
        const app = this._app;

        const engine = app._craftingEngine;
        if (!engine?.recipes?.size) return null;
        const lookup = new Map();
        for (const recipes of engine.recipes.values()) {
            for (const recipe of recipes) {
                const sat = recipe.outputFlags?.[MODULE_ID]?.satiates;
                if (Array.isArray(sat) && recipe.output?.name) {
                    lookup.set(recipe.output.name.toLowerCase().trim(), sat);
                }
                const ambSat = recipe.ambitiousOutputFlags?.[MODULE_ID]?.satiates
                    ?? recipe.outputFlags?.[MODULE_ID]?.satiates;
                if (Array.isArray(ambSat) && recipe.ambitiousOutput?.name) {
                    lookup.set(recipe.ambitiousOutput.name.toLowerCase().trim(), ambSat);
                }
            }
        }
        return lookup.size ? lookup : null;
    
    }

    _autoTrimExcessWater(charId) {
        const app = this._app;

        if (!app._mealChoices) return;
        const choice = app._mealChoices.get(charId);
        if (!choice) return;
        const actor = game.actors.get(charId);
        if (!actor) return;

        const satiatesLookup = this._buildSatiatesLookup();
        const owed = evaluateDayRations(actor, choice, restTerrainMealRules(app), satiatesLookup);
        if (owed.bonusWater <= 0) return;
        const manualNeeded = Math.max(0, owed.waterPerDay - owed.bonusWater);

        const waterArr = Array.isArray(choice.water) ? [...choice.water] : [];
        const lockedSlots = Array.isArray(choice.waterLockedSlots) ? choice.waterLockedSlots : [];

        // Count filled non-locked water entries
        const filledNonLocked = waterArr.reduce((n, v, i) => {
            if (lockedSlots.includes(i)) return n;
            return (v && v !== "skip" && !v.startsWith?.("__")) ? n + 1 : n;
        }, 0);
        if (filledNonLocked <= manualNeeded) return;

        // Trim excess from the end
        let toRemove = filledNonLocked - manualNeeded;
        for (let i = waterArr.length - 1; i >= 0 && toRemove > 0; i--) {
            if (lockedSlots.includes(i)) continue;
            if (waterArr[i] && waterArr[i] !== "skip" && !waterArr[i].startsWith?.("__")) {
                waterArr[i] = "skip";
                toRemove--;
            }
        }
        app._mealChoices.set(charId, { ...choice, water: waterArr });
    
    }

    getStationIdentifyEmbedContext(options = {}) {
        const app = this._app;

        return collectPartyIdentifyEmbedData(getPartyActors(), options);
    
    }

    canShowDetectMagicScanButtonFromParty() {
        const app = this._app;

        return computeCanShowDetectMagicScanButton(getPartyActors());
    
    }

    canTriggerDetectMagicScanFromParty() {
        const app = this._app;

        return computeCanTriggerDetectMagicScan(getPartyActors());
    
    }

    async attuneWorkbenchItemForActor(actorId, itemId) { return ActivityStationsDetailMethods.attuneWorkbenchItemForActor.call(this, actorId, itemId); }
    async submitActivityMealRationsFromStation(actorId) { return ActivityStationsDetailMethods.submitActivityMealRationsFromStation.call(this, actorId); }
    async unlockSustenance(actorId) { return ActivityStationsDetailMethods.unlockSustenance.call(this, actorId); }
    _buildActivityDetailContext(selectedCharacter) { return ActivityStationsDetailMethods._buildActivityDetailContext.call(this, selectedCharacter); }
    _buildArmorWarningForActor(a) { return ActivityStationsDetailMethods._buildArmorWarningForActor.call(this, a); }
    getCampGearFlavorPanelForActor(actorId) { return ActivityStationsDetailMethods.getCampGearFlavorPanelForActor.call(this, actorId); }
    getCampGearContextForActor(actorId) { return ActivityStationsDetailMethods.getCampGearContextForActor.call(this, actorId); }
    onOpenCrafting(event, target) { return ActivityStationsDetailMethods.onOpenCrafting.call(this, event, target); }
    _applyAutoOtherWhenSoleActivity() { return ActivityStationsDetailMethods._applyAutoOtherWhenSoleActivity.call(this); }
}