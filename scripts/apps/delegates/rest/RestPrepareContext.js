import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { CRAFT_PROFESSION_LABELS } from "../../../services/crafting/engine/CraftRecipeListBuilder.js";
import { MonstrousFeastBridge } from "../../../services/meal/provisions/MonstrousFeastBridge.js";
import { isTentItem } from "../../../services/camp/gear/CampGearScanner.js";
import { hasCampPlaced } from "../../../services/camp/props/CompoundCampPlacer.js";
import { ImageResolver } from "../../../utils/ImageResolver.js";
import { RestPresentationHelper } from "../../../utils/RestPresentationHelper.js";
import { RestDockContext } from "../../../utils/RestDockContext.js";
import { WEATHER_TABLE, SHELTER_SPELLS, isWorkbenchIdentifyUiEnabled, matchesShelterSpell, getStationOfferedActivityIds } from "../../../data/RestConstants.js";
import { isComfortEnabled } from "../../../services/camp/gear/ComfortCalculator.js";
import { isSimpleStationsMode, isCampfireMinigameEnabled } from "../../../services/rest/flow/RestProfileSettings.js";
import { isForagingEnabled, isHuntingEnabled } from "../../../services/travel/settings/TravelSettings.js";
import { buildActivityDetailContext } from "../../crafting/ActivityDetailBuilder.js";
import { closeStationDialogIfDifferentActor } from "../../camp/StationActivityDialog.js";
import { buildCopySpellRollContext } from "../../../services/ui/rollRequest/RollRequestView.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { dailyChoiceStatus } from "../../../services/rest/session/campProgressState.js";
import { canGmProceedFromActivity, partyFullyReady } from "../../../services/rest/session/activityProceedGate.js";
import { buildGatherPanel, buildActivityCommit, phaseProceedHeld, buildMealCommit } from "./RestPrepareCommitHelpers.js";
import { buildCharacterStatuses, buildTotmStationCards, buildRosterAndOverview, buildResolvePhaseSummaries } from "./RestPrepareActivityContext.js";
import { buildMakeCampContext, buildCampStatusAndEncounterBar } from "./RestPrepareCampContext.js";
import { buildEventsPhaseContext, buildMealPhaseContext } from "./RestPrepareEventsAndMealContext.js";

function computePartyOnlyFreeTime(app, partyActors) {
    if (!partyActors?.length || !app._activityResolver?.activities?.size) return false;
    if (!["activity", "meal"].includes(app._phase)) return false;
    const restType = app._engine?.restType ?? "long";
    const resolverOpts = app._activityResolverOpts?.() ?? {};
    const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
    const safeRestSpot = Boolean(resolverOpts.safeRestSpot);
    const nonActivityStepIds = new Set(["act_forage", "act_hunt", "act_identify"]);

    for (const actor of partyActors) {
        const { available, faded } = app._activityResolver.getAvailableActivitiesWithFaded(
            actor, restType, resolverOpts
        );
        const stepIds = new Set(
            [...available, ...faded]
                .map(a => a?.id)
                .filter(id => id && !nonActivityStepIds.has(id))
        );
        const offered = getStationOfferedActivityIds(
            terrainTag,
            safeRestSpot,
            stepIds,
            { simpleStations: isSimpleStationsMode() }
        );
        for (const id of offered) {
            if (id !== "act_other") return false;
        }
    }
    return true;
}

export class RestPrepareContext {
    constructor(app) {
        this._app = app;
    }

    async build(_options) {
        const app = this._app;

        if (app._dataReady) {
            const settled = await Promise.race([app._dataReady, Promise.resolve("pending")]);
            if (settled === "pending") {
                app._dataReady.then(() => app.render({ force: true }));
                return { isLoading: true };
            }
            app._dataReady = null;
        }

        // Ensure terrain registry is loaded (no-ops after first call)
        await TerrainRegistry.init();

        if (!app._pendingSelections) app._pendingSelections = new Map();
        if (!app._expandedCards) app._expandedCards = new Set();
        if (!app._craftingInProgress) app._craftingInProgress = new Set();
        if (!app._shelterOverrides) app._shelterOverrides = {};

        if (app._phase === "activity") {
            app._applyLoseActivityTravelLocks();
            app._applyAutoOtherWhenSoleActivity();
            app._ensureTrainingStateForLockedChoices();
        }

        const partyActors = getPartyActors();
        const emptyParty = partyActors.length === 0;
        const partySetup = game.ionrift?.library?.party?.getSetupState?.() ?? {
            isV14: false,
            usesNativeParty: false,
            emptyParty,
            reason: emptyParty ? "no_characters" : null,
            warning: null
        };
        const emptyPartyReason = emptyParty ? (partySetup.reason ?? "no_characters") : null;
        const partySetupWarning = !emptyParty ? (partySetup.warning ?? null) : null;
        const showPartyRosterEditor = emptyParty && !partySetup.usesNativeParty;
        if (!app._selectedTerrain) {
            const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
            if (lastTerrain && TerrainRegistry.get(lastTerrain)) app._selectedTerrain = lastTerrain;
        }
        const terrainDefaults = TerrainRegistry.getDefaults(app._selectedTerrain ?? "forest");
        const defaultComfort = terrainDefaults.comfort;

        if (app._phase === "setup" && !emptyParty) {
            app._selectedWeather = app._resolveSetupWeather(app._selectedTerrain ?? "forest");
        }

        const currentRestType = app._selectedRestType ?? "long";

        let safeRestSpotFromSetting = false;
        try {
            safeRestSpotFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        const safeRestSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeRestSpotFromSetting);
        const isTavernSetup = (app._selectedTerrain ?? "forest") === "tavern";
        const setupSafeHaven = safeRestSpot || isTavernSetup;
        let tavernForcesTotm = false;
        try {
            tavernForcesTotm = isTavernSetup
                && game.settings.get(MODULE_ID, "restInterfaceMode") === "stations";
        } catch { /* settings not ready */ }

        const isGrittyLong = (app._restVariant ?? "normal") === "gritty" && currentRestType !== "short";
        let grittyForcesTotm = false;
        try {
            grittyForcesTotm = isGrittyLong
                && game.settings.get(MODULE_ID, "restInterfaceMode") === "stations";
        } catch { /* settings not ready */ }

        let encountersEnabled = true;
        try {
            encountersEnabled = !!game.settings.get(MODULE_ID, "enableEncounters");
        } catch { /* settings not ready */ }

        if ((safeRestSpot || !isComfortEnabled() || !app._totmFireTabVisible())
            && app._isTotM && app._phase === "activity" && app._totmActiveTab === "fire") {
            app._totmActiveTab = "activities";
        }
        if (!isWorkbenchIdentifyUiEnabled() && app._isTotM && app._phase === "activity" && app._totmActiveTab === "identify") {
            app._totmActiveTab = "activities";
        }
        if (app._isTotM && app._phase === "activity" && app._totmActiveTab === "campfire") {
            app._totmActiveTab = "activities";
        }

        const tentOwners = partyActors.filter(a =>
            a.items?.some(i => isTentItem(i))
        );
        const tentAvailable = tentOwners.length > 0;
        const tentOwnerNames = tentOwners.map(a => a.name).join(", ");

        const shelterOptions = SHELTER_SPELLS
            .filter(spell => spell.restTypes.includes(currentRestType))
            .map(spell => {
                const casters = partyActors.filter(a =>
                    a.items?.some(i => matchesShelterSpell(i, spell))
                );
                const hasCaster = casters.length > 0;
                return {
                    ...spell,
                    available: hasCaster,
                    casterNames: casters.map(a => a.name).join(", "),
                    hint: hasCaster ? spell.hint : game.i18n.format("ionrift-respite.restPrepare.shelter.requiresSpell", { spell: spell.name }),
                    active: !!app._shelterOverrides[spell.id]
                };
            });

        if (currentRestType === "long") {
            shelterOptions.unshift({
                id: "tent",
                name: game.i18n.localize("ionrift-respite.restPrepare.shelter.tent.name"),
                icon: "fas fa-campground",
                available: tentAvailable,
                casterNames: tentOwnerNames,
                hint: tentAvailable ? game.i18n.format("ionrift-respite.restPrepare.shelter.tent.hintCarried", { names: tentOwnerNames }) : game.i18n.localize("ionrift-respite.restPrepare.shelter.tent.hintNoTent"),
                comfortFloor: null,
                encounterMod: 2,
                active: !!app._shelterOverrides.tent
            });
        }

        shelterOptions.push({
            id: "none",
            name: game.i18n.localize("ionrift-respite.restPrepare.shelter.openAir.name"),
            icon: "fas fa-cloud-moon",
            available: true,
            casterNames: null,
            hint: game.i18n.localize("ionrift-respite.restPrepare.shelter.openAir.hint"),
            comfortFloor: null,
            encounterMod: 0,
            active: !!app._shelterOverrides.none
        });

        const activeShelterId = Object.entries(app._shelterOverrides ?? {}).find(([, v]) => v)?.[0];
        const isTavern = (app._selectedTerrain ?? "forest") === "tavern";
        const shelterChosen = isTavern || !!activeShelterId;
        const activeShelter = activeShelterId ? shelterOptions.find(s => s.id === activeShelterId) : null;

        const shelterEffect = activeShelter ? {
            name: activeShelter.name,
            comfortFloor: activeShelter.comfortFloor,
            encounterMod: activeShelter.encounterMod ?? 0,
            casterNames: activeShelter.casterNames ?? null
        } : null;

        const partyState = app.getPartyStateForAdvisory();
        const characterStatuses = buildCharacterStatuses(app, partyActors, partyState, safeRestSpot);
        // The header stays on a character this client may open.
        // A GM can move through the party. A player stays on a character they own.
        if (partyActors.length > 0) {
            if (app._isGM) {
                if (!app._selectedCharacterId) app._selectedCharacterId = partyActors[0].id;
            } else {
                const current = partyActors.find(a => a.id === app._selectedCharacterId);
                if (!current?.isOwner) {
                    const owned = partyActors.find(a => a.isOwner);
                    if (owned) app._selectedCharacterId = owned.id;
                }
            }
        }

        if (app._phase === "activity") {
            app._syncIncompleteTrainingView();
        }

        const totmStationCards = buildTotmStationCards(app, partyActors, partyState, safeRestSpot, setupSafeHaven);
        // Single authoritative source: buildActivityDetailContext() from ActivityDetailBuilder.
        const totmDetailPanel = (() => {
            if (app._phase !== "activity") return null;
            if (!app._isTotM) return null;
            // An open activity belongs to the Activities tab. Other tabs show their own screen.
            const workflowStep = app._selectedWorkflowStep;
            if (workflowStep === "gather" || workflowStep === "sustenance" || workflowStep === "examine") {
                return null;
            }

            let expanded = app._totmFollowUpExpanded;
            const selectedId = app._selectedCharacterId;

            // After Training is confirmed, keep the detail view open until all sets are rolled.
            if (!expanded && selectedId
                && app._trainingStates?.has(selectedId)
                && !app._earlyResults?.has(selectedId)
                && app._characterChoices?.get(selectedId) === "act_train") {
                expanded = { activityId: "act_train", characterId: selectedId, trainingActive: true };
            }

            if (!expanded) return null;
            const expandActor = game.actors.get(expanded.characterId);
            if (!expandActor) return null;

            if (expanded.isIdentify || expanded.activityId === "act_identify" || expanded.activityId === "identify") {
                return {
                    id: expanded.activityId,
                    name: game.i18n.localize("ionrift-respite.restPrepare.examineIdentify"),
                    icon: "fas fa-search",
                    actorName: expandActor.name,
                    actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                    isIdentify: true
                };
            }

            if (expanded.isCrafting) {
                const professionId = expanded.profession ?? "cooking";
                const characterId = expanded.characterId;
                const craftResult = app._craftingResults?.get(characterId) ?? app._totmCraftResult ?? null;
                const hasCrafted = !!craftResult || !!app._totmCraftHasCrafted || (app._grantLedger?.hasCraftingForActor(characterId, professionId) ?? false);
                const mfCookbookAvailable = professionId === "cooking" && !hasCrafted && MonstrousFeastBridge.ownsCooking();
                const professionLabel = CRAFT_PROFESSION_LABELS[professionId] ?? (professionId === "cooking" ? game.i18n.localize("ionrift-respite.restPrepare.cooking") : professionId);

                const craftActivity = app._activityResolver?.activities?.get(expanded.activityId)
                    ?? { armorSleepWaiver: false };
                const armorWarning = app.getArmorWarningForActivityDetail?.(expandActor, craftActivity) ?? null;

                return {
                    isCrafting: true,
                    characterId,
                    professionId,
                    name: professionLabel,
                    armorWarning,
                    icon: professionId === "cooking" ? "fas fa-utensils" : "fas fa-hammer",
                    actorName: expandActor.name,
                    actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                    hasCrafted,
                    mfCookbookAvailable,
                    craftingResult: craftResult ? {
                        ...craftResult,
                        isPartyMeal: !!(craftResult.outputFlags?.[MODULE_ID]?.partyMeal ?? craftResult.isPartyMeal),
                        partyMealDispositionDone: !!app._totmFeastServed || !!craftResult.partyMealDispositionDone,
                        partyRoster: getPartyActors().map(a => ({
                            id: a.id,
                            name: a.name,
                            img: a.img || "icons/svg/mystery-man.svg",
                            alreadyWellFed: a.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false
                        }))
                    } : null
                };
            }

            const expandActivity = app._activityResolver?.activities?.get(expanded.activityId);
            if (!expandActivity) return null;
            const comfort = app._engine?.comfort ?? "sheltered";
            const existingFollowUp = app._gmFollowUps?.get(expanded.characterId) ?? null;
            let armorDoffSetting = false;
            try { armorDoffSetting = !!game.settings.get(MODULE_ID, "armorDoffRule"); } catch { /* ok */ }
            const armorRuleEnabled = !safeRestSpot && armorDoffSetting;
            const detail = buildActivityDetailContext(
                expanded.activityId, expandActivity, expandActor, partyState,
                {
                    comfort,
                    followUpValue: existingFollowUp,
                    armorRuleEnabled,
                    getArmorWarning: armorRuleEnabled
                        ? (app.getArmorWarningForActivityDetail?.bind(app) ?? null)
                        : null
                }
            );
            const trainingPending = expanded.activityId === "act_train"
                && app._trainingStates?.has(expanded.characterId)
                && !app._earlyResults?.has(expanded.characterId);
            const trainingPanel = trainingPending
                ? app._buildTrainingViewContext(expanded.characterId)
                : null;
            return {
                ...detail,
                actorName:    expandActor.name,
                actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                trainingPanel,
                isTrainingRolling: !!trainingPanel
            };
        })();

        // GM sees all as heroes since they manage all characters
        const heroCharacters = app._isGM
            ? characterStatuses
            : characterStatuses.filter(c => c.isOwner);
        if (!app._selectedCharacterId && heroCharacters.length) {
            app._selectedCharacterId = heroCharacters[0].id;
        }
        const partyCharacters = app._isGM
            ? []
            : characterStatuses.filter(c => !c.isOwner);

        if (!app._selectedCharacterId && heroCharacters.length > 0) {
            app._selectedCharacterId = heroCharacters[0].id;
            closeStationDialogIfDifferentActor(app._selectedCharacterId);
        }
        const { roster, selectedCharacter, totalCharacters, resolvedCount, trackFoodSetting, allResolved, activityPhasePlayerOverview } = buildRosterAndOverview(app, partyActors, characterStatuses, heroCharacters);
        const { recoverySummary, activitySummary, partyDiscoveries, personalOutcomes, dawnCards, resolutionCards } = buildResolvePhaseSummaries(app);
        const {
            campScanData, campMakeCampStep, campFireEncounterHint, campFirePickerLevels,
            campFireGatePit, campFireGateLevel, campColdCampDecided, campComfortIsHostile,
            campFireIsLit, campSelectedFirewoodCost, campPartyFirewood, campHasEnoughFirewood,
            campCanLight, campFireLitBy, campFireLighters, campFirewoodPledgeList, campMyPledge,
            campCanAddFirewood, campMyFirewoodActorId, campFireTierCards, campFireTotalPledged,
            campFireOtherLighterCount, campFireLighterNames,
            campPersonalSelected, campfirePlaced, campfireDragCard, campfireCanMove,
            canProceedFromMakeCamp, proceedBlockedHint
        } = buildMakeCampContext(app, safeRestSpot);
        // Whether the Meal phase runs as a distinct step this rest (drives the stepper).
        // Matches the gate in #beginEvents: tracked food, Theater of the Mind, a long
        // rest, not a safe spot, and a terrain that actually imposes meal rules.
        // Gritty Realism: short rest is 8 hours overnight, so meals and events run.
        const _mealStepTerrain = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
        const _mealStepRules = TerrainRegistry.getDefaults(_mealStepTerrain)?.mealRules ?? {};
        const _isGrittyShortCtx = (app._selectedRestType ?? "long") === "short"
            && (app._restVariant ?? "normal") === "gritty";
        const _isLongOrGrittyShort = (app._selectedRestType ?? "long") === "long" || _isGrittyShortCtx;
        const showSustenanceStep = !!trackFoodSetting
            && !setupSafeHaven
            && _isLongOrGrittyShort
            && ((_mealStepRules.waterPerDay > 0) || (_mealStepRules.foodPerDay > 0));
        const showMealStep = showSustenanceStep && app._isTotM;

        // Header pips are the rest itself. Gather, Activities, Sustenance, and
        // Examine are tabs inside Camp, not their own stages. Night drops out
        // at a safe spot (Setup, Camp). Wilderness adds Night, then Dawn for
        // the exhaustion saves. Completing dawn posts the chat card and closes.
        const _includeEventsStep = _isLongOrGrittyShort && !setupSafeHaven;
        const _headerPhase = (app._phase === "meal" || app._phase === "camp") ? "activity"
            : (app._phase === "resolve" ? "dawn" : app._phase);
        const _phaseStepDefs = [
            { key: "setup", label: game.i18n.localize("ionrift-respite.restPrepare.phase.setup"), include: true },
            { key: "activity", label: game.i18n.localize("ionrift-respite.restPrepare.phase.camp"), include: true },
            { key: "supper", label: game.i18n.localize("ionrift-respite.restPrepare.phase.meal"), include: app._phase === "supper" },
            { key: "events", label: game.i18n.localize("ionrift-respite.restPrepare.phase.night"), include: _includeEventsStep },
            { key: "dawn", label: game.i18n.localize("ionrift-respite.restPrepare.phase.dawn"), include: _includeEventsStep }
        ].filter(s => s.include);
        const _currentStepIndex = _phaseStepDefs.findIndex(s => s.key === _headerPhase);
        const phaseSteps = _phaseStepDefs.map((s, i) => ({
            key: s.key,
            label: s.label,
            active: i === _currentStepIndex,
            complete: _currentStepIndex >= 0 && i < _currentStepIndex
        }));
        const phaseLabel = _currentStepIndex >= 0 ? _phaseStepDefs[_currentStepIndex].label : "";

        // Activity-phase "proceed" button label tracks the actual next step, so it
        // never promises a Rations stage that this configuration skips.
        const _activityNextStep = showMealStep ? "meal" : (_includeEventsStep ? "events" : "resolve");
        const activityProceed = ({
            meal:    { label: game.i18n.localize("ionrift-respite.restPrepare.proceed.sustenance"), icon: "fas fa-arrow-right" },
            events:  { label: game.i18n.localize("ionrift-respite.restPrepare.proceed.events"), icon: "fas fa-moon" },
            resolve: { label: game.i18n.localize("ionrift-respite.restPrepare.proceed.breakCamp"), icon: "fas fa-campground" }
        })[_activityNextStep];

        // Whether meal context data should be built this render pass.
        // True when the real phase is "meal" OR the stepper is previewing sustenance.
        const showGatherStep = !setupSafeHaven && (isForagingEnabled() || isHuntingEnabled());
        const hideActivitiesStep = computePartyOnlyFreeTime(app, partyActors);
        const _defaultWorkflowStep = showGatherStep
            ? "gather"
            : (hideActivitiesStep && showSustenanceStep ? "sustenance" : "activities");
        const _rawWorkflowStep = app._selectedWorkflowStep ?? _defaultWorkflowStep;
        const _resolvedWorkflowStep = (() => {
            if (app._phase === "meal" && showSustenanceStep) return "sustenance";
            if (app._phase !== "activity" && app._phase !== "camp") return null;
            let step = (_rawWorkflowStep === "sustenance" && !showSustenanceStep) ? "activities" : _rawWorkflowStep;
            if (step === "activities" && hideActivitiesStep && (showGatherStep || showSustenanceStep)) {
                const focusId = app._selectedCharacterId ?? partyActors[0]?.id ?? null;
                const { gatherDone } = dailyChoiceStatus(app, focusId, showGatherStep);
                step = (showGatherStep && !gatherDone)
                    ? "gather"
                    : (showSustenanceStep ? "sustenance" : "gather");
            }
            return step;
        })();
        const showMealContent = showSustenanceStep && (
            app._phase === "meal"
            || (app._phase === "activity" && _resolvedWorkflowStep === "sustenance")
        );
        const showIdentifyContent = _resolvedWorkflowStep === "examine"
            || Boolean(
                app._totmFollowUpExpanded?.isIdentify
                || app._totmFollowUpExpanded?.activityId === "act_identify"
                || app._totmFollowUpExpanded?.activityId === "identify"
            );
        const activityProceedView = ((app._restVariant ?? "normal") !== "gritty"
            && ["activity", "meal"].includes(app._phase)
            && _activityNextStep !== "resolve")
            ? { label: game.i18n.localize("ionrift-respite.restPrepare.proceed.night"), icon: "fas fa-moon" }
            : activityProceed;

        // Setup-screen summary of the settings that reshape this rest, so global
        // toggles read as local context instead of silently changing the flow.
        const restConfigBadges = (app._isGM && app._phase === "setup"
            && (app._selectedRestType ?? "long") !== "short")
            ? (() => {
                const g = (k) => { try { return !!game.settings.get(MODULE_ID, k); } catch (e) { return false; } };
                const comfort = g("enableComfort");
                const professions = g("enableProfessions");
                const meals = g("trackFood");
                const comfortActive = comfort && !setupSafeHaven;
                const professionsActive = professions && !isTavernSetup;
                const mealsActive = meals && !isTavernSetup;
                const comfortBypassTooltip = isTavernSetup
                    ? game.i18n.localize("ionrift-respite.restPrepare.config.comfortBypassTavern")
                    : game.i18n.localize("ionrift-respite.restPrepare.config.comfortBypassSafe");
                const variant = app._restVariant ?? "normal";
                const isGritty = variant === "gritty";
                const badges = [
                    { on: comfortActive, icon: "fas fa-temperature-half", label: game.i18n.localize("ionrift-respite.restPrepare.config.comfort"), tooltip: setupSafeHaven ? comfortBypassTooltip : comfort ? game.i18n.localize("ionrift-respite.restPrepare.config.comfortOnTooltip") : game.i18n.localize("ionrift-respite.restPrepare.config.comfortOffTooltip") },
                    { on: professionsActive, icon: "fas fa-hammer", label: game.i18n.localize("ionrift-respite.restPrepare.config.professions"), tooltip: isTavernSetup ? game.i18n.localize("ionrift-respite.restPrepare.config.professionsTavernTooltip") : professions ? game.i18n.localize("ionrift-respite.restPrepare.config.professionsOnTooltip") : game.i18n.localize("ionrift-respite.restPrepare.config.professionsOffTooltip") },
                    { on: mealsActive, icon: "fas fa-drumstick-bite", label: game.i18n.localize("ionrift-respite.restPrepare.config.meals"), tooltip: isTavernSetup ? game.i18n.localize("ionrift-respite.restPrepare.config.mealsTavernTooltip") : meals ? game.i18n.localize("ionrift-respite.restPrepare.config.mealsOnTooltip") : game.i18n.localize("ionrift-respite.restPrepare.config.mealsOffTooltip") }
                ];
                if (isGritty) {
                    badges.unshift({ on: true, icon: "fas fa-skull-crossbones", label: game.i18n.localize("ionrift-respite.restPrepare.config.gritty"), tooltip: game.i18n.localize("ionrift-respite.restPrepare.config.grittyTooltip") });
                }
                return badges;
            })()
            : [];

        const campConditionsBar = app._buildCampConditionsBar(campScanData, { safeRestSpot, encountersEnabled });
        const currentCampComfort = campConditionsBar?.campComfort ?? null;
        const campComfortFlashing = app._lastTrackedCampComfort !== undefined && app._lastTrackedCampComfort !== currentCampComfort;
        app._lastTrackedCampComfort = currentCampComfort;
        if (campConditionsBar) campConditionsBar.flashing = campComfortFlashing;

        const currentPersonalComfort = campPersonalSelected?.personalComfort ?? null;
        if (!(app._personalComfortMemory instanceof Map)) app._personalComfortMemory = new Map();
        const personalComfortFlashing = RestDockContext.noteComfortFlash(
            app._personalComfortMemory,
            campPersonalSelected?.actorId ?? app._selectedCharacterId ?? null,
            currentPersonalComfort
        );
        if (campPersonalSelected) campPersonalSelected.flashing = personalComfortFlashing;

        const activityPartyIds = partyActors.map(actor => actor?.id).filter(Boolean);
        const activityFinishedIds = app._finishedActorIds ?? new Set();
        const cardHoldsProceed = phaseProceedHeld(
            app, _resolvedWorkflowStep, totmDetailPanel, showMealContent, showIdentifyContent, totmStationCards,
            { hideActivitiesStep, showSustenanceStep }
        );
        const partyReadyForNight = partyFullyReady(activityPartyIds, activityFinishedIds);
        const activityProceedEnabled = canGmProceedFromActivity({
            allResolved,
            cardHoldsProceed,
            partyIds: activityPartyIds,
            finishedIds: activityFinishedIds
        });
        const holdPhaseProceed = cardHoldsProceed && !partyReadyForNight;

        return {
            isGM: app._isGM,
            isTheaterMode: app._isTotM,
            showFullMakeCampPanel: app._phase === "camp" && app._showFullMakeCampPanel(),
            stationsMinimalCampShell: app._phase === "camp" && app._usesStationsMinimalCampShell(),
            simpleStationsMode: isSimpleStationsMode(),
            workbenchIdentifyUiEnabled: isWorkbenchIdentifyUiEnabled(),
            encountersEnabled,
            showMealStep,
            phaseSteps,
            phaseLabel,
            ...RestPresentationHelper.resolveRestHeaderContext({
                type: (app._restVariant ?? "normal") === "gritty" ? "downtime" : "long",
                terrainTag: app._selectedTerrain ?? app._engine?.terrainTag ?? "forest",
                terrainLabel: app._terrainLabel ?? "Forest",
                phase: app._phase,
                phaseLabel,
                phaseSteps,
                abandonAction: "abandonRest",
                isGM: app._isGM,
                eventsCommitPending: Boolean(app._eventsCommitPending)
            }),
            activityProceed: activityProceedView,
            restConfigBadges,
            totmActiveTab: app._totmActiveTab,
            showTotmCampfirePanel: app._shouldShowTotmCampfirePanel(),
            totmFireTabVisible: app._totmFireTabVisible(),
            totmStationCards,
            totmDetailPanel,
            totmCharacterLocked: (() => {
                const cid = app._selectedCharacterId;
                if (!cid) return null;
                const isLocked = app._lockedCharacters?.has(cid)
                    || (app._isGM && app._gmOverrides?.has(cid));
                if (!isLocked) return null;
                const actId = app._characterChoices?.get(cid);
                const act = actId ? app._activityResolver?.activities?.get(actId) : null;
                return act?.name ?? actId ?? "an activity";
            })(),
            ...(app._isTotM && app._phase === "activity" && (_resolvedWorkflowStep === "examine" || app._totmActiveTab === "identify" || app._totmFollowUpExpanded?.isIdentify || app._totmFollowUpExpanded?.activityId === "act_identify" || app._totmFollowUpExpanded?.activityId === "identify") && isWorkbenchIdentifyUiEnabled() ? (() => {
                const rosterSelected = app._selectedCharacterId || getPartyActors()[0]?.id || null;
                return app._workbench.buildEmbedContext(rosterSelected, getPartyActors);
            })() : {}),
            emptyParty,
            emptyPartyReason,
            partySetupWarning,
            showPartyRosterEditor,
            rosterInfo: (() => {
                const roster = getPartyActors();
                return {
                    count: roster.length,
                    names: roster.map(a => a.name),
                    portraits: roster.slice(0, 6).map(a => ({
                        img: a.img ?? "icons/svg/mystery-man.svg",
                        name: a.name
                    })),
                    overflow: Math.max(0, roster.length - 6)
                };
            })(),
            trackFood: trackFoodSetting,
            restVariant: app._restVariant ?? "normal",
            isGrittyRealism: (app._restVariant ?? "normal") === "gritty",
            setupAdvancedOpen: !!app._setupAdvancedOpen,
            gmCopySpellProposal: app._gmCopySpellProposal ?? null,
            copySpellRollPrompt: app._copySpellRollPrompt ?? null,
            copySpellRollRequest: buildCopySpellRollContext(app._copySpellRollPrompt),
            phase: app._phase,
            postStationChoiceReview: !app._isGM && app._phase === "activity" && !!app._postStationChoiceReview,
            activitySubTab: null,
            travelContext: null,
            terrainOptionGroups: (() => {
                const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
                return TerrainRegistry.getOptionGroups({ lastTerrain });
            })(),
            terrainPreview: (() => {
                const t = app._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const travel = setupSafeHaven
                    ? (isTavernSetup
                        ? game.i18n.localize("ionrift-respite.restPrepare.setup.tavernNoTravel")
                        : game.i18n.localize("ionrift-respite.restPrepare.setup.safeSpotSkipTravel"))
                    : (d.travelAvailable ? game.i18n.localize("ionrift-respite.restPrepare.setup.gatheringAvailable") : game.i18n.localize("ionrift-respite.restPrepare.setup.noGathering"));
                if (!isComfortEnabled()) return travel;
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                return game.i18n.format("ionrift-respite.restPrepare.setup.impliedComfort", { comfort, travel });
            })(),
            setupStatusLine: (() => {
                const t = app._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfortOn = isComfortEnabled();
                const parts = [];
                if (comfortOn) {
                    const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                    parts.push(game.i18n.format("ionrift-respite.restPrepare.setup.statusComfortCamp", { comfort }));
                }
                const w = app._resolveSetupWeather(t);
                const wData = WEATHER_TABLE[w];
                if (wData && ((comfortOn && wData.comfortPenalty > 0) || (encountersEnabled && wData.encounterDC !== 0))) {
                    const fx = [];
                    if (comfortOn && wData.comfortPenalty > 0) fx.push(game.i18n.format("ionrift-respite.restPrepare.setup.statusComfortPenalty", { penalty: wData.comfortPenalty }));
                    if (encountersEnabled && wData.encounterDC > 0) fx.push(game.i18n.format("ionrift-respite.restPrepare.setup.statusEncounterPlus", { dc: wData.encounterDC }));
                    if (encountersEnabled && wData.encounterDC < 0) fx.push(game.i18n.format("ionrift-respite.restPrepare.setup.statusEncounterMinus", { dc: wData.encounterDC }));
                    if (fx.length) parts.push(fx.join(", "));
                }
                if (!setupSafeHaven && d.travelAvailable) parts.push(game.i18n.localize("ionrift-respite.restPrepare.setup.statusTravelAvailable"));
                if (tavernForcesTotm) parts.push(game.i18n.localize("ionrift-respite.restPrepare.setup.statusOneWindowTavern"));
                if (grittyForcesTotm) parts.push(game.i18n.localize("ionrift-respite.restPrepare.setup.statusOneWindowDowntime"));
                return parts.join(" · ");
            })(),
            weatherOptions: (() => {
                const terrain = app._selectedTerrain ?? "forest";
                const defaultKey = TerrainRegistry.getWeather(terrain)[0] ?? "clear";
                let lastWeather = "";
                try {
                    lastWeather = game.settings.get(MODULE_ID, "lastWeather") ?? "";
                } catch { /* settings not ready */ }
                return TerrainRegistry.getWeather(terrain)
                    .map(key => ({ value: key, ...WEATHER_TABLE[key] }))
                    .filter(w => w.label)
                    .map(w => {
                        const isDefault = w.value === defaultKey;
                        const isLast = lastWeather && w.value === lastWeather;
                        if (isDefault && isLast) return { ...w, label: game.i18n.format("ionrift-respite.restPrepare.weather.defaultLastUsed", { label: w.label }) };
                        if (isDefault) return { ...w, label: game.i18n.format("ionrift-respite.restPrepare.weather.default", { label: w.label }) };
                        if (isLast) return { ...w, label: game.i18n.format("ionrift-respite.restPrepare.weather.lastUsed", { label: w.label }) };
                        return w;
                    });
            })(),
            defaultWeather: TerrainRegistry.getWeather(app._selectedTerrain ?? "forest")[0] ?? "clear",
            selectedWeather: app._selectedWeather ?? app._resolveSetupWeather(app._selectedTerrain ?? "forest"),
            comfortOptions: (() => {
                const opts = [
                    { value: "safe", label: game.i18n.localize("ionrift-respite.restPrepare.comfort.safe.label"), hint: game.i18n.localize("ionrift-respite.restPrepare.comfort.safe.hint") },
                    { value: "sheltered", label: game.i18n.localize("ionrift-respite.restPrepare.comfort.sheltered.label"), hint: game.i18n.localize("ionrift-respite.restPrepare.comfort.sheltered.hint") },
                    { value: "rough", label: game.i18n.localize("ionrift-respite.restPrepare.comfort.rough.label"), hint: game.i18n.localize("ionrift-respite.restPrepare.comfort.rough.hint") },
                    { value: "hostile", label: game.i18n.localize("ionrift-respite.restPrepare.comfort.hostile.label"), hint: game.i18n.localize("ionrift-respite.restPrepare.comfort.hostile.hint") }
                ];
                const match = opts.find(o => o.value === defaultComfort);
                if (match) match.label += " " + game.i18n.localize("ionrift-respite.restPrepare.comfort.terrainDefaultSuffix");
                return opts;
            })(),
            comfortReason: TerrainRegistry.get(app._selectedTerrain ?? "forest")?.comfortReason ?? "",
            restModeOptions: (() => {
                if (isGrittyLong) {
                    return [
                        { value: "theater", label: game.i18n.localize("ionrift-respite.restPrepare.mode.oneWindow"), selected: true },
                        { value: "stations", label: game.i18n.localize("ionrift-respite.restPrepare.mode.stationsUnavailable"), selected: false, disabled: true }
                    ];
                }
                const current = app._isTotM ? "theater" : "stations";
                return [
                    { value: "theater", label: game.i18n.localize("ionrift-respite.restPrepare.mode.oneWindow"), selected: current === "theater" },
                    { value: "stations", label: game.i18n.localize("ionrift-respite.restPrepare.mode.stations"), selected: current === "stations" }
                ];
            })(),
            setupStep: app._setupStep ?? 1,
            selectedTerrain: app._selectedTerrain ?? "forest",
            ...ImageResolver.resolveRestBannerContext(
                app._selectedTerrain ?? app._engine?.terrainTag ?? "forest",
                app._phase ?? "setup"
            ),
            selectedTerrainLabel: app._terrainLabel ?? "Forest",
            supportsShortRest: game.ionrift?.respite?.adapter?.supportsShortRest ?? true,
            selectedRestType: app._selectedRestType ?? "long",
            selectedRestTypeLabel: app._selectedRestType === "short" ? game.i18n.localize("ionrift-respite.restPrepare.restType.short") : game.i18n.localize("ionrift-respite.restPrepare.restType.long"),
            isShortRest: (app._selectedRestType ?? "long") === "short",
            showEnvironment: (app._selectedRestType ?? "long") !== "short" || (app._restVariant ?? "normal") === "gritty",
            showWeather: (app._selectedRestType ?? "long") !== "short" || (app._restVariant ?? "normal") === "gritty",
            showConfigSummary: (app._selectedRestType ?? "long") !== "short" || (app._restVariant ?? "normal") === "gritty",
            showStatusLine: (app._selectedRestType ?? "long") !== "short" || (app._restVariant ?? "normal") === "gritty",
            safeRestSpot,
            safeRestSpotDisplay: setupSafeHaven,
            safeRestLocked: isTavernSetup,
            safeRestPulse: !!app._safeRestPulseAlert,
            safeRestTooltip: isTavernSetup
                ? "Tavern rests are always safe: no encounters, automatic recovery, and no comfort pressure. Safe Rest cannot be turned off here."
                : "No encounter risk. Skips night events, comfort penalties, and camp defense. Activities, cooking, and identification only.",
            setupSafeHaven,
            isTavernSetup,
            tavernForcesTotm,
            isGrittyLongRest: isGrittyLong,
            grittyForcesTotm,
            selectedWeatherLabel: WEATHER_TABLE[app._resolveSetupWeather(app._selectedTerrain ?? "forest")]?.label ?? "Clear",
            shelterNeeded: (app._selectedTerrain ?? "forest") !== "tavern",
            defaultComfort,
            shelterOptions,
            shelterEffect,
            shelterChosen,
            heroCharacters,
            roster,
            canvasFocusedStationId: app._canvasFocusedStationId ?? null,
            selectedWorkflowStep: _resolvedWorkflowStep,
            ...(() => {
                const actorId = app._selectedCharacterId
                    ?? (app._isGM ? getPartyActors()[0]?.id : (app._myCharacterIds?.values().next().value ?? getPartyActors()[0]?.id));
                const gatherOn = !setupSafeHaven && (isForagingEnabled() || isHuntingEnabled());
                const { gatherDone, activityDone } = dailyChoiceStatus(app, actorId, gatherOn);
                const trackFoodOn = showSustenanceStep;
                let sustenanceDone = false;
                try {
                    if (!trackFoodOn) {
                        sustenanceDone = true;
                    } else {
                        const card = app.getStationMealCardForActor(actorId);
                        sustenanceDone = Boolean(app._activityMealRationsSubmitted?.has(actorId))
                            || Boolean(card?.playerSubmitted);
                    }
                } catch { /* settings not ready */ }

                const countActivitiesStep = !(hideActivitiesStep && (gatherOn || trackFoodOn));
                let stepsTotalCount = countActivitiesStep ? 1 : 0;
                let stepsCompletedCount = (countActivitiesStep && activityDone) ? 1 : 0;
                if (gatherOn) {
                    stepsTotalCount++;
                    if (gatherDone) stepsCompletedCount++;
                }
                if (trackFoodOn) {
                    stepsTotalCount++;
                    if (sustenanceDone) stepsCompletedCount++;
                }
                const characterPlanComplete = (gatherOn ? gatherDone : true)
                    && activityDone
                    && (trackFoodOn ? sustenanceDone : true);

                return {
                    workflowComplete: { gather: gatherDone, activities: activityDone, sustenance: sustenanceDone },
                    workflowMark: {
                        gather: gatherDone ? "complete" : "draft",
                        activities: activityDone ? "complete" : "draft",
                        sustenance: sustenanceDone ? "complete" : "draft"
                    },
                    stepsTotalCount,
                    stepsCompletedCount,
                    characterPlanComplete
                };
            })(),
            showGatherStep,
            hideActivitiesStep,
            showSustenanceStep,
            gatherPanel: buildGatherPanel(app, _resolvedWorkflowStep),
            activityCommit: buildActivityCommit(app, totmStationCards, { hideActivitiesStep }),
            holdPhaseProceed,
            activityProceedEnabled,
            mealCommit: buildMealCommit(app),
            showMealContent,
            showIdentifyContent,
            isIdentifyActive: showIdentifyContent,
            scopingCharacterName: selectedCharacter?.name?.split(" ")?.[0] ?? selectedCharacter?.name ?? null,
            partyCharacters,
            totalCharacters,
            resolvedCount,
            allResolved,
            activityPhasePlayerOverview,
            outcomes: personalOutcomes ?? [],
            resolutionCards,
            dawnCards,
            isResolvePhase: app._phase === "resolve",
            isSetupPhase: app._phase === "setup",
            ...buildEventsPhaseContext(app, encountersEnabled),
            recoverySummary,
            activitySummary,
            partyDiscoveries,
            grantActors: getPartyActors().map(a => ({ id: a.id, name: a.name })),
            activityDetail: app._buildActivityDetailContext(selectedCharacter),
            ...buildCampStatusAndEncounterBar(app, encountersEnabled),
            campConditionsBar,
            campComfortFlashing,
            personalComfortFlashing,
            campScan: campScanData,
            comfortEnabled: isComfortEnabled(),
            isFireLit: (app._fireLevel ?? "unlit") !== "unlit" && !app._coldCampDecided,
            bannerFireClass: (app._phase === "camp" || app._phase === "activity" || app._phase === "meal")
                ? ImageResolver.bannerFireClass(
                    (app._coldCampDecided || app._isCampColdCampPreview?.())
                        ? "cold_camp"
                        : (app._fireLevel ?? "unlit")
                )
                : "is-fire-lit",
            canProceedFromCamp: canProceedFromMakeCamp,
            canProceedFromMakeCamp,
            proceedBlockedHint,
            campfireDragCard,
            campfireCanMove,
            campMinimalMode: app._phase === "camp",
            campPitPlacementCancelled: !!app._campPitPlacementCancelled,
            campMakeCampStep,
            campFireEncounterHint,
            showCampCeremonyMinigame: app._campCeremonyMinigameEnabled(),
            campFirePreviewLabel: (() => {
                if (app._coldCampDecided || app._isCampColdCampPreview()) return "Cold camp";
                const p = app._campFirePreviewLevel ?? "embers";
                return p.charAt(0).toUpperCase() + p.slice(1);
            })(),
            campFirePickerLevels,
            campFirePreviewLevel: app._campFirePreviewLevel ?? "embers",
            campPreviewIsColdCamp: app._isCampColdCampPreview(),
            campFireGatePit,
            campFireGateLevel,
            campFireIsLit,
            campFireLabel: (() => {
                const l = app._fireLevel ?? "unlit";
                return l.charAt(0).toUpperCase() + l.slice(1);
            })(),
            campFireLitBy,
            campSelectedFirewoodCost,
            campPartyFirewood,
            campHasEnoughFirewood,
            campCanLight,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campColdCampDecided,
            campComfortIsHostile,
            campFireTierCards,
            campFireTotalPledged,
            campPitBlocksFireLighting: (app._phase === "camp" || app._phase === "activity") && app._campPitBlocksFireLighting(),
            campFireOtherLighterCount,
            campFireLighterNames,
            campPersonalSelected,
            // Rest Dock (mock: rest-dock-gritty). Renders on activity + meal
            // phases; setup and camp keep their bespoke chrome.
            characterReady: (["activity", "meal"].includes(app._phase))
                ? !!(app._finishedActorIds?.has?.(
                    app._selectedCharacterId
                    ?? game.user.character?.id
                    ?? getPartyActors()[0]?.id
                ))
                : false,
            ...(() => {
                const fireRailOn = Boolean(
                    app._campCeremony?._fireRailVisible?.()
                    ?? (["activity", "meal"].includes(app._phase) && (app._restVariant ?? "normal") !== "gritty")
                );
                return {
                    showFireRail: fireRailOn,
                    hideFireRail: !fireRailOn,
                    hideFireMinigameHost: !isCampfireMinigameEnabled(),
                    fireBlockedShelterName: (!safeRestSpot && !isTavernSetup)
                        ? (app._campCeremony?.getFireBlockingShelterName?.() ?? null)
                        : null
                };
            })(),
            selectedCharacterId: app._selectedCharacterId,
            readyCount: activityPartyIds.filter(id => activityFinishedIds.has(id)).length,
            readyTotal: (["activity", "meal"].includes(app._phase))
                ? (partyActors ?? []).length
                : 0,
            restDock: (["activity", "meal"].includes(app._phase))
                ? RestDockContext.buildDockContext({
                    party: partyActors,
                    selectedId: app._selectedCharacterId,
                    personalScan: campPersonalSelected,
                    comfortFlashing: personalComfortFlashing,
                    comfortEnabled: isComfortEnabled() && !setupSafeHaven,
                    finishedActorIds: new Set((partyActors ?? [])
                        .filter(a => a && a.id && (app._finishedActorIds?.has?.(a.id) ?? false))
                        .map(a => a.id)),
                    characterState: new Map((partyActors ?? [])
                        .filter(a => a && a.id)
                        .map(a => {
                            const pCard = campScanData?.personalCards?.find(p => p.actorId === a.id);
                            return [a.id, {
                                hasExhaustionRisk: Boolean(pCard?.recovery?.exhaustionDC),
                                exhaustionDC: pCard?.recovery?.exhaustionDC ?? null,
                                statusLabel: ""
                            }];
                        })),
                    isGM: app._isGM
                })
                : null,
            // Aliases so the shared dock partial can read hearth data from
            // both apps without a compat shim.
            fuelStockTotal: campPartyFirewood,
            fuelBurnCost: campSelectedFirewoodCost,
            hasEnoughFuel: campHasEnoughFirewood,
            hasTinderbox: campScanData?.hasTinderbox ?? false,
            fuelStockTooltip: `${campPartyFirewood} firewood in the party · ${campSelectedFirewoodCost} used for ${(app._fireLevel ?? "unlit")}`,
            fireLevel: app._fireLevel ?? "unlit",
            fireTierOptions: ["cold_camp", "embers", "campfire", "bonfire"].map(id => ({
                id,
                label: ({ cold_camp: "Cold", embers: "Embers", campfire: "Campfire", bonfire: "Bonfire" })[id],
                costLabel: ({ cold_camp: "No fire", embers: "1 wood", campfire: "2 wood", bonfire: "3 wood" })[id],
                dcDelta: "",
                selected: (app._fireLevel ?? "unlit") === id || ((app._fireLevel ?? "unlit") === "unlit" && id === "embers"),
                disabled: false,
                disabledReason: null
            })),
            isWilderness: !safeRestSpot && !isTavernSetup,
            campfirePlaced,
            craftingDrawer: app._buildCraftingDrawerContext(),
            magicScanResults: app._magicScanResults ?? null,
            magicScanComplete: app._magicScanComplete ?? false,
            ...buildMealPhaseContext(app, showMealContent),
            mealProcessed: app._mealProcessed ?? false,
            campPlaced: hasCampPlaced()
        };
    }
}
