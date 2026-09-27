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
import { bindSustenanceMeters } from "../../meal/SustenanceMeterBinding.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import { closeStationDialogIfDifferentActor } from "../../../camp/StationActivityDialog.js";
import {
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
        app.element?.classList.toggle("hide-terrain-banners", !!context?.hideTerrainBanner);

        let currentTheme = "glass";
        try {
            currentTheme = game.settings.get(MODULE_ID, "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        app.element?.classList.toggle("theme-ionrift-glass", currentTheme === "glass");
        app.element?.classList.toggle("theme-respite-cockpit", currentTheme === "cockpit");

        if (game.user.isGM && app._phase === "activity" && app._isTavernTerrain()) {
            if (app._applyAutoOtherWhenSoleActivity()) {
                void app._saveRestState();
            }
        }

        const showTotmCampfirePanelEarly = app._shouldShowTotmCampfirePanel();
        app._bindRestWindowUserMoveTracking();
        if ((app._isTotM && (app._phase === "camp" || ((app._phase === "activity" || app._phase === "meal") && showTotmCampfirePanelEarly)))
            || (app._phase === "camp" && app._showFullMakeCampPanel())) {
            app._bindRestWindowResizeObserver();
        } else {
            app._disposeRestWindowResizeObserver();
        }
        app._scheduleRestWindowRecenter();

        // Bind meal drag-drop when in meal phase or previewing sustenance via stepper
        if (app._phase === "meal" || (app._phase === "activity" && app._selectedWorkflowStep === "sustenance")) {
            app._bindMealDragDrop(app.element);
            bindSustenanceMeters(app, app.element);
        }

        // TotM Activity: bind workbench drag-drop when Identify tab or detail panel is active
        if (app._phase === "activity" && app._isTotM && (app._selectedWorkflowStep === "examine" || app._totmActiveTab === "identify" || app._totmFollowUpExpanded?.isIdentify || app._totmFollowUpExpanded?.activityId === "act_identify" || app._totmFollowUpExpanded?.activityId === "identify") && isWorkbenchIdentifyUiEnabled()) {
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
        if (showTotmCampfirePanel || app._shouldMountFireRailEmbed?.()) {
            app._mountCampfireEmbed("activity");
        } else if (showCampCeremony) {
            app._mountCampfireEmbed("camp");
            app._syncCampCeremonyPreviewToEmbed();
        } else if (!stationHostsEmbed) {
            app._tearDownCampfireEmbed("onRenderBindings:noPanel");
        }

        // Bind camp drag handlers (campfire placement, gear handles) in camp, activity, and meal
        if (app._phase === "camp" || app._phase === "activity" || app._phase === "meal") {
            app._bindCampDragHandlers(app.element);
        }

        // Camp: inline Make Camp panel, draggable campfire card, optional minigame embed
        if (app._phase === "camp") {
            if (!app._campCeremonyMinigameEnabled() && !stationHostsEmbed) {
                app._tearDownCampfireEmbed("onRenderBindings:campCeremonyDisabled");
            }
            if (app.element) {
                app.element.classList.toggle("totm-camp-active", app._showFullMakeCampPanel());
            }
            if (!app._isTotM && app._isGM) {
                app._healOrphanCampfirePlacementState();
            }
            if (app._showFullMakeCampPanel() && !app._campToActivityDone && !app._campPitCursorInFlight
                && isStationLayerActive()) {
                void app._refreshCampPitNoticeLayer();
            } else if (app._usesStationsMinimalCampShell() && app._isGM && !hasCampfirePlaced()
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
            const isGritty = (app._restVariant ?? "normal") === "gritty";
            const hints = isGritty ? {
                long: "7 days of downtime rest (safe rest or wilderness). Recovers all spell slots and Hit Dice.",
                short: "8 hrs overnight bivouac in the wild. Recovers short-rest class features, spend Hit Dice to heal, camp stance and campfire fuel."
            } : {
                long: "8 hrs. HP and Hit Dice recovery varies by comfort and conditions.",
                short: "1 hr. Spend Hit Dice to heal. Continue to pick a shelter."
            };
            const _applyRestType = (value, rerender) => {
                const isShort = value === "short";
                const hideEnvAndWx = isShort && !isGritty;
                restTypeInput.value = value;
                app._selectedRestType = value;
                restTypeButtons.forEach(btn => {
                    btn.classList.toggle("active", btn.dataset.restType === value);
                });
                if (restTypeHint) restTypeHint.textContent = hints[value] ?? "";
                const envBlock = app.element.querySelector(".scene-environment");
                if (envBlock) envBlock.style.display = hideEnvAndWx ? "none" : "";
                const wxBlock = app.element.querySelector(".scene-weather");
                if (wxBlock) wxBlock.style.display = hideEnvAndWx ? "none" : "";
                const advBlock = app.element.querySelector(".scene-advanced-drawer");
                if (advBlock) advBlock.style.display = hideEnvAndWx ? "none" : "";
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
                if (app._isGrittyLong) {
                    app.render();
                    return;
                }
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

                // Block non-crafting selection if character is locked or has completed crafting
                if (app._lockedCharacters?.has(characterId) || app.hasCompletedCrafting?.(characterId)) return;

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

                // Block if crafting picker is open for this character or character is locked
                if (app._craftingInProgress?.has(characterId)
                    || app._lockedCharacters?.has(characterId)
                    || app.hasCompletedCrafting?.(characterId)) return;

                const activity = app._activities?.find(a => a.id === activityId);
                if (activity?.crafting?.enabled) {
                    const syntheticTarget = { dataset: { characterId, profession: activity.crafting.profession } };
                    this._app._stations.onOpenCrafting(null, syntheticTarget);
                    app._pendingSelections.delete(characterId);
                    return;
                }

                const followUpValue = app._gmFollowUps?.get(characterId) ?? app._getFollowUpForCharacter(characterId);
                await app.finalizeActivityChoiceFromStation(characterId, activityId, null, { followUpValue });
            });
        }

        // Roster chip click: switch selected character
        const rosterChips = app.element.querySelectorAll("[data-roster-id]");
        for (const chip of rosterChips) {
            chip.addEventListener("click", () => {
                if (chip.classList.contains("not-owned") || chip.classList.contains("is-locked")) return;
                const charId = chip.dataset.rosterId;
                if (!charId || charId === app._selectedCharacterId) return;
                if (!app._isGM) {
                    const actor = game.actors.get(charId);
                    if (!actor?.isOwner) return;
                }
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
