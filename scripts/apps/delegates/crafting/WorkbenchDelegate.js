import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import {
    notifyWorkbenchIdentifyStagingTouched
} from "../../camp/StationActivityDialog.js";
import { emitWorkbenchIdentifyRequest } from "../../../services/socket/SocketController.js";
import {
    buildArcaneWorkbenchAccess,
    collectPartyIdentifyEmbedData,
    computeCanShowDetectMagicScanButton,
    computeCanTriggerDetectMagicScan,
    getDetectMagicDisabledTooltip,
    getDetectMagicPlayerAccessReason
} from "./DetectMagicDelegate.js";
import {
    DETECT_MAGIC_BTN_LABEL_DISMISS,
    DETECT_MAGIC_BTN_LABEL_GM,
    DETECT_MAGIC_BTN_LABEL_PLAYER,
    DETECT_MAGIC_BTN_TITLE_GM
} from "../../../data/RestConstants.js";
import { itemIsDnD5ePotionType, resolveItemFromDropEvent } from "../../../utils/itemDropUtils.js";
import {
    canStageFocus,
    canStageIdentify,
    validateWorkbenchZoneDrop
} from "./WorkbenchZoneRules.js";

/**
 * Unidentified for workbench: dnd5e identified===false, Quartermaster latent mask,
 * or infected stack still awaiting Identify split.
 */
function itemIsWorkbenchUnidentified(actor, item) {
    if (!item || !actor?.items?.has(item.id)) return false;
    const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
    if (!validTypes.has(item.type)) return false;
    const infectedCount = Number(item.getFlag?.("ionrift-quartermaster", "infectedCount") ?? 0) || 0;
    if (infectedCount > 0) return true;
    const raw = item.toObject?.()?.system ?? {};
    const identifiedLive = item.system?.identified;
    const identifiedRaw = raw.identified;
    const summarise = game.ionrift?.workshop?.getLatentSummary ?? null;
    const quartermasterLatent = summarise?.(item);
    // Only QM-masked if QM says not yet identified. Promoted cursed lure (identified=true) stays off the workbench.
    const isQmMasked = !!quartermasterLatent
        && !quartermasterLatent.identified
        && quartermasterLatent.kind !== "mundane";
    const isNativeUnidentified = identifiedLive === false || identifiedRaw === false;
    return isQmMasked || isNativeUnidentified;
}

/** True name after identify (live item, else Quartermaster latent). */
function resolveTrueName(actor, itemId, fallbackName) {
    const fresh = actor.items.get(itemId);
    if (!fresh) return fallbackName;
    const qmSummary = game.ionrift?.workshop?.getLatentSummary?.(fresh);
    if (qmSummary?.trueName) return qmSummary.trueName;
    return fresh.name || fallbackName;
}

export class WorkbenchDelegate {

    constructor(app) {
        this._app = app;
    }

    get staging() { return this._app._workbenchIdentifyStaging; }

    get acknowledge() { return this._app._workbenchIdentifyAcknowledge; }

    get focusUsed() {
        if (!this._app._workbenchFocusUsed) this._app._workbenchFocusUsed = new Set();
        return this._app._workbenchFocusUsed;
    }

    get submitPending() {
        if (!this._app._workbenchIdentifySubmitPending) {
            this._app._workbenchIdentifySubmitPending = new Set();
        }
        return this._app._workbenchIdentifySubmitPending;
    }

        getStaging(actorId) {
        const v = this.staging?.get(actorId);
        return {
            gearItemId: v?.gearItemId ?? null,
            gearActorId: v?.gearActorId ?? null,
            potionItemId: v?.potionItemId ?? null,
            spellItemId: v?.spellItemId ?? null,
            spellActorId: v?.spellActorId ?? null
        };
    }

        setStaging(actorId, partial) {
        if (!this._app._workbenchIdentifyStaging) this._app._workbenchIdentifyStaging = new Map();
        const prev = this.getStaging(actorId);
        const nextGear = partial.gearItemId !== undefined ? partial.gearItemId : prev.gearItemId;
        const resolvedGear = (nextGear && this.focusUsed.has(actorId)) ? prev.gearItemId : nextGear;
        const nextGearActorId = resolvedGear
            ? (partial.gearActorId !== undefined ? partial.gearActorId : prev.gearActorId)
            : null;
        const nextSpell = partial.spellItemId !== undefined ? partial.spellItemId : prev.spellItemId;
        const nextSpellActorId = nextSpell
            ? (partial.spellActorId !== undefined ? partial.spellActorId : prev.spellActorId)
            : null;
        const next = {
            gearItemId: resolvedGear,
            gearActorId: nextGearActorId,
            potionItemId: partial.potionItemId !== undefined ? partial.potionItemId : prev.potionItemId,
            spellItemId: nextSpell,
            spellActorId: nextSpellActorId
        };
        if (!next.gearItemId && !next.potionItemId && !next.spellItemId) {
            this._app._workbenchIdentifyStaging.delete(actorId);
        } else {
            this._app._workbenchIdentifyStaging.set(actorId, next);
        }
    }

        buildEmbedContext(actorId, getPartyActors) {
        const party = getPartyActors();
        const partyData = collectPartyIdentifyEmbedData(party);
        const wb = this.getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors);
        const app = this._app;
        const isGmUser = !!(game.user?.isGM || app._isGM);
        const scanComplete = !!app._magicScanComplete;
        const magicScanActive = scanComplete;
        const focusActor = game.actors.get(actorId) ?? null;
        const arcane = buildArcaneWorkbenchAccess(focusActor, { magicScanActive, isGmUser });
        const canTriggerDetectMagicScan = magicScanActive
            ? true
            : (isGmUser || computeCanTriggerDetectMagicScan(party));
        const detectMagicDisabledTooltip = canTriggerDetectMagicScan
            ? ""
            : getDetectMagicDisabledTooltip(party, focusActor);
        return {
            ...partyData,
            ...wb,
            ...arcane,
            isGmUser,
            magicScanActive,
            canShowDetectMagicScanButton: computeCanShowDetectMagicScanButton(party) || isGmUser,
            canTriggerDetectMagicScan,
            detectMagicDisabledTooltip,
            detectMagicScanButtonLabel: scanComplete
                ? DETECT_MAGIC_BTN_LABEL_DISMISS
                : (isGmUser ? DETECT_MAGIC_BTN_LABEL_GM : DETECT_MAGIC_BTN_LABEL_PLAYER),
            detectMagicScanButtonTitle: magicScanActive
                ? "Dismiss scan"
                : (isGmUser
                    ? DETECT_MAGIC_BTN_TITLE_GM
                    : (detectMagicDisabledTooltip || getDetectMagicPlayerAccessReason(party) || "")),
            magicScanResults: app._magicScanResults ?? [],
            magicScanComplete: scanComplete
        };
    }

    getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors) {
        const empty = {
            workbenchIdentifyActorId: null,
            workbenchGearChip: null,
            workbenchPotionChip: null,
            workbenchSpellChip: null,
            workbenchSubmitLocked: true,
            workbenchSubmitPending: false,
            workbenchIdentifyAcknowledgement: null,
            workbenchAckRevealReady: true,
            workbenchFocusExhausted: false
        };
        if (!actorId) return empty;
        const actor = game.actors.get(actorId);
        const st = this.getStaging(actorId);
        // Gear chip may belong to a different actor (shared pool cross-identify)
        const resolveGearChip = (itemId, gearActorId) => {
            const owner = gearActorId ? game.actors.get(gearActorId) : actor;
            const item = owner?.items.get(itemId);
            if (!item) return null;
            // Accept any item; already-identified still stages so zones don't leak mundane vs magical.
            const isUnidentified = itemIsWorkbenchUnidentified(owner, item);
            return {
                itemId,
                gearActorId: owner?.id ?? actorId,
                img: item.img || "icons/svg/mystery-man.svg",
                label: (isUnidentified ? (item.system?.unidentified?.name || item.name) : item.name) || "Item",
                ownerName: owner?.name ?? "",
                alreadyIdentified: !isUnidentified
            };
        };
        const resolvePotionChip = itemId => {
            const item = actor?.items.get(itemId);
            if (!item || !itemIsDnD5ePotionType(item)) return null;
            return {
                itemId,
                img: item.img || "icons/svg/mystery-man.svg",
                label: item.name || "Potion"
            };
        };
        const resolveSpellChip = (itemId, spellActorId) => {
            const owner = spellActorId ? game.actors.get(spellActorId) : actor;
            const item = owner?.items.get(itemId);
            if (!item) return null;
            const isUnidentified = itemIsWorkbenchUnidentified(owner, item);
            return {
                itemId,
                spellActorId: owner?.id ?? actorId,
                img: item.img || "icons/svg/mystery-man.svg",
                label: (isUnidentified ? (item.system?.unidentified?.name || item.name) : item.name) || "Item",
                ownerName: owner?.name ?? "",
                alreadyIdentified: !isUnidentified
            };
        };
        const workbenchGearChip = st.gearItemId ? resolveGearChip(st.gearItemId, st.gearActorId) : null;
        const workbenchPotionChip = st.potionItemId ? resolvePotionChip(st.potionItemId) : null;
        const workbenchSpellChip = st.spellItemId ? resolveSpellChip(st.spellItemId, st.spellActorId) : null;
        const workbenchSubmitPending = this.submitPending.has(actorId);
        const workbenchSubmitLocked = workbenchSubmitPending
            || (!workbenchGearChip && !workbenchPotionChip && !workbenchSpellChip);
        const ack = this.acknowledge?.get(actorId) ?? null;
        const workbenchIdentifyAcknowledgement = ack ? { items: ack.items } : null;
        const workbenchAckRevealReady = !ack || Date.now() >= ack.revealAt;
        const workbenchFocusExhausted = this.focusUsed.has(actorId);
        return {
            workbenchIdentifyActorId: actorId,
            workbenchGearChip,
            workbenchPotionChip,
            workbenchSpellChip,
            workbenchSubmitLocked,
            workbenchSubmitPending,
            workbenchIdentifyAcknowledgement,
            workbenchAckRevealReady,
            workbenchFocusExhausted
        };
    }

        dismissAcknowledgement(actorId) {
        if (!actorId || !this.acknowledge?.has(actorId)) return;
        this.acknowledge.delete(actorId);
    notifyWorkbenchIdentifyStagingTouched();
        if (this._app.rendered) this._app.render();
    }

    removePotionFromStation(actorId) {
        const st = this.getStaging(actorId);
        if (!st.potionItemId) return;
        this.setStaging(actorId, { gearItemId: st.gearItemId, potionItemId: null });
    notifyWorkbenchIdentifyStagingTouched();
        if (this._app.rendered) this._app.render();
    }

        async submitFromStation(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn("You can only submit identify choices for characters you control.");
            return;
        }
        if (this.submitPending.has(actorId)) return;
        const st = this.getStaging(actorId);
        if (!st.gearItemId && !st.potionItemId && !st.spellItemId) {
            ui.notifications.warn("Drag at least one item onto the circles, then submit.");
            return;
        }
        const arcane = buildArcaneWorkbenchAccess(actor, {
            isGmUser: !!(game.user?.isGM || this._app?._isGM)
        });
        if (st.spellItemId && !arcane.identifyAvailable && !game.user?.isGM) {
            ui.notifications.warn("Requires the Identify spell.");
            return;
        }
        this.submitPending.add(actorId);
        this._notifySubmitPendingChange();
        try {
            // (may belong to a different actor in shared pool mode)
            const order = [];
            if (st.potionItemId) {
                order.push({ itemId: st.potionItemId, ownerActorId: actorId, intent: "taste" });
            }
            if (st.gearItemId) {
                order.push({
                    itemId: st.gearItemId,
                    ownerActorId: st.gearActorId || actorId,
                    intent: "focus"
                });
            }
            if (st.spellItemId) {
                order.push({
                    itemId: st.spellItemId,
                    ownerActorId: st.spellActorId || actorId,
                    intent: "identify"
                });
            }
            const revealed = [];
            for (const { itemId, ownerActorId, intent } of order) {
                const ownerActor = game.actors.get(ownerActorId);
                if (!ownerActor) continue;
                const itemBefore = ownerActor.items.get(itemId);
                if (!itemBefore) continue;
                const result = await this.identifyItem(ownerActorId, itemId, {
                    deferNotify: true,
                    deferRender: true,
                    intent
                });
                if (!result?.identified) continue;
                if (Array.isArray(result.items) && result.items.length) {
                    for (const row of result.items) {
                        revealed.push({
                            itemId: row.itemId,
                            ownerActorId: row.ownerActorId ?? ownerActorId,
                            name: row.name,
                            img: row.img ?? "icons/svg/mystery-man.svg",
                            requiresAttunement: false
                        });
                    }
                } else {
                    const itemAfter = ownerActor.items.get(itemId);
                    const trueName = resolveTrueName(ownerActor, itemId, itemBefore.name);
                    revealed.push({
                        itemId,
                        ownerActorId,
                        name: trueName,
                        img: itemAfter?.img ?? itemBefore.img ?? "icons/svg/mystery-man.svg",
                        requiresAttunement: (att => att === "required" || att === 1)(itemAfter?.system?.attunement)
                    });
                }
                // Notify the item owner when a different caster identifies their item
                if (ownerActorId !== actorId) {
                    const ownerUsers = game.users.filter(
                        u => !u.isGM && ownerActor.testUserPermission(u, "OWNER")
                    );
                    if (ownerUsers.length > 0) {
                        const names = (result.items ?? []).map(r => r.name).filter(Boolean);
                        const label = names.length
                            ? names.join(", ")
                            : resolveTrueName(ownerActor, itemId, itemBefore.name);
                        ChatMessage.create({
                            content: `<div class="ionrift-identify-reveal"><i class="fas fa-hat-wizard"></i> <strong>${actor.name}</strong> identified your <strong>${label}</strong>.</div>`,
                            speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
                            whisper: ownerUsers.map(u => u.id)
                        });
                    }
                }
            }
            if (!revealed.length) {
                if (!game.user.isGM) {
                    ui.notifications.error("Identify failed. Try again or ask the GM.");
                }
                return;
            }
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
            // "Wait..." button transitions to "Continue" automatically.
            const REVEAL_MS = 950;
            setTimeout(() => {
                if (this._app.rendered && this.acknowledge?.has(actorId)) {
                    this._app.render();
                }
            }, REVEAL_MS);
        } finally {
            if (this.submitPending.delete(actorId)) {
                this._notifySubmitPendingChange();
            }
        }
    }

    _notifySubmitPendingChange() {
    notifyWorkbenchIdentifyStagingTouched();
        if (this._app.rendered) this._app.render();
    }

    
    /**
     * @returns {Promise<{identified: boolean, items?: object[]}|null>}
     */
    async identifyItem(actorId, itemId, options = {}) {
        const { deferNotify = false, deferRender = false, intent = "identify" } = options;
        const normalizedIntent = intent === "taste" || intent === "focus" || intent === "identify"
            ? intent
            : "identify";
        const actor = game.actors.get(actorId);
        const item = actor?.items?.get(itemId);
        if (!item) return null;

        let identified = false;
        /** @type {object[]|null} */
        let resultItems = null;

        if (game.user.isGM) {
            const qmActive = game.modules?.get("ionrift-quartermaster")?.active;
            if (qmActive) {
                try {
                    const { IdentificationService } = await import(
                        "/modules/ionrift-quartermaster/scripts/services/identify/IdentificationService.js"
                    );
                    const result = await IdentificationService.identify(item, {
                        silent: true,
                        intent: normalizedIntent
                    });
                    identified = !!result.identified;
                    if (identified && Array.isArray(result.items) && result.items.length) {
                        resultItems = result.items;
                    }
                    Logger.log(`[Respite] WorkbenchDelegate GM identify: QM result`, result);
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
                    return null;
                }
            }
        } else {
            const hasQmPayload = !!(
                item.getFlag?.("ionrift-quartermaster", "latentMagic")
                || item.getFlag?.("ionrift-quartermaster", "cursedMeta")
                || (Number(item.getFlag?.("ionrift-quartermaster", "infectedCount") ?? 0) || 0) > 0
            );
            const qmActive = game.modules?.get("ionrift-quartermaster")?.active;
            if (hasQmPayload || qmActive) {
                // Route through GM via socket; QM's guardIdentify blocks player
                // writes on managed items. GM runs IdentificationService directly.
                const requestId = foundry.utils.randomID();
                const targetUserId = game.user.id;
                const socketResult = await new Promise((resolve) => {
                    WorkbenchDelegate._pendingIdentifyRequests.set(requestId, resolve);
                    emitWorkbenchIdentifyRequest({
                        actorId,
                        itemId,
                        requestId,
                        targetUserId,
                        intent: normalizedIntent
                    });
                    setTimeout(() => {
                        if (WorkbenchDelegate._pendingIdentifyRequests.has(requestId)) {
                            WorkbenchDelegate._pendingIdentifyRequests.delete(requestId);
                            resolve(false);
                        }
                    }, 10000);
                });
                if (socketResult && typeof socketResult === "object") {
                    identified = !!socketResult.success;
                    if (Array.isArray(socketResult.items) && socketResult.items.length) {
                        resultItems = socketResult.items;
                    }
                } else {
                    identified = !!socketResult;
                }
                if (identified) {
                    // Sync actor collection after GM update/create (infected split may create).
                    await new Promise(resolve => {
                        let settled = false;
                        const done = () => {
                            if (settled) return;
                            settled = true;
                            resolve();
                        };
                        const updateHookId = Hooks.on("updateItem", (updatedItem) => {
                            if (updatedItem.id === itemId || updatedItem.parent?.id === actorId) {
                                Hooks.off("updateItem", updateHookId);
                                done();
                            }
                        });
                        const createHookId = Hooks.on("createItem", (createdItem) => {
                            if (createdItem.parent?.id === actorId) {
                                Hooks.off("createItem", createHookId);
                                done();
                            }
                        });
                        setTimeout(() => {
                            Hooks.off("updateItem", updateHookId);
                            Hooks.off("createItem", createHookId);
                            console.warn(`[Respite] Workbench: item sync timed out for item=${itemId}, proceeding anyway`);
                            done();
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
                    return null;
                }
            }
        }

        if (!identified) {
            if (!deferNotify) ui.notifications.error("Failed to identify item.");
            return null;
        }

        if (!resultItems) {
            const trueName = resolveTrueName(actor, itemId, item.name);
            const fresh = actor.items.get(itemId);
            resultItems = [{
                itemId,
                ownerActorId: actorId,
                name: trueName,
                img: fresh?.img ?? item.img ?? "icons/svg/mystery-man.svg"
            }];
            if (!deferNotify) ui.notifications.info(`${trueName} identified by ${actor.name}.`);
        } else if (!deferNotify) {
            const label = resultItems.map(r => r.name).filter(Boolean).join(", ");
            ui.notifications.info(`${label} identified by ${actor.name}.`);
        }
        if (!deferRender) this._app.render();
        return { identified: true, items: resultItems };
    }

    clearAll() {
        this.staging?.clear();
        this.acknowledge?.clear();
        this.focusUsed.clear();
        this.submitPending.clear();
    }

        bindDragDrop(el) {
        if (!el) { console.warn(`[Respite:Workbench] bindDragDrop: no element`); return; }
        const embed = el.querySelector(".station-workbench-identify-embed[data-workbench-actor-id]");
        if (!embed) { console.warn(`[Respite:Workbench] bindDragDrop: no embed element found in`, el); return; }
        if (embed.querySelector(".wb-ident-ack-overlay")) { Logger.log(`[Respite:Workbench] bindDragDrop: ack overlay active, skipping`); return; }
        const actorId = embed.dataset.workbenchActorId;
        if (!actorId) { console.warn(`[Respite:Workbench] bindDragDrop: no actorId on embed`); return; }
        if (this.submitPending.has(actorId)) { Logger.log(`[Respite:Workbench] bindDragDrop: submit pending, skipping`); return; }

        Logger.log(`[Respite:Workbench] bindDragDrop: binding for actor ${actorId}`);

        embed.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
        embed.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));

        const bump = () => {
            notifyWorkbenchIdentifyStagingTouched();
            if (this._app.rendered) this._app.render();
        };

        // Shared-pool drops: itemActorId may differ from workbench actor.
        const validateDrop = (itemId, zone, itemActorId) => {
            const itemOwner = itemActorId ? game.actors.get(itemActorId) : game.actors.get(actorId);
            if (!itemOwner) return { ok: false, msg: "Item owner not found." };
            // Own items need ownership; shared-pool items are identified on behalf of the owner.
            const isOwnItem = !itemActorId || itemActorId === actorId;
            if (isOwnItem) {
                const casterActor = game.actors.get(actorId);
                if (!casterActor?.isOwner && !game.user.isGM) {
                    return { ok: false, msg: "You can only arrange choices for characters you control." };
                }
            }
            const item = itemOwner.items.get(itemId);
            if (!item) return { ok: false, msg: "Item not found." };
            return validateWorkbenchZoneDrop({
                zone,
                isPotion: itemIsDnD5ePotionType(item)
            });
        };

        const assignGear = (itemId, itemActorId) => {
            const focusGate = canStageFocus({ focusUsed: this.focusUsed.has(actorId) });
            if (!focusGate.ok) {
                ui.notifications.info(focusGate.msg);
                return;
            }
            const v = validateDrop(itemId, "gear", itemActorId);
            if (!v.ok) {
                ui.notifications.warn(v.msg);
                return;
            }
            const st = this.getStaging(actorId);
            this.setStaging(actorId, {
                gearItemId: itemId,
                gearActorId: itemActorId || actorId,
                potionItemId: st.potionItemId,
                spellItemId: st.spellItemId,
                spellActorId: st.spellActorId
            });
            bump();
        };

        const setPotion = itemId => {
            const v = validateDrop(itemId, "potion");
            if (!v.ok) {
                ui.notifications.warn(v.msg);
                return;
            }
            const st = this.getStaging(actorId);
            this.setStaging(actorId, {
                gearItemId: st.gearItemId,
                gearActorId: st.gearActorId,
                potionItemId: itemId,
                spellItemId: st.spellItemId,
                spellActorId: st.spellActorId
            });
            bump();
        };

        const assignSpell = (itemId, itemActorId) => {
            const caster = game.actors.get(actorId);
            const isGmUser = !!(game.user?.isGM || this._app?._isGM);
            const access = buildArcaneWorkbenchAccess(caster, { isGmUser });
            const idGate = canStageIdentify({
                identifyAvailable: access.identifyAvailable,
                isGm: isGmUser
            });
            if (!idGate.ok) {
                ui.notifications.warn(access.identifyAccess.tooltip || idGate.msg);
                return;
            }
            const v = validateDrop(itemId, "spell", itemActorId);
            if (!v.ok) {
                ui.notifications.warn(v.msg);
                return;
            }
            const st = this.getStaging(actorId);
            this.setStaging(actorId, {
                gearItemId: st.gearItemId,
                gearActorId: st.gearActorId,
                potionItemId: st.potionItemId,
                spellItemId: itemId,
                spellActorId: itemActorId || actorId
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
                Logger.log(`[Respite:Workbench] drop event on zone=${zoneType}`, { raw: raw.substring(0, 80), actorId });

                if (raw.startsWith("wbident:")) {
                    const parts = raw.split(":");
                    if (parts.length < 4) return;
                    const dragSlot = parts[1];
                    const itemId = parts[2];
                    const dragActorId = parts[3];
                    if (dragActorId !== actorId) return;
                    if (dragSlot === "potion" && zoneType === "potion") setPotion(itemId);
                    else if (dragSlot === "gear" && zoneType === "gear") assignGear(itemId);
                    else if (dragSlot === "spell" && zoneType === "spell") assignSpell(itemId);
                    else if (dragSlot === "potion" && zoneType === "gear") {
                        ui.notifications.warn("Drop potions onto the Taste circle.");
                    } else if (dragSlot === "gear" && zoneType === "potion") {
                        ui.notifications.warn("Drop that item onto the Focus circle.");
                    }
                    return;
                }
                const item = await resolveItemFromDropEvent(e);
                Logger.log(`[Respite:Workbench] resolveItemFromDropEvent =>`, { found: !!item, itemName: item?.name, parentId: item?.parent?.id, expectedActorId: actorId });
                if (!item) {
                    ui.notifications.warn("Could not read that drop. Drag from this character's inventory on the sheet.");
                    return;
                }
                if (item.parent?.id !== actorId) {
                    console.warn(`[Respite:Workbench] item parent mismatch: item.parent.id=${item.parent?.id}, expected=${actorId}`);
                    ui.notifications.warn("Drop an item that belongs to this character's sheet.");
                    return;
                }
                if (zoneType === "gear") assignGear(item.id);
                else if (zoneType === "potion") setPotion(item.id);
                else if (zoneType === "spell") assignSpell(item.id);
            });

            if (zoneType === "gear") {
                zone.addEventListener("click", () => {
                    const st = this.getStaging(actorId);
                    if (!st.gearItemId) return;
                    this.setStaging(actorId, {
                        gearItemId: null,
                        potionItemId: st.potionItemId,
                        spellItemId: st.spellItemId,
                        spellActorId: st.spellActorId
                    });
                    bump();
                });
            }
            if (zoneType === "potion") {
                zone.addEventListener("click", () => {
                    const st = this.getStaging(actorId);
                    if (!st.potionItemId) return;
                    this.setStaging(actorId, {
                        gearItemId: st.gearItemId,
                        gearActorId: st.gearActorId,
                        potionItemId: null,
                        spellItemId: st.spellItemId,
                        spellActorId: st.spellActorId
                    });
                    bump();
                });
            }
            if (zoneType === "spell") {
                zone.addEventListener("click", () => {
                    const st = this.getStaging(actorId);
                    if (!st.spellItemId) return;
                    this.setStaging(actorId, {
                        gearItemId: st.gearItemId,
                        gearActorId: st.gearActorId,
                        potionItemId: st.potionItemId,
                        spellItemId: null
                    });
                    bump();
                });
            }
        }
    }

    serialize() {
        return {
            staging: Array.from(this.staging?.entries?.() ?? []),
            acknowledge: Array.from(this.acknowledge?.entries?.() ?? []),
            focusUsed: Array.from(this.focusUsed)
        };
    }

    restore(state) {
        if (!state) return;
        this._app._workbenchIdentifyStaging = new Map(state.staging ?? []);
        this._app._workbenchIdentifyAcknowledge = new Map(state.acknowledge ?? []);
        this._app._workbenchFocusUsed = new Set(state.focusUsed ?? []);
    }
}

WorkbenchDelegate._pendingIdentifyRequests = new Map();

WorkbenchDelegate._resolveIdentifyRequest = function resolveIdentifyRequest(requestId, success) {
    const resolve = WorkbenchDelegate._pendingIdentifyRequests.get(requestId);
    if (resolve) {
        WorkbenchDelegate._pendingIdentifyRequests.delete(requestId);
    resolve(success);
    }
};
