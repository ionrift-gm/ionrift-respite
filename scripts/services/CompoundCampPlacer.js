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

import { getPartyActors } from "./partyActors.js";
import { PLACEHOLDER_CAMP_STATION } from "../apps/RestConstants.js";

const MODULE_ID = "ionrift-respite";

/** Draft campsite art under world Data (replace with shipped module assets later). */
const DRAFT_CAMPSITE_TOKENS = "ionrift-brand/Assets/Drafts/campsite_tokens";

/** Shared camp furniture (not the campfire pit). Keys match CAMP_STATIONS furnitureKey. */
const FURNITURE = {
    table:       { name: "Arcane Workbench", width: 1, height: 1, icon: "ionrift-brand/Assets/Approved/campsite_tokens/arcane_workbench.png", fallback: "icons/svg/barrel.svg", textureScale: 1.6 },
    medicalBed:  { name: "Medical Bedding",  width: 1, height: 1, icon: `${DRAFT_CAMPSITE_TOKENS}/triage_bed.png`,     fallback: "icons/svg/sleep.svg", textureScale: 1.6 },
    weaponRack:  { name: "Weapon Rack",      width: 1, height: 1, icon: `${DRAFT_CAMPSITE_TOKENS}/weapons_rack.png`,   fallback: "icons/svg/sword.svg", textureScale: 1.6 },
    cookingArea: {
        name: "Cooking Station",
        basicName: "Mess table",
        width: 1, height: 1,
        icon: `${DRAFT_CAMPSITE_TOKENS}/cooking_station.png`,
        fallback: "icons/tools/cooking/cauldron.webp"
    }
};

/** Furniture keys that can be placed from the Camp Stations panel (order = UI order). */
export const CAMP_STATION_PLACEMENT_KEYS = ["weaponRack", "table", "medicalBed", "cookingArea"];

/** Code-only feature flag: auto-place stations when entering step 2. */
const AUTO_PLACE_STATIONS = true;

const PLAYER_GEAR = {
    bedroll: { name: "Bedroll",  icon: `${DRAFT_CAMPSITE_TOKENS}/bedroll.png`, fallback: "icons/svg/sleep.svg",  width: 1,   height: 1 },
    tent:    { name: "Tent",     icon: `${DRAFT_CAMPSITE_TOKENS}/tent_a.png`,         fallback: "icons/svg/house.svg",  width: 2,   height: 2 },
    /** Small map token: dining gear (half-grid footprint). */
    messkit: {
        name:     "Mess Kit",
        icon:     `${DRAFT_CAMPSITE_TOKENS}/messkit_c.png`,
        fallback: "icons/tools/cooking/cutlery-steel.webp",
        width:    0.5,
        height:   0.5
    }
};

/**
 * @param {Actor} actor
 * @param {string} gearType
 * @returns {Item|undefined}
 */
function findPlayerGearItem(actor, gearType) {
    const items = actor.items ?? [];
    for (const item of items) {
        const n = item.name?.toLowerCase() ?? "";
        if (gearType === "bedroll" && n.includes("bedroll")) return item;
        if (gearType === "tent" && n.includes("tent")) return item;
        if (gearType === "messkit" && (n.includes("mess kit") || (n.includes("cook") && n.includes("utensil")))) {
            return item;
        }
    }
    return undefined;
}

let _campSessionId = null;

/**
 * Pit token (logs) for the current respite camp on the active scene.
 * @returns {TokenDocument|null}
 */
function getPitTokenOnScene() {
    const scene = canvas?.scene;
    if (!scene) return null;
    return scene.tokens.find(t => {
        const f = t.flags?.[MODULE_ID];
        return f?.isCampFurniture && f?.furnitureKey === "campfire";
    }) ?? null;
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
    return sid;
}

function gridSize() {
    return canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
}

/**
 * @param {string|null|undefined} sceneId - from requesting client (socket); optional
 */
function resolveSceneForCampOp(sceneId) {
    if (sceneId && game.scenes?.get) {
        const s = game.scenes.get(sceneId);
        if (s) return s;
    }
    return canvas?.scene ?? null;
}

/** Same notion as station reach: N grid units from pit center (uses scene grid distance). */
export const CAMP_PLACEMENT_RANGE_SQUARES = 3;

function pitCenterWorld() {
    const pit = getPitTokenOnScene();
    if (!pit) return null;
    const gs = gridSize();
    const placeable = canvas.tokens?.get(pit.id);
    if (placeable?.center) return { x: placeable.center.x, y: placeable.center.y };
    return {
        x: pit.x + (pit.width * gs) / 2,
        y: pit.y + (pit.height * gs) / 2
    };
}

function snappedCenterWorld(worldX, worldY) {
    if (!canvas?.grid) return { sx: worldX, sy: worldY };
    const snapped = canvas.grid.getSnappedPoint({ x: worldX, y: worldY }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
    return { sx: snapped.x ?? worldX, sy: snapped.y ?? worldY };
}

function sceneGridDistanceFeet() {
    return canvas?.scene?.grid?.distance ?? canvas?.grid?.distance ?? 5;
}

/**
 * World-space distance in scene units (feet for typical 5e scenes). Replaces deprecated
 * {@link BaseGrid#measureDistance} / {@link canvas.grid.measureDistance} (Foundry 12+).
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function measureWorldDistanceFeet(a, b) {
    const g = canvas?.grid;
    if (!g || !a || !b) return 0;
    if (typeof g.measurePath === "function") {
        return g.measurePath([a, b], { gridSpaces: false }).distance;
    }
    return g.measureDistance(a, b);
}

function tokenFootprintRect(doc, gs) {
    return {
        left: doc.x,
        top: doc.y,
        right: doc.x + doc.width * gs,
        bottom: doc.y + doc.height * gs
    };
}

function rectsOverlap2D(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}

/**
 * @param {number} tx - top-left world px
 * @param {number} ty
 * @param {number} gridW
 * @param {number} gridH
 * @param {*} scene
 * @returns {boolean}
 */
function placementOverlapsAnyToken(tx, ty, gridW, gridH, scene, excludeId = null) {
    const gs = gridSize();
    const next = {
        left: tx,
        top: ty,
        right: tx + gridW * gs,
        bottom: ty + gridH * gs
    };
    for (const doc of scene.tokens) {
        if (excludeId && doc.id === excludeId) continue;
        const other = tokenFootprintRect(doc, gs);
        if (rectsOverlap2D(next, other)) return true;
    }
    return false;
}

/**
 * Validate camp gear or shared station drop (range + overlap). Uses same snap as placement.
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} gridW
 * @param {number} gridH
 * @param {{ x: number, y: number }|null} [pitCenterOverride] - When set (e.g. pit preview), use instead of the scene pit token
 * @param {string|null} [excludeTokenId] - Skip overlap with this document (e.g. in-place promote)
 * @returns {{ ok: boolean, reason?: string, tx?: number, ty?: number, sx?: number, sy?: number }}
 */
export function validateCampEquipmentDrop(worldX, worldY, gridW, gridH, pitCenterOverride = null, excludeTokenId = null) {
    const scene = canvas?.scene;
    if (!scene || !canvas?.grid) return { ok: false, reason: "No active scene." };

    hydrateCampSessionFromScene();
    const pitCenter = pitCenterOverride ?? pitCenterWorld();
    if (!pitCenter) {
        return { ok: false, reason: "Place the campfire on the map first." };
    }

    const { sx, sy } = snappedCenterWorld(worldX, worldY);
    const dist = measureWorldDistanceFeet(pitCenter, { x: sx, y: sy });
    const maxDist = CAMP_PLACEMENT_RANGE_SQUARES * sceneGridDistanceFeet();
    if (dist > maxDist + 0.01) {
        return {
            ok: false,
            reason: `Camp equipment must be within ${CAMP_PLACEMENT_RANGE_SQUARES} squares of the campfire.`
        };
    }

    const gs = gridSize();
    const tx = sx - (gs * gridW) / 2;
    const ty = sy - (gs * gridH) / 2;

    if (placementOverlapsAnyToken(tx, ty, gridW, gridH, scene, excludeTokenId)) {
        return { ok: false, reason: "That spot overlaps another token." };
    }

    return { ok: true, tx, ty, sx, sy };
}

/**
 * @param {number} worldX
 * @param {number} worldY
 * @param {string} gearType
 * @returns {{ ok: boolean, reason?: string, tx?: number, ty?: number }}
 */
export function validatePlayerGearDrop(worldX, worldY, gearType) {
    const def = PLAYER_GEAR[gearType];
    if (!def) return { ok: false, reason: "Unknown gear type." };
    return validateCampEquipmentDrop(worldX, worldY, def.width ?? 1, def.height ?? 1);
}

/**
 * @param {number} worldX
 * @param {number} worldY
 * @param {string} stationKey
 * @param {{ x: number, y: number }|null} [pitCenterOverride]
 * @returns {{ ok: boolean, reason?: string, tx?: number, ty?: number, sx?: number, sy?: number }}
 */
export function validateStationEquipmentDrop(worldX, worldY, stationKey, pitCenterOverride = null) {
    const def = FURNITURE[stationKey];
    if (!def) return { ok: false, reason: "Unknown station." };
    return validateCampEquipmentDrop(worldX, worldY, def.width ?? 1, def.height ?? 1, pitCenterOverride);
}

function getCampSessionId() {
    if (!_campSessionId) _campSessionId = foundry.utils.randomID(8);
    return _campSessionId;
}

/**
 * Resolve an icon path, falling back if the primary does not exist.
 * Foundry built-in icons should always be present, but this guards
 * against version differences.
 * @param {string} primary
 * @param {string} fallback
 * @returns {string}
 */
function resolveIcon(primary, fallback) {
    return primary || fallback;
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
function buildFurnitureToken(key, x, y, def, extraFlags = {}) {
    const w = def.width ?? 1;
    const h = def.height ?? 1;
    const texScale = def.textureScale ?? 1;
    const data = {
        name: def.name,
        texture: {
            src: resolveIcon(def.icon, def.fallback),
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
const CAMPFIRE_BASE_PIT = `modules/${MODULE_ID}/assets/tokens/campfire_dead_a.png`;
const CAMPFIRE_BASES = [CAMPFIRE_BASE_PIT];
const CAMPFIRE_FLAME = `modules/${MODULE_ID}/assets/tokens/campfire_topdown_128x128.webm`;

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
    return CAMPFIRE_BASES[Math.floor(Math.random() * CAMPFIRE_BASES.length)];
}

/**
 * Picks the pit log texture for one placement. Use the same value for
 * live preview and {@link placeCampfire} so the token matches the ghost.
 * @returns {string}
 */
export function pickCampfirePitBaseTexture() {
    return randomCampfireBase();
}

function findCampfireActor() {
    const name = game.settings.get(MODULE_ID, "campfireTokenName")?.toLowerCase() ?? "campfire";
    return game.actors?.find(a => a.name?.toLowerCase() === name) ?? null;
}

/**
 * True if any party member has cook's utensils (unlocks full cooking; not the mess kit).
 * @returns {boolean}
 */
export function partyHasCookingUtensils() {
    for (const a of getPartyActors()) {
        if (canPlaceStation(a, "cookingArea")) return true;
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
    if (stationKey === "weaponRack" || stationKey === "table" || stationKey === "medicalBed") return true;
    if (stationKey === "cookingArea") {
        return (actor.items ?? []).some(i => {
            const n = i.name?.toLowerCase() ?? "";
            if (n.includes("mess kit")) return false;
            return n.includes("cook's utensils") || n.includes("cooks utensils")
                || n.includes("cooking utensils");
        });
    }
    return false;
}

/**
 * Human-readable requirement line when {@link canPlaceStation} is false.
 * @param {string} stationKey
 * @returns {string}
 */
export function stationPlacementRequirementHint(stationKey) {
    if (stationKey === "cookingArea") {
        return "Cook's utensils or cooking utensils in inventory.";
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
        ui.notifications.warn("Only the GM can place the campfire.");
        return null;
    }

    const scene = canvas.scene;
    if (!scene) return null;

    const gs = gridSize();
    const snapped = canvas.grid.getSnappedPoint({ x: worldX, y: worldY }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
    const cx = snapped.x ?? worldX;
    const cy = snapped.y ?? worldY;

    const sessionId = getCampSessionId();
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
        hidden: false,
        lockRotation: true,
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
                furnitureKey: "campfire"
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
                furnitureKey: "campfireFlame"
            }
        }
    };

    await scene.createEmbeddedDocuments("Token", [baseData, flameData]);

    console.log(`${MODULE_ID} | CompoundCampPlacer: placed campfire at (${cx}, ${cy}), session: ${sessionId}`);
    ui.notifications.info("Campfire placed on scene.");

    return { sessionId, center: { x: cx, y: cy } };
}

/**
 * Backward-compatible alias: places only the campfire pit (no furniture ring).
 * @param {number} worldX
 * @param {number} worldY
 * @returns {Promise<{sessionId: string, center: {x: number, y: number}}|null>}
 */
export async function placeCompoundCamp(worldX, worldY) {
    return placeCampfire(worldX, worldY);
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
        ui.notifications.warn("Unknown camp station.");
        return false;
    }

    if (isStationDeployed(stationKey)) {
        ui.notifications.warn("That station is already on the map.");
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
    console.log(`${MODULE_ID} | CompoundCampPlacer: placed station ${stationKey} at (${tx}, ${ty})`);
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
    if (!CAMP_STATION_PLACEMENT_KEYS.includes(stationKey)) return 0;

    const scene = canvas.scene;
    if (!scene) return 0;

    const matches = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        return flags?.isCampFurniture && flags?.isSharedStation && flags?.furnitureKey === stationKey;
    });
    if (!matches.length) return 0;

    await scene.deleteEmbeddedDocuments("Token", matches.map(t => t.id));
    console.log(`${MODULE_ID} | CompoundCampPlacer: cleared station ${stationKey} (${matches.length} token(s))`);
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
        ui.notifications.warn("That gear is already on the map.");
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
        icon: def.icon,
        fallback: def.fallback,
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

    console.log(`${MODULE_ID} | CompoundCampPlacer: placed ${gearType} for ${actor.name} at (${tx}, ${ty})`);
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
    console.log(`${MODULE_ID} | CompoundCampPlacer: cleared ${mine.length} ${gearType} token(s) for actor ${actorId}`);
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
 * @returns {Promise<number>} Count of removed tokens
 */
export async function clearCampTokens() {
    if (!game.user.isGM) return 0;

    const scene = canvas.scene;
    if (!scene) return 0;

    hydrateCampSessionFromScene();
    const sessionId = _campSessionId;
    const campTokens = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        if (!flags) return false;
        if (flags.isTorchStake || flags.isPerimeterTorch) return true;
        if (flags.isCampFurniture) {
            if (sessionId) return flags.campSessionId === sessionId;
            return true;
        }
        if (flags.isCampfireBase || flags.isCampfireToken) return true;
        return false;
    });

    if (!campTokens.length) {
        _campSessionId = null;
        return 0;
    }

    // Unflag deployed items before removing tokens
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

    const ids = campTokens.map(t => t.id);
    await scene.deleteEmbeddedDocuments("Token", ids);

    console.log(`${MODULE_ID} | CompoundCampPlacer: cleared ${ids.length} camp tokens`);
    _campSessionId = null;

    return ids.length;
}

/**
 * Remove only player-placed camp gear (tent, bedroll, mess kit) for one actor.
 * Does not remove compound layout or shared furniture. Does not reset session id.
 *
 * @param {string} actorId
 * @param {string|null} [sceneId] - scene the player saw when requesting clear (optional)
 * @returns {Promise<number>} Count of removed tokens
 */
export async function clearPlayerCampGear(actorId, sceneId = null) {
    if (!game.user.isGM) return 0;

    const scene = resolveSceneForCampOp(sceneId);
    if (!scene || !actorId) return 0;

    const mine = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        return flags?.isCampFurniture &&
            flags?.isPlayerGear &&
            flags?.ownerActorId === actorId;
    });

    if (!mine.length) return 0;

    for (const t of mine) {
        const flags = t.flags?.[MODULE_ID];
        if (flags?.ownerActorId) {
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

    await scene.deleteEmbeddedDocuments("Token", mine.map(t => t.id));
    console.log(`${MODULE_ID} | CompoundCampPlacer: cleared ${mine.length} player gear token(s) for actor ${actorId}`);
    return mine.length;
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
}

/**
 * Auto-place eligible camp stations around the campfire when entering step 2.
 * Controlled by AUTO_PLACE_STATIONS flag.
 *
 * Layout (2 squares from campfire center):
 *   - table (Workbench): west
 *   - weaponRack: east
 *   - cookingArea: north (token name reflects party cook's utensils or mess table)
 *   - medicalBed: south
 *
 * @returns {Promise<string[]>} keys of stations placed
 */
export async function autoPlaceStations() {
    if (!AUTO_PLACE_STATIONS) {
        console.log(`${MODULE_ID} | autoPlaceStations: feature flag disabled`);
        return [];
    }
    if (!game.user.isGM) return [];

    hydrateCampSessionFromScene();
    const center = pitCenterWorld();
    if (!center) {
        console.log(`${MODULE_ID} | autoPlaceStations: no campfire center found`);
        return [];
    }

    const scene = canvas?.scene;
    if (!scene) return [];

    const gs = gridSize();
    const offset = 2 * gs;

    const partyActors = getPartyActors();

    const layout = [
        { key: "table",       dx: -offset, dy: 0 },
        { key: "weaponRack",  dx:  offset, dy: 0 },
        { key: "cookingArea", dx: 0,       dy: -offset },
        { key: "medicalBed",  dx: 0,       dy:  offset }
    ];

    const placed = [];
    for (const slot of layout) {
        if (slot.condition === false) continue;
        if (isStationDeployed(slot.key)) continue;

        const rawDef = FURNITURE[slot.key];
        if (!rawDef) continue;

        const def = slot.key === "cookingArea"
            ? { ...rawDef, name: partyHasCookingUtensils() ? rawDef.name : (rawDef.basicName ?? rawDef.name) }
            : rawDef;

        const worldX = center.x + slot.dx;
        const worldY = center.y + slot.dy;

        const v = validateStationEquipmentDrop(worldX, worldY, slot.key);
        if (!v.ok) {
            console.log(`${MODULE_ID} | autoPlaceStations: skipping ${slot.key}, validation failed: ${v.reason}`);
            continue;
        }

        const tokenData = buildFurnitureToken(slot.key, v.tx, v.ty, def, {
            isSharedStation: true
        });
        await scene.createEmbeddedDocuments("Token", [tokenData]);
        placed.push(slot.key);
    }

    console.log(`${MODULE_ID} | autoPlaceStations: placed ${placed.length}/${layout.length} stations: [${placed.join(", ")}]`);
    return placed;
}

/**
 * Build token data for a reserved station spot (supplies pile) before the fire is lit.
 * @param {string} targetKey - FURNITURE key (table, weaponRack, etc.)
 * @param {number} x - top-left
 * @param {number} y
 * @returns {Object}
 */
function buildPlaceholderToken(targetKey, x, y) {
    const def = PLACEHOLDER_CAMP_STATION;
    return {
        name: `${def.name} (${targetKey})`,
        texture: { src: def.path, scaleX: 1, scaleY: 1 },
        width: def.width ?? 1,
        height: def.height ?? 1,
        sort: CAMP_FLOOR_FURNITURE_SORT,
        x,
        y,
        hidden: false,
        lockRotation: true,
        rotation: Math.floor(Math.random() * 12) - 6,
        disposition: -2,
        light: { bright: 0, dim: 0 },
        sight: { enabled: false },
        locked: true,
        flags: {
            [MODULE_ID]: {
                isCampFurniture: true,
                isPlaceholder: true,
                targetStationKey: targetKey,
                campSessionId: getCampSessionId()
            }
        }
    };
}

/**
 * Build site stub positions for a hypothetical pit center (cursor preview before the pit exists).
 * Same layout and rules as {@link placeStationPlaceholders} with
 * {@link PLACEHOLDER_CAMP_STATION} footprint. `valid: false` uses grid snap so the
 * ghost can still be drawn if range or overlap fails.
 *
 * @param {number} pitCenterX
 * @param {number} pitCenterY
 * @returns {{ key: string, tx: number, ty: number, gridW: number, gridH: number, textureSrc: string, valid: boolean }[]}
 */
export function getStationPlaceholderPreviewsForPitCenter(pitCenterX, pitCenterY) {
    if (!canvas?.scene || !canvas?.grid) return [];

    const gs = gridSize();
    const offset = 2 * gs;
    const pitCenter = { x: pitCenterX, y: pitCenterY };
    const layout = [
        { key: "table",       dx: -offset, dy: 0 },
        { key: "weaponRack",  dx:  offset, dy: 0 },
        { key: "cookingArea", dx: 0,       dy: -offset },
        { key: "medicalBed",  dx: 0,       dy:  offset }
    ];
    const gridW = PLACEHOLDER_CAMP_STATION.width ?? 1;
    const gridH = PLACEHOLDER_CAMP_STATION.height ?? 1;
    const textureSrc = PLACEHOLDER_CAMP_STATION.path;
    const out = [];
    for (const slot of layout) {
        if (slot.condition === false) continue;
        if (isStationDeployed(slot.key)) continue;
        if (!FURNITURE[slot.key]) continue;
        const worldX = pitCenterX + slot.dx;
        const worldY = pitCenterY + slot.dy;
        const v = validateCampEquipmentDrop(worldX, worldY, gridW, gridH, pitCenter);
        if (v.ok) {
            out.push({ key: slot.key, tx: v.tx, ty: v.ty, gridW, gridH, textureSrc, valid: true });
            continue;
        }
        const { sx, sy } = snappedCenterWorld(worldX, worldY);
        const tx = sx - (gs * gridW) / 2;
        const ty = sy - (gs * gridH) / 2;
        out.push({ key: slot.key, tx, ty, gridW, gridH, textureSrc, valid: false });
    }
    return out;
}

/**
 * After the pit is placed, drop placeholder tokens at the same auto-layout
 * used by autoPlaceStations. GM only.
 * @returns {Promise<string[]>} target keys for which a placeholder was created
 */
export async function placeStationPlaceholders() {
    if (!game.user.isGM) return [];
    hydrateCampSessionFromScene();
    const center = pitCenterWorld();
    if (!center) {
        console.log(`${MODULE_ID} | placeStationPlaceholders: no pit center`);
        return [];
    }

    const scene = canvas?.scene;
    if (!scene) return [];

    const gs = gridSize();
    const offset = 2 * gs;
    const layout = [
        { key: "table",       dx: -offset, dy: 0 },
        { key: "weaponRack",  dx:  offset, dy: 0 },
        { key: "cookingArea", dx: 0,       dy: -offset },
        { key: "medicalBed",  dx: 0,       dy:  offset }
    ];
    const phW = PLACEHOLDER_CAMP_STATION.width ?? 1;
    const phH = PLACEHOLDER_CAMP_STATION.height ?? 1;

    const placed = [];
    for (const slot of layout) {
        if (slot.condition === false) continue;
        if (isStationDeployed(slot.key)) continue;

        if (!FURNITURE[slot.key]) continue;

        const worldX = center.x + slot.dx;
        const worldY = center.y + slot.dy;
        const v = validateCampEquipmentDrop(worldX, worldY, phW, phH);
        if (!v.ok) {
            console.log(`${MODULE_ID} | placeStationPlaceholders: skip ${slot.key} (${v.reason})`);
            continue;
        }
        const tokenData = buildPlaceholderToken(slot.key, v.tx, v.ty);
        await scene.createEmbeddedDocuments("Token", [tokenData]);
        placed.push(slot.key);
    }
    console.log(`${MODULE_ID} | placeStationPlaceholders: [${placed.join(", ")}]`);
    return placed;
}

/**
 * After the fire is lit, replace placeholder art with real station tokens (same position).
 * GM only. Batch-updates to reduce token flash.
 * @returns {Promise<string[]>} promoted target keys
 */
export async function promoteAllPlaceholders() {
    if (!game.user.isGM) return [];

    const scene = canvas?.scene;
    if (!scene) return [];

    hydrateCampSessionFromScene();
    const pit = getPitTokenOnScene();
    const sid = pit?.flags?.[MODULE_ID]?.campSessionId ?? _campSessionId;
    if (!sid) return [];

    const toPromote = scene.tokens.filter(t => {
        const f = t.flags?.[MODULE_ID];
        return f?.isCampFurniture && f.isPlaceholder && f.campSessionId === sid && f.targetStationKey;
    });
    if (!toPromote.length) return [];

    const gs = gridSize();
    const updates = [];
    for (const doc of toPromote) {
        const key = doc.flags?.[MODULE_ID]?.targetStationKey;
        const def = FURNITURE[key];
        if (!def) continue;
        const texScale = def.textureScale ?? 1;
        const w = def.width ?? 1;
        const h = def.height ?? 1;
        const prev = doc.flags?.[MODULE_ID] ? foundry.utils.deepClone(doc.flags[MODULE_ID]) : {};
        delete prev.isPlaceholder;
        delete prev.targetStationKey;
        prev.furnitureKey = key;
        prev.isSharedStation = true;
        if (key === "cookingArea") {
            prev.partyHasCookingUtensils = partyHasCookingUtensils();
        }

        const sameFootprint = doc.width === w && doc.height === h;
        const cx = doc.x + (doc.width * gs) / 2;
        const cy = doc.y + (doc.height * gs) / 2;
        const placement = validateCampEquipmentDrop(cx, cy, w, h, null, doc.id);

        const displayName = key === "cookingArea"
            ? (partyHasCookingUtensils() ? def.name : (def.basicName ?? def.name))
            : def.name;

        const u = {
            _id: doc.id,
            name: displayName,
            texture: {
                src: resolveIcon(def.icon, def.fallback),
                scaleX: texScale,
                scaleY: texScale
            },
            sort: CAMP_FLOOR_FURNITURE_SORT,
            flags: { [MODULE_ID]: prev }
        };
        if (!sameFootprint) {
            u.width = w;
            u.height = h;
        }
        if (placement?.ok) {
            u.x = placement.tx;
            u.y = placement.ty;
        }

        updates.push(u);
    }
    if (updates.length) {
        await scene.updateEmbeddedDocuments("Token", updates);
        console.log(`${MODULE_ID} | promoteAllPlaceholders: ${updates.length} token(s) updated`);
    }
    return toPromote.map(t => t.flags?.[MODULE_ID]?.targetStationKey).filter(Boolean);
}

/**
 * @param {object|undefined} f - `flags[MODULE_ID]` (or data.flags fragment)
 * @returns {number|null} Target `sort` for z-order guards, or null if not Respite-controlled.
 */
export function getTargetSortForModuleCampFlags(f) {
    if (!f) return null;
    if (f.isCampfireBase) return CAMPFIRE_PIT_SORT;
    if (f.isCampfireToken) return CAMPFIRE_FLAME_FLOOR_SORT;
    if (!f.isCampFurniture) return null;
    if (f.isSharedStation || f.isPlaceholder || f.isPlayerGear) {
        return CAMP_FLOOR_FURNITURE_SORT;
    }
    return null;
}

/**
 * @param {TokenDocument|ClientDocument} document
 * @returns {boolean}
 */
export function isCampFloorStackToken(document) {
    return getTargetSortForModuleCampFlags(document.flags?.[MODULE_ID]) != null;
}

/**
 * @param {object} data - TokenData passed to token creation
 */
export function applyCampFloorSortToPreCreateData(data) {
    const t = getTargetSortForModuleCampFlags(data?.flags?.[MODULE_ID]);
    if (t != null) data.sort = t;
}

/**
 * Keeps Respite camp tokens under normal map tokens when `sort` changes
 * (bring to front, paste, or max-sort for new tokens).
 * @param {TokenDocument|ClientDocument} document
 * @param {object} updateData
 */
export function clampCampFloorTokenInPreUpdate(document, updateData) {
    if (!("sort" in updateData)) return;
    const target = getTargetSortForModuleCampFlags(document.flags?.[MODULE_ID]);
    if (target == null) return;
    updateData.sort = target;
}

/**
 * Batches z-order migration for the viewed scene. GM only.
 * @param {Scene|null} scene
 * @returns {Promise<void>}
 */
export async function enforceCampFloorFurnitureSortOnSceneIfGm(scene) {
    if (!game.user.isGM || !scene?.tokens) return;
    const updates = [];
    for (const t of scene.tokens) {
        const target = getTargetSortForModuleCampFlags(t.flags?.[MODULE_ID]);
        if (target == null) continue;
        if (t.sort !== target) {
            updates.push({ _id: t.id, sort: target });
        }
    }
    if (updates.length) {
        await scene.updateEmbeddedDocuments("Token", updates);
    }
}

/**
 * Binds preCreate and canvasReady. Pair with `clampCampFloorTokenInPreUpdate` on the module `preUpdateToken` hook.
 */
export function registerCampFurnitureZOrderGuards() {
    Hooks.on("preCreateToken", (_doc, data) => {
        try {
            applyCampFloorSortToPreCreateData(data);
        } catch {
            /* ignore */
        }
    });
    Hooks.on("canvasReady", () => {
        try {
            const scene = canvas?.scene;
            if (scene) void enforceCampFloorFurnitureSortOnSceneIfGm(scene);
        } catch {
            /* ignore */
        }
    });
}
