import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
/**
 * StationInteractionLayer
 *
 * Manages interactive PIXI overlays on campsite station tokens during the activity phase.
 * Each station token grows a glowing overlay that players click to open the station
 * activity picker. After a player chooses, non-meal overlays dim for that actor.
 *
 * Overlay lifecycle:
 *   activate(actorMap)  ,  attach overlays to canvas tokens
 *   setPlayerState(...)  ,  dim/restore overlays per actor state
 *   deactivate()         ,  remove all overlays, clean up ticker
 */

import { CAMP_STATIONS, getStationsForTerrain } from "../../../data/RestConstants.js";
import { isSimpleStationsMode } from "../../rest/flow/RestProfileSettings.js";
import { isGearDeployed } from "./CompoundCampPlacer.js";
import { getPartyActors } from "../../party/partyActors.js";
import { getActiveRestSessionApp } from "../../rest/session/RestSessionSync.js";

// furnitureKeys that remain interactive after an activity is chosen (meals)
const MEAL_STATION_KEYS = new Set(["campfire", "cookingArea"]);

import { ensureIconFontsLoaded, _portraitUrlsForStation, _iconTexCache } from "./StationIconRenderer.js";
import { StationOverlay } from "./StationOverlay.js";

let _activateGeneration = 0;
// Module-level singleton state
let _overlays          = [];       // StationOverlay[]
let _actorMap          = {};       // { [actorId]: { hasBedroll, assignedTokenId } }
let _tickerFn          = null;
let _active            = false;
let _clickCallback     = null;
let _overlayContainer       = null;  // PIXI.Container (TokensLayer when available)
let _savedTokensSortable    = false;
let _tokensSortablePrev     = false;
let _domClickHandler   = null;     // capture-phase pointerdown on #board
let _domHoverHandler   = null;     // pointermove on #board for cursor + highlight
let _prevHoveredOv     = null;     // last overlay that was hovered
/** GM: returns actor id in party for station distance checks (roster or controlled token). */
let _getProximityActorId = null;
let _tokenUpdateHook     = null;

/**
 * True when the overlay's station token is still the live placeable for this id on
 * the canvas. Stale references remain after a bedroll (or other gear) is picked up;
 * using them in layout or getBounds() can throw in PIXI (null transform / position).
 * @param {Token|null|undefined} token
 * @returns {boolean}
 */
function _stationTokenStillOnScene(token) {
    if (!token?.document) return false;
    if (!canvas?.ready) return true;
    try {
        return canvas.tokens?.get?.(token.id) === token;
    } catch {
        return false;
    }
}

function _clientToCanvasXY(clientX, clientY) {
    const view = canvas.app?.view;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (view.width / rect.width),
        y: (clientY - rect.top) * (view.height / rect.height)
    };
}

function _pointInGlobalBounds(canvasX, canvasY, b) {
    if (!b || (b.width <= 0 && b.height <= 0)) return false;
    return canvasX >= b.x && canvasX <= b.x + b.width
        && canvasY >= b.y && canvasY <= b.y + b.height;
}

/**
 * Notice card or the station token sprite (both open the picker).
 */
function _hitTestOverlayScreen(ov, clientX, clientY) {
    if (ov._dimmed && !ov._mealOnly) return false;
    const p = _clientToCanvasXY(clientX, clientY);
    if (!p) return false;
    let notice = null;
    try {
        notice = ov._container?.getBounds();
    } catch {
        return false;
    }
    if (_pointInGlobalBounds(p.x, p.y, notice)) return true;
    if (!_stationTokenStillOnScene(ov.token)) return false;
    let tokenB = null;
    try {
        tokenB = ov.token?.getBounds?.();
    } catch {
        return false;
    }
    if (_pointInGlobalBounds(p.x, p.y, tokenB)) return true;
    return false;
}

/**
 * Party actor id for the current client (station UI / bedroll ownership). Matches RestSetupApp._resolveStationActorForUser for non-GM.
 * @returns {string|null}
 */
function _currentUserPartyActorId() {
    if (game.user?.isGM) return null;
    const partyActors = getPartyActors();
    const inParty = a => a && partyActors.some(p => p.id === a.id);
    const assigned = game.user?.character;
    if (assigned && inParty(assigned) && assigned.isOwner) return assigned.id;
    const owned = partyActors.filter(a => a.isOwner);
    if (owned.length === 1) return owned[0].id;
    if (owned.length > 1) {
        const fromToken = canvas.tokens?.controlled?.[0]?.actor;
        if (fromToken && owned.some(a => a.id === fromToken.id)) return fromToken.id;
        return owned[0].id;
    }
    const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const playable = partyActors.find(a => a.testUserPermission(game.user, OBS));
    return playable?.id ?? null;
}

/**
 * Reposition any overlay whose token refreshed (fires continuously during drag animation).
 * @param {Token} token - Foundry Token placeable
 */
function _onRefreshTokenForOverlays(token) {
    const f = token.document?.flags?.[MODULE_ID];
    if (!f?.isCampFurniture && !f?.isPlayerGear) return;
    if (!_stationTokenStillOnScene(token)) return;
    const id = token.id;
    for (const ov of _overlays) {
        if (ov.token?.id === id) {
            ov._syncNoticeLayout();
            break;
        }
    }
}

/**
 * Activate overlays for all placed station tokens.
 *
 * @param {Object} actorMap  - { [actorId]: { hasBedroll: bool, assignedTokenId: string } }
 * @param {Function} onStationClick - (stationId, token, overlay) called when player clicks a station
 * @param {object} [options]
 * @param {() => string|null|undefined} [options.getProximityActorId] - GM client: party actor id for distance
 * @param {Record<string, boolean>} [options.stationEmptyNoticeFade] - station id -> muted notice when no available activities
 * @param {boolean} [options.campPitModeOnly] - Only the campfire pit token, with Make Camp copy (all clients)
 * @param {boolean} [options.campPitUnlit] - "Light the fire" vs "Campfire" label
 * @param {string}  [options.terrainTag] - Current terrain tag for station filtering (hides campfire/weapon rack in tavern, etc.)
 * @param {() => void} [options.onLayerReady] - After overlays spawn and the ticker is running
 */
export function activateStationLayer(actorMap, onStationClick, options = {}) {
    // Theater of the Mind: skip canvas overlays entirely (camp-pit notice is exempt;
    // fire lighting is a setup step that runs in both modes).
    if (!options.campPitModeOnly) {
        try {
            const respite = game.ionrift?.respite;
            const restApp = respite?.activeRestSetupApp ?? respite?.activePlayerRestApp;
            if (restApp?._isTotM) {
                Logger.log(`${MODULE_ID} | StationInteractionLayer.activate skipped (theater mode)`);
                return;
            }
            if (getActiveRestSessionApp?.("downtime")) {
                Logger.log(`${MODULE_ID} | StationInteractionLayer.activate skipped (downtime active)`);
                return;
            }
            if (game.settings.get(MODULE_ID, "restInterfaceMode") === "theater") {
                Logger.log(`${MODULE_ID} | StationInteractionLayer.activate skipped (theater mode)`);
                return;
            }
        } catch { /* setting not registered yet; default to allowing activation */ }
    }

    deactivateStationLayer();

    _actorMap      = actorMap ?? {};
    _active        = true;
    _clickCallback = onStationClick;
    _getProximityActorId = typeof options.getProximityActorId === "function"
        ? options.getProximityActorId
        : null;
    const emptyFadeMap = options.stationEmptyNoticeFade && typeof options.stationEmptyNoticeFade === "object"
        ? options.stationEmptyNoticeFade
        : {};
    const campPitModeOnly = !!options.campPitModeOnly;
    const campPitUnlit    = options.campPitUnlit !== false;
    const terrainTag      = options.terrainTag ?? null;
    const activateGen     = ++_activateGeneration;

    // Parent to TokensLayer so notices draw above furniture tokens; high zIndex
    // keeps the whole tray above per-token elevation sorting.
    _overlayContainer = new PIXI.Container();
    _overlayContainer.sortableChildren = true;
    if ("eventMode" in _overlayContainer) {
        _overlayContainer.eventMode = "passive";
    } else {
        _overlayContainer.interactiveChildren = true;
    }
    _overlayContainer.zIndex = 1_000_000;

    let host;
    if (canvas.tokens?.addChild) {
        host = canvas.tokens;
        _savedTokensSortable = true;
        _tokensSortablePrev  = host.sortableChildren;
        host.sortableChildren = true;
    } else {
        host = canvas.interface ?? canvas.stage;
        if (host === canvas.interface && "sortableChildren" in host) host.sortableChildren = true;
        _savedTokensSortable = false;
    }
    host.addChild(_overlayContainer);
    Logger.log(`${MODULE_ID} | StationInteractionLayer: overlay container added to`, host.constructor?.name ?? "stage");

    const sceneTokens = canvas.tokens?.placeables ?? [];
    Logger.log(`${MODULE_ID} | StationInteractionLayer.activate`, {
        isGM: game.user.isGM,
        sceneTokenCount: sceneTokens.length,
        actorMapKeys:    Object.keys(_actorMap)
    });

    ensureIconFontsLoaded().then(async () => {
        if (!_active || activateGen !== _activateGeneration) return;
        _spawnStationOverlays({
            sceneTokens,
            terrainTag,
            emptyFadeMap,
            campPitModeOnly,
            campPitUnlit
        });
        await Promise.all(_overlays.map(ov => ov.refreshIcon()));
        if (!_active || activateGen !== _activateGeneration) return;
        _attachStationLayerRuntime(options.onLayerReady);
    });
}

/**
 * Attach interactive overlays after Font Awesome faces are ready for Canvas2D.
 * @param {object} params
 */
function _spawnStationOverlays({ sceneTokens, terrainTag, emptyFadeMap, campPitModeOnly, campPitUnlit }) {
    const effectiveStations = terrainTag ? getStationsForTerrain(terrainTag) : CAMP_STATIONS;

    for (const station of effectiveStations) {
        if (campPitModeOnly) {
            if (station.furnitureKey !== "campfire") continue;
        } else if (!station.furnitureKey) {
            continue; // bedroll: separate pass
        } else if (isSimpleStationsMode() && station.id === "campfire") {
            continue; // simple stations: fire is visual only during activity
        }

        const token = sceneTokens.find(t => {
            const flags = t.document.flags?.[MODULE_ID];
            if (!flags?.isCampFurniture) return false;
            if (campPitModeOnly) {
                return flags.furnitureKey === "campfire" && flags.isCampfireBase;
            }
            return flags.furnitureKey === station.furnitureKey;
        });

        if (!token) continue;

        const displayOverride = campPitModeOnly
            ? (campPitUnlit
                ? { title: game.i18n.localize("ionrift-respite.stationOverlay.lightFireTitle"), tagline: game.i18n.localize("ionrift-respite.stationOverlay.lightFireTagline") }
                : { title: game.i18n.localize("ionrift-respite.stationOverlay.campfireTitle"), tagline: (station.tagline ?? "").replace(/,/g, " · ") })
            : null;

        const overlay = new StationOverlay(
            token,
            station,
            _actorMap,
            _clickCallback,
            {
                emptyNoticeFade: !!emptyFadeMap[station.id],
                displayOverride: displayOverride ?? undefined,
                skipProximity:  !!campPitModeOnly
            }
        );
        _overlays.push(overlay);
        if (campPitModeOnly) break;
    }

    const bedrollStation = effectiveStations.find(s => s.id === "bedroll");
    if (bedrollStation && !campPitModeOnly) {
        const sharedToken = isSimpleStationsMode()
            ? sceneTokens.find(t => {
                const f = t.document.flags?.[MODULE_ID];
                return f?.isCampFurniture && f?.furnitureKey === "sharedBedroll";
            })
            : null;

        if (sharedToken) {
            const overlay = new StationOverlay(
                sharedToken,
                bedrollStation,
                _actorMap,
                _clickCallback,
                {
                    emptyNoticeFade: !!emptyFadeMap.bedroll,
                    displayOverride: { title: bedrollStation.label, tagline: bedrollStation.tagline ?? "" }
                }
            );
            _overlays.push(overlay);
        } else {
            for (const actorId of Object.keys(_actorMap)) {
                if (!isGearDeployed(actorId, "bedroll")) continue;
                const token = sceneTokens.find(t => {
                    const f = t.document.flags?.[MODULE_ID];
                    return f?.isPlayerGear && f?.furnitureKey === "bedroll" && f?.ownerActorId === actorId;
                });
                if (!token) continue;
                const ownerActor = game.actors.get(actorId);
                const ownerName = ownerActor?.name ?? game.i18n.localize("ionrift-respite.stationOverlay.bedrollFallback");
                const overlay = new StationOverlay(
                    token,
                    bedrollStation,
                    _actorMap,
                    _clickCallback,
                    {
                        emptyNoticeFade: !!emptyFadeMap.bedroll,
                        displayOverride: { title: game.i18n.format("ionrift-respite.stationOverlay.ownedStation", { owner: ownerName, station: bedrollStation.label }) }
                    }
                );
                _overlays.push(overlay);
                const me = _currentUserPartyActorId();
                if (me !== null && actorId !== me) {
                    overlay._permanentlyDimmed = true;
                    overlay.setDimmed();
                }
            }
        }
    }
}

/** Hooks, ticker, and DOM hit-testing for the active station layer. */
function _attachStationLayerRuntime(onLayerReady) {
    if (!_tokenUpdateHook) {
        _tokenUpdateHook = _onRefreshTokenForOverlays;
        Hooks.on("refreshToken", _tokenUpdateHook);
    }

    _tickerFn = (delta) => {
        for (const ov of _overlays) ov.tick(delta);
    };
    canvas.app.ticker.add(_tickerFn);

    // DOM-level event handlers (capture phase) so clicks and hover work regardless
    // of how Foundry/PIXI routes events through canvas layers.
    const board = document.getElementById("board");
    if (board) {
        _domClickHandler = (event) => {
            if (!_active || _overlays.length === 0) return;
            for (let i = _overlays.length - 1; i >= 0; i--) {
                const ov = _overlays[i];
                if (_hitTestOverlayScreen(ov, event.clientX, event.clientY)) {
                    event.stopPropagation();
                    event.preventDefault();
                    Logger.log(`${MODULE_ID} | DOM pointerdown hit`, { stationId: ov.station.id });
                    ov._onClick();
                    return;
                }
            }
        };
        board.addEventListener("pointerdown", _domClickHandler, true);

        _domHoverHandler = (event) => {
            if (!_active || _overlays.length === 0) return;
            let hit = null;
            for (let i = _overlays.length - 1; i >= 0; i--) {
                const ov = _overlays[i];
                if (_hitTestOverlayScreen(ov, event.clientX, event.clientY)) { hit = ov; break; }
            }
            if (hit !== _prevHoveredOv) {
                if (_prevHoveredOv) _prevHoveredOv._onHover(false);
                if (hit) hit._onHover(true);
                _prevHoveredOv = hit;
                board.style.cursor = hit ? "pointer" : "";
            }
        };
        board.addEventListener("pointermove", _domHoverHandler);
    } else {
        console.warn(`${MODULE_ID} | #board element not found; overlay clicks will not work`);
    }

    Logger.log(`${MODULE_ID} | StationInteractionLayer: ${_overlays.length} overlay(s) attached, DOM handlers registered`);

    refreshStationDetectMagicGlow();

    if (typeof onLayerReady === "function") {
        try {
            onLayerReady();
        } catch (err) {
            console.warn(`${MODULE_ID} | StationInteractionLayer onLayerReady`, err);
        }
    }
}

/**
 * Remove all overlays and stop the ticker.
 */
export function deactivateStationLayer() {
    if (_tokenUpdateHook) {
        Hooks.off("refreshToken", _tokenUpdateHook);
        _tokenUpdateHook = null;
    }
    if (_tickerFn) {
        canvas.app?.ticker.remove(_tickerFn);
        _tickerFn = null;
    }
    for (const ov of _overlays) ov.destroy();
    _overlays = [];
    for (const tex of _iconTexCache.values()) tex?.destroy?.(true);
    _iconTexCache.clear();

    if (_overlayContainer) {
        if (!_overlayContainer.destroyed) {
            _overlayContainer.parent?.removeChild?.(_overlayContainer);
            _overlayContainer.destroy({ children: true });
        }
        _overlayContainer = null;
    }

    if (_savedTokensSortable && canvas.tokens) {
        canvas.tokens.sortableChildren = _tokensSortablePrev;
        _savedTokensSortable = false;
    }

    const board = document.getElementById("board");
    if (_domClickHandler) {
        board?.removeEventListener("pointerdown", _domClickHandler, true);
        _domClickHandler = null;
    }
    if (_domHoverHandler) {
        board?.removeEventListener("pointermove", _domHoverHandler);
        _domHoverHandler = null;
    }
    if (board) board.style.cursor = "";
    _prevHoveredOv = null;

    _active        = false;
    _actorMap      = {};
    _clickCallback = null;
    _getProximityActorId = null;
}

/**
 * Called after an actor chooses an activity. Dims non-meal overlays for that actor.
 * Meal stations (campfire, cookingArea) switch to meal-only style.
 *
 * @param {string} actorId
 * @param {string} chosenStationId  - the station the actor chose at
 * @param {Map<string, string>|null} [characterChoicesMap] - when set (e.g. RestSetupApp._characterChoices), all stations show stacked portraits for matching picks (GM + full party).
 * @param {Map<string, string>|null} [explicitStationByCharacter] - characterId -> station id from canvas pick (optional)
 */
export function setStationPlayerState(actorId, chosenStationId, characterChoicesMap = null, explicitStationByCharacter = null) {
    if (!_active) return;

    const actor = game.actors.get(actorId);
    // GMs usually have OWNER on all PCs; `isOwner` alone would dim the whole camp on the GM
    // client after any player picks. Only the assigned player client gets the locked-in layout.
    const isPickingPlayerClient = !game.user.isGM && !!actor?.isOwner;
    const portraitSrc = actor?.img ?? "icons/svg/mystery-man.svg";
    const choicesMap = characterChoicesMap instanceof Map ? characterChoicesMap : null;
    const explicitMap = explicitStationByCharacter instanceof Map ? explicitStationByCharacter : null;

    for (const ov of _overlays) {
        ov.clearChosenPortrait();
    }

    // Dim peripheral stations for the player who locked a choice (not for GM clients).
    // Portraits still use choicesMap so the GM sees who picked where.
    for (const ov of _overlays) {
        const isMeal = MEAL_STATION_KEYS.has(ov.station.furnitureKey);
        if (ov.station.id === chosenStationId) {
            if (isMeal && isPickingPlayerClient) {
                ov.setDimmed(true);
            } else if (!isMeal) {
                ov.setDimmed(false);
            }
        } else if (isMeal) {
            ov.setDimmed(true); // mealOnly = true
        } else if (isPickingPlayerClient) {
            ov.setDimmed(false);
        }

        const urls = choicesMap
            ? _portraitUrlsForStation(ov.station.id, choicesMap, explicitMap)
            : (ov.station.id === chosenStationId && isPickingPlayerClient ? [portraitSrc] : []);
        if (urls.length) ov.setChosenPortraits(urls);
    }
}

/**
 * Restores all station overlays to the default active look on this client.
 * Used when a player clears an activity pick that had updated local overlay styling.
 */
export function resetStationOverlaysLocal() {
    if (!_active) return;
    for (const ov of _overlays) ov.setActive();
}

/**
 * Updates stacked portraits on all station notices from the canonical activity map.
 * Does not change dim state (use {@link setStationPlayerState} after a local pick).
 * @param {Map<string, string>} characterChoicesMap  characterId -> activityId
 * @param {Map<string, string>|null} [explicitStationByCharacter]  characterId -> canvas station id when known
 */
export function refreshStationPortraitsFromChoices(characterChoicesMap, explicitStationByCharacter = null) {
    if (!_active || !(characterChoicesMap instanceof Map)) return;
    const explicitMap = explicitStationByCharacter instanceof Map ? explicitStationByCharacter : null;
    for (const ov of _overlays) {
        ov.clearChosenPortrait();
    }
    for (const ov of _overlays) {
        const urls = _portraitUrlsForStation(ov.station.id, characterChoicesMap, explicitMap);
        if (urls.length) ov.setChosenPortraits(urls);
    }
}

/**
 * Updates muted notice styling when the roster actor or rest context changes.
 * @param {{ _buildStationEmptyNoticeMap?: () => Record<string, boolean> }} restApp
 */
export function refreshStationEmptyNoticeFade(restApp) {
    if (!_active || typeof restApp?._buildStationEmptyNoticeMap !== "function") return;
    const map = restApp._buildStationEmptyNoticeMap();
    for (const ov of _overlays) {
        ov.setEmptyNoticeFade(!!map[ov.station.id]);
    }
}

/**
 * Activity-phase rations queue on one station notice (cooking token if present, else campfire).
 * @param {{ _getPendingMealCanvasPlan?: () => { stationId: string|null, urls: string[] } }} restApp
 */
export function refreshStationMealPortraits(restApp) {
    if (!_active || typeof restApp?._getPendingMealCanvasPlan !== "function") return;
    const { stationId, urls } = restApp._getPendingMealCanvasPlan();
    for (const ov of _overlays) {
        if (ov.station.id === "bedroll") {
            ov.clearMealPortraits();
            continue;
        }
        if (stationId && ov.station.id === stationId && urls.length > 0) {
            ov.setMealPortraits(urls);
        } else {
            ov.clearMealPortraits();
        }
    }
}

/**
 * @param {object|null} [restApp]
 * @returns {object|null}
 */
function _resolveRestAppForDetectMagicGlow(restApp) {
    if (restApp) return restApp;
    const respite = game.ionrift?.respite;
    return respite?.activeRestSetupApp
        ?? respite?.activePlayerRestApp
        ?? respite?.activeShortRestApp
        ?? null;
}

/**
 * Purple badge glow on the workbench token while Detect Magic scan is active.
 * @param {{ _magicScanComplete?: boolean }|null} [restApp]
 */
export function refreshStationDetectMagicGlow(restApp = null) {
    if (!_active) return;
    const app = _resolveRestAppForDetectMagicGlow(restApp);
    const active = !!app?._magicScanComplete;
    for (const ov of _overlays) {
        ov.setDetectMagicGlow(ov.station.id === "workbench" && active);
    }
}

/**
 * Returns whether the station layer is currently active.
 */
export function isStationLayerActive() {
    return _active;
}


export function stationTokenStillOnScene(token) { return _stationTokenStillOnScene(token); }
export function getProximityActorIdFn() { return _getProximityActorId; }
export function getOverlayContainer() { return _overlayContainer; }
