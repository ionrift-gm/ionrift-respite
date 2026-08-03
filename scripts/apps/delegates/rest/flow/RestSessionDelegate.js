import { Logger } from "../../../../utils/Logger.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { STUB_RECIPES } from "../../../../data/stub-content.js";
import { applyCustomRecipesToEngine } from "../../../../services/crafting/recipes/RecipeCatalog.js";
import { GrantLedger } from "../../../../services/crafting/outcomes/GrantLedger.js";
import { RestFlowEngine } from "../../../../services/rest/flow/RestFlowEngine.js";
import { RestLedger } from "../../../../services/rest/flow/RestLedger.js";
import { TerrainRegistry } from "../../../../services/events/resolve/TerrainRegistry.js";
import { CampGearScanner } from "../../../../services/camp/gear/CampGearScanner.js";
import { isComfortEnabled } from "../../../../services/camp/gear/ComfortCalculator.js";
import { notifyDetectMagicScanApplied } from "../../../../services/crafting/detectMagic/DetectMagicInventoryGlowBridge.js";
import { isSimpleStationsMode } from "../../../../services/rest/flow/RestProfileSettings.js";
import {
    promoteAllPlaceholders,
    restoreCampPlacementState,
    getCampSceneId,
    getCampSessionIdStored
} from "../../../../services/camp/props/CompoundCampPlacer.js";
import {
    isStationLayerActive,
    refreshStationEmptyNoticeFade
} from "../../../../services/camp/props/StationInteractionLayer.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import { closeStationDialogIfDifferentActor } from "../../../camp/StationActivityDialog.js";
import {
    centerRollRequestRoster
} from "../../../../services/ui/rollRequest/RollRequestView.js";
import { ensureDcPulseAnimation } from "../../../../services/ui/rollRequest/RollRequestDcPulse.js";
import { isTrailerFilmingMode as _isTrailerFilmingMode } from "../layout/RestWindowLayout.js";
import { _removeRejoinBar } from "../../../../module.js";
import {
    emitPhaseChanged,
    emitArmorToggle,
    emitCampLightFire,
    emitTrainingStateUpdate
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { RestSetupApp, _logGmRestSheet } from "../../../rest/RestSetupApp.js";

export class RestSessionDelegate {
    constructor(app) {
        this._app = app;
    }

    async _advanceCampToActivity() {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._phase !== "camp" || app._campToActivityDone) return;

        CampfireMakeCampDialog.closeIfOpen();
        app._campToActivityDone = true;
        app._campStep2Entered = true;

        await promoteAllPlaceholders(!!app._engine?.safeRestSpot, {
            simpleStations: isSimpleStationsMode()
        });

        if (!app._engine?.safeRestSpot) {
            const pledges = Array.from(app._firewoodPledges.entries());
            for (const [, pledge] of pledges) {
                if (pledge.gmPledge) continue;
                const actor = game.actors.get(pledge.actorId);
                if (!actor) continue;
                const firewoodItem = actor.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                if (firewoodItem && (firewoodItem.system?.quantity ?? 0) >= pledge.count) {
                    await firewoodItem.update({ "system.quantity": (firewoodItem.system.quantity - pledge.count) });
                } else {
                    const fallback = await app._spendPartyFirewoodForMakeCamp(pledge.count, null);
                    if (!fallback.ok) {
                        ui.notifications.warn(`Could not spend firewood for ${pledge.actorName}. Proceeding anyway.`);
                    }
                }
            }
            if (pledges.length > 0) {
                const level = app._fireLevel ?? "unlit";
                const label = level.charAt(0).toUpperCase() + level.slice(1);
                const names = pledges.map(([, p]) => p.actorName).join(" and ");
                ui.notifications.info(`${names} ${pledges.length === 1 ? "spends" : "spend"} firewood for ${label}.`);
            }
        }
        app._campFireWoodSpendUserId = null;

        app._phase = "activity";
        app._applyLoseActivityTravelLocks();
        app._applyAutoOtherWhenSoleActivity();
        _logGmRestSheet("_advanceCampToActivity", "phase -> activity, closing window");

        if (app._coldCampDecided) {
            app._restLedger.add({
                phase: "camp", category: "cold_camp", icon: "fas fa-snowflake",
                summary: "Cold camp: the party sleeps without fire."
            });
        } else {
            const level = app._fireLevel ?? "unlit";
            app._restLedger.add({
                phase: "camp", category: "fire", icon: "fas fa-fire",
                summary: `Fire level: ${level}`,
                detail: app._fireLitBy?.actorName ? `Lit by ${app._fireLitBy.actorName}` : ""
            });
        }
        app._refreshLedgerApp();

        const isTheater = app._isTotM;
        if (!isTheater) {
            await app.close({});
        }

        emitPhaseChanged(app._phase, {
                campStatus: app._campStatus,
                fireLevel: app._fireLevel,
                fireLitBy: app._fireLitBy,
                coldCampDecided: app._coldCampDecided ?? false,
                makeCampStagedWood: []
            });
        await this._saveRestState();
        if (!isTheater) {
            app._activateCanvasStationLayer();
        } else {
            // Pre-size before template swap so camp ,  activity does not jump width twice.
            if (app._totmCampfireMinigamePanelEnabled() && !_isTrailerFilmingMode()) {
                const targetW = app._campRestWindowTargetWidth();
                app._applyRestWindowPosition({
                    width: targetW,
                    left: Math.max(20, Math.round((window.innerWidth - targetW) / 2))
                });
            }
            app.render({ force: true });
        }
        _logGmRestSheet("_advanceCampToActivity", "advance complete", { rendered: app.rendered });

        if (_isTrailerFilmingMode() && game.user.isGM) {
            await app._syncCampfireTokenFromRestState();
        }
    
    }

    async _skipCampForSafeRest() {
        const app = this._app;

        const terrain = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
        const isSafeRest = !!(app._engine?.safeRestSpot);
        const isTavern = terrain === "tavern";
        if (!isTavern && !isSafeRest) return false;
        if (!game.user.isGM) return false;

        // Fire is implicitly "campfire" (establishment hearth or safe haven).
        app._fireLevel = "campfire";
        app._coldCampDecided = false;
        app._campToActivityDone = true;
        app._campStep2Entered = true;

        _logGmRestSheet("_skipCampForSafeRest",
            isTavern ? "tavern terrain, skipping camp, opening activities" : "safe rest, skipping camp, opening activities");

        if (isTavern) {
            const trackFood = game.settings.get(MODULE_ID, "trackFood");
            const terrainMealRules = TerrainRegistry.getDefaults(terrain)?.mealRules ?? {};
            if (trackFood && (terrainMealRules.waterPerDay > 0 || terrainMealRules.foodPerDay > 0)) {
                app._mealChoices = app._mealChoices ?? new Map();
                app._daysSinceLastRest = app._daysSinceLastRest ?? 1;
                await app._autoProcessRations();
            }
        }

        app._phase = "activity";
        app._applyLoseActivityTravelLocks();
        app._closeCampfire();
        app._applyAutoOtherWhenSoleActivity();

        const isTheater = app._isTotM;
        if (!isTheater) {
            await app.close({});
        }

        emitPhaseChanged(app._phase, {
            campStatus: app._campStatus,
            fireLevel: app._fireLevel,
            daysSinceLastRest: app._daysSinceLastRest ?? 1,
            selectedTerrain: terrain
        });

        await this._saveRestState();
        app.render({ force: true });
        return true;
    
    }

    async _skipCampForTheater() {
        const app = this._app;

        // Theater mode now shows an inline Make Camp phase instead of skipping.
        // Return false so the camp phase renders normally in the RestSetupApp window.
        return false;
    
    }

    async _skipCampForComfortOff() {
        const app = this._app;

        if (isComfortEnabled()) return false;
        if (!game.user.isGM) return false;
        if (app._engine?.safeRestSpot) return false;
        // Simple + camp stations still needs the map camp (fire, workbench, bedrolls).
        if (!app._isTotM) return false;

        app._fireLevel = "unlit";
        app._coldCampDecided = true;
        app._campToActivityDone = true;
        app._campStep2Entered = true;

        _logGmRestSheet("_skipCampForComfortOff", "comfort off, waiving Make Camp fire phase");

        app._phase = "activity";
        app._applyLoseActivityTravelLocks();

        const isTheater = app._isTotM;
        if (!isTheater) {
            await app.close({});
        }

        emitPhaseChanged(app._phase, {
            campStatus: app._campStatus,
            fireLevel: app._fireLevel
        });
        await this._saveRestState();
        if (!isTheater) {
            app._activateCanvasStationLayer();
        } else {
            app.render({ force: true });
        }
        return true;
    
    }

    async _autoLightCampfireForComfortOffStations() {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._isTotM) return;
        if (app._phase !== "camp" || app._campToActivityDone) return;
        if ((app._fireLevel ?? "unlit") !== "unlit" || app._coldCampDecided) return;

        const actor = getPartyActors()[0];
        if (!actor) {
            ui.notifications.warn("No party character found to light the campfire. Add an actor to the party or light the fire from the map.");
            return;
        }

        await app._campCeremony.lightFire(game.user.id, actor.id, "Campfire", "campfire");
    
    }

    async _loadRestState() {
        const app = this._app;

        const state = game.settings.get(MODULE_ID, "activeRest");
        if (!state?.engine) return false;

        app._engine = RestFlowEngine.deserialize(state.engine);
        app._restId = state.restId ?? app._restId ?? null;
        app._phase = state.phase ?? "setup";
        app._triggeredEvents = state.triggeredEvents ?? [];
        app._eventsRolled = state.eventsRolled ?? false;
        app._activeTreeState = state.activeTreeState ?? null;
        app._campCeremony.restore(state);
        restoreCampPlacementState({
            sceneId: state.campSceneId ?? null,
            sessionId: state.campSessionId ?? null
        });
        app._campFireWoodSpendUserId = state.campFireWoodSpendUserId ?? null;
        app._campStep2Entered = state.campStep2Entered ?? false;
        app._selectedTerrain = state.selectedTerrain;
        app._selectedRestType = state.selectedRestType;
        app._selectedWeather = state.selectedWeather;
        app._characterChoices = new Map(state.characterChoices ?? []);
        app._earlyResults = new Map(state.earlyResults ?? []);
        app._gmOverrides = new Map(state.gmOverrides ?? []);
        app._playerSubmissions = new Map(state.playerSubmissions ?? []);

        // Prune stale charId-keyed entries that may have been written by a prior
        // bug in receiveSubmissionUpdate / receiveRestSnapshot. Those methods
        // incorrectly used charId as the map key; the schema requires userId.
        // Any key that is not a recognised Foundry userId is garbage and must be
        // dropped so _rebuildCharacterChoices can correctly derive _characterChoices.
        let pruned = 0;
        for (const key of app._playerSubmissions.keys()) {
            if (!game.users.get(key)) {
                app._playerSubmissions.delete(key);
                pruned++;
            }
        }
        if (pruned > 0) {

            Logger.warn(`[state-restore] Pruned ${pruned} invalid (non-userId) entries from _playerSubmissions. This indicates a prior schema corruption that has now been fixed.`);
        }
        app._lockedCharacters = new Set(state.lockedCharacters ?? []);
        app._gmFollowUps = new Map(state.gmFollowUps ?? []);
        app._craftingResults = new Map(state.craftingResults ?? []);
        app._trainingStates = new Map(state.trainingStates ?? []);
        app._clearStaleTrainingRollingFlags();
        app._awaitingCombat = state.awaitingCombat ?? false;
        app._gmCopySpellProposal = state.gmCopySpellProposal ?? null;
        app._mealChoices = new Map(state.mealChoices ?? []);
        app._mealResults = state.mealResults ?? null;
        app._mealSubmissions = new Map(state.mealSubmissions ?? []);
        app._activityMealRationsSubmitted = new Set(state.activityMealRationsSubmitted ?? []);
        app._totmFeastServed = state.totmFeastServed ?? false;
        app._daysSinceLastRest = state.daysSinceLastRest ?? 1;

        app._magicScanResults = state.magicScanResults ?? null;
        app._magicScanComplete = state.magicScanComplete ?? false;

        if (!app._grantLedger) app._grantLedger = new GrantLedger();
        app._grantLedger.deserialize(state.grantLedger ?? null);

        if (!app._restLedger) app._restLedger = new RestLedger();
        app._restLedger.deserialize(state.restLedger ?? null);
        if (app._restLedgerApp?.rendered) {
            app._restLedgerApp.setLedger(app._restLedger);
        }

        if (state.travelState) {
            app._travel.deserialize(state.travelState);
        }

        if (state.tavernTotmOverride !== undefined) {
            app._tavernTotmOverride = !!state.tavernTotmOverride;
        } else if (state.selectedTerrain === "tavern" || app._engine?.terrainTag === "tavern") {
            app._applyTavernTotmOverrideForRestStart("tavern");
        } else {
            app._clearTavernTotmOverride();
        }

        const legacyDiscoveries = state.grantedDiscoveries;
        if (legacyDiscoveries?.length) {
            for (const [grantKey, result] of legacyDiscoveries) {
                const colon = grantKey.indexOf(":");
                if (colon < 0) continue;
                const slotKey = GrantLedger.discoverySlotKey(
                    grantKey.slice(0, colon),
                    grantKey.slice(colon + 1)
                );
                if (!app._grantLedger.has(slotKey)) {
                    app._grantLedger.record(slotKey, result);
                }
            }
        }

        if (app._dataReady) await app._dataReady;

        // Rebuild _characterChoices from the restored submissions and overrides
        app._rebuildCharacterChoices();

        if (app._magicScanComplete) {
            notifyDetectMagicScanApplied(this, getPartyActors().map(a => a.id));
        }

        app._syncIncompleteTrainingView();

        return true;
    
    }

    async _saveRestState() {
        const app = this._app;

        if (!game.user.isGM || !app._engine || app._restApplied) return;
        const state = {
            restId: app._restId ?? null,
            engine: app._engine.serialize(),
            phase: app._phase,
            triggeredEvents: app._triggeredEvents,
            eventsRolled: app._eventsRolled ?? false,
            activeTreeState: app._activeTreeState,
            ...app._campCeremony.serialize(),
            campFireWoodSpendUserId: app._campFireWoodSpendUserId ?? null,
            campStep2Entered: app._campStep2Entered ?? false,
            selectedTerrain: app._selectedTerrain,
            selectedRestType: app._selectedRestType,
            selectedWeather: app._selectedWeather,
            characterChoices: Array.from(app._characterChoices.entries()),
            earlyResults: Array.from(app._earlyResults.entries()),
            gmOverrides: Array.from(app._gmOverrides.entries()),
            playerSubmissions: Array.from(app._playerSubmissions.entries()),
            lockedCharacters: Array.from(app._lockedCharacters),
            gmFollowUps: Array.from(app._gmFollowUps.entries()),
            craftingResults: Array.from(app._craftingResults.entries()),
            trainingStates: app._trainingStates?.size
                ? Array.from(app._trainingStates.entries()).map(([id, s]) => [id, { ...s, rolling: false }])
                : [],
            awaitingCombat: app._awaitingCombat ?? false,
            gmCopySpellProposal: app._gmCopySpellProposal?.charged ? app._gmCopySpellProposal : null,
            mealChoices: app._mealChoices ? Array.from(app._mealChoices.entries()) : [],
            mealResults: app._mealResults ?? null,
            mealSubmissions: app._mealSubmissions ? Array.from(app._mealSubmissions.entries()) : [],
            activityMealRationsSubmitted: [...(app._activityMealRationsSubmitted ?? [])],
            totmFeastServed: app._totmFeastServed ?? false,
            daysSinceLastRest: app._daysSinceLastRest ?? 1,
            campfireSnapshot: RestSetupApp._campfireSnapshotFromFireLevel(app._fireLevel),
            travelState: app._travel?.serialize() ?? null,
            grantLedger: app._grantLedger?.serialize() ?? null,
            restLedger: app._restLedger?.serialize() ?? null,
            magicScanComplete: app._magicScanComplete ?? false,
            magicScanResults: app._magicScanResults ?? null,
            tavernTotmOverride: !!app._tavernTotmOverride,
            campSceneId: getCampSceneId(),
            campSessionId: getCampSessionIdStored(),
            timestamp: Date.now()
        };
        await game.settings.set(MODULE_ID, "activeRest", state);
    
    }

    async _loadContentPacks() {
        const app = this._app;

        const enabledPacks = game.settings.get(MODULE_ID, "enabledPacks") ?? {};
        const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};

        let totalRecipes = 0, totalPools = 0;
        const loadedProfessions = new Set();

        for (const [packId, packData] of Object.entries(importedPacks)) {
            if (enabledPacks[packId] === false) {

                Logger.log(`${MODULE_ID} | Pack ${packId}: disabled`);
                continue;
            }

            try {
                const loaded = [];
                const events = packData.events ?? [];
                if (events.length) {
                    app._eventResolver.load(packData.tables ?? null, events);
                    loaded.push(`${events.length} events`);
                }

                // Recipes -- keyed by profession (e.g. { cooking: [...] })
                if (packData.recipes && typeof packData.recipes === "object") {
                    for (const [profId, recipeList] of Object.entries(packData.recipes)) {
                        if (Array.isArray(recipeList) && recipeList.length) {
                            app._craftingEngine.load(profId, recipeList);
                            totalRecipes += recipeList.length;
                            loadedProfessions.add(profId);
                        }
                    }
                    loaded.push(`${totalRecipes} recipes`);
                }

                // Resource Pools
                if (Array.isArray(packData.resourcePools) && packData.resourcePools.length && app._travel) {
                    app._travel.loadPoolsFromData(packData.resourcePools, { fromImportedPack: true });
                    totalPools += packData.resourcePools.length;
                    loaded.push(`${packData.resourcePools.length} pools`);
                }

                if (loaded.length) {

                    Logger.log(`${MODULE_ID} | Pack ${packId}: loaded ${loaded.join(", ")}`);
                }
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to load pack ${packId}:`, e);
            }
        }

        try {
            const { OverlayProfessionLoader } = await import("../../../../services/packs/overlays/OverlayProfessionLoader.js");
            const overlayPacks = await OverlayProfessionLoader.loadAll();
            const mergedOverlayRecipes = OverlayProfessionLoader.mergeProfessionRecipes(overlayPacks);
            for (const [profId, recipeList] of mergedOverlayRecipes) {
                app._craftingEngine.load(profId, recipeList);
                totalRecipes += recipeList.length;
                loadedProfessions.add(profId);
            }
            if (overlayPacks.length) {
                Logger.log(`${MODULE_ID} | Overlay packs: loaded recipes for [${[...loadedProfessions].join(", ")}]`);
            }

            const huntYields = await OverlayProfessionLoader.loadHuntYields();
            if (huntYields && app._travel) {
                app._travel.loadHuntYieldsFromData(huntYields);
                Logger.log(`${MODULE_ID} | Overlay hunt yields: ${Object.keys(huntYields).length} terrain(s)`);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Overlay profession load failed:`, e);
        }

        for (const [profId, recipeList] of Object.entries(STUB_RECIPES)) {
            if (loadedProfessions.has(profId)) continue;
            app._craftingEngine.load(profId, recipeList);
            totalRecipes += recipeList.length;
        }
        if (!loadedProfessions.has("cooking") || !loadedProfessions.has("brewing")) {
            Logger.log(`${MODULE_ID} | Stub recipes applied for uncovered profession(s)`);
        }

        applyCustomRecipesToEngine(app._craftingEngine);
    
    }
    _onRender(context, options) {
        const app = this._app;

        super._onRender?.(context, options);
        app._onRenderBindings(context, options);
        centerRollRequestRoster(app.element);
        ensureDcPulseAnimation(app.element);

        // Belt-and-braces: the rejoin bar's only job is to reopen this window.
        // If we just rendered, the bar is by definition stale. Clear it to
        // prevent the "main UI + collapsed footer" double state during F5
        // rejoin races. Stations + activity phase doesn't render the player
        // RSA, so this only fires in modes/phases where the bar is wrong.
        if (!app._isGM) {
            _removeRejoinBar();
        }

        const titleEl =
            app.element?.querySelector(".window-header .window-title")
            ?? app.element?.querySelector(".window-title")
            ?? app.element?.querySelector("header.window-header h4");
        if (titleEl) {
            let t = "Respite: Rest Phase";
            if (app._phase === "activity" && app._isGM) t = "Respite: GM overview";
            else if (app._phase === "activity" && !app._isGM) t = "Respite: Party progress";
            titleEl.textContent = t;
        }

        {
            const rosterPhases = new Set(["camp", "travel", "activity", "meal"]);
            if (rosterPhases.has(app._phase)) this._installGmStationTokenSyncHook();
            else app._removeGmStationTokenSyncHook();
        }

        if (app._isGM && app.element) {
            const header = app.element.querySelector("header.window-header") ?? app.element.querySelector(".window-header");
            if (header && !header.querySelector(".rest-ledger-header-btn")) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "header-control rest-ledger-header-btn";
                btn.dataset.action = "openLedger";
                btn.dataset.tooltip = "Open Ledger";
                btn.innerHTML = `<i class="fas fa-book"></i>`;
                const closeBtn = header.querySelector("button.close") ?? header.querySelector("[data-action='close']");
                if (closeBtn) header.insertBefore(btn, closeBtn);
                else header.appendChild(btn);
            }
        }

    
    }

    _bindArmorToggleHandlers(element, onAfter) {
        const app = this._app;

        if (!element) return;
        const done = onAfter ?? (() => app.render());
        const armorToggles = element.querySelectorAll(".btn-armor-toggle");
        for (const btn of armorToggles) {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const actorId = btn.dataset.actorId;
                const itemId = btn.dataset.itemId;
                const isDoffed = btn.dataset.isDoffed === "true";
                if (!actorId || !itemId) return;

                const actor = game.actors.get(actorId);
                const item = actor?.items.get(itemId);
                if (!item) return;

                if (!app._doffedArmor) app._doffedArmor = new Map();

                if (isDoffed) {
                    await item.update({ "system.equipped": true });
                    app._doffedArmor.delete(actorId);
                } else {
                    await item.update({ "system.equipped": false });
                    app._doffedArmor.set(actorId, itemId);
                }

                emitArmorToggle({
                    actorId,
                    itemId,
                    isDoffed: !isDoffed
                });

                done();
            });
        }
    
    }

    onSetupContinue(event, target) {
        const app = this._app;

        const step = parseInt(target.dataset.step, 10);
        const form = app.element.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};

        if (step === 1) {
            app._selectedTerrain = formData.terrain ?? app._selectedTerrain ?? "forest";
            app._selectedRestType = formData.restType ?? "long";
            const terrainOpt = app.element.querySelector('[name="terrain"] option:checked');
            app._terrainLabel = terrainOpt?.textContent?.trim()?.replace(" (last used)", "") ?? app._selectedTerrain;
            // Persist last-used terrain
            game.settings.set(MODULE_ID, "lastTerrain", app._selectedTerrain);
            app._daysSinceLastRest = app._daysSinceLastRest ?? 1;

            // Short rest: advance to shelter step (step 2) instead of bypassing entirely
            if (app._selectedRestType === "short") {
                if (!app._shelterOverrides) app._shelterOverrides = {};
                app._setupStep = 2;
                app.render();
                return;
            }
        } else if (step === 2) {
            app._selectedWeather = formData.weather ?? "clear";
            game.settings.set(MODULE_ID, "lastWeather", app._selectedWeather);
            app._selectedComfort = formData.comfort ?? "sheltered";
            // Skip shelter for tavern
            if (app._selectedTerrain === "tavern") {
                app._setupStep = 3;
                app.render();
                return;
            }
        }

        app._setupStep = step + 1;
        app.render();
    
    }

    async _loadData() {
        const app = this._app;

        try {
            const activityResp = await fetch(`modules/${MODULE_ID}/data/activities/default_activities.json`);
            const activities = await activityResp.json();
            app._activities = activities;
            app._activityResolver.load(activities);

            // Always load shared camp disasters (terrain-agnostic decision tree events)
            const disasterResp = await fetch(`modules/${MODULE_ID}/data/core/events/camp_disasters.json`);
            if (disasterResp.ok) {
                const disasters = await disasterResp.json();
                app._eventResolver.load(disasters.tables ?? [], disasters.events ?? []);
            }

            // Overlay Core (and followers) may ship disasters / shared events.
            // Overlay wins on shared ids.
            try {
                const { OverlayEventLoader } = await import("../../../../services/packs/overlays/OverlayEventLoader.js");
                const packs = await OverlayEventLoader.loadAll();
                for (const { data } of packs) {
                    if (data.events?.length) {
                        app._eventResolver.load(data.tables ?? [], data.events);
                    }
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | Overlay disaster/event merge failed:`, e);
            }

            // Content packs: loaded from world storage via Import Pack workflow.
            // Packs are NOT Foundry modules. They are JSON files downloaded from
            // Ionrift and imported through Respite's Content Packs settings UI.
            await app._loadContentPacks();

            // Ensure the travel delegate's resolver has base pool items from the
            // shipped compendium. The delegate constructor may have fired before
            // the compendium index was ready (race condition on startup/restore).
            if (app._travel && game.ionrift?.respite?.travelBasePoolIndex) {
                const resolver = app._travel.getTravelResolver();
                if (resolver && resolver.basePoolCoverage.length === 0) {
                    resolver.loadBaseItems(game.ionrift.respite.travelBasePoolIndex);
                }
            }
        } catch (e) {

            console.error(`${MODULE_ID} | Failed to load seed data:`, e);
        }
    
    }

    async _loadTerrainEvents(terrainTag) {
        const app = this._app;

        const alreadyHasTable = app._eventResolver.tables.has(terrainTag);

        // Resolve path from TerrainRegistry manifest; fall back to convention
        const path = TerrainRegistry.getEventsPath(terrainTag)
            ?? `modules/${MODULE_ID}/data/terrains/${terrainTag}/events.json`;

        let loadedModule = false;
        if (!alreadyHasTable) {
            try {
                const resp = await fetch(path);
                if (resp.ok) {
                    const data = await resp.json();
                    app._eventResolver.load(data.tables ?? [], data.events ?? []);
                    loadedModule = true;
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load module events for ${terrainTag}:`, e);
            }
        }

        // Always merge overlay events (overlay wins on shared ids via Map.set).
        const loadedOverlay = await this._loadTerrainEventsFromOverlay(terrainTag, { merge: true });

        if (!alreadyHasTable && !loadedModule && !loadedOverlay) {
            console.warn(`${MODULE_ID} | No event file for terrain: ${terrainTag}`);
        }
    }

    /**
     * @param {string} terrainTag
     * @param {{ merge?: boolean }} [options] When merge is true, load every matching
     *   overlay pack (not stop at first). Used so Core + Wanderers both contribute.
     * @returns {Promise<boolean>}
     */
    async _loadTerrainEventsFromOverlay(terrainTag, options = {}) {
        const app = this._app;
        const merge = options.merge === true;

        try {
            const { OverlayEventLoader } = await import("../../../../services/packs/overlays/OverlayEventLoader.js");
            const packs = await OverlayEventLoader.loadAll();
            let any = false;
            for (const { data } of packs) {
                const matching = (data.events ?? []).filter(
                    e => e.terrainTags?.includes(terrainTag)
                );
                if (!matching.length) continue;
                const tables = (data.tables ?? []).filter(
                    t => !t.terrainTag || t.terrainTag === terrainTag
                );
                app._eventResolver.load(tables, matching);
                any = true;
                Logger.log(`${MODULE_ID} | Loaded overlay events for terrain: ${terrainTag}`);
                if (!merge) return true;
            }
            return any;
        } catch (e) {
            console.warn(`${MODULE_ID} | Overlay event lookup failed for ${terrainTag}:`, e);
        }
        return false;
    }

    _installGmStationTokenSyncHook() {
        const app = this._app;

        if (app._gmControlTokenHook) return;
        const rosterPhases = new Set(["camp", "travel", "activity", "meal"]);
        app._gmControlTokenHook = (token, controlled) => {
            if (!controlled || !rosterPhases.has(app._phase)) return;
            const actor = token?.actor;
            if (!actor || actor.type !== "character") return;
            const partyActors = getPartyActors();
            if (!partyActors.some(a => a.id === actor.id)) return;
            if (app._isGM) {
                if (app._selectedCharacterId === actor.id) return;
                app._selectedCharacterId = actor.id;
            }
            if (app._phase === "activity") {
                closeStationDialogIfDifferentActor(actor.id);
                if (isStationLayerActive()) {
                    if (!app._isGM) app._refreshStationOverlayForFocusChange();
                    else {
                        refreshStationEmptyNoticeFade(this);
                        app._refreshStationOverlayMeals();
                    }
                }
            }
            if (app._isGM) app.render();
        };
        Hooks.on("controlToken", app._gmControlTokenHook);
    
    }

    async _applyBeddingDown() {
        const app = this._app;

        if (!game.user?.isGM) return;
        const keepWatchIds = app._nightWatchActorIds();
        const [primaryId, ...rest] = app._beddingStatusIds();
        const scene = game.scenes?.active;
        for (const actor of getPartyActors()) {
            if (keepWatchIds.has(actor.id)) continue;
            try {
                await actor.toggleStatusEffect(primaryId, { active: true, overlay: true });
                for (const id of rest) {
                    await actor.toggleStatusEffect(id, { active: true });
                }
            } catch (err) {

                console.warn(`[Respite] Could not apply sleep effects to ${actor.name}:`, err);
            }
            if (scene) {
                const tokens = scene.tokens.filter(t => t.actor?.id === actor.id);
                for (const td of tokens) {
                    await td.setFlag(MODULE_ID, "beddingDown", true).catch(() => {});
                }
            }
        }
    
    }

    async _removeBeddingDown() {
        const app = this._app;

        if (!game.user?.isGM) return;
        const statusIds = app._beddingStatusIds();
        const scene = game.scenes?.active;
        for (const actor of getPartyActors()) {
            for (const id of statusIds) {
                try {
                    await actor.toggleStatusEffect(id, { active: false });
                } catch (err) {

                    console.warn(`[Respite] Could not remove ${id} from ${actor.name}:`, err);
                }
            }
            if (scene) {
                const tokens = scene.tokens.filter(t => t.actor?.id === actor.id);
                for (const td of tokens) {
                    await td.unsetFlag(MODULE_ID, "beddingDown").catch(() => {});
                }
            }
        }
    
    }

    _formatCheckLabel(check, character) {
        const app = this._app;

        let abilityLabel = check.ability?.toUpperCase() ?? "";

        if (check.ability === "best" && character?.id) {
            const actor = game.actors.get(character.id);
            if (actor) {
                const fmtAdapter = game.ionrift?.respite?.adapter;
                const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
                let bestKey = null;
                let bestVal = -1;
                for (const key of abilityKeys) {
                    const mod = fmtAdapter ? fmtAdapter.getAbilityMod(actor, key) : (actor.system?.abilities?.[key]?.mod ?? 0);
                    if (mod > bestVal) { bestVal = mod; bestKey = key; }
                }
                if (bestKey) abilityLabel = `${bestKey.toUpperCase()} (${bestVal})`;
            }
        }

        const skillPart = check.skill ? ` (${check.skill})` : "";
        return `${abilityLabel}${skillPart} DC ${check.dc ?? "?"}`;
    
    }

    _getCampScanDataForActivityStationDialog() {
        const app = this._app;

        if (app._phase !== "activity") return null;
        const restType = app._engine?.restType
            ?? app._selectedRestType
            ?? app._restData?.restType
            ?? "long";
        if (restType === "short") return null;
        const terrainTagCamp = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
        const terrainCamp = TerrainRegistry.get(terrainTagCamp);
        const shelterKey = (app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none");
        const shelterSpellCamp = shelterKey
            ? (SHELTER_SPELLS[shelterKey]?.label ?? null)
            : null;
        // Local preview (player or GM hovering a tier) overrides the committed level so the
        // comfort header moves before Set/Request, matching the TotM Make Camp picker.
        const previewLevel = ["embers", "campfire", "bonfire"].includes(app._stationFirePreviewLevel)
            ? app._stationFirePreviewLevel
            : null;
        const effectiveScanLevel = previewLevel ?? app._fireLevel ?? "unlit";
        const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
        const baseTerrainComfort = app._engine?.comfort
            ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
            ?? "rough";
        return CampGearScanner.scan(
            baseTerrainComfort,
            effectiveScanLevel,
            shelterSpellCamp,
            terrainCamp?.comfortReason ?? "",
            terrainCamp?.label ?? terrainTagCamp,
            encMod,
            !!app._engine?.safeRestSpot
        ) ?? null;
    
    }

    _findIncompleteTrainingCharacterId() {
        const app = this._app;

        const seen = new Set();
        const candidates = [];

        for (const charId of app._trainingStates?.keys() ?? []) {
            if (seen.has(charId)) continue;
            seen.add(charId);
            if (app._earlyResults?.has(charId)) continue;
            if (app._characterChoices?.get(charId) !== "act_train") continue;
            candidates.push(charId);
        }
        for (const charId of app._lockedCharacters ?? []) {
            if (seen.has(charId)) continue;
            if (app._characterChoices?.get(charId) !== "act_train") continue;
            if (app._earlyResults?.has(charId)) continue;
            candidates.push(charId);
        }

        if (!candidates.length) return null;

        if (!app._isGM) {
            return candidates.find(id => game.actors.get(id)?.isOwner) ?? null;
        }
        if (app._selectedCharacterId && candidates.includes(app._selectedCharacterId)) {
            return app._selectedCharacterId;
        }
        return candidates[0];
    
    }

    _initTrainingState(characterId, activityId, actor) {
        const app = this._app;

        const activity = app._activityResolver?.activities?.get(activityId)
            ?? app._activities?.find(a => a.id === activityId);
        if (!activity || !actor) return;

        const comfort = app._engine?.comfort ?? "rough";
        const safeRestSpot = !!app._engine?.safeRestSpot;
        const context = app._activityResolver.getTrainingContext(activity, actor, comfort, safeRestSpot);

        app._trainingStates = app._trainingStates ?? new Map();
        const state = {
            activityId,
            context,
            rolls: [],
            rolling: false
        };
        app._trainingStates.set(characterId, state);

        if (!game.user.isGM) {
            emitTrainingStateUpdate(characterId, state);
        } else {
            void app._saveRestState();
        }
    
    }

    async onCampLightFire(event, target) {
        const app = this._app;

        if (app._campPitBlocksFireLighting()) {
            ui.notifications.warn("Place the campfire on the map before lighting.");
            return;
        }
        const root = target?.closest?.("[data-action=\"campLightFire\"]") ?? target;
        let actorId = root?.dataset?.actorId;
        const method = root?.dataset?.method ?? "Tinderbox";
        // GM override: no party member had a tinderbox/cantrip, use first party actor
        if (actorId === "__gm__" && game.user.isGM) {
            const partyActors = getPartyActors();
            actorId = partyActors[0]?.id ?? null;
        }
        if (!actorId) return;
        // The selected tier (or default embers) is committed at light time so the picker
        // is the ceremony: no need to re-engage to set the level afterward.
        const chosenLevel = ["embers", "campfire", "bonfire"].includes(app._campFirePreviewLevel)
            ? app._campFirePreviewLevel
            : "embers";
        if (!game.user.isGM) {
            emitCampLightFire(game.user.id, actorId, method, chosenLevel);
            return;
        }
        await app._campCeremony.lightFire(game.user.id, actorId, method, chosenLevel);
    
    }

    async _spendPartyFirewoodForMakeCamp(cost, requestingUserId = null) {
        const app = this._app;

        const spendNames = [];
        if (cost <= 0) return { ok: true, spendNames };

        const actors = getPartyActors();
        const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        const sortedActors = requestingUserId
            ? [...actors].sort((a, b) => {
                const aOwn = (a.ownership?.[requestingUserId] ?? 0) >= OWNER ? 1 : 0;
                const bOwn = (b.ownership?.[requestingUserId] ?? 0) >= OWNER ? 1 : 0;
                return bOwn - aOwn;
            })
            : actors;

        let remaining = cost;
        while (remaining > 0) {
            let spentOne = false;
            for (const actor of sortedActors) {
                const firewoodItem = actor.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                if (!firewoodItem || (firewoodItem.system?.quantity ?? 0) <= 0) continue;
                const qty = firewoodItem.system?.quantity ?? 1;
                if (qty <= 1) await firewoodItem.delete();
                else await firewoodItem.update({ "system.quantity": qty - 1 });
                spendNames.push(actor.name);
                remaining--;
                spentOne = true;
                break;
            }
            if (!spentOne) {
                return { ok: false, spendNames, error: "Could not spend firewood (inventory changed)." };
            }
        }
        return { ok: true, spendNames };
    
    }

    async _applyTrainingXP(outcomes) {
        const app = this._app;

        if (!Array.isArray(outcomes) || !outcomes.length) return;

        for (const outcome of outcomes) {
            const award = (outcome.outcomes ?? [])
                .filter(sub => sub.source === "activity")
                .flatMap(sub => sub.effects ?? [])
                .filter(eff => eff.type === "training_xp")
                .reduce((sum, eff) => sum + (eff.value ?? 0), 0);
            if (award <= 0) continue;

            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;

            const current = actor.system?.details?.xp?.value ?? 0;
            try {
                await actor.update({ "system.details.xp.value": current + award });
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to apply ${award} training XP to ${actor.name}:`, e);
            }
        }
    
    }


}
