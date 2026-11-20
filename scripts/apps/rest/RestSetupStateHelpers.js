import { EventResolver } from "../../services/events/resolve/EventResolver.js";
import { countPoolEventsForTerrain } from "../../services/events/catalog/EventCatalogLoader.js";
import { GrantLedger } from "../../services/crafting/outcomes/GrantLedger.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { hasCampfirePlaced } from "../../services/camp/props/CompoundCampPlacer.js";
import { GatherYieldService } from "../../services/rest/forage/GatherYieldService.js";
import { dailyChoiceStatus, publishCampProgress } from "../../services/rest/session/campProgressState.js";
import { ForageActivityValidator } from "../../services/travel/forage/ForageActivityValidator.js";
import { isForagingEnabled, isHuntingEnabled } from "../../services/travel/settings/TravelSettings.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { isComfortEnabled } from "../../services/camp/gear/ComfortCalculator.js";
import { buildCampConditionsBar } from "../../services/camp/gear/CampConditionsBarBuilder.js";
import { deactivateStationLayer } from "../../services/camp/props/StationInteractionLayer.js";
import { collectPartyIdentifyEmbedData } from "../delegates/crafting/DetectMagicDelegate.js";
import { RestLedgerApp } from "./RestLedgerApp.js";
import { _showGmRestIndicator, _refreshGmRestIndicator } from "../../module.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { emitRestSnapshot, emitPhaseChanged } from "../../services/socket/SocketController.js";
import { MODULE_ID } from "../../data/moduleId.js";

class RestSetupStateMixin {
_showFullMakeCampPanel() {
        return this._isTotM || isComfortEnabled();
    }

_usesStationsMinimalCampShell() {
        return !this._isTotM && !isComfortEnabled();
    }

_stationsComfortAutoAdvanceAfterFireLit() {
        return !this._isTotM && isComfortEnabled();
    }

_campPitBlocksFireLighting() {
        if (this._isTotM) return false;
        if (this._engine?.safeRestSpot) return false;
        return !hasCampfirePlaced();
    }

_campPitIgniteBlockMessage() {
        if (!this._campPitBlocksFireLighting()) return "";
        if (game.user?.isGM) {
            return "Place the campfire on the map (Place fire) before anyone can light it.";
        }
        return "The GM must place the campfire on the map before you can light the fire.";
    }

    async _maybeSpendMakeCampCeremonyWoodBeforeAdvance() {
        if (!this._stationsComfortAutoAdvanceAfterFireLit()) return;
        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[this._fireLevel ?? "unlit"] ?? 0;
        if (cost <= 0) return;
        const staged = this._makeCampStagedWood?.length ?? 0;
        if (staged < cost) return;
        await this._totmSpendMakeCampFirewood();
        this._makeCampStagedWood = [];
        this._makeCampStagedWoodTier = null;
    }

    /** Tavern + stations mode: TotM for this rest only. Does not write restInterfaceMode. */
    _applyTavernTotmOverrideForRestStart(terrainTag) {
        if (terrainTag !== "tavern") {
            this._tavernTotmOverride = false;
            return;
        }
        try {
            this._tavernTotmOverride = game.settings.get(MODULE_ID, "restInterfaceMode") === "stations";
        } catch {
            this._tavernTotmOverride = false;
        }
    }

_clearTavernTotmOverride() {
        this._tavernTotmOverride = false;
    }

    /** Engine, then activeRest payload, then world setting (same merge as getData). */
    _effectiveSafeRestSpot() {
        let fromSetting = false;
        try {
            fromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        return !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? fromSetting);
    }

getRestFlowEngine() {
        return this._engine ?? null;
    }

_applyLoseActivityTravelLocks() {
        if (this._phase !== "activity") return;
        for (const actor of getPartyActors()) {
            try {
                if (actor.getFlag(MODULE_ID, "travelMishapPenalty") === "lose_activity") {
                    this._characterChoices.set(actor.id, "act_other");
                }
            } catch { /* noop */ }
        }
    }

    _applyAutoOtherWhenSoleActivity() { this._stations._applyAutoOtherWhenSoleActivity(); }

    async _saveRestState() { return this._session._saveRestState(); }

    async _loadRestState() { return this._session._loadRestState(); }

async applyRestoredPhaseUi() {
        if (this._phase !== "activity") return;
        this._syncIncompleteTrainingView();
        await this.render({ force: true });
        const isTheater = this._isTotM;
        if (!isTheater) {
            this._attachActivityPhaseCanvasChrome();
            await this.close({});
        }
    }

_attachActivityPhaseCanvasChrome() {
        const runActivate = () => {
            try {
                this._activateCanvasStationLayer();
            } catch (err) {

                console.error(`${MODULE_ID} | _activateCanvasStationLayer failed`, err);
            }
        };
        if (canvas?.ready) runActivate();
        else Hooks.once("canvasReady", runActivate);
        if (this._isGM) {
            _showGmRestIndicator(this);
        }
        this._updateRestBarProgress();
    }

_tearDownStationLayerCanvas() {
        deactivateStationLayer();
        this._stationCanvasIdByCharacter?.clear();
    }

    _removeGmStationTokenSyncHook() {
        if (this._gmControlTokenHook) {
            Hooks.off("controlToken", this._gmControlTokenHook);
            this._gmControlTokenHook = null;
        }
    }

    _installGmStationTokenSyncHook() { this._session._installGmStationTokenSyncHook(); }

_hasDiscoveryGrant(grantKey) {
        const colon = grantKey?.indexOf?.(":") ?? -1;
        if (colon < 0) return false;
        return this._grantLedger?.has(
            GrantLedger.discoverySlotKey(grantKey.slice(0, colon), grantKey.slice(colon + 1))
        ) ?? false;
    }

    _getDiscoveryGrant(grantKey) {
        const colon = grantKey?.indexOf?.(":") ?? -1;
        if (colon < 0) return null;
        return this._grantLedger?.get(
            GrantLedger.discoverySlotKey(grantKey.slice(0, colon), grantKey.slice(colon + 1))
        ) ?? null;
    }

hasCompletedCrafting(actorId, professionId = null) {
        if (!actorId) return false;
        if (this._craftingResults?.has(actorId)) return true;
        return this._grantLedger?.hasCraftingForActor(actorId, professionId) ?? false;
    }

    async _clearRestState() {
        if (!game.user.isGM) return;
        this._clearTavernTotmOverride();
        this._grantLedger?.reset();
        try {
            await game.settings.set(MODULE_ID, "activeRest", {});
        } catch (e) {
            // Setting may not be registered yet
        }
    }

_refreshLedgerApp() {
        if (this._restLedgerApp?.rendered) {
            this._restLedgerApp.render();
        }
    }

    /** EventResolver.load applies pool selection at ingest; reload after curator save. */
    async _refreshEventPool() {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain;
        this._eventResolver = new EventResolver();
        await this._loadData();
        if (terrainTag) {
            await this._loadTerrainEvents(terrainTag);
        }
    }

    async _loadData() { return this._session._loadData(); }

    async _loadContentPacks() { return this._session._loadContentPacks(); }

    _forageResolverOpts() {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? this._restData?.terrainTag ?? "forest";
        const travelResolver = GatherYieldService.getResolver?.() ?? null;
        const available = ForageActivityValidator.isForageAvailable(travelResolver, terrainTag);
        const gate = available ? { disabled: false, disabledReasonKey: null } : { disabled: true, disabledReasonKey: "ionrift-respite.travel.forage.requires_pack" };
        return {
            forageActivityGate: gate,
            terrainTag,
            resourcePoolsFromPack: false,
            resourcePoolRoller: travelResolver?.resourcePoolRoller ?? null,
            travelResolver
        };
    }

_isTavernTerrain() {
        return (this._selectedTerrain ?? this._engine?.terrainTag ?? this._restData?.terrainTag ?? "") === "tavern";
    }

async _onSetupTerrainChanged(prevTerrain, nextTerrain) {
        this._selectedTerrain = nextTerrain;
        this._selectedWeather = this._resolveSetupWeather(nextTerrain);
        if (prevTerrain === "tavern" && nextTerrain !== "tavern") {
            this._safeRestPulseAlert = true;
            try {
                await game.settings.set(MODULE_ID, "safeRestSpot", false);
            } catch (e) {
                console.warn(`${MODULE_ID} | safeRestSpot setting`, e);
            }
        } else if (nextTerrain === "tavern") {
            this._safeRestPulseAlert = false;
        }
        this.render();
    }

_activityResolverOpts(overrides = {}) {
        const tavernRest = this._isTavernTerrain();
        const safeRestSpot = this._effectiveSafeRestSpot() || tavernRest;
        const hasMansionHearth = Boolean(
            this._shelterOverrides?.magnificent_mansion
            || (this._engine?.activeShelters ?? []).includes("magnificent_mansion")
        );
        const fireLevel = overrides.fireLevel ?? (hasMansionHearth ? "campfire" : (this._fireLevel ?? "unlit"));
        const isFireLit = overrides.isFireLit ?? !!(fireLevel && fireLevel !== "unlit");
        return {
            safeRestSpot,
            tavernRest,
            isFireLit,
            fireLevel,
            ...this._forageResolverOpts(),
            ...overrides
        };
    }

_shouldShowEventPoolNudge(terrainTag) {
        if (!game.user.isGM) return false;
        if (this._phase !== "events" || this._eventsRolled) return false;
        if (countPoolEventsForTerrain(this._eventResolver, terrainTag) > 0) return false;
        const snoozedUntil = game.settings.get(MODULE_ID, "eventPoolNudgeSnoozedUntil");
        if (snoozedUntil) {
            const snoozeDate = new Date(snoozedUntil);
            if (!isNaN(snoozeDate.getTime()) && snoozeDate > new Date()) return false;
        }
        return true;
    }

    async _loadTerrainEvents(terrainTag) { return this._session._loadTerrainEvents(terrainTag); }

    async _loadTerrainEventsFromOverlay(terrainTag) { return this._session._loadTerrainEventsFromOverlay(terrainTag); }

    _bindRestWindowUserMoveTracking() {
        return this._windowLayout.bindUserMoveTracking(...arguments);
    }

    _campRestWindowTargetWidth() { return this._windowLayout.campRestWindowTargetWidth(...arguments); }

    _repositionFilmingRestWindow(_options = {}) { return this._windowLayout.repositionFilmingRestWindow(...arguments); }

    _scheduleFilmingWindowReposition(_options = {}) { return this._windowLayout.scheduleFilmingWindowReposition(...arguments); }

    _presetRestWindowForCampEntry() { return this._windowLayout.presetRestWindowForCampEntry(...arguments); }

    _applyRestWindowPosition(pos, { _smooth = false, _filming = false, _durationMs } = {}) { return this._windowLayout.applyRestWindowPosition(...arguments); }

    _animateFilmingRestWindowPosition(targetPos, _durationMs = 420) { return this._windowLayout.animateFilmingRestWindowPosition(...arguments); }

    async _finalizeCampPhaseWindowLayout() { return await this._windowLayout.finalizeCampPhaseWindowLayout(...arguments); }

    _shouldAutoRecenterRestWindow() { return this._windowLayout.shouldAutoRecenterRestWindow(...arguments); }

    _disposeRestWindowResizeObserver() {
        return this._windowLayout.disposeRestWindowResizeObserver(...arguments);
    }

    _bindRestWindowResizeObserver() {
        return this._windowLayout.bindRestWindowResizeObserver(...arguments);
    }

    _beginRestWindowRecenterSuppression() {
        return this._windowLayout.beginRestWindowRecenterSuppression(...arguments);
    }

    _endRestWindowRecenterSuppression(_schedule = true) {
        return this._windowLayout.endRestWindowRecenterSuppression(...arguments);
    }

    _scheduleRestWindowRecenter(_options = {}) { return this._windowLayout.scheduleRestWindowRecenter(...arguments); }

    _recenterRestSetupWindow(_options = {}) {
        return this._windowLayout.recenterRestSetupWindow(...arguments);
    }
    _setShowCampfireCanvasPanel(_v) {
    }
    _buildCampConditionsBar(campScanData, { safeRestSpot = false, encountersEnabled = true } = {}) {
        if ((this._phase !== "camp" && this._phase !== "activity") || !this._engine) return null;
        const effectiveFire = (this._campColdCampDecided || this._coldCampPreview)
            ? "cold_camp"
            : (this._fireLevel && this._fireLevel !== "unlit")
                ? this._fireLevel
                : (this._campFirePreviewLevel ?? this._engine?.fireLevel ?? "embers");
        return buildCampConditionsBar({
            terrainTag: this._engine.terrainTag ?? "forest",
            weatherKey: this._engine.weather ?? "clear",
            fireLevel: effectiveFire,
            activeShelters: this._engine.activeShelters ?? [],
            campScanData,
            safeRestSpot,
            encountersEnabled,
            isGM: game.user?.isGM
        });
    }

_resolveSetupWeather(terrainTag, candidate) {
        const valid = TerrainRegistry.getWeather(terrainTag);
        const defaultKey = valid[0] ?? "clear";
        let lastWeather = "";
        try {
            lastWeather = game.settings.get(MODULE_ID, "lastWeather") ?? "";
        } catch { /* settings not ready */ }
        const pick = candidate ?? this._selectedWeather ?? (lastWeather || defaultKey);
        return valid.includes(pick) ? pick : defaultKey;
    }

    async _prepareContext(options) {
        if (!this._activities || this._activities.length === 0) {
            await this._loadData();
        }
        const ctx = await this._prepareCtx.build(options);
        if (ctx && !ctx.isLoading) this._campLogistics.mergeContext(ctx);
        return ctx;
    }

    _buildCraftingDrawerContext() { return this._crafting.buildContext(); }

    getArmorWarningForActivityDetail(actor, tile) {
        const aw = this._buildArmorWarningForActor(actor);
        if (!aw || !tile) return null;
        if (aw.isDoffed) return aw;
        if (!tile.armorSleepWaiver) return aw;
        return null;
    }

    _bindArmorToggleHandlers(element, onAfter) { this._session._bindArmorToggleHandlers(element, onAfter); }

isCampfireStationFlavorOnly() {
        return this._phase === "activity" && !this._isTotM && !isComfortEnabled();
    }

getCampfireStationDialogTabs() {
        if (this._phase !== "activity" || this._isTotM) return [];
        if (this.isCampfireStationFlavorOnly()) {
            return [{ id: "camp", label: game.i18n.localize("ionrift-respite.restSetup.tabs.camp") }];
        }
        if (!this.getFireTabContextForStationDialog()) return [];
        return [
            { id: "camp", label: game.i18n.localize("ionrift-respite.restSetup.tabs.camp") },
            { id: "fire", label: game.i18n.localize("ionrift-respite.restSetup.tabs.fire") }
        ];
    }

getCampComfortAdvisoryForStationDialog() {
        if (this.isCampfireStationFlavorOnly()) return null;
        const campScanData = this._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;
        const mapComfortTier = campScanData.campComfort ?? "rough";
        const mapComfortLabel = campScanData.campComfortLabel ?? "";
        const mapComfortLine = campScanData.comfortReason
            ? `${campScanData.terrainLabel ? `${campScanData.terrainLabel}: ` : ""}${campScanData.comfortReason}`
            : (campScanData.terrainLabel
                ? `${campScanData.terrainLabel} (${mapComfortLabel})`
                : `Camp comfort: ${mapComfortLabel}`);
        const mapComfortTierClass = `comfort-${mapComfortTier}`;
        return { mapComfortTier, mapComfortLabel, mapComfortLine, mapComfortTierClass };
    }
setStationFirePreviewLevel(level) {
        const next = ["embers", "campfire", "bonfire"].includes(level) ? level : null;
        if (this._stationFirePreviewLevel === next) return;
        this._stationFirePreviewLevel = next;
    }
    _onRenderBindings(context, options) {
        this._renderBindings._onRenderBindings(context, options);
    }
    _onRender(context, options) { this._session._onRender(context, options); }
    async _autoGrantPartyDiscoveries() { return this._resolve._autoGrantPartyDiscoveries(); }
    _broadcastMakeCampPhaseSync() {
        const snapshot = this.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
        emitPhaseChanged("camp", {
            selectedTerrain: this._selectedTerrain ?? null,
            fireLevel: this._fireLevel ?? "unlit",
            coldCampDecided: !!this._coldCampDecided,
            campFirePreviewLevel: this._campFirePreviewLevel ?? null,
            coldCampPreview: !!this._coldCampPreview,
            makeCampStagedWood: [...(this._makeCampStagedWood ?? [])]
        });
    }
    /** Sleep status id. Only Keep Watch stays alert. Defenses do not. */
    _beddingStatusEffectId() {
        const fromConfig = CONFIG.statusEffects?.find?.(e => e.id === "incapacitated");
        if (fromConfig) return "incapacitated";
        if ( CONFIG.statusEffects?.find?.(e => e.id === "unconscious") ) return "unconscious";
        return "incapacitated";
    }

    /** Keep Watch only, not the full alert roster. */
    _nightWatchActorIds() {
        const ids = new Set();
        for (const [characterId, entry] of this._engine?.characterChoices ?? []) {
            if (entry?.activityId === "act_keep_watch") ids.add(characterId);
        }
        return ids;
    }

    /** Incapacitated overlay; prone for posture. */
    _beddingStatusIds() {
        return game.ionrift?.respite?.adapter?.getBeddingStatusIds?.()
            ?? ["incapacitated", "prone"];
    }

    async _applyBeddingDown() { return this._session._applyBeddingDown(); }

    async _removeBeddingDown() { return this._session._removeBeddingDown(); }

    async _autoProcessRations() { return this._meals._autoProcessRations(); }
    _openCampfire() { return this._campCeremony._openCampfire(...arguments); }

    _closeCampfire(_options = {}) {
        return this._campCeremony._closeCampfire(...arguments);
    }

    async _restoreCampfireUiAfterReconnect() { return await this._campCeremony._restoreCampfireUiAfterReconnect(...arguments); }

    async _syncCampfireTokenFromRestState() { return await this._campCeremony._syncCampfireTokenFromRestState(...arguments); }

    _activityFireUiEnabled() { return this._campCeremony._activityFireUiEnabled(...arguments); }

    _totmFireUiEnabled() { return this._campCeremony._totmFireUiEnabled(...arguments); }

    _stationsFireMinigameEnabled() { return this._campCeremony._stationsFireMinigameEnabled(...arguments); }

    isStationFireMinigameTab() { return this._campCeremony.isStationFireMinigameTab(...arguments); }

    mountStationFireMinigame(host, _dialog = null) { return this._campCeremony.mountStationFireMinigame(...arguments); }

    releaseStationFireMinigame(_dialog = null) { return this._campCeremony.releaseStationFireMinigame(...arguments); }

    _totmCampfireMinigamePanelEnabled() { return this._campCeremony._totmCampfireMinigamePanelEnabled(...arguments); }

    _shouldShowTotmCampfirePanel() { return this._campCeremony._shouldShowTotmCampfirePanel(...arguments); }
    _shouldMountFireRailEmbed() { return this._campCeremony._shouldMountFireRailEmbed(...arguments); }

    _campfireReconnectGateDetail() { return this._campCeremony._campfireReconnectGateDetail(...arguments); }

    _totmFireTabVisible() { return this._campCeremony._totmFireTabVisible(...arguments); }

    _isCampColdCampPreview() {
        return this._campCeremony._isCampColdCampPreview(...arguments);
    }

    _partyFirewoodTotal() {
        return this._campCeremony._partyFirewoodTotal(...arguments);
    }

    _campPreviewFirewoodCost(_level = null) {
        return this._campCeremony._campPreviewFirewoodCost(...arguments);
    }

    _portraitForCeremonyActor(_actorId, _userId) {
        return this._campCeremony._portraitForCeremonyActor(...arguments);
    }

    _stagedWoodCountForActor(_actorId) {
        return this._campCeremony._stagedWoodCountForActor(...arguments);
    }

    _canReclaimCeremonyStagedSlot(_slot) {
        return this._campCeremony._canReclaimCeremonyStagedSlot(...arguments);
    }

    _buildMakeCampCeremonyRequirementSlots() {
        return this._campCeremony._buildMakeCampCeremonyRequirementSlots(...arguments);
    }

    _maybeClearStagedWoodOnTierChange(_newLevel) {
        return this._campCeremony._maybeClearStagedWoodOnTierChange(...arguments);
    }

    async clearCeremonyStagedWood({ _silent = false } = {}) {
        return await this._campCeremony.clearCeremonyStagedWood(...arguments);
    }

    async stageCeremonyWood(_userId, _actorId) {
        return await this._campCeremony.stageCeremonyWood(...arguments);
    }

    async giftCeremonyWoodToFocusedActor() { return await this._campCeremony.giftCeremonyWoodToFocusedActor(...arguments); }

    async unstageCeremonyWood(_slotId) {
        return await this._campCeremony.unstageCeremonyWood(...arguments);
    }

    async _spendCeremonyStagedWood(_cost) {
        return await this._campCeremony._spendCeremonyStagedWood(...arguments);
    }

    _syncCampCeremonyPreviewToEmbed(_syncOpts = {}) {
        return this._campCeremony._syncCampCeremonyPreviewToEmbed(...arguments);
    }

    _emitCampCeremonyPhaseSync(_extra = {}) {
        return this._campCeremony._emitCampCeremonyPhaseSync(...arguments);
    }

    _campCeremonyMinigameEnabled() { return this._campCeremony._campCeremonyMinigameEnabled(...arguments); }

    async _commitMakeCampCeremonyIgnite(_opts = {}) { return await this._campCeremony._commitMakeCampCeremonyIgnite(...arguments); }

    async _totmAdvanceCampAfterCeremonyIgnite() { return await this._campCeremony._totmAdvanceCampAfterCeremonyIgnite(...arguments); }

    async _totmSpendMakeCampFirewood() { return await this._campCeremony._totmSpendMakeCampFirewood(...arguments); }
    _syncTotmCampfireEmbedFromRest() {
        return this._campCeremony._syncTotmCampfireEmbedFromRest(...arguments);
    }

    async applyActivityFireLevelFromMinigame(_level) { return await this._campCeremony.applyActivityFireLevelFromMinigame(...arguments); }

    _mountCampfireEmbed(mode, _options = {}) { return this._campCeremony._mountCampfireEmbed(...arguments); }

    _tearDownCampfireEmbed(_reason = "unknown") {
        return this._campCeremony._tearDownCampfireEmbed(...arguments);
    }
    _bindMealDragDrop(el) { this._meals._bindMealDragDrop(el); }

    _bindWorkbenchIdentifyDragDrop(el) { this._workbench.bindDragDrop(el); }
receiveMealChoices(userId, choices) {
        void this._meals.receiveMealChoices(userId, choices).catch(err => {

            console.warn(`${MODULE_ID} | receiveMealChoices`, err);
        });
    }

    async _advanceToEvents() { return this._meals._advanceToEvents(); }

    receiveMealDayConsumeRequest(userId, consumeByCharacter) {
        return this._meals.receiveMealDayConsumeRequest(userId, consumeByCharacter);
    }

    async receiveMealDayConsumed(userId, clientChoices) { await this._meals.receiveMealDayConsumed(userId, clientChoices); }

    async receiveDehydrationPrompt(characterId, actorName, dc) { await this._meals.receiveDehydrationPrompt(characterId, actorName, dc); }

    async receiveDehydrationResult(data) { await this._meals.receiveDehydrationResult(data); }
    async receiveTreeRollResult(data) { return this._events.receiveTreeRollResult(data); }
openLedgerPanel() {
        if (!game.user.isGM) return;
        if (!this._restLedgerApp || !this._restLedgerApp.rendered) {
            this._restLedgerApp = new RestLedgerApp({}, this._restLedger);
            void this._restLedgerApp.render(true).then(() => {
                if (this._restLedgerApp?.element && this.element) {
                    this._restLedgerApp.positionBeside(this.element);
                }
            });
        } else {
            this._restLedgerApp.bringToFront?.();
        }
    }

    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null, earlyResults = null) { this._events.receivePlayerChoices(userId, choices, craftingResults, followUps, earlyResults); }

_updateRestBarProgress() {
        _refreshGmRestIndicator(this);
    }

    _pruneEarlyResultsWithoutChoice() {
        if (!this._earlyResults?.size) return;
        for (const charId of [...this._earlyResults.keys()]) {
            if (!this._characterChoices.has(charId)) this._earlyResults.delete(charId);
        }
    }

    _revertStationActivityChoice(characterId) { this._events._revertStationActivityChoice(characterId); }

_ensureTrainingStateForLockedChoices() {
        if (this._isGM) return;
        for (const charId of this._lockedCharacters ?? []) {
            if (this._characterChoices.get(charId) !== "act_train") continue;
            if (this._earlyResults?.has(charId)) continue;
            if (this._trainingStates?.has(charId)) continue;
            const actor = game.actors.get(charId);
            if (!actor?.isOwner) continue;
            this._initTrainingState(charId, "act_train", actor);
        }
    }

    _syncIncompleteTrainingView() { this._training._syncIncompleteTrainingView(); }

    _clearStaleTrainingRollingFlags() {
        for (const state of this._trainingStates?.values() ?? []) {
            state.rolling = false;
        }
    }

    _initTrainingState(characterId, activityId, actor) { this._session._initTrainingState(characterId, activityId, actor); }
    async finalizeActivityChoiceFromStation(characterId, activityId, _canvasStationId = null, _options = {}) { return await this._stations.finalizeActivityChoiceFromStation(...arguments); }
    _refreshStationOverlayForFocusChange() { return this._stations._refreshStationOverlayForFocusChange(...arguments); }

    _actorOwesActivityPhaseMealRations(_actorId) { return this._stations._actorOwesActivityPhaseMealRations(...arguments); }

    _buildStationEmptyNoticeMap() { return this._stations._buildStationEmptyNoticeMap(...arguments); }

    _refreshStationOverlayMeals() {
        return this._stations._refreshStationOverlayMeals(...arguments);
    }

    _getPendingMealCanvasPlan() { return this._stations._getPendingMealCanvasPlan(...arguments); }

    _activateCanvasStationLayer() { return this._stations._activateCanvasStationLayer(...arguments); }

    refreshCanvasStationOverlaysIfActivity() { return this._stations.refreshCanvasStationOverlaysIfActivity(...arguments); }

    refreshOpenStationDialogAfterCampGear() { return this._stations.refreshOpenStationDialogAfterCampGear(...arguments); }
    _rebuildCharacterChoices() {
        return this._stations._rebuildCharacterChoices(...arguments);
    }

    getPartyStateForAdvisory() { return this._stations.getPartyStateForAdvisory(...arguments); }

    getStationMealCardForActor(_actorId) { return this._stations.getStationMealCardForActor(...arguments); }

    _buildSatiatesLookup() { return this._stations._buildSatiatesLookup(...arguments); }

    _autoTrimExcessWater(_charId) { return this._stations._autoTrimExcessWater(...arguments); }

    getStationIdentifyEmbedContext(_options = {}) { return this._stations.getStationIdentifyEmbedContext(...arguments); }

    canShowDetectMagicScanButtonFromParty() { return this._stations.canShowDetectMagicScanButtonFromParty(...arguments); }

    canTriggerDetectMagicScanFromParty() { return this._stations.canTriggerDetectMagicScanFromParty(...arguments); }

    getWorkbenchIdentifyDragContext(actorId) { return this._workbench.getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors); }

    dismissWorkbenchIdentifyAcknowledgement(actorId) { this._workbench.dismissAcknowledgement(actorId); }

    _clearDetectMagicScanSession(opts = {}) { this._detectMagic.clearScanSession(opts); }

    async attuneWorkbenchItemForActor(_actorId, _itemId) { return await this._stations.attuneWorkbenchItemForActor(...arguments); }

    async submitActivityMealRationsFromStation(_actorId) { return await this._stations.submitActivityMealRationsFromStation(...arguments); }

    async unlockSustenance(_actorId) { return await this._stations.unlockSustenance(...arguments); }

    _getPlayerChoiceForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            if (!submission?.choices || typeof submission.choices !== "object") continue;
            if (submission.choices[characterId]) {
                return {
                    activityId: submission.choices[characterId],
                    userName: submission.userName
                };
            }
        }
        return null;
    }

    _getFollowUpForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            if (submission.followUps?.[characterId]) {
                return submission.followUps[characterId];
            }
        }
        return null;
    }

    getRestSnapshot() { return this._sync.getRestSnapshot(...arguments); }

    getRestSnapshotForUser(_userId) { return this._sync.getRestSnapshotForUser(...arguments); }

    async receivePhaseChange(phase, _phaseData = {}) { return await this._sync.receivePhaseChange(...arguments); }

    receiveSubmissionUpdate(_submissions) { return this._sync.receiveSubmissionUpdate(...arguments); }

    receiveRestSnapshot(_snapshot) { return this._sync.receiveRestSnapshot(...arguments); }

    receiveArmorToggle(_actorId, _itemId, _isDoffed) { return this._sync.receiveArmorToggle(...arguments); }
    async _spendPartyFirewoodForMakeCamp(cost, requestingUserId = null) { return this._session._spendPartyFirewoodForMakeCamp(cost, requestingUserId); }

    /** Sets fire tier now; firewood spends on Proceed to activities, not here. */
    async _skipCampForTheater() { return this._session._skipCampForTheater(); }

    async _skipCampForSafeRest() { return this._session._skipCampForSafeRest(); }

    _healOrphanCampfirePlacementState() { return this._campPlacement._healOrphanCampfirePlacementState(...arguments); }

    async _autoLightCampfireForComfortOffStations() { return this._session._autoLightCampfireForComfortOffStations(); }

    async _skipCampForComfortOff() { return this._session._skipCampForComfortOff(); }

async _advanceCampToActivity() { return this._session._advanceCampToActivity(); }

    _cancelCampPlacementCanvasMode() { return this._campPlacement._cancelCampPlacementCanvasMode(...arguments); }

    _campPlacementStillActive() { return this._campPlacement._campPlacementStillActive(...arguments); }

    _pickPitWorldPoint(_options = {}) { return this._campPlacement._pickPitWorldPoint(...arguments); }

    async _commitStationsCampPlacement(worldX, worldY, _options = {}) { return await this._campPlacement._commitStationsCampPlacement(...arguments); }

    async _startCampPitCursorFlow() { return await this._campPlacement._startCampPitCursorFlow(...arguments); }

    async _refreshCampPitNoticeLayer() { return await this._campPlacement._refreshCampPitNoticeLayer(...arguments); }
_resetTotmCraftState() {
        this._totmCraftRecipeId = null;
        this._totmCraftRisk = "standard";
        this._totmCraftResult = null;
        this._totmCraftHasCrafted = false;
        this._totmCraftShowMissing = false;
        this._totmCraftRollPending = false;
        this._totmFeastServed = false;
        this._totmFeastInFlight = false;
    }

_hydrateTotmCraftStateFromRest(characterId, profession) {
        if (!characterId) return false;
        const prior = this._craftingResults?.get(characterId);
        if (!prior && !this.hasCompletedCrafting(characterId, profession)) return false;
        this._totmCraftResult = prior ?? { success: true, narrative: "Craft already completed this rest." };
        this._totmCraftHasCrafted = true;
        this._totmCraftRecipeId = prior?.recipeId ?? null;
        return true;
    }
    async _runSetCampFireLevelForGm(level, _requestingUserId = null, _gmOverride = false) {
        return await this._campPlacement._runSetCampFireLevelForGm(...arguments);
    }

    async changeFireLevelDuringActivity(level, { _fromPlayer = false, _requestingUserId = null, _fromMinigame = false } = {}) { return await this._campPlacement.changeFireLevelDuringActivity(...arguments); }

    async setColdCampDuringActivity({ _fromPlayer = false } = {}) { return await this._campPlacement.setColdCampDuringActivity(...arguments); }
    _holdWindowHeight() {
        const height = this.element?.offsetHeight;
        if (height > 0) this.position.height = height;
    }
    applySustenanceChip(kind, itemId, actorId, target = {}) {
        const id = actorId || this._selectedCharacterId;
        if (!id || !itemId) return;
        const slot = kind === "food" && Number.isInteger(target.foodSlot) ? target.foodSlot : undefined;
        this._meals.assignDiegeticItem(id, kind === "water" ? "water" : "food", itemId, slot, target.available, target.sources);
    }
    checkAndAutoMarkCharacterReady(actorId) {
        if (!actorId) return;
        const terrainTag = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
        const setupSafeHaven = terrainTag === "tavern"
            || Boolean(this._effectiveSafeRestSpot?.() ?? this._engine?.safeRestSpot ?? this._engine?.isSafeHaven);
        const gatherOn = !setupSafeHaven && (isForagingEnabled() || isHuntingEnabled());
        const { gatherDone, activityDone } = dailyChoiceStatus(this, actorId, gatherOn);
        let trackFoodOn = false;
        let sustenanceDone = false;
        try {
            const mealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
            const hasMealRules = (mealRules.waterPerDay > 0) || (mealRules.foodPerDay > 0);
            trackFoodOn = !!game.settings.get(MODULE_ID, "trackFood") && !setupSafeHaven && hasMealRules;
            if (!trackFoodOn) {
                sustenanceDone = true;
            } else {
                const card = this.getStationMealCardForActor(actorId);
                sustenanceDone = Boolean(this._activityMealRationsSubmitted?.has(actorId))
                    || Boolean(card?.playerSubmitted);
            }
        } catch { /* settings not ready */ }

        const complete = (gatherOn ? gatherDone : true)
            && activityDone
            && (trackFoodOn ? sustenanceDone : true);

        if (complete) {
            if (!this._finishedActorIds) this._finishedActorIds = new Set();
            if (!this._finishedActorIds.has(actorId)) {
                this._finishedActorIds.add(actorId);
                publishCampProgress(this, {
                    finishedActorId: actorId,
                    finished: true
                });
            }
        }
    }
    _applyCampDragGhost(_e, _sourceEl) { return this._campPlacement._applyCampDragGhost(...arguments); }

    _bindCampDragHandlers(_html) { return this._campPlacement._bindCampDragHandlers(...arguments); }

    async _onCampCanvasDrop(_event) { return await this._campPlacement._onCampCanvasDrop(...arguments); }
}

export function applyRestSetupStateHelpers(TargetClass) {
    for (const key of Object.getOwnPropertyNames(RestSetupStateMixin.prototype)) {
        if (key === "constructor") continue;
        Object.defineProperty(
            TargetClass.prototype,
            key,
            Object.getOwnPropertyDescriptor(RestSetupStateMixin.prototype, key)
        );
    }
}
