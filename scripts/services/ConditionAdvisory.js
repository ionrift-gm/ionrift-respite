import { Logger } from "../lib/Logger.js";

const MODULE_ID = "ionrift-respite";

/**
 * ConditionAdvisory
 * Extracts condition/temp_hp effects from resolved event outcomes,
 * auto-applies via CE or the condition registry, and posts a GM advisory.
 */
export class ConditionAdvisory {

    /** Effect types this service handles. */
    static HANDLED_TYPES = new Set(["condition", "temp_hp"]);

    /** Cached registry data (loaded once per session). */
    static _registry = null;
    static _durationMap = null;

    /**
     * Load the condition registry from module JSON.
     * Cached after first load.
     */
    static async _loadRegistry() {
        if (this._registry) return;
        try {
            const resp = await fetch(`modules/${MODULE_ID}/data/core/condition_registry.json`);
            const data = await resp.json();
            this._durationMap = data.durationMap ?? {};
            this._registry = new Map();
            for (const entry of (data.conditions ?? [])) {
                const key = this._buildRegistryKey(entry.condition, entry.checks);
                this._registry.set(key, entry);
            }
            Logger.log(`Condition registry loaded: ${this._registry.size} entries`);
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to load condition registry:`, e);
            this._registry = new Map();
            this._durationMap = {};
        }
    }

    /**
     * Build a registry lookup key from condition + checks.
     * @param {string} condition
     * @param {string[]} [checks]
     * @returns {string}
     */
    static _buildRegistryKey(condition, checks) {
        if (checks?.length) return `${condition}:${checks.sort().join(",")}`;
        return condition;
    }

    /**
     * Look up a registry entry for an effect.
     * @param {Object} effect - Event effect object.
     * @returns {Object|null} Registry entry or null.
     */
    static _findRegistryEntry(effect) {
        if (!this._registry) return null;
        const key = this._buildRegistryKey(effect.condition, effect.checks);
        return this._registry.get(key) ?? null;
    }

    /**
     * Extract condition and temp_hp effects from resolved outcomes and route
     * them to the correct characters based on each effect's `scope`.
     *
     * Routing rules:
     *   "all" (or unset)            applied to whichever character's outcome
     *                               contains the effect (preserves existing
     *                               behavior for events whose targets array
     *                               already drives party-wide delivery).
     *   "random" | "randomTarget"   applied to the IDs pre-resolved on
     *   | "stung" | "failed"        `effect._resolvedTargetIds` by the
     *                               RecoveryHandler scope-resolution pass.
     *                               Each effect is dispatched once even if it
     *                               appears in several characters' outcomes.
     *   any other value             treated as a literal actor id.
     *
     * @param {Object[]} outcomes - Array of outcome objects from the rest flow.
     * @returns {Object[]} Array of { characterId, characterName, effects: [...] }
     */
    static extractConditionEffects(outcomes) {
        const charNames = new Map();
        for (const outcome of (outcomes ?? [])) {
            if (!outcome.characterId) continue;
            charNames.set(outcome.characterId, outcome.characterName ?? outcome.characterId);
        }

        const buckets = new Map();
        const pushTo = (characterId, payload) => {
            if (!buckets.has(characterId)) buckets.set(characterId, []);
            buckets.get(characterId).push(payload);
        };

        // Track dispatched effects so a single shared effect object (e.g. an
        // event delivered to multiple watchers) is only routed once.
        const dispatched = new WeakSet();

        for (const outcome of (outcomes ?? [])) {
            for (const sub of (outcome.outcomes ?? [])) {
                for (const effect of (sub.effects ?? [])) {
                    if (!this.HANDLED_TYPES.has(effect.type)) continue;

                    const scope = effect.scope ?? "all";
                    const payload = {
                        ...effect,
                        source: sub.source ?? sub.eventId ?? "unknown"
                    };

                    if (scope === "random" || scope === "randomTarget" || scope === "stung" || scope === "failed") {
                        if (dispatched.has(effect)) continue;
                        dispatched.add(effect);
                        const targetIds = Array.isArray(effect._resolvedTargetIds)
                            ? effect._resolvedTargetIds
                            : [];
                        for (const id of targetIds) pushTo(id, payload);
                    } else if (scope === "all") {
                        pushTo(outcome.characterId, payload);
                    } else {
                        // Specific actor id. Dispatch once.
                        if (dispatched.has(effect)) continue;
                        dispatched.add(effect);
                        pushTo(scope, payload);
                    }
                }
            }
        }

        const result = [];
        for (const [characterId, effects] of buckets) {
            if (effects.length === 0) continue;
            result.push({
                characterId,
                characterName: charNames.get(characterId) ?? characterId,
                effects
            });
        }

        return result;
    }

    /**
     * Process condition effects: auto-apply via CE or registry, then post advisory.
     * @param {Object[]} outcomes - Full outcomes array from the rest flow.
     * @param {Object} [options]
     * @param {Set<string>} [options.preApplied] - Set of `${actorId}:${condition}`
     *        tuples already applied directly via the system adapter. These are
     *        marked as "Applied" in the advisory and skipped for CE/registry
     *        application so we don't stack a Convenient Effect on top of an
     *        adapter-driven `system.attributes.exhaustion` update.
     * @returns {boolean} True if any conditions were found and reported.
     */
    static async processAll(outcomes, options = {}) {
        const conditionData = this.extractConditionEffects(outcomes);
        if (conditionData.length === 0) return false;

        const preApplied = options.preApplied instanceof Set ? options.preApplied : new Set();

        await this._loadRegistry();

        const ceApi = game.modules.get("dfreds-convenient-effects")?.api ?? null;
        const ceAvailable = !!ceApi;

        const applied = new Set();
        const aeApplied = new Set();

        for (const charData of conditionData) {
            const actor = game.actors.get(charData.characterId);
            if (!actor) continue;

            for (const effect of charData.effects) {
                if (effect.type !== "condition") continue;

                const ceEffectId = this._mapConditionToCeId(effect.condition);
                const key = `${charData.characterId}:${this._buildRegistryKey(effect.condition, effect.checks)}`;
                const adapterKey = `${charData.characterId}:${effect.condition}`;

                // Adapter already applied this condition (e.g. disaster-tree
                // exhaustion path). Mark applied so the advisory renders it
                // as a done deal and skip CE/registry to avoid stacking.
                if (preApplied.has(adapterKey)) {
                    applied.add(key);
                    continue;
                }

                // Path A: CE standard condition
                if (ceEffectId && ceAvailable) {
                    try {
                        await ceApi.addEffect({ effectId: ceEffectId, uuid: actor.uuid });
                        applied.add(key);
                        Logger.log(`CE auto-applied "${effect.condition}" to ${actor.name}`);
                        continue;
                    } catch (e) {
                        console.warn(`${MODULE_ID} | CE apply failed for ${effect.condition}:`, e);
                    }
                }

                // Path B: Registry-based custom AE
                const entry = this._findRegistryEntry(effect);
                if (entry?.changes?.length) {
                    try {
                        await this._applyRegistryEffect(actor, entry, effect);
                        aeApplied.add(key);
                        Logger.log(`Registry AE applied "${entry.label}" to ${actor.name}`);
                        continue;
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Registry AE failed for ${entry.id}:`, e);
                    }
                }
            }
        }

        // Build the chat card
        const allApplied = new Set([...applied, ...aeApplied]);
        const lines = [
            `<div class="respite-condition-advisory">`,
            `<h3><i class="fas fa-exclamation-triangle"></i> Conditions to Apply</h3>`,
            allApplied.size > 0
                ? `<p class="advisory-subtitle">Conditions auto-applied where possible. Manual items listed below.</p>`
                : `<p class="advisory-subtitle">These conditions were triggered by rest events. Apply them manually or via Convenient Effects.</p>`
        ];

        for (const charData of conditionData) {
            const actor = game.actors.get(charData.characterId);
            const name = actor?.name ?? charData.characterName;

            lines.push(`<div class="advisory-character">`);
            lines.push(`<strong>${name}</strong>`);

            for (const effect of charData.effects) {
                if (effect.type !== "condition") continue;

                const key = `${charData.characterId}:${this._buildRegistryKey(effect.condition, effect.checks)}`;
                const wasApplied = allApplied.has(key);
                const icon = this._getConditionIcon(effect);
                const label = this._formatConditionLabel(effect);
                const duration = this._formatDuration(effect.duration);
                const desc = effect.description ?? "";

                if (wasApplied) {
                    lines.push(
                        `<div class="advisory-effect applied">` +
                        `<i class="${icon}"></i> ` +
                        `<span class="effect-label">${label}</span>` +
                        ` <span class="effect-applied"><i class="fas fa-check-circle"></i> Applied</span>` +
                        `</div>`
                    );
                } else {
                    lines.push(
                        `<div class="advisory-effect">` +
                        `<i class="${icon}"></i> ` +
                        `<span class="effect-label">${label}</span>` +
                        (duration ? ` <span class="effect-duration">(${duration})</span>` : "") +
                        (desc ? `<br><span class="effect-desc">${desc}</span>` : "") +
                        `</div>`
                    );
                }
            }

            for (const effect of charData.effects) {
                if (effect.type !== "temp_hp") continue;
                const label = this._formatConditionLabel(effect);
                lines.push(
                    `<div class="advisory-effect">` +
                    `<i class="fas fa-shield-alt"></i> ` +
                    `<span class="effect-label">${label}</span>` +
                    `</div>`
                );
            }

            lines.push(`</div>`);
        }

        lines.push(`</div>`);

        await ChatMessage.create({
            content: lines.join("\n"),
            whisper: game.users.filter(u => u.isGM).map(u => u.id),
            speaker: { alias: "Respite" },
            flags: { [MODULE_ID]: { type: "condition_advisory" } }
        });

        const totalApplied = applied.size + aeApplied.size;
        Logger.log(
            `Condition advisory posted: ${conditionData.length} character(s) ` +
            `with ${conditionData.reduce((s, c) => s + c.effects.length, 0)} effect(s)` +
            (totalApplied > 0 ? `, ${totalApplied} auto-applied` : "")
        );

        return true;
    }

    /**
     * Apply a registry-defined condition as an Active Effect on an actor.
     * @param {Actor} actor - Target actor.
     * @param {Object} entry - Registry entry from condition_registry.json.
     * @param {Object} effect - Event effect object (for duration override).
     */
    static async _applyRegistryEffect(actor, entry, effect) {
        const duration = effect.duration ?? entry.defaultDuration;
        const durationConfig = this._durationMap?.[duration] ?? {};

        const aeData = {
            name: effect.label ?? entry.label,
            icon: entry.icon,
            origin: actor.uuid,
            statuses: new Set([entry.id]),
            changes: (entry.changes ?? []).map(c => ({
                key: c.key,
                mode: c.mode ?? CONST.ACTIVE_EFFECT_MODES.CUSTOM,
                value: String(c.value)
            })),
            flags: {
                [MODULE_ID]: {
                    conditionId: entry.id,
                    source: effect.source ?? "unknown",
                    sourceName: effect.sourceName ?? "Respite",
                    expiresAt: duration,
                    autoApplied: true
                }
            }
        };

        if (durationConfig.seconds) {
            aeData["duration.seconds"] = durationConfig.seconds;
        }

        // DAE special duration (auto-expire on long rest, short rest, etc.)
        if (durationConfig.daeSpecial) {
            aeData.flags.dae = { specialDuration: [durationConfig.daeSpecial] };
        }

        if (effect.description ?? entry.description) {
            aeData.description = effect.description ?? entry.description;
        }

        await actor.createEmbeddedDocuments("ActiveEffect", [aeData]);
    }

    /**
     * Remove all Respite-applied conditions flagged with "next_rest" expiry.
     * Call this during rest resolution to auto-clean conditions.
     * @param {Actor[]} actors - Array of actors completing a rest.
     * @returns {number} Count of effects removed.
     */
    static async cleanupRestConditions(actors) {
        let removed = 0;
        for (const actor of actors) {
            const effects = actor.effects.filter(
                e => e.flags?.[MODULE_ID]?.expiresAt === "next_rest"
            );
            if (effects.length === 0) continue;

            const ids = effects.map(e => e.id);
            await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
            removed += ids.length;
            Logger.log(`Cleaned ${ids.length} rest condition(s) from ${actor.name}`);
        }
        return removed;
    }

    // ── Formatting Helpers ──────────────────────────────────────

    static _getConditionIcon(effect) {
        if (effect.type === "temp_hp") return "fas fa-shield-alt";

        const icons = {
            poisoned: "fas fa-skull-crossbones",
            exhaustion: "fas fa-bed",
            frightened: "fas fa-ghost",
            blinded: "fas fa-eye-slash",
            deafened: "fas fa-deaf",
            stunned: "fas fa-dizzy",
            paralyzed: "fas fa-lock",
            disadvantage: "fas fa-arrow-down"
        };

        return icons[effect.condition] ?? "fas fa-exclamation-circle";
    }

    static _formatConditionLabel(effect) {
        if (effect.type === "temp_hp") {
            const formula = effect.formula ?? effect.amount ?? "?";
            return `Temporary HP: ${formula}`;
        }

        let label = (effect.condition ?? "unknown").charAt(0).toUpperCase()
            + (effect.condition ?? "unknown").slice(1);

        if (effect.checks?.length) {
            const checks = effect.checks.map(c => c.toUpperCase()).join(", ");
            label += ` (${checks} checks)`;
        }

        return label;
    }

    static _formatDuration(duration) {
        if (!duration) return null;

        const durationMap = {
            next_rest: "until next rest",
            end_of_rest: "end of rest",
            "1_hour": "1 hour",
            "4_hours": "4 hours",
            "8_hours": "8 hours",
            "24_hours": "24 hours",
            permanent: "permanent"
        };

        return durationMap[duration] ?? duration;
    }

    /**
     * Map a respite condition name to a CE ceEffectId.
     * Returns null for custom conditions that CE does not handle.
     * @param {string} condition - Condition name from event data.
     * @returns {string|null}
     */
    static _mapConditionToCeId(condition) {
        const CE_CONDITIONS = new Set([
            "poisoned", "blinded", "frightened", "deafened",
            "stunned", "paralyzed", "restrained", "incapacitated",
            "petrified", "prone", "charmed", "grappled", "invisible"
        ]);

        if (!condition) return null;
        const lower = condition.toLowerCase();

        if (CE_CONDITIONS.has(lower)) {
            return `ce-${lower}`;
        }

        const exhMatch = lower.match(/^exhaustion\s*(\d)$/);
        if (exhMatch) {
            return `ce-exhaustion-${exhMatch[1]}`;
        }

        return null;
    }
}
