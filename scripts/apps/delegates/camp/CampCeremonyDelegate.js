import { CampCeremonyWoodAndEmbedMethods } from "./CampCeremonyWoodAndEmbed.js";
import { CampCeremonyContextMethods } from "./CampCeremonyContextBuilder.js";
import { Logger } from "../../../utils/Logger.js";
import {
    CampGearScanner,
    isActorFirewoodItem
} from "../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import { logCampfireReconnect } from "../../../services/camp/fire/CampfireReconnectLog.js";
import {
    emitPhaseChanged
} from "../../../services/socket/SocketController.js";
import { isComfortEnabled } from "../../../services/camp/gear/ComfortCalculator.js";
import { isCampfireMinigameEnabled, isSimpleStationsMode, requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const FIRE_LEVELS = Object.freeze(["unlit", "embers", "campfire", "bonfire"]);

export class CampCeremonyDelegate {

    constructor(app) {
        this._app = app;
    }

    static formatFireLitToastMessage(fireLitBy, fireLevel) {
        if (!fireLitBy || fireLevel === "unlit") return null;
        const name = fireLitBy.actorName ?? game.i18n.localize("ionrift-respite.campCeremony.fireLit.someone");
        const method = (fireLitBy.method ?? "Tinderbox").trim();
        const tier = ["embers", "campfire", "bonfire"].includes(fireLevel) ? fireLevel : "other";

        // method values are stored/broadcast ids; only the sentence is localized.
        let how;
        if (method === "Minigame") {
            how = "ceremony";
        } else if (method === "GM Override") {
            how = "gmOverride";
        } else if (method === "Campfire") {
            how = "pit";
        } else if (method === "Tinderbox" || /tinderbox|flint/i.test(method)) {
            how = "tinderbox";
        } else {
            how = "custom";
        }

        const messages = {
            embers: {
                ceremony: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.embers.ceremony", { name }),
                gmOverride: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.embers.gmOverride", { name }),
                pit: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.embers.pit", { name }),
                tinderbox: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.embers.tinderbox", { name }),
                custom: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.embers.custom", { name, method })
            },
            campfire: {
                ceremony: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.campfire.ceremony", { name }),
                gmOverride: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.campfire.gmOverride", { name }),
                pit: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.campfire.pit", { name }),
                tinderbox: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.campfire.tinderbox", { name }),
                custom: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.campfire.custom", { name, method })
            },
            bonfire: {
                ceremony: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.bonfire.ceremony", { name }),
                gmOverride: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.bonfire.gmOverride", { name }),
                pit: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.bonfire.pit", { name }),
                tinderbox: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.bonfire.tinderbox", { name }),
                custom: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.bonfire.custom", { name, method })
            },
            other: {
                ceremony: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.other.ceremony", { name }),
                gmOverride: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.other.gmOverride", { name }),
                pit: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.other.pit", { name }),
                tinderbox: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.other.tinderbox", { name }),
                custom: () => game.i18n.format("ionrift-respite.campCeremony.fireLit.other.custom", { name, method })
            }
        };
        return messages[tier][how]();
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
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.placeCampfireBeforeLighting"));
            return;
        }
        const actor = game.actors.get(actorId);
        if (!actor) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.characterNotFound"));
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
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.lightFireFirst"));
            return;
        }
        const total = this._totalPledged();
        if (total >= 2) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.alreadyBonfire"));
            return;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return;
        const firewoodItem = actor.items.find(i => isActorFirewoodItem(i));
        const existing = this.firewoodPledges.get(userId);
        const pledgedSoFar = existing?.count ?? 0;
        const available = firewoodItem?.system?.quantity ?? 0;
        if (available <= pledgedSoFar) {
            ui.notifications.warn(game.i18n.format("ionrift-respite.campCeremony.noMoreFirewood", { actor: actor.name }));
            return;
        }
        this.firewoodPledges.set(userId, { actorId, actorName: actor.name, count: pledgedSoFar + 1 });
        await this._syncFireLevelFromPledges();
    }

    async addGmFirewoodPledge() {
        if (!game.user.isGM) return;
        if (!this.fireLitBy && this.fireLevel === "unlit") {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.lightFireFirst"));
            return;
        }
        const total = this._totalPledged();
        if (total >= 2) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.alreadyBonfire"));
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
        await CampfireTokenLinker.setLightState(
            level !== "unlit",
            level !== "unlit" ? level : undefined,
            { ignite: !!options.notifyFireLit && level !== "unlit" }
        );
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
            unlit: game.i18n.localize("ionrift-respite.fireLevel.unlit"),
            embers: game.i18n.localize("ionrift-respite.fireLevel.embers"),
            campfire: game.i18n.localize("ionrift-respite.fireLevel.campfire"),
            bonfire: game.i18n.localize("ionrift-respite.fireLevel.bonfire")
        };
        drawerContainer.innerHTML = `
            <div class="campfire-static-status">
                <div class="campfire-static-inner">
                    <i class="fas fa-fire" aria-hidden="true"></i>
                    <span class="campfire-static-title">${LEVEL_LABELS[level] ?? level}</span>
                </div>
                <p class="campfire-static-hint">${game.i18n.localize("ionrift-respite.campCeremony.staticFireHint")}</p>
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

        if (app._phase === "activity" && (this._shouldShowTotmCampfirePanel() || this._shouldMountFireRailEmbed())) {
            logCampfireReconnect("restoreCampfireUi:mountOrRebind", { mode: "activity" });
            this._mountCampfireEmbed("activity");
            return;
        }
        if (app._phase === "meal" && this._shouldMountFireRailEmbed()) {
            logCampfireReconnect("restoreCampfireUi:mountOrRebind", { mode: "activity", phase: "meal" });
            this._mountCampfireEmbed("activity");
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

    /** Normal rest mounts the same fire into the fixed rail, not the old aside. */
    _shouldMountFireRailEmbed() {
        const app = this._app;
        if (!["activity", "meal"].includes(app._phase)) return false;
        if ((app._restVariant ?? "normal") === "gritty") return false;
        if (!isCampfireMinigameEnabled()) return false;
        return true;
    }

    _shouldShowTotmCampfirePanel() {
        const app = this._app;

        if (app._phase !== "activity" || !app._isTotM || !isCampfireMinigameEnabled()) return false;
        if ((app._restVariant ?? "normal") !== "gritty") return false;
        const step = app._selectedWorkflowStep;
        if (step === "sustenance" || step === "gather" || step === "examine") return false;
        if (!this._totmFireUiEnabled()) return false;
        return true;
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

    _isCampColdCampPreview(...args) { return CampCeremonyWoodAndEmbedMethods._isCampColdCampPreview.apply(this, args); }
    _partyFirewoodTotal(...args) { return CampCeremonyWoodAndEmbedMethods._partyFirewoodTotal.apply(this, args); }
    _campPreviewFirewoodCost(...args) { return CampCeremonyWoodAndEmbedMethods._campPreviewFirewoodCost.apply(this, args); }
    _portraitForCeremonyActor(...args) { return CampCeremonyWoodAndEmbedMethods._portraitForCeremonyActor.apply(this, args); }
    _stagedWoodCountForActor(...args) { return CampCeremonyWoodAndEmbedMethods._stagedWoodCountForActor.apply(this, args); }
    _canReclaimCeremonyStagedSlot(...args) { return CampCeremonyWoodAndEmbedMethods._canReclaimCeremonyStagedSlot.apply(this, args); }
    _buildMakeCampCeremonyRequirementSlots(...args) { return CampCeremonyWoodAndEmbedMethods._buildMakeCampCeremonyRequirementSlots.apply(this, args); }
    _maybeClearStagedWoodOnTierChange(...args) { return CampCeremonyWoodAndEmbedMethods._maybeClearStagedWoodOnTierChange.apply(this, args); }
    async clearCeremonyStagedWood(...args) { return CampCeremonyWoodAndEmbedMethods.clearCeremonyStagedWood.apply(this, args); }
    async stageCeremonyWood(...args) { return CampCeremonyWoodAndEmbedMethods.stageCeremonyWood.apply(this, args); }
    async giftCeremonyWoodToFocusedActor(...args) { return CampCeremonyWoodAndEmbedMethods.giftCeremonyWoodToFocusedActor.apply(this, args); }
    async unstageCeremonyWood(...args) { return CampCeremonyWoodAndEmbedMethods.unstageCeremonyWood.apply(this, args); }
    async _spendCeremonyStagedWood(...args) { return CampCeremonyWoodAndEmbedMethods._spendCeremonyStagedWood.apply(this, args); }
    _syncCampCeremonyPreviewToEmbed(...args) { return CampCeremonyWoodAndEmbedMethods._syncCampCeremonyPreviewToEmbed.apply(this, args); }
    _emitCampCeremonyPhaseSync(...args) { return CampCeremonyWoodAndEmbedMethods._emitCampCeremonyPhaseSync.apply(this, args); }
    _campCeremonyMinigameEnabled(...args) { return CampCeremonyWoodAndEmbedMethods._campCeremonyMinigameEnabled.apply(this, args); }
    async _commitMakeCampCeremonyIgnite(...args) { return CampCeremonyWoodAndEmbedMethods._commitMakeCampCeremonyIgnite.apply(this, args); }
    async _totmAdvanceCampAfterCeremonyIgnite(...args) { return CampCeremonyWoodAndEmbedMethods._totmAdvanceCampAfterCeremonyIgnite.apply(this, args); }
    async _totmSpendMakeCampFirewood(...args) { return CampCeremonyWoodAndEmbedMethods._totmSpendMakeCampFirewood.apply(this, args); }
    _syncTotmCampfireEmbedFromRest(...args) { return CampCeremonyWoodAndEmbedMethods._syncTotmCampfireEmbedFromRest.apply(this, args); }
    async applyActivityFireLevelFromMinigame(...args) { return CampCeremonyWoodAndEmbedMethods.applyActivityFireLevelFromMinigame.apply(this, args); }
    _mountCampfireEmbed(...args) { return CampCeremonyWoodAndEmbedMethods._mountCampfireEmbed.apply(this, args); }
    _tearDownCampfireEmbed(...args) { return CampCeremonyWoodAndEmbedMethods._tearDownCampfireEmbed.apply(this, args); }
    static formatCampFirewoodDonors(names) {
        const app = this._app;

        const unique = [...new Set((names ?? []).filter(Boolean))];
        if (unique.length <= 1) return unique[0] ?? "";
        if (unique.length === 2) return game.i18n.format("ionrift-respite.campCeremony.donors.two", { first: unique[0], second: unique[1] });
        return game.i18n.format("ionrift-respite.campCeremony.donors.many", { list: unique.slice(0, -1).join(", "), last: unique[unique.length - 1] });
    
    }

    async onSetFireLevel(...args) { return CampCeremonyContextMethods.onSetFireLevel.apply(this, args); }
    buildCampfireDrawerContextForMapDialog(...args) { return CampCeremonyContextMethods.buildCampfireDrawerContextForMapDialog.apply(this, args); }
    getFireTabContextForStationDialog(...args) { return CampCeremonyContextMethods.getFireTabContextForStationDialog.apply(this, args); }
    getCampPersonalCardForActor(...args) { return CampCeremonyContextMethods.getCampPersonalCardForActor.apply(this, args); }
    _buildEncounterPlayerFactors(...args) { return CampCeremonyContextMethods._buildEncounterPlayerFactors.apply(this, args); }
}