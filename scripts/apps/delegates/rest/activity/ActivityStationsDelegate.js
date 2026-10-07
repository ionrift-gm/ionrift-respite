import { Logger } from "../../../../utils/Logger.js";
import { CopySpellHandler } from "../../../../services/crafting/outcomes/CopySpellHandler.js";
import { MealPhaseHandler } from "../../../../services/meal/phase/MealPhaseHandler.js";
import { enqueueProvision } from "../../../../services/meal/buffs/MealBuffBeat.js";
import {
    evaluateDayRations,
    rationSkipLines,
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
    notifyStationMealChoicesUpdated,
    StationActivityDialog
} from "../../../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import {
    getStationsForTerrain,
    buildPartyState,
    isWorkbenchExamineUiEnabled,
    getStationOfferedActivityIds,
    inferCanvasStationForActivity
} from "../../../../data/RestConstants.js";
import { isGearDeployed } from "../../../../services/camp/props/CompoundCampPlacer.js";
import { isSimpleStationsMode } from "../../../../services/rest/flow/RestProfileSettings.js";
import { CraftingPickerApp } from "../../../crafting/CraftingPickerApp.js";
import {
    collectPartyIdentifyEmbedData,
    computeCanShowDetectMagicScanButton,
    computeCanTriggerDetectMagicScan
} from "../../crafting/DetectMagicDelegate.js";
import {
    emitRestSnapshot,
    emitActivityChoice,
    emitCopySpellProposal,
    emitSubmissionUpdate
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { _refreshGmRestIndicator, _refreshRejoinBar } from "../../../../module.js";
import { _noteEngineFreePath } from "../../../rest/RestSetupApp.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { activityFocusAfterCommit, publishCampProgress } from "../../../../services/rest/session/campProgressState.js";
import { getFletchingTierLabel } from "../../../../services/crafting/settings/FletchingSettings.js";

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
            ui.notifications.warn("This character has already submitted their activity.");
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
            ui.notifications.info(`${actor.name}: Training started. Roll your sets in the rest window.`);
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
                    ? (actor.getFlag("ionrift-respite", "travelMishapPenalty") ?? null)
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
                            if (yieldLabel && yieldLabel !== "Off") {
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
            const tier = activityResult.result === "exceptional" ? "Exceptional!"
                : activityResult.result === "success" ? "Success"
                : activityResult.result === "failure_complication" ? "Failed (complication)"
                : activityResult.result === "failure" ? "Failed" : activityResult.result;
            const actName = activity?.name ?? activityId;
            ui.notifications.info(`${actor.name}: ${actName}: ${tier}`);
            if (app.rendered) app.render();
        }

        let mySub = app._playerSubmissions.get(game.user.id) || { choices: {}, userName: game.user.name, timestamp: Date.now() };
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
        ui.notifications.info(`${game.actors.get(characterId)?.name ?? "Character"} will ${actName}.`);

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
                ui.notifications.warn("No character assigned for you in app rest. Ask the GM to check the party roster.");
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
                            ? (game.actors.get(bedrollOwnerActorId)?.name ?? "someone else")
                            : "someone else";
                        ui.notifications.warn(`That bedroll belongs to ${ownerName}.`);
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
                ? { ...station, label: `${actor.name}'s ${station.label}` }
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
                const sat = recipe.outputFlags?.["ionrift-respite"]?.satiates;
                if (Array.isArray(sat) && recipe.output?.name) {
                    lookup.set(recipe.output.name.toLowerCase().trim(), sat);
                }
                const ambSat = recipe.ambitiousOutputFlags?.["ionrift-respite"]?.satiates
                    ?? recipe.outputFlags?.["ionrift-respite"]?.satiates;
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

    async attuneWorkbenchItemForActor(actorId, itemId) {
        const app = this._app;

        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) return;
        const item = actor.items.get(itemId);
        if (!item) return;
        const att = item.system?.attunement;
        if ((att !== "required" && att !== 1) || item.system?.attuned) {
            ui.notifications.warn("That item cannot be attuned here.");
            return;
        }
        const attuneSlots = actor.system?.attributes?.attunement;
        if (attuneSlots) {
            const current = attuneSlots.value ?? 0;
            const max = attuneSlots.max ?? 3;
            if (current >= max) {
                ui.notifications.warn(`${actor.name} is already attuned to the maximum number of items (${max}).`);
                return;
            }
        }
        try {
            await item.update({ "system.attuned": true });
            ui.notifications.info(`${actor.name} attunes to ${item.name}.`);
        } catch (e) {

            console.warn(`${MODULE_ID} | attuneWorkbenchItemForActor:`, e);
            ui.notifications.error("Could not attune that item.");
            return;
        }
        if (app.rendered) app.render();
    
    }

    async submitActivityMealRationsFromStation(actorId) {
        const app = this._app;

        if (!actorId) return;
        _noteEngineFreePath("submitActivityMealRationsFromStation", app);
        const actor = game.actors.get(actorId);
        if (!actor) return;

        if (app._isGM) {
            if (app._activityMealRationsSubmitted?.has(actorId)) return;
            const choice = app._mealChoices?.get(actorId) ?? {};
            const satiatesLookup = this._buildSatiatesLookup();
            const mealRules = restTerrainMealRules(app);
            const owed = evaluateDayRations(actor, choice, mealRules, satiatesLookup);
            const skippedSlots = rationSkipLines(actor, choice, mealRules, satiatesLookup);
            if (skippedSlots.length > 0) {
                const confirmed = await new Promise(resolve => {
                    const overlay = document.createElement("div");
                    overlay.classList.add("ionrift-armor-modal-overlay");
                    overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> Skip Meals?</h3>
                        <p>The following meals are empty:</p>
                        <ul>${skippedSlots.map(s => `<li>${s}</li>`).join("")}</ul>
                        <p>Skipping meals has consequences.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> Skip Meals</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                        </div>
                    </div>`;
                    document.body.appendChild(overlay);
                    overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                        overlay.remove();
                        resolve(true);
                    });
                    overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                        overlay.remove();
                        resolve(false);
                    });
                });
                if (!confirmed) return;
            }

            // Consume items immediately and apply Well Fed buffs
            // (matches inventory consumption path for parity)
            const food = Array.isArray(choice.food) ? [...choice.food] : [];
            const water = Array.isArray(choice.water) ? [...choice.water] : [];
            const essence = Array.isArray(choice.essence) ? [...choice.essence] : [];

            // Snapshot food items before consumption for Well Fed resolution
            const foodSnapshots = new Map();
            for (const itemId of food) {
                if (itemId && itemId !== "skip") {
                    const item = actor.items.get(itemId);
                    if (item) foodSnapshots.set(itemId, item.toObject(false));
                }
            }

            const partyIds = app._mealChoices ? [...app._mealChoices.keys()] : [actorId];
            let foodLeft = owed.foodPerDay;
            for (const itemId of food) {
                if (foodLeft <= 0) break;
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    const snapshot = foodSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        foodLeft--;
                        app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                            actorId, actorName: actor.name, kind: "food", partyIds
                        });
                    }
                }
            }
            const drinkSnapshots = new Map();
            for (const itemId of water) {
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const item = actor.items.get(itemId);
                    if (item) drinkSnapshots.set(itemId, item.toObject(false));
                }
            }
            const waterToConsume = Math.max(0, owed.waterPerDay - owed.bonusWater);
            let waterConsumed = 0;
            for (const itemId of water) {
                if (waterConsumed >= waterToConsume) break;
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    waterConsumed++;
                    const snapshot = drinkSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                            actorId, actorName: actor.name, kind: "drink", partyIds
                        });
                    }
                }
            }
            for (const itemId of essence) {
                if (itemId && itemId !== "skip") {
                    await MealPhaseHandler._consumeItem(actor, itemId, 1);
                }
            }

            // Fold selections into consumedDays so processAndApply won't
            // re-consume them during the meal phase resolution
            const consumedDays = Array.isArray(choice.consumedDays) ? [...choice.consumedDays] : [];
            consumedDays.push({ food, water, essence, bonusWater: owed.bonusWater });
            app._mealChoices.set(actorId, {
                ...choice,
                consumedDays,
                currentDay: consumedDays.length,
                food: [],
                water: [],
                essence: [],
                itemsConsumed: true,
                // Preserve locked slots for UI state
                foodLockedSlots: choice.foodLockedSlots ?? [],
                waterLockedSlots: choice.waterLockedSlots ?? []
            });

            if (!app._activityMealRationsSubmitted) app._activityMealRationsSubmitted = new Set();
            app._activityMealRationsSubmitted.add(actorId);
            app.checkAndAutoMarkCharacterReady?.(actorId);
            await app._saveRestState();
            const snapshot = app.getRestSnapshot();
            if (snapshot) {
                emitRestSnapshot(snapshot);
            }
            notifyStationMealChoicesUpdated();
            if (isStationLayerActive()) {
                refreshStationEmptyNoticeFade(app);
                this._refreshStationOverlayMeals();
            }
            if (app.rendered) app.render();
            _refreshGmRestIndicator(app);
            ui.notifications.info(`${actor.name}: rations recorded for app rest.`);
            return;
        }

        if (!app._myCharacterIds?.has(actorId)) return;
        await app._meals.onSubmitStationMealChoices(actorId);
        app.checkAndAutoMarkCharacterReady?.(actorId);
        notifyStationMealChoicesUpdated();
        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            this._refreshStationOverlayMeals();
        }
        if (app.rendered) app.render();
        _refreshRejoinBar(app);
    
    }

    async unlockSustenance(actorId) {
        const app = this._app;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!app._isGM && !app._myCharacterIds?.has(actorId)) return;

        // 1. Remove character ready state if set
        if (app._finishedActorIds?.has(actorId)) {
            app._finishedActorIds.delete(actorId);
            publishCampProgress(app, {
                finishedActorId: actorId,
                finished: false
            });
        }

        // 2. Remove from submitted set
        if (app._activityMealRationsSubmitted?.has(actorId)) {
            app._activityMealRationsSubmitted.delete(actorId);
        }
        app._mealBuffQueue = (app._mealBuffQueue ?? []).filter(row => row.applied || row.actorId !== actorId);
        if (!app._isGM && app._mealSubmitted) {
            app._mealSubmitted = false;
        }

        // 3. Restore draft state from consumedDays if present
        const choice = app._mealChoices?.get(actorId);
        if (choice && Array.isArray(choice.consumedDays) && choice.consumedDays.length > 0) {
            const consumedDays = [...choice.consumedDays];
            const lastDay = consumedDays.pop();

            // Refund consumed items back to actor inventory if GM consumed them
            if (app._isGM && choice.itemsConsumed) {
                await MealPhaseHandler._removeWellFedEffects(actor);

                for (const itemId of (lastDay.food ?? [])) {
                    if (!itemId || itemId === "skip" || itemId.startsWith("__")) continue;
                    const item = actor.items.get(itemId);
                    if (item) {
                        const uses = item.system?.uses;
                        const isV5 = uses && ("spent" in uses);
                        if (isV5 && typeof uses.spent === "number" && uses.spent > 0) {
                            await item.update({ "system.uses.spent": Math.max(0, uses.spent - 1) });
                        } else if (uses && typeof uses.value === "number" && uses.max > 0) {
                            await item.update({ "system.uses.value": Math.min(uses.max, uses.value + 1) });
                        } else {
                            await item.update({ "system.quantity": (item.system?.quantity ?? 1) + 1 });
                        }
                    }
                }

                for (const itemId of (lastDay.water ?? [])) {
                    if (!itemId || itemId === "skip" || itemId.startsWith("__")) continue;
                    const item = actor.items.get(itemId);
                    if (item) {
                        const uses = item.system?.uses;
                        const isV5 = uses && ("spent" in uses);
                        if (isV5 && typeof uses.spent === "number" && uses.spent > 0) {
                            await item.update({ "system.uses.spent": Math.max(0, uses.spent - 1) });
                        } else if (uses && typeof uses.value === "number" && uses.max > 0) {
                            await item.update({ "system.uses.value": Math.min(uses.max, uses.value + 1) });
                        } else {
                            await item.update({ "system.quantity": (item.system?.quantity ?? 1) + 1 });
                        }
                    }
                }
            }

            app._mealChoices.set(actorId, {
                ...choice,
                consumedDays,
                currentDay: Math.max(0, consumedDays.length),
                food: lastDay.food ?? [],
                water: lastDay.water ?? [],
                essence: lastDay.essence ?? [],
                itemsConsumed: false,
                foodLockedSlots: choice.foodLockedSlots ?? [],
                waterLockedSlots: choice.waterLockedSlots ?? []
            });
        }

        await app._saveRestState?.();
        const snapshot = app.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
        notifyStationMealChoicesUpdated();
        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            this._refreshStationOverlayMeals();
        }
        if (app.rendered) app.render();
        _refreshGmRestIndicator(app);
        _refreshRejoinBar(app);
        ui.notifications.info(`${actor.name}: sustenance unlocked for editing.`);
    }

    _buildActivityDetailContext(selectedCharacter) {
        const app = this._app;

        if (!app._activityDetailId || !selectedCharacter) return null;

        // Find the tile from the selected character's tiles (search both flat and station views)
        const allTiles = [
            ...(selectedCharacter.tileCategories?.flatMap(c => c.tiles) ?? []),
            ...(selectedCharacter.stationCards?.flatMap(s => s.tiles) ?? []),
            ...(selectedCharacter.professionTiles ?? [])
        ];
        const tile = allTiles.find(t => t.id === app._activityDetailId);
        if (!tile) return null;

        const outcomeHints = [];
        if (tile.outcomes?.success?.effects?.length) {
            for (const eff of tile.outcomes.success.effects) {
                outcomeHints.push({ text: eff.description, type: "success" });
            }
        }
        if (tile.outcomes?.exceptional?.effects?.length) {
            for (const eff of tile.outcomes.exceptional.effects) {
                outcomeHints.push({ text: eff.description, type: "exceptional" });
            }
        }
        if (tile.outcomes?.failure?.effects?.length) {
            for (const eff of tile.outcomes.failure.effects) {
                outcomeHints.push({ text: eff.description, type: "failure" });
            }
        }

        let followUpData = null;
        if (tile.followUp) {
            const currentValue = app._getFollowUpForCharacter(selectedCharacter.id)
                ?? app._gmFollowUps?.get(selectedCharacter.id) ?? null;
            followUpData = {
                type: tile.followUp.type,
                label: tile.followUp.label,
                currentValue
            };

            if (tile.followUp.type === "partyMember") {
                const partyActors = getPartyActors().filter(a => a.id !== selectedCharacter.id);
                followUpData.options = partyActors.sort((a, b) => {
                    const aRatio = a.system.attributes?.hp?.value / a.system.attributes?.hp?.max;
                    const bRatio = b.system.attributes?.hp?.value / b.system.attributes?.hp?.max;
                    return aRatio - bRatio;
                }).map(a => {
                    const hp = a.system.attributes?.hp;
                    const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
                    return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
                });
            } else if (tile.followUp.type === "radio" || tile.followUp.type === "select") {
                const selectedVal = currentValue || tile.followUp.default || tile.followUp.options?.[0]?.value;

                // Copy Spell: enrich options with gold awareness
                if (tile.id === "act_scribe") {
                    const actor = game.actors.get(selectedCharacter.id);
                    const currentGold = actor?.system?.currency?.gp ?? 0;
                    followUpData.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;

                    followUpData.options = tile.followUp.options.map(opt => {
                        const cost = parseInt(opt.value, 10) * 50;
                        const canAfford = currentGold >= cost;
                        return {
                            ...opt,
                            label: canAfford ? opt.label : `${opt.label} (can't afford)`,
                            isSelected: opt.value === selectedVal,
                            isDisabled: !canAfford
                        };
                    });
                } else {
                    followUpData.options = tile.followUp.options.map(opt => ({
                        ...opt,
                        isSelected: opt.value === selectedVal
                    }));
                }

                // Safety net: if somehow no option is selected, force-select the first
                if (followUpData.options?.length && !followUpData.options.some(o => o.isSelected)) {
                    followUpData.options[0].isSelected = true;
                }
            } else if (tile.followUp.type === "actorItem" && tile.followUp.filter === "attuneable") {
                const actor = game.actors.get(selectedCharacter.id);
                const attuneItems = (actor?.items ?? []).filter(i => {
                    const att = i.system?.attunement;
                    // Requires attunement but NOT currently attuned
                    return (att === "required" || att === 1) && !i.system?.attuned;
                });
                followUpData.options = attuneItems.map(i => ({
                    value: i.id,
                    label: i.name,
                    isSelected: i.id === currentValue
                }));
                // Attunement slot counter
                const attunement = actor?.system?.attributes?.attunement;
                if (attunement) {
                    const current = attunement.value ?? 0;
                    const max = attunement.max ?? 3;
                    followUpData.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
                }
            }
        }

        // Build armor-aware hint (gated by Xanathar's rest rules setting; omitted for safe rest spot)
        let armorHint = null;
        let armorWarning = null;
        if (!app._effectiveSafeRestSpot()) {
            try {
                const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
                if (armorRuleEnabled) {
                    const actorForHint = game.actors.get(selectedCharacter.id);
                    const equippedArmor = actorForHint?.items?.find(i => i.type === "equipment" && i.system?.equipped && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type));
                    if (equippedArmor && tile.armorSleepWaiver) {
                        armorHint = { text: "Sleeping light between rotations. Armor stays on, weapon close. No HP or HD recovery penalty.", type: "positive" };
                    } else if (equippedArmor && !tile.armorSleepWaiver) {
                        armorHint = { text: "Sleeping in armor. Recover only 1/4 Hit Dice, exhaustion not reduced (Xanathar's). Consider doffing first.", type: "warning" };
                    }
                }
            } catch (e) { /* setting may not exist yet */ }

            const actor = game.actors.get(selectedCharacter.id);
            armorWarning = app.getArmorWarningForActivityDetail(actor, tile);
        }

        return {
            id: tile.id,
            name: tile.name,
            description: tile.description || "No additional details available.",
            icon: tile.icon,
            typeTag: tile.typeTag,
            isCrafting: tile.isCrafting,
            profession: tile.profession,
            check: tile.check ? app._formatCheckLabel(tile.check, selectedCharacter) : null,
            outcomeHints,
            combatModifiers: tile.combatModifiers,
            followUpData,
            armorHint,
            armorWarning,
            characterId: selectedCharacter.id
        };
    
    }

    _buildArmorWarningForActor(a) {
        const app = this._app;

        if (!a) return null;
        if (app._effectiveSafeRestSpot()) return null;
        try {
            const armorDoffEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
            if (!armorDoffEnabled) return null;
            if (!app._doffedArmor) app._doffedArmor = new Map();
            const doffedItemId = app._doffedArmor.get(a.id);

            const equippedArmor = a.itemTypes?.equipment?.find(i =>
                i.system?.equipped && i.system?.type?.value === "heavy"
            ) ?? a.itemTypes?.equipment?.find(i =>
                i.system?.equipped && i.system?.type?.value === "medium"
            );

            if (equippedArmor) {
                const armorType = equippedArmor.system?.type?.value;
                const donTime = armorType === "heavy" ? "10 min" : "5 min";
                return {
                    type: armorType,
                    name: equippedArmor.name,
                    itemId: equippedArmor.id,
                    actorId: a.id,
                    isDoffed: false,
                    donTime,
                    hint: `${equippedArmor.name} (${armorType}) equipped. Don time: ${donTime}.`
                };
            }
            if (doffedItemId) {
                const doffedItem = a.items.get(doffedItemId);
                if (doffedItem) {
                    const armorType = doffedItem.system?.type?.value ?? "medium";
                    const donTime = armorType === "heavy" ? "10 min" : "5 min";
                    return {
                        type: armorType,
                        name: doffedItem.name,
                        itemId: doffedItemId,
                        actorId: a.id,
                        isDoffed: true,
                        donTime,
                        hint: `${doffedItem.name} removed for rest. Better recovery, but vulnerable if attacked. Don time: ${donTime}.`
                    };
                }
            }
            const inventoryArmor = a.itemTypes?.equipment?.find(i =>
                !i.system?.equipped && i.system?.type?.value === "heavy"
            ) ?? a.itemTypes?.equipment?.find(i =>
                !i.system?.equipped && i.system?.type?.value === "medium"
            );
            if (inventoryArmor) {
                const armorType = inventoryArmor.system?.type?.value;
                const donTime = armorType === "heavy" ? "10 min" : "5 min";
                return {
                    type: armorType,
                    name: inventoryArmor.name,
                    itemId: inventoryArmor.id,
                    actorId: a.id,
                    isDoffed: true,
                    donTime,
                    hint: `${inventoryArmor.name} available in inventory. Don time: ${donTime}.`
                };
            }
        } catch (e) { /* setting may not exist yet */ }
        return null;
    
    }

    getCampGearFlavorPanelForActor(actorId) {
        const app = this._app;

        if (!app.isCampfireStationFlavorOnly()) return null;
        const gearCtx = this.getCampGearContextForActor(actorId);
        if (!gearCtx) return null;
        const g = gearCtx;
        const slot = (def) => ({
            gearType: def.gearType,
            title: def.title,
            icon: def.icon,
            actorId: g.actorId,
            isMissing: !def.owned,
            isPlaced: def.owned && def.deployed,
            canDrag: def.owned && def.canDrag,
            isReadonlyOwned: def.owned && !def.canDrag && !def.deployed,
            flavorLine: def.owned ? def.ownedLine : def.missingLine
        });
        return {
            gearSlots: [
                slot({
                    gearType: "bedroll",
                    title: "Bedroll",
                    icon: "fas fa-bed",
                    owned: g.hasBedroll,
                    deployed: g.bedrollDeployed,
                    canDrag: g.canDragBedroll,
                    ownedLine: "Lay out on the map for roleplay.",
                    missingLine: "Not in inventory."
                }),
                slot({
                    gearType: "tent",
                    title: "Tent",
                    icon: "fas fa-campground",
                    owned: g.hasTent,
                    deployed: g.tentDeployed,
                    canDrag: g.canDragTent,
                    ownedLine: "Pitch on the map for roleplay.",
                    missingLine: "Not in inventory."
                }),
                slot({
                    gearType: "messkit",
                    title: g.messKitSource === "utensils" ? "Cook's Utensils" : "Mess kit",
                    icon: g.messKitSource === "utensils" ? "fas fa-mortar-pestle" : "fas fa-utensils",
                    owned: g.hasMessKit,
                    deployed: g.messKitDeployed,
                    canDrag: g.canDragMessKit,
                    ownedLine: "Place on the map for roleplay.",
                    missingLine: "Not in inventory."
                })
            ]
        };
    
    }

    getCampGearContextForActor(actorId) {
        const app = this._app;

        if (app._phase !== "activity" || !actorId) return null;
        const a = game.actors.get(actorId);
        if (!a) return null;
        const items = a.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
        const hasBedroll = items.some(n => n.includes("bedroll"));
        const hasTent = items.some(n => /(?:^|[\s,\-])tent\b/i.test(n));
        const hasActualMessKit = items.some(n => n.includes("mess kit"));
        const hasCooksUtensils = items.some(n => n.includes("cook") && n.includes("utensil"));
        const hasMessKit = hasActualMessKit || hasCooksUtensils;
        /** @type {"messkit"|"utensils"|null} */
        const messKitSource = hasActualMessKit ? "messkit" : (hasCooksUtensils ? "utensils" : null);
        const isOwner = !!a.isOwner;
        const canDragUser = app._isGM || isOwner;
        const fireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
        const tentDeployed = isGearDeployed(a.id, "tent");
        const bedrollDeployed = isGearDeployed(a.id, "bedroll");
        const messKitDeployed = isGearDeployed(a.id, "messkit");
        const hasDeployedCampGear = tentDeployed || bedrollDeployed || messKitDeployed;
        const exhaustionRisk = false;
        const canDragBedroll = canDragUser && hasBedroll && !bedrollDeployed;
        const canDragTent = canDragUser && hasTent && !tentDeployed;
        const canDragMessKit = canDragUser && hasMessKit && !messKitDeployed;
        const canDrag = canDragBedroll || canDragTent || canDragMessKit;
        return {
            actorId: a.id,
            actorName: a.name,
            actorImg: a.img || "icons/svg/mystery-man.svg",
            hasBedroll,
            hasTent,
            hasMessKit,
            messKitSource,
            bedrollDeployed,
            tentDeployed,
            messKitDeployed,
            canDrag,
            canDragBedroll,
            canDragTent,
            canDragMessKit,
            isOwner,
            showClearOwnGear: !app._isGM && isOwner && hasDeployedCampGear,
            fireIsLit,
            exhaustionRisk,
            sceneHasDroppables: hasTent || hasBedroll || hasMessKit,
            messAdvantageOff: hasMessKit && !fireIsLit && exhaustionRisk
        };
    
    }

    onOpenCrafting(event, target) {
        const app = this._app;

        const characterId = target.dataset.characterId || app._selectedCharacterId;
        const profession = target.dataset.profession || app._totmFollowUpExpanded?.profession || "cooking";
        if (!characterId || !profession) return;

        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? null;
        const actor = game.actors.get(characterId);
        if (!actor) return;

        if (app._lockedCharacters?.has(characterId) || app.hasCompletedCrafting(characterId, profession)) {
            const priorResult = app._craftingResults?.get(characterId);
            if (priorResult) {
                const picker = new CraftingPickerApp(
                    actor, profession, app._craftingEngine,
                    () => { if (app.rendered) app.render(); },
                    terrainTag,
                    app._grantLedger,
                    { restApp: app }
                );
                picker._craftingResult = priorResult;
                picker._hasCrafted = true;
                picker.render(true);
                return;
            }
            ui.notifications.warn("This character has already completed crafting for this rest.");
            return;
        }

        if (!app._craftingInProgress) app._craftingInProgress = new Set();
        app._craftingInProgress.add(characterId);
        app._pendingSelections?.delete(characterId);
        if (app.rendered) app.render();

        // Open the standalone crafting picker window
        const picker = new CraftingPickerApp(
            actor, profession, app._craftingEngine,
            (result) => {
                // Completion callback: commit the crafting result
                app._craftingInProgress?.delete(characterId);
                if (!result) {
                    // Crafting cancelled or no result - re-enable selection
                    if (app.rendered) app.render();
                    return;
                }
                app._craftingResults.set(characterId, result);

                // Find the matching crafting activity to record the choice
                const resolver = app._activityResolver;
                const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                    a => a.crafting?.profession === profession
                ) : null;
                const activityId = craftAct?.id ?? `act_cook`;

                app._lockedCharacters = app._lockedCharacters ?? new Set();
                app._lockedCharacters.add(characterId);
                app._totmFollowUpExpanded = null;
                app._characterChoices.set(characterId, activityId);

                if (app._isGM) {
                    app._gmOverrides.set(characterId, activityId);
                    app._rebuildCharacterChoices?.();
                    const submissions = {};
                    for (const [charId, actId] of app._characterChoices) {
                        const act = resolver?.activities?.get(actId);
                        submissions[charId] = {
                            activityId: actId,
                            activityName: act?.name ?? actId,
                            source: app._gmOverrides.has(charId) ? "gm" : "player"
                        };
                    }
                    game.socket.emit(`module.ionrift-respite`, { type: "submissionUpdate", submissions });
                } else {
                    game.socket.emit(`module.ionrift-respite`, {
                        type: "activityChoice",
                        userId: game.user.id,
                        choices: Object.fromEntries(app._characterChoices),
                        craftingResults: { [characterId]: result }
                    });
                    ui.notifications.info(`${actor.name}'s activity submitted.`);
                }
                app._saveRestState?.();
                if (app.rendered) app.render();
            },
            terrainTag,
            app._grantLedger,
            { restApp: app }
        );
        picker.render({ force: true });
    
    }

    _applyAutoOtherWhenSoleActivity() {
        const app = this._app;

        if (app._phase !== "activity" || !app._isGM) return false;

        const forceOtherForAll = isSimpleStationsMode();
        const isTavern = app._isTavernTerrain();
        const partyActors = getPartyActors();
        if (!partyActors.length) return false;

        const restType = app._engine?.restType ?? "long";
        const resolverOpts = app._activityResolverOpts();
        const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
        const safeRestSpot = resolverOpts.safeRestSpot;

        let changed = false;
        for (const actor of partyActors) {
            if (app._characterChoices.has(actor.id)) continue;
            if (app._gmOverrides.has(actor.id)) continue;
            if (app._getPlayerChoiceForCharacter(actor.id)?.activityId) continue;

            const { available } = app._activityResolver.getAvailableActivitiesWithFaded(
                actor, restType, resolverOpts
            );

            let shouldAssign = false;
            if (forceOtherForAll) {
                shouldAssign = available.some(a => a.id === "act_other");
            } else if (isTavern) {
                const offered = getStationOfferedActivityIds(
                    terrainTag,
                    safeRestSpot,
                    new Set(available.map(a => a.id)),
                    { simpleStations: isSimpleStationsMode() }
                );
                shouldAssign = offered.size === 1 && offered.has("act_other");
            } else {
                shouldAssign = available.length === 1 && available[0]?.id === "act_other";
            }

            if (!shouldAssign) continue;

            app._characterChoices.set(actor.id, "act_other");
            app._engine?.registerChoice(actor.id, "act_other", {});
            app._lockedCharacters.add(actor.id);
            if (!app._stationCanvasIdByCharacter) app._stationCanvasIdByCharacter = new Map();
            app._stationCanvasIdByCharacter.set(actor.id, "bedroll");
            changed = true;
        }

        if (!changed) return false;

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = {
                activityId: actId,
                activityName: act?.name ?? actId,
                source: forceOtherForAll || app._gmOverrides.has(charId) ? "gm" : "player"
            };
        }
        emitSubmissionUpdate(submissions);
        _refreshGmRestIndicator(app);

        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        return true;
    
    }

}
