import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { getPartyActors } from "../../party/partyActors.js";
import { isSimpleStationsMode } from "../../rest/flow/RestProfileSettings.js";
import {
    PLACEHOLDER_CAMP_STATION,
    FURNITURE,
    AUTO_PLACE_STATIONS,
    CAMP_FLOOR_FURNITURE_SORT,
    CAMPFIRE_PIT_SORT,
    CAMPFIRE_FLAME_FLOOR_SORT,
    resolveStationIcon,
    findPlayerGearItem,
    getPitTokenOnScene,
    getPitTokenOnSceneDoc,
    pitCenterFromTokenDoc,
    hydrateCampSessionFromScene,
    getCampSceneId,
    getCampSessionIdStored,
    gridSize,
    resolveSceneForCampOp,
    pitCenterWorld,
    snappedCenterWorld,
    placementOverlapsAnyToken,
    getBlockingTokens,
    isCampFurnitureToken,
    validateCampEquipmentDrop,
    validateStationEquipmentDrop,
    getCampSessionId,
    buildFurnitureToken,
    partyHasCookingUtensils,
    isStationDeployed
} from "./CompoundCampPlacer.js";

/**
 * Move the campfire pit, flame, and layout tokens to a new center (stations stay
 * on the standard cardinal offsets from the pit). GM only.
 *
 * @param {number} newCenterX
 * @param {number} newCenterY
 * @param {{ safeRestSpot?: boolean, simpleStations?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function relocateCampfireSite(newCenterX, newCenterY, options = {}) {
    if (!game.user.isGM) return false;

    hydrateCampSessionFromScene();
    const scene = resolveSceneForCampOp(getCampSceneId()) ?? canvas?.scene;
    if (!scene || !canvas?.grid) return false;

    const pit = getPitTokenOnSceneDoc(scene);
    if (!pit) return false;

    const gs = gridSize();
    const oldCenter = pitCenterFromTokenDoc(pit, gs);
    const snapped = canvas.grid.getSnappedPoint(
        { x: newCenterX, y: newCenterY },
        { mode: CONST.GRID_SNAPPING_MODES.CENTER }
    );
    const newCx = snapped?.x ?? newCenterX;
    const newCy = snapped?.y ?? newCenterY;
    const pitCenter = { x: newCx, y: newCy };

    const sid = pit.flags?.[MODULE_ID]?.campSessionId ?? getCampSessionIdStored();
    const flame = scene.tokens.find(t => {
        const f = t.flags?.[MODULE_ID];
        return f?.isCampfireToken && (!sid || f.campSessionId === sid);
    }) ?? null;

    const newTx = newCx - (gs / 2);
    const newTy = newCy - (gs / 2);
    const tokenUpdates = [];

    tokenUpdates.push({ _id: pit.id, x: newTx, y: newTy });
    if (flame) {
        const w = flame.width ?? 1;
        const h = flame.height ?? 1;
        const dx = ((w - 1) * gs) / 2;
        const dy = ((h - 1) * gs) / 2;
        tokenUpdates.push({ _id: flame.id, x: newTx + dx, y: newTy + dy });
    }

    if (tokenUpdates.length) {
        await scene.updateEmbeddedDocuments("Token", tokenUpdates);
    }

    const offset = 2 * gs;
    const layoutSlots = getCampStationLayoutOffsets(offset, !!options.safeRestSpot, {
        simpleStations: options.simpleStations ?? isSimpleStationsMode()
    });
    const slotOffsetByKey = new Map();
    for (const slot of layoutSlots) {
        if (slot.condition === false) continue;
        if (!FURNITURE[slot.key]) continue;
        slotOffsetByKey.set(slot.key, { dx: slot.dx, dy: slot.dy });
    }

    const layoutTokens = scene.tokens.filter(t => {
        const f = t.flags?.[MODULE_ID];
        if (!f?.isCampFurniture || f.isPlayerGear) return false;
        if (f.furnitureKey === "campfire" || f.furnitureKey === "campfireFlame") return false;
        if (sid) return f.campSessionId === sid;
        return !!f.isPlaceholder || !!f.isSharedStation || !!f.targetStationKey;
    });

    const stationUpdates = [];
    for (const doc of layoutTokens) {
        const f = doc.flags?.[MODULE_ID];
        const key = f?.targetStationKey ?? f?.furnitureKey;
        const off = key ? slotOffsetByKey.get(key) : null;
        if (!off) continue;
        const w = doc.width ?? 1;
        const h = doc.height ?? 1;
        const worldX = newCx + off.dx;
        const worldY = newCy + off.dy;
        const v = validateCampEquipmentDrop(worldX, worldY, w, h, pitCenter, doc.id);
        if (v.tx === null || v.ty === null) continue;
        stationUpdates.push({ _id: doc.id, x: v.tx, y: v.ty });
    }

    if (stationUpdates.length) {
        await scene.updateEmbeddedDocuments("Token", stationUpdates);
    }

    Logger.log(`${MODULE_ID} | relocateCampfireSite: (${oldCenter.x}, ${oldCenter.y}) -> (${newCx}, ${newCy}), ${stationUpdates.length} layout token(s)`);
    return true;
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
    Logger.log(`${MODULE_ID} | CompoundCampPlacer: cleared ${mine.length} player gear token(s) for actor ${actorId}`);
    return mine.length;
}

/**
 * Cardinal offsets for auto station placement (2 grid from pit center by default).
 * @param {number} offset - Grid distance from pit center
 * @param {boolean} [safeRestSpot] - Omit medical bed (3 stations only)
 * @param {{ simpleStations?: boolean }} [options]
 * @returns {{ key: string, dx: number, dy: number }[]}
 */
export function getCampStationLayoutOffsets(offset, safeRestSpot = false, options = {}) {
    const simpleStations = options.simpleStations ?? isSimpleStationsMode();
    if (simpleStations) {
        return [
            { key: "table", dx: -offset, dy: 0 },
            { key: "sharedBedroll", dx: offset, dy: 0 }
        ];
    }
    if (safeRestSpot) {
        return [
            { key: "table", dx: -offset, dy: 0 },
            { key: "weaponRack", dx: offset, dy: 0 },
            { key: "cookingArea", dx: 0, dy: -offset }
        ];
    }
    return [
        { key: "table", dx: -offset, dy: 0 },
        { key: "weaponRack", dx: offset, dy: 0 },
        { key: "cookingArea", dx: 0, dy: -offset },
        { key: "medicalBed", dx: 0, dy: offset }
    ];
}

/**
 * Auto-place eligible camp stations around the campfire when entering step 2.
 * Controlled by AUTO_PLACE_STATIONS flag.
 *
 * Layout (2 squares from campfire center):
 *   - table (Workbench): west
 *   - weaponRack: east
 *   - cookingArea: north (token name reflects party cook's utensils or mess table)
 *   - medicalBed: south (omitted when safeRestSpot)
 *
 * @param {boolean} [safeRestSpot]
 * @returns {Promise<string[]>} keys of stations placed
 */
export async function autoPlaceStations(safeRestSpot = false, options = {}) {
    if (!AUTO_PLACE_STATIONS) {
        Logger.log(`${MODULE_ID} | autoPlaceStations: feature flag disabled`);
        return [];
    }
    if (!game.user.isGM) return [];

    hydrateCampSessionFromScene();
    const center = pitCenterWorld();
    if (!center) {
        Logger.log(`${MODULE_ID} | autoPlaceStations: no campfire center found`);
        return [];
    }

    const scene = canvas?.scene;
    if (!scene) return [];

    const gs = gridSize();
    const offset = 2 * gs;

    const partyActors = getPartyActors();

    const layout = getCampStationLayoutOffsets(offset, safeRestSpot, options);

    const placed = [];
    for (const slot of layout) {
        if (slot.condition === false) continue;
        if (isStationDeployed(slot.key)) continue;

        const rawDef = FURNITURE[slot.key];
        if (!rawDef) continue;

        let def = slot.key === "cookingArea"
            ? { ...rawDef, name: partyHasCookingUtensils() ? rawDef.name : (rawDef.basicName ?? rawDef.name) }
            : rawDef;
        if (safeRestSpot && slot.key === "weaponRack") {
            def = { ...def, name: "Supply Table" };
        }

        const worldX = center.x + slot.dx;
        const worldY = center.y + slot.dy;

        const v = validateStationEquipmentDrop(worldX, worldY, slot.key);
        if (!v.ok) {
            Logger.log(`${MODULE_ID} | autoPlaceStations: skipping ${slot.key}, validation failed: ${v.reason}`);
            continue;
        }

        const tokenData = buildFurnitureToken(slot.key, v.tx, v.ty, def, {
            isSharedStation: true
        });
        await scene.createEmbeddedDocuments("Token", [tokenData]);
        placed.push(slot.key);
    }

    Logger.log(`${MODULE_ID} | autoPlaceStations: placed ${placed.length}/${layout.length} stations: [${placed.join(", ")}]`);
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
        texture: { src: resolveStationIcon("buildSite"), scaleX: 1, scaleY: 1 },
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
                propKey: "build-site",
                campSessionId: getCampSessionId()
            }
        }
    };
}

/**
 * Build site stub positions for a hypothetical pit center (pointer preview before the pit exists).
 * Same layout and rules as {@link placeStationPlaceholders} with
 * {@link PLACEHOLDER_CAMP_STATION} footprint. `valid: false` uses grid snap so the
 * ghost can still be drawn if range or overlap fails.
 *
 * @param {number} pitCenterX
 * @param {number} pitCenterY
 * @param {boolean} [safeRestSpot]
 * @returns {{ key: string, tx: number, ty: number, gridW: number, gridH: number, textureSrc: string, valid: boolean }[]}
 */
export function getStationPlaceholderPreviewsForPitCenter(pitCenterX, pitCenterY, safeRestSpot = false, options = {}) {
    if (!canvas?.scene || !canvas?.grid) return [];

    const gs = gridSize();
    const offset = 2 * gs;
    const pitCenter = { x: pitCenterX, y: pitCenterY };
    const layout = getCampStationLayoutOffsets(offset, safeRestSpot, options);
    const gridW = PLACEHOLDER_CAMP_STATION.width ?? 1;
    const gridH = PLACEHOLDER_CAMP_STATION.height ?? 1;
    const textureSrc = resolveStationIcon("buildSite");
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
/**
 * Attempt to move a token to the nearest free grid cell toward the camp center.
 * Used when a station needs to place under an existing (non-furniture) token.
 * Returns true if the token was successfully relocated, false if no free cell was found.
 * @param {TokenDocument} doc
 * @param {{ x: number, y: number }} pitCenter - world-space pit center
 * @param {*} scene
 * @returns {Promise<boolean>}
 */
async function nudgeTokenTowardCenter(doc, pitCenter, scene) {
    const gs = gridSize();
    const w = doc.width ?? 1;
    const h = doc.height ?? 1;
    const cx = doc.x + (w * gs) / 2;
    const cy = doc.y + (h * gs) / 2;

    const dx = pitCenter.x - cx;
    const dy = pitCenter.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const candidates = [];

    if (dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        for (let steps = 1; steps <= 4; steps++) {
            const wx = cx + nx * gs * steps;
            const wy = cy + ny * gs * steps;
            const snapped = canvas.grid.getSnappedPoint(
                { x: wx, y: wy },
                { mode: CONST.GRID_SNAPPING_MODES.CENTER }
            );
            candidates.push({
                x: snapped.x - (w * gs) / 2,
                y: snapped.y - (h * gs) / 2,
                cx: snapped.x,
                cy: snapped.y
            });
        }
    }

    for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const snapped = canvas.grid.getSnappedPoint(
            { x: cx + ox * gs, y: cy + oy * gs },
            { mode: CONST.GRID_SNAPPING_MODES.CENTER }
        );
        candidates.push({
            x: snapped.x - (w * gs) / 2,
            y: snapped.y - (h * gs) / 2,
            cx: snapped.x,
            cy: snapped.y
        });
    }

    const seen = new Set();
    const unique = candidates.filter(c => {
        const key = `${Math.round(c.x)},${Math.round(c.y)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    unique.sort((a, b) =>
        Math.hypot(a.cx - pitCenter.x, a.cy - pitCenter.y) -
        Math.hypot(b.cx - pitCenter.x, b.cy - pitCenter.y)
    );

    for (const cand of unique) {
        if (!placementOverlapsAnyToken(cand.x, cand.y, w, h, scene, doc.id)) {
            await scene.updateEmbeddedDocuments("Token", [{ _id: doc.id, x: cand.x, y: cand.y }]);
            return true;
        }
    }
    return false;
}

export async function placeStationPlaceholders(safeRestSpot = false, options = {}) {
    if (!game.user.isGM) return [];
    hydrateCampSessionFromScene();
    const center = pitCenterWorld();
    if (!center) {
        Logger.log(`${MODULE_ID} | placeStationPlaceholders: no pit center`);
        return [];
    }

    const scene = canvas?.scene;
    if (!scene) return [];

    const gs = gridSize();
    const offset = 2 * gs;
    const layout = getCampStationLayoutOffsets(offset, safeRestSpot, options);
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
            // When only non-furniture tokens (player tokens) are blocking, place the station
            // anyway. Stations sort to -50000, so they render under player tokens. Then try
            // to nudge each blocker toward the camp center; leave them if no free cell exists.
            if (v.tx !== null) {
                const blockers = getBlockingTokens(v.tx, v.ty, phW, phH, scene);
                if (blockers.length && blockers.every(b => !isCampFurnitureToken(b))) {
                    const tokenData = buildPlaceholderToken(slot.key, v.tx, v.ty);
                    await scene.createEmbeddedDocuments("Token", [tokenData]);
                    placed.push(slot.key);
                    for (const blocker of blockers) {
                        const moved = await nudgeTokenTowardCenter(blocker, center, scene);
                        if (!moved) {
                            Logger.log(`${MODULE_ID} | placeStationPlaceholders: could not nudge ${blocker.id} off ${slot.key} slot`);
                        }
                    }
                    continue;
                }
            }
            Logger.log(`${MODULE_ID} | placeStationPlaceholders: skip ${slot.key} (${v.reason})`);
            continue;
        }
        const tokenData = buildPlaceholderToken(slot.key, v.tx, v.ty);
        await scene.createEmbeddedDocuments("Token", [tokenData]);
        placed.push(slot.key);
    }
    Logger.log(`${MODULE_ID} | placeStationPlaceholders: [${placed.join(", ")}]`);
    return placed;
}

/**
 * After the fire is lit, replace placeholder art with real station tokens (same position).
 * GM only. Batch-updates to reduce token flash.
 * @param {boolean} [safeRestSpot] - Relabel weapon rack token to Supply Table
 * @returns {Promise<string[]>} promoted target keys
 */
export async function promoteAllPlaceholders(safeRestSpot = false, options = {}) {
    if (!game.user.isGM) return [];

    const scene = canvas?.scene;
    if (!scene) return [];

    hydrateCampSessionFromScene();
    const pit = getPitTokenOnScene();
    const sid = pit?.flags?.[MODULE_ID]?.campSessionId ?? getCampSessionIdStored();
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
        prev.propKey = key;
        prev.isSharedStation = true;
        if (key === "cookingArea") {
            prev.partyHasCookingUtensils = partyHasCookingUtensils();
        }

        const sameFootprint = doc.width === w && doc.height === h;
        const cx = doc.x + (doc.width * gs) / 2;
        const cy = doc.y + (doc.height * gs) / 2;
        const placement = validateCampEquipmentDrop(cx, cy, w, h, null, doc.id);

        const displayName = key === "sharedBedroll"
            ? "Bedrolls"
            : key === "cookingArea"
            ? (partyHasCookingUtensils() ? def.name : (def.basicName ?? def.name))
            : (key === "weaponRack" && safeRestSpot)
                ? "Supply Table"
                : def.name;

        const u = {
            _id: doc.id,
            name: displayName,
            texture: {
                src: resolveStationIcon(key, {
                    hasCookingUtensils: key === "cookingArea" ? partyHasCookingUtensils() : undefined
                }),
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
        Logger.log(`${MODULE_ID} | promoteAllPlaceholders: ${updates.length} token(s) updated`);
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
    return getTargetSortForModuleCampFlags(document.flags?.[MODULE_ID]) !== null;
}

/**
 * @param {object} data - TokenData passed to token creation
 */
export function applyCampFloorSortToPreCreateData(data) {
    const t = getTargetSortForModuleCampFlags(data?.flags?.[MODULE_ID]);
    if (t !== null) data.sort = t;
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
    if (target === null) return;
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
        if (target === null) continue;
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
