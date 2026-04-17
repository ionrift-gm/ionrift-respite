import { SystemAdapter } from "./SystemAdapter.js";

/**
 * PF2eAdapter – Early support for Pathfinder 2nd Edition.
 *
 * Implements the SystemAdapter contract against the pf2e system data model.
 * Core rest flow (activities, campfire, events, comfort recovery) is functional.
 * PF2e-unique mechanics (Treat Wounds, Refocus, Repair) are on the backlog.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  MECHANIC MAPPING                                              │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  HP ................. actor.system.attributes.hp (same shape)  │
 * │  Recovery Resource .. Focus Points (not Hit Dice)              │
 * │                       actor.system.resources.focus             │
 * │  Fatigue ............ Conditions: "fatigued", "drained"        │
 * │                       (binary, not a numeric 0-6 scale)        │
 * │  Skills ............. actor.system.skills[key].totalModifier   │
 * │  Proficiency ........ Tiered: untrained/trained/expert/        │
 * │                       master/legendary (rank 0-4)              │
 * │  Spell Slots ........ actor.spellcasting entries               │
 * │  Armor Sleep ........ No Xanathar equivalent in PF2e           │
 * │  Rest Hooks ......... pf2e system rest hooks                   │
 * │                                                                │
 * │  INCOMPATIBLE ACTIVITIES (hidden):                             │
 * │  act_attune ......... PF2e uses "Invest" (daily, 10 limit)    │
 * │  act_scribe ......... PF2e uses "Learn a Spell" instead       │
 * │                                                                │
 * │  PF2e-UNIQUE ACTIVITIES (future):                              │
 * │  Refocus ............ Regain 1-3 focus points (feat-dependent) │
 * │  Treat Wounds ....... Medicine check with scaled DC            │
 * │  Repair ............. Shield/equipment repair (Crafting check) │
 * │  Subsist ............ Earn a living / find food                │
 * └─────────────────────────────────────────────────────────────────┘
 */
export class PF2eAdapter extends SystemAdapter {

    get id() { return "pf2e"; }

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
        // PF2e does not have a single proficiency bonus.
        // Return 0; callers should use skill totals directly.
        return 0;
    }

    // ── Skills & Checks ──────────────────────────────────────

    getSkillTotal(actor, skillKey) {
        return actor.system?.skills?.[skillKey]?.totalModifier ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        // PF2e proficiency: rank 0 = untrained, 1 = trained, 2+ = expert/master/legendary
        return (actor.system?.skills?.[skillKey]?.rank ?? 0) >= 1;
    }

    getSkillKeys(actor) {
        return Object.keys(actor.system?.skills ?? {});
    }

    // ── Resources ────────────────────────────────────────────

    getHitDice(actor) {
        // PF2e has no Hit Dice. Map to Focus Points as the primary recovery resource.
        const focus = actor.system?.resources?.focus;
        if (focus) return { current: focus.value ?? 0, max: focus.max ?? 0 };
        return { current: 0, max: 0 };
    }

    hasSpellSlots(actor) {
        // PF2e spellcasting is managed through spellcasting entries, not a flat slots object.
        // Check if any spellcasting entry exists with prepared/spontaneous slots.
        try {
            const entries = actor.spellcasting?.contents ?? [];
            return entries.length > 0;
        } catch {
            // Fallback: check system.spells if spellcasting API unavailable
            const spells = actor.system?.spells ?? {};
            for (const key of Object.keys(spells)) {
                if (key.startsWith("spell") && (spells[key]?.max ?? 0) > 0) return true;
            }
            return false;
        }
    }

    getExhaustion(actor) {
        // PF2e uses the "fatigued" condition (binary, not tiered like 5e).
        // Return 1 if fatigued, 0 if not. Respite treats this as a boolean gate.
        try {
            // pf2e actor.conditions API (preferred)
            if (actor.conditions) {
                const fatigued = actor.conditions.bySlug("fatigued");
                if (fatigued?.length > 0) return 1;
            }
        } catch {
            // noop — fall through to item scan
        }

        // Fallback: scan items for condition type
        const hasFatigued = (actor.items ?? []).some(i =>
            i.type === "condition" && i.system?.slug === "fatigued"
        );
        return hasFatigued ? 1 : 0;
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
        // PF2e stores equipped armor via the AC attribute
        const armorItem = (actor.items ?? []).find(i =>
            i.type === "armor" && i.isEquipped
        );
        if (!armorItem) return null;

        // PF2e armor categories: unarmored, light, medium, heavy
        const category = armorItem.system?.category ?? "unarmored";
        const weight = category === "heavy" ? "heavy"
                     : category === "medium" ? "medium"
                     : "light";
        return { name: armorItem.name, weight };
    }

    isToolProficient(actor, toolKey) {
        // PF2e uses Lore skills and Crafting proficiency instead of tool proficiencies.
        // Check for Crafting proficiency as a general proxy.
        if (toolKey === "cook" || toolKey === "cook's utensils") {
            // Check for Cooking Lore or Crafting trained+
            return this.isSkillProficient(actor, "crafting");
        }
        // General tool check: look for a matching Lore skill
        return (actor.items ?? []).some(i =>
            i.type === "lore" && i.name?.toLowerCase().includes(toolKey.toLowerCase())
        );
    }

    // ── Recovery (write-side) ────────────────────────────────

    async applyHPRestore(actor, amount) {
        const hp = actor.system?.attributes?.hp;
        if (!hp) return;
        const newHp = Math.min(hp.max, hp.value + amount);
        await actor.update({ "system.attributes.hp.value": newHp });
    }

    async applyHDRestore(actor, count) {
        // PF2e: restore Focus Points instead of Hit Dice.
        const focus = actor.system?.resources?.focus;
        if (!focus) return;
        const newValue = Math.min(focus.max, focus.value + count);
        await actor.update({ "system.resources.focus.value": newValue });
    }

    async applyExhaustionDelta(actor, delta) {
        // PF2e: toggle the "fatigued" condition.
        // delta > 0 = add fatigued, delta < 0 = remove fatigued.
        try {
            if (delta > 0) {
                // Add fatigued if not already present
                if (this.getExhaustion(actor) === 0) {
                    await actor.toggleCondition?.("fatigued");
                }
            } else if (delta < 0) {
                // Remove fatigued if present
                if (this.getExhaustion(actor) > 0) {
                    await actor.toggleCondition?.("fatigued");
                }
            }
        } catch (err) {
            console.warn("ionrift-respite | PF2eAdapter: failed to toggle fatigued condition:", err);
        }
    }

    // ── Hooks ────────────────────────────────────────────────

    getRestHookNames() {
        // PF2e rest hooks — the system fires these but the exact names
        // may vary by pf2e version. These are best-effort matches.
        return {
            preShort: "pf2e.preShortRest",
            preLong: "pf2e.preLongRest",
            preCompleted: "pf2e.preRestCompleted"
        };
    }

    suppressDefaultRecovery(result) {
        // PF2e rest recovery suppression — best-effort.
        // The pf2e system may not use the same result structure as dnd5e.
        // Suppress what we can; log if structure is unexpected.
        if (result?.updateData) {
            delete result.updateData["system.attributes.hp.value"];
        }
        if (result?.updateItems) {
            result.updateItems.length = 0;
        }
    }

    // ── Activity Filtering ───────────────────────────────────

    /** IDs that are D&D-specific and have no direct PF2e equivalent yet */
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
}
