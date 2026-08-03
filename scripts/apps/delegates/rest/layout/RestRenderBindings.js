import { CopySpellHandler } from "../../../../services/crafting/outcomes/CopySpellHandler.js";
import { logCampfireReconnect } from "../../../../services/camp/fire/CampfireReconnectLog.js";
import {
    hasCampfirePlaced,
    placeStationPlaceholders
} from "../../../../services/camp/props/CompoundCampPlacer.js";
import {
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationPortraitsFromChoices
} from "../../../../services/camp/props/StationInteractionLayer.js";
import { isSimpleStationsMode } from "../../../../services/rest/flow/RestProfileSettings.js";
import { isWorkbenchIdentifyUiEnabled } from "../../../../data/RestConstants.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import { closeStationDialogIfDifferentActor } from "../../../camp/StationActivityDialog.js";
import {
    emitTravelDeclaration,
    emitCopySpellProposal,
    emitActivityChoice
} from "../../../../services/socket/SocketController.js";
import { MODULE_ID } from "../../../../data/moduleId.js";

export class RestRenderBindings {
    constructor(app) {
        this._app = app;
    }

    _onRenderBindings(context, options) {
        const app = this._app;

        if (game.user.isGM && app._phase === "activity" && app._isTavernTerrain()) {
            if (app._applyAutoOtherWhenSoleActivity()) {
                void app._saveRestState();
            }
        }

        const showTotmCampfirePanelEarly = app._shouldShowTotmCampfirePanel();
        app._bindRestWindowUserMoveTracking();
        if ((app._isTotM && (app._phase === "camp" || (app._phase === "activity" && showTotmCampfirePanelEarly)))
            || (app._phase === "camp" && app._showFullMakeCampPanel())) {
            app._bindRestWindowResizeObserver();
        } else {
            app._disposeRestWindowResizeObserver();
        }
        app._scheduleRestWindowRecenter();

        // Bind meal drag-drop when in meal phase
        if (app._phase === "meal") {
            app._bindMealDragDrop(app.element);
        }

        // TotM Activity: bind workbench drag-drop when Identify tab is active
        if (app._phase === "activity" && app._isTotM && app._totmActiveTab === "identify" && isWorkbenchIdentifyUiEnabled()) {
            app._workbench.bindDragDrop(app.element);
        }

        // TotM Activity: campfire minigame in the permanent right-hand panel
        const showTotmCampfirePanel = app._shouldShowTotmCampfirePanel();
        if (app._phase === "activity" && app._isTotM) {
            logCampfireReconnect("onRenderBindings:activityCampfire", {
                showTotmCampfirePanel,
                fireLevel: app._fireLevel ?? "unlit",
                hasCampfireApp: !!app._campfireApp,
                hostInDom: !!app.element?.querySelector(".totm-campfire-minigame-host"),
                ...app._campfireReconnectGateDetail()
            });
        }
        if (app.element) {
            app.element.classList.toggle("totm-activity-campfire-panel", showTotmCampfirePanel);
        }
        const showCampCeremony = app._phase === "camp" && app._campCeremonyMinigameEnabled();
        const stationHostsEmbed = app._campfireEmbedHost === "station";
        if (showTotmCampfirePanel) {
            app._mountCampfireEmbed("activity");
        } else if (showCampCeremony) {
            app._mountCampfireEmbed("camp");
            app._syncCampCeremonyPreviewToEmbed();
        } else if (!stationHostsEmbed) {
            app._tearDownCampfireEmbed("onRenderBindings:noPanel");
        }

        // Camp: inline Make Camp panel, draggable campfire card, optional minigame embed
        if (app._phase === "camp") {
            if (!app._campCeremonyMinigameEnabled() && !stationHostsEmbed) {
                app._tearDownCampfireEmbed("onRenderBindings:campCeremonyDisabled");
            }
            app._bindCampDragHandlers(app.element);
            if (app.element) {
                app.element.classList.toggle("totm-camp-active", app._showFullMakeCampPanel());
            }
            if (!app._isTotM && app._isGM) {
                app._healOrphanCampfirePlacementState();
            }
            if (app._usesStationsMinimalCampShell() && app._isGM && !hasCampfirePlaced()
                && !app._campPitCursorInFlight && !app._campPitPlacementCancelled) {
                void app._startCampPitCursorFlow();
            } else if (app._usesStationsMinimalCampShell() && hasCampfirePlaced() && !app._campToActivityDone && !isStationLayerActive()) {
                void app._refreshCampPitNoticeLayer();
            }
            if (!app._isTotM && app._isGM && hasCampfirePlaced() && !app._campPlaceholdersEnsured) {
                app._campPlaceholdersEnsured = true;
                void placeStationPlaceholders(!!app._engine?.safeRestSpot, {
                    simpleStations: isSimpleStationsMode()
                });
            }
            const picker = app.element?.querySelector(".camp-fire-tier-picker");
            if (picker && !picker.dataset.ionriftPreviewBound) {
                picker.dataset.ionriftPreviewBound = "1";
                picker.addEventListener(
                    "pointerenter",
                    (e) => {
                        const row = e.target.closest?.("[data-fire-preview]");
                        if (!row || (app._fireLevel ?? "unlit") !== "unlit") return;
                        const lev = row.dataset.firePreview;
                        if (!lev || app._campFirePreviewLevel === lev) return;
                        app._campFirePreviewLevel = lev;
                        app.render({ force: true });
                    },
                    true
                );
                picker.addEventListener("pointerleave", (e) => {
                    if (!picker.contains(e.relatedTarget)) {
                        if (app._campFirePreviewLevel !== null && app._campFirePreviewLevel !== undefined) {
                            app._campFirePreviewLevel = null;
                            if ((app._fireLevel ?? "unlit") === "unlit") {
                                app.render({ force: true });
                            }
                        }
                    }
                });
            }
            CampfireMakeCampDialog.refreshIfOpen(this);
        } else {
            if (app.element) app.element.classList.remove("totm-camp-active");
        }

        // Bind travel activity selects (change event, not click)
        if (app._phase === "travel") {
            if (app._isGM) {
                app.element?.querySelectorAll(".travel-activity-select")?.forEach(sel => {
                    sel.addEventListener("change", () => {
                        const actorId = sel.dataset.actorId;
                        const day = parseInt(sel.dataset.day) || app._travel.activeDay;
                        app._travel.setDeclaration(actorId, sel.value, day);
                        app._broadcastTravelDeclarations();
                        app._saveRestState();
                        app.render();
                    });
                });
            } else {
                app.element?.querySelectorAll(".travel-player-select")?.forEach(sel => {
                    sel.addEventListener("change", () => {
                        const actorId = sel.dataset.actorId;
                        const day = parseInt(sel.dataset.day) || (app._travelActiveDay ?? 1);
                        if (!app._playerTravelDeclarations) app._playerTravelDeclarations = {};
                        if (!app._playerTravelDeclarations[day]) app._playerTravelDeclarations[day] = {};
                        app._playerTravelDeclarations[day][actorId] = sel.value;

                        emitTravelDeclaration({
                    declarations: { [actorId]: sel.value },
                    confirmed: false,
                    day,
                    userId: game.user.id
                });

                        if (app._playerTravelConfirmed?.[day]?.[actorId]) {
                            app._playerTravelConfirmed[day][actorId] = false;
                        }
                        app.render();
                    });
                });

                app.element?.querySelectorAll(".travel-confirm-btn")?.forEach(btn => {
                    btn.addEventListener("click", () => {
                        const actorId = btn.dataset.actorId;
                        const day = parseInt(btn.dataset.day) || (app._travelActiveDay ?? 1);

                        if (!app._playerTravelConfirmed) app._playerTravelConfirmed = {};
                        if (!app._playerTravelConfirmed[day]) app._playerTravelConfirmed[day] = {};
                        app._playerTravelConfirmed[day][actorId] = true;

                        const activity = app._playerTravelDeclarations?.[day]?.[actorId] ?? "nothing";
                        emitTravelDeclaration({
                    declarations: { [actorId]: activity },
                    confirmed: true,
                    day,
                    userId: game.user.id
                });
                        app.render();
                    });
                });
            }
        }

        if (app._phase === "activity" && app._isTotM) {
            // Campfire embed mounts via showTotmCampfirePanel block above.
        } else if (app._phase === "meal" || app._phase === "activity") {
            const drawerContainer = app.element?.querySelector(".campfire-drawer-content");
            if (drawerContainer) {
                app._openCampfire();
                const drawer = app.element?.querySelector(".campfire-drawer");
                if (drawer && !app._campfireCollapsed) {
                    drawer.style.transition = "none";
                    drawer.classList.add("open");
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            drawer.style.transition = "";
                        });
                    });
                }
            }
        }

        // GM follow-up input binding (Tier 2 activity pickers)
        const gmFollowUpPanel = app.element.querySelector(".gm-followup");
        if (gmFollowUpPanel) {
            const charId = gmFollowUpPanel.dataset.characterId;
            const inputs = gmFollowUpPanel.querySelectorAll(".gm-followup-input");
            for (const input of inputs) {
                input.addEventListener("change", () => {
                    if (input.type === "radio") {
                        if (input.checked) app._gmFollowUps.set(charId, input.value);
                    } else {
                        app._gmFollowUps.set(charId, input.value);
                    }
                });
            }
            // Auto-set default for first render if no value exists
            if (!app._gmFollowUps.has(charId)) {
                const firstSelect = gmFollowUpPanel.querySelector("select");
                const checkedRadio = gmFollowUpPanel.querySelector("input[type=radio]:checked");
                if (firstSelect?.value) app._gmFollowUps.set(charId, firstSelect.value);
                else if (checkedRadio?.value) app._gmFollowUps.set(charId, checkedRadio.value);
            }
        }

        // Persist Advanced drawer open state across setup re-renders (day stepper, rest type, etc.)
        const advancedDrawer = app.element.querySelector(".scene-advanced-drawer");
        if (advancedDrawer) {
            advancedDrawer.addEventListener("toggle", () => {
                app._setupAdvancedOpen = advancedDrawer.open;
            });
        }

        // Rest type toggle buttons: update hidden input on click
        const restTypeButtons = app.element.querySelectorAll('.rest-type-btn');
        const restTypeInput = app.element.querySelector('[name="restType"]');
        const restTypeHint = app.element.querySelector('.rest-type-hint');
        if (restTypeButtons.length && restTypeInput) {
            const hints = {
                long: "8 hrs. HP and Hit Dice recovery varies by comfort and conditions.",
                short: "1 hr. Spend Hit Dice to heal. Continue to pick a shelter."
            };
            const _applyRestType = (value, rerender) => {
                const isShort = value === "short";
                restTypeInput.value = value;
                app._selectedRestType = value;
                restTypeButtons.forEach(btn => {
                    btn.classList.toggle("active", btn.dataset.restType === value);
                });
                if (restTypeHint) restTypeHint.textContent = hints[value] ?? "";
                const daysBlock = app.element.querySelector(".days-since-rest-block");
                if (daysBlock) daysBlock.style.display = isShort ? "none" : "";
                const envBlock = app.element.querySelector(".scene-environment");
                if (envBlock) envBlock.style.display = isShort ? "none" : "";
                const wxBlock = app.element.querySelector(".scene-weather");
                if (wxBlock) wxBlock.style.display = isShort ? "none" : "";
                const advBlock = app.element.querySelector(".scene-advanced-drawer");
                if (advBlock) advBlock.style.display = isShort ? "none" : "";
                if (rerender) app.render();
            };
            restTypeButtons.forEach(btn => {
                btn.addEventListener("click", () => _applyRestType(btn.dataset.restType, true));
            });
            _applyRestType(restTypeInput.value ?? "long", false);
        }

        // Comfort hint: update on dropdown change
        const comfortSelect = app.element.querySelector('[name="comfort"]');
        const comfortHint = app.element.querySelector('.comfort-hint');
        if (comfortSelect && comfortHint) {
            comfortSelect.addEventListener("change", () => {
                const selected = comfortSelect.options[comfortSelect.selectedIndex];
                comfortHint.textContent = selected?.title ?? "";
            });
        }

        const safeRestSpotCb = app.element.querySelector('input[name="safeRestSpot"]');
        if (safeRestSpotCb && game.user.isGM) {
            safeRestSpotCb.addEventListener("change", async () => {
                if (safeRestSpotCb.disabled) return;
                try {
                    await game.settings.set(MODULE_ID, "safeRestSpot", !!safeRestSpotCb.checked);
                } catch (e) {

                    console.warn(`${MODULE_ID} | safeRestSpot setting`, e);
                }
                app.render();
            });
        }

        if (app._safeRestPulseAlert && game.user.isGM) {
            window.setTimeout(() => {
                app.element?.querySelector(".safe-rest-spot-toggle")?.classList.remove("is-pulse");
                app._safeRestPulseAlert = false;
            }, 600);
        }

        // Rest interface override: writes the world setting so players and the
        // scattered mode checks stay on the same source of truth.
        const restModeSelect = app.element.querySelector('[name="restInterfaceMode"]');
        if (restModeSelect && game.user.isGM) {
            restModeSelect.addEventListener("change", async () => {
                try {
                    await game.settings.set(MODULE_ID, "restInterfaceMode", restModeSelect.value);
                } catch (e) {

                    console.warn(`${MODULE_ID} | restInterfaceMode setting`, e);
                }
                app.render();
            });
        }

        // Terrain change: update weather dropdown options
        const terrainSelect = app.element.querySelector('[name="terrain"]');
        if (terrainSelect) {
            terrainSelect.addEventListener("change", () => {
                const prevTerrain = app._selectedTerrain ?? terrainSelect.value;
                const nextTerrain = terrainSelect.value;
                if (prevTerrain === nextTerrain) return;
                void app._onSetupTerrainChanged(prevTerrain, nextTerrain);
            });
        }

        // Weather change: re-render to update status line
        const weatherSelect = app.element.querySelector('[name="weather"]');
        if (weatherSelect) {
            weatherSelect.addEventListener("change", () => {
                app._selectedWeather = app._resolveSetupWeather(
                    app._selectedTerrain ?? "forest",
                    weatherSelect.value
                );
                game.settings.set(MODULE_ID, "lastWeather", app._selectedWeather);
                app.render();
            });
        }

        // (Sub-tab and meal auto-consume bindings removed: activity phase uses unified progress panel)

        // Bind identify item buttons
        for (const btn of app.element.querySelectorAll("[data-action='identifyItem']")) {
            btn.addEventListener("click", async (e) => {
                const { itemId, actorId } = e.currentTarget.dataset;
                if (!itemId || !actorId) return;
                await app.identifyItemFromWorkbenchStation(actorId, itemId);
            });
        }

        // Bind click events on activity tiles
        const tiles = app.element.querySelectorAll(".activity-card");
        for (const tile of tiles) {
            tile.addEventListener("click", () => {
                // Activity phase uses station columns; legacy grids used .activity-grid only.
                const host =
                    tile.closest(".activity-grid")
                    || tile.closest(".station-activities")
                    || tile.closest(".character-detail");
                const characterId = host?.dataset?.characterId;
                const activityId = tile.dataset.activityId;
                if (!characterId || !activityId) return;

                // Block if crafting picker is open for this character
                if (app._craftingInProgress?.has(characterId)) return;

                // Crafting tiles: open the crafting drawer directly
                if (tile.dataset.isCrafting === "true") {
                    const syntheticTarget = { dataset: { characterId, profession: tile.dataset.profession } };
                    this._app._stations.onOpenCrafting(null, syntheticTarget);
                    return;
                }

                // Non-crafting tiles: open the detail preview panel
                app._activityDetailId = activityId;
                app.render();
            });
        }

        // Bind confirm buttons (player only)
        const confirmBtns = app.element.querySelectorAll(".btn-confirm-activity");
        for (const btn of confirmBtns) {
            btn.addEventListener("click", async () => {
                const characterId = btn.dataset.characterId;
                const activityId = app._pendingSelections?.get(characterId);
                if (!characterId || !activityId) return;

                // Block if crafting picker is open for this character
                if (app._craftingInProgress?.has(characterId)) return;

                const activity = app._activities?.find(a => a.id === activityId);
                if (activity?.crafting?.enabled) {
                    const syntheticTarget = { dataset: { characterId, profession: activity.crafting.profession } };
                    this._app._stations.onOpenCrafting(null, syntheticTarget);
                    app._pendingSelections.delete(characterId);
                    return;
                }

                // Lock and submit
                app._characterChoices.set(characterId, activityId);
                app._lockedCharacters.add(characterId);
                app._pendingSelections.delete(characterId);

                // Early resolve: roll the activity now so the player sees results immediately
                const actor = game.actors.get(characterId);

                // Copy Spell: send proposal via socket instead of resolving immediately
                // This runs outside the _engine guard because players don't have the engine
                if (activityId === "act_scribe" && actor) {
                    const followUpValue = app._gmFollowUps?.get(characterId) ?? app._getFollowUpForCharacter(characterId);
                    const spellLevel = parseInt(followUpValue, 10) || 1;
                    const cost = spellLevel * 50;
                    const dc = 10 + spellLevel;

                    if (game.user.isGM) {
                        // GM initiated: send proposal to player for gold approval
                        CopySpellHandler.sendProposal(characterId, spellLevel);
                    } else {
                        // Player initiated: notify GM
                        emitCopySpellProposal({
                    actorId: characterId,
                    actorName: actor.name,
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });
                    }

                    app._earlyResults.set(characterId, {
                        source: "activity",
                        activityId,
                        result: "pending_approval",
                        narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
                    });
                    app.render();
                } else if (activityId === "act_train" && actor && app._engine) {
                    app._initTrainingState(characterId, activityId, actor);
                    ui.notifications.info(`${actor.name}: Training started. Roll your sets in the rest window.`);
                    app.render();
                } else if (actor && app._engine) {
                    const followUpValue = app._gmFollowUps?.get(characterId) ?? app._getFollowUpForCharacter(characterId);
                    app._activityResolver.resolve(
                        activityId, actor, app._engine.terrainTag, app._engine.comfort, {
                            followUpValue,
                            safeRestSpot: !!app._engine.safeRestSpot
                        }
                    ).then(result => {
                        app._earlyResults.set(characterId, result);
                        const tier = result.result === "exceptional" ? "Exceptional!"
                            : result.result === "success" ? "Success"
                            : result.result === "failure_complication" ? "Failed (complication)"
                            : result.result === "failure" ? "Failed" : result.result;
                        const actName = activity?.name ?? activityId;
                        ui.notifications.info(`${actor.name}: ${actName} - ${tier}`);
                        app.render();
                    });
                }

                // Optimistic UI update
                let mySub = app._playerSubmissions.get(game.user.id) || { choices: {}, userName: game.user.name, timestamp: Date.now() };
                mySub.choices[characterId] = activityId;
                app._playerSubmissions.set(game.user.id, mySub);

                emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(app._characterChoices),
                    null,
                    null,
                    app._earlyResults?.size ? Object.fromEntries(app._earlyResults) : null
                );

                const actName = activity?.name ?? activityId;
                ui.notifications.info(`${game.actors.get(characterId)?.name ?? "Character"} will ${actName}.`);
                if (app._phase === "activity" && isStationLayerActive()) {
                    refreshStationEmptyNoticeFade(this);
                    refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
                    app._refreshStationOverlayMeals();
                }
                app.render();
            });
        }

        // Roster chip click: switch selected character
        const rosterChips = app.element.querySelectorAll("[data-roster-id]");
        for (const chip of rosterChips) {
            chip.addEventListener("click", () => {
                if (chip.classList.contains("not-owned")) return;
                const charId = chip.dataset.rosterId;
                if (!charId || charId === app._selectedCharacterId) return;
                app._selectedCharacterId = charId;
                closeStationDialogIfDifferentActor(charId);
                app._canvasFocusedStationId = null;
                app._activityDetailId = null;
                app._craftingDrawerOpen = false;
                // Collapse any expanded TotM detail/crafting panel on character switch
                app._totmFollowUpExpanded = null;
                app._resetTotmCraftState();
                if (isStationLayerActive()) {
                    if (!app._isGM) app._refreshStationOverlayForFocusChange();
                    else {
                        refreshStationEmptyNoticeFade(this);
                        app._refreshStationOverlayMeals();
                    }
                }
                app.render();
            });
        }

        // AFK checkboxes (both GM and player)
        app._bindArmorToggleHandlers(app.element);

    
    }
}
