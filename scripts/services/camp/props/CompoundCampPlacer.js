import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
/**
 * CompoundCampPlacer
 * Places the campfire pit (base + flame tokens) on the active scene. Shared
 * camp stations (workbench, weapon rack, medical bed, cooking area) are
 * placed separately via drag from the Make Camp UI. Player gear (bedroll,
 * tent, mess kit) uses deployed-state tracking on items.
 *
 * All placed tokens are flagged with isCampFurniture and a shared
 * campSessionId so they can be cleaned up when the rest resolves.
 */

import { getPartyActors } from "../../party/partyActors.js";
import { isSimpleStationsMode } from "../../rest/flow/RestProfileSettings.js";
import { ImageResolver } from "../../../utils/ImageResolver.js";
import {
    getDocSourceId,
    getItemIdentifier,
    getRespiteFlag,
    isBedrollItem,
    isCooksUtensilsItem,
    isMessKitItem,
    isTentItem
} from "../gear/CampGearScanner.js";

/** Placeholder token definition for station build-sites before equipment is assigned. */
export const PLACEHOLDER_CAMP_STATION = {
    name: "Build site",
    path: "icons/svg/circle.svg",
    width: 0.5,
    height: 0.5
};

/** Shared camp furniture (not the campfire pit). Keys match CAMP_STATIONS furnitureKey. */
export const FURNITURE = {
    table:       { name: "Arcane Workbench", width: 1, height: 1 },
    medicalBed:  { name: "Medical Bedding",  width: 1, height: 1 },
    weaponRack:  { name: "Weapon Rack",      width: 1, height: 1 },
    cookingArea: {
        name: "Cooking Station",
        basicName: "Food Station",
        width: 1, height: 1
    },
    /** Shared party bedrolls (Simple profile + camp stations). */
    sharedBedroll: { name: "Bedrolls", width: 1, height: 1 }
};

/** Furniture keys that can be placed from the Camp Stations panel (order = UI order). */
export const CAMP_STATION_PLACEMENT_KEYS = ["weaponRack", "table", "medicalBed", "cookingArea"];

/**
 * Placement keys for the current rest configuration.
 * @param {boolean} [safeRestSpot]
 * @param {{ simpleStations?: boolean }} [options]
 * @returns {string[]}
 */
export function getCampStationPlacementKeys(safeRestSpot = false, options = {}) {
    const simpleStations = options.simpleStations ?? isSimpleStationsMode();
    if (simpleStations) return ["table"];
    if (safeRestSpot) return ["weaponRack", "table", "cookingArea"];
    return CAMP_STATION_PLACEMENT_KEYS;
}

/** Code-only feature flag: auto-place stations when entering step 2. */
export const AUTO_PLACE_STATIONS = true;

const PLAYER_GEAR = {
    bedroll: { name: "Bedroll",  width: 1,   height: 1 },
    tent:    { name: "Tent",     width: 2,   height: 2 },
    /** Small map token: dining gear (half-grid footprint). */
    messkit: {
        name:     "Mess Kit",
        width:    0.5,
        height:   0.5
    }
};

/**
 * Resolve the icon path for a furniture or player gear key.
 * Uses ImageResolver for art pack tokens; falls back to core SVG.
 * @param {string} key - FURNITURE or PLAYER_GEAR key
 * @param {{ hasCookingUtensils?: boolean }} [options]
 * @returns {string}
 */
export function resolveStationIcon(key, options = {}) {
    return ImageResolver.resolveStationToken(key, options);
}

/**
 * @param {Actor} actor
 * @param {string} gearType
 * @returns {Item|undefined}
 */
export function findPlayerGearItem(actor, gearType) {
    const items = actor.items ?? [];
    for (const item of items) {
        if (gearType === "bedroll" && isBedrollItem(item)) return item;
        if (gearType === "tent" && isTentItem(item)) return item;
        if (gearType === "messkit" && isMessKitItem(item)) return item;
    }
    return undefined;
}

let _campSessionId = null;
/** True while a campfire create is in flight, so a second drop cannot land. */
let _placingCampfire = false;
/** Scene where the current rest camp was placed (may differ from the active canvas). */
let _campSceneId = null;
/** Coalesce concurrent camp cleanup (abandon + close both call clearCampTokens). */
let _clearCampTokensPromise = null;

/**
 * Delete tokens that still exist on the scene (safe when cleanup runs twice).
 * @param {Scene} scene
 * @param {string[]} tokenIds
 * @param {object} [deleteOptions]
 * @returns {Promise<number>}
 */
async function deleteSceneTokensIfPresent(scene, tokenIds, deleteOptions = {}) {
    const existing = [...new Set(tokenIds)].filter(id => scene.tokens.has(id));
    if (!existing.length) return 0;
    await scene.deleteEmbeddedDocuments("Token", existing, deleteOptions);
    return existing.length;
}

/**
 * Pit token (logs) for the current respite camp on the active scene.
 * @returns {TokenDocument|null}
 */
export function getPitTokenOnScene() {
    return getPitTokenOnSceneDoc(canvas?.scene ?? null);
}

/**
 * @param {Scene|null} scene
 * @returns {TokenDocument|null}
 */
export function getPitTokenOnSceneDoc(scene) {
    if (!scene) return null;
    return scene.tokens.find(t => {
        const f = t.flags?.[MODULE_ID];
        return f?.isCampFurniture && f?.furnitureKey === "campfire";
    }) ?? null;
}

/**
 * @param {TokenDocument} pit
 * @param {number} gs
 * @returns {{ x: number, y: number }}
 */
export function pitCenterFromTokenDoc(pit, gs) {
    return {
        x: pit.x + (pit.width * gs) / 2,
        y: pit.y + (pit.height * gs) / 2
    };
}

/**
 * Sync local campSessionId from the pit token so all clients (including
 * players) match the GM after tokens sync from the database.
 * @returns {string|null} campSessionId from scene, if any
 */
export function hydrateCampSessionFromScene() {
    const pit = getPitTokenOnScene();
    const sid = pit?.flags?.[MODULE_ID]?.campSessionId ?? null;
    if (sid) _campSessionId = sid;
    if (pit?.parent?.id) _campSceneId = pit.parent.id;
    return sid;
}

/** @returns {string|null} */
export function getCampSceneId() {
    return _campSceneId;
}

/** @returns {string|null} */
export function getCampSessionIdStored() {
    return _campSessionId;
}

/**
 * Restore camp placement pointers after loading persisted rest state.
 * @param {{ sessionId?: string|null, sceneId?: string|null }} state
 */
export function restoreCampPlacementState(state = {}) {
    if (state.sessionId) _campSessionId = state.sessionId;
    if (state.sceneId) _campSceneId = state.sceneId;
}

/**
 * @param {TokenDocument} tokenDoc
 * @param {string|null} sessionId
 * @returns {boolean}
 */
function tokenMatchesCampCleanup(tokenDoc, sessionId) {
    const flags = tokenDoc.flags?.[MODULE_ID];
    if (!flags) return false;
    if (flags.isTorchStake || flags.isPerimeterTorch) return true;
    if (flags.isCampFurniture) {
        if (sessionId) return flags.campSessionId === sessionId;
        return true;
    }
    if (flags.isCampfireBase || flags.isCampfireToken) return true;
    return false;
}

/**
 * @param {Scene} scene
 * @param {string|null} sessionId
 * @returns {Promise<number>}
 */
async function clearCampTokensOnScene(scene, sessionId) {
    const campTokens = scene.tokens.filter(t => tokenMatchesCampCleanup(t, sessionId));
    if (!campTokens.length) return 0;

    for (const t of campTokens) {
        const flags = t.flags?.[MODULE_ID];
        if (flags?.isPlayerGear && flags?.ownerActorId) {
            const actor = game.actors.get(flags.ownerActorId);
            if (actor) {
                const gk = flags.furnitureKey;
                if (gk === "bedroll" || gk === "tent" || gk === "messkit") {
                    const item = findPlayerGearItem(actor, gk);
                    if (item) {
                        try { await item.unsetFlag(MODULE_ID, "deployedInCamp"); } catch { /* ignore */ }
                    }
                }
            }
        }
    }

    const removed = await deleteSceneTokensIfPresent(
        scene,
        campTokens.map(t => t.id),
        { ionriftAllowCampDelete: true }
    );
    if (removed > 0) {
        Logger.log(`${MODULE_ID} | CompoundCampPlacer: cleared ${removed} camp token(s) on scene "${scene.name}"`);
    }
    return removed;
}

import {
    gridSize,
    resolveSceneForCampOp,
    CAMP_PLACEMENT_RANGE_SQUARES,
    pitCenterWorld,
    snappedCenterWorld,
    measureWorldDistanceFeet,
    placementOverlapsAnyToken,
    getBlockingTokens,
    isCampFurnitureToken,
    validateCampEquipmentDrop,
    validatePlayerGearDrop,
    validateStationEquipmentDrop
} from "./CampPlacementGeometry.js";
export {
    gridSize,
    resolveSceneForCampOp,
    CAMP_PLACEMENT_RANGE_SQUARES,
    pitCenterWorld,
    snappedCenterWorld,
    measureWorldDistanceFeet,
    placementOverlapsAnyToken,
    getBlockingTokens,
    isCampFurnitureToken,
    validateCampEquipmentDrop,
    validatePlayerGearDrop,
    validateStationEquipmentDrop
};

export function getCampSessionId() {
    if (!_campSessionId) _campSessionId = foundry.utils.randomID(8);
    return _campSessionId;
}

/**
 * Build token data for a camp furniture piece.
 * @param {string} key - Furniture key from FURNITURE or PLAYER_GEAR
 * @param {number} x - Top-left x
 * @param {number} y - Top-left y
 * @param {Object} def - Definition with name, icon, fallback
 * @param {Object} [extraFlags] - Additional flags to merge
 * @returns {Object} Token creation data
 */
export function buildFurnitureToken(key, x, y, def, extraFlags = {}) {
    const w = def.width ?? 1;
    const h = def.height ?? 1;
    const texScale = def.textureScale ?? 1;
    const data = {
        name: def.name,
        texture: {
            src: resolveStationIcon(key, { hasCookingUtensils: key === "cookingArea" ? partyHasCookingUtensils() : undefined }),
            scaleX: texScale,
            scaleY: texScale
        },
        width: w,
        height: h,
        x,
        y,
        hidden: false,
        lockRotation: true,
        rotation: Math.floor(Math.random() * 20) - 10,
        disposition: -2,
        light: { bright: 0, dim: 0 },
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isCampFurniture: true,
                campSessionId: getCampSessionId(),
                furnitureKey: key,
                propKey: key,
                ...extraFlags
            }
        }
    };
    /**
     * Shared stations and player gear: {@link CAMP_FLOOR_FURNITURE_SORT}.
     * Campfire pit and flame are handled in {@link placeCampfire} via {@link CAMPFIRE_PIT_SORT} / {@link CAMPFIRE_FLAME_FLOOR_SORT}.
     */
    if (extraFlags.isSharedStation) {
        data.sort = CAMP_FLOOR_FURNITURE_SORT;
        if (key === "cookingArea") {
            data.flags[MODULE_ID].partyHasCookingUtensils = partyHasCookingUtensils();
        }
    } else if (extraFlags.isPlayerGear) {
        data.sort = CAMP_FLOOR_FURNITURE_SORT;
    }
    return data;
}

// Campfire base (cold pit, always visible) and flame overlay (lit; template actor may override texture)
function getCampfireBasePitTexture() {
    return ImageResolver.resolveStationToken("campfire");
}
const CAMPFIRE_FLAME = "icons/svg/fire.svg";

/**
 * Token `sort` among siblings at the same elevation (HUD bring-to-front / send-to-back).
 * Higher draws on top. Not flight elevation.
 *
 * Floor camp tokens share a very low range so they sit under normal map tokens. Pit, flame,
 * and workstations use that band. Flame is pit +1 so the fire still draws above the cold logs.
 */
export const CAMP_FLOOR_FURNITURE_SORT = -50_000;
/** Pit logs: same floor layer as workstations. */
export const CAMPFIRE_PIT_SORT = CAMP_FLOOR_FURNITURE_SORT;
/** Lit fire overlay: directly above pit so light and animation stay on the logs. */
export const CAMPFIRE_FLAME_FLOOR_SORT = CAMP_FLOOR_FURNITURE_SORT + 1;

function randomCampfireBase() {
    return getCampfireBasePitTexture();
}

/**
 * Picks the pit log texture for one placement. Use the same value for
 * live preview and {@link placeCampfire} so the token matches the ghost.
 * @returns {string}
 */
export function pickCampfirePitBaseTexture() {
    return getCampfireBasePitTexture();
}

function findCampfireActor() {
    const byFlagOrSrc = game.actors?.find(a =>
        getRespiteFlag(a, "propKey") === "campfire"
        || /(?:^|[.\/])campfire$/i.test(getDocSourceId(a))
    );
    if (byFlagOrSrc) return byFlagOrSrc;
    const name = game.settings.get(MODULE_ID, "campfireTokenName")?.toLowerCase() ?? "campfire";
    return game.actors?.find(a => a.name?.toLowerCase() === name) ?? null;
}

/**
 * True if any party member has cook's utensils or brewing tools
 * (unlocks the cooking station; not the mess kit).
 * @returns {boolean}
 */
export function partyHasCookingUtensils() {
    for (const a of getPartyActors()) {
        if (canPlaceStation(a, "cookingArea")) return true;
        if (actorHasBrewingTools(a)) return true;
    }
    return false;
}

/**
 * Whether an actor may place a shared station (not GM bypass).
 * @param {Actor|null} actor
 * @param {string} stationKey - key in FURNITURE
 * @returns {boolean}
 */
export function canPlaceStation(actor, stationKey) {
    if (!actor) return false;
    if (stationKey === "weaponRack" || stationKey === "table" || stationKey === "medicalBed" || stationKey === "sharedBedroll") {
        return true;
    }
    if (stationKey === "cookingArea") {
        return (actor.items ?? []).some(i => {
            if (isCooksUtensilsItem(i)) return true;
            const n = i.name?.toLowerCase() ?? "";
            if (n.includes("mess kit")) return false;
            return n.includes("cook's utensils") || n.includes("cooks utensils")
                || n.includes("cooking utensils");
        });
    }
    return false;
}

/**
 * True if the actor has alchemist's supplies, brewer's supplies, or an herbalism kit.
 * These unlock the brewing activities at the cooking station.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function actorHasBrewingTools(actor) {
    if (!actor) return false;
    return (actor.items ?? []).some(i => {
        const role = String(getRespiteFlag(i, "campGearRole") ?? getRespiteFlag(i, "itemRef") ?? "").toLowerCase();
        if (["alchemists-supplies", "brewers-supplies", "herbalism-kit", "alchemist", "brewer", "herbalism", "brewing-tools"].includes(role)) {
            return true;
        }
        const ident = getItemIdentifier(i);
        if (["alchemists-supplies", "brewers-supplies", "herbalism-kit", "alchemist", "brewer", "herbalism"].includes(ident)) {
            return true;
        }
        const src = getDocSourceId(i).toLowerCase();
        if (/(?:^|[.\/-])(alchemist|brewer|herbalism)/.test(src)) return true;
        const n = i.name?.toLowerCase() ?? "";
        const baseItem = (i.system?.type?.baseItem ?? "").toLowerCase();
        return n.includes("alchemist") || n.includes("brewer") || n.includes("herbalism")
            || baseItem === "alchemist" || baseItem === "brewer" || baseItem === "herbalism"
            || baseItem === "alchemists-supplies" || baseItem === "brewers-supplies" || baseItem === "herbalism-kit";
    });
}

/**
 * End-user-readable requirement line when {@link canPlaceStation} is false.
 * @param {string} stationKey
 * @returns {string}
 */
export function stationPlacementRequirementHint(stationKey) {
    if (stationKey === "cookingArea") {
        return game.i18n.localize("ionrift-respite.campPlacer.cookingRequirement");
    }
    return "";
}

/**
 * Place campfire base + flame only (no shared furniture).
 * GM only.
 *
 * @param {number} worldX - Canvas world X (center of the pit)
 * @param {number} worldY - Canvas world Y (center of the pit)
 * @param {{ pitBaseTextureSrc?: string }} [options] - If set, base token uses this art (must match preview pick)
 * @returns {Promise<{sessionId: string, center: {x: number, y: number}}|null>}
 */
export async function placeCampfire(worldX, worldY, options = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacer.gmOnlyCampfire"));
        return null;
    }
    if (_placingCampfire || hasCampfirePlaced()) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacer.campfireAlreadyPlaced"));
        return null;
    }

    const scene = canvas.scene;
    if (!scene) return null;
    _placingCampfire = true;
    try {
        return await _placeCampfireNow(worldX, worldY, options, scene);
    } finally {
        _placingCampfire = false;
    }
}

async function _placeCampfireNow(worldX, worldY, options, scene) {

    const gs = gridSize();
    const snapped = canvas.grid.getSnappedPoint({ x: worldX, y: worldY }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
    const cx = snapped.x ?? worldX;
    const cy = snapped.y ?? worldY;

    const sessionId = getCampSessionId();
    _campSceneId = scene.id;
    const linkId = foundry.utils.randomID(8);

    const tx = cx - (gs / 2);
    const ty = cy - (gs / 2);

    const baseSrc = typeof options.pitBaseTextureSrc === "string" && options.pitBaseTextureSrc.length
        ? options.pitBaseTextureSrc
        : randomCampfireBase();

    const baseData = {
        name: "Campfire Base",
        texture: { src: baseSrc },
        width: 1, height: 1,
        sort: CAMPFIRE_PIT_SORT,
        x: tx, y: ty,
        hidden: true,
        lockRotation: true,
        locked: true,
        rotation: Math.floor(Math.random() * 360),
        disposition: -2,
        light: { bright: 0, dim: 0 },
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isCampfireBase: true,
                campfireLinkId: linkId,
                isCampFurniture: true,
                campSessionId: sessionId,
                furnitureKey: "campfire",
                propKey: "campfire-base"
            }
        }
    };

    const campfireActor = findCampfireActor();
    const protoLight = campfireActor?.prototypeToken?.light;
    const lightConfig = (protoLight && (protoLight.bright > 0 || protoLight.dim > 0))
        ? foundry.utils.deepClone(protoLight.toObject?.() ?? protoLight)
        : {
            bright: 20, dim: 40, color: "#ff9329", alpha: 0.4,
            angle: 360, coloration: 1, luminosity: 0.5,
            animation: { type: "torch", speed: 3, intensity: 4 },
            darkness: { min: 0, max: 1 }
        };

    const campfireName = game.settings.get(MODULE_ID, "campfireTokenName") ?? "Campfire";
    const flameSrc = campfireActor?.prototypeToken?.texture?.src ?? CAMPFIRE_FLAME;

    const flameData = {
        name: campfireName,
        texture: { src: flameSrc, scaleX: 1, scaleY: 1 },
        width: 1, height: 1,
        sort: CAMPFIRE_FLAME_FLOOR_SORT,
        x: tx, y: ty,
        hidden: true,
        lockRotation: true,
        locked: true,
        rotation: 0,
        disposition: -2,
        light: lightConfig,
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isCampfireToken: true,
                campfireLinkId: linkId,
                isCampFurniture: true,
                campSessionId: sessionId,
                furnitureKey: "campfireFlame",
                propKey: "campfire"
            }
        }
    };

    await scene.createEmbeddedDocuments("Token", [baseData, flameData]);

    Logger.log(`${MODULE_ID} | CompoundCampPlacer: placed campfire at (${cx}, ${cy}), session: ${sessionId}`);
    ui.notifications.info(game.i18n.localize("ionrift-respite.campPlacer.campfirePlacedOnScene"));

    return { sessionId, center: { x: cx, y: cy } };
}

/**
 * Place one shared camp station token. GM only. One token per station key per session.
 *
 * @param {number} worldX
 * @param {number} worldY
 * @param {string} stationKey - FURNITURE key (weaponRack, table, medicalBed, cookingArea)
 * @returns {Promise<boolean>}
 */
export async function placeStation(worldX, worldY, stationKey) {
    if (!game.user.isGM) return false;

    hydrateCampSessionFromScene();

    const rawDef = FURNITURE[stationKey];
    if (!rawDef) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacer.unknownCampStation"));
        return false;
    }

    if (isStationDeployed(stationKey)) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacer.stationAlreadyPlaced"));
        return false;
    }

    const scene = canvas.scene;
    if (!scene) return false;

    const def = stationKey === "cookingArea"
        ? { ...rawDef, name: partyHasCookingUtensils() ? rawDef.name : (rawDef.basicName ?? rawDef.name) }
        : rawDef;

    const w = def.width ?? 1;
    const h = def.height ?? 1;
    const v = validateStationEquipmentDrop(worldX, worldY, stationKey);
    if (!v.ok) {
        ui.notifications.warn(v.reason);
        return false;
    }
    const { tx, ty } = v;

    const tokenData = buildFurnitureToken(stationKey, tx, ty, def, {
        isSharedStation: true
    });

    await scene.createEmbeddedDocuments("Token", [tokenData]);
    Logger.log(`${MODULE_ID} | CompoundCampPlacer: placed station ${stationKey} at (${tx}, ${ty})`);
    return true;
}

/**
 * Remove the shared camp station token for this furniture key (one per scene session).
 *
 * @param {string} stationKey - weaponRack | table | medicalBed | cookingArea
 * @returns {Promise<number>} number of tokens removed (0 or 1)
 */
export async function clearSharedCampStation(stationKey) {
    if (!game.user.isGM) return 0;
    const allowed = [...CAMP_STATION_PLACEMENT_KEYS, "sharedBedroll"];
    if (!allowed.includes(stationKey)) return 0;

    const scene = canvas.scene;
    if (!scene) return 0;

    const matches = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        return flags?.isCampFurniture && flags?.isSharedStation && flags?.furnitureKey === stationKey;
    });
    if (!matches.length) return 0;

    await scene.deleteEmbeddedDocuments("Token", matches.map(t => t.id));
    Logger.log(`${MODULE_ID} | CompoundCampPlacer: cleared station ${stationKey} (${matches.length} token(s))`);
    return matches.length;
}

/**
 * Place a player gear token (bedroll, tent, or mess kit) at a world position.
 * Mess kit uses a half-grid token. Marks the source item with a deployed flag.
 *
 * GM only (players route through socket).
 *
 * @param {number} worldX - Canvas world X
 * @param {number} worldY - Canvas world Y
 * @param {string} gearType - "bedroll" | "tent" | "messkit"
 * @param {string} actorId - Actor who owns the gear
 * @returns {Promise<boolean>} true if placed successfully
 */
export async function placePlayerGear(worldX, worldY, gearType, actorId) {
    if (!game.user.isGM) return false;

    const scene = canvas.scene;
    if (!scene) return false;

    const def = PLAYER_GEAR[gearType];
    if (!def) return false;

    const actor = game.actors.get(actorId);
    if (!actor) return false;

    if (isGearDeployed(actorId, gearType)) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.campPlacer.gearAlreadyPlaced"));
        return false;
    }

    const w = def.width ?? 1;
    const h = def.height ?? 1;
    const v = validatePlayerGearDrop(worldX, worldY, gearType);
    if (!v.ok) {
        ui.notifications.warn(v.reason);
        return false;
    }
    const { tx, ty } = v;

    const tokenData = buildFurnitureToken(gearType, tx, ty, {
        name: `${actor.name}'s ${def.name}`,
        width: w,
        height: h
    }, {
        ownerActorId: actorId,
        isPlayerGear: true
    });

    await scene.createEmbeddedDocuments("Token", [tokenData]);

    const item = findPlayerGearItem(actor, gearType);
    if (item) {
        await item.setFlag(MODULE_ID, "deployedInCamp", true);
    }

    Logger.log(`${MODULE_ID} | CompoundCampPlacer: placed ${gearType} for ${actor.name} at (${tx}, ${ty})`);
    return true;
}

/**
 * Remove one player gear type (tent, bedroll, or mess kit) for an actor.
 * Does not remove shared stations or the pit.
 *
 * @param {string} actorId
 * @param {string} gearType - "bedroll" | "tent" | "messkit"
 * @param {string|null} [sceneId] - scene the player saw when requesting pickup (GM may be on another tab)
 * @returns {Promise<number>} Count of removed tokens (0 or 1)
 */
export async function clearPlayerCampGearType(actorId, gearType, sceneId = null) {
    if (!game.user.isGM) return 0;

    const scene = resolveSceneForCampOp(sceneId);
    if (!scene || !actorId) return 0;
    if (gearType !== "bedroll" && gearType !== "tent" && gearType !== "messkit") return 0;

    const mine = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        return flags?.isCampFurniture &&
            flags?.isPlayerGear &&
            flags?.ownerActorId === actorId &&
            flags?.furnitureKey === gearType;
    });

    if (!mine.length) return 0;

    const actor = game.actors.get(actorId);
    if (actor) {
        const item = findPlayerGearItem(actor, gearType);
        if (item) {
            try { await item.unsetFlag(MODULE_ID, "deployedInCamp"); } catch { /* ignore */ }
        }
    }

    await scene.deleteEmbeddedDocuments("Token", mine.map(t => t.id));
    Logger.log(`${MODULE_ID} | CompoundCampPlacer: cleared ${mine.length} ${gearType} token(s) for actor ${actorId}`);
    return mine.length;
}

/**
 * Remove all camp-related tokens from the active scene: Respite furniture
 * (pit, stations, deployed gear), Camp Prop perimeter torches, and console-placed
 * campfire pairs (isCampfireBase / isCampfireToken without isCampFurniture).
 *
 * Furniture matches the current campSessionId when set; otherwise all flagged
 * furniture. Prop-placed pit and torches always match.
 *
 * @param {string|null} [sceneId] - Scene where the camp was placed (falls back to stored camp scene)
 * @returns {Promise<number>} Count of removed tokens
 */
export async function clearCampTokens(sceneId = null) {
    if (!game.user.isGM) return 0;
    if (_clearCampTokensPromise) return _clearCampTokensPromise;

    _clearCampTokensPromise = clearCampTokensImpl(sceneId).finally(() => {
        _clearCampTokensPromise = null;
    });
    return _clearCampTokensPromise;
}

/**
 * @param {string|null} sceneId
 * @returns {Promise<number>}
 */
async function clearCampTokensImpl(sceneId = null) {
    hydrateCampSessionFromScene();
    const sessionId = _campSessionId;
    const preferredSceneId = sceneId ?? _campSceneId ?? null;

    const scenesToClear = new Set();
    const preferred = resolveSceneForCampOp(preferredSceneId);
    if (preferred) scenesToClear.add(preferred);

    for (const scene of game.scenes ?? []) {
        const hasCamp = scene.tokens.some(t => tokenMatchesCampCleanup(t, sessionId));
        if (hasCamp) scenesToClear.add(scene);
    }

    if (!scenesToClear.size && canvas?.scene) {
        scenesToClear.add(canvas.scene);
    }

    let total = 0;
    for (const scene of scenesToClear) {
        total += await clearCampTokensOnScene(scene, sessionId);
    }

    _campSessionId = null;
    _campSceneId = null;
    return total;
}

/**
 * Remove the campfire pit, flame, and station layout for the current session.
 * Keeps player gear (bedroll, tent, mess kit) on the scene.
 * @returns {Promise<number>}
 */
export async function clearCampfireSite() {
    if (!game.user.isGM) return 0;

    hydrateCampSessionFromScene();
    const scene = resolveSceneForCampOp(_campSceneId) ?? canvas?.scene;
    if (!scene) return 0;

    const sessionId = _campSessionId;

    const isFireToken = (flags) => flags.furnitureKey === "campfire"
        || flags.furnitureKey === "campfireFlame"
        || flags.isCampfireBase
        || flags.isCampfireToken;
    const fireSessions = new Set();
    if (sessionId) fireSessions.add(sessionId);
    for (const token of scene.tokens) {
        const flags = token.flags?.[MODULE_ID];
        if (!flags?.isCampFurniture || flags.isPlayerGear) continue;
        if (isFireToken(flags) && flags.campSessionId) fireSessions.add(flags.campSessionId);
    }

    const toRemove = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        if (!flags?.isCampFurniture || flags.isPlayerGear) return false;
        if (isFireToken(flags)) return true;
        if (flags.campSessionId && fireSessions.has(flags.campSessionId)) {
            return !!flags.isPlaceholder || !!flags.isSharedStation || !!flags.targetStationKey;
        }
        if (sessionId) return false;
        return !!flags.isPlaceholder || !!flags.isSharedStation || !!flags.targetStationKey;
    });

    if (!toRemove.length) {
        _campSessionId = null;
        return 0;
    }

    const removed = await deleteSceneTokensIfPresent(
        scene,
        toRemove.map(t => t.id),
        { ionriftAllowCampDelete: true }
    );
    _campSessionId = null;
    if (removed > 0) {
        Logger.log(`${MODULE_ID} | clearCampfireSite: removed ${removed} layout token(s)`);
    }
    return removed;
}

/**
 * Check whether the campfire pit has been placed in the current session.
 * @returns {boolean}
 */
export function hasCampfirePlaced() {
    const scene = canvas?.scene;
    if (!scene) return false;
    const placed = scene.tokens.some(t => {
        const f = t.flags?.[MODULE_ID];
        return f?.isCampFurniture && f?.furnitureKey === "campfire";
    });
    if (placed) hydrateCampSessionFromScene();
    return placed;
}

/**
 * Check whether a compound camp has been placed in the current session.
 * Same as {@link hasCampfirePlaced} (campfire pit marks the session).
 * @returns {boolean}
 */
export function hasCampPlaced() {
    return hasCampfirePlaced();
}

/**
 * Whether a shared station token for this key exists on the scene for the current session.
 * @param {string} stationKey - FURNITURE key
 * @returns {boolean}
 */
export function isStationDeployed(stationKey) {
    const scene = canvas?.scene;
    if (!scene || !stationKey) return false;
    const pit = getPitTokenOnScene();
    const sid = pit?.flags?.[MODULE_ID]?.campSessionId ?? _campSessionId;
    return scene.tokens.some(t => {
        const flags = t.flags?.[MODULE_ID];
        if (!flags?.isCampFurniture) return false;
        if (flags.furnitureKey === stationKey) {
            if (sid) return flags.campSessionId === sid;
            return true;
        }
        if (flags.isPlaceholder && flags.targetStationKey === stationKey) {
            if (sid) return flags.campSessionId === sid;
            return true;
        }
        return false;
    });
}

/**
 * Check whether a specific actor's gear is deployed on the scene.
 * @param {string} actorId
 * @param {string} gearType - "bedroll" | "tent" | "messkit"
 * @returns {boolean}
 */
export function isGearDeployed(actorId, gearType) {
    const scene = canvas?.scene;
    if (!scene) return false;
    return scene.tokens.some(t => {
        const flags = t.flags?.[MODULE_ID];
        return flags?.isCampFurniture &&
               flags?.isPlayerGear &&
               flags?.ownerActorId === actorId &&
               flags?.furnitureKey === gearType;
    });
}

/**
 * Reset the camp session ID. Called when a new rest begins.
 */
export function resetCampSession() {
    _campSessionId = null;
    _campSceneId = null;
}

export {
    relocateCampfireSite,
    clearPlayerCampGear,
    getCampStationLayoutOffsets,
    autoPlaceStations,
    getStationPlaceholderPreviewsForPitCenter,
    placeStationPlaceholders,
    promoteAllPlaceholders,
    getTargetSortForModuleCampFlags,
    isCampFloorStackToken,
    applyCampFloorSortToPreCreateData,
    clampCampFloorTokenInPreUpdate,
    enforceCampFloorFurnitureSortOnSceneIfGm,
    registerCampFurnitureZOrderGuards
} from "./CampStationPlaceholdersAndZOrder.js";
