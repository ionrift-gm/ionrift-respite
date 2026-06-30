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

    /** Standard 5e conditions recognised for native/CE application. */
    static STANDARD_CONDITIONS = new Set([
        "poisoned", "blinded", "frightened", "deafened",
        "stunned", "paralyzed", "restrained", "incapacitated",
        "petrified", "prone", "charmed", "grappled", "invisible"
    ]);

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
     * Process condition effects: auto-apply via the system catalog or registry,
     * then post a GM advisory for anything left to manage by hand.
     *
     * Application order per condition (see CONDITION_AUTHORING.md):
     *   A. Registry entry with its own changes  -> custom Active Effect.
     *   B. Standard 5e condition                -> native system status.
     *   C. Standard 5e condition, CE installed  -> Convenient Effects (last resort).
     *   else                                    -> listed in advisory for manual handling.
     *
     * @param {Object[]} outcomes - Full outcomes array from the rest flow.
     * @param {Object} [options]
     * @param {Set<string>} [options.preApplied] - Set of `${actorId}:${condition}`
     *        tuples already applied directly via the system adapter. These are
     *        marked as "Applied" in the advisory and skipped for re-application
     *        so we don't stack on top of an adapter-driven exhaustion update.
     * @returns {boolean} True if any conditions were found and reported.
     */
    static async processAll(outcomes, options = {}) {
        const conditionData = this.extractConditionEffects(outcomes);
        if (conditionData.length === 0) return false;

        const preApplied = options.preApplied instanceof Set ? options.preApplied : new Set();

        await this._loadRegistry();

        // Shared effect-automation detection (DAE / Midi-QoL / CE). Falls back
        // gracefully when the library kernel predates the helper.
        const fx = game.ionrift?.library?.effects ?? null;

        const applied = new Set();
        const aeApplied = new Set();

        for (const charData of conditionData) {
            const actor = game.actors.get(charData.characterId);
            if (!actor) continue;

            for (const effect of charData.effects) {
                if (effect.type !== "condition") continue;

                const key = `${charData.characterId}:${this._buildRegistryKey(effect.condition, effect.checks)}`;
                const adapterKey = `${charData.characterId}:${effect.condition}`;

                // Adapter already applied this condition (e.g. disaster-tree
                // exhaustion path). Mark applied so the advisory renders it
                // as a done deal and skip re-application to avoid stacking.
                if (preApplied.has(adapterKey)) {
                    applied.add(key);
                    continue;
                }

                const entry = this._findRegistryEntry(effect);

                // Path A: bespoke condition with its own changes -> custom AE.
                if (entry?.changes?.length) {
                    try {
                        await this._applyRegistryEffect(actor, entry, effect, fx);
                        aeApplied.add(key);
                        Logger.log(`Registry AE applied "${entry.label}" to ${actor.name}`);
                        continue;
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Registry AE failed for ${entry.id}:`, e);
                    }
                }

                // Standard 5e condition: prefer the system catalog, fall back to
                // Convenient Effects only as a last resort.
                if (entry?.ceStandard === true || this._isStandardCondition(effect.condition)) {
                    // Path B: native dnd5e status (preferred catalog).
                    try {
                        const res = await this._applyStandardCondition(actor, effect, entry);
                        if (res.applied) {
                            // Tag for rest-start cleanup + DAE expiry (belt-and-braces).
                            await this._stampRestExpiry(res.effect, entry, effect, fx);
                            applied.add(key);
                            Logger.log(`Native status applied "${effect.condition}" to ${actor.name}`);
                            continue;
                        }
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Native status apply failed for ${effect.condition}:`, e);
                    }

                    // Path C: Convenient Effects (last resort, optional).
                    const ceId = entry?.ceId ?? this._mapConditionToCeId(effect.condition);
                    const ceApi = fx?.hasCe?.() ? fx.ceApi() : null;
                    if (ceId && ceApi) {
                        try {
                            const before = new Set(actor.effects.map(e => e.id));
                            await ceApi.addEffect({ effectId: ceId, uuid: actor.uuid });
                            const created = actor.effects.find(e => !before.has(e.id)) ?? null;
                            await this._stampRestExpiry(created, entry, effect, fx);
                            applied.add(key);
                            Logger.log(`CE auto-applied "${effect.condition}" to ${actor.name}`);
                            continue;
                        } catch (e) {
                            console.warn(`${MODULE_ID} | CE apply failed for ${effect.condition}:`, e);
                        }
                    }
                }
                // Unapplied conditions remain for the manual advisory below.
            }
        }

        // Build the chat card
        const allApplied = new Set([...applied, ...aeApplied]);
        const lines = [
            `<div class="respite-condition-advisory">`,
            `<h3><i class="fas fa-exclamation-triangle"></i> Conditions to Apply</h3>`,
            allApplied.size > 0
                ? `<p class="advisory-subtitle">Conditions auto-applied where possible. Manual items listed below.</p>`
                : `<p class="advisory-subtitle">These conditions were triggered by rest events. Apply them manually.</p>`
        ];

        // When the automation stack is absent, point the GM at what would make
        // these self-managing. Only shown if something was left unapplied.
        const anyUnapplied = conditionData.some(c =>
            c.effects.some(e => e.type === "condition"
                && !allApplied.has(`${c.characterId}:${this._buildRegistryKey(e.condition, e.checks)}`)));
        if (anyUnapplied && fx?.tier?.() === "basic") {
            lines.push(
                `<p class="advisory-hint"><i class="fas fa-circle-info"></i> ` +
                `Dynamic Active Effects and Midi-QoL apply and expire these automatically.</p>`
            );
        }

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
     * @param {Object} [fx] - Shared effect-automation helper (game.ionrift.library.effects).
     */
    static async _applyRegistryEffect(actor, entry, effect, fx = null) {
        const duration = effect.duration ?? entry.defaultDuration;
        const durationConfig = this._durationMap?.[duration] ?? {};

        const aeData = {
            name: effect.label ?? entry.label,
            img: entry.icon,
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

        // DAE special duration (auto-expire on long rest, short rest, etc.).
        // Respite's own rest cleanup removes next_rest/end_of_rest conditions
        // even without DAE, so this only adds finer auto-expiry when present.
        if (durationConfig.daeSpecial) {
            const helper = fx ?? game.ionrift?.library?.effects ?? null;
            if (helper?.stampDaeDuration) {
                helper.stampDaeDuration(aeData, [durationConfig.daeSpecial]);
            } else {
                aeData.flags.dae = { specialDuration: [durationConfig.daeSpecial] };
            }
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
     * Whether a condition is a standard 5e condition (native status or CE).
     * @param {string} condition
     * @returns {boolean}
     */
    static _isStandardCondition(condition) {
        if (!condition) return false;
        const lower = condition.toLowerCase();
        return this.STANDARD_CONDITIONS.has(lower) || /^exhaustion/.test(lower);
    }

    /**
     * Resolve a dnd5e status effect id for a standard condition, or null if the
     * running system does not register it.
     * @param {string} condition
     * @returns {string|null}
     */
    static _resolveStatusId(condition) {
        if (!condition) return null;
        const lower = condition.toLowerCase();
        const raw = CONFIG.statusEffects ?? [];
        const all = Array.isArray(raw) ? raw : Object.values(raw);
        return all.some(e => e?.id === lower) ? lower : null;
    }

    /**
     * Apply a standard condition through the system catalog (preferred over CE).
     * Exhaustion is numeric on dnd5e and routed through the system adapter so it
     * reaches the intended level without stacking.
     * @param {Actor} actor
     * @param {Object} effect
     * @param {Object|null} entry
     * @returns {Promise<{applied: boolean, effect: ActiveEffect|null}>}
     *          `applied` is true when the condition landed; `effect` is the
     *          backing Active Effect when one exists (null for numeric exhaustion).
     */
    static async _applyStandardCondition(actor, effect, entry) {
        const condition = (effect.condition ?? "").toLowerCase();

        if (/^exhaustion/.test(condition)) {
            const level = entry?.level ?? effect.level ?? 1;
            const adapter = game.ionrift?.respite?.adapter ?? null;
            if (adapter?.applyExhaustionDelta && adapter?.getExhaustion) {
                const current = adapter.getExhaustion(actor) ?? 0;
                const delta = level - current;
                if (delta > 0) await adapter.applyExhaustionDelta(actor, delta);
                return { applied: true, effect: null };
            }
            return { applied: false, effect: null };
        }

        const statusId = this._resolveStatusId(condition);
        if (statusId && typeof actor.toggleStatusEffect === "function") {
            if (actor.statuses?.has?.(statusId)) {
                // Already present (likely a manual GM/player toggle). Treat as
                // applied but do not hijack it with our auto-expiry tagging.
                return { applied: true, effect: null };
            }
            const before = new Set(actor.effects.map(e => e.id));
            await actor.toggleStatusEffect(statusId, { active: true });
            const created = actor.effects.find(e => !before.has(e.id) && e.statuses?.has?.(statusId))
                ?? actor.effects.find(e => e.statuses?.has?.(statusId))
                ?? null;
            return { applied: true, effect: created };
        }
        return { applied: false, effect: null };
    }

    /**
     * Belt-and-braces expiry tagging for a standard condition applied via the
     * system catalog or CE. Stamps the Respite `expiresAt` flag (read by
     * cleanupRestConditions at rest start) and the DAE special duration (read by
     * DAE at rest completion). Either reaper can then remove the effect.
     * @param {ActiveEffect|null} ae
     * @param {Object|null} entry
     * @param {Object} effect
     * @param {Object|null} fx - Shared effect-automation helper.
     */
    static async _stampRestExpiry(ae, entry, effect, fx = null) {
        if (!ae?.update) return;
        const duration = effect.duration ?? entry?.defaultDuration ?? "next_rest";
        const durationConfig = this._durationMap?.[duration] ?? {};

        const updates = {
            [`flags.${MODULE_ID}.conditionId`]: entry?.id ?? effect.condition,
            [`flags.${MODULE_ID}.expiresAt`]: duration,
            [`flags.${MODULE_ID}.autoApplied`]: true,
            [`flags.${MODULE_ID}.source`]: effect.source ?? "unknown"
        };

        if (durationConfig.daeSpecial) {
            const existing = ae.flags?.dae?.specialDuration ?? [];
            updates["flags.dae.specialDuration"] = [...new Set([...existing, durationConfig.daeSpecial])];
        }

        try {
            await ae.update(updates);
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to stamp rest expiry on ${ae.name}:`, e);
        }
    }

    /**
     * Map a respite condition name to a CE ceEffectId.
     * Returns null for custom conditions that CE does not handle.
     * @param {string} condition - Condition name from event data.
     * @returns {string|null}
     */
    static _mapConditionToCeId(condition) {
        if (!condition) return null;
        const lower = condition.toLowerCase();

        if (this.STANDARD_CONDITIONS.has(lower)) {
            return `ce-${lower}`;
        }

        const exhMatch = lower.match(/^exhaustion\s*(\d)$/);
        if (exhMatch) {
            return `ce-exhaustion-${exhMatch[1]}`;
        }

        return null;
    }
}
