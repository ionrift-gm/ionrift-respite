import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";

/**
 * Arcane Recovery / Natural Recovery spell slot restoration (DnD5e).
 * Pure detection and application logic; callers own UI and persistence.
 */
export class SpellSlotRecovery {

    /**
     * @param {Item} item
     * @returns {boolean}
     */
    static #hasUsesRemaining(item) {
        const uses = item.system?.uses ?? {};
        const recharge = item.system?.recharge ?? {};
        // Mirror dnd5e AbilityUseDialog: when recharge.value is set, availability is
        // `recharge.charged`, not uses.value. Feat `recharge.value` is the d6 face (1-6), not a use counter.
        const recharges = !!recharge.value;
        const rawVal = uses.value;
        const usesVal = Number(rawVal ?? 0);
        if (recharges) return recharge.charged === true;
        const maxN = Number(uses.max);
        const maxOk = Number.isFinite(maxN) && maxN > 0
            ? true
            : String(uses.max ?? "").trim() !== "" && String(uses.max) !== "0";
        // dnd5e v4+: uses.per is removed; recovery period lives in uses.recovery array.
        // Legacy: uses.per was a string like "lr", "sr", "day".
        const hasRecoveryPeriod = !!(uses.per)
            || (Array.isArray(uses.recovery) && uses.recovery.length > 0);
        if (hasRecoveryPeriod && maxOk && usesVal > 0) return true;
        // dnd5e v4+: uses.value is a computed getter (max - spent); treat null/undefined as "full"
        // when the item is known to track a uses pool (matches compendium items right after grant).
        const hasPool = !!(hasRecoveryPeriod && maxOk);
        const limited = typeof item?.hasLimitedUses === "boolean" ? item.hasLimitedUses : false;
        if (hasPool && limited && (rawVal === null || rawVal === undefined)) return true;
        // Fallback: if max is set and value > 0, treat as available even if no recovery period is configured.
        if (maxOk && usesVal > 0) return true;
        return false;
    }

    /**
     * @param {Actor} actor
     * @param {RegExp} classNamePattern
     * @returns {number}
     */
    static #sumClassLevels(actor, classNamePattern, classKey = null) {
        const classes = actor.items?.filter(i => i.type === "class") ?? [];
        let sum = 0;
        for (const cls of classes) {
            const ident = (cls.system?.identifier ?? cls.system?.slug ?? "").toLowerCase();
            const src = (cls._stats?.compendiumSource ?? cls.flags?.core?.sourceId ?? "").toLowerCase();
            const name = cls.name?.toLowerCase() ?? "";
            const matched = (classKey && (ident === classKey || src.endsWith("." + classKey) || src.endsWith("/" + classKey) || src.endsWith("-" + classKey)))
                || classNamePattern.test(name);
            if (!matched) continue;
            sum += cls.system?.levels ?? 0;
        }
        if (sum === 0 && classKey && actor?.classes?.[classKey]) {
            sum += actor.classes[classKey]?.system?.levels ?? 0;
        }
        return sum;
    }

    /**
     * @param {Actor} actor
     * @returns {{ hasRecovery: boolean, exhausted: boolean, featureName: string|null, featureItem: Item|null, classLevel: number, maxBudget: number, maxSlotLevel: number }}
     */
    static detect(actor) {
        const maxSlotLevel = Number(game.settings.get(MODULE_ID, "spellRecoveryMaxLevel")) || 5;

        const items = actor.items?.filter(i => i.type === "feat" || i.type === "feature") ?? [];

        const arcane = items.find(i => {
            const recFlag = i.flags?.[MODULE_ID]?.recoveryType ?? i.getFlag?.(MODULE_ID, "recoveryType");
            const ident = (i.system?.identifier ?? i.system?.slug ?? "").toLowerCase();
            const src = (i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? "").toLowerCase();
            const n = i.name?.toLowerCase() ?? "";
            return recFlag === "arcane"
                || ident === "arcane-recovery"
                || ident === "arcane_recovery"
                || /(?:^|[./-])arcane[-_]recovery$/.test(src)
                || n.includes("arcane recovery");
        });
        if (arcane) {
            const classLevel = SpellSlotRecovery.#sumClassLevels(actor, /\bwizard\b/, "wizard");
            if (classLevel > 0) {
                const maxBudget = Math.ceil(classLevel / 2);
                const hasUses = SpellSlotRecovery.#hasUsesRemaining(arcane);
                return {
                    hasRecovery: hasUses,
                    exhausted: !hasUses,
                    featureName: arcane.name,
                    featureItem: arcane,
                    classLevel,
                    maxBudget,
                    maxSlotLevel,
                };
            }
        }

        const natural = items.find(i => {
            const recFlag = i.flags?.[MODULE_ID]?.recoveryType ?? i.getFlag?.(MODULE_ID, "recoveryType");
            const ident = (i.system?.identifier ?? i.system?.slug ?? "").toLowerCase();
            const src = (i._stats?.compendiumSource ?? i.flags?.core?.sourceId ?? "").toLowerCase();
            const n = i.name?.toLowerCase() ?? "";
            return recFlag === "natural"
                || ident === "natural-recovery"
                || ident === "natural_recovery"
                || /(?:^|[./-])natural[-_]recovery$/.test(src)
                || n.includes("natural recovery");
        });
        if (natural) {
            const classLevel = SpellSlotRecovery.#sumClassLevels(actor, /\bdruid\b/, "druid");
            if (classLevel > 0) {
                const maxBudget = Math.ceil(classLevel / 2);
                const hasUses = SpellSlotRecovery.#hasUsesRemaining(natural);
                return {
                    hasRecovery: hasUses,
                    exhausted: !hasUses,
                    featureName: natural.name,
                    featureItem: natural,
                    classLevel,
                    maxBudget,
                    maxSlotLevel,
                };
            }
        }

        return {
            hasRecovery: false,
            exhausted: false,
            featureName: null,
            featureItem: null,
            classLevel: 0,
            maxBudget: 0,
            maxSlotLevel,
        };
    }

    /**
     * @param {Actor} actor
     * @param {number} maxSlotLevel
     * @returns {Array<{ level: number, max: number, value: number, spent: number }>}
     */
    static getRecoverableSlots(actor, maxSlotLevel) {
        const spells = actor.system?.spells ?? {};
        const out = [];
        const cap = Math.min(Math.max(1, maxSlotLevel), 9);

        for (let level = 1; level <= cap; level++) {
            const spellKey = `spell${level}`;
            const block = spells[spellKey];
            if (!block) continue;

            // dnd5e: max is prepared from progression or from spellN.override; read both.
            const max = Number(block.max) || Number(block.override) || 0;
            const value = Number(block.value) || 0;
            const spent = max - value;
            if (spent <= 0) continue;

            out.push({ level, max, value, spent });
        }
        return out;
    }

    /**
     * @param {Actor} actor
     * @param {Item} featureItem
     * @param {Array<{ level: number, count: number }>} selections
     * @returns {Promise<{ slotsRecovered: Array<{ level: number, count: number }>, totalLevels: number }>}
     */
    static async apply(actor, featureItem, selections) {
        const maxSlotLevel = Number(game.settings.get(MODULE_ID, "spellRecoveryMaxLevel")) || 5;
        const detect = SpellSlotRecovery.detect(actor);

        if (!detect.hasRecovery || !featureItem?.id) {
            return { slotsRecovered: [], totalLevels: 0 };
        }

        const recoverable = SpellSlotRecovery.getRecoverableSlots(actor, maxSlotLevel);
        const budget = detect.maxBudget;

        const merged = new Map();
        for (const sel of selections) {
            const level = Number(sel.level);
            const count = Number(sel.count);
            if (!level || count <= 0) continue;
            merged.set(level, (merged.get(level) ?? 0) + count);
        }

        let plannedSpend = 0;
        const normalized = [];
        for (const level of [...merged.keys()].sort((a, b) => a - b)) {
            let want = merged.get(level) ?? 0;
            const slot = recoverable.find(s => s.level === level);
            if (!slot) continue;
            let use = Math.min(want, slot.spent);
            const room = budget - plannedSpend;
            const maxByBudget = level > 0 ? Math.floor(room / level) : 0;
            use = Math.min(use, maxByBudget);
            if (use <= 0) continue;
            normalized.push({ level, count: use });
            plannedSpend += level * use;
        }

        if (!normalized.length) {
            return { slotsRecovered: [], totalLevels: 0 };
        }

        const update = {};
        for (const { level, count } of normalized) {
            const spellKey = `spell${level}`;
            const block = actor.system?.spells?.[spellKey];
            if (!block) continue;
            const max = Number(block.max) || Number(block.override) || 0;
            const current = Number(block.value) || 0;
            const next = Math.min(max, current + count);
            update[`system.spells.${spellKey}.value`] = next;
        }

        if (Object.keys(update).length) {
            try {
                await actor.update(update);
            } catch (err) {
                Logger.warn(`${MODULE_ID} | SpellSlotRecovery.apply failed to update slots:`, err);
                return { slotsRecovered: [], totalLevels: 0 };
            }
        }

        const embedded = actor.items.get(featureItem.id);
        // dnd5e v4+: uses.value is a computed getter (max - spent). Decrement by incrementing spent.
        const currentSpent = Number(embedded?.system?.uses?.spent ?? featureItem.system?.uses?.spent ?? 0);
        const nextSpent = currentSpent + 1;
        try {
            if (embedded) {
                await actor.updateEmbeddedDocuments("Item", [{ _id: embedded.id, "system.uses.spent": nextSpent }]);
            } else {
                await featureItem.update({ "system.uses.spent": nextSpent });
            }
        } catch (err) {
            Logger.warn(`${MODULE_ID} | SpellSlotRecovery.apply failed to decrement feature uses:`, err);
        }

        const totalLevels = normalized.reduce((sum, s) => sum + s.level * s.count, 0);
        return { slotsRecovered: normalized, totalLevels };
    }
}
