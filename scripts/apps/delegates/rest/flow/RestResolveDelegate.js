import { Logger } from "../../../../utils/Logger.js";
import { ResourceSink } from "../../../../services/rest/recovery/ResourceSink.js";
import { RecoveryHandler } from "../../../../services/rest/recovery/RecoveryHandler.js";
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
    emitPhaseChanged,
    emitRestAbandoned
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { RestSetupApp } from "../../../rest/RestSetupApp.js";
import { MODULE_ID } from "../../../../data/moduleId.js";

export class RestResolveDelegate {
    constructor(app) {
        this._app = app;
    }

    async onResolveEvents(event, target) {
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

            // Whisper each player what they lost
            const lossByActor = new Map();
            function addLoss(actorId, actorName, line) {
                if (!lossByActor.has(actorId)) lossByActor.set(actorId, { name: actorName, lines: [] });
                lossByActor.get(actorId).lines.push(line);
            }

            for (const p of unified.supplyProposals) {
                for (const e of p.breakdown) {
                    addLoss(e.actorId, e.actorName,
                        `<i class="fas fa-box-open" style="color:#f1948a;"></i> <strong>${e.itemName ?? "Supplies"}</strong> &times;${e.lossQty} lost`);
                }
            }
            for (const p of unified.itemAtRiskProposals) {
                for (const c of p.candidates) {
                    if (!c._approved) continue;
                    const label = c.lossQty > 1 ? `${c.item.name} &times;${c.lossQty}` : c.item.name;
                    addLoss(c.actor.id, c.actor.name,
                        `<i class="fas fa-times-circle" style="color:#f1948a;"></i> <strong>${label}</strong> lost`);
                }
            }
            for (const p of unified.goldProposals) {
                for (const e of p.breakdown) {
                    addLoss(e.actorId, e.actorName,
                        `<i class="fas fa-coins" style="color:#f1948a;"></i> <strong>${e.lossGp} gp</strong> lost`);
                }
            }

            for (const [actorId, data] of lossByActor) {
                if (data.lines.length === 0) continue;
                const actor = game.actors.get(actorId);
                if (!actor) continue;
                const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
                const whisperTargets = ownerUser ? [ownerUser.id] : game.users.filter(u => u.isGM).map(u => u.id);

                try {
                    await ChatMessage.create({
                        content: `<h3><i class="fas fa-water"></i> ${data.name}'s Disaster Losses</h3>\n${data.lines.join("\n")}`,
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
            await RestSetupApp._applyTrainingXP(app._outcomes);
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

        // Send private whispered rest summary to each player
        for (const outcome of app._outcomes) {
            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;

            const ownerUser = game.users.find(u =>
                !u.isGM && actor.testUserPermission(u, "OWNER")
            );
            if (!ownerUser) continue;

            const lines = [`<h3>${actor.name}'s Rest</h3>`];
            for (const sub of (outcome.outcomes ?? [])) {
                lines.push(`<p><em>${sub.narrative}</em></p>`);
                if (sub.training?.rolls?.length) {
                    lines.push(RestSetupApp._buildTrainingProgressBar(sub.training));
                }
                if (sub.items?.length) {
                    for (const item of sub.items) {
                        const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
                        lines.push(`<p><i class="fas fa-plus-circle"></i> <strong>${item.name || item.itemRef}${qty}</strong></p>`);
                    }
                }
            }

            const recovery = outcome.recovery;
            if (recovery) {
                const recParts = [];
                if (recovery.hpRestored > 0) recParts.push(`+${recovery.hpRestored} HP`);
                if (recovery.hdRestored > 0) recParts.push(`+${recovery.hdRestored} HD`);
                if (recParts.length) {
                    lines.push(`<p><i class="fas fa-heartbeat"></i> ${recParts.join(", ")} restored</p>`);
                }
                // Exhaustion change with reason
                if (recovery.exhaustionDelta < 0) {
                    lines.push(`<p><i class="fas fa-arrow-down" style="color:#82e0aa;"></i> <span style="color:#82e0aa;">${Math.abs(recovery.exhaustionDelta)} exhaustion recovered</span></p>`);
                } else if (recovery.exhaustionDelta > 0) {
                    const reason = recovery.exhaustionDC ? `failed CON save DC ${recovery.exhaustionDC}` : "rest conditions";
                    lines.push(`<p><i class="fas fa-arrow-up" style="color:#f1948a;"></i> <span style="color:#f1948a;">+${recovery.exhaustionDelta} exhaustion (${reason})</span></p>`);
                } else if (recovery.exhaustionDelta === 0 && recovery.exhaustionSaveResult === "failed") {
                    lines.push(`<p><i class="fas fa-arrow-right" style="color:#f9d77e;"></i> <span style="color:#f9d77e;">Failed CON save DC ${recovery.exhaustionDC} (+1 exhaustion, offset by rest recovery -1)</span></p>`);
                }
                if (recovery.comfortLevel === "hostile") {
                    lines.push(`<p style="font-size:0.85em;color:#f9d77e;"><i class="fas fa-skull"></i> Hostile conditions prevent natural exhaustion recovery</p>`);
                }
                if (recovery.noFoodOrWater) {
                    lines.push(`<p style="font-size:0.85em;color:#f9d77e;"><i class="fas fa-tint-slash"></i> Lack of food or water prevents exhaustion recovery</p>`);
                }
                // Surface gear contributions so the player sees their inventory mattered
                if (recovery.gearDescriptors?.length) {
                    const gearLine = recovery.gearDescriptors.map(d => `<i class="fas fa-cog"></i> ${d}`).join("<br>");
                    lines.push(`<p style="font-size:0.85em;opacity:0.8;">${gearLine}</p>`);
                }
                
                // Display event damage visually
                if (recovery.eventDamage > 0) {
                    const dmgEvents = (outcome.outcomes ?? [])
                        .filter(sub => sub.source === "event" && sub.effects?.some(e => e.type === "damage"))
                        .map(sub => sub.eventName);
                    const sourceText = dmgEvents.length > 0 ? dmgEvents.join(", ") : "an event";
                    lines.push(`<p><i class="fas fa-tint" style="color:#e74c3c;"></i> <strong style="color:#e74c3c;">Took ${recovery.eventDamage} damage</strong> from ${sourceText}</p>`);
                }
            }

            const reequipped = reequippedArmor.get(outcome.characterId);
            if (reequipped) {
                lines.push(`<p><i class="fas fa-shield-alt"></i> You don your <strong>${reequipped}</strong> as you break camp.</p>`);
            }

            try {
                await ChatMessage.create({
                    content: lines.join("\n"),
                    whisper: [ownerUser.id],
                    speaker: { alias: "Respite" },
                    flags: { [MODULE_ID]: { type: "restSummary" } }
                });
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to whisper rest summary to ${ownerUser.name}:`, e);
            }
        }

        // Record rest date via calendar handler
        await CalendarHandler.recordRestDate();

        emitPhaseChanged("resolve", {
                outcomes: app._outcomes.map(o => ({
                    characterId: o.characterId,
                    characterName: o.characterName,
                    outcomes: o.outcomes,
                    recovery: o.recovery
                }))
            });

        app._restApplied = true;
        app.render();
    
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
            if (!byActor.has(actorId)) byActor.set(actorId, { name: actorName, rows: [] });
            return byActor.get(actorId);
        }

        for (const proposal of supplyProposals) {
            for (const entry of proposal.breakdown) {
                const uid = `supply-${entry.actorId}-${entry.itemId}`;
                const actor = game.actors.get(entry.actorId);
                const item = actor?.items.get(entry.itemId);
                const img = item?.img ?? "icons/containers/bags/pack-leather-brown.webp";
                const remaining = entry.currentQty - entry.lossQty;
                entry._uid = uid;
                allEntries.push({ uid });
                ensureActor(entry.actorId, entry.actorName).rows.push({
                    uid, img, name: item?.name ?? entry.itemName,
                    qtyLabel: `-${entry.lossQty}`,
                    rangeLabel: `${entry.currentQty} to ${remaining}`
                });
            }
        }

        for (const proposal of itemAtRiskProposals) {
            for (const candidate of proposal.candidates) {
                const uid = `item-${candidate.actor.id}-${candidate.item.id}`;
                candidate._uid = uid;
                const remaining = candidate.currentQty - candidate.lossQty;
                allEntries.push({ uid });
                ensureActor(candidate.actor.id, candidate.actor.name).rows.push({
                    uid, img: candidate.item.img ?? "icons/svg/mystery-man.svg",
                    name: candidate.item.name,
                    qtyLabel: candidate.lossQty > 1 ? `-${candidate.lossQty}` : "lost",
                    rangeLabel: candidate.currentQty > 1 ? `${candidate.currentQty} to ${remaining}` : "removed"
                });
            }
        }

        for (const proposal of goldProposals) {
            for (const entry of proposal.breakdown) {
                const uid = `gold-${entry.actorId}`;
                entry._uid = uid;
                const remaining = entry.currentGp - entry.lossGp;
                allEntries.push({ uid });
                ensureActor(entry.actorId, entry.actorName).rows.push({
                    uid, img: "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp",
                    name: "Gold",
                    qtyLabel: `-${entry.lossGp} gp`,
                    rangeLabel: `${entry.currentGp} to ${remaining} gp`
                });
            }
        }

        // If nothing to show at all
        if (allEntries.length === 0) {
            return new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal" style="max-width:420px;">
                        <h3><i class="fas fa-water"></i> Disaster Losses</h3>
                        <p>The disaster had no material impact. No supplies, items, or gold were at risk.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> Acknowledged</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                    overlay.remove();
                    resolve(true);
                });
            });
        }

        let scrollContent = "";
        for (const [actorId, group] of byActor) {
            let rows = "";
            for (const r of group.rows) {
                rows += `
                    <label class="loss-item-row" data-uid="${r.uid}">
                        <input type="checkbox" checked data-uid="${r.uid}" class="loss-checkbox" />
                        <img src="${r.img}" width="20" height="20" style="border-radius:3px; border:1px solid rgba(255,255,255,0.1);" />
                        <span class="loss-item-name">${r.name}</span>
                        <span class="loss-item-qty">${r.qtyLabel}</span>
                        <span class="loss-item-current">${r.rangeLabel}</span>
                    </label>`;
            }
            scrollContent += `
                <div class="loss-actor-section">
                    <div class="loss-section-label"><i class="fas fa-user"></i> ${group.name}</div>
                    ${rows}
                </div>`;
        }

        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal" style="max-width:520px;">
                    <h3><i class="fas fa-water"></i> Disaster Loss Approval</h3>
                    <div class="loss-summary">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>The disaster proposes <strong>${allEntries.length}</strong> losses across the party. Review and confirm.</span>
                    </div>
                    <div class="loss-controls">
                        <button type="button" class="loss-select-all"><i class="fas fa-check-double"></i> Select All</button>
                        <button type="button" class="loss-select-none"><i class="fas fa-times"></i> Select None</button>
                    </div>
                    <div class="loss-scrollable">
                        ${scrollContent}
                    </div>
                    <div class="loss-tally">
                        <i class="fas fa-calculator"></i>
                        <span class="loss-tally-count">${allEntries.length} losses selected</span>
                    </div>
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="fas fa-check"></i> Confirm Losses</button>
                        <button class="btn-armor-cancel"><i class="fas fa-times"></i> Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            function updateTally() {
                const count = overlay.querySelectorAll(".loss-checkbox:checked").length;
                const tally = overlay.querySelector(".loss-tally-count");
                if (tally) tally.textContent = `${count} losses selected`;
            }

            overlay.querySelector(".loss-select-all").addEventListener("click", () => {
                overlay.querySelectorAll(".loss-checkbox").forEach(cb => cb.checked = true);
                updateTally();
            });
            overlay.querySelector(".loss-select-none").addEventListener("click", () => {
                overlay.querySelectorAll(".loss-checkbox").forEach(cb => cb.checked = false);
                updateTally();
            });
            overlay.querySelectorAll(".loss-checkbox").forEach(cb => cb.addEventListener("change", updateTally));

            // Confirm: mark approved entries on the original proposals
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
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

                overlay.remove();
                resolve(true);
            });

            overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                overlay.remove();
                resolve(false);
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

        const confirmed = await new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal">
                    <h3><i class="fas fa-exclamation-triangle"></i> Abandon Rest?</h3>
                    <p>This will cancel the rest for all players. Any unsaved progress will be lost.</p>
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="fas fa-times"></i> Abandon</button>
                        <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Continue Resting</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                overlay.remove();
                resolve(true);
            });
            overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                overlay.remove();
                resolve(false);
            });
        });
        if (!confirmed) return;

        app._terminated = true;
        app._cancelCampPlacementCanvasMode();

        await app._removeBeddingDown();

        // Clear persisted rest state
        await game.settings.set(MODULE_ID, "activeRest", {});
        app._clearTavernTotmOverride();

        // Detect Magic + workbench staging (skip save: activeRest already cleared)
        app._clearDetectMagicScanSession({ skipSave: true });

        emitRestAbandoned();

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
}
