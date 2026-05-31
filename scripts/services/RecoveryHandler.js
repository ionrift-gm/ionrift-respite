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

        console.log(`[Respite:Recovery] ── apply() START for ${actor.name} (${actor.id}) ──`, {
            comfortLevel: recovery.comfortLevel,
            restType: recovery.restType,
            hpRestored: recovery.hpRestored,
            hdRestored: recovery.hdRestored,
            spellSlotsRestored: recovery.spellSlotsRestored,
            restedFully: recovery.restedFully,
            exhaustionDC: recovery.exhaustionDC,
            exhaustionAdvantage: recovery.exhaustionAdvantage,
            exhaustionGain: recovery.exhaustionGain,
            armorSleepPenalty: recovery.armorSleepPenalty
        });

        const hp = actor.system?.attributes?.hp;
        if (!hp) {
            console.warn(`[Respite:Recovery] ${actor.name}: no HP data, skipping`);
            return { hp: 0, hd: 0, exhaustion: 0 };
        }

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

        // Apply exhaustion update (route through adapter for system compatibility)
        if (exhaustionDelta !== 0) {
            const adapter = game.ionrift?.respite?.adapter;
            if (adapter) {
                await adapter.applyExhaustionDelta(actor, exhaustionDelta);
            } else {
                // Fallback: direct 5e path
                const currentExhaustion = actor.system?.attributes?.exhaustion ?? 0;
                const newExhaustion = Math.max(0, Math.min(6, currentExhaustion + exhaustionDelta));
                if (newExhaustion !== currentExhaustion) {
                    await actor.update({ "system.attributes.exhaustion": newExhaustion });
                }
            }
        }

        // Post recovery summary to chat
        await this._postRecoveryChat(actor, recovery, hpToRestore, hdRecovered, exhaustionDelta);

        console.log(`[Respite:Recovery] ── apply() END for ${actor.name} ──`, {
            hpBefore: currentHp, hpAfter: newHp, hpToRestore,
            hdRecovered,
            exhaustionDelta,
            comfortLevel: recovery.comfortLevel
        });

        return { hp: hpToRestore, hd: hdRecovered, exhaustion: exhaustionDelta };
    }

    /**
     * Applies recovery to all characters in the outcomes array.
     * @param {Object[]} outcomes - From RestFlowEngine.resolve()
     * @param {boolean} skipIfRestRecovery - If true, skip HP/HD (rest-recovery handles it)
     * @returns {Object[]} Per-character recovery summaries
     */
    static async applyAll(outcomes, skipIfRestRecovery = false) {
        console.log(`[Respite:Recovery] ── applyAll() START ──`, {
            outcomeCount: outcomes?.length ?? 0,
            skipIfRestRecovery,
            characters: outcomes?.map(o => {
                const a = game.actors?.get(o.characterId);
                return {
                    id: o.characterId,
                    name: a?.name ?? "(unknown)",
                    comfort: o.recovery?.comfortLevel,
                    restType: o.recovery?.restType,
                    restedFully: o.recovery?.restedFully,
                    armorSleepPenalty: o.recovery?.armorSleepPenalty
                };
            }) ?? []
        });

        if (skipIfRestRecovery) {
            console.log(`${MODULE_ID} | Skipping HP/HD recovery (rest-recovery module active)`);
            return outcomes.map(o => ({ characterId: o.characterId, hp: 0, hd: 0, deferred: true }));
        }

        // Pre-resolve random / randomTarget / stung scopes on event effects.
        // Stamps `effect._resolvedTargetIds` so the damage dispatcher and the
        // downstream ConditionAdvisory can route by intent rather than by
        // which character's outcome happens to contain the effect.
        await this._resolveEventScopes(outcomes);

        // Damage for random / randomTarget scopes is rolled and applied
        // globally so a scorpion can sting a sleeping character even when
        // the event itself is filed under the watcher's outcomes.
        const globalDamage = await this._dispatchRandomTargetDamage(outcomes);

        const results = [];
        for (const outcome of outcomes) {
            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;
            const result = await this.apply(actor, outcome.recovery);

            // Per-outcome damage: scope "all" and specific-actor scopes.
            // random / randomTarget were already handled above.
            const perOutcomeDamage = await this._applyEventDamage(actor, outcome);
            const globalForActor = globalDamage.get(outcome.characterId) ?? 0;
            const totalDamage = perOutcomeDamage + globalForActor;
            if (totalDamage > 0) result.eventDamage = totalDamage;

            results.push({ characterId: outcome.characterId, ...result });

            // Write exhaustion delta back to outcome.recovery so UI can display it
            if (outcome.recovery) outcome.recovery.exhaustionDelta = result.exhaustion ?? 0;
        }
        return results;
    }

    /**
     * Pre-resolves random / randomTarget / stung scopes on event effects.
     * Stamps `effect._resolvedTargetIds` on the shared effect objects so the
     * damage dispatcher and the condition advisory both route by the same set.
     *
     * Pool semantics:
     *   "sleeping" — characters not on watch (falls back to whole party if
     *                everyone is on watch).
     *   "awake"    — characters on watch (falls back to whole party).
     *   "all"      — every character with an outcome (default).
     *
     * Count may be a number, numeric string, or a dice formula (e.g. "1d2").
     * The resolved count is clamped to the pool size.
     *
     * Condition effects with `scope: "stung"` inherit their target IDs from
     * the most recent random / randomTarget damage effect in the same
     * sub-outcome. This binds the venom to whoever actually got bitten.
     *
     * @param {Object[]} outcomes
     */
    static async _resolveEventScopes(outcomes) {
        const allIds = [];
        const sleepingIds = [];
        const awakeIds = [];
        for (const o of (outcomes ?? [])) {
            if (!o.characterId) continue;
            allIds.push(o.characterId);
            if (o.onWatch) awakeIds.push(o.characterId);
            else sleepingIds.push(o.characterId);
        }
        if (allIds.length === 0) return;

        const poolFor = (pool) => {
            if (pool === "awake") return awakeIds.length > 0 ? awakeIds : allIds;
            if (pool === "sleeping") return sleepingIds.length > 0 ? sleepingIds : allIds;
            return allIds;
        };

        // Same effect object may appear in multiple outcomes (event assigned
        // to several characters). WeakSet ensures we resolve it once.
        const visited = new WeakSet();

        for (const outcome of (outcomes ?? [])) {
            for (const sub of (outcome.outcomes ?? [])) {
                if (sub.source !== "event") continue;
                if (["success", "triumph"].includes(sub.resolvedOutcome)) continue;
                const effects = sub.effects ?? [];

                let lastResolvedIds = null;

                for (const effect of effects) {
                    if (visited.has(effect)) {
                        // Already resolved on a prior outcome iteration. We still
                        // need to track the most recent random target set so that
                        // any unvisited `stung` condition further down the array
                        // can inherit from it.
                        if (effect.type === "damage" && Array.isArray(effect._resolvedTargetIds)) {
                            lastResolvedIds = effect._resolvedTargetIds;
                        }
                        continue;
                    }
                    visited.add(effect);

                    const scope = effect.scope ?? "all";

                    if (effect.type === "damage" && (scope === "random" || scope === "randomTarget")) {
                        const spec = effect.randomTarget ?? {};
                        const pool = poolFor(spec.pool ?? "all");
                        const count = await this._evaluateTargetCount(spec.count, pool.length);
                        const picked = this._pickN(pool, count);
                        effect._resolvedTargetIds = picked;
                        lastResolvedIds = picked;
                    } else if (scope === "failed") {
                        // Per-character check failures threaded onto the sub
                        // at engine-resolve time. Empty for events without a
                        // skill check (decision trees, narrative-only).
                        effect._resolvedTargetIds = Array.isArray(sub.failedCharacterIds)
                            ? [...sub.failedCharacterIds]
                            : [];
                    } else if (effect.type === "condition" && scope === "stung") {
                        effect._resolvedTargetIds = lastResolvedIds ?? [];
                    }
                }
            }
        }
    }

    /**
     * Rolls a target count specification. Accepts:
     *   - number          (clamped to pool size)
     *   - numeric string  ("1", "2")
     *   - dice formula    ("1d2", "1d4-1")
     * Anything unparseable defaults to 1.
     * @param {*} countSpec
     * @param {number} poolSize
     * @returns {Promise<number>}
     */
    static async _evaluateTargetCount(countSpec, poolSize) {
        if (poolSize === 0) return 0;
        if (countSpec == null) return Math.min(1, poolSize);
        if (typeof countSpec === "number") {
            return Math.max(0, Math.min(Math.floor(countSpec), poolSize));
        }
        const s = String(countSpec).trim();
        if (/^\d+$/.test(s)) {
            return Math.max(0, Math.min(parseInt(s, 10), poolSize));
        }
        try {
            const roll = await new Roll(s).evaluate();
            return Math.max(0, Math.min(Math.floor(roll.total), poolSize));
        } catch (e) {
            console.warn(`${MODULE_ID} | Could not evaluate randomTarget.count "${countSpec}":`, e);
            return Math.min(1, poolSize);
        }
    }

    /**
     * Picks N distinct entries from a pool using Fisher-Yates.
     * @param {string[]} pool
     * @param {number} n
     * @returns {string[]}
     */
    static _pickN(pool, n) {
        if (n <= 0 || pool.length === 0) return [];
        if (n >= pool.length) return [...pool];
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, n);
    }

    /**
     * Rolls and applies damage for every random / randomTarget damage effect
     * in the outcomes. Each chosen target rolls its own copy of the formula.
     * Returns a map of actorId → total damage applied so the per-outcome
     * recovery loop can surface it via `result.eventDamage`.
     *
     * @param {Object[]} outcomes
     * @returns {Promise<Map<string, number>>}
     */
    static async _dispatchRandomTargetDamage(outcomes) {
        const damageByActor = new Map();
        const visited = new WeakSet();

        for (const outcome of (outcomes ?? [])) {
            for (const sub of (outcome.outcomes ?? [])) {
                if (sub.source !== "event") continue;
                if (["success", "triumph"].includes(sub.resolvedOutcome)) continue;

                for (const effect of (sub.effects ?? [])) {
                    if (effect.type !== "damage" || !effect.formula) continue;
                    const scope = effect.scope ?? "all";
                    if (scope !== "random" && scope !== "randomTarget" && scope !== "failed") continue;
                    if (visited.has(effect)) continue;
                    visited.add(effect);

                    const targetIds = Array.isArray(effect._resolvedTargetIds)
                        ? effect._resolvedTargetIds
                        : [];

                    for (const actorId of targetIds) {
                        const actor = game.actors.get(actorId);
                        if (!actor) continue;
                        try {
                            const roll = await new Roll(effect.formula).evaluate();
                            const damage = roll.total;
                            damageByActor.set(actorId, (damageByActor.get(actorId) ?? 0) + damage);
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
            }
        }

        for (const [actorId, totalDamage] of damageByActor) {
            if (totalDamage <= 0) continue;
            const actor = game.actors.get(actorId);
            if (!actor) continue;
            const hp = actor.system?.attributes?.hp;
            if (hp) {
                const newHp = Math.max(0, (hp.value ?? 0) - totalDamage);
                await actor.update({ "system.attributes.hp.value": newHp });
            }
        }

        return damageByActor;
    }

    /**
     * Recovers hit dice on an actor, preferring the largest die sizes first.
     * @param {Actor} actor
     * @param {number} hdToRecover - Number of HD to recover
     * @returns {number} Actual HD recovered
     */
    static _recoverHitDice(actor, hdToRecover) {
        if (hdToRecover <= 0) return 0;

        const classes = actor.items.filter(i => i.type === "class");
        if (!classes.length) return 0;

        // Sort by die size descending (d12 before d10 before d8...)
        // v4+: system.hd.denomination / system.hd.spent
        // v3:  system.hitDice / system.hitDiceUsed
        const sorted = classes
            .map(cls => ({
                item: cls,
                dieSize: parseInt((cls.system?.hd?.denomination ?? cls.system?.hitDice ?? "d8").replace("d", "")) || 8,
                spent: (cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0),
                max: cls.system?.levels ?? 0
            }))
            .filter(c => c.spent > 0)
            .sort((a, b) => b.dieSize - a.dieSize);

        let remaining = hdToRecover;
        let totalRecovered = 0;
        const updates = [];

        // Detect field name: v4+ uses system.hd.spent, v3 uses system.hitDiceUsed
        const useNewField = classes[0]?.system?.hd !== undefined;

        for (const cls of sorted) {
            if (remaining <= 0) break;
            const canRecover = Math.min(remaining, cls.spent);
            if (canRecover > 0) {
                const update = { _id: cls.item.id };
                if (useNewField) {
                    update["system.hd.spent"] = cls.spent - canRecover;
                } else {
                    update["system.hitDiceUsed"] = cls.spent - canRecover;
                }
                updates.push(update);
                remaining -= canRecover;
                totalRecovered += canRecover;
            }
        }

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
        const adapter = game.ionrift?.respite?.adapter;
        const currentExhaustion = adapter ? adapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);

        console.log(`[Respite:Recovery] _calculateExhaustionDelta ${actor.name}:`, {
            currentExhaustion,
            comfortLevel: recovery.comfortLevel,
            restType: recovery.restType,
            restedFully: recovery.restedFully,
            exhaustionDC: recovery.exhaustionDC,
            exhaustionAdvantage: recovery.exhaustionAdvantage,
            exhaustionGain: recovery.exhaustionGain,
            armorSleepPenalty: recovery.armorSleepPenalty
        });

        if (currentExhaustion === 0 && !(recovery.exhaustionGain > 0) && !recovery.exhaustionDC) return 0;

        // --- Phase 1: Rest recovery (negative = reduction) ---
        let restRecovery = 0;

        // Long rest base reduction (matches dnd5e default: -1 per long rest)
        if (recovery.restType === "long") {
            if (recovery.comfortLevel === "hostile") {
                // Hostile conditions: no natural exhaustion reduction
                restRecovery = 0;
            } else if (recovery.armorSleepPenalty) {
                // Xanathar's: sleeping in medium/heavy armor blocks exhaustion reduction
                restRecovery = 0;
            } else {
                restRecovery = -1;
            }
        }

        // 'Rest Fully' activity bonus: extra -1 for choosing to rest instead of craft/watch
        if (recovery.restedFully) {
            restRecovery -= 1;
        }

        // Clamp recovery: can't reduce below 0 exhaustion
        const clampedRecovery = Math.max(-currentExhaustion, restRecovery);

        // --- Phase 2: Penalties (positive = gain, applied after recovery) ---
        let penalty = 0;

        // CON save at rough/hostile: fail = +1 exhaustion
        if (recovery.exhaustionDC) {
            const conMod = actor.system?.abilities?.con?.mod ?? 0;
            const advantage = !!recovery.exhaustionAdvantage;

            // Roll the save (2d20kh for advantage, 1d20 otherwise)
            const formula = advantage ? "2d20kh" : "1d20";
            const roll = await new Roll(`${formula} + ${conMod}`).evaluate();
            const passed = roll.total >= recovery.exhaustionDC;

            // Post the save roll to chat (GM-whispered)
            const advLabel = advantage ? " (mess kit gives advantage)" : "";
            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `<strong>${actor.name}</strong>: CON save vs exhaustion DC ${recovery.exhaustionDC}${advLabel}`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });

            if (!passed) {
                penalty += 1;
                recovery.exhaustionSaveResult = "failed";
                console.log(`[Respite:Recovery] ${actor.name} failed exhaustion save (${roll.total} vs DC ${recovery.exhaustionDC}), +1 exhaustion`);
            } else {
                recovery.exhaustionSaveResult = "passed";
                console.log(`[Respite:Recovery] ${actor.name} passed exhaustion save (${roll.total} vs DC ${recovery.exhaustionDC})`);
            }
        }

        // Event-inflicted exhaustion (from complication effects)
        if (recovery.exhaustionGain) {
            penalty += recovery.exhaustionGain;
        }

        return clampedRecovery + penalty;
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
     * Rolls and applies per-outcome event damage. Handles `scope: "all"`
     * (every character whose outcome contains the effect rolls and takes
     * their own damage) and specific-actor scopes. The `random` /
     * `randomTarget` scopes are dispatched globally in
     * {@link _dispatchRandomTargetDamage}, so they are skipped here.
     * @param {Actor} actor
     * @param {Object} outcome - Full outcome object with sub-outcomes
     * @returns {number} Total damage applied
     */
    static async _applyEventDamage(actor, outcome) {
        let totalDamage = 0;

        for (const sub of (outcome.outcomes ?? [])) {
            if (sub.source !== "event" || ["success", "triumph"].includes(sub.resolvedOutcome)) continue;

            for (const effect of (sub.effects ?? [])) {
                if (effect.type !== "damage" || !effect.formula) continue;

                const scope = effect.scope ?? "all";
                if (scope === "random" || scope === "randomTarget" || scope === "failed") continue;
                if (scope !== "all" && scope !== actor.id) continue;

                try {
                    const roll = await new Roll(effect.formula).evaluate();
                    const damage = roll.total;
                    totalDamage += damage;

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
