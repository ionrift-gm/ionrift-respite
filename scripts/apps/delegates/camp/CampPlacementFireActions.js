import {
    CampGearScanner,
    actorHasTinderbox,
    isActorFirewoodItem
} from "../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import {
    clearCampTokens,
    clearPlayerCampGear,
    clearPlayerCampGearType,
    clearSharedCampStation,
    hasCampfirePlaced,
    canPlaceStation
} from "../../../services/camp/props/CompoundCampPlacer.js";
import { closeOpenStationDialog, refreshOpenStationDialog } from "../../camp/StationActivityDialog.js";
import { isComfortEnabled } from "../../../services/camp/gear/ComfortCalculator.js";
import { isSimpleStationsMode, requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import {
    emitPhaseChanged,
    emitActivityFireLevelRequest,
    emitCampFireLevelRequest,
    emitActivityColdCampRequest,
    emitCampColdCampRequest,
    emitCampColdCampCommit,
    emitCampGearPlaced,
    emitCampGearClearPlayer,
    emitCampGearReclaim,
    emitCampStationPlaced,
    emitCampStationReclaim,
    emitCampSceneCleared
} from "../../../services/socket/SocketController.js";
import {
    deactivateStationLayer
} from "../../../services/camp/props/StationInteractionLayer.js";
import { getPartyActors } from "../../../services/party/partyActors.js";

export const CampPlacementFireMethods = {
    async onClearAllCampScene(event, _target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;
        const n = await clearCampTokens();
        if (n > 0) {
            ui.notifications.info(game.i18n.format("ionrift-respite.campPlacement.removedCampTokens", { count: n }));
        } else {
            ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.noCampTokens"));
        }
        emitCampSceneCleared({
                    resetFireLevel: true
                });
        app._fireLevel = "unlit";
        app._campFirePreviewLevel = null;
        app._campFireWoodSpendUserId = null;
        app._fireLitBy = null;
        app._firewoodPledges = new Map();
        app._makeCampStagedWood = [];
        app._makeCampStagedWoodTier = null;
        app._coldCampDecided = false;
        app._campStep2Entered = false;
        app._campPitPlacementCancelled = false;
        app._campPlaceholdersEnsured = false;
        app._campToActivityDone = false;
        if (app._engine) {
            app._engine.fireLevel = "unlit";
            app._engine.fireRollModifier = 0;
        }
        void CampfireTokenLinker.setLightState(false);
        deactivateStationLayer();
        await closeOpenStationDialog();
        await app._saveRestState();
        app.render();
    
    },

    async onClearMyCampGear(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const root = target?.closest?.("[data-action=\"clearMyCampGear\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        if (!actorId) return;

        const sceneIdGm = canvas?.scene?.id ?? null;

        if (game.user.isGM) {
            const n = await clearPlayerCampGear(actorId, sceneIdGm);
            if (n > 0) {
                ui.notifications.info(game.i18n.format("ionrift-respite.campPlacement.removedCharacterTokens", { count: n }));
                emitCampSceneCleared({ actorId });
            } else {
                ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.noCharacterTokens"));
            }
            app.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.clearTokensOwnOnly"));
            return;
        }

        const sceneId = canvas?.scene?.id ?? null;
        emitCampGearClearPlayer({
                    actorId,
                    userId: game.user.id,
                    sceneId
                });
    
    },

    async onReclaimCampGear(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const root = target?.closest?.("[data-action=\"reclaimCampGear\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        const gearType = root?.dataset?.gearType;
        if (!actorId || !gearType) return;

        const sceneIdGm = canvas?.scene?.id ?? null;

        if (game.user.isGM) {
            const n = await clearPlayerCampGearType(actorId, gearType, sceneIdGm);
            if (n > 0) {
                ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.gearPickedUp"));
                emitCampGearPlaced({
                    actorId,
                    gearType
                });
            } else {
                ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.nothingToPickUpSlot"));
            }
            app.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.reclaimGearOwnOnly"));
            return;
        }

        const sceneId = canvas?.scene?.id ?? null;
        emitCampGearReclaim({
                    actorId,
                    gearType,
                    userId: game.user.id,
                    sceneId
                });
        ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.pickUpSent"));
    
    },

    async onReclaimCampStation(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const root = target?.closest?.("[data-action=\"reclaimCampStation\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        const stationKey = root?.dataset?.stationKey;
        if (!actorId || !stationKey) return;

        if (game.user.isGM) {
            const n = await clearSharedCampStation(stationKey);
            if (n > 0) {
                ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.stationPickedUp"));
                emitCampStationPlaced();
            } else {
                ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.nothingToPickUpStation"));
            }
            app.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.pickUpStationOwnOnly"));
            return;
        }
        if (!canPlaceStation(actor, stationKey)) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.cannotPickUpStation"));
            return;
        }

        emitCampStationReclaim({
                    actorId,
                    stationKey,
                    userId: game.user.id
                });
        ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacement.pickUpSent"));
    
    },

    async _runSetCampFireLevelForGm(level, requestingUserId = null, gmOverride = false) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!["embers", "campfire", "bonfire"].includes(level)) return;

        const actors = getPartyActors();
        if (!gmOverride) {
            const hasTinderbox = actors.some(a => actorHasTinderbox(a));
            if (!hasTinderbox) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.noTinderboxAmpersand"));
                return;
            }
        }

        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[level] ?? 0;
        if (!gmOverride) {
            const totalFirewood = actors.reduce((sum, a) => {
                const it = a.items.find(i => isActorFirewoodItem(i));
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (cost > totalFirewood) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.notEnoughFirewood"));
                return;
            }
        }

        const wasUnlit = (app._fireLevel ?? "unlit") === "unlit";
        if (level === (app._fireLevel ?? "unlit")) return;

        app._coldCampDecided = false;
        app._campFireWoodSpendUserId = requestingUserId ?? null;

        const FIRE_ENCOUNTER_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        app._fireLevel = level;
        app._campFirePreviewLevel = null;
        if (app._engine) {
            app._engine.fireLevel = level;
            app._engine.fireRollModifier = FIRE_ENCOUNTER_MOD[level] ?? 0;
        }

        await CampfireTokenLinker.setLightState(true, level, { ignite: wasUnlit });

        emitPhaseChanged("camp", {
                fireLevel: level,
                fireLitBy: app._fireLitBy ?? null,
                coldCampDecided: false,
                firewoodPledges: Array.from(app._firewoodPledges?.entries() ?? []),
                selectedTerrain: app._selectedTerrain ?? null
            });

        await app._saveRestState();
        const isTotmMode = app._isTotM;
        const willAdvance =
            !isTotmMode
            && app._phase === "camp"
            && !app._campToActivityDone
            && (app._fireLevel ?? "unlit") !== "unlit"
            && (isSimpleStationsMode() || isComfortEnabled());
        if (willAdvance) {
            await app._maybeSpendMakeCampCeremonyWoodBeforeAdvance();
            await app._advanceCampToActivity();
        } else if (!app._campToActivityDone) {
            app.render();
        }
    
    },

    async changeFireLevelDuringActivity(level, { fromPlayer = false, requestingUserId = null, fromMinigame = false } = {}) {
        const app = this._app;

        if (!game.user.isGM) return { ok: false, error: "GM only" };
        if (app._phase !== "activity") return { ok: false, error: "Wrong phase" };
        const restType = app._engine?.restType
            ?? app._selectedRestType
            ?? app._restData?.restType
            ?? "long";
        const isGrittyShort = restType === "short"
            && (app._restVariant ?? "normal") === "gritty";
        if (restType === "short" && !isGrittyShort) return { ok: false, error: "Short rest" };
        if (!["embers", "campfire", "bonfire"].includes(level)) return { ok: false, error: "Invalid level" };

        const cur = app._fireLevel ?? "unlit";
        if (level === cur) return { ok: true };

        const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const costOf = (l) => (l === "unlit" ? 0 : (F[l] ?? 0));
        const curCost = costOf(cur);
        const newCost = costOf(level);

        const actors = getPartyActors();
        const hasTinderbox = actors.some(a => actorHasTinderbox(a));

        if (newCost < curCost) {
            // Player request or minigame douse: deliberate action, no extra GM prompt
            if (!fromPlayer && !fromMinigame) {
                const confirmed = await Dialog.confirm({
                    title: game.i18n.localize("ionrift-respite.campPlacement.lowerFireTitle"),
                    content: game.i18n.localize("ionrift-respite.campPlacement.lowerFireContent"),
                    yes: () => true,
                    no: () => false,
                    defaultYes: false
                });
                if (!confirmed) return { ok: false, cancelled: true };
            }
        } else if (newCost > curCost) {
            const need = newCost - curCost;
            if (cur === "unlit" && !hasTinderbox) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.noTinderbox"));
                return { ok: false, error: "No tinderbox" };
            }
            // When a player requests the change, only their actors' firewood counts
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const spendActors = requestingUserId
                ? actors.filter(a => (a.ownership?.[requestingUserId] ?? 0) >= OWNER)
                : actors;
            const totalFirewood = spendActors.reduce((sum, a) => {
                const it = a.items.find(i => isActorFirewoodItem(i));
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (need > 0 && totalFirewood < need) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacement.notEnoughFirewood"));
                return { ok: false, error: "Not enough wood" };
            }
            if (need > 0) {
                const spend = await app._spendPartyFirewoodForMakeCamp(need, requestingUserId);
                if (!spend.ok) {
                    ui.notifications.warn(spend.error ?? game.i18n.localize("ionrift-respite.campPlacement.spendFailed"));
                    return { ok: false, error: spend.error };
                }
            }
        }

        app._fireLevel = level;
        app._coldCampDecided = false;
        app._campFirePreviewLevel = null;
        app._stationFirePreviewLevel = null;
        const FIRE_ENCOUNTER_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (app._engine) {
            app._engine.fireLevel = level;
            app._engine.fireRollModifier = FIRE_ENCOUNTER_MOD[level] ?? 0;
        }

        await CampfireTokenLinker.setLightState(true, level, { ignite: cur === "unlit" });

        const label = CampGearScanner.fireLevelLabel(level);
        if (newCost > curCost && (newCost - curCost) > 0) {
            ui.notifications.info(game.i18n.format("ionrift-respite.campPlacement.levelSetSpent", { level: label, count: newCost - curCost }));
        } else if (newCost < curCost) {
            ui.notifications.info(game.i18n.format("ionrift-respite.campPlacement.levelSet", { level: label }));
        } else {
            ui.notifications.info(game.i18n.format("ionrift-respite.campPlacement.levelSet", { level: label }));
        }

        emitPhaseChanged("activity", {
                fireLevel: level,
                fireLitBy: app._fireLitBy ?? null,
                coldCampDecided: false,
                firewoodPledges: Array.from(app._firewoodPledges?.entries() ?? []),
                selectedTerrain: app._selectedTerrain ?? null,
                comfort: app._engine?.comfort ?? null,
                activeShelters: app._engine?.activeShelters ?? []
            });

        await app._saveRestState();
        app._syncTotmCampfireEmbedFromRest();
        app.render();
        void refreshOpenStationDialog();
        return { ok: true };
    
    },

    async setColdCampDuringActivity({ _fromPlayer = false } = {}) {
        const app = this._app;

        if (!game.user.isGM) return { ok: false };
        if (app._phase !== "activity") return { ok: false };
        if ((app._fireLevel ?? "unlit") === "unlit" && (app._coldCampPreview || app._campFirePreviewLevel === "cold_camp")) {
            return { ok: true };
        }

        // Same unlit ceremony as lighting. Cold is the selected tier, not a separate panel.
        app._coldCampDecided = false;
        app._coldCampPreview = true;
        app._campFirePreviewLevel = "cold_camp";
        app._fireLitBy = null;
        app._fireLevel = "unlit";
        app._makeCampStagedWood = [];
        app._makeCampStagedWoodTier = null;
        const FIRE_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (app._engine) {
            app._engine.fireLevel = "unlit";
            app._engine.fireRollModifier = FIRE_MOD.cold_camp ?? 0;
        }
        await CampfireTokenLinker.setLightState(false);

        emitPhaseChanged("activity", {
            coldCampDecided: false,
            coldCampPreview: true,
            campFirePreviewLevel: "cold_camp",
            fireLevel: "unlit",
            fireLitBy: null,
            makeCampStagedWood: [],
            selectedTerrain: app._selectedTerrain ?? null,
            comfort: app._engine?.comfort ?? null,
            activeShelters: app._engine?.activeShelters ?? []
        });

        await app._saveRestState();
        app._campfireApp?.setPanelMode({ makeCampCeremony: true, showDouseBtn: false });
        app._syncCampCeremonyPreviewToEmbed({ force: true });
        app.render();
        void refreshOpenStationDialog();
        return { ok: true };
    
    },

    async onSelectCampFireLevel(event, target) {
        const app = this._app;

        const root = target?.closest?.("[data-action=\"selectCampFireLevel\"]") ?? target;
        const level = root?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;

        // Activity-phase fire changes use a separate socket + handler
        // so the GM runs changeFireLevelDuringActivity (which confirms cost deltas).
        if (app._phase === "activity" && app._isTotM) {
            const isUnlit = (app._fireLevel ?? "unlit") === "unlit";
            if (isUnlit) {
                if (!game.user.isGM) {
                    emitCampFireLevelRequest(level, game.user.id);
                    return;
                }
                app._maybeClearStagedWoodOnTierChange(level);
                app._campFirePreviewLevel = level;
                app._coldCampPreview = false;
                app._coldCampDecided = false;
                if (app._engine) {
                    app._engine.fireLevel = "unlit";
                    app._engine.fireRollModifier = 0;
                }
                emitPhaseChanged(app._phase, {
                    campFirePreviewLevel: level,
                    coldCampPreview: false,
                    coldCampDecided: false,
                    makeCampStagedWood: [...(app._makeCampStagedWood ?? [])],
                    selectedTerrain: app._selectedTerrain ?? null
                });
                app._syncCampCeremonyPreviewToEmbed();
                app.render();
                return;
            }

            if (!game.user.isGM) {
                // Player-side pre-validation with modal dialogs
                const cur = app._fireLevel ?? "unlit";
                if (level === cur) return;

                const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
                const costOf = (l) => (l === "unlit" ? 0 : (F[l] ?? 0));
                const curCost = costOf(cur);
                const newCost = costOf(level);
                const levelLabel = CampGearScanner.fireLevelLabel(level);

                if (newCost > curCost) {
                    // Promoting fire: check kindling locally (any party member can have tinderbox)
                    const allActors = getPartyActors();
                    const hasTinderbox = cur !== "unlit" || allActors.some(a => actorHasTinderbox(a));
                    if (cur === "unlit" && !hasTinderbox) {
                        await game.ionrift.library.confirm({
                            title: game.i18n.localize("ionrift-respite.campPlacement.cannotLightTitle"),
                            content: game.i18n.localize("ionrift-respite.campPlacement.cannotLightContent"),
                            yesLabel: game.i18n.localize("ionrift-respite.campPlacement.close"),
                            noLabel: null,
                            yesIcon: "fas fa-times",
                            defaultYes: true
                        });
                        return;
                    }
                    // Only count firewood from the player's own characters
                    const myActors = allActors.filter(a => a.isOwner);
                    const need = newCost - curCost;
                    const myFirewood = myActors.reduce((sum, a) => {
                        const it = a.items.find(i => isActorFirewoodItem(i));
                        return sum + (it?.system?.quantity ?? 0);
                    }, 0);
                    if (need > 0 && myFirewood < need) {
                        await game.ionrift.library.confirm({
                            title: game.i18n.localize("ionrift-respite.campPlacement.notEnoughFirewoodTitle"),
                            content: game.i18n.format("ionrift-respite.campPlacement.notEnoughFirewoodContent", { level: levelLabel, need, have: myFirewood }),
                            yesLabel: game.i18n.localize("ionrift-respite.campPlacement.close"),
                            noLabel: null,
                            yesIcon: "fas fa-times",
                            defaultYes: true
                        });
                        return;
                    }
                    // Confirm firewood consumption from the player's own stock
                    const confirmed = await game.ionrift.library.confirm({
                        title: game.i18n.format("ionrift-respite.campPlacement.raiseFireTitle", { level: levelLabel }),
                        content: game.i18n.format("ionrift-respite.campPlacement.raiseFireContent", { need }),
                        yesLabel: game.i18n.localize("ionrift-respite.campPlacement.lightIt"),
                        noLabel: game.i18n.localize("ionrift-respite.campPlacement.cancel"),
                        yesIcon: "fas fa-fire",
                        noIcon: "fas fa-times",
                        defaultYes: true
                    });
                    if (!confirmed) return;
                } else if (newCost < curCost) {
                    // Reducing fire: player can do app directly, just confirm no refund
                    const confirmed = await game.ionrift.library.confirm({
                        title: game.i18n.format("ionrift-respite.campPlacement.lowerFireToTitle", { level: levelLabel }),
                        content: game.i18n.localize("ionrift-respite.campPlacement.lowerFireContent"),
                        yesLabel: game.i18n.localize("ionrift-respite.campPlacement.lowerFire"),
                        noLabel: game.i18n.localize("ionrift-respite.campPlacement.cancel"),
                        yesIcon: "fas fa-arrow-down",
                        noIcon: "fas fa-times",
                        defaultYes: false
                    });
                    if (!confirmed) return;
                }
                emitActivityFireLevelRequest(level, game.user.id);
            } else {
                await this.changeFireLevelDuringActivity(level);
            }
            return;
        }

        // Camp phase: broadcast preview to all players via GM relay.
        // The segment strip updates are a party decision, so all clients must see them.
        if (!game.user.isGM) {
            emitCampFireLevelRequest(level, game.user.id);
            return;
        }
        // GM: set local preview and broadcast to all clients. Picking a fire tier
        // also clears any committed cold camp so the table can switch back.
        app._maybeClearStagedWoodOnTierChange(level);
        app._campFirePreviewLevel = level;
        app._coldCampPreview = false;
        app._coldCampDecided = false;
        emitPhaseChanged(app._phase, {
            campFirePreviewLevel: level,
            coldCampPreview: false,
            coldCampDecided: false,
            makeCampStagedWood: [...(app._makeCampStagedWood ?? [])],
            selectedTerrain: app._selectedTerrain ?? null
        });
        app._syncCampCeremonyPreviewToEmbed();
        app.render();
    
    },

    async onCampColdCamp(_event, _target) {
        const app = this._app;

        if (!game.user.isGM) return;
        await app._campCeremony.decideColdCamp();
    
    },

    async onSelectCampColdCamp(_event, _target) {
        const app = this._app;

        if (app._phase === "activity") {
            const isUnlit = (app._fireLevel ?? "unlit") === "unlit";
            if (isUnlit) {
                if (!game.user.isGM) {
                    emitCampColdCampRequest(game.user.id);
                    return;
                }
                app._maybeClearStagedWoodOnTierChange("cold_camp");
                app._coldCampDecided = false;
                app._coldCampPreview = true;
                app._campFirePreviewLevel = "cold_camp";
                if (app._engine) {
                    app._engine.fireLevel = "unlit";
                    app._engine.fireRollModifier = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL.cold_camp ?? 0;
                }
                void app.clearCeremonyStagedWood({ silent: true });
                emitPhaseChanged(app._phase, {
                    coldCampDecided: false,
                    coldCampPreview: true,
                    campFirePreviewLevel: "cold_camp",
                    makeCampStagedWood: [],
                    selectedTerrain: app._selectedTerrain ?? null
                });
                app._syncCampCeremonyPreviewToEmbed();
                app.render();
                return;
            }
            if (!game.user.isGM) {
                emitActivityColdCampRequest(game.user.id);
                return;
            }
            await this.setColdCampDuringActivity();
            return;
        }
        if (app._phase !== "camp") return;
        // Camp phase: cold camp is a preview toggle, not an instant lock-in.
        // Players and GM can preview cold camp and switch back to fire tiers.
        if (!game.user.isGM) {
            emitCampColdCampRequest(game.user.id);
            return;
        }
        // GM: toggle cold camp preview and broadcast
        app._maybeClearStagedWoodOnTierChange("cold_camp");
        app._coldCampPreview = true;
        app._campFirePreviewLevel = "cold_camp";
        void app.clearCeremonyStagedWood({ silent: true });
        emitPhaseChanged(app._phase, {
            coldCampPreview: true,
            campFirePreviewLevel: "cold_camp",
            makeCampStagedWood: [],
            selectedTerrain: app._selectedTerrain ?? null
        });
        app._syncCampCeremonyPreviewToEmbed();
        app.render();
    
    },

    async onConfirmCampColdCamp() {
        const app = this._app;

        if (app._phase !== "camp") return;
        if (app._coldCampDecided) return;
        if (!game.user.isGM) {
            emitCampColdCampCommit(game.user.id);
            return;
        }
        await app._campCeremony.selectColdCamp();
    
    },

    async onProceedFromMakeCamp(_event, _target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._phase !== "camp") return;
        if (app._campToActivityDone) {
            ui.notifications?.info(game.i18n.localize("ionrift-respite.campPlacement.alreadyAdvanced"));
            return;
        }

        const safeRest = !!app._engine?.safeRestSpot;
        const comfortOn = isComfortEnabled();
        const mapCampFire = requiresMapCampFire();
        const coldCampPreview = !!app._coldCampPreview;
        const pitOk = app._isTotM || safeRest
            || (!(comfortOn || mapCampFire) ? true : hasCampfirePlaced());
        const fireOk = safeRest
            || !(comfortOn || mapCampFire)
            || (app._fireLevel ?? "unlit") !== "unlit"
            || !!app._coldCampDecided
            || coldCampPreview;

        if (!pitOk) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.campPlacement.placeCampfireBeforeProceeding"));
            return;
        }
        if (!fireOk) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.campPlacement.lightOrColdBeforeProceeding"));
            return;
        }

        if (coldCampPreview && !app._coldCampDecided) {
            await app._campCeremony.selectColdCamp();
        }

        await app._totmSpendMakeCampFirewood();
        await app._advanceCampToActivity();
    
    }
};
