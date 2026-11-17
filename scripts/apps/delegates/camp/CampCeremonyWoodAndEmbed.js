import {
    CampGearScanner,
    countActorFirewood,
    findConsumableFirewoodItem
} from "../../../services/camp/gear/CampGearScanner.js";
import { logCampfireReconnect } from "../../../services/camp/fire/CampfireReconnectLog.js";
import { ItemOutcomeHandler } from "../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import {
    emitPhaseChanged,
    emitCampLightFire,
    emitActivityFireLevelRequest,
    emitSocketMessage
} from "../../../services/socket/SocketController.js";
import { buildCampCeremonyPhasePayload } from "../../../services/camp/gear/campCeremonySync.js";
import { isCampfireMinigameEnabled } from "../../../services/rest/flow/RestProfileSettings.js";
import { CampfireEmbed } from "../../camp/CampfireEmbed.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { registerCampfireEmbed, clearCampfireEmbed } from "../../../module.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { CampCeremonyDelegate } from "./CampCeremonyDelegate.js";

const FIRE_LEVELS = Object.freeze(["unlit", "embers", "campfire", "bonfire"]);

export const CampCeremonyWoodAndEmbedMethods = {
    _isCampColdCampPreview() {
        const app = this._app;

        return !!app._coldCampPreview || app._campFirePreviewLevel === "cold_camp";
    
    },

    _partyFirewoodTotal() {
        const app = this._app;

        return getPartyActors().reduce((sum, a) => sum + countActorFirewood(a), 0);
    
    },

    _campPreviewFirewoodCost(level = null) {
        const app = this._app;

        const lv = level ?? app._campFirePreviewLevel ?? "embers";
        if (lv === "cold_camp") return 0;
        return CampGearScanner.FIREWOOD_COST_BY_LEVEL[lv] ?? 0;
    
    },

    _portraitForCeremonyActor(actorId, userId) {
        const app = this._app;

        const actor = game.actors.get(actorId);
        if (actor?.img) return actor.img;
        const user = game.users.get(userId);
        return user?.avatar ?? "";
    
    },

    _stagedWoodCountForActor(actorId) {
        const app = this._app;

        return (app._makeCampStagedWood ?? []).filter(s => s.actorId === actorId).length;
    
    },

    _canReclaimCeremonyStagedSlot(slot) {
        const app = this._app;

        if (!slot) return false;
        return game.user.isGM || slot.userId === game.user.id;
    
    },

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
                    tooltip: game.i18n.format("ionrift-respite.campCeremony.kindlingSlot.returnTooltip", { actor: s.actorName })
                });
            } else {
                slots.push({
                    filled: false,
                    kindlingImg,
                    insufficient: (i + 1) > party,
                    tooltip: game.i18n.localize("ionrift-respite.campCeremony.kindlingSlot.dragTooltip")
                });
            }
        }
        return slots;
    
    },

    _maybeClearStagedWoodOnTierChange(newLevel) {
        const app = this._app;

        const newCost = this._campPreviewFirewoodCost(newLevel);
        const prev = app._makeCampStagedWoodTier;
        if (prev !== null && newCost < prev && (app._makeCampStagedWood?.length ?? 0) > 0) {
            this.clearCeremonyStagedWood({ silent: true });
        }
        app._makeCampStagedWoodTier = newCost;
    
    },

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
            ui.notifications.info(game.i18n.localize("ionrift-respite.campCeremony.kindlingReturned"));
        }
    
    },

    async stageCeremonyWood(userId, actorId) {
        const app = this._app;

        const cost = this._campPreviewFirewoodCost();
        if (this._isCampColdCampPreview() || cost <= 0) return false;
        if ((app._makeCampStagedWood?.length ?? 0) >= cost) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.enoughKindling"));
            return false;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return false;
        const available = countActorFirewood(actor) - this._stagedWoodCountForActor(actorId);
        if (available <= 0) {
            ui.notifications.warn(game.i18n.format("ionrift-respite.campCeremony.noKindlingLeft", { actor: actor.name }));
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
            emitSocketMessage({
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
    
    },

    async giftCeremonyWoodToFocusedActor() {
        const app = this._app;

        if (!game.user.isGM) return;
        const actor = app._selectedCharacterId ? game.actors.get(app._selectedCharacterId) : null;
        if (!actor) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.selectCharacterFirst"));
            return;
        }
        try {
            const result = await ItemOutcomeHandler.grantToActor(actor.id, "kindling", 1);
            ui.notifications.info(game.i18n.format("ionrift-respite.campCeremony.giftedKindling", { actor: result.actorName }));
            this._emitCampCeremonyPhaseSync();
            this._syncCampCeremonyPreviewToEmbed();
            if (app._campfireApp) void app._campfireApp.render();
            else app.render();
        } catch (err) {
            console.error(`${MODULE_ID} | giftCeremonyWood:`, err);
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.giftKindlingFailed"));
        }
    
    },

    async unstageCeremonyWood(slotId) {
        const app = this._app;

        const slot = (app._makeCampStagedWood ?? []).find(s => s.id === slotId);
        if (!slot) return;
        if (!this._canReclaimCeremonyStagedSlot(slot)) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.reclaimKindlingDenied"));
            return;
        }
        if (!game.user.isGM) {
            emitSocketMessage({
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
    
    },

    async _spendCeremonyStagedWood(cost) {
        const app = this._app;

        const spendNames = [];
        if (cost <= 0) return { ok: true, spendNames };
        const staged = (app._makeCampStagedWood ?? []).slice(0, cost);
        if (staged.length < cost) {
            return { ok: false, spendNames, error: game.i18n.localize("ionrift-respite.campCeremony.spendError.notEnough") };
        }
        for (const slot of staged) {
            const actor = game.actors.get(slot.actorId);
            if (!actor) return { ok: false, spendNames, error: game.i18n.localize("ionrift-respite.campCeremony.spendError.actorMissing") };
            const item = findConsumableFirewoodItem(actor);
            if (!item || (item.system?.quantity ?? 0) <= 0) {
                return { ok: false, spendNames, error: game.i18n.format("ionrift-respite.campCeremony.spendError.kindlingGone", { actor: slot.actorName }) };
            }
            const qty = item.system?.quantity ?? 1;
            if (qty <= 1) await item.delete();
            else await item.update({ "system.quantity": qty - 1 });
            spendNames.push(slot.actorName);
        }
        app._makeCampStagedWood = [];
        return { ok: true, spendNames };
    
    },

    _syncCampCeremonyPreviewToEmbed(syncOpts = {}) {
        const app = this._app;

        const unlitActivity = app._phase === "activity" && (app._fireLevel ?? "unlit") === "unlit";
        if (!app._campfireApp || (!this._campCeremonyMinigameEnabled() && !unlitActivity)) return;
        const preview = (app._coldCampDecided || this._isCampColdCampPreview())
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
    
    },

    _emitCampCeremonyPhaseSync(extra = {}) {
        const app = this._app;

        emitPhaseChanged(app._phase, buildCampCeremonyPhasePayload(app, extra));
    
    },

    _campCeremonyMinigameEnabled() {
        const app = this._app;

        if (!isCampfireMinigameEnabled()) return false;
        if (app._phase !== "camp" && app._phase !== "activity") return false;
        if (!app._showFullMakeCampPanel() && !app._isTotM) return false;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeFromSetting);
        if (effectiveSafe) return false;
        if ((app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided) return false;
        return true;
    },

    async _commitMakeCampCeremonyIgnite(opts = {}) {
        const app = this._app;

        if (app._commitMakeCampCeremonyInFlight) return;
        if (app._fireLitBy && (app._fireLevel ?? "unlit") !== "unlit") return;
        if (app._phase !== "camp" && app._phase !== "activity") return;
        if (!this._campCeremonyMinigameEnabled()) return;
        if (this._isCampColdCampPreview()) return;
        if (app._campPitBlocksFireLighting()) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.placeCampfireBeforeLighting"));
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
            ui.notifications.warn(game.i18n.format("ionrift-respite.campCeremony.placeKindlingBeforeLighting", { cost, level: chosenLevel }));
            return;
        }

        const selectedActor = app._selectedCharacterId
            ? game.actors.get(app._selectedCharacterId)
            : null;
        const actorId = opts.actorId ?? selectedActor?.id ?? getPartyActors()[0]?.id;
        const method = opts.method ?? "Minigame";
        if (!actorId) return;

        if ((app._fireLevel ?? "unlit") !== "unlit") {
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
                { autoAdvanceTotm: false }
            );
            await this._totmSpendMakeCampFirewood();
            app._makeCampStagedWood = [];
            app._makeCampStagedWoodTier = null;
            if (app._campfireApp) {
                app._campfireApp.setPanelMode({
                    makeCampCeremony: false,
                    showDouseBtn: true
                });
                this._syncTotmCampfireEmbedFromRest();
            }
            emitPhaseChanged(app._phase, {
                campStatus: app._campStatus,
                fireLevel: app._fireLevel,
                fireLitBy: app._fireLitBy,
                coldCampDecided: false,
                makeCampStagedWood: []
            });
            await app._saveRestState();
            app.render();
        } finally {
            app._commitMakeCampCeremonyInFlight = false;
        }
    },

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
    
    },

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
        const label = CampGearScanner.fireLevelLabel(level);
        const lighterName = app._fireLitBy?.actorName ?? null;
        const donors = CampCeremonyDelegate.formatCampFirewoodDonors(spend.spendNames);

        if (!spend.spendNames.length) {
            ui.notifications.info(game.i18n.format("ionrift-respite.campCeremony.firewoodProvided", { level: label }));
        } else {
            const uniqueDonors = [...new Set(spend.spendNames.filter(Boolean))];
            const allFromLighter = lighterName && uniqueDonors.length === 1 && uniqueDonors[0] === lighterName;
            if (allFromLighter) {
                ui.notifications.info(game.i18n.format("ionrift-respite.campCeremony.donorProvidesFirewood", { donors, level: label }));
            } else {
                ui.notifications.info(game.i18n.format("ionrift-respite.campCeremony.firewoodTakenFrom", { level: label, donors }));
            }
        }
    
    },

    _syncTotmCampfireEmbedFromRest() {
        const app = this._app;

        app._campfireApp?.syncFromRestFireLevel?.(
            app._fireLevel ?? "unlit",
            !!app._coldCampDecided
        );
    
    },

    async applyActivityFireLevelFromMinigame(level) {
        const app = this._app;

        if (!this._activityFireUiEnabled()) return;
        const cur = app._fireLevel ?? "unlit";
        if (level === cur) return;

        if (level === "unlit") {
            if (!game.user.isGM) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.extinguishGmOnly"));
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
    
    },

    _mountCampfireEmbed(mode, options = {}) {
        const app = this._app;

        const forCamp = mode === "camp";
        const forStation = mode === "station";
        const forTotmActivity = mode === "activity";
        if (forCamp && !this._campCeremonyMinigameEnabled()) {
            logCampfireReconnect("mountCampfireEmbed:skip", { mode, reason: "camp ceremony disabled" });
            return;
        }
        if (forTotmActivity && !this._shouldShowTotmCampfirePanel() && !this._shouldMountFireRailEmbed()) {
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

        const activityUnlit = forTotmActivity && (app._fireLevel ?? "unlit") === "unlit";
        if (activityUnlit && app._coldCampDecided) {
            app._coldCampDecided = false;
            app._coldCampPreview = true;
            app._campFirePreviewLevel = "cold_camp";
        }
        const isCeremony = forCamp || (!forStation && (this._campCeremonyMinigameEnabled() || activityUnlit));

        if (app._campfireApp) {
            app._campfireApp.setPanelMode({
                makeCampCeremony: isCeremony,
                showDouseBtn: !isCeremony
            });
            app._campfireApp.rebindContainer(host);
            app._campfireApp.setContextActorId(app._selectedCharacterId);
            if (isCeremony) {
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
            showDouseBtn: !isCeremony,
            makeCampCeremony: isCeremony,
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

        if (isCeremony) {
            app._campfireApp.syncFromRestFireLevel("unlit", false);
            this._syncCampCeremonyPreviewToEmbed({ force: true });
        } else {
            this._syncTotmCampfireEmbedFromRest();
        }

        registerCampfireEmbed(app._campfireApp);
        void app._campfireApp.render()
            .then(() => app._scheduleRestWindowRecenter())
            .catch(err => {
                console.error(`${MODULE_ID} | CampfireEmbed render failed:`, err);
            });
    
    },

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
    
    },

};
