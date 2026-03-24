import { SystemAdapter } from "./SystemAdapter.js";

/**
 * DnD5eAdapter – Full implementation for Dungeons & Dragons 5th Edition.
 *
 * Maps all Respite adapter methods to the dnd5e system data model.
 * Tested against dnd5e system v3+ (Foundry V12+).
 */
export class DnD5eAdapter extends SystemAdapter {

    get id() { return "dnd5e"; }

    // ── Actor Stats ──────────────────────────────────────────

    getHP(actor) {
        const hp = actor.system?.attributes?.hp;
        return { value: hp?.value ?? 0, max: hp?.max ?? 0 };
    }

    getLevel(actor) {
        return actor.system?.details?.level ?? 0;
    }

    getAbilityMod(actor, key) {
        return actor.system?.abilities?.[key]?.mod ?? 0;
    }

    getProficiencyBonus(actor) {
        return actor.system?.attributes?.prof ?? 2;
    }

    // ── Skills & Checks ──────────────────────────────────────

    getSkillTotal(actor, skillKey) {
        return actor.system?.skills?.[skillKey]?.total ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        return (actor.system?.skills?.[skillKey]?.proficient ?? 0) > 0;
    }

    getSkillKeys(actor) {
        return Object.keys(actor.system?.skills ?? {});
    }

    // ── Resources ────────────────────────────────────────────

    getHitDice(actor) {
        const hd = actor.system?.attributes?.hd;
        if (hd) return { current: hd.value ?? 0, max: hd.max ?? 0 };
        // Fallback: derive from level
        const level = this.getLevel(actor);
        return { current: level, max: level };
    }

    hasSpellSlots(actor) {
        const spells = actor.system?.spells ?? {};
        for (const key of Object.keys(spells)) {
            if (key.startsWith("spell") && (spells[key]?.max ?? 0) > 0) return true;
        }
        return false;
    }

    getExhaustion(actor) {
        return actor.system?.attributes?.exhaustion ?? 0;
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
        const armor = (actor.items ?? []).find(i =>
            i.type === "equipment" && i.system?.equipped &&
            ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
        );
        if (!armor) return null;
        const weight = armor.system?.type?.value ?? armor.system?.armor?.type ?? "light";
        return { name: armor.name, weight };
    }

    isToolProficient(actor, toolKey) {
        // Check system.tools first (dnd5e native)
        const toolData = actor.system?.tools?.[toolKey];
        if (toolData && (toolData.proficient ?? 0) > 0) return true;
        // Fallback: scan items for matching tool
        return (actor.items ?? []).some(i =>
            i.type === "tool" &&
            (i.system?.type?.value === toolKey || i.name?.toLowerCase().includes(toolKey))
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
        // dnd5e v3+: HD restoration is managed per-class
        const classes = (actor.items ?? []).filter(i => i.type === "class");
        let remaining = count;
        for (const cls of classes) {
            if (remaining <= 0) break;
            const hd = cls.system?.hitDice ?? {};
            const spent = hd.spent ?? 0;
            if (spent <= 0) continue;
            const restore = Math.min(spent, remaining);
            await cls.update({ "system.hitDice.spent": spent - restore });
            remaining -= restore;
        }
    }

    async applyExhaustionDelta(actor, delta) {
        const current = this.getExhaustion(actor);
        const next = Math.max(0, Math.min(6, current + delta));
        if (next !== current) {
            await actor.update({ "system.attributes.exhaustion": next });
        }
    }

    // ── Hooks ────────────────────────────────────────────────

    getRestHookNames() {
        return {
            preShort: "dnd5e.preShortRest",
            preLong: "dnd5e.preLongRest",
            preCompleted: "dnd5e.preRestCompleted"
        };
    }

    suppressDefaultRecovery(result) {
        // Prevent dnd5e from applying its own HP/HD/exhaustion recovery
        if (result.updateData) {
            delete result.updateData["system.attributes.hp.value"];
            delete result.updateData["system.attributes.exhaustion"];
        }
        if (result.updateItems) {
            result.updateItems.length = 0;
        }
    }

    // ── Activity Filtering ───────────────────────────────────

    filterActivities(activities) {
        // All 17 activities are valid for DnD5e
        return activities;
    }
}
