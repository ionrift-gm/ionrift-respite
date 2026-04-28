/**
 * CampPropPlacer
 * GM-only utility that places paired camp prop tokens (stake + fire overlay)
 * in a single action, eliminating the manual two-token alignment workflow.
 *
 * Modes:
 *   1. Single Placement: click a point → creates stake + fire overlay pair
 *   2. Perimeter Ring: select a campfire token → places a ring of torch pairs
 *
 * Usage from Foundry console:
 *   game.ionrift.respite.placeCampfire()      — place campfire (base + fire overlay)
 *   game.ionrift.respite.placeTorch()         — single torch placement mode
 *   game.ionrift.respite.placePerimeter()     — ring around selected campfire
 *   game.ionrift.respite.placeCamp()          — full camp: campfire + perimeter ring
 *   game.ionrift.respite.clearTorches()       — remove all torch pairs from scene
 *   game.ionrift.respite.toggleTorches()      — toggle all torch lights on/off
 */

const MODULE_ID = "ionrift-respite";

// Asset paths
const TORCH_STAKES = [
    `modules/${MODULE_ID}/assets/tokens/torches/torch_stake_01.png`,
    `modules/${MODULE_ID}/assets/tokens/torches/torch_stake_02.png`,
    `modules/${MODULE_ID}/assets/tokens/torches/torch_stake_03.png`,
    `modules/${MODULE_ID}/assets/tokens/torches/torch_stake_04.png`,
];

// Campfire base (cold pit, always visible; matches ionrift-brand draft art, shipped in module assets)
const CAMPFIRE_BASE_PIT = `modules/${MODULE_ID}/assets/tokens/campfire_dead_a.png`;
const CAMPFIRE_BASES = [CAMPFIRE_BASE_PIT];

// Campfire fire overlay
const CAMPFIRE_FLAME = `modules/${MODULE_ID}/assets/tokens/campfire_topdown_128x128.webm`;

/** Stacking at same elevation: HUD bring-to-front uses `sort` (higher = on top). Not flight. */
const PROP_PAIR_BASE_SORT = 100;
const PROP_PAIR_OVERLAY_SORT = 101;

/**
 * Pick a random torch stake variant.
 * @returns {string} Asset path
 */
function randomStake() {
    return TORCH_STAKES[Math.floor(Math.random() * TORCH_STAKES.length)];
}

/**
 * Get the grid size for positioning calculations.
 * @returns {number} Grid size in pixels
 */
function gridSize() {
    return canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
}

/**
 * Find the Perimeter Torch template actor in the world for light config.
 * @returns {Actor|null}
 */
function findTorchActor() {
    const name = game.settings.get(MODULE_ID, "torchTokenName")?.toLowerCase() ?? "perimeter torch";
    return game.actors?.find(a => a.name?.toLowerCase() === name) ?? null;
}

/**
 * Find the Campfire template actor in the world for light config.
 * @returns {Actor|null}
 */
function findCampfireActor() {
    const name = game.settings.get(MODULE_ID, "campfireTokenName")?.toLowerCase() ?? "campfire";
    return game.actors?.find(a => a.name?.toLowerCase() === name) ?? null;
}

/**
 * Pick a random campfire base variant.
 * @returns {string} Asset path
 */
function randomCampfireBase() {
    return CAMPFIRE_BASES[Math.floor(Math.random() * CAMPFIRE_BASES.length)];
}

/**
 * Create a single torch pair (stake + fire overlay) at a given position.
 * @param {number} x - Canvas X coordinate
 * @param {number} y - Canvas Y coordinate
 * @param {string} [stakeImg] - Override stake image path
 * @returns {Promise<void>}
 */
async function createTorchPair(x, y, stakeImg) {
    const scene = canvas.scene;
    if (!scene) return;

    const img = stakeImg || randomStake();
    const gs = gridSize();

    // Snap to grid center
    const snapped = canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
    const sx = snapped.x ?? x;
    const sy = snapped.y ?? y;

    // Token position (top-left corner, offset by half grid)
    const tx = sx - (gs / 2);
    const ty = sy - (gs / 2);

    // Generate a link ID so we can clean up paired tokens later
    const linkId = foundry.utils.randomID(8);

    // Create stake token (always visible, no light)
    const stakeData = {
        name: "Torch Stake",
        texture: { src: img },
        width: 1,
        height: 1,
        sort: PROP_PAIR_BASE_SORT,
        x: tx,
        y: ty,
        hidden: false,
        lockRotation: true,
        rotation: Math.floor(Math.random() * 360), // Random rotation for variety
        disposition: -2,
        light: { bright: 0, dim: 0 },
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isTorchStake: true,
                torchLinkId: linkId
            }
        }
    };

    // Get fire overlay config from the template actor (or use defaults)
    const torchActor = findTorchActor();
    const protoLight = torchActor?.prototypeToken?.light;
    const lightConfig = (protoLight && (protoLight.bright > 0 || protoLight.dim > 0))
        ? foundry.utils.deepClone(protoLight.toObject?.() ?? protoLight)
        : {
            bright: 10,
            dim: 20,
            color: "#e87020",
            alpha: 0.35,
            angle: 360,
            coloration: 1,
            luminosity: 0.5,
            animation: { type: "torch", speed: 4, intensity: 5 },
            darkness: { min: 0, max: 1 }
        };

    // Fire overlay token (hidden, with light source)
    const torchName = game.settings.get(MODULE_ID, "torchTokenName") ?? "Perimeter Torch";
    const flameSrc = torchActor?.prototypeToken?.texture?.src
        ?? `modules/${MODULE_ID}/assets/tokens/torches/torch_flame_128x128.webm`;
    const flameScale = torchActor?.prototypeToken?.texture?.scaleX ?? 0.6;

    const flameData = {
        name: torchName,
        texture: { src: flameSrc, scaleX: flameScale, scaleY: flameScale },
        width: 1,
        height: 1,
        sort: PROP_PAIR_OVERLAY_SORT,
        x: tx,
        y: ty,
        hidden: true,
        lockRotation: true,
        rotation: 0,
        disposition: -2,
        light: lightConfig,
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isPerimeterTorch: true,
                torchLinkId: linkId
            }
        }
    };

    // Batch create both tokens
    await scene.createEmbeddedDocuments("Token", [stakeData, flameData]);
    console.log(`${MODULE_ID} | CampPropPlacer: created torch pair at (${sx}, ${sy}), link: ${linkId}`);
}

/**
 * Create a campfire pair (base logs + fire overlay) at a given position.
 * @param {number} x - Canvas X coordinate
 * @param {number} y - Canvas Y coordinate
 * @returns {Promise<void>}
 */
async function createCampfirePair(x, y) {
    const scene = canvas.scene;
    if (!scene) return;

    const gs = gridSize();

    // Snap to grid center
    const snapped = canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.CENTER });
    const sx = snapped.x ?? x;
    const sy = snapped.y ?? y;
    const tx = sx - (gs / 2);
    const ty = sy - (gs / 2);

    const linkId = foundry.utils.randomID(8);

    // Campfire base token (always visible, no light — the charred logs)
    const baseData = {
        name: "Campfire Base",
        texture: { src: randomCampfireBase() },
        width: 1,
        height: 1,
        sort: PROP_PAIR_BASE_SORT,
        x: tx,
        y: ty,
        hidden: false,
        lockRotation: true,
        rotation: Math.floor(Math.random() * 360),
        disposition: -2,
        light: { bright: 0, dim: 0 },
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isCampfireBase: true,
                campfireLinkId: linkId
            }
        }
    };

    // Get fire overlay config from the template actor (or defaults)
    const campfireActor = findCampfireActor();
    const protoLight = campfireActor?.prototypeToken?.light;
    const lightConfig = (protoLight && (protoLight.bright > 0 || protoLight.dim > 0))
        ? foundry.utils.deepClone(protoLight.toObject?.() ?? protoLight)
        : {
            bright: 20,
            dim: 40,
            color: "#ff9329",
            alpha: 0.4,
            angle: 360,
            coloration: 1,
            luminosity: 0.5,
            animation: { type: "torch", speed: 3, intensity: 4 },
            darkness: { min: 0, max: 1 }
        };

    // Campfire fire overlay (hidden, with light source)
    const campfireName = game.settings.get(MODULE_ID, "campfireTokenName") ?? "Campfire";
    const flameSrc = campfireActor?.prototypeToken?.texture?.src ?? CAMPFIRE_FLAME;

    const flameData = {
        name: campfireName,
        texture: { src: flameSrc, scaleX: 1, scaleY: 1 },
        width: 1,
        height: 1,
        sort: PROP_PAIR_OVERLAY_SORT,
        x: tx,
        y: ty,
        hidden: true,
        lockRotation: true,
        rotation: 0,
        disposition: -2,
        light: lightConfig,
        sight: { enabled: false },
        flags: {
            [MODULE_ID]: {
                isCampfireToken: true,
                campfireLinkId: linkId
            }
        }
    };

    await scene.createEmbeddedDocuments("Token", [baseData, flameData]);
    console.log(`${MODULE_ID} | CampPropPlacer: created campfire pair at (${sx}, ${sy}), link: ${linkId}`);
    return { x: sx, y: sy };
}

/**
 * Place a ring of torch pairs around a central point.
 * @param {number} cx - Center X coordinate
 * @param {number} cy - Center Y coordinate
 * @param {number} [count=4] - Number of torches
 * @param {number} [radiusGrids=3] - Radius in grid squares
 */
async function placePerimeterRing(cx, cy, count = 4, radiusGrids = 3) {
    const gs = gridSize();
    const radiusPx = radiusGrids * gs;

    for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        // Slight randomness in angle and radius for organic feel
        const jitterAngle = angle + (Math.random() - 0.5) * 0.3;
        const jitterRadius = radiusPx + (Math.random() - 0.5) * gs * 0.5;
        const x = cx + Math.cos(jitterAngle) * jitterRadius;
        const y = cy + Math.sin(jitterAngle) * jitterRadius;
        await createTorchPair(x, y);
    }

    ui.notifications.info(`Placed ${count} perimeter torches.`);
}

/**
 * Remove all torch tokens (stakes and fire overlays) from the active scene.
 */
async function clearAllTorches() {
    const scene = canvas.scene;
    if (!scene) return;

    const torchTokens = scene.tokens.filter(t => {
        const flags = t.flags?.[MODULE_ID];
        return flags?.isTorchStake || flags?.isPerimeterTorch;
    });

    if (!torchTokens.length) {
        ui.notifications.warn("No torch tokens found on this scene.");
        return;
    }

    const ids = torchTokens.map(t => t.id);
    await scene.deleteEmbeddedDocuments("Token", ids);
    ui.notifications.info(`Removed ${torchTokens.length} torch tokens.`);
}

// ── Public API: called from module.js or macros ──────────────────────────

/**
 * Enter single torch placement mode. GM clicks a point on the canvas.
 */
export async function placeTorch() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can place camp props.");
        return;
    }

    ui.notifications.info("Click on the canvas to place a torch. Right-click or Escape to cancel.");

    try {
        const position = await _pickCanvasPoint();
        if (position) {
            await createTorchPair(position.x, position.y);
            ui.notifications.info("Torch placed.");
        }
    } catch {
        // Cancelled
    }
}

/**
 * Place a perimeter ring of torches around the selected token (or a picked point).
 * @param {Object} [options]
 * @param {number} [options.count=4] - Number of torches
 * @param {number} [options.radius=3] - Radius in grid squares
 */
export async function placePerimeter({ count = 4, radius = 3 } = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can place camp props.");
        return;
    }

    // Check for selected token (use as center)
    const selected = canvas.tokens?.controlled?.[0];
    if (selected) {
        const gs = gridSize();
        const cx = selected.x + (gs / 2);
        const cy = selected.y + (gs / 2);
        await placePerimeterRing(cx, cy, count, radius);
        return;
    }

    // No selection — ask GM to click a center point
    ui.notifications.info("Select a campfire token first, or click a center point for the perimeter.");
    try {
        const position = await _pickCanvasPoint();
        if (position) {
            await placePerimeterRing(position.x, position.y, count, radius);
        }
    } catch {
        // Cancelled
    }
}

/**
 * Remove all torch tokens from the scene.
 */
export async function clearTorches() {
    if (!game.user.isGM) return;
    await clearAllTorches();
}

/**
 * Toggle all perimeter torch lights on/off.
 */
export async function toggleTorches() {
    if (!game.user.isGM) return;

    const { TorchTokenLinker } = await import("./TorchTokenLinker.js");
    const currentlyLit = TorchTokenLinker.areTorchesLit();
    await TorchTokenLinker.setLightState(!currentlyLit);
    ui.notifications.info(`Perimeter torches ${!currentlyLit ? "lit" : "extinguished"}.`);
}

/**
 * Place a campfire (base + fire overlay) via crosshair. GM only.
 */
export async function placeCampfire() {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can place camp props.");
        return;
    }

    ui.notifications.info("Click on the canvas to place the campfire. Right-click or Escape to cancel.");

    try {
        const position = await _pickCanvasPoint();
        if (position) {
            await createCampfirePair(position.x, position.y);
            ui.notifications.info("Campfire placed.");
        }
    } catch {
        // Cancelled
    }
}

/**
 * Place a full camp: campfire + perimeter ring of torches, all in one command.
 * @param {Object} [options]
 * @param {number} [options.torchCount=4] - Number of perimeter torches
 * @param {number} [options.radius=3] - Torch ring radius in grid squares
 */
export async function placeCamp({ torchCount = 4, radius = 3 } = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can place camp props.");
        return;
    }

    ui.notifications.info("Click on the canvas to place the camp center. Right-click or Escape to cancel.");

    try {
        const position = await _pickCanvasPoint();
        if (position) {
            const center = await createCampfirePair(position.x, position.y);
            if (center) {
                await placePerimeterRing(center.x, center.y, torchCount, radius);
            }
            ui.notifications.info(`Camp placed: campfire + ${torchCount} perimeter torches.`);
        }
    } catch {
        // Cancelled
    }
}

// ── Private: canvas point picker ─────────────────────────────────────────

/**
 * Wait for the user to click on the canvas. Returns the clicked {x, y}.
 * Rejects on right-click or Escape.
 * @returns {Promise<{x: number, y: number}>}
 */
function _pickCanvasPoint() {
    return new Promise((resolve, reject) => {
        // Change cursor
        const canvasEl = document.getElementById("board");
        const originalCursor = canvasEl?.style.cursor;
        if (canvasEl) canvasEl.style.cursor = "crosshair";

        function cleanup() {
            canvas.stage.off("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("contextmenu", onRightClick);
            if (canvasEl) canvasEl.style.cursor = originalCursor ?? "";
        }

        function onPointerDown(event) {
            // Only left click
            if (event.data?.button !== 0 && event.button !== 0) return;
            const pos = event.data?.getLocalPosition?.(canvas.stage)
                ?? canvas.stage.toLocal(event.global ?? event);
            cleanup();
            resolve({ x: pos.x, y: pos.y });
        }

        function onRightClick(event) {
            event.preventDefault();
            cleanup();
            reject(new Error("Cancelled"));
        }

        function onKeyDown(event) {
            if (event.key === "Escape") {
                cleanup();
                reject(new Error("Cancelled"));
            }
        }

        canvas.stage.on("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("contextmenu", onRightClick);
    });
}
