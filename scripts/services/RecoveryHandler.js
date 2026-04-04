/**
 * RecoveryHandler
 * Applies comfort-modified HP, Hit Dice, and exhaustion recovery to actors.
 * Spell slots and class features are left to the system (always full on long rest).
 *
 * This handler is called during the Resolve phase, NOT via the dnd5e rest hook.
 * Instead, we suppress the system's HP/HD recovery via dnd5e.preRestCompleted
 * and apply our own modified values here.
 *
 * Exhaustion:
 * - Long rest: normally reduces exhaustion by 1 (dnd5e default).
 * - Hostile comfort: blocks exhaustion reduction.
 * - 'Rest Fully' activity: grants an extra -1 exhaustion.
 * - Events can inflict exhaustion (+1) via their effect arrays.
 */

const MODULE_ID = "ionrift-respite";

export class RecoveryHandler {

    /**
     * Applies comfort-based recovery to a single actor.
     * @param {Actor} actor - The DnD5e actor
     * @param {Object} recovery - From RestFlowEngine._calculateRecovery()
     * @param {number} recovery.hpRestored - HP to restore
     * @param {number} recovery.hdRestored - Hit Dice to restore
     * @param {boolean} recovery.spellSlotsRestored - Whether spell slots recover
     * @param {string} recovery.comfortLevel - Comfort key for logging
     * @returns {Object} Summary of what was actually applied
     */
    static async apply(actor, recovery) {
        if (!actor || !recovery) return { hp: 0, hd: 0, exhaustion: 0 };

        const hp = actor.system?.attributes?.hp;
        if (!hp) return { hp: 0, hd: 0, exhaustion: 0 };

        // --- HP Recovery ---
        const currentHp = hp.value ?? 0;
        const maxHp = hp.max ?? 0;
        const hpToRestore = Math.min(recovery.hpRestored, maxHp - currentHp);
        const newHp = Math.min(currentHp + hpToRestore, maxHp);

        // --- Hit Dice Recovery ---
        const hdRecovered = this._recoverHitDice(actor, recovery.hdRestored);

        // --- Exhaustion Recovery ---
        const exhaustionDelta = await this._calculateExhaustionDelta(actor, recovery);
        recovery.exhaustionDelta = exhaustionDelta;

        // Apply HP update
        if (newHp !== currentHp) {
            await actor.update({ "system.attributes.hp.value": newHp });
        }

        // Apply exhaustion update
        if (exhaustionDelta !== 0) {
            const currentExhaustion = actor.system?.attributes?.exhaustion ?? 0;
            const newExhaustion = Math.max(0, Math.min(6, currentExhaustion + exhaustionDelta));
            if (newExhaustion !== currentExhaustion) {
                await actor.update({ "system.attributes.exhaustion": newExhaustion });
            }
        }

        // Post recovery summary to chat
        await this._postRecoveryChat(actor, recovery, hpToRestore, hdRecovered, exhaustionDelta);

        return { hp: hpToRestore, hd: hdRecovered, exhaustion: exhaustionDelta };
    }

    /**
     * Applies recovery to all characters in the outcomes array.
     * @param {Object[]} outcomes - From RestFlowEngine.resolve()
     * @param {boolean} skipIfRestRecovery - If true, skip HP/HD (rest-recovery handles it)
     * @returns {Object[]} Per-character recovery summaries
     */
    static async applyAll(outcomes, skipIfRestRecovery = false) {
        if (skipIfRestRecovery) {
            console.log(`${MODULE_ID} | Skipping HP/HD recovery (rest-recovery module active)`);
            return outcomes.map(o => ({ characterId: o.characterId, hp: 0, hd: 0, deferred: true }));
        }

        const results = [];
        for (const outcome of outcomes) {
            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;
            const result = await this.apply(actor, outcome.recovery);

            // Apply event damage from failed complication effects
            const damageApplied = await this._applyEventDamage(actor, outcome);
            if (damageApplied > 0) result.eventDamage = damageApplied;

            results.push({ characterId: outcome.characterId, ...result });

            // Write exhaustion delta back to outcome.recovery so UI can display it
            if (outcome.recovery) outcome.recovery.exhaustionDelta = result.exhaustion ?? 0;
        }
        return results;
    }

    /**
     * Recovers hit dice on an actor, preferring the largest die sizes first.
     * @param {Actor} actor
     * @param {number} hdToRecover - Number of HD to recover
     * @returns {number} Actual HD recovered
     */
    static _recoverHitDice(actor, hdToRecover) {
        if (hdToRecover <= 0) return 0;

        // DnD5e v3+: actor.system.attributes.hd contains HD data
        // Classes each have their own HD pool
        const classes = actor.items.filter(i => i.type === "class");
        if (!classes.length) return 0;

        // Sort by die size descending (d12 before d10 before d8...)
        const sorted = classes
            .map(cls => ({
                item: cls,
                dieSize: parseInt(cls.system?.hitDice?.replace("d", "")) || 8,
                spent: (cls.system?.hitDiceUsed ?? 0),
                max: cls.system?.levels ?? 0
            }))
            .filter(c => c.spent > 0) // Only classes with spent HD
            .sort((a, b) => b.dieSize - a.dieSize);

        let remaining = hdToRecover;
        let totalRecovered = 0;
        const updates = [];

        for (const cls of sorted) {
            if (remaining <= 0) break;
            const canRecover = Math.min(remaining, cls.spent);
            if (canRecover > 0) {
                updates.push({
                    _id: cls.item.id,
                    "system.hitDiceUsed": cls.spent - canRecover
                });
                remaining -= canRecover;
                totalRecovered += canRecover;
            }
        }

        // Apply HD updates
        if (updates.length > 0) {
            actor.updateEmbeddedDocuments("Item", updates);
        }

        return totalRecovered;
    }

    /**
     * Calculates the exhaustion change for this rest.
     * Long rest: -1 by default (dnd5e rules).
     * Hostile comfort: no reduction (0).
     * 'Rest Fully' activity: extra -1.
     * Rough/Hostile: CON save against exhaustionDC or gain +1 exhaustion.
     * Mess Kit + fire: advantage on the exhaustion save.
     * Events may add exhaustion (+N).
     * @param {Actor} actor
     * @param {Object} recovery
     * @returns {number} Net exhaustion change (negative = reduction, positive = gained)
     */
    static async _calculateExhaustionDelta(actor, recovery) {
        const currentExhaustion = actor.system?.attributes?.exhaustion ?? 0;
        if (currentExhaustion === 0 && !(recovery.exhaustionGain > 0) && !recovery.exhaustionDC) return 0;

        let delta = 0;

        // Long rest base reduction (matches dnd5e default: -1 per long rest)
        if (recovery.restType === "long") {
            if (recovery.comfortLevel === "hostile") {
                // Hostile conditions: no natural exhaustion reduction
                delta = 0;
            } else {
                delta = -1;
            }
        }

        // 'Rest Fully' activity bonus: extra -1 for choosing to rest instead of craft/watch
        if (recovery.restedFully) {
            delta -= 1;
        }

        // CON save at rough/hostile: fail = +1 exhaustion
        if (recovery.exhaustionDC) {
            const conMod = actor.system?.abilities?.con?.mod ?? 0;
            const advantage = !!recovery.exhaustionAdvantage;

            // Roll the save (2d20kh for advantage, 1d20 otherwise)
            const formula = advantage ? "2d20kh" : "1d20";
            const roll = await new Roll(`${formula} + ${conMod}`).evaluate();
            const passed = roll.total >= recovery.exhaustionDC;

            // Post the save roll to chat (GM-whispered)
            const advLabel = advantage ? " (advantage from hot meal)" : "";
            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `<strong>${actor.name}</strong>: CON save vs exhaustion DC ${recovery.exhaustionDC}${advLabel}`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });

            if (!passed) {
                delta += 1;
                recovery.exhaustionSaveResult = "failed";
                console.log(`[Respite:Recovery] ${actor.name} failed exhaustion save (${roll.total} vs DC ${recovery.exhaustionDC}), +1 exhaustion`);
            } else {
                recovery.exhaustionSaveResult = "passed";
                console.log(`[Respite:Recovery] ${actor.name} passed exhaustion save (${roll.total} vs DC ${recovery.exhaustionDC})`);
            }
        }

        // Event-inflicted exhaustion (from complication effects)
        if (recovery.exhaustionGain) {
            delta += recovery.exhaustionGain;
        }

        return delta;
    }

    /**
     * Posts a summary of the recovery to chat.
     * @param {Actor} actor
     * @param {Object} recovery
     * @param {number} hpRestored
     * @param {number} hdRecovered
     * @param {number} exhaustionDelta
     */
    static async _postRecoveryChat(actor, recovery, hpRestored, hdRecovered, exhaustionDelta = 0) {
        const comfortLabels = {
            safe: "Safe",
            sheltered: "Sheltered",
            rough: "Rough",
            hostile: "Hostile"
        };
        const comfortLabel = comfortLabels[recovery.comfortLevel] ?? recovery.comfortLevel;

        const parts = [];
        if (hpRestored > 0) parts.push(`${hpRestored} HP`);
        if (hdRecovered > 0) parts.push(`${hdRecovered} Hit Dice`);
        if (exhaustionDelta < 0) parts.push(`${Math.abs(exhaustionDelta)} exhaustion reduced`);
        if (exhaustionDelta > 0) parts.push(`${exhaustionDelta} exhaustion gained`);

        // Advisory when exhaustion reduction is blocked
        let exhaustionNote = null;
        if (recovery.comfortLevel === "hostile" && recovery.restType === "long" && exhaustionDelta >= 0) {
            exhaustionNote = "Hostile conditions prevent natural exhaustion recovery.";
        } else if (recovery.armorSleepPenalty && recovery.restType === "long" && exhaustionDelta >= 0) {
            exhaustionNote = "Sleeping in armor prevents exhaustion recovery.";
        }

        // Skip chat if nothing was restored or changed and no advisory
        if (parts.length === 0 && !exhaustionNote) return;

        const recoveredLine = parts.length > 0 ? `Recovered: ${parts.join(", ")}.` : "";
        const noteLine = exhaustionNote ? `<br><em style="color:#e67e22;"><i class="fas fa-exclamation-circle"></i> ${exhaustionNote}</em>` : "";
        const gearLine = recovery.gearDescriptors?.length
            ? `<br><span style="font-size:0.85em;opacity:0.7;">${recovery.gearDescriptors.join(" · ")}</span>`
            : "";

        const content = `
            <div class="respite-recovery-chat">
                <strong>${actor.name}</strong> rests in <em>${comfortLabel}</em> conditions.<br>
                ${recoveredLine}${gearLine}${noteLine}
            </div>
        `;

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });
    }

    /**
     * Rolls and applies event damage from failed complication effects.
     * @param {Actor} actor
     * @param {Object} outcome - Full outcome object with sub-outcomes
     * @returns {number} Total damage applied
     */
    static async _applyEventDamage(actor, outcome) {
        let totalDamage = 0;

        for (const sub of (outcome.outcomes ?? [])) {
            if (sub.source !== "event" || sub.resolvedOutcome === "success") continue;

            for (const effect of (sub.effects ?? [])) {
                if (effect.type !== "damage" || !effect.formula) continue;

                try {
                    const roll = await new Roll(effect.formula).evaluate();
                    const damage = roll.total;
                    totalDamage += damage;

                    // Post damage roll to GM chat
                    await roll.toMessage({
                        speaker: { alias: sub.eventName ?? "Rest Event" },
                        flavor: `<strong>${actor.name}</strong>: ${effect.formula} ${effect.damageType ?? ""} damage<br><em>${effect.description ?? ""}</em>`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                } catch (e) {
                    console.warn(`${MODULE_ID} | Failed to roll event damage:`, e);
                }
            }
        }

        // Deduct total damage from actor HP
        if (totalDamage > 0) {
            const hp = actor.system?.attributes?.hp;
            if (hp) {
                const newHp = Math.max(0, (hp.value ?? 0) - totalDamage);
                await actor.update({ "system.attributes.hp.value": newHp });
            }
        }

        return totalDamage;
    }
}
