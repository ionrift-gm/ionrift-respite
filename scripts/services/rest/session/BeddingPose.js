import { MODULE_ID } from "../../../data/moduleId.js";
import { clearAllZzzOverlays } from "../../ui/sheet/UiInjections.js";

/**
 * Sleep pose for the night watch.
 *
 * The old path toggled real incapacitated and prone effects on every sleeper.
 * Foundry answers each of those with a scrolling status label (a new text
 * object plus a tween) and a token redraw, then does it again on wake.
 * In a safe rest, and whenever wake is requested before the next paint, that
 * pair lands in one turn and the pose is never visible.
 *
 * The pose is cosmetic. Combat and resolution both clear it before it can
 * matter. Tokens still show the primary status image as an overlay, plus the
 * Zzz mark. No actor effects, so no floaty text.
 */

/**
 * @param {{ safeRestSpot?: boolean }} [engine]
 * @returns {boolean}
 */
export function beddingPoseWillDwell(engine) {
    return !engine?.safeRestSpot;
}

/**
 * Image path for a core status id, if this game system defines one.
 * @param {string} statusId
 * @returns {string}
 */
export function beddingStatusImage(statusId) {
    if (!statusId) return "";
    const raw = globalThis.CONFIG?.statusEffects ?? [];
    const all = Array.isArray(raw) ? raw : Object.values(raw);
    const status = all.find(entry => entry?.id === statusId);
    return status?.img || status?.icon || "";
}

function alreadyDown(tokenDoc) {
    if (typeof tokenDoc.getFlag === "function") {
        return !!tokenDoc.getFlag(MODULE_ID, "beddingDown");
    }
    return !!tokenDoc.beddingDown;
}

function savedOverlay(tokenDoc) {
    if (typeof tokenDoc.getFlag === "function") {
        return tokenDoc.getFlag(MODULE_ID, "beddingOverlayPrev") ?? "";
    }
    return tokenDoc.beddingOverlayPrev ?? "";
}

/**
 * One token update per sleeper: overlay art plus the bedding flag.
 * Already-down tokens are left alone.
 * @param {object[]} tokenDocs
 * @param {{ overlayImg?: string, postureId?: string }} [options]
 * @returns {object[]}
 */
export function buildBeddingShowUpdates(tokenDocs, { overlayImg = "", postureId = "" } = {}) {
    const updates = [];
    for (const tokenDoc of tokenDocs ?? []) {
        if (!tokenDoc?.id || alreadyDown(tokenDoc)) continue;
        const prev = tokenDoc.overlayEffect ?? "";
        const update = {
            _id: tokenDoc.id,
            flags: {
                [MODULE_ID]: {
                    beddingDown: true,
                    beddingOverlayPrev: prev,
                    beddingPosture: postureId || ""
                }
            }
        };
        if (overlayImg) update.overlayEffect = overlayImg;
        updates.push(update);
    }
    return updates;
}

/**
 * Restore the overlay those tokens had before the pose, and clear the flag.
 * @param {object[]} tokenDocs
 * @returns {object[]}
 */
export function buildBeddingHideUpdates(tokenDocs) {
    const updates = [];
    for (const tokenDoc of tokenDocs ?? []) {
        if (!tokenDoc?.id || !alreadyDown(tokenDoc)) continue;
        updates.push({
            _id: tokenDoc.id,
            overlayEffect: savedOverlay(tokenDoc) || "",
            flags: {
                [MODULE_ID]: {
                    beddingDown: false,
                    beddingOverlayPrev: "",
                    beddingPosture: ""
                }
            }
        });
    }
    return updates;
}

function afterNextPaint() {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

/**
 * Show the pose after the night UI has a chance to paint. If wake arrives
 * first, neither side touches the canvas.
 *
 * @param {{ show: () => Promise<void>, hide: () => Promise<void> }} hooks
 */
export function createBeddingScheduler({ show, hide }) {
    let ticket = 0;
    let shown = false;
    let job = null;

    return {
        /**
         * @param {{ safeRestSpot?: boolean }} [ctx]
         */
        requestShow(ctx = {}) {
            if (!beddingPoseWillDwell(ctx)) return;
            if (shown) return;
            const mine = ++ticket;
            let current;
            current = (async () => {
                try {
                    await afterNextPaint();
                    if (mine !== ticket) return;
                    await show();
                    shown = true;
                } catch (err) {
                    console.warn("[Respite] Could not apply sleep pose:", err);
                } finally {
                    if (job === current) job = null;
                }
            })();
            job = current;
        },

        /**
         * @returns {Promise<void>}
         */
        async requestHide() {
            ticket += 1;
            const pending = job;
            job = null;
            if (pending) {
                try {
                    await pending;
                } catch (err) {
                    console.warn("[Respite] Sleep pose failed before wake:", err);
                }
            }
            if (!shown) return;
            shown = false;
            try {
                await hide();
            } catch (err) {
                console.warn("[Respite] Could not clear sleep pose:", err);
            }
        }
    };
}

/**
 * Unconditionally clear all bedding flags, overlays, and canvas marks across all scenes.
 * Safe to call at any time (abandon rest, rest cleanup, resolve).
 */
export async function clearAllBeddingPoses() {
    if (globalThis.game?.user?.isGM && globalThis.game.scenes) {
        for (const scene of globalThis.game.scenes) {
            const down = scene.tokens?.filter(t => alreadyDown(t));
            if (down?.length && scene.updateEmbeddedDocuments) {
                const updates = buildBeddingHideUpdates(down);
                if (updates.length) {
                    try {
                        await scene.updateEmbeddedDocuments("Token", updates);
                    } catch (err) {
                        console.warn(`[Respite] Failed to clear bedding flags on scene ${scene.id}:`, err);
                    }
                }
            }
        }
    }
    clearAllZzzOverlays();
}
