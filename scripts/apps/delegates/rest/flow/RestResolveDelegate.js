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
import { GrantLedger } from "../../../../services/crafting/outcomes/GrantLedger.js";
import { purgeDetectMagicRestArtifacts } from "../../crafting/DetectMagicDelegate.js";
import { SoundDelegate } from "../SoundDelegate.js";
import {
    clearCampTokens,
    getCampSceneId,
    resetCampSession
} from "../../../../services/camp/props/CompoundCampPlacer.js";
import {
    emitRestAbandoned
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { RestSetupApp } from "../../../rest/RestSetupApp.js";
import { confirmAbandonRest } from "../../../rest/confirmAbandonRest.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { TerrainRegistry } from "../../../../services/events/resolve/TerrainRegistry.js";
import { ImageResolver } from "../../../../utils/ImageResolver.js";

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

    async _onResolveEvents(event, target) {
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
                            name: "Gold",
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
                ui.notifications.info(`Rest complete: ${totalItems} item${totalItems === 1 ? "" : "s"} created.`);
            } else {
                ui.notifications.info("Rest complete.");
            }
        } catch (e) {

            console.warn(`${MODULE_ID} | Item processing failed:`, e);
            ui.notifications.info("Rest complete.");
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
    }

    _sanitizeItemLabel(raw) {
        if (!raw) return "";
        return String(raw)
            .replace(/\s*\([a-z0-9]{4,8}\)$/i, "")
            .replace(/\s*\[[a-z0-9]{4,8}\]$/i, "")
            .trim();
    }

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
                    name: "Gold",
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
                            <h3>Disaster Loss Reconciliation</h3>
                        </div>
                        <button type="button" class="btn-modal-close" title="Close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="loss-summary-banner">
                        <i class="fas fa-exclamation-circle"></i>
                        <span>The incident proposes <strong>${allEntries.length}</strong> casualty/resource losses across the party. Review and uncheck any to preserve.</span>
                    </div>
                    <div class="loss-controls-bar">
                        <div class="loss-batch-actions">
                            <button type="button" class="loss-btn-subtle loss-select-all"><i class="fas fa-check-double"></i> Select All</button>
                            <button type="button" class="loss-btn-subtle loss-select-none"><i class="fas fa-times"></i> Select None</button>
                        </div>
                        <span class="loss-controls-hint">Uncheck to preserve items</span>
                    </div>
                    <div class="loss-scrollable">
                        ${scrollContent}
                    </div>
                    <div class="respite-disaster-modal-footer">
                        <div class="loss-tally">
                            <i class="fas fa-boxes-stacked"></i>
                            <span class="loss-tally-count">${allEntries.length} losses approved</span>
                        </div>
                        <div class="modal-footer-actions">
                            <button type="button" class="btn-loss-cancel"><i class="fas fa-times"></i> Cancel</button>
                            <button type="button" class="btn-loss-confirm"><i class="fas fa-check"></i> <span>Confirm Losses (${allEntries.length})</span></button>
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
    }

    _buildResolutionCards(outcomes) {
        const app = this._app;

        const activityResolver = app._activityResolver;

        const classifyActivity = (result) => {
            switch (result) {
                case "exceptional": return { valence: "positive", label: "Exceptional", icon: "fas fa-star" };
                case "success": return { valence: "positive", label: "Success", icon: "fas fa-check" };
                case "failure":
                case "failure_complication": return { valence: "negative", label: "Failed", icon: "fas fa-times" };
                default: return { valence: "neutral", label: null, icon: "fas fa-circle" };
            }
        };
        const classifyEvent = (resolvedOutcome) => {
            switch (resolvedOutcome) {
                case "triumph": return { valence: "positive", label: "Triumph", icon: "fas fa-star" };
                case "success": return { valence: "positive", label: "Passed", icon: "fas fa-check" };
                case "partial": return { valence: "partial", label: "Partial", icon: "fas fa-exclamation-triangle" };
                case "failure":
                case "failure_complication": return { valence: "negative", label: "Failed", icon: "fas fa-times" };
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

            const exhaustionConditionLabel = recovery.comfortLevel === "hostile" ? "Hostile" : "Rough";

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
    
    }

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
    
    }

    async onAbandonRest(event, target) {
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

        ui.notifications.info("Rest abandoned.");
        app.close({ resolved: true, abandoned: true });
    
    }

    _resolveActivityName(activityId) {
        if (!activityId) return "Rested";
        const normalized = activityId === "act_set_defenses" ? "act_defenses" : activityId;
        const act = this._app._activityResolver?.activities?.get(normalized);
        if (act?.name) return act.name;
        return normalized
            .replace(/^act_/, "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    _humanizeItemLabel(item) {
        let label = item?.name || item?.itemRef || "";
        label = label.replace(/^compendium\./, "").replace(/^[a-z0-9_-]+-items\./, "");
        if (!label) return "Supplies";
        if (label.includes("_")) {
            return label.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        }
        return label;
    }

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
        const title = restType === "long" ? "Long Rest Complete — Dawn Breaks" : "Short Rest Complete";

        const activeShelters = app._engine?.activeShelters ?? [];
        const shelterNames = activeShelters.map(s => {
            if (s === "tent") return "Tent pitched";
            if (s === "tiny_hut") return "Tiny Hut";
            if (s === "rope_trick") return "Rope Trick";
            if (s === "magnificent_mansion") return "Mansion";
            return s;
        });
        const shelterSummary = shelterNames.length ? shelterNames.join(", ") : "Open Sky";

        // Summary metrics
        const totalHpRestored = outcomes.reduce((sum, o) => sum + (o.recovery?.hpRestored ?? 0), 0);
        const totalHdRestored = outcomes.reduce((sum, o) => sum + (o.recovery?.hdRestored ?? 0), 0);
        const totalExhaustionGained = outcomes.reduce((sum, o) => sum + Math.max(0, o.recovery?.exhaustionDelta ?? 0), 0);

        let vitalSummary = "Full Vital Recovery";
        if (totalExhaustionGained > 0) {
            vitalSummary = `+${totalHpRestored} HP, +${totalHdRestored} HD (+${totalExhaustionGained} Exh)`;
        } else if (totalHpRestored > 0 || totalHdRestored > 0) {
            vitalSummary = `+${totalHpRestored} HP, +${totalHdRestored} HD`;
        }
        const vitalDetail = "Spell slots, hit dice & features reset";

        const incidentsCount = (app._triggeredEvents ?? []).length;

        const fireLevel = app._fireLevel ?? "unlit";
        const hearthLabel = fireLevel !== "unlit" ? fireLevel.charAt(0).toUpperCase() + fireLevel.slice(1) : "Cold Camp";
        const shelterDetail = shelterSummary;

        const mealLabel = app._mealResults?.length ? "Camp Meal Consumed" : "Rations Accounted";
        const mealDetail = "Adequate sustenance for the night";

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
                name: evt.name ?? "Night Event",
                verdictLabel: evt.resolvedOutcome ? (evt.resolvedOutcome === "success" ? "Passed" : (evt.resolvedOutcome === "triumph" ? "Triumph" : "Failed")) : null,
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
        let badgeLabel = `Night Events (${incidents.length})`;

        if (allRewarding) {
            containerClass = "rewarding";
            badgeIcon = "fas fa-gem";
            badgeLabel = `Discoveries (${incidents.length})`;
        } else if (anyDanger) {
            containerClass = "hostile";
            badgeIcon = "fas fa-shield-halved";
            badgeLabel = `Incidents Resolved (${incidents.length})`;
        }

        const incidentsMeta = { containerClass, badgeIcon, badgeLabel };

        let securityLabel = "Night Security";
        let securityIcon = "fas fa-shield-halved";
        let securityValue = incidents.length === 0 ? "Quiet Night" : `${incidents.length} Incident${incidents.length > 1 ? "s" : ""}`;
        let securityPositive = incidents.length === 0;
        let securityDetail = "Watch completed without incident";

        if (allRewarding) {
            securityLabel = "Discoveries";
            securityIcon = "fas fa-gem";
            securityValue = `${incidents.length} Found`;
            securityPositive = true;
            securityDetail = "Watch uncovered beneficial discoveries";
        } else if (anyDanger) {
            securityLabel = "Night Security";
            securityIcon = "fas fa-shield-halved";
            securityValue = `${incidents.filter(i => i.isDanger).length} Threat${incidents.filter(i => i.isDanger).length > 1 ? "s" : ""}`;
            securityPositive = false;
            securityDetail = "Resolved during watch";
        } else if (incidents.length > 0) {
            securityLabel = "Night Events";
            securityIcon = "fas fa-campground";
            securityValue = `${incidents.length} Resolved`;
            securityPositive = true;
            securityDetail = "Events resolved during watch";
        }

        // Characters
        const characters = outcomes
            .filter(o => o.characterId)
            .map(o => {
            const actor = game.actors.get(o.characterId);
            const recovery = o.recovery ?? {};

            // Activity
            const actSub = (o.outcomes ?? []).find(s => s.source === "activity");
            let activityLabel = "Rested";
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

            let vitalPill = "Max HP, Max HD";
            if (exhaustionDelta > 0) {
                vitalPill = `+${exhaustionDelta} Exhaustion`;
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
                notes.push(`<i class="fas fa-heartbeat" style="color:#10b981;"></i> <strong>${parts.join(", ")}</strong> restored`);
            } else {
                notes.push(`<i class="fas fa-heart" style="color:#10b981;"></i> Vital recovery maxed (Full HP & HD)`);
            }

            if (recovery.exhaustionDelta < 0) {
                notes.push(`<i class="fas fa-arrow-down" style="color:#10b981;"></i> ${Math.abs(recovery.exhaustionDelta)} exhaustion recovered`);
            } else if (recovery.exhaustionDelta > 0) {
                const reason = recovery.exhaustionDC ? `failed CON save DC ${recovery.exhaustionDC}` : "rest conditions";
                notes.push(`<i class="fas fa-arrow-up" style="color:#f87171;"></i> <strong>+${recovery.exhaustionDelta} Exhaustion</strong> (${reason})`);
            } else if (recovery.exhaustionSaveResult === "failed") {
                notes.push(`<i class="fas fa-arrow-right" style="color:#fbbf24;"></i> Failed CON save DC ${recovery.exhaustionDC} (+1 exhaustion offset by rest)`);
            } else if (recovery.exhaustionSaveResult === "passed") {
                notes.push(`<i class="fas fa-shield" style="color:#10b981;"></i> Passed CON save DC ${recovery.exhaustionDC}`);
            }

            for (const sub of (o.outcomes ?? [])) {
                if (sub.items?.length) {
                    for (const item of sub.items) {
                        const qty = item.quantity > 1 ? ` &times;${item.quantity}` : "";
                        const icon = sub.source === "event" ? "fas fa-gem" : "fas fa-plus-circle";
                        const color = sub.source === "event" ? "#fbbf24" : "#10b981";
                        const label = this._humanizeItemLabel(item);
                        notes.push(`<i class="${icon}" style="color:${color};"></i> Obtained <strong>${label}${qty}</strong>`);
                    }
                }
            }

            if (recovery.eventDamage > 0) {
                notes.push(`<i class="fas fa-tint" style="color:#ef4444;"></i> <strong>Took ${recovery.eventDamage} damage</strong> during night`);
            }

            const reequipped = app._reequippedArmor?.get(o.characterId);
            if (reequipped) {
                notes.push(`<i class="fas fa-shield-alt"></i> Donned <strong>${reequipped}</strong> upon breaking camp`);
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
            ? { label: "Setbacks Incurred", icon: "fas fa-triangle-exclamation", class: "setback" }
            : { label: "All Rested", icon: "fas fa-sparkles", class: "positive" };

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
}
