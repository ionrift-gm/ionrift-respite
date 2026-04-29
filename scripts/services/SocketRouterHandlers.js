/**
 * SocketRouterHandlers — handler functions for inbound socket messages.
 * Extracted from module.js (Phase 2.2).
 *
 * Each handler receives (data, ctx) where ctx is a live context accessor
 * providing getters/setters for module-scoped mutable state.
 *
 * @module SocketRouterHandlers
 */

import { RestSetupApp } from "../apps/RestSetupApp.js";
import { ShortRestApp } from "../apps/ShortRestApp.js";
import * as RestAfkState from "./RestAfkState.js";
import { refreshAfterAfkChange } from "./restSessionAfkEmit.js";
import { CopySpellHandler } from "./CopySpellHandler.js";
import { CampfireTokenLinker } from "./CampfireTokenLinker.js";
import { TorchTokenLinker } from "./TorchTokenLinker.js";
import { isMonsterCookingUnlocked } from "../FeatureFlags.mjs";
import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "./DetectMagicInventoryGlowBridge.js";
import {
    placePlayerGear, placeStation, canPlaceStation,
    clearPlayerCampGear, clearPlayerCampGearType, clearSharedCampStation
} from "./CompoundCampPlacer.js";
import {
    emitShortRestStarted, emitRestStarted,
    emitCampGearPlaced, emitCampStationPlaced, emitCampSceneCleared
} from "./SocketController.js";
import {
    showRejoinNotification, removeRejoinNotification,
    showShortRestRejoinNotification, removeShortRestRejoinNotification,
    showPrepNotification, removePrepNotification,
    removeGmRestIndicator
} from "./RejoinManager.js";
import { emitRequestRestState, emitRequestShortRestState } from "./SocketController.js";

const MODULE_ID = "ionrift-respite";

// ── Rest Lifecycle ──────────────────────────────────────────────────────────

export function handleRestStarted(data, ctx) {
    if (data.targetUserId && data.targetUserId !== game.user.id) return;
    try {
        ctx.setPlayerRestActive(true);
        removeRejoinNotification();
        removeGmRestIndicator();

        const existing = ctx.activePlayerRestApp;
        if (existing) {
            const isNewRest = !data.restData?.restId || existing._restId !== data.restData.restId;
            if (!isNewRest) {
                if (data.snapshot && existing.receiveRestSnapshot) {
                    existing.receiveRestSnapshot(data.snapshot);
                } else {
                    existing.render({ force: true });
                }
                ctx.showAfkPanel();
                return;
            }
            console.log(`${MODULE_ID} | Closing stale rest window for new rest`);
            ui.notifications.info("The GM has started a new rest. Refreshing your window.");
            existing.close({ skipRejoin: true });
            ctx.setActivePlayerRestApp(null);
        }

        const app = new RestSetupApp({}, data.restData);
        const origClose = app.close.bind(app);
        app.close = async (options = {}) => {
            try {
                await origClose(options);
            } finally {
                if (options.retainPlayerApp) {
                    console.log(`${MODULE_ID} | Player rest window closed; app ref retained for canvas phase`);
                    if (ctx.playerRestActive && !options.skipRejoin) {
                        showRejoinNotification(ctx.activePlayerRestApp, () => {
                            removeRejoinNotification();
                            emitRequestRestState(game.user.id);
                        });
                    }
                    return;
                }
                ctx.setActivePlayerRestApp(null);
                if (ctx.playerRestActive && !options.skipRejoin) {
                    showRejoinNotification(null, () => {
                        removeRejoinNotification();
                        emitRequestRestState(game.user.id);
                    });
                }
            }
        };
        ctx.setActivePlayerRestApp(app);
        console.log(`${MODULE_ID} | RestSetupApp created in player mode, rendering...`);
        app.render({ force: true });
        ctx.showAfkPanel();

        if (data.snapshot && app.receiveRestSnapshot) {
            setTimeout(() => { app.receiveRestSnapshot(data.snapshot); }, 300);
        }
        setTimeout(() => {
            if (ctx.activePlayerRestApp?._openCampfire) {
                console.log(`${MODULE_ID} | Opening campfire for player on rest start`);
                ctx.activePlayerRestApp._openCampfire();
            }
        }, 500);
    } catch (err) {
        console.error(`${MODULE_ID} | Error in handleRestStarted:`, err);
    }
}

export function handleActivityChoice(data, ctx) {
    if (!ctx.activeRestSetupApp) return;
    ctx.activeRestSetupApp.receivePlayerChoices(data.userId, data.choices, data.craftingResults ?? null, data.followUps ?? null);
}

export function handleRestResolved(data, ctx) {
    ctx.setPlayerRestActive(false);
    removeRejoinNotification();
    removeGmRestIndicator();
    notifyDetectMagicScanCleared();
    const app = ctx.activePlayerRestApp;
    if (app) {
        app.close({ skipRejoin: true });
        ctx.setActivePlayerRestApp(null);
    }
    ctx.hideAfkPanelAfterRest();
}

export function handleSubmissionUpdate(data, ctx) {
    ctx.activePlayerRestApp?.receiveSubmissionUpdate?.(data.submissions);
}

export function handleRequestRestState(data, ctx) {
    if (!ctx.activeRestData) return;
    const snapshot = ctx.activeRestSetupApp?.getRestSnapshot?.() ?? null;
    emitRestStarted(ctx.activeRestData, { snapshot, targetUserId: data.userId ?? null });
}

// ── Short Rest ──────────────────────────────────────────────────────────────

export function handleShortRestStarted(data, ctx) {
    removeShortRestRejoinNotification();
    removePrepNotification();
    const existing = ctx.activeShortRestApp;
    if (existing) {
        existing._isTerminating = true;
        existing.close();
    }
    const app = new ShortRestApp();
    app.receiveStarted(data);
    ctx.setActiveShortRestApp(app);
    app.render({ force: true });
    ctx.showAfkPanel();
}

export function handleShortRestComplete(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (app) {
        ui.notifications.info("Short rest complete. Class features recovered.");
        app._isTerminating = true;
        app.close();
        ctx.setActiveShortRestApp(null);
    }
    removeShortRestRejoinNotification();
    ctx.hideAfkPanelAfterRest();
}

export function handleShortRestAbandoned(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (app) {
        ui.notifications.info("The GM has abandoned the short rest.");
        app._isTerminating = true;
        app.close();
        ctx.setActiveShortRestApp(null);
    }
    removeShortRestRejoinNotification();
    ctx.hideAfkPanelAfterRest();
}

export function handleShortRestDismissed(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (app) {
        app._isTerminating = true;
        app.close();
        ctx.setActiveShortRestApp(null);
    }
    showShortRestRejoinNotification(() => {
        removeShortRestRejoinNotification();
        emitRequestShortRestState(game.user.id);
    });
}

export function handleRequestShortRestState(data, ctx) {
    const app = ctx.activeShortRestApp;
    if (!app) {
        const saved = game.settings.get(MODULE_ID, "activeShortRest");
        if (!saved?.timestamp) return;
        const newApp = new ShortRestApp({ initialShelter: saved.activeShelter ?? "none" });
        const restored = newApp._loadShortRestState();
        if (!restored) return;
        ctx.registerActiveShortRestApp(newApp);
        emitShortRestStarted({
            targetUserId: data.userId ?? null,
            rolls: newApp._serializeRolls(),
            songBonuses: newApp._serializeSongBonuses(),
            afkCharacterIds: RestAfkState.getAfkCharacterIds(),
            finishedUserIds: [...newApp._finishedUsers],
            activeShelter: newApp._activeShelter,
            rpPrompt: newApp._rpPrompt,
            songVolunteer: newApp._songVolunteer,
        });
        return;
    }
    emitShortRestStarted({
        targetUserId: data.userId ?? null,
        rolls: app._serializeRolls(),
        songBonuses: app._serializeSongBonuses(),
        afkCharacterIds: RestAfkState.getAfkCharacterIds(),
        finishedUserIds: [...app._finishedUsers],
        activeShelter: app._activeShelter,
        rpPrompt: app._rpPrompt,
        songVolunteer: app._songVolunteer,
    });
}

// ── AFK / Armor ─────────────────────────────────────────────────────────────

export function handleAfkUpdate(data) {
    RestAfkState.applyUpdate(data.characterId, data.isAfk);
    refreshAfterAfkChange();
}

export function handleArmorToggle(data, ctx) {
    const app = game.user.isGM ? ctx.activeRestSetupApp : ctx.activePlayerRestApp;
    if (app) app.receiveArmorToggle(data.actorId, data.itemId, data.isDoffed);
}

// ── Firewood ────────────────────────────────────────────────────────────────

export async function handleConsumeFirewood(data) {
    const actor = game.actors.get(data.actorId);
    if (!actor) return;
    const firewood = actor.items.get(data.itemId);
    if (!firewood) return;
    const qty = firewood.system?.quantity ?? 1;
    if (qty <= 1) { await firewood.delete(); }
    else { await firewood.update({ "system.quantity": qty - 1 }); }
    console.log(`${MODULE_ID} | GM consumed firewood for ${actor.name} (remaining: ${qty - 1})`);
}

// ── Camp Gear / Stations ────────────────────────────────────────────────────

export async function handleCampGearPlace(data, ctx) {
    const { actorId, gearType, x, y } = data;
    if (!actorId || !gearType || x == null || y == null) return;
    const placed = await placePlayerGear(x, y, gearType, actorId);
    if (placed) {
        emitCampGearPlaced({ actorId, gearType });
        if (ctx.activeRestSetupApp) {
            void ctx.activeRestSetupApp.render();
            ctx.activeRestSetupApp.refreshCanvasStationOverlaysIfActivity?.();
        }
    }
}

export async function handleCampStationPlace(data, ctx) {
    const { actorId, stationKey, x, y, userId } = data;
    if (!actorId || !stationKey || x == null || y == null || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campStationPlace rejected (not owner)`);
        return;
    }
    if (!canPlaceStation(actor, stationKey)) {
        ui.notifications.warn("That character cannot place this station.");
        return;
    }
    const placed = await placeStation(x, y, stationKey);
    if (placed) {
        emitCampStationPlaced();
        if (ctx.activeRestSetupApp) {
            void ctx.activeRestSetupApp.render();
            ctx.activeRestSetupApp.refreshCanvasStationOverlaysIfActivity?.();
        }
        void ctx.activePlayerRestApp?.render();
    }
}

export async function handleCampGearReclaim(data, ctx) {
    const { actorId, gearType, userId, sceneId } = data;
    if (!actorId || !gearType || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campGearReclaim rejected (not owner)`);
        return;
    }
    const n = await clearPlayerCampGearType(actorId, gearType, sceneId ?? null);
    if (n > 0) emitCampGearPlaced({ actorId, gearType });
    ctx.activeRestSetupApp?.render();
    ctx.activePlayerRestApp?.render();
}

export async function handleCampStationReclaim(data, ctx) {
    const { actorId, stationKey, userId } = data;
    if (!actorId || !stationKey || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campStationReclaim rejected (not owner)`);
        return;
    }
    if (!canPlaceStation(actor, stationKey)) {
        ui.notifications.warn("That character cannot pick up this station.");
        return;
    }
    const n = await clearSharedCampStation(stationKey);
    if (n > 0) { emitCampStationPlaced(); }
    else { ui.notifications.info("Nothing to pick up on the scene for that station."); }
    ctx.activeRestSetupApp?.render();
    ctx.activePlayerRestApp?.render();
}

export async function handleCampGearClearPlayer(data, ctx) {
    const { actorId, userId, sceneId } = data;
    if (!actorId || !userId) return;
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campGearClearPlayer rejected (not owner)`);
        return;
    }
    const n = await clearPlayerCampGear(actorId, sceneId ?? null);
    if (n > 0) emitCampSceneCleared({ actorId });
    ctx.activeRestSetupApp?.render();
    ctx.activePlayerRestApp?.render();
}

// ── Butcher Popup ───────────────────────────────────────────────────────────

export function showButcherPopup(data) {
    if (!isMonsterCookingUnlocked()) return;
    const holderIds = data.holderIds ?? [];
    if (!game.user.isGM) {
        const ownsHolder = holderIds.some(id => {
            const actor = game.actors.get(id);
            return actor?.ownership?.[game.user.id] >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        });
        if (!ownsHolder) return;
    }
    const tierColors = { common: "#8b8b8b", uncommon: "#1a9c3a", rare: "#4a6de5", legendary: "#c44ade" };
    const tierColor = tierColors[data.tier] ?? tierColors.common;
    const overlay = document.createElement("div");
    overlay.classList.add("ionrift-armor-modal-overlay");
    overlay.style.zIndex = "10001";
    overlay.innerHTML = `
        <div class="ionrift-armor-modal" style="max-width: 420px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                <img src="${data.creatureImg}" alt="${data.creatureName}"
                     style="width: 64px; height: 64px; border-radius: 8px; border: 2px solid ${tierColor}; object-fit: cover;" />
                <div>
                    <h3 style="margin: 0;"><i class="fas fa-drumstick-bite"></i> Butcher Opportunity</h3>
                    <p style="margin: 2px 0; font-size: 1.1em; font-weight: bold;">${data.creatureName}</p>
                    <span style="background: ${tierColor}; color: #fff; padding: 1px 8px; border-radius: 3px; font-size: 0.8em; text-transform: uppercase;">${data.tier}</span>
                </div>
            </div>
            <p style="font-style: italic; margin: 6px 0; color: #ccc;">${data.flavour}</p>
            <p style="margin: 6px 0;"><strong>Survival DC:</strong> ${data.dc} &nbsp; <strong>CR:</strong> ${data.cr}</p>
            <p style="margin: 6px 0;"><i class="fas fa-book"></i> ${data.holderNames} can butcher this creature.</p>
            <p style="margin: 8px 0; font-size: 0.9em; color: #aaa;">Use the <strong>Butcher</strong> button in chat to attempt the harvest.</p>
            <div class="ionrift-armor-modal-buttons">
                <button class="btn-armor-confirm"><i class="fas fa-check"></i> Got it</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => overlay.remove());
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 30000);
}

// ── Copy Spell Routing ──────────────────────────────────────────────────────

export function handleCopySpellProposal(data, ctx) {
    if (game.user.isGM) {
        CopySpellHandler.receiveProposalAsGM(data, ctx.activeRestSetupApp);
    } else {
        CopySpellHandler.receiveProposal(data, ctx.activePlayerRestApp);
    }
}

export function handleCopySpellBusy(data, ctx) {
    ui.notifications.warn("The GM is processing another Copy Spell transaction. Please wait and try again.");
    if (ctx.activePlayerRestApp && data.actorId) {
        ctx.activePlayerRestApp._lockedCharacters?.delete(data.actorId);
        ctx.activePlayerRestApp._earlyResults?.delete(data.actorId);
        ctx.activePlayerRestApp.render();
    }
}
