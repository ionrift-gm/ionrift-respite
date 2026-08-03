import { CampGearScanner } from "../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import {
    placeCampfire,
    placeStation,
    placePlayerGear,
    clearCampTokens,
    relocateCampfireSite,
    clearPlayerCampGear,
    clearPlayerCampGearType,
    clearSharedCampStation,
    hasCampfirePlaced,
    canPlaceStation,
    validatePlayerGearDrop,
    validateStationEquipmentDrop,
    resetCampSession,
    placeStationPlaceholders,
    pickCampfirePitBaseTexture,
    getStationPlaceholderPreviewsForPitCenter
} from "../../../services/camp/props/CompoundCampPlacer.js";
import { closeOpenStationDialog, refreshOpenStationDialog } from "../../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../../camp/CampfireMakeCampDialog.js";
import { isComfortEnabled } from "../../../services/camp/gear/ComfortCalculator.js";
import { isSimpleStationsMode, requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import {
    emitPhaseChanged,
    emitActivityFireLevelRequest,
    emitCampFireLevelRequest,
    emitActivityColdCampRequest,
    emitCampColdCampRequest,
    emitCampColdCampCommit,
    emitCampGearPlace, emitCampGearPlaced, emitCampGearClearPlayer,
    emitCampGearReclaim, emitCampStationPlace, emitCampStationPlaced,
    emitCampStationReclaim, emitCampSceneCleared
} from "../../../services/socket/SocketController.js";
import {
    activateStationLayer,
    deactivateStationLayer
} from "../../../services/camp/props/StationInteractionLayer.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../data/moduleId.js";

export class CampPlacementDelegate {
    constructor(app) {
        this._app = app;
    }

    _cancelCampPlacementCanvasMode() {
        const app = this._app;

        if (typeof app._campPitPickerCancel === "function") {
            try {
                app._campPitPickerCancel();
            } catch (err) {
                console.warn(`${MODULE_ID} | cancel camp pit picker`, err);
            }
        }
        app._campPitPickerCancel = null;
        app._campPitCursorInFlight = false;
        const board = document.getElementById("board");
        if (board) {
            board.removeEventListener("drop", app._boundCampCanvasDrop);
            board.removeEventListener("dragover", app._boundCampCanvasDragOver);
            board.style.cursor = "";
        }
    
    }

    _campPlacementStillActive() {
        const app = this._app;

        if (app._phase !== "camp" || app._terminated) return false;
        // The live rest app is tracked module-side and exposed via getActiveApp().
        // Treat a missing global ref as still-active when app instance is mounted,
        // covering the registration gap the socket self-heal also guards against.
        const activeApp = game.ionrift?.respite?.getActiveApp?.() ?? null;
        return activeApp === app || activeApp === null || app.rendered;
    
    }

    _pickPitWorldPoint(options = {}) {
        const app = this._app;

        this._cancelCampPlacementCanvasMode();
        return new Promise((resolve) => {
            if (!canvas?.ready) {
                resolve(null);
                return;
            }
            const pitBaseTextureSrc = options.pitBaseTextureSrc ?? "";
            const safeRestSpot = !!options.safeRestSpot;
            const canvasEl = document.getElementById("board");
            const originalCursor = canvasEl?.style.cursor;
            if (canvasEl) canvasEl.style.cursor = "crosshair";
            ui.notifications.info("Click the map to place the campfire pit. Right-click or Escape to cancel.");

            const gs = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
            const snapMode = CONST.GRID_SNAPPING_MODES?.CENTER ?? 1;
            const parent = canvas.tokens?.addChild ? canvas.tokens : (canvas.primary ?? canvas.stage);
            const sortPrev = parent.sortableChildren;
            if (parent.sortableChildren !== undefined) parent.sortableChildren = true;

            const container = new PIXI.Container();
            container.name = "ionrift-camp-pit-preview";
            if ("eventMode" in container) container.eventMode = "none";
            container.zIndex = 2_000_000;
            parent.addChild(container);

            const phRoot = new PIXI.Container();
            if ("eventMode" in phRoot) phRoot.eventMode = "none";
            phRoot.name = "ionrift-camp-stub-previews";
            container.addChild(phRoot);
            const phSprites = [];
            const simpleStations = isSimpleStationsMode();
            const maxStub = simpleStations ? 2 : (safeRestSpot ? 3 : 4);

            const updateStubGhosts = (pitCX, pitCY) => {
                if (!container.parent) return;
                const slots = getStationPlaceholderPreviewsForPitCenter(pitCX, pitCY, safeRestSpot, {
                    simpleStations
                });
                for (let i = 0; i < maxStub; i++) {
                    if (i >= slots.length) {
                        if (phSprites[i]) phSprites[i].visible = false;
                        continue;
                    }
                    const slot = slots[i];
                    if (!phSprites[i]) {
                        const s = PIXI.Sprite.from(slot.textureSrc);
                        s.anchor.set(0.5, 0.5);
                        if ("eventMode" in s) s.eventMode = "none";
                        phRoot.addChild(s);
                        phSprites[i] = s;
                    }
                    const s = phSprites[i];
                    s.visible = true;
                    s.alpha = slot.valid ? 0.4 : 0.2;
                    const wPx = slot.gridW * gs;
                    const hPx = slot.gridH * gs;
                    s.x = slot.tx + wPx / 2;
                    s.y = slot.ty + hPx / 2;
                    const tw = s.texture?.width || 1;
                    const th = s.texture?.height || 1;
                    const sc = Math.min(wPx / tw, hPx / th) * 0.9;
                    s.scale.set(sc);
                }
            };

            let spr = null;
            if (pitBaseTextureSrc) {
                spr = PIXI.Sprite.from(pitBaseTextureSrc);
                spr.anchor.set(0.5, 0.5);
                spr.alpha = 0.5;
                spr.visible = false;
                if ("eventMode" in spr) spr.eventMode = "none";
                container.addChild(spr);
                const applyScale = () => {
                    if (!spr?.texture?.valid) return;
                    const tw = spr.texture.width || 1;
                    const th = spr.texture.height || 1;
                    const sc = gs / Math.max(tw, th);
                    spr.scale.set(sc);
                };
                if (spr.texture?.valid) applyScale();
                else spr.texture?.on?.("update", applyScale);
            }

            const updateGhost = (wx, wy) => {
                if (!container.parent) return;
                const snapped = canvas.grid?.getSnappedPoint?.({ x: wx, y: wy }, { mode: snapMode });
                const cx = snapped?.x ?? wx;
                const cy = snapped?.y ?? wy;
                updateStubGhosts(cx, cy);
                if (spr) {
                    spr.x = cx;
                    spr.y = cy;
                    spr.visible = true;
                }
            };

            const onPointerMove = (event) => {
                const pos = event.data?.getLocalPosition?.(canvas.stage);
                if (pos) updateGhost(pos.x, pos.y);
            };

            let settled = false;
            const cleanup = (result) => {
                if (settled) return;
                settled = true;
                if (app._campPitPickerCancel === cleanup) {
                    app._campPitPickerCancel = null;
                }
                canvas.stage?.off("pointermove", onPointerMove);
                canvas.stage?.off("pointerdown", onPointerDown);
                document.removeEventListener("keydown", onKeyDown);
                document.removeEventListener("contextmenu", onRightClick);
                if (canvasEl) canvasEl.style.cursor = originalCursor ?? "";
                if (parent?.sortableChildren !== undefined) parent.sortableChildren = sortPrev;
                if (container.parent) {
                    parent.removeChild(container);
                    container.destroy({ children: true });
                }
                resolve(result);
            };
            app._campPitPickerCancel = cleanup;

            const onPointerDown = (event) => {
                if (event.data?.button !== 0 && event.button !== 0) return;
                const pos = event.data?.getLocalPosition?.(canvas.stage)
                    ?? canvas.stage.toLocal(event.global ?? event);
                const snapped = canvas.grid?.getSnappedPoint?.({ x: pos.x, y: pos.y }, { mode: snapMode });
                const x = snapped?.x ?? pos.x;
                const y = snapped?.y ?? pos.y;
                cleanup({ x, y });
            };
            const onRightClick = (event) => {
                event.preventDefault();
                cleanup(null);
            };
            const onKeyDown = (event) => {
                if (event.key === "Escape") cleanup(null);
            };

            canvas.stage.on("pointermove", onPointerMove);
            canvas.stage.on("pointerdown", onPointerDown);
            document.addEventListener("keydown", onKeyDown);
            document.addEventListener("contextmenu", onRightClick);
        });
    
    }

    async _commitStationsCampPlacement(worldX, worldY, options = {}) {
        const app = this._app;

        if (!game.user.isGM || !this._campPlacementStillActive()) return false;
        const pitBaseTextureSrc = options.pitBaseTextureSrc ?? pickCampfirePitBaseTexture();
        const res = await placeCampfire(worldX, worldY, { pitBaseTextureSrc });
        if (!res) return false;
        app._campPitPlacementCancelled = false;
        await placeStationPlaceholders(!!app._engine?.safeRestSpot, {
            simpleStations: isSimpleStationsMode()
        });
        if (!isComfortEnabled()) {
            if (!app._isTotM) {
                await app._autoLightCampfireForComfortOffStations();
            }
            await app._saveRestState();
            emitPhaseChanged("camp", { campPitCursorDone: true });
            if (!app._campToActivityDone) {
                await app._advanceCampToActivity();
            }
            return true;
        }
        await CampfireTokenLinker.setLightState(false, "unlit");
        await app._saveRestState();
        emitPhaseChanged("camp", { campPitCursorDone: true });
        app.render({ force: true });
        await this._refreshCampPitNoticeLayer();
        return true;
    
    }

    async _startCampPitCursorFlow() {
        const app = this._app;

        if (!game.user.isGM || app._phase !== "camp" || app._campPitCursorInFlight) return;
        if (hasCampfirePlaced()) return;
        app._campPitCursorInFlight = true;
        try {
            const pitBaseTextureSrc = pickCampfirePitBaseTexture();
            const pos = await this._pickPitWorldPoint({
                pitBaseTextureSrc,
                safeRestSpot: !!app._engine?.safeRestSpot
            });
            if (!pos) {
                app._campPitPlacementCancelled = true;
                app.render({ force: true });
                return;
            }
            if (!this._campPlacementStillActive()) return;
            await this._commitStationsCampPlacement(pos.x, pos.y, { pitBaseTextureSrc });
        } catch (e) {
            console.error(`${MODULE_ID} | _startCampPitCursorFlow`, e);
        } finally {
            app._campPitCursorInFlight = false;
        }
    
    }

    async _refreshCampPitNoticeLayer() {
        const app = this._app;

        if (app._phase !== "camp" || !canvas?.ready) return;
        if (!hasCampfirePlaced()) return;
        if (app._campToActivityDone) return;
        if (!isComfortEnabled()) return;
        const fireCommitted = !!app._fireLitBy
            || (app._fireLevel ?? "unlit") !== "unlit"
            || !!app._coldCampDecided;
        const unlit = !fireCommitted;
        const partyActors = getPartyActors();
        const actorMap = {};
        for (const actor of partyActors) {
            const items = actor.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
            const hasBedroll = items.some(n => n.includes("bedroll"));
            const sceneToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            actorMap[actor.id] = { hasBedroll, assignedTokenId: sceneToken?.id ?? null };
        }
        activateStationLayer(
            actorMap,
            (stationId, token) => {
                if (stationId === "campfire" && token) {
                    void CampfireMakeCampDialog.open(app, token);
                }
            },
            { campPitModeOnly: true, campPitUnlit: unlit }
        );
    
    }

    _applyCampDragGhost(e, sourceEl) {
        const app = this._app;

        try {
            const ghost = document.createElement("div");
            ghost.className = "camp-drag-ghost-float";
            ghost.innerHTML = sourceEl.innerHTML;
            ghost.style.cssText = [
                "position:fixed",
                "left:-9999px",
                "top:0",
                "max-width:200px",
                "padding:6px 8px",
                "background:rgba(18,14,28,0.92)",
                "border:1px solid rgba(139,92,246,0.5)",
                "border-radius:8px",
                "box-shadow:0 8px 28px rgba(0,0,0,0.55)",
                "opacity:0.88",
                "pointer-events:none",
                "color:#e8e4f0",
                "font-size:0.72rem"
            ].join(";");
            document.body.appendChild(ghost);
            const w = ghost.offsetWidth || 120;
            const h = ghost.offsetHeight || 48;
            e.dataTransfer.setDragImage(ghost, Math.round(w / 2), Math.round(h / 2));
            requestAnimationFrame(() => ghost.remove());
        } catch {
            /* ignore */
        }
    
    }

    _bindCampDragHandlers(html) {
        const app = this._app;

        const campHandles = html.querySelectorAll('.camp-drag-handle[draggable="true"]');
        for (const campHandle of campHandles) {
            if (campHandle.dataset.campDragBound) continue;
            campHandle.dataset.campDragBound = "1";

            campHandle.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "ionrift-campfire-only" }));
                e.dataTransfer.effectAllowed = "copy";
                this._applyCampDragGhost(e, campHandle);
                campHandle.classList.add("dragging");

                const board = document.getElementById("board");
                if (board) {
                    board.addEventListener("drop", app._boundCampCanvasDrop, { once: true });
                    board.addEventListener("dragover", app._boundCampCanvasDragOver);
                }
            });
            campHandle.addEventListener("dragend", () => {
                campHandle.classList.remove("dragging");
                const board = document.getElementById("board");
                if (board) board.removeEventListener("dragover", app._boundCampCanvasDragOver);
                campHandle.dataset.suppressPlacementClick = "1";
                requestAnimationFrame(() => {
                    delete campHandle.dataset.suppressPlacementClick;
                });
            });

            if (campHandle.dataset.campPlacementClick) {
                campHandle.addEventListener("click", (e) => {
                    if (campHandle.dataset.suppressPlacementClick) return;
                    e.preventDefault();
                    e.stopPropagation();
                    app._campPitPlacementCancelled = false;
                    void this._startCampPitCursorFlow();
                });
            }
        }

        // Player gear drag handles (bedroll, tent, mess kit)
        // draggable is now on the outer .camp-gear-placeable-wrap; fall back to inner .gear-drag-handle for legacy
        const gearHandles = html.querySelectorAll('.camp-gear-placeable-wrap[draggable="true"], .gear-drag-handle[draggable="true"]:not(.camp-gear-placeable-wrap *)');
        for (const handle of gearHandles) {
            handle.addEventListener("dragstart", (e) => {
                const gearType = handle.dataset.gearType;
                const actorId = handle.dataset.actorId;
                e.dataTransfer.setData("text/plain", JSON.stringify({
                    type: "ionrift-player-gear",
                    gearType,
                    actorId
                }));
                e.dataTransfer.effectAllowed = "copy";
                this._applyCampDragGhost(e, handle);
                handle.classList.add("dragging");

                const board = document.getElementById("board");
                if (board) {
                    board.addEventListener("drop", app._boundCampCanvasDrop, { once: true });
                    board.addEventListener("dragover", app._boundCampCanvasDragOver);
                }
            });
            handle.addEventListener("dragend", () => {
                handle.classList.remove("dragging");
                const board = document.getElementById("board");
                if (board) board.removeEventListener("dragover", app._boundCampCanvasDragOver);
            });
        }

    
    }

    async _onCampCanvasDrop(event) {
        const app = this._app;

        event.preventDefault();
        const board = document.getElementById("board");
        if (board) board.removeEventListener("dragover", app._boundCampCanvasDragOver);
        if (!this._campPlacementStillActive()) return;

        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch { return; }

        const t = canvas.stage.worldTransform;
        const x = (event.clientX - t.tx) / canvas.stage.scale.x;
        const y = (event.clientY - t.ty) / canvas.stage.scale.y;

        if (data?.type === "ionrift-campfire-only" || data?.type === "ionrift-compound-camp") {
            if (!game.user.isGM) return;
            if (app._isTotM) {
                await placeCampfire(x, y, { pitBaseTextureSrc: pickCampfirePitBaseTexture() });
                if (app._phase === "camp") {
                    await CampfireTokenLinker.setLightState(false);
                    await app._saveRestState();
                    if (game.user.isGM) app._broadcastMakeCampPhaseSync();
                } else {
                    await CampfireTokenLinker.setLightState(false);
                }
                app.render();
                return;
            }
            if (app._phase !== "camp" || !isComfortEnabled()) return;
            if (hasCampfirePlaced()) {
                const moved = await relocateCampfireSite(x, y, {
                    safeRestSpot: !!app._engine?.safeRestSpot,
                    simpleStations: isSimpleStationsMode()
                });
                if (!moved) {
                    ui.notifications.warn("Could not move the campfire.");
                } else {
                    await app._saveRestState();
                    if (game.user.isGM) app._broadcastMakeCampPhaseSync();
                    void this._refreshCampPitNoticeLayer();
                }
            } else {
                await this._commitStationsCampPlacement(x, y, {
                    pitBaseTextureSrc: pickCampfirePitBaseTexture()
                });
            }
            app.render({ force: true });
            return;
        }

        if (data?.type === "ionrift-camp-station") {
            const { stationKey, actorId } = data;
            if (!stationKey) return;
            const preStation = validateStationEquipmentDrop(x, y, stationKey);
            if (!preStation.ok) {
                ui.notifications.warn(preStation.reason);
                return;
            }
            if (game.user.isGM) {
                const placed = await placeStation(x, y, stationKey);
                if (placed) {
                    emitCampStationPlaced();
                }
                app.render();
                app.refreshCanvasStationOverlaysIfActivity();
            } else {
                emitCampStationPlace({
                    stationKey,
                    actorId,
                    x,
                    y,
                    userId: game.user.id
                });
            }
            return;
        }

        if (data?.type === "ionrift-player-gear") {
            const { gearType, actorId } = data;
            const preGear = validatePlayerGearDrop(x, y, gearType);
            if (!preGear.ok) {
                ui.notifications.warn(preGear.reason);
                return;
            }
            if (game.user.isGM) {
                const placed = await placePlayerGear(x, y, gearType, actorId);
                app.render();
                app.refreshCanvasStationOverlaysIfActivity();
                if (placed) app.refreshOpenStationDialogAfterCampGear();
            } else {
                emitCampGearPlace({
                    actorId,
                    gearType,
                    x, y
                });
            }
            return;
        }
    
    }

    _healOrphanCampfirePlacementState() {
        const app = this._app;

        if (hasCampfirePlaced()) return;
        app._campPlaceholdersEnsured = false;
        if ((app._fireLevel ?? "unlit") !== "unlit" || app._fireLitBy || app._firewoodPledges?.size) {
            app._fireLevel = "unlit";
            app._fireLitBy = null;
            app._firewoodPledges = new Map();
            app._makeCampStagedWood = [];
            app._makeCampStagedWoodTier = null;
            app._campFireWoodSpendUserId = null;
            if (app._engine) {
                app._engine.fireLevel = "unlit";
                app._engine.fireRollModifier = 0;
            }
            void CampfireTokenLinker.setLightState(false);
        }
        resetCampSession();
    
    }

    async onRetryCampPitPlacement() {
        const app = this._app;

        app._campPitPlacementCancelled = false;
        await this._startCampPitCursorFlow();
    
    }

    async onReclaimCampfire(event, target) {
        const app = this._app;

        event.preventDefault?.();
        event.stopPropagation?.();
        if (!game.user.isGM || app._phase !== "camp") return;
        if (app._stationsComfortAutoAdvanceAfterFireLit() && (app._fireLevel ?? "unlit") !== "unlit") {
            return;
        }

        if (!hasCampfirePlaced()) {
            this._healOrphanCampfirePlacementState();
            ui.notifications.info("Campfire is not on the map. Click the map to place it again.");
            if (!app._isTotM) {
                app._campPitPlacementCancelled = false;
                await this._startCampPitCursorFlow();
            }
            app.render({ force: true });
            return;
        }

        const pitBaseTextureSrc = pickCampfirePitBaseTexture();
        const pos = await this._pickPitWorldPoint({
            pitBaseTextureSrc,
            safeRestSpot: !!app._engine?.safeRestSpot
        });
        if (!pos || !this._campPlacementStillActive()) return;

        const moved = await relocateCampfireSite(pos.x, pos.y, {
            safeRestSpot: !!app._engine?.safeRestSpot,
            simpleStations: isSimpleStationsMode()
        });
        if (!moved) {
            ui.notifications.warn("Could not move the campfire. Place it again from the map.");
            this._healOrphanCampfirePlacementState();
            if (!app._isTotM) {
                app._campPitPlacementCancelled = false;
                await this._startCampPitCursorFlow();
            }
            app.render({ force: true });
            return;
        }

        ui.notifications.info("Campfire and station markers moved.");
        await app._saveRestState();
        app._broadcastMakeCampPhaseSync();
        await this._refreshCampPitNoticeLayer();
        app.render({ force: true });
    
    }

    async onClearAllCampScene(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;
        const n = await clearCampTokens();
        if (n > 0) {
            ui.notifications.info(`Removed ${n} camp token(s) from the scene.`);
        } else {
            ui.notifications.info("No camp tokens to remove on app scene.");
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
    
    }

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
                ui.notifications.info(`Removed ${n} camp token(s) for that character.`);
                emitCampSceneCleared({ actorId });
            } else {
                ui.notifications.info("No camp tokens for that character on the scene.");
            }
            app.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn("You can only clear tokens for a character you own.");
            return;
        }

        const sceneId = canvas?.scene?.id ?? null;
        emitCampGearClearPlayer({
                    actorId,
                    userId: game.user.id,
                    sceneId
                });
    
    }

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
                ui.notifications.info("Gear picked up from the scene.");
                emitCampGearPlaced({
                    actorId,
                    gearType
                });
            } else {
                ui.notifications.info("Nothing to pick up on the scene for that slot.");
            }
            app.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn("You can only reclaim gear for a character you own.");
            return;
        }

        const sceneId = canvas?.scene?.id ?? null;
        emitCampGearReclaim({
                    actorId,
                    gearType,
                    userId: game.user.id,
                    sceneId
                });
        ui.notifications.info("Pick-up sent to the GM.");
    
    }

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
                ui.notifications.info("Station picked up from the scene.");
                emitCampStationPlaced();
            } else {
                ui.notifications.info("Nothing to pick up on the scene for that station.");
            }
            app.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn("You can only pick up stations for a character you own.");
            return;
        }
        if (!canPlaceStation(actor, stationKey)) {
            ui.notifications.warn("That character cannot pick up app station.");
            return;
        }

        emitCampStationReclaim({
                    actorId,
                    stationKey,
                    userId: game.user.id
                });
        ui.notifications.info("Pick-up sent to the GM.");
    
    }

    async _runSetCampFireLevelForGm(level, requestingUserId = null, gmOverride = false) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!["embers", "campfire", "bonfire"].includes(level)) return;

        const actors = getPartyActors();
        if (!gmOverride) {
            const hasTinderbox = actors.some(a => a.items.some(i => {
                const n = i.name?.toLowerCase() ?? "";
                return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
            }));
            if (!hasTinderbox) {
                ui.notifications.warn("No one has a tinderbox or flint & steel to start a fire.");
                return;
            }
        }

        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[level] ?? 0;
        if (!gmOverride) {
            const totalFirewood = actors.reduce((sum, a) => {
                const it = a.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (cost > totalFirewood) {
                ui.notifications.warn("Not enough firewood in the party for that fire size.");
                return;
            }
        }

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

        await CampfireTokenLinker.setLightState(true, level);

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
    
    }

    async changeFireLevelDuringActivity(level, { fromPlayer = false, requestingUserId = null, fromMinigame = false } = {}) {
        const app = this._app;

        if (!game.user.isGM) return { ok: false, error: "GM only" };
        if (app._phase !== "activity") return { ok: false, error: "Wrong phase" };
        const restType = app._engine?.restType
            ?? app._selectedRestType
            ?? app._restData?.restType
            ?? "long";
        if (restType === "short") return { ok: false, error: "Short rest" };
        if (!["embers", "campfire", "bonfire"].includes(level)) return { ok: false, error: "Invalid level" };

        const cur = app._fireLevel ?? "unlit";
        if (level === cur) return { ok: true };

        const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const costOf = (l) => (l === "unlit" ? 0 : (F[l] ?? 0));
        const curCost = costOf(cur);
        const newCost = costOf(level);

        const actors = getPartyActors();
        const hasTinderbox = actors.some(a => a.items.some(i => {
            const n = i.name?.toLowerCase() ?? "";
            return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
        }));

        if (newCost < curCost) {
            // Player request or minigame douse: deliberate action, no extra GM prompt
            if (!fromPlayer && !fromMinigame) {
                const confirmed = await Dialog.confirm({
                    title: "Lower the fire",
                    content: "<p>Reducing the fire discards spent firewood. There is no refund. Continue?</p>",
                    yes: () => true,
                    no: () => false,
                    defaultYes: false
                });
                if (!confirmed) return { ok: false, cancelled: true };
            }
        } else if (newCost > curCost) {
            const need = newCost - curCost;
            if (cur === "unlit" && !hasTinderbox) {
                ui.notifications.warn("No one has a tinderbox or flint and steel to start a fire.");
                return { ok: false, error: "No tinderbox" };
            }
            // When a player requests the change, only their actors' firewood counts
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const spendActors = requestingUserId
                ? actors.filter(a => (a.ownership?.[requestingUserId] ?? 0) >= OWNER)
                : actors;
            const totalFirewood = spendActors.reduce((sum, a) => {
                const it = a.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (need > 0 && totalFirewood < need) {
                ui.notifications.warn("Not enough firewood in the party for that fire size.");
                return { ok: false, error: "Not enough wood" };
            }
            if (need > 0) {
                const spend = await app._spendPartyFirewoodForMakeCamp(need, requestingUserId);
                if (!spend.ok) {
                    ui.notifications.warn(spend.error ?? "Could not spend firewood.");
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

        await CampfireTokenLinker.setLightState(true, level);

        const label = level.charAt(0).toUpperCase() + level.slice(1);
        if (newCost > curCost && (newCost - curCost) > 0) {
            ui.notifications.info(`${label} set. ${newCost - curCost} firewood spent from party stock.`);
        } else if (newCost < curCost) {
            ui.notifications.info(`${label} set.`);
        } else {
            ui.notifications.info(`${label} set.`);
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
    
    }

    async setColdCampDuringActivity({ fromPlayer = false } = {}) {
        const app = this._app;

        if (!game.user.isGM) return { ok: false };
        if (app._phase !== "activity") return { ok: false };
        if (app._coldCampDecided && (app._fireLevel ?? "unlit") === "unlit") return { ok: true };

        app._coldCampDecided = true;
        app._fireLitBy = null;
        app._fireLevel = "unlit";
        app._campFirePreviewLevel = null;
        const FIRE_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (app._engine) {
            app._engine.fireLevel = "unlit";
            app._engine.fireRollModifier = FIRE_MOD.cold_camp ?? 0;
        }
        await CampfireTokenLinker.setLightState(false);

        emitPhaseChanged("activity", {
            coldCampDecided: true,
            fireLevel: "unlit",
            fireLitBy: null,
            selectedTerrain: app._selectedTerrain ?? null,
            comfort: app._engine?.comfort ?? null,
            activeShelters: app._engine?.activeShelters ?? []
        });

        await app._saveRestState();
        app._syncTotmCampfireEmbedFromRest();
        app.render();
        void refreshOpenStationDialog();
        if (!fromPlayer) {
            ui.notifications.info("Cold camp set.");
        }
        return { ok: true };
    
    }

    async onSelectCampFireLevel(event, target) {
        const app = this._app;

        const root = target?.closest?.("[data-action=\"selectCampFireLevel\"]") ?? target;
        const level = root?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;

        // Activity-phase fire changes use a separate socket + handler
        // so the GM runs changeFireLevelDuringActivity (which confirms cost deltas).
        if (app._phase === "activity" && app._isTotM) {
            if (!game.user.isGM) {
                // Player-side pre-validation with modal dialogs
                const cur = app._fireLevel ?? "unlit";
                if (level === cur) return;

                const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
                const costOf = (l) => (l === "unlit" ? 0 : (F[l] ?? 0));
                const curCost = costOf(cur);
                const newCost = costOf(level);
                const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

                if (newCost > curCost) {
                    // Promoting fire: check kindling locally (any party member can have tinderbox)
                    const allActors = getPartyActors();
                    const hasTinderbox = cur !== "unlit" || allActors.some(a => a.items.some(i => {
                        const n = i.name?.toLowerCase() ?? "";
                        return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
                    }));
                    if (cur === "unlit" && !hasTinderbox) {
                        await game.ionrift.library.confirm({
                            title: "Cannot Light Fire",
                            content: "<p>No one in the party has a tinderbox or flint and steel. You cannot start a fire.</p>",
                            yesLabel: "Close",
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
                        const it = a.items.find(i => {
                            const n = i.name?.toLowerCase() ?? "";
                            return n.includes("firewood") || n === "kindling";
                        });
                        return sum + (it?.system?.quantity ?? 0);
                    }, 0);
                    if (need > 0 && myFirewood < need) {
                        await game.ionrift.library.confirm({
                            title: "Not Enough Firewood",
                            content: `<p>Raising the fire to <strong>${levelLabel}</strong> requires ${need} firewood, but your characters only have ${myFirewood}.</p>`,
                            yesLabel: "Close",
                            noLabel: null,
                            yesIcon: "fas fa-times",
                            defaultYes: true
                        });
                        return;
                    }
                    // Confirm firewood consumption from the player's own stock
                    const confirmed = await game.ionrift.library.confirm({
                        title: `Raise Fire to ${levelLabel}`,
                        content: `<p>This will consume <strong>${need} firewood</strong> from your inventory. Continue?</p>`,
                        yesLabel: "Light It",
                        noLabel: "Cancel",
                        yesIcon: "fas fa-fire",
                        noIcon: "fas fa-times",
                        defaultYes: true
                    });
                    if (!confirmed) return;
                } else if (newCost < curCost) {
                    // Reducing fire: player can do app directly, just confirm no refund
                    const confirmed = await game.ionrift.library.confirm({
                        title: `Lower Fire to ${levelLabel}`,
                        content: "<p>Reducing the fire discards spent firewood. There is no refund. Continue?</p>",
                        yesLabel: "Lower Fire",
                        noLabel: "Cancel",
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
    
    }

    async onCampColdCamp(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        await app._campCeremony.decideColdCamp();
    
    }

    async onSelectCampColdCamp(event, target) {
        const app = this._app;

        if (app._phase === "activity") {
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
    
    }

    async onConfirmCampColdCamp() {
        const app = this._app;

        if (app._phase !== "camp") return;
        if (app._coldCampDecided) return;
        if (!game.user.isGM) {
            emitCampColdCampCommit(game.user.id);
            return;
        }
        await app._campCeremony.selectColdCamp();
    
    }

    async onProceedFromMakeCamp(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._phase !== "camp") return;
        if (app._campToActivityDone) {
            ui.notifications?.info("Already advanced from Make Camp.");
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
            ui.notifications?.warn("Place the campfire on the map before proceeding.");
            return;
        }
        if (!fireOk) {
            ui.notifications?.warn("Light the fire or declare cold camp before proceeding.");
            return;
        }

        if (coldCampPreview && !app._coldCampDecided) {
            await app._campCeremony.selectColdCamp();
        }

        await app._totmSpendMakeCampFirewood();
        await app._advanceCampToActivity();
    
    }
}
