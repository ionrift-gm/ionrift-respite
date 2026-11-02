import { MODULE_ID } from "../../../data/moduleId.js";
import { FURNITURE, PLAYER_GEAR, getPitTokenOnScene, hydrateCampSessionFromScene } from "./CompoundCampPlacer.js";

export function gridSize() {
    return canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
}

/**
 * @param {string|null|undefined} sceneId - from requesting client (socket); optional
 */
export function resolveSceneForCampOp(sceneId) {
    if (sceneId && game.scenes?.get) {
        const s = game.scenes.get(sceneId);
        if (s) return s;
    }
    return canvas?.scene ?? null;
}

/** Same notion as station reach: N grid units from pit center (uses scene grid distance). */
export const CAMP_PLACEMENT_RANGE_SQUARES = 3;

export function pitCenterWorld() {
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

export function snappedCenterWorld(worldX, worldY) {
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
export function placementOverlapsAnyToken(tx, ty, gridW, gridH, scene, excludeId = null) {
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
 * Return all token documents whose footprint overlaps the given placement rect.
 * @param {number} tx - top-left world px
 * @param {number} ty
 * @param {number} gridW
 * @param {number} gridH
 * @param {*} scene
 * @param {string|null} [excludeId]
 * @returns {TokenDocument[]}
 */
export function getBlockingTokens(tx, ty, gridW, gridH, scene, excludeId = null) {
    const gs = gridSize();
    const rect = { left: tx, top: ty, right: tx + gridW * gs, bottom: ty + gridH * gs };
    const blockers = [];
    for (const doc of scene.tokens) {
        if (excludeId && doc.id === excludeId) continue;
        if (rectsOverlap2D(rect, tokenFootprintRect(doc, gs))) blockers.push(doc);
    }
    return blockers;
}

export function isCampFurnitureToken(doc) {
    return !!doc.flags?.[MODULE_ID]?.isCampFurniture;
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
    if (!scene || !canvas?.grid) return { ok: false, reason: game.i18n.localize("ionrift-respite.campPlacer.noActiveScene") };

    hydrateCampSessionFromScene();
    const pitCenter = pitCenterOverride ?? pitCenterWorld();
    if (!pitCenter) {
        return { ok: false, reason: game.i18n.localize("ionrift-respite.campPlacer.placeCampfireFirst") };
    }

    const { sx, sy } = snappedCenterWorld(worldX, worldY);
    const dist = measureWorldDistanceFeet(pitCenter, { x: sx, y: sy });
    const maxDist = CAMP_PLACEMENT_RANGE_SQUARES * sceneGridDistanceFeet();
    if (dist > maxDist + 0.01) {
        return {
            ok: false,
            reason: game.i18n.format("ionrift-respite.campPlacer.outOfRange", { squares: CAMP_PLACEMENT_RANGE_SQUARES })
        };
    }

    const gs = gridSize();
    const tx = sx - (gs * gridW) / 2;
    const ty = sy - (gs * gridH) / 2;

    if (placementOverlapsAnyToken(tx, ty, gridW, gridH, scene, excludeTokenId)) {
        return { ok: false, reason: game.i18n.localize("ionrift-respite.campPlacer.overlapsToken"), tx, ty };
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
    if (!def) return { ok: false, reason: game.i18n.localize("ionrift-respite.campPlacer.unknownGearType") };
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
    if (!def) return { ok: false, reason: game.i18n.localize("ionrift-respite.campPlacer.unknownStation") };
    return validateCampEquipmentDrop(worldX, worldY, def.width ?? 1, def.height ?? 1, pitCenterOverride);
}
