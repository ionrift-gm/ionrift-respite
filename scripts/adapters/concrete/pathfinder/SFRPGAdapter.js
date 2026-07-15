import { SystemAdapter } from "../../SystemAdapter.js";

/**
 * SFRPGAdapter: Starfinder support for Ionrift Respite.
 * HP and stamina share the attributes block; native rest has no pre-hook.
 */
export class SFRPGAdapter extends SystemAdapter {

    get id() { return "sfrpg"; }

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
        return actor.system?.attributes?.bab?.value ?? Math.floor(this.getLevel(actor) / 4) + 1;
    }

    getSaveBonus(actor, saveKey) {
        const rollData = actor.getRollData?.() ?? {};
        const fromRollData = rollData?.attributes?.[saveKey]?.total;
        if (typeof fromRollData === "number") return fromRollData;
        const save = actor.system?.attributes?.[saveKey];
        if (save?.total !== undefined) return save.total;
        const abilityMap = { fort: "con", ref: "dex", will: "wis" };
        return this.getAbilityMod(actor, abilityMap[saveKey] ?? saveKey);
    }

    normalizeSkillKey(skillKey) { return skillKey; }

    getSkillTotal(actor, skillKey) {
        return actor.system?.skills?.[skillKey]?.total ?? actor.system?.skills?.[skillKey]?.mod ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        return (actor.system?.skills?.[skillKey]?.ranks ?? 0) > 0;
    }

    getSkillKeys(actor) {
        return Object.keys(actor.system?.skills ?? {});
    }

    getToolProficiencies(actor) {
        const profKeys = new Set();
        for (const item of actor.items ?? []) {
            if (item.type === "equipment" && item.system?.proficient) {
                profKeys.add(item.name?.toLowerCase() ?? "");
            }
        }
        return [...profKeys].filter(Boolean);
    }

    getHitDice(actor) {
        const level = this.getLevel(actor);
        const sp = actor.system?.attributes?.sp;
        if (sp) {
            return { current: sp.value ?? 0, max: sp.max ?? level };
        }
        return { current: level, max: level };
    }

    hasSpellSlots(actor) {
        const spells = actor.system?.spells ?? {};
        for (const key of Object.keys(spells)) {
            if (key.startsWith("spell") && (spells[key]?.max ?? 0) > 0) return true;
        }
        return false;
    }

    getExhaustion(_actor) {
        return 0;
    }

    hasSpellbook(_actor) {
        return false;
    }

    findItemByName(actor, name) {
        const lower = name.toLowerCase();
        return (actor.items ?? []).find(i => i.name?.toLowerCase().includes(lower)) ?? null;
    }

    hasItemByName(actor, name) {
        return this.findItemByName(actor, name) !== null;
    }

    getEquippedArmor(actor) {
        const armor = (actor.items ?? []).find(i =>
            i.type === "equipment" &&
            i.system?.equipped &&
            ["light", "heavy"].includes(i.system?.armor?.type ?? "")
        );
        if (!armor) return null;
        return { name: armor.name, weight: armor.system?.armor?.type ?? "light" };
    }

    isToolProficient(actor, toolKey) {
        const lower = toolKey.toLowerCase();
        return (actor.items ?? []).some(i =>
            i.type === "equipment" && i.name?.toLowerCase().includes(lower)
        );
    }

    getCurrency(actor) {
        return actor.system?.currency?.credits ?? actor.system?.currency?.cp ?? 0;
    }

    async deductCurrency(actor, amount) {
        const key = actor.system?.currency?.credits !== undefined ? "system.currency.credits" : "system.currency.cp";
        const current = foundry.utils.getProperty(actor, key) ?? 0;
        await actor.update({ [key]: Math.max(0, current - amount) });
    }

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
        const sp = actor.system?.attributes?.sp;
        if (!sp) return;
        const restore = Math.min(count, sp.max - sp.value);
        if (restore > 0) {
            await actor.update({ "system.attributes.sp.value": sp.value + restore });
        }
    }

    async applyExhaustionDelta(_actor, _delta) {
        // Starfinder uses ability damage, not 5e exhaustion.
    }

    get hasHookableRest() { return false; }

    getRestHookNames() {
        return { preShort: null, preLong: null, preCompleted: null };
    }

    suppressDefaultRecovery(_result) {
        // onActorRest fires after apply; we skip full native rest instead.
    }

    async triggerNativeRest(actor, restType) {
        const system = actor.system;
        const updates = {};
        const itemUpdates = [];
        const perTypes = restType === "long" ? ["sr", "lr", "day"] : ["sr"];

        if (system.resources) {
            for (const [key, res] of Object.entries(system.resources)) {
                const applies = restType === "long" ? (res.sr || res.lr) : res.sr;
                if (res.max && applies) {
                    updates[`system.resources.${key}.value`] = res.max;
                }
            }
        }

        if (restType === "long" && system.spells) {
            for (let level = 1; level <= 6; level++) {
                const slot = system.spells[`spell${level}`];
                if (!slot || slot.max === undefined) continue;
                updates[`system.spells.spell${level}.value`] = slot.max;
                if (slot.perClass) {
                    for (const [clsId, clsSlot] of Object.entries(slot.perClass)) {
                        if (clsSlot.max !== undefined) {
                            updates[`system.spells.spell${level}.perClass.${clsId}.value`] = clsSlot.max;
                        }
                    }
                }
            }
        }

        for (const item of actor.items ?? []) {
            const uses = item.system?.uses;
            if (!uses?.per || !perTypes.includes(uses.per)) continue;
            const maxUses = typeof item.getMaxUses === "function" ? item.getMaxUses() : uses.max;
            if (maxUses !== undefined && uses.value < maxUses) {
                itemUpdates.push({ _id: item.id, "system.uses.value": maxUses });
            }
        }

        if (Object.keys(updates).length) await actor.update(updates);
        if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);
    }

    getActiveEffectChanges(buffType, params) {
        if (buffType === "temp_hp") {
            return [{
                key: "system.attributes.hp.temp",
                mode: 4,
                value: String(params.value ?? 0),
                priority: 20
            }];
        }
        return [];
    }

    filterActivities(activities) {
        return activities.filter(a => a.id !== "act_attune");
    }

    getFireCantrips() {
        return ["Ignite", "Telekinetic Projectile"];
    }
}
