/**
 * CompoundCampPlacer
 * Places a compound camp layout on the active scene: a central campfire
 * surrounded by four furniture tokens at cardinal offsets. Also handles
 * player gear (bedroll, tent) placement with deployed-state tracking.
 *
 * All placed tokens are flagged with isCampFurniture and a shared
 * campSessionId so they can be cleaned up when the rest resolves.
 */

const MODULE_ID = "ionrift-respite";

/** Draft campsite art under world Data (replace with shipped module assets later). */
const DRAFT_CAMPSITE_TOKENS = "ionrift-brand/Assets/Drafts/campsite_tokens";

// Compound layout furniture (draft PNGs where available)
const FURNITURE = {
    table:       { name: "Makeshift Table",  icon: `${DRAFT_CAMPSITE_TOKENS}/makeshift_table.png`, fallback: "icons/svg/barrel.svg", textureScale: 1.6 },
    medicalBed:  { name: "Medical Bedding",  icon: `${DRAFT_CAMPSITE_TOKENS}/triage_bed.png`,     fallback: "icons/svg/sleep.svg", textureScale: 1.6 },
    weaponRack:  { name: "Weapon Rack",      icon: `${DRAFT_CAMPSITE_TOKENS}/weapons_rack.png`,   fallback: "icons/svg/sword.svg", textureScale: 1.6 },
    cookingArea: { name: "Cooking Station",  icon: `${DRAFT_CAMPSITE_TOKENS}/cooking_station.png`, fallback: "icons/tools/cooking/cauldron.webp" }
};

const PLAYER_GEAR = {
    bedroll: { name: "Bedroll",  icon: `${DRAFT_CAMPSITE_TOKENS}/bedroll.png`, fallback: "icons/svg/sleep.svg",  width: 1,   height: 1 },
    tent:    { name: "Tent",     icon: "icons/environment/wilderness/tent.webp",    fallback: "icons/svg/house.svg",  width: 1,   height: 1 },
    /** Small map token: dining gear (half-grid footprint). */
    messkit: { name: "Mess Kit", icon: "icons/tools/cooking/cutlery-steel.webp", fallback: "icons/tools/cooking/cauldron.webp", width: 0.5, height: 0.5 }
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

// Cardinal offsets in grid squares from center
const CAMP_OFFSETS = {
    cookingArea: { dx:  0, dy: -2 },  // North
    table:       { dx:  0, dy:  2 },  // South
    medicalBed:  { dx: -2, dy:  0 },  // West
    weaponRack:  { dx:  2, dy:  0 }   // East
};

let _campSessionId = null;

function gridSize() {
    return canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
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
    return {
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
}

// Campfire base/flame assets (same as CampPropPlacer, used for direct placement)
const CAMPFIRE_BASES = [
    `modules/${MODULE_ID}/assets/tokens/campfire-bases/campfire_base_01.png`,
    `modules/${MODULE_ID}/assets/tokens/campfire-bases/campfire_base_02.png`,
    `modules/${MODULE_ID}/assets/tokens/campfire-bases/campfire_base_03.png`,
    `modules/${MODULE_ID}/assets/tokens/campfire-bases/campfire_base_04.png`,
    `modules/${MODULE_ID}/assets/tokens/campfire-bases/campfire_base_05.png`,
    `modules/${MODULE_ID}/assets/tokens/campfire-bases/campfire_base_06.png`,
];
const CAMPFIRE_FLAME = `modules/${MODULE_ID}/assets/tokens/campfire_topdown_128x128.webm`;

/**
 * Token `sort`: draw order among tokens at the same elevation (HUD bring-to-front / send-to-back).
 * Higher draws on top. Not elevation (flight).
 */
const CAMPFIRE_BASE_SORT = 100;
const CAMPFIRE_FLAME_SORT = 101;

function randomCampfireBase() {
    return CAMPFIRE_BASES[Math.floor(Math.random() * CAMPFIRE_BASES.length)];
}

function findCampfireActor() {
    const name = game.settings.get(MODULE_ID, "campfireTokenName")?.toLowerCase() ?? "campfire";
    return game.actors?.find(a => a.name?.toLowerCase() === name) ?? null;
}

/**
 * Place a compound camp layout at a given world position.
 * Creates: campfire (base + flame) at center, plus four furniture tokens
 * at cardinal offsets of 2 grid squares.
 *
 * GM only.
 *
 * @param {number} worldX - Canvas world X (center of the camp)
 * @param {number} worldY - Canvas world Y (center of the camp)
 * @returns {Promise<{sessionId: string, center: {x: number, y: number}}>}
 */
export async function placeCompoundCamp(worldX, worldY) {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can place a camp layout.");
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

    // Campfire base token (top-left position)
    const tx = cx - (gs / 2);
    const ty = cy - (gs / 2);

    const baseData = {
        name: "Campfire Base",
        texture: { src: randomCampfireBase() },
        width: 1, height: 1,
        sort: CAMPFIRE_BASE_SORT,
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

    // Campfire flame overlay
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
        sort: CAMPFIRE_FLAME_SORT,
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

    // Furniture tokens at cardinal offsets
    const furnitureTokens = Object.entries(CAMP_OFFSETS).map(([key, offset]) => {
        const fx = cx + (offset.dx * gs) - (gs / 2);
        const fy = cy + (offset.dy * gs) - (gs / 2);
        return buildFurnitureToken(key, fx, fy, FURNITURE[key]);
    });

    // Batch create all tokens
    const allTokens = [baseData, flameData, ...furnitureTokens];
    await scene.createEmbeddedDocuments("Token", allTokens);

    console.log(`${MODULE_ID} | CompoundCampPlacer: placed camp layout at (${cx}, ${cy}), session: ${sessionId}`);
    ui.notifications.info("Camp placed on scene.");

    return { sessionId, center: { x: cx, y: cy } };
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

    const gs = gridSize();
    const w = def.width ?? 1;
    const h = def.height ?? 1;
    const snapped = canvas.grid.getSnappedPoint({ x: worldX, y: worldY }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
    const sx = snapped.x ?? worldX;
    const sy = snapped.y ?? worldY;
    const tx = sx - ((gs * w) / 2);
    const ty = sy - ((gs * h) / 2);

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

    console.log(`${MODULE_ID} | CompoundCampPlacer: placed ${gearType} for ${actor.name} at (${sx}, ${sy})`);
    return true;
}

/**
 * Remove all camp furniture tokens from the active scene.
 * Matches tokens flagged with the current campSessionId,
 * or all isCampFurniture tokens if no session is active.
 *
 * @returns {Promise<number>} Count of removed tokens
 */
export async function clearCampTokens() {
    if (!game.user.isGM) return 0;

    const scene = canvas.scene;
    if (!scene) return 0;

    const sessionId = _campSessionId;
    const campTokens = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        if (!flags?.isCampFurniture) return false;
        if (sessionId) return flags.campSessionId === sessionId;
        return true;
    });

    if (!campTokens.length) return 0;

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
 * @returns {Promise<number>} Count of removed tokens
 */
export async function clearPlayerCampGear(actorId) {
    if (!game.user.isGM) return 0;

    const scene = canvas.scene;
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
 * Check whether a compound camp has been placed in the current session.
 * @returns {boolean}
 */
export function hasCampPlaced() {
    if (!_campSessionId) return false;
    const scene = canvas?.scene;
    if (!scene) return false;
    return scene.tokens.some(t =>
        t.flags?.[MODULE_ID]?.isCampFurniture &&
        t.flags?.[MODULE_ID]?.campSessionId === _campSessionId &&
        t.flags?.[MODULE_ID]?.furnitureKey === "campfire"
    );
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
