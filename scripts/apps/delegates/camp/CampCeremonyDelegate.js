import { Logger } from "../../../utils/Logger.js";
import {
    CampGearScanner,
    countActorFirewood,
    findConsumableFirewoodItem
} from "../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import { logCampfireReconnect } from "../../../services/camp/fire/CampfireReconnectLog.js";
import { ItemOutcomeHandler } from "../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import {
    emitPhaseChanged,
    emitCampLightFire,
    emitActivityFireLevelRequest
} from "../../../services/socket/SocketController.js";
import { isComfortEnabled, COMFORT_TIERS } from "../../../services/camp/gear/ComfortCalculator.js";
import { buildCampCeremonyPhasePayload } from "../../../services/camp/gear/campCeremonySync.js";
import { isCampfireMinigameEnabled, isSimpleStationsMode, requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { hasCampfirePlaced } from "../../../services/camp/props/CompoundCampPlacer.js";
import { WEATHER_TABLE, SHELTER_SPELLS } from "../../../data/RestConstants.js";
import { CampfireEmbed } from "../../camp/CampfireEmbed.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { registerCampfireEmbed, clearCampfireEmbed } from "../../../module.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const FIRE_LEVELS = Object.freeze(["unlit", "embers", "campfire", "bonfire"]);

export class CampCeremonyDelegate {

    constructor(app) {
        this._app = app;
    }

    static formatFireLitToastMessage(fireLitBy, fireLevel) {
        if (!fireLitBy || fireLevel === "unlit") return null;
        const name = fireLitBy.actorName ?? "Someone";
        const method = (fireLitBy.method ?? "Tinderbox").trim();
        const tierPhrase = fireLevel === "embers"
            ? "embers"
            : fireLevel === "campfire"
                ? "a campfire"
                : fireLevel === "bonfire"
                    ? "a bonfire"
                    : "the fire";

        let how;
        if (method === "Minigame") {
            how = "during the fire ceremony";
        } else if (method === "GM Override") {
            how = "by GM override";
        } else if (method === "Campfire") {
            how = "at the pit";
        } else if (method === "Tinderbox" || /tinderbox|flint/i.test(method)) {
            how = "with a tinderbox";
        } else {
            how = `with ${method}`;
        }

        if (fireLevel === "embers") {
            return `${name} lights embers ${how}.`;
        }
        return `${name} lights ${tierPhrase} ${how}.`;
    }

    
    static showFireLitToast(fireLitBy, fireLevel) {
        const message = CampCeremonyDelegate.formatFireLitToastMessage(fireLitBy, fireLevel);
        if (message) ui.notifications.info(message);
    }

    get fireLevel() { return this._app._fireLevel ?? "unlit"; }
    set fireLevel(v) { this._app._fireLevel = v; }

    get fireLitBy() { return this._app._fireLitBy ?? null; }
    set fireLitBy(v) { this._app._fireLitBy = v; }

    get firewoodPledges() { return this._app._firewoodPledges; }

    get coldCampDecided() { return !!this._app._coldCampDecided; }
    set coldCampDecided(v) { this._app._coldCampDecided = v; }

    get campFirePreviewLevel() { return this._app._campFirePreviewLevel ?? null; }
    set campFirePreviewLevel(v) { this._app._campFirePreviewLevel = v; }

        deriveCampFireLevel() {
        if (!this.fireLitBy) {
            // Persisted fireLevel may survive a save/restore cycle where
            // fireLitBy was lost. Honour the persisted level so the
            // delegate stays consistent with isFireCommitted() and the
            // player-side campFireIsLit check.
            const persisted = this._app._fireLevel ?? "unlit";
            return persisted !== "unlit" ? persisted : "unlit";
        }
        const total = this._totalPledged();
        if (total <= 0) return "embers";
        if (total === 1) return "campfire";
        return "bonfire";
    }

    _totalPledged() {
        return Array.from(this.firewoodPledges.values()).reduce((s, p) => s + p.count, 0);
    }

    isFireCommitted() {
        if (!isComfortEnabled() && !requiresMapCampFire()) return true;
        return !!this.fireLitBy || this.coldCampDecided;
    }

    static campfireSnapshotFromFireLevel(fireLevel) {
        const fl = fireLevel ?? "unlit";
        if (fl === "unlit") return null;
        return {
            lit: true,
            litBy: null,
            heat: 0,
            strikeCount: 0,
            kindlingPlaced: 0,
            peakHeat: 0,
            lastFireLevel: fl
        };
    }

    
    async lightFire(userId, actorId, method, desiredLevel = null, options = {}) {
        if (!game.user.isGM) return;
        if (this.fireLitBy && (this.fireLevel ?? "unlit") !== "unlit") return;
        if (this._app._campPitBlocksFireLighting?.()) {
            ui.notifications.warn("Place the campfire on the map before lighting.");
            return;
        }
        const actor = game.actors.get(actorId);
        if (!actor) {
            ui.notifications.warn("That character could not be found. Pick another party member or use the GM light override.");
            return;
        }
        const wasUnlit = (this.fireLevel ?? "unlit") === "unlit";
        this.fireLitBy = { userId, actorId, actorName: actor.name, method };
    // Light at the chosen tier in one motion so the picker is the commit; falls back
    // to pledge-derived level (embers with no wood) when no tier was selected.
        const override = ["embers", "campfire", "bonfire"].includes(desiredLevel) ? desiredLevel : null;
        await this._syncFireLevelFromPledges(override, {
            skipRender: !!options.autoAdvanceTotm,
            skipBroadcast: !!options.autoAdvanceTotm,
            notifyFireLit: wasUnlit
        });
        if (wasUnlit && (this.fireLevel ?? "unlit") !== "unlit" && game.user.isGM) {
            CampCeremonyDelegate.showFireLitToast(this.fireLitBy, this.fireLevel);
        }
        const shouldAdvanceTotm = !!options.autoAdvanceTotm && this._app._isTotM;
        if (shouldAdvanceTotm) {
            await this._app._totmAdvanceCampAfterCeremonyIgnite();
        }
    }

    async addFirewoodPledge(userId, actorId) {
        if (!game.user.isGM) return;
        if (!this.fireLitBy && this.fireLevel === "unlit") {
            ui.notifications.warn("Light the fire first.");
            return;
        }
        const total = this._totalPledged();
        if (total >= 2) {
            ui.notifications.warn("The fire is already a bonfire.");
            return;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return;
        const firewoodItem = actor.items.find(i => {
            const n = i.name?.toLowerCase() ?? "";
            return n.includes("firewood") || n === "kindling";
        });
        const existing = this.firewoodPledges.get(userId);
        const pledgedSoFar = existing?.count ?? 0;
        const available = firewoodItem?.system?.quantity ?? 0;
        if (available <= pledgedSoFar) {
            ui.notifications.warn(`${actor.name} has no more firewood to add.`);
            return;
        }
        this.firewoodPledges.set(userId, { actorId, actorName: actor.name, count: pledgedSoFar + 1 });
        await this._syncFireLevelFromPledges();
    }

    async addGmFirewoodPledge() {
        if (!game.user.isGM) return;
        if (!this.fireLitBy && this.fireLevel === "unlit") {
            ui.notifications.warn("Light the fire first.");
            return;
        }
        const total = this._totalPledged();
        if (total >= 2) {
            ui.notifications.warn("The fire is already a bonfire.");
            return;
        }
        const existing = this.firewoodPledges.get(game.user.id);
        const pledgedSoFar = existing?.count ?? 0;
        this.firewoodPledges.set(game.user.id, {
            actorId: null, actorName: "GM", count: pledgedSoFar + 1, gmPledge: true
        });
        await this._syncFireLevelFromPledges();
    }

    async removeFirewoodPledge(userId) {
        if (!game.user.isGM) return;
        if (!this.firewoodPledges.has(userId)) return;
        this.firewoodPledges.delete(userId);
        await this._syncFireLevelFromPledges();
    }

    async selectColdCamp() {
        if (!game.user.isGM) return;
        if (!isComfortEnabled() && !requiresMapCampFire()) return;
        if (this.coldCampDecided && (this.fireLevel ?? "unlit") === "unlit") return;

        this.coldCampDecided = true;
        this.fireLitBy = null;
        this.fireLevel = "unlit";
        this.campFirePreviewLevel = null;
        const FIRE_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (this._app._engine) {
            this._app._engine.fireLevel = "unlit";
            this._app._engine.fireRollModifier = FIRE_MOD.cold_camp ?? 0;
        }
        await CampfireTokenLinker.setLightState(false);
    emitPhaseChanged(this._app._phase, {
            coldCampDecided: true,
            fireLevel: "unlit",
            fireLitBy: null,
            selectedTerrain: this._app._selectedTerrain ?? null
        });
        await this._app._saveRestState();
        this._app.render();
    }

    async decideColdCamp() {
        if (!game.user.isGM) return;
        await this.selectColdCamp();
        const _isTotmCold = this._app._isTotM;
        if (!_isTotmCold
            && isSimpleStationsMode()
            && this._app._phase === "camp"
            && !this._app._campToActivityDone) {
            await this._app._advanceCampToActivity();
        }
    }

        async _syncFireLevelFromPledges(overrideLevel = null, options = {}) {
        const level = ["embers", "campfire", "bonfire"].includes(overrideLevel)
            ? overrideLevel
            : this.deriveCampFireLevel();
        this.fireLevel = level;
        this.campFirePreviewLevel = null;
        const FIRE_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (this._app._engine) {
            this._app._engine.fireLevel = level;
            this._app._engine.fireRollModifier = FIRE_MOD[level] ?? 0;
        }
        await CampfireTokenLinker.setLightState(level !== "unlit", level !== "unlit" ? level : undefined);
        const shouldNotifyFireLit = !!options.notifyFireLit
            && !!this.fireLitBy
            && level !== "unlit";
        const phasePayload = {
            fireLevel: level,
            fireLitBy: this.fireLitBy,
            firewoodPledges: Array.from(this.firewoodPledges.entries()),
            selectedTerrain: this._app._selectedTerrain ?? null,
            ...(shouldNotifyFireLit ? { fireLitNotice: true } : {})
        };
        if (!options.skipBroadcast) {
            emitPhaseChanged("camp", phasePayload);
            await this._app._saveRestState();
        } else if (shouldNotifyFireLit) {
            emitPhaseChanged("camp", phasePayload);
        }
        const _isTotm = this._app._isTotM;
        const willAdvance =
            !_isTotm
            && this._app._phase === "camp"
            && !this._app._campToActivityDone
            && this.fireLevel !== "unlit"
            && (isSimpleStationsMode() || isComfortEnabled());
        if (willAdvance) {
            await this._app._maybeSpendMakeCampCeremonyWoodBeforeAdvance();
            await this._app._advanceCampToActivity();
        } else if (!this._app._campToActivityDone && !options.skipRender) {
            this._app.render();
        }
    }

    serialize() {
        return {
            fireLevel: this.fireLevel,
            fireLitBy: this.fireLitBy,
            firewoodPledges: Array.from(this.firewoodPledges.entries()),
            coldCampDecided: this.coldCampDecided
        };
    }

    restore(state) {
        if (!state) return;
        this.fireLevel = state.fireLevel ?? "unlit";
        this.fireLitBy = state.fireLitBy ?? null;
        this._app._firewoodPledges = new Map(state.firewoodPledges ?? []);
        this.coldCampDecided = state.coldCampDecided ?? false;
    }
    _openCampfire() {
        const app = this._app;

        const magicalShelters = ["tiny_hut", "rope_trick", "magnificent_mansion"];
        const activeShelterIds = Object.entries(app._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        if (activeShelterIds.some(id => magicalShelters.includes(id))) {

            Logger.log(`${MODULE_ID} | Campfire drawer skipped: magical shelter active`);
            return;
        }

        const drawerContainer = app.element?.querySelector(".campfire-drawer-content");
        if (!drawerContainer) {

            console.warn(`${MODULE_ID} | No .campfire-drawer-content found in DOM`);
            return;
        }

        const level = app._fireLevel ?? "unlit";
        const LEVEL_LABELS = {
            unlit: "Unlit",
            embers: "Embers",
            campfire: "Campfire",
            bonfire: "Bonfire"
        };
        drawerContainer.innerHTML = `
            <div class="campfire-static-status">
                <div class="campfire-static-inner">
                    <i class="fas fa-fire" aria-hidden="true"></i>
                    <span class="campfire-static-title">${LEVEL_LABELS[level] ?? level}</span>
                </div>
                <p class="campfire-static-hint">Fire level was chosen during Make Camp.</p>
            </div>`;
        const drawer = app.element?.querySelector(".campfire-drawer");
        if (drawer) drawer.classList.add("open");
    
    }

    _closeCampfire(options = {}) {
        const app = this._app;

        const keepEmbed = !!options.preserveActivityEmbed || this._shouldShowTotmCampfirePanel();
        logCampfireReconnect("closeCampfire", {
            phase: app._phase,
            keepEmbed,
            preserveOption: !!options.preserveActivityEmbed,
            shouldShowPanel: this._shouldShowTotmCampfirePanel(),
            hasCampfireApp: !!app._campfireApp,
            fireLevel: app._fireLevel ?? "unlit",
            ...this._campfireReconnectGateDetail()
        });
        if (!keepEmbed) {
            this._tearDownCampfireEmbed("closeCampfire");
        }
        const drawerContent = app.element?.querySelector(".campfire-drawer-content");
        if (drawerContent) drawerContent.innerHTML = "";
        const drawer = app.element?.querySelector(".campfire-drawer");
        if (drawer) drawer.classList.remove("open");
    
    }

    async _restoreCampfireUiAfterReconnect() {
        const app = this._app;

        logCampfireReconnect("restoreCampfireUi:enter", {
            phase: app._phase,
            rendered: app.rendered,
            fireLevel: app._fireLevel ?? "unlit",
            coldCampDecided: !!app._coldCampDecided,
            shouldShowPanel: this._shouldShowTotmCampfirePanel(),
            hasCampfireApp: !!app._campfireApp,
            hostInDom: !!app.element?.querySelector(".totm-campfire-minigame-host"),
            ...this._campfireReconnectGateDetail()
        });
        if (!app.rendered) {
            logCampfireReconnect("restoreCampfireUi:skip", { reason: "not rendered" });
            return;
        }

        if (app._phase === "activity" && this._shouldShowTotmCampfirePanel()) {
            if (!app._campfireApp) {
                logCampfireReconnect("restoreCampfireUi:mount", { mode: "activity" });
                this._mountCampfireEmbed("activity");
                return;
            }
            logCampfireReconnect("restoreCampfireUi:syncExistingEmbed", {
                fireLevel: app._fireLevel ?? "unlit",
                embedLit: app._campfireApp?._lit,
                embedHeat: app._campfireApp?._heat
            });
            app._campfireApp.syncFromRestFireLevel(
                app._fireLevel ?? "unlit",
                !!app._coldCampDecided,
                { force: true }
            );
            registerCampfireEmbed(app._campfireApp);
            await app._campfireApp.render();
            logCampfireReconnect("restoreCampfireUi:embedRendered", {
                embedLit: app._campfireApp?._lit,
                embedFireLevel: app._campfireApp?.fireLevel
            });
            return;
        }

        logCampfireReconnect("restoreCampfireUi:noPanel", {
            phase: app._phase,
            shouldShowPanel: this._shouldShowTotmCampfirePanel(),
            ...this._campfireReconnectGateDetail()
        });

        if (app._phase === "camp" && this._campCeremonyMinigameEnabled()) {
            if (!app._campfireApp) {
                this._mountCampfireEmbed("camp");
                return;
            }
            this._syncCampCeremonyPreviewToEmbed();
            await app._campfireApp.render();
            return;
        }

        if (game.user.isGM) {
            await this._syncCampfireTokenFromRestState();
        }
    
    }

    async _syncCampfireTokenFromRestState() {
        const app = this._app;

        if (!game.user.isGM) return;
        const level = app._fireLevel ?? "unlit";
        if (app._coldCampDecided || level === "unlit") {
            await CampfireTokenLinker.setLightState(false);
        } else if (["embers", "campfire", "bonfire"].includes(level)) {
            await CampfireTokenLinker.setLightState(true, level);
        }
    
    }

    _activityFireUiEnabled() {
        const app = this._app;

        if (app._phase !== "activity") return false;
        if (!isComfortEnabled()) return false;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeFromSetting);
        if (effectiveSafe || app._isTavernTerrain()) return false;
        const magicalShelters = ["tiny_hut", "rope_trick", "magnificent_mansion"];
        const activeShelterIds = Object.entries(app._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        if (activeShelterIds.some(id => magicalShelters.includes(id))) return false;
        return true;
    
    }

    _totmFireUiEnabled() {
        const app = this._app;

        return app._isTotM && this._activityFireUiEnabled();
    
    }

    _stationsFireMinigameEnabled() {
        const app = this._app;

        return !app._isTotM
            && app._phase === "activity"
            && isCampfireMinigameEnabled()
            && this._activityFireUiEnabled()
            && !app.isCampfireStationFlavorOnly();
    
    }

    isStationFireMinigameTab() {
        const app = this._app;

        return this._stationsFireMinigameEnabled();
    
    }

    mountStationFireMinigame(host, dialog = null) {
        const app = this._app;

        if (!host || !this._stationsFireMinigameEnabled()) return;
        app._stationFireMinigameDialog = dialog;
        this._mountCampfireEmbed("station", { host });
    
    }

    releaseStationFireMinigame(dialog = null) {
        const app = this._app;

        if (app._campfireEmbedHost !== "station") return;
        if (dialog && app._stationFireMinigameDialog && dialog !== app._stationFireMinigameDialog) return;
        this._tearDownCampfireEmbed("stationDialogRelease");
        app._campfireEmbedHost = null;
        app._stationFireMinigameDialog = null;
    
    }

    _totmCampfireMinigamePanelEnabled() {
        const app = this._app;

        return isCampfireMinigameEnabled() && this._totmFireUiEnabled();
    
    }

    _shouldShowTotmCampfirePanel() {
        const app = this._app;

        if (app._phase !== "activity" || !app._isTotM || !isCampfireMinigameEnabled()) return false;
        if (!this._totmFireUiEnabled()) return false;
        if (this._totmCampfireMinigamePanelEnabled()) return true;
        return (app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided;
    
    }

    _campfireReconnectGateDetail() {
        const app = this._app;

        let safeFromSetting = false;
        let minigameSetting = false;
        let restMode = "?";
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
            minigameSetting = !!game.settings.get(MODULE_ID, "enableCampfireMinigame");
            restMode = game.settings.get(MODULE_ID, "restInterfaceMode") ?? "?";
        } catch { /* settings not ready */ }
        const magicalShelters = ["tiny_hut", "rope_trick", "magnificent_mansion"];
        const activeShelterIds = Object.entries(app._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        return {
            isTotM: app._isTotM,
            restInterfaceMode: restMode,
            enableCampfireMinigame: minigameSetting,
            isCampfireMinigameEnabled: isCampfireMinigameEnabled(),
            isComfortEnabled: isComfortEnabled(),
            effectiveSafeRest: !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeFromSetting),
            magicalShelterActive: activeShelterIds.some(id => magicalShelters.includes(id)),
            totmFireUiEnabled: this._totmFireUiEnabled(),
            totmCampfireMinigamePanelEnabled: this._totmCampfireMinigamePanelEnabled()
        };
    
    }

    _totmFireTabVisible() {
        const app = this._app;

        return this._totmFireUiEnabled() && !isCampfireMinigameEnabled();
    
    }

    _isCampColdCampPreview() {
        const app = this._app;

        return !!app._coldCampPreview || app._campFirePreviewLevel === "cold_camp";
    
    }

    _partyFirewoodTotal() {
        const app = this._app;

        return getPartyActors().reduce((sum, a) => sum + countActorFirewood(a), 0);
    
    }

    _campPreviewFirewoodCost(level = null) {
        const app = this._app;

        const lv = level ?? app._campFirePreviewLevel ?? "embers";
        if (lv === "cold_camp") return 0;
        return CampGearScanner.FIREWOOD_COST_BY_LEVEL[lv] ?? 0;
    
    }

    _portraitForCeremonyActor(actorId, userId) {
        const app = this._app;

        const actor = game.actors.get(actorId);
        if (actor?.img) return actor.img;
        const user = game.users.get(userId);
        return user?.avatar ?? "";
    
    }

    _stagedWoodCountForActor(actorId) {
        const app = this._app;

        return (app._makeCampStagedWood ?? []).filter(s => s.actorId === actorId).length;
    
    }

    _canReclaimCeremonyStagedSlot(slot) {
        const app = this._app;

        if (!slot) return false;
        return game.user.isGM || slot.userId === game.user.id;
    
    }

    _buildMakeCampCeremonyRequirementSlots() {
        const app = this._app;

        const level = this._isCampColdCampPreview() ? null : (app._campFirePreviewLevel ?? "embers");
        const cost = level ? this._campPreviewFirewoodCost(level) : 0;
        const actor = app._selectedCharacterId ? game.actors.get(app._selectedCharacterId) : null;
        const kindlingImg = findConsumableFirewoodItem(actor)?.img
            ?? "icons/commodities/wood/kindling-sticks-brown.webp";
        const party = this._partyFirewoodTotal();
        const staged = app._makeCampStagedWood ?? [];
        const slots = [];
        for (let i = 0; i < cost; i++) {
            const s = staged[i];
            if (s) {
                slots.push({
                    filled: true,
                    id: s.id,
                    kindlingImg,
                    portrait: s.portrait ?? "",
                    actorName: s.actorName ?? "",
                    canReclaim: this._canReclaimCeremonyStagedSlot(s),
                    tooltip: `${s.actorName}: click to return kindling`
                });
            } else {
                slots.push({
                    filled: false,
                    kindlingImg,
                    insufficient: (i + 1) > party,
                    tooltip: "Drag kindling here"
                });
            }
        }
        return slots;
    
    }

    _maybeClearStagedWoodOnTierChange(newLevel) {
        const app = this._app;

        const newCost = this._campPreviewFirewoodCost(newLevel);
        const prev = app._makeCampStagedWoodTier;
        if (prev !== null && newCost < prev && (app._makeCampStagedWood?.length ?? 0) > 0) {
            this.clearCeremonyStagedWood({ silent: true });
        }
        app._makeCampStagedWoodTier = newCost;
    
    }

    async clearCeremonyStagedWood({ silent = false } = {}) {
        const app = this._app;

        if (!app._makeCampStagedWood?.length) return;
        app._makeCampStagedWood = [];
        if (game.user.isGM) {
            emitPhaseChanged(app._phase, buildCampCeremonyPhasePayload(app, { makeCampStagedWood: [] }));
            this._syncCampCeremonyPreviewToEmbed();
            if (app._campfireApp) void app._campfireApp.render();
            else app.render();
        } else if (!silent) {
            ui.notifications.info("Tier changed: placed kindling returned to owners.");
        }
    
    }

    async stageCeremonyWood(userId, actorId) {
        const app = this._app;

        const cost = this._campPreviewFirewoodCost();
        if (this._isCampColdCampPreview() || cost <= 0) return false;
        if ((app._makeCampStagedWood?.length ?? 0) >= cost) {
            ui.notifications.warn("Enough kindling is placed for app tier.");
            return false;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return false;
        const available = countActorFirewood(actor) - this._stagedWoodCountForActor(actorId);
        if (available <= 0) {
            ui.notifications.warn(`${actor.name} has no kindling left to place.`);
            return false;
        }
        const slot = {
            id: foundry.utils.randomID(),
            userId,
            actorId,
            actorName: actor.name,
            portrait: this._portraitForCeremonyActor(actorId, userId)
        };
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campCeremonyStageWood",
                userId,
                actorId,
                slot
            });
            return true;
        }
        app._makeCampStagedWood = [...(app._makeCampStagedWood ?? []), slot];
        this._emitCampCeremonyPhaseSync();
        this._syncCampCeremonyPreviewToEmbed();
        if (app._campfireApp) void app._campfireApp.render();
        else app.render();
        return true;
    
    }

    async giftCeremonyWoodToFocusedActor() {
        const app = this._app;

        if (!game.user.isGM) return;
        const actor = app._selectedCharacterId ? game.actors.get(app._selectedCharacterId) : null;
        if (!actor) {
            ui.notifications.warn("Select a character in the roster first.");
            return;
        }
        try {
            const result = await ItemOutcomeHandler.grantToActor(actor.id, "kindling", 1);
            ui.notifications.info(`Gifted kindling to ${result.actorName}.`);
            this._emitCampCeremonyPhaseSync();
            this._syncCampCeremonyPreviewToEmbed();
            if (app._campfireApp) void app._campfireApp.render();
            else app.render();
        } catch (err) {
            console.error(`${MODULE_ID} | giftCeremonyWood:`, err);
            ui.notifications.warn("Could not gift kindling to that character.");
        }
    
    }

    async unstageCeremonyWood(slotId) {
        const app = this._app;

        const slot = (app._makeCampStagedWood ?? []).find(s => s.id === slotId);
        if (!slot) return;
        if (!this._canReclaimCeremonyStagedSlot(slot)) {
            ui.notifications.warn("Only the contributor or GM can reclaim that kindling.");
            return;
        }
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campCeremonyUnstageWood",
                userId: game.user.id,
                slotId
            });
            return;
        }
        app._makeCampStagedWood = app._makeCampStagedWood.filter(s => s.id !== slotId);
        this._emitCampCeremonyPhaseSync();
        this._syncCampCeremonyPreviewToEmbed();
        if (app._campfireApp) void app._campfireApp.render();
        else app.render();
    
    }

    async _spendCeremonyStagedWood(cost) {
        const app = this._app;

        const spendNames = [];
        if (cost <= 0) return { ok: true, spendNames };
        const staged = (app._makeCampStagedWood ?? []).slice(0, cost);
        if (staged.length < cost) {
            return { ok: false, spendNames, error: "Not enough kindling placed for app fire tier." };
        }
        for (const slot of staged) {
            const actor = game.actors.get(slot.actorId);
            if (!actor) return { ok: false, spendNames, error: "Placed kindling actor missing." };
            const item = findConsumableFirewoodItem(actor);
            if (!item || (item.system?.quantity ?? 0) <= 0) {
                return { ok: false, spendNames, error: `${slot.actorName} no longer has that kindling.` };
            }
            const qty = item.system?.quantity ?? 1;
            if (qty <= 1) await item.delete();
            else await item.update({ "system.quantity": qty - 1 });
            spendNames.push(slot.actorName);
        }
        app._makeCampStagedWood = [];
        return { ok: true, spendNames };
    
    }

    _syncCampCeremonyPreviewToEmbed(syncOpts = {}) {
        const app = this._app;

        if (!app._campfireApp || !this._campCeremonyMinigameEnabled()) return;
        const preview = this._isCampColdCampPreview()
            ? "cold_camp"
            : (app._campFirePreviewLevel ?? "embers");
        const slots = this._buildMakeCampCeremonyRequirementSlots();
        const cost = this._campPreviewFirewoodCost();
        const ceremonyReady = (app._makeCampStagedWood?.length ?? 0) >= cost && cost > 0;
        const party = syncOpts.partyFirewood ?? this._partyFirewoodTotal();
        const actorId = app._selectedCharacterId ?? getPartyActors()[0]?.id;
        const actorFirewood = actorId && syncOpts.actorFirewood?.[actorId] != null
            ? syncOpts.actorFirewood[actorId]
            : null;
        app._campfireApp.syncMakeCampPreview(
            preview,
            party,
            slots,
            ceremonyReady,
            {
                force: !!syncOpts.force,
                actorFirewood
            }
        );
    
    }

    _emitCampCeremonyPhaseSync(extra = {}) {
        const app = this._app;

        emitPhaseChanged(app._phase, buildCampCeremonyPhasePayload(app, extra));
    
    }

    _campCeremonyMinigameEnabled() {
        const app = this._app;

        if (!isCampfireMinigameEnabled() || app._phase !== "camp") return false;
        if (!app._showFullMakeCampPanel()) return false;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeFromSetting);
        if (effectiveSafe) return false;
        if ((app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided) return false;
        return true;
    
    }

    async _commitMakeCampCeremonyIgnite(opts = {}) {
        const app = this._app;

        if (app._commitMakeCampCeremonyInFlight) return;
        if (app._fireLitBy && (app._fireLevel ?? "unlit") !== "unlit") return;
        if (app._phase !== "camp" || app._campToActivityDone) return;
        if (!this._campCeremonyMinigameEnabled()) return;
        if (this._isCampColdCampPreview()) return;
        if (app._campPitBlocksFireLighting()) {
            ui.notifications.warn("Place the campfire on the map before lighting.");
            return;
        }

        const chosenLevel = ["embers", "campfire", "bonfire"].includes(app._campFirePreviewLevel)
            ? app._campFirePreviewLevel
            : "embers";
        const cost = this._campPreviewFirewoodCost(chosenLevel);
        const staged = app._makeCampStagedWood?.length ?? 0;
        const readyToLight = opts.readyToLight
            ?? app._campfireApp?._ceremonyReadyToLight
            ?? staged >= cost;
        if (!readyToLight && staged < cost && this._partyFirewoodTotal() < cost) {
            ui.notifications.warn(`Place ${cost} kindling for ${chosenLevel} before lighting.`);
            return;
        }

        const selectedActor = app._selectedCharacterId
            ? game.actors.get(app._selectedCharacterId)
            : null;
        const actorId = opts.actorId ?? selectedActor?.id ?? getPartyActors()[0]?.id;
        const method = opts.method ?? "Minigame";
        if (!actorId) return;

        if ((app._fireLevel ?? "unlit") !== "unlit") {
            if (game.user.isGM) await this._totmAdvanceCampAfterCeremonyIgnite();
            return;
        }

        if (!game.user.isGM) {
            emitCampLightFire(game.user.id, actorId, method, chosenLevel);
            return;
        }

        app._commitMakeCampCeremonyInFlight = true;
        try {
            await app._campCeremony.lightFire(
                game.user.id,
                actorId,
                method,
                chosenLevel,
                { autoAdvanceTotm: app._isTotM }
            );
        } finally {
            app._commitMakeCampCeremonyInFlight = false;
        }
    
    }

    async _totmAdvanceCampAfterCeremonyIgnite() {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!isCampfireMinigameEnabled() || !app._isTotM || app._phase !== "camp" || app._campToActivityDone) {
            return;
        }
        app._beginRestWindowRecenterSuppression();
        try {
            // Keep the embed alive; _mountCampfireEmbed rebinds it to the activity side panel.
            await this._totmSpendMakeCampFirewood();
            app._makeCampStagedWood = [];
            app._makeCampStagedWoodTier = null;
            await app._advanceCampToActivity();
        } finally {
            app._endRestWindowRecenterSuppression(true);
        }
    
    }

    async _totmSpendMakeCampFirewood() {
        const app = this._app;

        if (!!app._engine?.safeRestSpot) return;

        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[app._fireLevel ?? "unlit"] ?? 0;
        if (cost <= 0) return;

        const lighterUserId = app._fireLitBy?.userId ?? null;
        const spend = (app._makeCampStagedWood?.length ?? 0) >= cost
            ? await this._spendCeremonyStagedWood(cost)
            : await app._spendPartyFirewoodForMakeCamp(cost, lighterUserId);

        if (!spend.ok) return;

        const level = app._fireLevel ?? "campfire";
        const label = level.charAt(0).toUpperCase() + level.slice(1);
        const lighterName = app._fireLitBy?.actorName ?? null;
        const donors = CampCeremonyDelegate.formatCampFirewoodDonors(spend.spendNames);

        if (!spend.spendNames.length) {
            ui.notifications.info(`Firewood for the ${label} is provided.`);
        } else {
            const uniqueDonors = [...new Set(spend.spendNames.filter(Boolean))];
            const allFromLighter = lighterName && uniqueDonors.length === 1 && uniqueDonors[0] === lighterName;
            if (allFromLighter) {
                ui.notifications.info(`${donors} provides firewood for the ${label}.`);
            } else {
                ui.notifications.info(`Firewood for ${label} taken from ${donors}.`);
            }
        }
    
    }

    _syncTotmCampfireEmbedFromRest() {
        const app = this._app;

        app._campfireApp?.syncFromRestFireLevel?.(
            app._fireLevel ?? "unlit",
            !!app._coldCampDecided
        );
    
    }

    async applyActivityFireLevelFromMinigame(level) {
        const app = this._app;

        if (!this._activityFireUiEnabled()) return;
        const cur = app._fireLevel ?? "unlit";
        if (level === cur) return;

        if (level === "unlit") {
            if (!game.user.isGM) {
                ui.notifications.warn("Only the GM can fully extinguish the fire.");
                this._syncTotmCampfireEmbedFromRest();
                return;
            }
            await app.setColdCampDuringActivity();
            this._syncTotmCampfireEmbedFromRest();
            if (app._campfireApp) void app._campfireApp.render();
            app.render();
            return;
        }

        if (!["embers", "campfire", "bonfire"].includes(level)) return;
        if (game.user.isGM) {
            await app.changeFireLevelDuringActivity(level, { fromMinigame: true });
        } else {
            emitActivityFireLevelRequest(level, game.user.id);
        }
        this._syncTotmCampfireEmbedFromRest();
    
    }

    _mountCampfireEmbed(mode, options = {}) {
        const app = this._app;

        const forCamp = mode === "camp";
        const forStation = mode === "station";
        const forTotmActivity = mode === "activity";
        if (forCamp && !this._campCeremonyMinigameEnabled()) {
            logCampfireReconnect("mountCampfireEmbed:skip", { mode, reason: "camp ceremony disabled" });
            return;
        }
        if (forTotmActivity && !this._shouldShowTotmCampfirePanel()) {
            logCampfireReconnect("mountCampfireEmbed:skip", {
                mode,
                reason: "shouldShowTotmCampfirePanel false",
                fireLevel: app._fireLevel ?? "unlit",
                ...this._campfireReconnectGateDetail()
            });
            return;
        }
        if (forStation && !this._stationsFireMinigameEnabled()) {
            logCampfireReconnect("mountCampfireEmbed:skip", { mode, reason: "stations fire minigame disabled" });
            return;
        }

        const hostSelector = forCamp
            ? ".totm-camp-minigame-host"
            : forStation
                ? null
                : ".totm-campfire-minigame-host";
        const host = options.host ?? (hostSelector ? app.element?.querySelector(hostSelector) : null);
        if (!host) {
            logCampfireReconnect("mountCampfireEmbed:skip", {
                mode,
                reason: "host element missing",
                hostSelector,
                showTotmCampfirePanelTemplate: this._shouldShowTotmCampfirePanel(),
                hasActivityLayout: !!app.element?.querySelector(".totm-activity-layout")
            });
            return;
        }

        app._campfireEmbedHost = forCamp ? "camp" : (forStation ? "station" : "totm");

        logCampfireReconnect("mountCampfireEmbed:proceed", {
            mode,
            rebind: !!app._campfireApp,
            fireLevel: app._fireLevel ?? "unlit",
            hostConnected: host.isConnected,
            embedHost: app._campfireEmbedHost
        });

        if (app._campfireApp) {
            app._campfireApp.setPanelMode({
                makeCampCeremony: forCamp,
                showDouseBtn: !forCamp
            });
            app._campfireApp.rebindContainer(host);
            app._campfireApp.setContextActorId(app._selectedCharacterId);
            if (forCamp) {
                app._campfireApp.syncFromRestFireLevel("unlit", false);
                this._syncCampCeremonyPreviewToEmbed();
            } else {
                this._syncTotmCampfireEmbedFromRest();
            }
            void app._campfireApp.render().then(() => {
                app._scheduleRestWindowRecenter();
            });
            return;
        }

        const restApp = app;
        const partyCharacterIds = getPartyActors().map(a => a.id);
        const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";

        app._campfireApp = new CampfireEmbed(host, {
            partyCharacterIds,
            terrainTag,
            contextActorId: app._selectedCharacterId,
            disableDecay: true,
            showDouseBtn: !forCamp,
            makeCampCeremony: forCamp,
            canCommitCeremonyIgnite: () => !restApp._campPitBlocksFireLighting(),
            ceremonyIgniteBlockReason: () => restApp._campPitIgniteBlockMessage(),
            onStageCeremonyWood: () => {
                const a = restApp._selectedCharacterId
                    ? game.actors.get(restApp._selectedCharacterId)
                    : null;
                const actorId = a?.id ?? getPartyActors()[0]?.id;
                if (!actorId) return Promise.resolve(false);
                return restApp.stageCeremonyWood(game.user.id, actorId);
            },
            onUnstageCeremonyWood: (slotId) => restApp.unstageCeremonyWood(slotId),
            onGiftCeremonyWood: () => restApp.giftCeremonyWoodToFocusedActor(),
            onCeremonyIgnited: (data) => restApp._commitMakeCampCeremonyIgnite({
                readyToLight: data?.readyToLight,
                actorId: data?.actorId,
                method: data?.method
            }),
            onFireLevelChange: (level) => {
                if (!forCamp) void restApp.applyActivityFireLevelFromMinigame(level);
            }
        });

        if (forCamp) {
            app._campfireApp.syncFromRestFireLevel("unlit", false);
            this._syncCampCeremonyPreviewToEmbed();
        } else {
            this._syncTotmCampfireEmbedFromRest();
        }

        registerCampfireEmbed(app._campfireApp);
        void app._campfireApp.render()
            .then(() => app._scheduleRestWindowRecenter())
            .catch(err => {
                console.error(`${MODULE_ID} | CampfireEmbed render failed:`, err);
            });
    
    }

    _tearDownCampfireEmbed(reason = "unknown") {
        const app = this._app;

        if (app._campfireApp) {
            logCampfireReconnect("tearDownCampfireEmbed", {
                reason,
                phase: app._phase,
                fireLevel: app._fireLevel ?? "unlit",
                embedWasLit: app._campfireApp?._lit,
                shouldShowPanel: this._shouldShowTotmCampfirePanel()
            });
        }
        if (!app._campfireApp) return;
        app._campfireApp.destroy();
        app._campfireApp = null;
        app._campfireEmbedHost = null;
        app._stationFireMinigameDialog = null;
        clearCampfireEmbed();
    
    }

    static formatCampFirewoodDonors(names) {
        const app = this._app;

        const unique = [...new Set((names ?? []).filter(Boolean))];
        if (unique.length <= 1) return unique[0] ?? "";
        if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
        return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
    
    }

    async onSetFireLevel(event, target) {
        const app = this._app;

        const level = target.dataset.fireLevel;
        if (!level) return;
        app._fireLevel = level;

        if (game.user.isGM && ["embers", "campfire", "bonfire"].includes(level)) {
            void CampfireTokenLinker.setLightState(true, level);
        }

        // Sync to players
        emitPhaseChanged("reflection", { fireLevel: level });

        app.render();
    
    }

    buildCampfireDrawerContextForMapDialog() {
        const app = this._app;

        if (app._phase !== "camp") return null;

        let campScanData = null;
        let campFireEncounterHint = "";
        let campFirePickerLevels = [];
        let campColdCampDecided = false;
        if (app._phase === "camp") {
            const terrainTagCamp = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            const fireCommitted = (app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided;
            campColdCampDecided = !!app._coldCampDecided;
            // When fire hasn't been committed, preview defaults to "embers" (the
            // default highlighted tab), NOT "unlit" which applies a no-fire penalty.
            const effectiveScanLevel = (campfirePlacedGate && fireCommitted)
                ? (app._coldCampDecided ? "cold_camp" : (app._fireLevel ?? "unlit"))
                : (app._campFirePreviewLevel ?? (app._fireLevel !== "unlit" ? app._fireLevel : "embers"));
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "Choose a fire level or go cold camp.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter chance.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
            } else {
                campFireEncounterHint = "";
            }
            const baseTerrainComfort = app._engine?.comfort
                ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
                ?? "rough";
            campScanData = CampGearScanner.scan(
                baseTerrainComfort,
                effectiveScanLevel,
                shelterSpellCamp,
                terrainCamp?.comfortReason ?? "",
                terrainCamp?.label ?? terrainTagCamp,
                encMod,
                !!app._engine?.safeRestSpot
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = app._fireLevel ?? "unlit";
            const preview = app._campFirePreviewLevel ?? "embers";
            const coldSelected = !!app._coldCampDecided || (preview === "cold_camp");
            const hasTinder = campScanData?.canLightFire ?? false;
            const tierDisabledReason = (canPick, cost) => {
                if (canPick) return "";
                if (!hasTinder) return "Someone needs a tinderbox or flint and steel.";
                return `Need at least ${cost} firewood in the party.`;
            };
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: "Embers",
                    costLabel: CampGearScanner.firewoodCostLabel("embers"),
                    disabled: !fs.canPickEmbers,
                    disabledReason: tierDisabledReason(fs.canPickEmbers, fs.costEmbers ?? 1),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "embers" : preview === "embers")
                },
                {
                    id: "campfire",
                    label: "Campfire",
                    costLabel: CampGearScanner.firewoodCostLabel("campfire"),
                    disabled: !fs.canPickCampfire,
                    disabledReason: tierDisabledReason(fs.canPickCampfire, fs.costCampfire ?? 2),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "campfire" : preview === "campfire")
                },
                {
                    id: "bonfire",
                    label: "Bonfire",
                    costLabel: CampGearScanner.firewoodCostLabel("bonfire"),
                    disabled: !fs.canPickBonfire,
                    disabledReason: tierDisabledReason(fs.canPickBonfire, fs.costBonfire ?? 3),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "bonfire" : preview === "bonfire")
                }
            ];
        }

        let campFireIsLit = false;
        let campFireLitBy = null;
        let campFireLighters = [];
        let campFirewoodPledgeList = [];
        let campMyPledge = null;
        let campCanAddFirewood = false;
        let campMyFirewoodActorId = null;
        let campFireTierCards = [];
        let campFireTotalPledged = 0;
        let campViewerCanLight = false;
        let campFireOtherLighterCount = 0;
        let campFireLighterNames = "";
        if (app._phase === "camp" && campScanData) {
            campFireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
            campFireLitBy = app._fireLitBy ?? null;
            campFireTotalPledged = Array.from(app._firewoodPledges.values()).reduce((s, p) => s + p.count, 0);

            const rawLighters = campScanData.fireLighters ?? [];
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips?.() ?? [];
            const cantripLighters = [];
            for (const actor of getPartyActors()) {
                if (rawLighters.some(l => l.actorId === actor.id)) continue;
                const cantrip = fireCantrips.length > 0
                    ? actor.items.find(i => i.type === "spell" && (i.system?.level === 0) && fireCantrips.includes(i.name))
                    : null;
                if (cantrip) cantripLighters.push({ actorId: actor.id, actorName: actor.name, method: cantrip.name });
            }
            const rawLightersTagged = rawLighters.map(l => ({ ...l, methodType: "item", methodIcon: "fas fa-box" }));
            const cantripLightersTagged = cantripLighters.map(l => ({ ...l, methodType: "spell", methodIcon: "fas fa-magic" }));
            const allLighters = [...rawLightersTagged, ...cantripLightersTagged];

            campFireLighters = allLighters.map(l => ({
                ...l,
                isViewerActor: (game.actors.get(l.actorId)?.ownership?.[game.user.id] ?? 0) >= OWNER
            }));
            campViewerCanLight = campFireLighters.some(l => l.isViewerActor);
            if (app._campPitBlocksFireLighting()) campViewerCanLight = false;
            campFireLighterNames = campFireLighters.map(l => l.actorName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            campFireOtherLighterCount = campFireLighters.filter(l => !l.isViewerActor).length;

            campFirewoodPledgeList = Array.from(app._firewoodPledges.values())
                .filter(p => p.count > 0)
                .map(p => ({ actorName: p.actorName, count: p.count }));

            campMyPledge = app._firewoodPledges.get(game.user.id) ?? null;

            if (campFireIsLit && campFireTotalPledged < 2) {
                if (game.user.isGM) {
                    campCanAddFirewood = true;
                    campMyFirewoodActorId = "__gm__";
                } else {
                    const firewoodHolders = campScanData.firewoodHolders ?? [];
                    const myPledgeCount = campMyPledge?.count ?? 0;
                    const ownedWithWood = firewoodHolders.find(h => {
                        const a = game.actors.get(h.actorId);
                        return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER && h.count > myPledgeCount;
                    });
                    if (ownedWithWood) {
                        campCanAddFirewood = true;
                        campMyFirewoodActorId = ownedWithWood.actorId;
                    }
                }
            }

            const TIER_BODIES = {
                embers: "No cooking. No comfort change.",
                campfire: "Cooking and warmth. Easier for enemies to spot.",
                bonfire: "+1 camp comfort. Visible from far off."
            };
            const TIER_LABELS = Object.fromEntries(
                COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
            );
            const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
            const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
            const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
            // Highlight the chosen tier: committed level once lit, otherwise the live
            // preview. Cold camp suppresses any fire-tier highlight.
            const curLevel = app._fireLevel ?? "unlit";
            const previewLevel = app._campFirePreviewLevel ?? "embers";
            const coldActive = !!app._coldCampDecided || previewLevel === "cold_camp";
            campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
                const delta = COMFORT_DELTA[id] ?? 0;
                const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
                const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
                const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
                const comfortHint = delta !== 0
                    ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                    : resultLabel;
                return {
                    id,
                    label: id.charAt(0).toUpperCase() + id.slice(1),
                    costLabel: CampGearScanner.firewoodCostLabel(id),
                    body: TIER_BODIES[id],
                    comfortHint,
                    comfortChanged: delta !== 0,
                    active: !coldActive && (curLevel !== "unlit" ? curLevel === id : previewLevel === id)
                };
            });
        }

        const mapComfortLabel = campScanData?.campComfortLabel ?? "";
        const mapComfortLine = campScanData
            ? (campScanData.comfortReason
                ? `${campScanData.terrainLabel ? `${campScanData.terrainLabel}: ` : ""}${campScanData.comfortReason}`
                : (campScanData.terrainLabel
                    ? `${campScanData.terrainLabel} (${mapComfortLabel})`
                    : `Camp comfort: ${mapComfortLabel}`))
            : "";
        const mapComfortTierClass = campScanData?.campComfort
            ? `comfort-${campScanData.campComfort}`
            : "comfort-rough";

        // Personal rest outcome (HP / Hit Dice / exhaustion) for the viewer, scanned at the
        // previewed fire level so the risk/reward of each tier is tangible before lighting.
        let mapRestCard = null;
        let mapRestActorName = "";
        if (campScanData?.personalCards?.length) {
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            let chosen = null;
            if (game.user.isGM) {
                chosen = app._selectedCharacterId
                    ? campScanData.personalCards.find(p => p.actorId === app._selectedCharacterId)
                    : null;
            } else {
                chosen = campScanData.personalCards.find(p => {
                    const a = game.actors.get(p.actorId);
                    return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER;
                });
            }
            mapRestCard = chosen ?? campScanData.personalCards[0] ?? null;
            if (mapRestCard) {
                mapRestActorName = game.actors.get(mapRestCard.actorId)?.name ?? mapRestCard.actorName ?? "";
            }
        }

        return {
            campFireEncounterHint,
            campFireIsLit,
            campCurrentFireLevel: app._fireLevel ?? "unlit",
            mapRestCard,
            mapRestActorName,
            campFireLitBy,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campFireTierCards,
            campFireTotalPledged,
            campColdCampDecided,
            campScanData,
            campFirePickerLevels,
            campFirePreviewLevel: app._campFirePreviewLevel ?? "embers",
            campPreviewIsColdCamp: app._isCampColdCampPreview(),
            campViewerCanLight,
            campPitBlocksFireLighting: app._campPitBlocksFireLighting(),
            campFireOtherLighterCount,
            campFireLighterNames,
            mapComfortLabel,
            mapComfortLine,
            mapComfortTierClass
        };
    
    }

    getFireTabContextForStationDialog() {
        const app = this._app;

        if (app.isCampfireStationFlavorOnly()) return null;
        const campScanData = app._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;

        if (app._stationsFireMinigameEnabled()) {
            const coldCamp = !!app._coldCampDecided;
            const curLevel = app._fireLevel ?? "unlit";
            const effectiveScanLevel = coldCamp ? "cold_camp" : curLevel;
            let campFireEncounterHint = "";
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "Use the campfire to choose intensity or go cold.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter chance.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
            }
            return {
                useFireMinigame: true,
                campFireEncounterHint,
                campFireIsLit: curLevel !== "unlit",
                campFireTabColdCamp: coldCamp
            };
        }

        const coldCamp = !!app._coldCampDecided;
        const curLevel = app._fireLevel ?? "unlit";
        // Local preview wins for the hint and header so the impact is visible before commit.
        const previewLevel = (["embers", "campfire", "bonfire"].includes(app._stationFirePreviewLevel)
            && app._stationFirePreviewLevel !== curLevel)
            ? app._stationFirePreviewLevel
            : null;
        const effectiveScanLevel = previewLevel ?? (coldCamp ? "cold_camp" : curLevel);

        let campFireEncounterHint = "";
        if (effectiveScanLevel === "cold_camp") {
            campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
        } else if (effectiveScanLevel === "unlit") {
            campFireEncounterHint = "No fire is lit. The tier row shows what each level would do.";
        } else if (effectiveScanLevel === "embers") {
            campFireEncounterHint = "Embers: no change to encounter chance.";
        } else if (effectiveScanLevel === "campfire") {
            campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
        } else if (effectiveScanLevel === "bonfire") {
            campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
        }
        if (previewLevel) {
            campFireEncounterHint = `Previewing ${previewLevel}. ${campFireEncounterHint}`;
        }

        const TIER_LABELS = Object.fromEntries(
            COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
        );
        const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
        const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
        const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
        const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const costCur = coldCamp || curLevel === "unlit" ? 0 : (F[curLevel] ?? 0);
        const actors = getPartyActors();
        const hasTinderbox = actors.some(a => a.items.some(i => {
            const n = i.name?.toLowerCase() ?? "";
            return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
        }));
        const totalPartyFirewood = actors.reduce((sum, a) => sum + countActorFirewood(a), 0);

        const campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
            const delta = COMFORT_DELTA[id] ?? 0;
            const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
            const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
            const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
            const comfortHint = delta !== 0
                ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                : resultLabel;
            const isActive = !coldCamp && curLevel === id;
            const costNew = F[id] ?? 0;
            const isGm = !!game.user?.isGM;
            let tierChangeBlocked = true;
            let tierDisabledReason = "";
            if (!isActive) {
                if (costNew < costCur) {
                    tierChangeBlocked = false;
                } else {
                    const need = costNew - costCur;
                    if (costCur === 0 && !hasTinderbox) {
                        tierChangeBlocked = true;
                        tierDisabledReason = "Someone needs a tinderbox or flint and steel.";
                    } else if (need > 0 && totalPartyFirewood < need) {
                        tierChangeBlocked = true;
                        tierDisabledReason = `Need at least ${need} firewood in the party.`;
                    } else {
                        tierChangeBlocked = false;
                    }
                }
            }
            return {
                id,
                label: id.charAt(0).toUpperCase() + id.slice(1),
                costLabel: CampGearScanner.firewoodCostLabel(id),
                comfortHint,
                comfortChanged: delta !== 0,
                active: isActive,
                previewActive: previewLevel === id,
                actionBlocked: isActive ? false : tierChangeBlocked,
                setDisabled: isActive ? false : (isGm ? tierChangeBlocked : true),
                requestDisabled: tierChangeBlocked,
                disabledReason: tierDisabledReason
            };
        });

        const campFireColdCampCard = {
            active: coldCamp,
            setDisabled: coldCamp,
            requestDisabled: coldCamp
        };

        const campFirewoodPledgeList = Array.from(app._firewoodPledges.values())
            .filter(p => p.count > 0)
            .map(p => ({ actorName: p.actorName, count: p.count }));

        return {
            campFireTierCards,
            campFireColdCampCard,
            campFireEncounterHint,
            campFirewoodPledgeList,
            campFireIsLit: (app._fireLevel ?? "unlit") !== "unlit",
            campFireTabColdCamp: coldCamp,
            campFireTabGm: !!game.user?.isGM,
            campFirePreviewLevel: previewLevel,
            campFirePreviewLabel: previewLevel ? (previewLevel.charAt(0).toUpperCase() + previewLevel.slice(1)) : null
        };
    
    }

    getCampPersonalCardForActor(actorId) {
        const app = this._app;

        if (app.isCampfireStationFlavorOnly()) return null;
        if (app._phase !== "activity" || !actorId) return null;
        const gearCtx = app.getCampGearContextForActor(actorId);
        if (!gearCtx) return null;
        const campScanData = app._getCampScanDataForActivityStationDialog();
        if (!campScanData?.personalCards?.length) return null;
        const card = campScanData.personalCards.find(p => p.actorId === actorId);
        if (!card) return null;

        const g = gearCtx;
        const slot = (def) => {
            const owned = def.owned;
            const deployed = def.deployed;
            const canDrag = def.canDrag;
            return {
                gearType: def.gearType,
                title: def.title,
                icon: def.icon,
                actorId: g.actorId,
                isMissing: !owned,
                isPlaced: owned && deployed,
                canDrag: owned && canDrag,
                isReadonlyOwned: owned && !canDrag && !deployed,
                benefitLine: def.benefitLine,
                missingLine: def.missingLine
            };
        };
        const gearSlots = [
            slot({
                gearType: "bedroll",
                title: "Bedroll",
                icon: "fas fa-bed",
                owned: g.hasBedroll,
                deployed: g.bedrollDeployed,
                canDrag: g.canDragBedroll,
                benefitLine: "+1 personal comfort tier and +1 Hit Die recovery from inventory.",
                missingLine: "No bedroll. Comfort stays at camp level."
            }),
            slot({
                gearType: "tent",
                title: "Tent",
                icon: "fas fa-campground",
                owned: g.hasTent,
                deployed: g.tentDeployed,
                canDrag: g.canDragTent,
                benefitLine: "Weather and encounter modifiers while a tent is owned.",
                missingLine: "No tent. No tent modifiers."
            }),
            slot({
                gearType: "messkit",
                title: g.messKitSource === "utensils" ? "Cook's Utensils" : "Mess kit",
                icon: g.messKitSource === "utensils" ? "fas fa-mortar-pestle" : "fas fa-utensils",
                owned: g.hasMessKit,
                deployed: g.messKitDeployed,
                canDrag: g.canDragMessKit,
                benefitLine: g.messKitSource === "utensils"
                    ? "Cook's utensils serve as a mess kit. Advantage on exhaustion saves when fire is lit."
                    : "Advantage on exhaustion saves when the fire is lit.",
                missingLine: "No mess kit or cook's utensils. No camp-gear advantage on exhaustion saves."
            })
        ];

        const rec = card.recovery ?? {};
        const hpSev = rec.hpSeverity ?? "";
        const hdSev = rec.hdSeverity ?? "";
        const exSev = rec.exhaustionSeverity ?? null;
        const hasSuboptimalLine =
            hpSev === "danger" || hpSev === "warning" ||
            hdSev === "danger" || hdSev === "warning" ||
            exSev === "danger" || exSev === "warning";

        const mitigationHints = [];
        if (hasSuboptimalLine) {
            if (!g.hasBedroll) {
                mitigationHints.push("Carry a bedroll in inventory to raise personal comfort by one tier.");
            } else {
                mitigationHints.push("Bedroll is in inventory: it already applies to this preview.");
            }
            if (!campScanData.fireIsLit) {
                mitigationHints.push("Light a fire (embers or higher) to remove the no-fire comfort step.");
            } else {
                const fl = campScanData.fireLevel;
                if (fl && fl !== "unlit" && fl !== "bonfire") {
                    mitigationHints.push("A bonfire can add one camp comfort step (Fire tab).");
                }
            }
            mitigationHints.push("Choose Rest Fully for +1 comfort tier.");
        }

        const fireLevelRaw = campScanData.fireLevel ?? "embers";
        const fireTierLabels = {
            unlit: "No fire",
            embers: "Embers",
            campfire: "Campfire",
            bonfire: "Bonfire"
        };
        const fireStatusLines = {
            unlit: "-1 camp comfort until a fire is lit",
            embers: "No comfort change from fire size",
            campfire: "Cooking and warmth",
            bonfire: "+1 camp comfort"
        };
        const fireFactorRow = {
            tierLabel: fireTierLabels[fireLevelRaw] ?? fireLevelRaw,
            statusLine: fireStatusLines[fireLevelRaw] ?? ""
        };

        return {
            personalComfort: card.personalComfort,
            personalComfortLabel: card.personalComfortLabel,
            personalMatchesCamp: !!card.personalMatchesCamp,
            fireFactorRow,
            gearBreakdown: card.gearBreakdown ?? [],
            recovery: {
                hpLabel: rec.hpLabel ?? "",
                hpSeverity: hpSev,
                hdLabel: rec.hdLabel ?? "",
                hdSeverity: hdSev,
                exhaustionDC: rec.exhaustionDC ?? null,
                exhaustionLabel: rec.exhaustionLabel ?? "",
                exhaustionSeverity: exSev
            },
            mitigationHints,
            hasMitigationHints: mitigationHints.length > 0,
            hasBedroll: !!card.hasBedroll,
            hasTent: !!card.hasTent,
            hasMessKit: !!card.hasMessKit,
            actorId: g.actorId,
            gearSlots
        };
    
    }

    _buildEncounterPlayerFactors(params) {
        const app = this._app;

        const {
            terrainLabel,
            weather,
            weatherName,
            shelter,
            scouting,
            scoutingResult,
            complication,
            fire,
            fireLevel,
            totalDefenses,
            defensesPending,
            defensesFailed
        } = params;

        const factors = [{
            label: "Terrain DC",
            tone: "neutral",
            icon: "fas fa-mountain",
            tooltip: `${terrainLabel} sets the baseline camp exposure for this rest.`
        }];

        const wx = WEATHER_TABLE[weatherName ?? ""] ?? null;
        if (weather !== 0 || (wx && (wx.encounterDC !== 0 || wx.comfortPenalty > 0))) {
            factors.push({
                label: wx?.label ?? "Weather",
                tone: (wx?.encounterDC ?? 0) > 0 ? "risk" : "neutral",
                icon: "fas fa-cloud-sun-rain",
                tooltip: wx?.hint ?? "Weather shapes how exposed the camp feels tonight."
            });
        }

        if (shelter !== 0) {
            factors.push({
                label: "Shelter",
                tone: "help",
                icon: "fas fa-campground",
                tooltip: "Cover or a shelter spell hides the camp from wandering threats."
            });
        }

        if (scouting !== 0) {
            const tier = scoutingResult ?? "?";
            const tierLabel = tier === "none" ? "Scouting" : `Scout (${tier})`;
            factors.push({
                label: tierLabel,
                tone: scouting > 0 ? "help" : (scouting < 0 ? "risk" : "neutral"),
                icon: "fas fa-binoculars",
                tooltip: "Travel scouting shifts how prepared the camp is for the night."
            });
        }

        if (complication) {
            factors.push({
                label: "Complication",
                tone: "risk",
                icon: "fas fa-exclamation-triangle",
                tooltip: "Something from travel may surface during the night."
            });
        }

        if (fire !== 0) {
            const fireLabels = {
                embers: "Embers",
                campfire: "Campfire",
                bonfire: "Bonfire",
                cold_camp: "Cold camp",
                unlit: "Unlit"
            };
            factors.push({
                label: fireLabels[fireLevel] ?? "Fire",
                tone: fire < 0 ? "risk" : "help",
                icon: "fas fa-fire",
                tooltip: fire < 0
                    ? "Light makes the camp easier to spot."
                    : "A dark camp is harder for threats to find."
            });
        }

        if (totalDefenses !== 0) {
            factors.push({
                label: "Defenses",
                tone: "help",
                icon: "fas fa-shield-alt",
                tooltip: "Camp defenses are in place and holding."
            });
        } else if (defensesPending) {
            factors.push({
                label: "Defenses",
                tone: defensesFailed ? "risk" : "pending",
                icon: "fas fa-shield-alt",
                tooltip: defensesFailed
                    ? "Defenses were tried but did not hold."
                    : "Defenders are assigned. Outcome still pending."
            });
        }

        return factors;
    
    }


}
