import { RestResolutionCardMethods } from "./RestResolutionCardBuilder.js";
import { Logger } from "../../../../utils/Logger.js";
import { ResourceSink } from "../../../../services/rest/recovery/ResourceSink.js";
import { RecoveryHandler } from "../../../../services/rest/recovery/RecoveryHandler.js";
import { stampExhaustionRecovery } from "../../../../services/rest/recovery/ExhaustionStage.js";
import { ConditionAdvisory } from "../../../../services/rest/recovery/ConditionAdvisory.js";
import { CalendarHandler } from "../../../../services/rest/session/CalendarHandler.js";
import { MealPhaseHandler } from "../../../../services/meal/phase/MealPhaseHandler.js";
import {
    mergeMealExhaustionFloors,
    mealExhaustionFloorFor
} from "../../../../services/meal/phase/MealExhaustionGuard.js";
import { ItemOutcomeHandler } from "../../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import { purgeDetectMagicRestArtifacts } from "../../crafting/DetectMagicDelegate.js";
import { SoundDelegate } from "../SoundDelegate.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../../data/moduleId.js";

export class RestResolveDelegate {
    constructor(app) {
        this._app = app;
    }

    async onResolveEvents(event, target) {
        const app = this._app;
        if (app._resolveInFlight) return;
        app._resolveInFlight = true;
        await app.render();
        try {
            await this._onResolveEvents(event, target);
        } finally {
            const stillOpen = app.rendered && app._phase !== "resolve";
            app._resolveInFlight = false;
            if (stillOpen) app.render();
        }
    }

    async _onResolveEvents(_event, _target) {
        const app = this._app;

        // Collect ALL resource-loss effects from resolved tree and stall penalties.
        // Pull from the resolved tier (onMixed/onFailure) so a partial success
        // applies its own lighter losses rather than the failure set, and a
        // passed check applies nothing. Decision-tree events deliver their
        // losses through stallEffects and the tree resolution, not here.
        const allEffects = [];
        const LOSS_TYPES = ["supply_loss", "item_at_risk", "consume_gold"];
        const RESOLVED_TIER = { mixed: "onMixed", failure: "onFailure" };
        for (const evt of (app._triggeredEvents ?? [])) {
            if (evt.isDecisionTree) continue;
            if (evt.resolvedOutcome && ["success", "triumph"].includes(evt.resolvedOutcome)) continue;
            const tierKey = RESOLVED_TIER[evt.resolvedOutcome] ?? "onFailure";
            const tierEffects = evt.mechanical?.[tierKey]?.effects ?? evt.effects ?? [];
            for (const eff of tierEffects) {
                if (LOSS_TYPES.includes(eff.type)) {
                    allEffects.push(eff);
                }
            }
        }
        if (app._activeTreeState?.stallEffects) {
            for (const eff of app._activeTreeState.stallEffects) {
                if (["supply_loss", "item_at_risk", "consume_gold"].includes(eff.type)) {
                    allEffects.push(eff);
                }
            }
        }

        if (allEffects.length > 0) {
            const characters = getPartyActors();
            const context = { characters };

            const unified = { supplyProposals: [], itemAtRiskProposals: [], goldProposals: [] };

            for (const eff of allEffects) {
                if (eff.type === "supply_loss") {
                    // matches the amount previewed on the disaster outcome card.
                    unified.supplyProposals.push(
                        eff._locked && eff._lockedSupply
                            ? eff._lockedSupply
                            : await ResourceSink.proposeSupplyLoss(eff, context)
                    );
                } else if (eff.type === "item_at_risk") {
                    // If the GM already rolled and locked the exact items on the
                    // event card, apply that frozen selection instead of rolling
                    // a fresh one, so the approval modal matches the preview.
                    unified.itemAtRiskProposals.push(
                        eff._locked
                            ? this.rehydrateItemLossProposal(eff)
                            : await ResourceSink._resolveItemAtRisk(eff, context)
                    );
                } else if (eff.type === "consume_gold") {
                    // matches the amount previewed on the event card.
                    unified.goldProposals.push(
                        eff._locked && eff._lockedGold
                            ? eff._lockedGold
                            : await ResourceSink.proposeGoldLoss(eff, context)
                    );
                }
            }

            const approved = await this.showResourceLossApproval(unified);
            if (!approved) return; // GM cancelled

            for (const p of unified.supplyProposals) {
                if (p.totalLoss > 0) await ResourceSink.applySupplyLossProposal(p);
            }
            for (const p of unified.itemAtRiskProposals) {
                const checked = p.candidates.filter(c => c._approved);
                if (checked.length > 0) await ResourceSink.applyItemLoss(checked);
            }
            for (const p of unified.goldProposals) {
                if (p.totalLoss > 0) await ResourceSink.applyGoldLossProposal(p);
            }

            // Record approved losses for the master rest resolution card
            const approvedLossesByActor = new Map();
            const recordActorLoss = (actorId, actorName, itemData) => {
                if (!approvedLossesByActor.has(actorId)) {
                    const actor = game.actors.get(actorId);
                    approvedLossesByActor.set(actorId, {
                        id: actorId,
                        name: actor?.name ?? actorName,
                        img: actor?.img ?? "icons/svg/mystery-man.svg",
                        items: []
                    });
                }
                approvedLossesByActor.get(actorId).items.push(itemData);
            };

            // Whisper each player what they lost
            const lossByActor = new Map();
            function addLoss(actorId, actorName, line) {
                if (!lossByActor.has(actorId)) lossByActor.set(actorId, { name: actorName, lines: [] });
                lossByActor.get(actorId).lines.push(line);
            }

            for (const p of unified.supplyProposals) {
                for (const e of p.breakdown) {
                    if (e.lossQty > 0) {
                        const cleanLabel = this._sanitizeItemLabel(e.itemName ?? "Supplies");
                        recordActorLoss(e.actorId, e.actorName, {
                            name: cleanLabel,
                            img: e.img ?? "icons/containers/bags/pack-leather-brown.webp",
                            lossQty: e.lossQty,
                            isTotal: (e.currentQty - e.lossQty) <= 0
                        });
                        addLoss(e.actorId, e.actorName,
                            `<i class="fas fa-box-open" style="color:#f87171;"></i> <strong>${cleanLabel}</strong> &times;${e.lossQty} lost`);
                    }
                }
            }
            for (const p of unified.itemAtRiskProposals) {
                for (const c of p.candidates) {
                    if (!c._approved) continue;
                    const cleanLabel = this._sanitizeItemLabel(c.item.name);
                    const qty = c.lossQty ?? 1;
                    const label = qty > 1 ? `${cleanLabel} &times;${qty}` : cleanLabel;
                    recordActorLoss(c.actor.id, c.actor.name, {
                        name: cleanLabel,
                        img: c.item.img ?? "icons/svg/item-bag.svg",
                        lossQty: qty,
                        isTotal: (c.currentQty - qty) <= 0
                    });
                    addLoss(c.actor.id, c.actor.name,
                        `<i class="fas fa-times-circle" style="color:#f87171;"></i> <strong>${label}</strong> lost`);
                }
            }
            for (const p of unified.goldProposals) {
                for (const e of p.breakdown) {
                    if (e.lossGp > 0) {
                        recordActorLoss(e.actorId, e.actorName, {
                            name: game.i18n.localize("ionrift-respite.restResolve.goldItemName"),
                            img: "icons/commodities/currency/coins-plain-stack-gold.webp",
                            lossQty: `${e.lossGp} gp`,
                            isTotal: false
                        });
                        addLoss(e.actorId, e.actorName,
                            `<i class="fas fa-coins" style="color:#f87171;"></i> <strong>${e.lossGp} gp</strong> lost`);
                    }
                }
            }
            app._approvedLossesByActor = approvedLossesByActor;

            for (const [actorId, data] of lossByActor) {
                if (data.lines.length === 0) continue;
                const actor = game.actors.get(actorId);
                if (!actor) continue;
                const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
                const whisperTargets = ownerUser ? [ownerUser.id] : game.users.filter(u => u.isGM).map(u => u.id);

                try {
                    await ChatMessage.create({
                        content: `<h3><i class="fas fa-box-open"></i> ${data.name}'s Disaster Losses</h3>\n${data.lines.join("\n")}`,
                        whisper: whisperTargets,
                        speaker: { alias: "Respite" },
                        flags: { [MODULE_ID]: { type: "disasterLoss" } }
                    });
                } catch (e) {
                    console.warn(`${MODULE_ID} | Failed to whisper disaster loss to ${data.name}:`, e);
                }
            }
        }

        // Clear the resolved tree state now that we're proceeding past events
        // but first collect any condition effects (exhaustion) from the tree.
        // EventResolver._buildResult always populates evt.effects from the
        // mechanical.onFailure block, so we must skip events whose actual
        // resolution was success or triumph; otherwise a triumph-resolved
        // event still applies its onFailure exhaustion to the party.
        const conditionEffects = [];
        for (const evt of (app._triggeredEvents ?? [])) {
            if (!evt.effects) continue;
            if (["success", "triumph"].includes(evt.resolvedOutcome)) continue;
            for (const eff of evt.effects) {
                if (eff.type === "condition" && eff.condition === "exhaustion") {
                    conditionEffects.push(eff);
                }
            }
        }
        if (app._activeTreeState?.stallEffects) {
            for (const eff of app._activeTreeState.stallEffects) {
                if (eff.type === "condition" && eff.condition === "exhaustion") {
                    conditionEffects.push(eff);
                }
            }
        }

        // Apply disaster exhaustion to actors and track per-actor gains.
        // `preAppliedConditions` records the `${actorId}:${condition}` tuples
        // we touched directly via the adapter so ConditionAdvisory can render
        // them as already-applied without firing a second Convenient Effects
        // add on top of the system value.
        const disasterExhaustion = new Map();
        const preAppliedConditions = new Set();
        if (conditionEffects.length > 0) {
            const characters = getPartyActors();
            const adapter = game.ionrift?.respite?.adapter;
            for (const eff of conditionEffects) {
                const level = eff.level ?? 1;
                const scope = eff.scope ?? "all";
                let targets;
                if (scope === "all") {
                    targets = characters;
                } else if (scope === "random" || scope === "randomTarget") {
                    // Disaster-tree path runs before the engine resolves outcomes,
                    // so the pool/count metadata on randomTarget can't be honored
                    // here. Treat it as a single random pick; the per-outcome
                    // pre-resolution in RecoveryHandler handles the richer case.
                    targets = characters.length > 0
                        ? [characters[Math.floor(Math.random() * characters.length)]]
                        : [];
                } else {
                    targets = characters.filter(a => a.id === scope);
                }

                for (const actor of targets) {
                    const gain = disasterExhaustion.get(actor.id) ?? 0;
                    disasterExhaustion.set(actor.id, gain + level);
                    if (adapter) {
                        await adapter.applyExhaustionDelta(actor, level);
                    } else {
                        // Fallback: direct 5e path
                        const current = actor.system?.attributes?.exhaustion ?? 0;
                        const newLevel = Math.min(6, current + gain + level);
                        await actor.update({ "system.attributes.exhaustion": newLevel });
                    }
                    preAppliedConditions.add(`${actor.id}:${eff.condition}`);
                }
            }
        }
        app._preAppliedConditions = preAppliedConditions;

        app._activeTreeState = null;

        app._outcomes = await app._engine.resolve(app._activityResolver, app._triggeredEvents, app._earlyResults);

        // Inject disaster exhaustion into recovery so RecoveryHandler
        // won't undo it with the natural -1 long rest reduction.
        for (const outcome of app._outcomes) {
            const gain = disasterExhaustion.get(outcome.characterId);
            if (gain && outcome.recovery) {
                outcome.recovery.exhaustionGain = (outcome.recovery.exhaustionGain ?? 0) + gain;
            }
        }

        for (const outcome of app._outcomes) {
            const craftResult = app._craftingResults.get(outcome.characterId);
            if (!craftResult) continue;

            // Find the activity outcome and replace it
            for (const sub of (outcome.outcomes ?? [])) {
                if (sub.source === "activity" && ["act_cook", "act_brew", "act_tailor"].includes(sub.activityId)) {
                    sub.narrative = craftResult.narrative;
                    sub.result = craftResult.success ? "success" : "failure";
                    if (craftResult.success && craftResult.output) {
                        sub.items = [{
                            name: craftResult.output.name,
                            quantity: craftResult.output.quantity ?? 1,
                            img: craftResult.output.img ?? "icons/consumables/food/bowl-stew-brown.webp"
                        }];
                    } else {
                        sub.items = [];
                    }
                    sub.craftingResult = craftResult;
                }
            }
        }

        await app._removeBeddingDown();

        for (const outcome of app._outcomes) {
            const actor = game.actors.get(outcome.characterId);
            const name = actor?.name ?? outcome.characterId;
            const hpRec = outcome.recovery?.hpRestored;
            const hdRec = outcome.recovery?.hdRegained;
            const parts = [];
            if (hpRec > 0) parts.push(`+${hpRec} HP`);
            if (hdRec > 0) parts.push(`+${hdRec} HD`);
            app._restLedger.add({
                phase: "resolve", category: "recovery", icon: "fas fa-heart",
                actor: outcome.characterId, actorName: name,
                summary: parts.length ? parts.join(", ") : "No recovery"
            });
            const mealExh = outcome.recovery?.mealExhaustion ?? 0;
            if (mealExh > 0) {
                app._restLedger.add({
                    phase: "resolve", category: "exhaustion", icon: "fas fa-tired",
                    actor: outcome.characterId, actorName: name,
                    summary: `+${mealExh} exhaustion retained`,
                    detail: "Deprivation exhaustion persists through rest"
                });
            }
        }
        app._refreshLedgerApp();

        // Capture meal-phase exhaustion floors before any recovery or native rest
        // can reduce levels. Used for noFoodOrWater stamping and post-rest re-assert.
        const mealExhaustionFloors = mergeMealExhaustionFloors(app._mealResults);

        SoundDelegate.stopAll();
        app._phase = "resolve";
        Hooks.callAll("ionrift.respite.resolutionEntered", {
            restType: app._engine?.restType ?? "long",
            isGritty: false
        });
        await app._clearRestState();

        // Auto re-equip doffed armor if no encounter occurred
        const reequippedArmor = new Map();
        if (app._doffedArmor?.size > 0) {
            const hadEncounter = (app._triggeredEvents ?? []).some(e =>
                e.category === "encounter" || e.category === "combat"
            );
            if (!hadEncounter) {
                for (const [actorId, itemId] of app._doffedArmor) {
                    try {
                        const actor = game.actors.get(actorId);
                        const item = actor?.items.get(itemId);
                        if (item) {
                            await item.update({ "system.equipped": true });
                            reequippedArmor.set(actorId, item.name);
        Logger.log(`${MODULE_ID} | Auto re-equipped ${item.name} on ${actor.name}`);

                            const outcome = app._outcomes.find(o => o.characterId === actorId);
                            if (outcome) {
                                if (!outcome.outcomes) outcome.outcomes = [];
                                outcome.outcomes.push({
                                    source: "armor",
                                    narrative: `You don your ${item.name} as you break camp.`,
                                    items: []
                                });
                            }
                        }
                    } catch (e) {

                        console.warn(`${MODULE_ID} | Failed to re-equip armor:`, e);
                    }
                }
                app._doffedArmor.clear();
            }
        }
        app._reequippedArmor = reequippedArmor;

        // PHB p.185: exhaustion recovery requires adequate food and drink.
        // Stamp recovery objects so RecoveryHandler blocks the -1 reduction
        // for characters who skipped meals or water during the meal phase.
        // Also thread meal-phase exhaustion so the resolution card can display it.
        if (app._mealResults?.length || mealExhaustionFloors.size) {
            for (const outcome of app._outcomes) {
                if (!outcome.recovery) continue;
                const floor = mealExhaustionFloors.get(outcome.characterId)
                    ?? mealExhaustionFloorFor(game.actors.get(outcome.characterId));
                const mr = app._mealResults?.find(r => r.characterId === outcome.characterId);
                const mealExh = mr?.mealExhaustionApplied ?? floor ?? 0;
                if (!mr?.ate || !mr?.drank || mealExh > 0 || floor > 0) {
                    outcome.recovery.noFoodOrWater = true;
                }
                if (mealExh > 0 || floor > 0) {
                    outcome.recovery.mealExhaustion = Math.max(mealExh, floor);
                }
            }
        }

        const skipRecovery = game.settings.get(MODULE_ID, "restRecoveryDetected");
        for (const outcome of app._outcomes) {
            const entry = app._exhaustionDraft?.get(outcome.characterId);
            if (entry) stampExhaustionRecovery(outcome.recovery, entry);
        }
        const recoveryResults = await RecoveryHandler.applyAll(app._outcomes, skipRecovery);

        for (const outcome of app._outcomes) {
            const res = recoveryResults.find(r => r.characterId === outcome.characterId);
            if (res?.eventDamage > 0) {
                outcome.recovery.eventDamage = res.eventDamage;
            }
        }

        // Apply GM-locked event consequences AFTER recovery so morning wounds and
        // resource losses survive the night's healing. RecoveryHandler skips any
        // effect flagged `_locked`, so this is the sole application of these.
        {
            const LOCK_TIER_MAP = { triumph: "onTriumph", success: "onSuccess", mixed: "onMixed", failure: "onFailure" };
            const lockedConsumeEffects = [];
            const lockedDamageByActor = new Map();
            for (const te of (app._triggeredEvents ?? [])) {
                if (!te.resolvedOutcome || ["success", "triumph"].includes(te.resolvedOutcome)) continue;
                const tierKey = LOCK_TIER_MAP[te.resolvedOutcome] ?? "onFailure";
                const block = te.mechanical?.[tierKey] ?? te.mechanical?.onFailure ?? {};
                for (const eff of (block.effects ?? [])) {
                    if (!eff._locked) continue;
                    if (eff.type === "damage" && eff._lockedDamage) {
                        for (const [actorId, amount] of Object.entries(eff._lockedDamage)) {
                            if (amount > 0) lockedDamageByActor.set(actorId, (lockedDamageByActor.get(actorId) ?? 0) + amount);
                        }
                    } else if (eff.type === "consume_resource" && eff._lockedLoss) {
                        lockedConsumeEffects.push(eff);
                    }
                }
            }

            const dmgAdapter = game.ionrift?.respite?.adapter;
            for (const [actorId, totalDamage] of lockedDamageByActor) {
                const actor = game.actors.get(actorId);
                if (!actor || totalDamage <= 0) continue;
                if (dmgAdapter) {
                    await dmgAdapter.applyHPDamage(actor, totalDamage);
                } else {
                    const hp = actor.system?.attributes?.hp;
                    if (!hp) continue;
                    const newHp = Math.max(0, (hp.value ?? 0) - totalDamage);
                    await actor.update({ "system.attributes.hp.value": newHp });
                }
                const outcome = app._outcomes.find(o => o.characterId === actorId);
                if (outcome?.recovery) {
                    outcome.recovery.eventDamage = (outcome.recovery.eventDamage ?? 0) + totalDamage;
                }
            }

            for (const eff of lockedConsumeEffects) {
                try {
                    await ResourceSink.applyResourceLossBreakdown(eff._lockedLoss.breakdown);
                    if (eff._lockedLoss.gear?.length) {
                        await ResourceSink.applyResourceLossBreakdown(eff._lockedLoss.gear);
                    }
                } catch (e) {

                    console.warn(`${MODULE_ID} | Failed to apply locked resource loss:`, e);
                }
            }
        }

        // Snapshot expected exhaustion BEFORE native rest so we can detect
        // and correct any unintended reduction by longRest()/shortRest().
        const expectedExhaustion = new Map();
        {
            const exhAdapter = game.ionrift?.respite?.adapter;
            for (const outcome of app._outcomes) {
                const actor = game.actors.get(outcome.characterId);
                if (!actor) continue;
                const exh = exhAdapter ? exhAdapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);
                const floor = mealExhaustionFloors.get(outcome.characterId) ?? 0;
                expectedExhaustion.set(outcome.characterId, Math.max(exh, floor));
            }
        }

        // Trigger native rest for spell slots, class features, item uses.
        // HP/HD/Exhaustion already handled by RecoveryHandler above.
        // For hookable systems (DnD5e), preRestCompleted suppresses double-dipping.
        // For non-hookable systems (PF2e), the adapter calls the native rest API directly.
        if (!skipRecovery) {
            const nativeAdapter = game.ionrift?.respite?.adapter;
            const restType = app._engine?.restType ?? "long";
            for (const outcome of app._outcomes) {
                const actor = game.actors.get(outcome.characterId);
                if (!actor) continue;
                try {
                    if (nativeAdapter) {
                        await nativeAdapter.triggerNativeRest(actor, restType);
                    } else if (game.system.id === "dnd5e") {
                        if (restType === "long") {
                            await actor.longRest({ dialog: false, chat: false, advanceTime: false });
                        } else {
                            await actor.shortRest({ dialog: false, chat: false, advanceTime: false });
                        }
                    }

                    Logger.log(`${MODULE_ID} | Native ${restType} rest applied for ${actor.name}.`);
                } catch (e) {

                    console.warn(`${MODULE_ID} | Native rest failed for ${actor.name}:`, e);
                }
            }
        } else if (!skipRecovery) {

            Logger.log(`${MODULE_ID} | Skipping native rest call (system: ${game.system.id} ,  no longRest/shortRest API).`);
        }

        // Re-assert exhaustion levels in case the native rest reduced them
        // despite preRestCompleted suppression (covers system version gaps).
        {
            const exhAdapter = game.ionrift?.respite?.adapter;
            for (const [charId, expected] of expectedExhaustion) {
                const actor = game.actors.get(charId);
                if (!actor) continue;
                const floor = mealExhaustionFloors.get(charId) ?? 0;
                const target = Math.max(expected, floor);
                const actual = exhAdapter ? exhAdapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);
                if (actual < target) {
                    const deficit = target - actual;
                    if (exhAdapter) {
                        await exhAdapter.applyExhaustionDelta(actor, deficit);
                    } else {
                        await actor.update({ "system.attributes.exhaustion": target });
                    }
                    Logger.log(`[Respite:Recovery] Re-asserted exhaustion for ${actor.name}: ${actual} -> ${target} (native rest reduced by ${deficit})`);
                }
            }
        }

        // Strip any Detect Magic active effects left on party actors from the rest scan.
        try {
            await purgeDetectMagicRestArtifacts(getPartyActors());
        } catch (e) {

            console.warn(`${MODULE_ID} | Failed to purge Detect Magic effects:`, e);
        }

        // Stamp Well Fed AEs with DAE longRest specialDuration now that native rest has run.
        // Eating happens before recovery, so the flag is intentionally omitted at AE
        // creation to prevent DAE from stripping the buff during longRest(). Adding
        // it here means the AE will auto-expire at the START of the next rest instead.
        try {
            await MealPhaseHandler.stampWellFedDuration(getPartyActors());
        } catch (e) {

            console.warn(`${MODULE_ID} | Well Fed duration stamp failed:`, e);
        }

        // Create items from outcomes (forage, crafts, etc.)
        try {
            const itemSummary = await ItemOutcomeHandler.processAll(app._outcomes);
            const totalItems = itemSummary.reduce((sum, s) => sum + s.items.length, 0);
            if (totalItems > 0) {
                ui.notifications.info(game.i18n.format(totalItems === 1
                ? "ionrift-respite.restResolve.restCompleteSingleItem"
                : "ionrift-respite.restResolve.restCompletePluralItems", { count: totalItems }));
            } else {
                ui.notifications.info(game.i18n.localize("ionrift-respite.restResolve.restComplete"));
            }
        } catch (e) {

            console.warn(`${MODULE_ID} | Item processing failed:`, e);
            ui.notifications.info(game.i18n.localize("ionrift-respite.restResolve.restComplete"));
        }

        // Write training XP onto the sheet. Runs GM-side where this resolution
        // path executes, so the GM has permission to update every actor.
        try {
            await app._session?._applyTrainingXP(app._outcomes);
        } catch (e) {

            console.warn(`${MODULE_ID} | Training XP application failed:`, e);
        }

        // Auto-grant party discoveries (event loot) to watch roster members
        try {
            await this._autoGrantPartyDiscoveries();
        } catch (e) {

            console.warn(`${MODULE_ID} | Auto-grant party discoveries failed:`, e);
        }

        // Post condition advisory for any unhandled condition/temp_hp effects.
        // Pass the disaster-path applied set so the advisory renders those as
        // already-applied and skips a redundant CE add for the same condition.
        try {
            await ConditionAdvisory.processAll(app._outcomes, {
                preApplied: app._preAppliedConditions ?? new Set()
            });
        } catch (e) {

            console.warn(`${MODULE_ID} | Condition advisory failed:`, e);
        }
        app._preAppliedConditions = null;

        // The dawn screen repeated the chat summary. Post the card and close.
        app._masterCardPosted = false;

        const restType = app._engine?.restType ?? "long";
        await CalendarHandler.advanceRestTime(restType);
        await CalendarHandler.recordRestDate();

        app._restApplied = true;
        try {
            await this.postMasterRestCard();
        } catch (err) {
            console.warn(`${MODULE_ID} | Failed to post master rest card:`, err);
        }
        await app.close({ resolved: true });
    }

    rehydrateItemLossProposal(eff) { return RestResolutionCardMethods.rehydrateItemLossProposal.call(this, eff); }
    _sanitizeItemLabel(raw) { return RestResolutionCardMethods._sanitizeItemLabel.call(this, raw); }
    async showResourceLossApproval(unified) { return RestResolutionCardMethods.showResourceLossApproval.call(this, unified); }
    _buildResolutionCards(outcomes) { return RestResolutionCardMethods._buildResolutionCards.call(this, outcomes); }
    async _autoGrantPartyDiscoveries() { return RestResolutionCardMethods._autoGrantPartyDiscoveries.call(this); }
    async onAbandonRest(event, target) { return RestResolutionCardMethods.onAbandonRest.call(this, event, target); }
    _resolveActivityName(activityId) { return RestResolutionCardMethods._resolveActivityName.call(this, activityId); }
    _humanizeItemLabel(item) { return RestResolutionCardMethods._humanizeItemLabel.call(this, item); }
    async postMasterRestCard() { return RestResolutionCardMethods.postMasterRestCard.call(this); }
}