/**
 * WorkbenchDelegate.js
 * Handles workbench identify staging, drag-drop, item reveal, and ritual
 * timing logic during the Activity phase (station-based identify workflow).
 *
 * Extracted from RestSetupApp to reduce God Class complexity (Milestone 1.7).
 * Follows the established delegate pattern (see CampCeremonyDelegate.js).
 */

import {
    notifyWorkbenchIdentifyStagingTouched
} from "../StationActivityDialog.js";
import { emitWorkbenchIdentifyRequest } from "../../services/SocketController.js";

const MODULE_ID = "ionrift-respite";

// ── Utility helpers (pure, imported from RSA scope) ─────────────────────────

/**
 * Whether an item qualifies as unidentified for the workbench station.
 * Matches native dnd5e `identified === false` OR Quartermaster latent-masked gear.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {boolean}
 */
function itemIsWorkbenchUnidentified(actor, item) {
    if (!item || !actor?.items?.has(item.id)) return false;
    const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
    if (!validTypes.has(item.type)) return false;
    const raw = item.toObject?.()?.system ?? {};
    const identifiedLive = item.system?.identified;
    const identifiedRaw = raw.identified;
    const summarise = game.ionrift?.workshop?.getLatentSummary ?? null;
    const quartermasterLatent = summarise?.(item);
    // Only treat as QM-masked if QM says it is NOT yet identified.
    // Cursed items that have already had their lure promoted (system.identified=true)
    // must not appear as workbench candidates — QM has nothing left to reveal.
    const isQmMasked = !!quartermasterLatent
        && !quartermasterLatent.identified
        && quartermasterLatent.kind !== "mundane";
    const isNativeUnidentified = identifiedLive === false || identifiedRaw === false;
    return isQmMasked || isNativeUnidentified;
}

/** @param {Item} item @returns {boolean} */
function itemIsDnD5ePotionType(item) {
    return item?.type === "consumable" && item.system?.type?.value === "potion";
}

/**
 * True display name after identify (fresh actor item + Quartermaster latent if any).
 * @param {Actor} actor
 * @param {string} itemId
 * @param {string} fallbackName
 * @returns {string}
 */
function resolveTrueName(actor, itemId, fallbackName) {
    const fresh = actor.items.get(itemId);
    if (!fresh) return fallbackName;
    const qmSummary = game.ionrift?.workshop?.getLatentSummary?.(fresh);
    if (qmSummary?.trueName) return qmSummary.trueName;
    return fresh.name || fallbackName;
}

/**
 * Resolve an Item from a browser drop event (character sheet, sidebar, etc.).
 * @param {DragEvent} event
 * @returns {Promise<Item|null>}
 */
async function resolveItemFromDropEvent(event) {
    const TE = globalThis.foundry?.applications?.ux?.TextEditor ?? globalThis.TextEditor;
    let data = null;
    if (typeof TE?.getDragEventData === "function") {
        data = TE.getDragEventData(event);
    } else if (TE?.implementation && typeof TE.implementation.getDragEventData === "function") {
        data = TE.implementation.getDragEventData(event);
    }
    if (!data?.type) {
        try {
            data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
        } catch {
            data = null;
        }
    }
    if (!data?.type || data.type !== "Item") return null;
    if (data.uuid) {
        const doc = fromUuidSync(data.uuid);
        return doc instanceof Item ? doc : null;
    }
    if (typeof Item.implementation?.fromDropData === "function") {
        try {
            const doc = await Item.implementation.fromDropData(data);
            return doc instanceof Item ? doc : null;
        } catch {
            return null;
        }
    }
    return null;
}


export class WorkbenchDelegate {

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    // ── State Accessors ─────────────────────────────────────────────────

    /** @returns {Map<string, {gearItemId: string|null, potionItemIds: string[]}>} */
    get staging() { return this._app._workbenchIdentifyStaging; }

    /** @returns {Map<string, {items: object[], revealAt: number}>} */
    get acknowledge() { return this._app._workbenchIdentifyAcknowledge; }

    /** @returns {Set<string>} actorIds who have used their Focus slot this rest */
    get focusUsed() {
        if (!this._app._workbenchFocusUsed) this._app._workbenchFocusUsed = new Set();
        return this._app._workbenchFocusUsed;
    }

    // ── Staging Read/Write ──────────────────────────────────────────────

    /**
     * Read the current staging state for an actor.
     * @param {string} actorId
     * @returns {{ gearItemId: string|null, potionItemIds: string[] }}
     */
    getStaging(actorId) {
        const v = this.staging?.get(actorId);
        return {
            gearItemId: v?.gearItemId ?? null,
            potionItemIds: Array.isArray(v?.potionItemIds) ? [...v.potionItemIds] : []
        };
    }

    /**
     * Merge a partial staging update for an actor.
     * @param {string} actorId
     * @param {{ gearItemId?: string|null, potionItemIds?: string[] }} partial
     */
    setStaging(actorId, partial) {
        if (!this._app._workbenchIdentifyStaging) this._app._workbenchIdentifyStaging = new Map();
        const prev = this.getStaging(actorId);
        const nextGear = partial.gearItemId !== undefined ? partial.gearItemId : prev.gearItemId;
        const resolvedGear = (nextGear && this.focusUsed.has(actorId)) ? prev.gearItemId : nextGear;
        const next = {
            gearItemId: resolvedGear,
            potionItemIds: partial.potionItemIds !== undefined ? [...partial.potionItemIds] : prev.potionItemIds
        };
        if (!next.gearItemId && next.potionItemIds.length === 0) {
            this._app._workbenchIdentifyStaging.delete(actorId);
        } else {
            this._app._workbenchIdentifyStaging.set(actorId, next);
        }
    }

    // ── Context Builder ─────────────────────────────────────────────────

    /**
     * Builds the drag-context payload for the workbench identify station embed.
     * @param {string|null} actorId
     * @param {Function} collectPartyIdentifyEmbedData - Party identify embed helper.
     * @param {Function} getPartyActors - Party actors helper.
     * @returns {object}
     */
    getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors) {
        const empty = {
            workbenchIdentifyActorId: null,
            workbenchGearChip: null,
            workbenchPotionChips: [],
            workbenchSubmitLocked: true,
            workbenchIdentifyAcknowledgement: null,
            workbenchAckRevealReady: true,
            workbenchFocusExhausted: false
        };
        if (!actorId) return empty;
        const actor = game.actors.get(actorId);
        const st = this.getStaging(actorId);
        const resolveChip = itemId => {
            const item = actor?.items.get(itemId);
            if (!item || !itemIsWorkbenchUnidentified(actor, item)) return null;
            return {
                itemId,
                img: item.img || "icons/svg/mystery-man.svg",
                label: item.system?.unidentified?.name || item.name || "Item"
            };
        };
        const workbenchGearChip = st.gearItemId ? resolveChip(st.gearItemId) : null;
        const workbenchPotionChips = st.potionItemIds.map(resolveChip).filter(Boolean);
        const workbenchSubmitLocked = !workbenchGearChip && workbenchPotionChips.length === 0;
        const ack = this.acknowledge?.get(actorId) ?? null;
        const workbenchIdentifyAcknowledgement = ack ? { items: ack.items } : null;
        const workbenchAckRevealReady = !ack || Date.now() >= ack.revealAt;
        const workbenchFocusExhausted = this.focusUsed.has(actorId);
        return {
            workbenchIdentifyActorId: actorId,
            workbenchGearChip,
            workbenchPotionChips,
            workbenchSubmitLocked,
            workbenchIdentifyAcknowledgement,
            workbenchAckRevealReady,
            workbenchFocusExhausted
        };
    }

    // ── Mutations ───────────────────────────────────────────────────────

    /**
     * Player dismisses the post-identify ritual overlay on the workbench station.
     * @param {string} actorId
     */
    dismissAcknowledgement(actorId) {
        if (!actorId || !this.acknowledge?.has(actorId)) return;
        this.acknowledge.delete(actorId);
        notifyWorkbenchIdentifyStagingTouched();
        if (this._app.rendered) this._app.render();
    }

    /**
     * Remove a potion from the staging list.
     * @param {string} actorId
     * @param {string} itemId
     */
    removePotionFromStation(actorId, itemId) {
        const st = this.getStaging(actorId);
        if (!st.potionItemIds.includes(itemId)) return;
        this.setStaging(actorId, {
            gearItemId: st.gearItemId,
            potionItemIds: st.potionItemIds.filter(id => id !== itemId)
        });
        notifyWorkbenchIdentifyStagingTouched();
        if (this._app.rendered) this._app.render();
    }

    /**
     * Submit staged items for identify (ritual animation + reveal).
     * Processes potions first, then gear. Sets acknowledgement with reveal timer.
     * @param {string} actorId
     */
    async submitFromStation(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn("You can only submit identify choices for characters you control.");
            return;
        }
        const st = this.getStaging(actorId);
        if (!st.gearItemId && st.potionItemIds.length === 0) {
            ui.notifications.warn("Drag at least one item onto the circles, then submit.");
            return;
        }
        const order = [...st.potionItemIds];
        if (st.gearItemId) order.push(st.gearItemId);
        const revealed = [];
        for (const itemId of order) {
            const itemBefore = actor.items.get(itemId);
            if (!itemBefore) continue;
            const did = await this.identifyItem(actorId, itemId, { deferNotify: true, deferRender: true });
            if (!did) continue;
            const itemAfter = actor.items.get(itemId);
            revealed.push({
                itemId,
                name: resolveTrueName(actor, itemId, itemBefore.name),
                img: itemAfter?.img ?? itemBefore.img ?? "icons/svg/mystery-man.svg",
                requiresAttunement: !!itemAfter?.system?.attunement
            });
        }
        if (!revealed.length) return;
        this._app._workbenchIdentifyStaging.delete(actorId);
        this._app._workbenchIdentifyAcknowledge.set(actorId, {
            items: revealed,
            revealAt: Date.now() + 900
        });
        if (st.gearItemId) {
            this.focusUsed.add(actorId);
        }
        notifyWorkbenchIdentifyStagingTouched();
        if (this._app.rendered) this._app.render();
    }

    /**
     * Workbench station: taste or focus identify (same rules as main Identify tab).
     * @param {string} actorId
     * @param {string} itemId
     * @param {{ deferNotify?: boolean, deferRender?: boolean }} [options]
     * @returns {Promise<boolean>}
     */
    async identifyItem(actorId, itemId, options = {}) {
        const { deferNotify = false, deferRender = false } = options;
        const actor = game.actors.get(actorId);
        const item = actor?.items?.get(itemId);
        if (!item) return false;

        let identified = false;

        if (game.user.isGM) {
            const qmActive = game.modules?.get("ionrift-quartermaster")?.active;
            if (qmActive) {
                try {
                    const { IdentificationService } = await import(
                        "/modules/ionrift-quartermaster/scripts/services/IdentificationService.js"
                    );
                    const result = await IdentificationService.identify(item, { silent: true });
                    identified = result.identified;
                    console.log(`[Respite] WorkbenchDelegate GM identify: QM result →`, result);
                } catch (err) {
                    console.error("[Respite] WorkbenchDelegate: QM import/identify failed", err);
                    // fall through to raw update
                }
            }
            if (!identified) {
                try {
                    if (game.modules?.get("ionrift-quartermaster")?.active) {
                        await item.update({ "system.identified": true }, { curseBypass: true });
                    } else {
                        await item.update({ "system.identified": true });
                    }
                    identified = true;
                } catch (err) {
                    console.error(`[Respite] Failed to identify item:`, err);
                    if (!deferNotify) ui.notifications.error("Failed to identify item.");
                    return false;
                }
            }
        } else {
            const hasQmPayload = !!(
                item.getFlag?.("ionrift-quartermaster", "latentMagic")
                || item.getFlag?.("ionrift-quartermaster", "cursedMeta")
            );
            const qmActive = game.modules?.get("ionrift-quartermaster")?.active;
            if (hasQmPayload || qmActive) {
                // Route through GM via socket — QM's guardIdentify blocks player
                // writes on managed items. GM runs IdentificationService directly.
                const requestId = foundry.utils.randomID();
                const targetUserId = game.user.id;
                identified = await new Promise((resolve) => {
                    WorkbenchDelegate._pendingIdentifyRequests.set(requestId, resolve);
                    emitWorkbenchIdentifyRequest({ actorId, itemId, requestId, targetUserId });
                    setTimeout(() => {
                        if (WorkbenchDelegate._pendingIdentifyRequests.has(requestId)) {
                            WorkbenchDelegate._pendingIdentifyRequests.delete(requestId);
                            resolve(false);
                        }
                    }, 10000);
                });
                if (identified) {
                    // The GM's item.update() propagates to the player via a separate
                    // Foundry websocket message. Wait for updateItem to confirm the
                    // actor collection is up-to-date before reading trueName/img.
                    await new Promise(resolve => {
                        const hookId = Hooks.once("updateItem", (updatedItem) => {
                            if (updatedItem.id === itemId) resolve();
                        });
                        setTimeout(() => {
                            Hooks.off("updateItem", hookId);
                            console.warn(`[Respite] Workbench: updateItem sync timed out for item=${itemId}, proceeding anyway`);
                            resolve();
                        }, 3000);
                    });
                }
            } else {
                try {
                    await item.update({ "system.identified": true });
                    identified = true;
                } catch (err) {
                    console.error(`[Respite] Failed to identify item:`, err);
                    if (!deferNotify) ui.notifications.error("Failed to identify item.");
                    return false;
                }
            }
        }

        if (!identified) {
            if (!deferNotify) ui.notifications.error("Failed to identify item.");
            return false;
        }

        const trueName = resolveTrueName(actor, itemId, item.name);
        const fresh = actor.items.get(itemId);
        if (!this._app._identifiedItems) this._app._identifiedItems = [];
        this._app._identifiedItems.push({
            itemId,
            actorId,
            name: trueName,
            img: fresh?.img ?? item.img,
            actorName: actor.name,
            requiresAttunement: !!fresh?.system?.attunement
        });
        if (!deferNotify) ui.notifications.info(`${trueName} identified by ${actor.name}.`);
        if (!deferRender) this._app.render();
        return true;
    }

    /**
     * Clears staging and acknowledgement Maps (used on scan session clear).
     */
    clearAll() {
        this.staging?.clear();
        this.acknowledge?.clear();
        this.focusUsed.clear();
    }

    // ── Drag-Drop Binding ───────────────────────────────────────────────

    /**
     * Binds drag-over, dragleave, drop, and click handlers to the
     * workbench identify drop zones inside the given element.
     * @param {HTMLElement} el - Container element (station dialog or main UI).
     */
    bindDragDrop(el) {
        if (!el) return;
        const embed = el.querySelector(".station-workbench-identify-embed[data-workbench-actor-id]");
        if (!embed) return;
        if (embed.querySelector(".wb-ident-ack-overlay")) return;
        const actorId = embed.dataset.workbenchActorId;
        if (!actorId) return;

        embed.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
        embed.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));

        const bump = () => {
            notifyWorkbenchIdentifyStagingTouched();
            if (this._app.rendered) this._app.render();
        };

        const validateDrop = (itemId, zone) => {
            const actor = game.actors.get(actorId);
            if (!actor?.isOwner && !game.user.isGM) {
                return { ok: false, msg: "You can only arrange choices for characters you control." };
            }
            const item = actor.items.get(itemId);
            if (!item) return { ok: false, msg: "Item not found." };
            if (!itemIsWorkbenchUnidentified(actor, item)) {
                return { ok: false, msg: "That item is already identified or cannot be focused here." };
            }
            const isPotion = itemIsDnD5ePotionType(item);
            if (zone === "gear" && isPotion) {
                return { ok: false, msg: "Drop potions onto the potion circle." };
            }
            if (zone === "potion" && !isPotion) {
                return { ok: false, msg: "Drop that item onto the focus circle." };
            }
            return { ok: true };
        };

        const assignGear = itemId => {
            if (this.focusUsed.has(actorId)) {
                ui.notifications.info("Focus identify already used this rest for this character.");
                return;
            }
            const v = validateDrop(itemId, "gear");
            if (!v.ok) {
                ui.notifications.warn(v.msg);
                return;
            }
            const st = this.getStaging(actorId);
            this.setStaging(actorId, { gearItemId: itemId, potionItemIds: st.potionItemIds });
            bump();
        };

        const appendPotion = itemId => {
            const v = validateDrop(itemId, "potion");
            if (!v.ok) {
                ui.notifications.warn(v.msg);
                return;
            }
            const st = this.getStaging(actorId);
            if (st.potionItemIds.includes(itemId)) {
                ui.notifications.info("That potion is already in the taste list.");
                return;
            }
            this.setStaging(actorId, {
                gearItemId: st.gearItemId,
                potionItemIds: [...st.potionItemIds, itemId]
            });
            bump();
        };

        const zones = embed.querySelectorAll(".wb-ident-drop-zone");
        for (const zone of zones) {
            if (zone._wbIdentBound) continue;
            zone._wbIdentBound = true;
            const zoneType = zone.dataset.wbZone;
            if (!zoneType) continue;

            zone.addEventListener("dragover", e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                zone.classList.add("drop-hover");
            });
            zone.addEventListener("dragleave", () => zone.classList.remove("drop-hover"));
            zone.addEventListener("drop", async e => {
                e.preventDefault();
                zone.classList.remove("drop-hover");
                const raw = e.dataTransfer?.getData("text/plain") ?? "";
                if (raw.startsWith("wbident:")) {
                    const parts = raw.split(":");
                    if (parts.length < 4) return;
                    const dragSlot = parts[1];
                    const itemId = parts[2];
                    const dragActorId = parts[3];
                    if (dragActorId !== actorId) return;
                    if (dragSlot === "potion" && zoneType === "potion") appendPotion(itemId);
                    else if (dragSlot === "gear" && zoneType === "gear") assignGear(itemId);
                    else if (dragSlot === "potion" && zoneType === "gear") {
                        ui.notifications.warn("Drop potions onto the potion circle.");
                    } else if (dragSlot === "gear" && zoneType === "potion") {
                        ui.notifications.warn("Drop that item onto the focus circle.");
                    }
                    return;
                }
                const item = await resolveItemFromDropEvent(e);
                if (!item) {
                    ui.notifications.warn("Could not read that drop. Drag from this character's inventory on the sheet.");
                    return;
                }
                if (item.parent?.id !== actorId) {
                    ui.notifications.warn("Drop an item that belongs to this character's sheet.");
                    return;
                }
                if (zoneType === "gear") assignGear(item.id);
                else appendPotion(item.id);
            });

            if (zoneType === "gear") {
                zone.addEventListener("click", () => {
                    const st = this.getStaging(actorId);
                    if (!st.gearItemId) return;
                    this.setStaging(actorId, { gearItemId: null, potionItemIds: st.potionItemIds });
                    bump();
                });
            }
        }
    }

    // ── Serialization ───────────────────────────────────────────────────

    /**
     * Returns workbench identify state for snapshot/save.
     * @returns {object}
     */
    serialize() {
        return {
            staging: Array.from(this.staging?.entries?.() ?? []),
            acknowledge: Array.from(this.acknowledge?.entries?.() ?? []),
            focusUsed: Array.from(this.focusUsed)
        };
    }

    /**
     * Restores workbench identify state from a snapshot/save.
     * @param {object} state
     */
    restore(state) {
        if (!state) return;
        this._app._workbenchIdentifyStaging = new Map(state.staging ?? []);
        this._app._workbenchIdentifyAcknowledge = new Map(state.acknowledge ?? []);
        this._app._workbenchFocusUsed = new Set(state.focusUsed ?? []);
    }
}

/** @type {Map<string, (success: boolean) => void>} */
WorkbenchDelegate._pendingIdentifyRequests = new Map();

/** Called by SocketRouter when the GM workbench identify result arrives. */
WorkbenchDelegate._resolveIdentifyRequest = function resolveIdentifyRequest(requestId, success) {
    const resolve = WorkbenchDelegate._pendingIdentifyRequests.get(requestId);
    if (resolve) {
        WorkbenchDelegate._pendingIdentifyRequests.delete(requestId);
        resolve(success);
    }
};
