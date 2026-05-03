import { Logger } from "../lib/Logger.js";
import { ConditionAdvisory } from "./ConditionAdvisory.js";
import { ResourceSink } from "./ResourceSink.js";

const MODULE_ID = "ionrift-respite";

/**
 * Processes structured travel mishap effects (forage/hunt nat 1) and applies
 * mechanical outcomes using the same effect types as rest events.
 */
export class TravelMishapHandler {

    /**
     * @param {Actor} actor
     * @param {Object} mishap - Mishap row with description and effects[].
     * @param {import("./RestFlowEngine.js").RestFlowEngine|null} engine
     * @param {Object} [options]
     * @param {Object} [options.mutateTarget] - If set, store effectsApplied / appliedSummaries on this object.
     * @returns {Promise<string[]>} Human-readable summary lines for UI badges.
     */
    static async applyMishapEffects(actor, mishap, engine, options = {}) {
        if (!actor || !mishap?.effects?.length) return [];
        if (mishap.effectsApplied) return mishap.appliedSummaries ?? [];

        const targets = [options.mutateTarget, mishap].filter(Boolean);
        const summaries = [];

        for (const effect of mishap.effects) {
            try {
                const lines = await this._applyOneEffect(actor, effect, engine, mishap.description);
                for (const line of lines) {
                    if (line) summaries.push(line);
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | Travel mishap effect failed`, effect, e);
            }
        }

        for (const t of targets) {
            t.effectsApplied = true;
            t.appliedSummaries = summaries;
        }

        Logger.log(`Travel mishap applied for ${actor.name}: ${summaries.join("; ")}`);
        return summaries;
    }

    /**
     * @param {Actor} actor
     * @param {Object} effect
     * @param {import("./RestFlowEngine.js").RestFlowEngine|null} engine
     * @param {string} mishapDescription
     * @returns {Promise<string[]>}
     */
    static async _applyOneEffect(actor, effect, engine, mishapDescription) {
        const t = effect?.type;
        if (!t) return [];

        switch (t) {
            case "condition":
                return await this._applyCondition(actor, effect);
            case "exhaustion_delta":
                return await this._applyExhaustionDelta(actor, effect);
            case "consume_resource":
                return await this._consumeResource(actor, effect);
            case "supply_loss":
                return await this._applySupplyLossRandom(actor, effect);
            case "encounter_mod":
                return this._applyEncounterMod(engine, effect);
            case "recovery_penalty":
                return await this._applyRecoveryPenalty(actor, effect);
            case "travel_penalty":
                return await this._applyTravelPenalty(actor, effect, mishapDescription);
            default:
                Logger.warn(`Unknown travel mishap effect type: ${t}`);
                return [];
        }
    }

    static async _applyCondition(actor, effect) {
        const outcomes = [{
            characterId: actor.id,
            characterName: actor.name,
            outcomes: [{
                effects: [{
                    type: "condition",
                    condition: effect.condition,
                    level: effect.level,
                    duration: effect.duration,
                    label: effect.label,
                    description: effect.description,
                    checks: effect.checks
                }],
                source: "travel_mishap",
                eventId: "travel_mishap"
            }]
        }];

        await ConditionAdvisory.processAll(outcomes);

        const label = effect.label
            ?? this._formatConditionName(effect.condition, effect.level);
        return [label];
    }

    static _formatConditionName(condition, level) {
        if (!condition) return "Condition";
        const base = condition.charAt(0).toUpperCase() + condition.slice(1);
        if (condition === "exhaustion" && level != null) return `Exhaustion ${level}`;
        return base;
    }

    static async _applyExhaustionDelta(actor, effect) {
        const levels = Math.max(1, effect.levels ?? 1);
        const adapter = game.ionrift?.respite?.adapter;
        if (adapter?.applyExhaustionDelta) {
            await adapter.applyExhaustionDelta(actor, levels);
        } else {
            const current = actor.system?.attributes?.exhaustion ?? 0;
            const newLevel = Math.min(6, current + levels);
            if (newLevel > current) {
                await actor.update({ "system.attributes.exhaustion": newLevel });
            }
        }

        await ChatMessage.create({
            content: `<div class="respite-recovery-chat"><strong>${actor.name}</strong> gains <strong>${levels}</strong> level(s) of exhaustion from a travel mishap.</div>`,
            speaker: ChatMessage.getSpeaker({ actor })
        });

        return [`+${levels} exhaustion`];
    }

    static async _consumeResource(actor, effect) {
        const resource = effect.resource ?? "supplies";
        const amount = Math.max(1, effect.amount ?? 1);
        const holdings = ResourceSink._findResourceItems([actor], resource);
        const totalQty = holdings.reduce((s, h) => s + h.qty, 0);
        if (totalQty === 0) {
            await this._whisperGMAdvisory(
                `Travel mishap: ${actor.name} had no ${resource} to lose (${effect.description ?? "resource loss"}).`
            );
            return [`No ${resource} to lose`];
        }

        const lost = await ResourceSink._distributeResourceLoss(holdings, Math.min(amount, totalQty));
        if (lost <= 0) {
            return [];
        }

        const label = resource === "rations" ? "Rations"
            : resource === "water" ? "Water"
                : "Supplies";
        await ChatMessage.create({
            content: `<div class="respite-recovery-chat">Travel mishap: <strong>${actor.name}</strong> lost <strong>${lost}</strong> ${label.toLowerCase()}.</div>`,
            speaker: ChatMessage.getSpeaker({ actor })
        });
        return [`${label} -${lost}`];
    }

    static async _applySupplyLossRandom(actor, effect) {
        const holdings = ResourceSink._findResourceItems([actor], "supplies");
        if (!holdings.length) {
            await this._whisperGMAdvisory(
                `Travel mishap: ${actor.name} had no adventuring supplies to lose.`
            );
            return ["No supplies to lose"];
        }
        const pick = holdings[Math.floor(Math.random() * holdings.length)];
        const item = pick.item;
        const qty = pick.qty;
        const loseQty = Math.min(effect.amount ?? 1, qty);
        const newQty = qty - loseQty;

        if (newQty <= 0) {
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
        } else {
            await actor.updateEmbeddedDocuments("Item", [
                { _id: item.id, "system.quantity": newQty }
            ]);
        }

        await ChatMessage.create({
            content: `<div class="respite-recovery-chat">Travel mishap: <strong>${actor.name}</strong> lost a pack item: <strong>${item.name}</strong>.</div>`,
            speaker: ChatMessage.getSpeaker({ actor })
        });

        return [`Lost: ${item.name}`];
    }

    static _applyEncounterMod(engine, effect) {
        if (!engine) {
            Logger.warn("Travel encounter_mod: no engine (rest flow not initialised).");
            return ["Encounter (engine missing)"];
        }
        if (!engine._encounterBreakdown) engine._encounterBreakdown = {};
        const delta = effect.encounterDCDelta ?? 0;
        const prev = engine._encounterBreakdown.travelMishap ?? 0;
        engine._encounterBreakdown.travelMishap = prev + delta;

        return [`Night threshold ${delta >= 0 ? "+" : ""}${delta} (mishap)`];
    }

    static async _applyRecoveryPenalty(actor, effect) {
        const mult = effect.hpMultiplier;
        if (typeof mult !== "number" || mult <= 0) return [];
        const prev = (await actor.getFlag(MODULE_ID, "travelMishapRecovery")) ?? {};
        const next = { hpMultiplier: (prev.hpMultiplier ?? 1) * mult };
        await actor.setFlag(MODULE_ID, "travelMishapRecovery", next);

        await this._whisperGMAdvisory(
            `Travel mishap: <strong>${actor.name}</strong> has reduced HP recovery this rest (x${mult} multiplier).`
        );
        return [`HP recovery x${mult}`];
    }

    static async _applyTravelPenalty(actor, effect, mishapDescription) {
        const penalty = effect.penalty;
        if (penalty === "activity_disadvantage") {
            await actor.setFlag(MODULE_ID, "travelMishapPenalty", "activity_disadvantage");
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><strong>${actor.name}</strong> is shaken from a travel mishap. Their camp activity will be at <strong>disadvantage</strong> if the activity uses a check.</div>`,
                speaker: { alias: "Respite" }
            });
            return ["Activity check: disadvantage"];
        }
        if (penalty === "lose_activity") {
            await actor.setFlag(MODULE_ID, "travelMishapPenalty", "lose_activity");
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><strong>${actor.name}</strong> is hurt during travel and cannot use a rest activity this night. They are set to <strong>Other</strong>.</div>`,
                speaker: { alias: "Respite" }
            });
            return ["No rest activity (Other)"];
        }
        return [];
    }

    static async _whisperGMAdvisory(html) {
        await ChatMessage.create({
            content: `<div class="ionrift-travel-mishap-advisory">${html}</div>`,
            speaker: { alias: "Respite" },
            whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
            flags: { [MODULE_ID]: { type: "travel_mishap_advisory" } }
        });
    }
}
