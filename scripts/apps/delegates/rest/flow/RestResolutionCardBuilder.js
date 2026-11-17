import { Logger } from "../../../../utils/Logger.js";
import { ItemOutcomeHandler } from "../../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import { GrantLedger } from "../../../../services/crafting/outcomes/GrantLedger.js";
import {
    clearCampTokens,
    getCampSceneId,
    resetCampSession
} from "../../../../services/camp/props/CompoundCampPlacer.js";
import {
    emitRestAbandoned
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { confirmAbandonRest } from "../../../rest/confirmAbandonRest.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { TerrainRegistry } from "../../../../services/events/resolve/TerrainRegistry.js";
import { ImageResolver } from "../../../../utils/ImageResolver.js";

export const RestResolutionCardMethods = {
    rehydrateItemLossProposal(eff) {
        if (this._app?._events?.rehydrateItemLossProposal) {
            return this._app._events.rehydrateItemLossProposal(eff);
        }
        const candidates = [];
        for (const li of (eff._lockedItems ?? [])) {
            const actor = game.actors.get(li.actorId);
            const item = actor?.items?.get(li.itemId);
            if (!actor || !item) continue;
            candidates.push({
                actor,
                item,
                currentQty: item.system?.quantity ?? li.currentQty ?? 1,
                lossQty: li.lossQty
            });
        }
        return {
            type: "item_at_risk",
            candidates,
            narrative: eff.narrative ?? "Some items were lost.",
            severity: eff.severity ?? 1
        };
    },

    _sanitizeItemLabel(raw) {
        if (!raw) return "";
        return String(raw)
            .replace(/\s*\([a-z0-9]{4,8}\)$/i, "")
            .replace(/\s*\[[a-z0-9]{4,8}\]$/i, "")
            .trim();
    },

    async showResourceLossApproval(unified) {
        const app = this._app;

        const { supplyProposals, itemAtRiskProposals, goldProposals } = unified;

        // Track all checkable entries for tally
        const allEntries = [];

        // Collect all loss rows keyed by actorId
        // Each entry: { uid, actorId, actorName, img, name, qtyLabel, rangeLabel }
        const byActor = new Map();

        function ensureActor(actorId, actorName) {
            if (!byActor.has(actorId)) {
                const actor = game.actors.get(actorId);
                byActor.set(actorId, {
                    name: actor?.name ?? actorName,
                    img: actor?.img ?? "icons/svg/mystery-man.svg",
                    rows: []
                });
            }
            return byActor.get(actorId);
        }

        for (const proposal of supplyProposals) {
            for (const entry of proposal.breakdown) {
                const uid = `supply-${entry.actorId}-${entry.itemId}`;
                const actor = game.actors.get(entry.actorId);
                const item = actor?.items.get(entry.itemId);
                const img = item?.img ?? "icons/containers/bags/pack-leather-brown.webp";
                const cleanName = this._sanitizeItemLabel(item?.name ?? entry.itemName ?? "Supplies");
                const remaining = Math.max(0, entry.currentQty - entry.lossQty);
                entry._uid = uid;
                entry.img = img;
                allEntries.push({ uid });
                ensureActor(entry.actorId, entry.actorName).rows.push({
                    uid,
                    img,
                    name: cleanName,
                    qtyLabel: `-${entry.lossQty}`,
                    rangeLabel: `${entry.currentQty} &rarr; ${remaining}`
                });
            }
        }

        for (const proposal of itemAtRiskProposals) {
            for (const candidate of proposal.candidates) {
                const uid = `item-${candidate.actor.id}-${candidate.item.id}`;
                candidate._uid = uid;
                const cleanName = this._sanitizeItemLabel(candidate.item.name);
                const remaining = Math.max(0, candidate.currentQty - candidate.lossQty);
                allEntries.push({ uid });
                ensureActor(candidate.actor.id, candidate.actor.name).rows.push({
                    uid,
                    img: candidate.item.img ?? "icons/svg/mystery-man.svg",
                    name: cleanName,
                    qtyLabel: candidate.lossQty > 1 ? `-${candidate.lossQty}` : "Lost",
                    rangeLabel: candidate.currentQty > 1 ? `${candidate.currentQty} &rarr; ${remaining}` : "Destroyed"
                });
            }
        }

        for (const proposal of goldProposals) {
            for (const entry of proposal.breakdown) {
                const uid = `gold-${entry.actorId}`;
                entry._uid = uid;
                const remaining = Math.max(0, entry.currentGp - entry.lossGp);
                allEntries.push({ uid });
                ensureActor(entry.actorId, entry.actorName).rows.push({
                    uid,
                    img: "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp",
                    name: game.i18n.localize("ionrift-respite.restResolve.goldItemName"),
                    qtyLabel: `-${entry.lossGp} gp`,
                    rangeLabel: `${entry.currentGp} &rarr; ${remaining} gp`
                });
            }
        }

        // If nothing to show at all, proceed immediately without blocking
        if (allEntries.length === 0) {
            return true;
        }

        let scrollContent = "";
        for (const [actorId, group] of byActor) {
            let rows = "";
            for (const r of group.rows) {
                rows += `
                    <label class="loss-item-row" data-uid="${r.uid}">
                        <input type="checkbox" checked data-uid="${r.uid}" class="loss-checkbox" />
                        <img src="${r.img}" class="loss-item-img" alt="${r.name}" />
                        <span class="loss-item-name" title="${r.name}">${r.name}</span>
                        <span class="loss-item-qty">${r.qtyLabel}</span>
                        <span class="loss-item-current">${r.rangeLabel}</span>
                    </label>`;
            }
            scrollContent += `
                <div class="loss-actor-section">
                    <div class="loss-actor-header-row">
                        <img class="loss-actor-portrait" src="${group.img}" alt="${group.name}">
                        <span class="loss-actor-name">${group.name}</span>
                    </div>
                    <div class="loss-actor-rows">
                        ${rows}
                    </div>
                </div>`;
        }

        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("respite-disaster-modal-overlay");
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.innerHTML = `
                <div class="respite-disaster-modal">
                    <div class="respite-disaster-modal-header">
                        <div class="modal-title-group">
                            <i class="fas fa-triangle-exclamation modal-title-icon"></i>
                            <h3>${game.i18n.localize("ionrift-respite.restResolve.disasterModalTitle")}</h3>
                        </div>
                        <button type="button" class="btn-modal-close" title="${game.i18n.localize("ionrift-respite.restResolve.closeBtnTitle")}"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="loss-summary-banner">
                        <i class="fas fa-exclamation-circle"></i>
                        <span>${game.i18n.format("ionrift-respite.restResolve.disasterBannerText", { count: allEntries.length })}</span>
                    </div>
                    <div class="loss-controls-bar">
                        <div class="loss-batch-actions">
                            <button type="button" class="loss-btn-subtle loss-select-all"><i class="fas fa-check-double"></i> ${game.i18n.localize("ionrift-respite.restResolve.selectAll")}</button>
                            <button type="button" class="loss-btn-subtle loss-select-none"><i class="fas fa-times"></i> ${game.i18n.localize("ionrift-respite.restResolve.selectNone")}</button>
                        </div>
                        <span class="loss-controls-hint">${game.i18n.localize("ionrift-respite.restResolve.uncheckHint")}</span>
                    </div>
                    <div class="loss-scrollable">
                        ${scrollContent}
                    </div>
                    <div class="respite-disaster-modal-footer">
                        <div class="loss-tally">
                            <i class="fas fa-boxes-stacked"></i>
                            <span class="loss-tally-count">${game.i18n.format("ionrift-respite.restResolve.lossesApproved", { count: allEntries.length })}</span>
                        </div>
                        <div class="modal-footer-actions">
                            <button type="button" class="btn-loss-cancel"><i class="fas fa-times"></i> ${game.i18n.localize("ionrift-respite.restResolve.cancel")}</button>
                            <button type="button" class="btn-loss-confirm"><i class="fas fa-check"></i> <span>${game.i18n.format("ionrift-respite.restResolve.confirmLosses", { count: allEntries.length })}</span></button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const cleanup = (result) => {
                window.removeEventListener("keydown", onKeyDown);
                overlay.remove();
                resolve(result);
            };

            const onKeyDown = (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    cleanup(false);
                }
            };
            window.addEventListener("keydown", onKeyDown);

            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) cleanup(false);
            });

            overlay.querySelector(".btn-modal-close").addEventListener("click", () => cleanup(false));
            overlay.querySelector(".btn-loss-cancel").addEventListener("click", () => cleanup(false));

            function updateTally() {
                const count = overlay.querySelectorAll(".loss-checkbox:checked").length;
                const tally = overlay.querySelector(".loss-tally-count");
                if (tally) tally.textContent = `${count} loss${count === 1 ? "" : "es"} approved`;
                const confirmSpan = overlay.querySelector(".btn-loss-confirm span");
                if (confirmSpan) confirmSpan.textContent = `Confirm Losses (${count})`;
            }

            overlay.querySelector(".loss-select-all").addEventListener("click", () => {
                overlay.querySelectorAll(".loss-checkbox").forEach(cb => {
                    cb.checked = true;
                    cb.closest(".loss-item-row")?.classList.remove("is-excluded");
                });
                updateTally();
            });

            overlay.querySelector(".loss-select-none").addEventListener("click", () => {
                overlay.querySelectorAll(".loss-checkbox").forEach(cb => {
                    cb.checked = false;
                    cb.closest(".loss-item-row")?.classList.add("is-excluded");
                });
                updateTally();
            });

            overlay.querySelectorAll(".loss-checkbox").forEach(cb => {
                cb.addEventListener("change", () => {
                    cb.closest(".loss-item-row")?.classList.toggle("is-excluded", !cb.checked);
                    updateTally();
                });
            });

            // Confirm: mark approved entries on the original proposals
            overlay.querySelector(".btn-loss-confirm").addEventListener("click", () => {
                const checked = new Set(
                    [...overlay.querySelectorAll(".loss-checkbox:checked")].map(cb => cb.dataset.uid)
                );

                for (const p of supplyProposals) {
                    p.breakdown = p.breakdown.filter(e => checked.has(e._uid));
                    p.totalLoss = p.breakdown.reduce((s, e) => s + e.lossQty, 0);
                }
                for (const p of itemAtRiskProposals) {
                    for (const c of p.candidates) c._approved = checked.has(c._uid);
                }
                for (const p of goldProposals) {
                    p.breakdown = p.breakdown.filter(e => checked.has(e._uid));
                    p.totalLoss = p.breakdown.reduce((s, e) => s + e.lossGp, 0);
                }

                cleanup(true);
            });
        });
    },

    _buildResolutionCards(outcomes) {
        const app = this._app;

        const activityResolver = app._activityResolver;

        const classifyActivity = (result) => {
            switch (result) {
                case "exceptional": return { valence: "positive", label: game.i18n.localize("ionrift-respite.restResolve.outcomeExceptional"), icon: "fas fa-star" };
                case "success": return { valence: "positive", label: game.i18n.localize("ionrift-respite.restResolve.outcomeSuccess"), icon: "fas fa-check" };
                case "failure":
                case "failure_complication": return { valence: "negative", label: game.i18n.localize("ionrift-respite.restResolve.outcomeFailed"), icon: "fas fa-times" };
                default: return { valence: "neutral", label: null, icon: "fas fa-circle" };
            }
        };
        const classifyEvent = (resolvedOutcome) => {
            switch (resolvedOutcome) {
                case "triumph": return { valence: "positive", label: game.i18n.localize("ionrift-respite.restResolve.outcomeTriumph"), icon: "fas fa-star" };
                case "success": return { valence: "positive", label: game.i18n.localize("ionrift-respite.restResolve.outcomePassed"), icon: "fas fa-check" };
                case "partial": return { valence: "partial", label: game.i18n.localize("ionrift-respite.restResolve.outcomePartial"), icon: "fas fa-exclamation-triangle" };
                case "failure":
                case "failure_complication": return { valence: "negative", label: game.i18n.localize("ionrift-respite.restResolve.outcomeFailed"), icon: "fas fa-times" };
                default: return { valence: "neutral", label: null, icon: "fas fa-moon" };
            }
        };

        // Locked consequences live on the triggered events, keyed by event id.
        // Pulled from the tier that actually resolved so the conclusion names
        // who took the hit and what each pack lost, rather than echoing the raw
        // formula as if the card's owner took it.
        const LOCK_TIER_MAP = { triumph: "onTriumph", success: "onSuccess", mixed: "onMixed", failure: "onFailure" };
        const lockedByEvent = new Map();
        for (const te of (app._triggeredEvents ?? [])) {
            if (!te.resolvedOutcome || ["success", "triumph"].includes(te.resolvedOutcome)) continue;
            const tierKey = LOCK_TIER_MAP[te.resolvedOutcome] ?? "onFailure";
            const block = te.mechanical?.[tierKey] ?? te.mechanical?.onFailure ?? {};
            const lockedDamage = [];
            const lockedLosses = [];
            const lockedItems = [];
            const lockedGold = [];
            const lockedSupply = [];
            for (const eff of (block.effects ?? [])) {
                if (!eff._locked) continue;
                if (eff.type === "damage" && Array.isArray(eff._lockedTargets)) {
                    for (const t of eff._lockedTargets) {
                        if (t.amount > 0) lockedDamage.push({ name: t.name, amount: t.amount, damageType: eff.damageType ?? "" });
                    }
                } else if (eff.type === "consume_resource" && eff._lockedLoss) {
                    lockedLosses.push(eff._lockedLoss);
                } else if (eff.type === "item_at_risk" && Array.isArray(eff._lockedItems)) {
                    for (const li of eff._lockedItems) {
                        lockedItems.push({ actorId: li.actorId, actorName: li.actorName, itemName: li.itemName, lossQty: li.lossQty });
                    }
                } else if (eff.type === "consume_gold" && eff._lockedGold) {
                    for (const b of (eff._lockedGold.breakdown ?? [])) {
                        if (b.lossGp > 0) lockedGold.push({ actorId: b.actorId, actorName: b.actorName, lossGp: b.lossGp });
                    }
                } else if (eff.type === "supply_loss" && eff._lockedSupply) {
                    for (const b of (eff._lockedSupply.breakdown ?? [])) {
                        if (b.lossQty > 0) lockedSupply.push({ actorId: b.actorId, actorName: b.actorName, itemName: b.itemName, lossQty: b.lossQty });
                    }
                }
            }
            if (lockedDamage.length || lockedLosses.length || lockedItems.length || lockedGold.length || lockedSupply.length) {
                lockedByEvent.set(te.eventId, { lockedDamage, lockedLosses, lockedItems, lockedGold, lockedSupply });
            }
        }

        return (outcomes ?? []).map(o => {
            const recovery = o.recovery ?? {};
            const positives = [];
            const setbacks = [];
            const neutrals = [];

            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event") {
                    const cls = classifyEvent(sub.resolvedOutcome);
                    // Passive discoveries (no check, but items found) read as a gain.
                    if (cls.valence === "neutral" && (sub.items?.length || sub.effects?.length === 0)) {
                        cls.valence = sub.items?.length ? "positive" : "neutral";
                    }
                    const locked = lockedByEvent.get(sub.eventId) ?? {};
                    // Scope itemised losses to this card's owner so each player sees
                    // what they lost ("Lost 1 Rations"), not the whole party's tally.
                    const allSupply = locked.lockedSupply ?? [];
                    const mine = (entry) => entry.actorId === o.characterId;
                    const enriched = {
                        ...sub,
                        displayName: sub.eventName ?? "Event",
                        verdictLabel: cls.label,
                        verdictIcon: cls.icon,
                        valence: cls.valence,
                        lockedDamage: locked.lockedDamage ?? [],
                        lockedLosses: locked.lockedLosses ?? [],
                        lockedItems: locked.lockedItems ?? [],
                        lockedGold: locked.lockedGold ?? [],
                        lockedSupply: allSupply.filter(mine),
                        // once the GM has rolled the specifics, even for players who
                        // happened to lose nothing in the spread.
                        supplyLocked: allSupply.length > 0
                    };
                    if (cls.valence === "positive") positives.push(enriched);
                    else if (cls.valence === "neutral") neutrals.push(enriched);
                    else setbacks.push(enriched);
                } else {
                    const act = sub.activityId ? activityResolver?.activities?.get(sub.activityId) : null;
                    const cls = classifyActivity(sub.result);
                    const enriched = {
                        ...sub,
                        displayName: act?.name ?? sub.activityId ?? "Activity",
                        verdictLabel: cls.label,
                        verdictIcon: cls.icon,
                        valence: cls.valence
                    };
                    if (cls.valence === "positive") positives.push(enriched);
                    else if (cls.valence === "neutral") neutrals.push(enriched);
                    else setbacks.push(enriched);
                }
            }

            const exhaustionSavePassed = !!recovery.exhaustionDC && recovery.exhaustionSaveResult === "passed";
            const exhaustionSaveFailed = !!recovery.exhaustionDC && recovery.exhaustionSaveResult === "failed";
            const hostileBlocksRecovery = recovery.comfortLevel === "hostile" && !(recovery.exhaustionDelta < 0);
            const deprivationBlocksRecovery = !!recovery.noFoodOrWater && !(recovery.exhaustionDelta < 0);
            const eventDamage = recovery.eventDamage ?? 0;
            const hpRestored = recovery.hpRestored ?? 0;
            const hdRestored = recovery.hdRestored ?? 0;
            const hasGain = hpRestored > 0 || hdRestored > 0;

            const actor = game.actors?.get(o.characterId);
            let hpAtMax = false;
            let hdAtMax = false;
            if (actor) {
                const hp = actor.system?.attributes?.hp;
                if (hp) hpAtMax = (hp.value ?? 0) >= (hp.max ?? 1);
                const classes = actor.items?.filter(i => i.type === "class") ?? [];
                const totalHdSpent = classes.reduce((sum, cls) => {
                    return sum + (cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0);
                }, 0);
                hdAtMax = totalHdSpent <= 0;
            }

            const exhaustionConditionLabel = recovery.comfortLevel === "hostile"
                ? game.i18n.localize("ionrift-respite.restResolve.hostileLabel")
                : game.i18n.localize("ionrift-respite.restResolve.roughLabel");

            const mealExhaustion = recovery.mealExhaustion ?? 0;

            const hasRecovered = positives.length > 0 || exhaustionSavePassed || hasGain;
            const hasSetback = setbacks.length > 0 || exhaustionSaveFailed
                || hostileBlocksRecovery || deprivationBlocksRecovery || mealExhaustion > 0
                || eventDamage > 0 || !!o.eventDisrupted;

            return {
                characterId: o.characterId,
                characterName: o.characterName,
                comfortLevel: recovery.comfortLevel ?? null,
                eventDisrupted: !!o.eventDisrupted,
                gearDescriptors: recovery.gearDescriptors ?? [],
                neutrals,
                positives,
                setbacks,
                hasRecovered,
                hasSetback,
                hpRestored,
                hdRestored,
                hpAtMax,
                hdAtMax,
                hasGain,
                gearBonusBedroll: !!recovery.gearBonuses?.hd,
                exhaustionDC: recovery.exhaustionDC ?? null,
                exhaustionAdvantage: !!recovery.exhaustionAdvantage,
                exhaustionSavePassed,
                exhaustionSaveFailed,
                exhaustionDelta: recovery.exhaustionDelta ?? 0,
                exhaustionConditionLabel,
                hostileBlocksRecovery,
                deprivationBlocksRecovery,
                mealExhaustion,
                eventDamage
            };
        });
    
    },

    async _autoGrantPartyDiscoveries() {
        const app = this._app;

        if (!app._outcomes?.length) return;

        const discoveries = [];
        const seenEvents = new Set();
        for (const o of app._outcomes) {
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                    seenEvents.add(sub.eventId);
                    for (const item of sub.items) {
                        const grantKey = `${sub.eventId}:${item.itemRef ?? item.name}`;
                        if (!app._hasDiscoveryGrant(grantKey)) {
                            discoveries.push({
                                grantKey,
                                itemRef: item.itemRef ?? item.name,
                                quantity: item.quantity ?? 1
                            });
                        }
                    }
                }
            }
        }
        if (discoveries.length === 0) return;

        let recipientIds = (app._engine?.watchRoster ?? []).map(w => w.characterId);
        if (recipientIds.length === 0) {
            recipientIds = getPartyActors().map(a => a.id);
        }
        // Validate actors exist
        recipientIds = recipientIds.filter(id => game.actors.get(id));
        if (recipientIds.length === 0) return;

        // Shuffle recipients for fair round-robin distribution
        const shuffled = [...recipientIds];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        for (let i = 0; i < discoveries.length; i++) {
            const disc = discoveries[i];
            const actorId = shuffled.length === 1
                ? shuffled[0]
                : shuffled[i % shuffled.length];

            try {
                const colon = disc.grantKey.indexOf(":");
                const eventId = colon >= 0 ? disc.grantKey.slice(0, colon) : disc.grantKey;
                const ref = colon >= 0 ? disc.grantKey.slice(colon + 1) : disc.itemRef;
                const result = await ItemOutcomeHandler.grantToActor(actorId, disc.itemRef, disc.quantity, {
                    ledger: app._grantLedger,
                    slotKey: GrantLedger.discoverySlotKey(eventId, ref)
                });
        Logger.log(`${MODULE_ID} | Auto-granted ${result.rolled}x ${result.itemName} to ${result.actorName}`);
            } catch (e) {

                console.warn(`${MODULE_ID} | Auto-grant failed for ${disc.itemRef}:`, e);
            }
        }
    
    },

    async onAbandonRest(_event, _target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._eventsCommitPending) return;

        const confirmed = await confirmAbandonRest();
        if (!confirmed) return;

        app._terminated = true;
        app._abandoned = true;
        app._engine = null;
        app._cancelCampPlacementCanvasMode();

        await app._removeBeddingDown();

        // Clear persisted rest state
        await game.settings.set(MODULE_ID, "activeRest", {});
        await game.settings.set(MODULE_ID, "activeShortRest", {});
        await game.settings.set(MODULE_ID, "activeGrittyRest", {});
        app._clearTavernTotmOverride();

        // Detect Magic + workbench staging (skip save: activeRest already cleared)
        app._clearDetectMagicScanSession({ skipSave: true });

        emitRestAbandoned();
        Hooks.callAll("ionrift.respite.restCleanup");

        // Clean up camp tokens on the placement scene (and any scene with this session)
        try {
            await clearCampTokens(getCampSceneId());
        } catch (err) {
            console.warn(`${MODULE_ID} | Camp cleanup failed:`, err);
        }
        resetCampSession();
        app._campFireWoodSpendUserId = null;
        app._fireLitBy = null;
        app._firewoodPledges = new Map();
        app._coldCampDecided = false;
        app._campStep2Entered = false;
        app._tearDownStationLayerCanvas();
        app._removeGmStationTokenSyncHook();

        // Clear module-level references
        const { clearActiveRestApp } = await import("../../../../module.js");
        clearActiveRestApp();

        ui.notifications.info(game.i18n.localize("ionrift-respite.restResolve.restAbandonedInfo"));
        app.close({ resolved: true, abandoned: true });
    
    },

    _resolveActivityName(activityId) {
        if (!activityId) return "Rested";
        const normalized = activityId === "act_set_defenses" ? "act_defenses" : activityId;
        const act = this._app._activityResolver?.activities?.get(normalized);
        if (act?.name) return act.name;
        return normalized
            .replace(/^act_/, "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
    },

    _humanizeItemLabel(item) {
        let label = item?.name || item?.itemRef || "";
        label = label.replace(/^compendium\./, "").replace(/^[a-z0-9_-]+-items\./, "");
        if (!label) return "Supplies";
        if (label.includes("_")) {
            return label.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        }
        return label;
    },

    async postMasterRestCard() {
        const app = this._app;
        if (app._masterCardPosted) return;
        if (!game.user.isGM) return;

        const outcomes = app._outcomes ?? [];
        if (!outcomes.length) return;

        const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
        const terrainEntry = TerrainRegistry.get(terrainTag);
        const terrainLabel = terrainEntry?.label ?? (terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1));
        const comfort = app._campStatus?.comfort ?? app._engine?.comfort ?? "rough";
        const comfortLabel = comfort.charAt(0).toUpperCase() + comfort.slice(1);

        const restType = app._engine?.restType ?? "long";
        const title = restType === "long"
            ? game.i18n.localize("ionrift-respite.restResolve.longRestCompleteTitle")
            : game.i18n.localize("ionrift-respite.restResolve.shortRestCompleteTitle");

        const activeShelters = app._engine?.activeShelters ?? [];
        const shelterNames = activeShelters.map(s => {
            if (s === "tent") return game.i18n.localize("ionrift-respite.restResolve.tentPitched");
            if (s === "tiny_hut") return game.i18n.localize("ionrift-respite.restResolve.tinyHut");
            if (s === "rope_trick") return game.i18n.localize("ionrift-respite.restResolve.ropeTrick");
            if (s === "magnificent_mansion") return game.i18n.localize("ionrift-respite.restResolve.mansion");
            return s;
        });
        const shelterSummary = shelterNames.length ? shelterNames.join(", ") : game.i18n.localize("ionrift-respite.restResolve.openSky");

        // Summary metrics
        const totalHpRestored = outcomes.reduce((sum, o) => sum + (o.recovery?.hpRestored ?? 0), 0);
        const totalHdRestored = outcomes.reduce((sum, o) => sum + (o.recovery?.hdRestored ?? 0), 0);
        const totalExhaustionGained = outcomes.reduce((sum, o) => sum + Math.max(0, o.recovery?.exhaustionDelta ?? 0), 0);

        let vitalSummary = game.i18n.localize("ionrift-respite.restResolve.fullVitalRecovery");
        if (totalExhaustionGained > 0) {
            vitalSummary = `+${totalHpRestored} HP, +${totalHdRestored} HD (+${totalExhaustionGained} Exh)`;
        } else if (totalHpRestored > 0 || totalHdRestored > 0) {
            vitalSummary = `+${totalHpRestored} HP, +${totalHdRestored} HD`;
        }
        const vitalDetail = game.i18n.localize("ionrift-respite.restResolve.vitalDetail");

        const incidentsCount = (app._triggeredEvents ?? []).length;

        const fireLevel = app._fireLevel ?? "unlit";
        const hearthLabel = fireLevel !== "unlit" ? fireLevel.charAt(0).toUpperCase() + fireLevel.slice(1) : game.i18n.localize("ionrift-respite.restResolve.coldCamp");
        const shelterDetail = shelterSummary;

        const mealLabel = app._mealResults?.length
            ? game.i18n.localize("ionrift-respite.restResolve.campMealConsumed")
            : game.i18n.localize("ionrift-respite.restResolve.rationsAccounted");
        const mealDetail = game.i18n.localize("ionrift-respite.restResolve.adequateSustenance");

        // Incidents
        const incidents = (app._triggeredEvents ?? []).map(evt => {
            const consequences = [];
            const isSuccess = evt.resolvedOutcome && ["success", "triumph"].includes(evt.resolvedOutcome);
            const isFailure = evt.resolvedOutcome === "failure";

            if (isSuccess) {
                if (evt.items?.length) {
                    for (const it of evt.items) {
                        const qty = it.quantity ? ` (${it.quantity})` : "";
                        const label = this._humanizeItemLabel(it);
                        consequences.push({ icon: "fas fa-gem", text: `Discovered ${label}${qty}`, isPositive: true });
                    }
                }
            } else {
                if (evt.mechanical?.onFailure?.effects) {
                    for (const eff of evt.mechanical.onFailure.effects) {
                        if (eff.type === "damage") {
                            consequences.push({ icon: "fas fa-heart-broken", text: `${eff.formula ?? eff.amount} damage taken`, isPositive: false });
                        } else if (eff.type === "condition") {
                            consequences.push({ icon: "fas fa-skull-crossbones", text: `Gained ${eff.condition}`, isPositive: false });
                        } else if (eff.type === "supply_loss") {
                            consequences.push({ icon: "fas fa-box-open", text: "Supplies lost", isPositive: false });
                        }
                    }
                }
            }

            const category = evt.category ?? "ambient";
            const isRewarding = category === "discovery" || (consequences.some(c => c.isPositive) && !consequences.some(c => !c.isPositive));
            const isDanger = category === "encounter" || isFailure || consequences.some(c => !c.isPositive);

            let itemClass = "ambient";
            let icon = "fas fa-moon";
            if (isRewarding) {
                itemClass = "rewarding";
                icon = "fas fa-gem";
            } else if (isDanger) {
                itemClass = "danger";
                icon = "fas fa-shield-halved";
            } else if (category === "complication") {
                itemClass = "complication";
                icon = "fas fa-triangle-exclamation";
            }

            return {
                name: evt.name ?? game.i18n.localize("ionrift-respite.restResolve.nightEventDefault"),
                verdictLabel: evt.resolvedOutcome ? (evt.resolvedOutcome === "success"
                    ? game.i18n.localize("ionrift-respite.restResolve.outcomePassed")
                    : (evt.resolvedOutcome === "triumph"
                        ? game.i18n.localize("ionrift-respite.restResolve.outcomeTriumph")
                        : game.i18n.localize("ionrift-respite.restResolve.outcomeFailed"))) : null,
                narrative: evt.narrative ?? evt.description ?? "",
                consequences,
                category,
                isRewarding,
                isDanger,
                itemClass,
                icon
            };
        });

        const allRewarding = incidents.length > 0 && incidents.every(i => i.isRewarding);
        const anyDanger = incidents.some(i => i.isDanger);

        let containerClass = "ambient";
        let badgeIcon = "fas fa-campground";
        let badgeLabel = game.i18n.format("ionrift-respite.restResolve.badgeNightEvents", { count: incidents.length });

        if (allRewarding) {
            containerClass = "rewarding";
            badgeIcon = "fas fa-gem";
            badgeLabel = game.i18n.format("ionrift-respite.restResolve.badgeDiscoveries", { count: incidents.length });
        } else if (anyDanger) {
            containerClass = "hostile";
            badgeIcon = "fas fa-shield-halved";
            badgeLabel = game.i18n.format("ionrift-respite.restResolve.badgeIncidentsResolved", { count: incidents.length });
        }

        const incidentsMeta = { containerClass, badgeIcon, badgeLabel };

        let securityLabel = game.i18n.localize("ionrift-respite.restResolve.securityNightSecurity");
        let securityIcon = "fas fa-shield-halved";
        let securityValue = incidents.length === 0
            ? game.i18n.localize("ionrift-respite.restResolve.securityQuietNight")
            : (incidents.length === 1
                ? game.i18n.format("ionrift-respite.restResolve.securityIncidentSingle", { count: 1 })
                : game.i18n.format("ionrift-respite.restResolve.securityIncidentPlural", { count: incidents.length }));
        let securityPositive = incidents.length === 0;
        let securityDetail = game.i18n.localize("ionrift-respite.restResolve.securityWatchNoIncident");

        if (allRewarding) {
            securityLabel = game.i18n.localize("ionrift-respite.restResolve.securityDiscoveries");
            securityIcon = "fas fa-gem";
            securityValue = game.i18n.format("ionrift-respite.restResolve.securityFoundCount", { count: incidents.length });
            securityPositive = true;
            securityDetail = game.i18n.localize("ionrift-respite.restResolve.securityWatchBeneficial");
        } else if (anyDanger) {
            const dangerCount = incidents.filter(i => i.isDanger).length;
            securityLabel = game.i18n.localize("ionrift-respite.restResolve.securityNightSecurity");
            securityIcon = "fas fa-shield-halved";
            securityValue = dangerCount === 1
                ? game.i18n.format("ionrift-respite.restResolve.securityThreatSingle", { count: 1 })
                : game.i18n.format("ionrift-respite.restResolve.securityThreatPlural", { count: dangerCount });
            securityPositive = false;
            securityDetail = game.i18n.localize("ionrift-respite.restResolve.securityResolvedDuringWatch");
        } else if (incidents.length > 0) {
            securityLabel = game.i18n.localize("ionrift-respite.restResolve.securityNightEvents");
            securityIcon = "fas fa-campground";
            securityValue = game.i18n.format("ionrift-respite.restResolve.securityResolvedCount", { count: incidents.length });
            securityPositive = true;
            securityDetail = game.i18n.localize("ionrift-respite.restResolve.securityEventsResolvedDuringWatch");
        }

        // Characters
        const characters = outcomes
            .filter(o => o.characterId)
            .map(o => {
            const actor = game.actors.get(o.characterId);
            const recovery = o.recovery ?? {};

            // Activity
            const actSub = (o.outcomes ?? []).find(s => s.source === "activity");
            let activityLabel = game.i18n.localize("ionrift-respite.restResolve.activityRested");
            let activityIcon = "fas fa-bed";
            let activitySuccess = true;
            if (actSub?.activityId) {
                activityLabel = this._resolveActivityName(actSub.activityId);
                activitySuccess = actSub.result !== "failure" && actSub.result !== "failure_complication";
                if (actSub.activityId.includes("watch")) activityIcon = "fas fa-eye";
                else if (actSub.activityId.includes("cook")) activityIcon = "fas fa-utensils";
                else if (actSub.activityId.includes("defenses")) activityIcon = "fas fa-shield-alt";
                else if (actSub.activityId.includes("forage") || actSub.activityId.includes("gather")) activityIcon = "fas fa-seedling";
                else if (actSub.activityId.includes("craft") || actSub.activityId.includes("fletch")) activityIcon = "fas fa-hammer";
            }

            const exhaustionDelta = recovery.exhaustionDelta ?? 0;
            const hasSetback = exhaustionDelta > 0 || (recovery.eventDamage ?? 0) > 0 || recovery.exhaustionSaveResult === "failed";

            let vitalPill = game.i18n.localize("ionrift-respite.restResolve.vitalMaxHpMaxHd");
            if (exhaustionDelta > 0) {
                vitalPill = game.i18n.format("ionrift-respite.restResolve.vitalExhaustionPlus", { amount: exhaustionDelta });
            } else if (recovery.eventDamage > 0) {
                vitalPill = `-${recovery.eventDamage} HP`;
            } else if (recovery.hpRestored > 0 || recovery.hdRestored > 0) {
                vitalPill = `+${recovery.hpRestored} HP, +${recovery.hdRestored} HD`;
            }

            const notes = [];
            if (recovery.hpRestored > 0 || recovery.hdRestored > 0) {
                const parts = [];
                if (recovery.hpRestored > 0) parts.push(`+${recovery.hpRestored} HP`);
                if (recovery.hdRestored > 0) parts.push(`+${recovery.hdRestored} HD`);
                if (recovery.gearBonuses?.hd) parts.push(`(+1 bedroll bonus)`);
                notes.push(`<i class="fas fa-heartbeat" style="color:#10b981;"></i> ${game.i18n.format("ionrift-respite.restResolve.partsRestored", { parts: parts.join(", ") })}`);
            } else {
                notes.push(`<i class="fas fa-heart" style="color:#10b981;"></i> ${game.i18n.localize("ionrift-respite.restResolve.vitalRecoveryMaxed")}`);
            }

            if (recovery.exhaustionDelta < 0) {
                notes.push(`<i class="fas fa-arrow-down" style="color:#10b981;"></i> ${game.i18n.format("ionrift-respite.restResolve.exhRecoveredNote", { amount: Math.abs(recovery.exhaustionDelta) })}`);
            } else if (recovery.exhaustionDelta > 0) {
                const reason = recovery.exhaustionDC
                    ? game.i18n.format("ionrift-respite.restResolve.failedConSaveReason", { dc: recovery.exhaustionDC })
                    : game.i18n.localize("ionrift-respite.restResolve.restConditionsReason");
                notes.push(`<i class="fas fa-arrow-up" style="color:#f87171;"></i> ${game.i18n.format("ionrift-respite.restResolve.exhGainedNote", { amount: recovery.exhaustionDelta, reason })}`);
            } else if (recovery.exhaustionSaveResult === "failed") {
                notes.push(`<i class="fas fa-arrow-right" style="color:#fbbf24;"></i> ${game.i18n.format("ionrift-respite.restResolve.failedConSaveOffset", { dc: recovery.exhaustionDC })}`);
            } else if (recovery.exhaustionSaveResult === "passed") {
                notes.push(`<i class="fas fa-shield" style="color:#10b981;"></i> ${game.i18n.format("ionrift-respite.restResolve.passedConSave", { dc: recovery.exhaustionDC })}`);
            }

            for (const sub of (o.outcomes ?? [])) {
                if (sub.items?.length) {
                    for (const item of sub.items) {
                        const qty = item.quantity > 1 ? ` &times;${item.quantity}` : "";
                        const icon = sub.source === "event" ? "fas fa-gem" : "fas fa-plus-circle";
                        const color = sub.source === "event" ? "#fbbf24" : "#10b981";
                        const label = this._humanizeItemLabel(item);
                        notes.push(`<i class="${icon}" style="color:${color};"></i> ${game.i18n.format("ionrift-respite.restResolve.obtainedItem", { label, qty })}`);
                    }
                }
            }

            if (recovery.eventDamage > 0) {
                notes.push(`<i class="fas fa-tint" style="color:#ef4444;"></i> ${game.i18n.format("ionrift-respite.restResolve.tookDamageDuringNight", { amount: recovery.eventDamage })}`);
            }

            const reequipped = app._reequippedArmor?.get(o.characterId);
            if (reequipped) {
                notes.push(`<i class="fas fa-shield-alt"></i> ${game.i18n.format("ionrift-respite.restResolve.donnedArmorOnBreak", { armor: reequipped })}`);
            }

            return {
                id: o.characterId,
                name: actor?.name ?? o.characterName,
                img: actor?.img ?? "icons/svg/mystery-man.svg",
                activityLabel,
                activityIcon,
                activitySuccess,
                vitalPill,
                hasSetback,
                notes
            };
        });

        const bannerContext = ImageResolver.resolveRestBannerContext(terrainTag, "resolve");
        const bannerFireClass = ImageResolver.bannerFireClass(fireLevel);
        const showBanner = !bannerContext.hideTerrainBanner && !!bannerContext.terrainBanner;

        const anySetback = outcomes.some(o => o.hasSetback);
        const partyStatus = anySetback
            ? { label: game.i18n.localize("ionrift-respite.restResolve.setbacksIncurred"), icon: "fas fa-triangle-exclamation", class: "setback" }
            : { label: game.i18n.localize("ionrift-respite.restResolve.allRested"), icon: "fas fa-sparkles", class: "positive" };

        const subtitleParts = [terrainLabel, comfortLabel, shelterSummary];
        if (hearthLabel) subtitleParts.push(hearthLabel);

        const partyLosses = [];
        let totalLossCount = 0;
        for (const [actorId, data] of (app._approvedLossesByActor ?? new Map())) {
            if (!data.items?.length) continue;
            const actor = game.actors.get(actorId);
            totalLossCount += data.items.reduce((acc, it) => acc + (typeof it.lossQty === "number" ? it.lossQty : 1), 0);
            partyLosses.push({
                id: actorId,
                name: actor?.name ?? data.name,
                img: actor?.img ?? data.img ?? "icons/svg/mystery-man.svg",
                items: data.items
            });
        }

        const templateData = {
            title,
            subtitle: subtitleParts.join(" · "),
            terrainBanner: bannerContext.terrainBanner,
            terrainBannerFallback: bannerContext.terrainBannerFallback,
            terrainBannerPos: bannerContext.terrainBannerPos ?? "center",
            bannerFireClass,
            showBanner,
            partyStatus,
            incidentsMeta,
            incidents,
            characters,
            partyLosses,
            totalLossCount
        };

        const cardHtml = await renderTemplate("modules/ionrift-respite/templates/master-rest-card.hbs", templateData);

        await ChatMessage.create({
            content: cardHtml,
            speaker: { alias: "Respite Rest Resolution" }
        });

        app._masterCardPosted = true;
    }
};
