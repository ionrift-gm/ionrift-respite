import { SystemAdapter } from "./SystemAdapter.js";

/**
 * PF2eAdapter: Pathfinder 2nd Edition support.
 *
 * Implements the SystemAdapter contract against the pf2e system data model.
 * Audited against pf2e system v8.x (Foundry V14).
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  MECHANIC MAPPING                                              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  HP ................. actor.system.attributes.hp (same shape)  │
 * │  Focus Points ....... actor.system.resources.focus             │
 * │  Fatigue ............ Conditions: "fatigued" (binary)          │
 * │  Drained ............ Condition: "drained" (valued 1-4)        │
 * │  Skills ............. actor.system.skills[key].totalModifier   │
 * │  Proficiency ........ Tiered: rank 0-4 (untrained→legendary)  │
 * │  Saves .............. actor.saves.fortitude/reflex/will        │
 * │  Spell Slots ........ actor.spellcasting entries               │
 * │  Armor Sleep ........ No Xanathar equivalent in PF2e           │
 * │  Rest ............... game.pf2e.actions.restForTheNight()      │
 * │                       (no hookable rest flow)                  │
 * │                                                                │
 * │  INCOMPATIBLE ACTIVITIES (hidden):                             │
 * │  act_attune ......... PF2e uses "Invest" (daily, 10 limit)    │
 * │  act_scribe ......... PF2e uses "Learn a Spell" instead       │
 * └─────────────────────────────────────────────────────────────────┘
 */
export class PF2eAdapter extends SystemAdapter {

    get id() { return "pf2e"; }

    // ── Skill Key Mapping ─────────────────────────────────────
    // DnD5e uses 3-letter abbreviations; PF2e uses full names.

    static SKILL_KEY_MAP = {
        acr: "acrobatics",
        ani: "nature",
        arc: "arcana",
        ath: "athletics",
        dec: "deception",
        his: "society",
        ins: "perception",
        itm: "intimidation",
        inv: "perception",
        med: "medicine",
        nat: "nature",
        prc: "perception",
        prf: "performance",
        per: "diplomacy",
        rel: "religion",
        slt: "thievery",
        ste: "stealth",
        sur: "survival",
    };

    // DnD5e save keys → PF2e save keys
    static SAVE_KEY_MAP = {
        str: "fortitude",
        dex: "reflex",
        con: "fortitude",
        int: "will",
        wis: "will",
        cha: "will",
        fortitude: "fortitude",
        reflex: "reflex",
        will: "will",
    };

    normalizeSkillKey(skillKey) {
        return PF2eAdapter.SKILL_KEY_MAP[skillKey] ?? skillKey;
    }

    // ── Actor Stats ──────────────────────────────────────────

    getHP(actor) {
        const hp = actor.system?.attributes?.hp;
        return { value: hp?.value ?? 0, max: hp?.max ?? 0 };
    }

    getLevel(actor) {
        return actor.system?.details?.level?.value ?? 0;
    }

    getAbilityMod(actor, key) {
        return actor.system?.abilities?.[key]?.mod ?? 0;
    }

    getProficiencyBonus(actor) {
        // PF2e proficiency bonus = level + proficiency rank bonus (2/4/6/8).
        // Since there's no single prof bonus, return level as a baseline.
        // Callers needing per-skill proficiency should use getSkillTotal() instead.
        return this.getLevel(actor);
    }

    getSaveBonus(actor, saveKey) {
        const pf2eKey = PF2eAdapter.SAVE_KEY_MAP[saveKey] ?? saveKey;
        try {
            const stat = actor.saves?.[pf2eKey];
            if (stat) return stat.totalModifier ?? stat.mod ?? 0;
        } catch { /* fall through */ }
        // Fallback: ability mod only
        const abilityMap = { fortitude: "con", reflex: "dex", will: "wis" };
        return this.getAbilityMod(actor, abilityMap[pf2eKey] ?? saveKey);
    }

    // ── Skills & Checks ──────────────────────────────────────

    getSkillTotal(actor, skillKey) {
        const key = this.normalizeSkillKey(skillKey);
        return actor.system?.skills?.[key]?.totalModifier ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        const key = this.normalizeSkillKey(skillKey);
        return (actor.system?.skills?.[key]?.rank ?? 0) >= 1;
    }

    getSkillKeys(actor) {
        return Object.keys(actor.system?.skills ?? {});
    }

    getProficientSkillKeys(actor) {
        return this.getSkillKeys(actor).filter(k =>
            (actor.system?.skills?.[k]?.rank ?? 0) >= 1
        );
    }

    getToolProficiencies(actor) {
        const profKeys = [];
        if (this.isSkillProficient(actor, "crafting")) {
            profKeys.push("crafting", "cook", "herb", "alchemist", "smith");
        }
        for (const item of actor.items ?? []) {
            if (item.type === "lore") {
                profKeys.push(item.name?.toLowerCase().replace(/\s+lore$/i, "") ?? "");
            }
        }
        return profKeys.filter(Boolean);
    }

    // ── Resources ────────────────────────────────────────────

    getHitDice(actor) {
        // PF2e has no Hit Dice. Return level-based recovery resource
        // to keep the recovery math functional (half-level HD on long rest).
        const level = this.getLevel(actor);
        return { current: level, max: level };
    }

    getFocusPoints(actor) {
        const focus = actor.system?.resources?.focus;
        if (focus) return { value: focus.value ?? 0, max: focus.max ?? 0 };
        return { value: 0, max: 0 };
    }

    hasSpellSlots(actor) {
        try {
            const entries = actor.spellcasting?.contents ?? [];
            return entries.length > 0;
        } catch {
            const spells = actor.system?.spells ?? {};
            for (const key of Object.keys(spells)) {
                if (key.startsWith("spell") && (spells[key]?.max ?? 0) > 0) return true;
            }
            return false;
        }
    }

    getExhaustion(actor) {
        try {
            if (actor.conditions) {
                const fatigued = actor.conditions.bySlug("fatigued");
                if (fatigued?.length > 0) return 1;
            }
        } catch { /* fall through */ }
        const hasFatigued = (actor.items ?? []).some(i =>
            i.type === "condition" && i.system?.slug === "fatigued"
        );
        return hasFatigued ? 1 : 0;
    }

    getDrainedLevel(actor) {
        try {
            if (actor.conditions) {
                const drained = actor.conditions.bySlug("drained");
                if (drained?.length > 0) return drained[0].value ?? 1;
            }
        } catch { /* fall through */ }
        const drainedItem = (actor.items ?? []).find(i =>
            i.type === "condition" && i.system?.slug === "drained"
        );
        return drainedItem?.system?.value?.value ?? drainedItem?.badge?.value ?? 0;
    }

    hasSpellbook(actor) {
        // PF2e prepared casters (Wizard, Witch, Magus) have spell preparation.
        // Check for a prepared spellcasting entry.
        try {
            const entries = actor.spellcasting?.contents ?? [];
            return entries.some(e =>
                e.system?.prepared?.value === "prepared"
            );
        } catch { return false; }
    }

    // ── Equipment & Inventory ────────────────────────────────

    findItemByName(actor, name) {
        const lower = name.toLowerCase();
        return (actor.items ?? []).find(i => i.name?.toLowerCase().includes(lower)) ?? null;
    }

    hasItemByName(actor, name) {
        return this.findItemByName(actor, name) !== null;
    }

    getEquippedArmor(actor) {
        const armorItem = (actor.items ?? []).find(i =>
            i.type === "armor" && i.isEquipped
        );
        if (!armorItem) return null;
        const category = armorItem.system?.category ?? "unarmored";
        const weight = category === "heavy" ? "heavy"
                     : category === "medium" ? "medium"
                     : "light";
        return { name: armorItem.name, weight };
    }

    isToolProficient(actor, toolKey) {
        if (toolKey === "cook" || toolKey === "cook's utensils") {
            return this.isSkillProficient(actor, "crafting");
        }
        return (actor.items ?? []).some(i =>
            i.type === "lore" && i.name?.toLowerCase().includes(toolKey.toLowerCase())
        );
    }

    // ── Currency ──────────────────────────────────────────────

    getCurrency(actor) {
        return actor.system?.currency?.gp ?? 0;
    }

    async deductCurrency(actor, amount) {
        const current = this.getCurrency(actor);
        const next = Math.max(0, current - amount);
        await actor.update({ "system.currency.gp": next });
    }

    // ── Recovery (write-side) ────────────────────────────────

    async applyHPRestore(actor, amount) {
        const hp = actor.system?.attributes?.hp;
        if (!hp) return;
        const newHp = Math.min(hp.max, hp.value + amount);
        await actor.update({ "system.attributes.hp.value": newHp });
    }

    async applyTempHP(actor, amount) {
        const current = actor.system?.attributes?.hp?.temp ?? 0;
        const next = Math.max(current, amount);
        await actor.update({ "system.attributes.hp.temp": next });
    }

    async applyHDRestore(actor, count) {
        // PF2e has no Hit Dice to restore. No-op.
        // Focus Point restoration is handled by triggerNativeRest().
    }

    async applyExhaustionDelta(actor, delta) {
        try {
            if (delta > 0) {
                if (this.getExhaustion(actor) === 0) {
                    await actor.toggleCondition?.("fatigued");
                }
            } else if (delta < 0) {
                if (this.getExhaustion(actor) > 0) {
                    await actor.toggleCondition?.("fatigued");
                }
            }
        } catch (err) {
            console.warn("ionrift-respite | PF2eAdapter: failed to toggle fatigued condition:", err);
        }
    }

    // ── Native Rest ───────────────────────────────────────────

    get hasHookableRest() { return false; }

    getRestHookNames() {
        // PF2e does not fire rest hooks. Return nulls so the hook
        // registration code in module.js can skip registration.
        return { preShort: null, preLong: null, preCompleted: null };
    }

    suppressDefaultRecovery(_result) {
        // No-op: PF2e does not use a suppressible rest result.
        // Recovery suppression is handled by not calling restForTheNight()
        // until Respite is ready, then calling it via triggerNativeRest().
    }

    async triggerNativeRest(actor, restType) {
        if (restType !== "long") return;
        try {
            if (game.pf2e?.actions?.restForTheNight) {
                await game.pf2e.actions.restForTheNight({ actors: actor });
            }
        } catch (err) {
            console.warn("ionrift-respite | PF2eAdapter: restForTheNight() failed:", err);
        }
    }

    // ── Active Effects ────────────────────────────────────────

    getActiveEffectChanges(buffType, params) {
        // PF2e uses Rule Elements rather than AE change keys for most bonuses.
        // Return minimal AE changes that work within PF2e's AE system.
        if (buffType === "temp_hp") {
            return [{
                key: "system.attributes.hp.temp",
                mode: 4, // OVERRIDE
                value: String(params.value ?? 0),
                priority: 20
            }];
        }
        // advantage and resistance don't map cleanly to PF2e AE keys.
        // Return empty and rely on descriptive text in the AE.
        return [];
    }

    // ── Activity Filtering ───────────────────────────────────

    static INCOMPATIBLE = ["act_attune", "act_scribe"];

    filterActivities(activities) {
        return activities.filter(a => !PF2eAdapter.INCOMPATIBLE.includes(a.id));
    }

    // ── Campfire ─────────────────────────────────────────────

    getFireCantrips() {
        return [
            "Produce Flame",
            "Ignition",
            "Prestidigitation"
        ];
    }

    // ── Bedding Down ─────────────────────────────────────────

    getBeddingStatusIds() {
        const conditions = CONFIG.PF2E?.statusEffects?.conditions ?? CONFIG.statusEffects ?? {};
        const statusIds = ["unconscious"];
        if ("prone" in conditions) statusIds.push("prone");
        return statusIds;
    }
}
