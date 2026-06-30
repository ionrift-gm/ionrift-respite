import { SystemAdapter } from "./SystemAdapter.js";

/**
 * PF1eAdapter: Pathfinder 1st Edition support for Ionrift Respite.
 * Data model mirrors dnd5e in many paths; rest uses pf1PreActorRest + performRest().
 */
export class PF1eAdapter extends SystemAdapter {

    get id() { return "pf1"; }

    // ── Actor Stats ──────────────────────────────────────────

    getHP(actor) {
        const hp = actor.system?.attributes?.hp;
        return { value: hp?.value ?? 0, max: hp?.max ?? 0 };
    }

    getLevel(actor) {
        return actor.system?.details?.level?.value
            ?? actor.system?.details?.totalLevel
            ?? 0;
    }

    getAbilityMod(actor, key) {
        return actor.system?.abilities?.[key]?.mod ?? 0;
    }

    getProficiencyBonus(actor) {
        if (typeof actor.getProficiencyBonus === "function") {
            return actor.getProficiencyBonus();
        }
        const level = this.getLevel(actor);
        return Math.floor(level / 4) + 1;
    }

    getSaveBonus(actor, saveKey) {
        const rollData = actor.getRollData?.() ?? {};
        const fromRollData = rollData?.attributes?.savingThrows?.[saveKey]?.total
            ?? rollData?.savingThrows?.[saveKey]?.total;
        if (typeof fromRollData === "number") return fromRollData;
        const mod = actor.system?.abilities?.[saveKey]?.mod ?? 0;
        const base = actor.system?.attributes?.savingThrows?.[saveKey]?.total;
        if (typeof base === "number") return base;
        return mod;
    }

    // ── Skills & Checks ──────────────────────────────────────

    normalizeSkillKey(skillKey) { return skillKey; }

    getSkillTotal(actor, skillKey) {
        const skill = actor.system?.skills?.[skillKey];
        return skill?.total ?? skill?.mod ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        const skill = actor.system?.skills?.[skillKey];
        return (skill?.rank ?? skill?.points ?? 0) > 0;
    }

    getSkillKeys(actor) {
        return Object.keys(actor.system?.skills ?? {});
    }

    getToolProficiencies(actor) {
        const profKeys = new Set();
        for (const item of actor.items ?? []) {
            if (item.type === "loot" && item.system?.subType === "tradeGoods") {
                profKeys.add(item.name?.toLowerCase() ?? "");
            }
            if (item.type === "equipment" && item.system?.subType === "tool") {
                profKeys.add(item.name?.toLowerCase() ?? "");
            }
        }
        return [...profKeys].filter(Boolean);
    }

    // ── Resources ────────────────────────────────────────────

    getHitDice(actor) {
        const classes = (actor.items ?? []).filter(i => i.type === "class");
        let current = 0;
        let max = 0;
        for (const cls of classes) {
            const hd = cls.system?.hd ?? cls.system?.hitDie;
            if (!hd) continue;
            const hdMax = hd.max ?? hd.total ?? 0;
            const spent = hd.spent ?? hd.value ?? 0;
            max += hdMax;
            current += Math.max(0, hdMax - spent);
        }
        if (max > 0) return { current, max };
        const level = this.getLevel(actor);
        return { current: level, max: level };
    }

    hasSpellSlots(actor) {
        if ((actor.items ?? []).some(i => i.type === "spellbook")) return true;
        try {
            const books = actor.spellbooks ?? {};
            return Object.keys(books).length > 0;
        } catch {
            return false;
        }
    }

    getExhaustion(actor) {
        if (typeof actor.hasCondition === "function" && actor.hasCondition("exhausted")) return 1;
        return 0;
    }

    hasSpellbook(actor) {
        return (actor.items ?? []).some(i =>
            i.type === "spellbook" ||
            (i.type === "class" && /wizard/i.test(i.name ?? ""))
        );
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
            i.type === "equipment" &&
            i.system?.equipped &&
            ["light", "medium", "heavy"].includes(i.system?.armor?.type ?? i.system?.subType ?? "")
        );
        if (!armor) return null;
        const weight = armor.system?.armor?.type ?? armor.system?.subType ?? "light";
        return { name: armor.name, weight };
    }

    isToolProficient(actor, toolKey) {
        const lower = toolKey.toLowerCase();
        return (actor.items ?? []).some(i =>
            i.type === "equipment" &&
            (i.system?.subType === "tool" || i.name?.toLowerCase().includes(lower))
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
        const classes = (actor.items ?? []).filter(i => i.type === "class");
        const sorted = [...classes]
            .map(cls => ({
                item: cls,
                spent: cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0
            }))
            .filter(c => c.spent > 0);
        let remaining = count;
        for (const cls of sorted) {
            if (remaining <= 0) break;
            const restore = Math.min(cls.spent, remaining);
            if (cls.item.system?.hd !== undefined) {
                await cls.item.update({ "system.hd.spent": cls.spent - restore });
            } else {
                await cls.item.update({ "system.hitDiceUsed": cls.spent - restore });
            }
            remaining -= restore;
        }
    }

    async applyExhaustionDelta(actor, delta) {
        if (delta === 0) return;
        if (typeof actor.toggleCondition !== "function") return;
        const hasExhausted = this.getExhaustion(actor) > 0;
        if (delta > 0 && !hasExhausted) await actor.toggleCondition("exhausted");
        if (delta < 0 && hasExhausted) await actor.toggleCondition("exhausted");
    }

    // ── Native Rest ───────────────────────────────────────────

    get hasHookableRest() { return true; }

    getRestHookNames() {
        return {
            preShort: null,
            preLong: null,
            preCompleted: "pf1PreActorRest"
        };
    }

    suppressDefaultRecovery(result) {
        const updateData = result.updateData ?? result;
        if (updateData && updateData !== result) {
            delete updateData["system.attributes.hp.value"];
            delete updateData["system.attributes.hp.temp"];
            if (updateData.system?.attributes?.hp) {
                delete updateData.system.attributes.hp;
            }
        } else if (result.updateData) {
            delete result.updateData["system.attributes.hp.value"];
            delete result.updateData["system.attributes.hp.temp"];
            if (result.updateData.system?.attributes?.hp) {
                delete result.updateData.system.attributes.hp;
            }
        }

        const targetItems = result.updateItems ?? result.itemUpdates;
        if (!Array.isArray(targetItems)) return;

        const filtered = targetItems.filter(u => {
            const sys = u.system ?? u;
            return !("hd" in sys) && !("hitDice" in sys) && !("hitDiceUsed" in sys);
        });
        targetItems.splice(0, targetItems.length, ...filtered);
    }

    async triggerNativeRest(actor, restType) {
        if (typeof actor.performRest !== "function") return;
        await actor.performRest({
            restType: restType === "long" ? "long" : "short",
            skipDialog: true,
            chat: false
        });
    }

    // ── Active Effects ────────────────────────────────────────

    getActiveEffectChanges(buffType, params) {
        if (buffType === "temp_hp") {
            return [{
                key: "system.attributes.hp.temp",
                mode: 4,
                value: String(params.value ?? 0),
                priority: 20
            }];
        }
        if (buffType === "advantage") {
            const ab = (params.ability ?? "con").toLowerCase();
            return [{
                key: `system.abilities.${ab}.save.roll.mode`,
                mode: 2,
                value: "1",
                priority: 20
            }];
        }
        if (buffType === "resistance") {
            const dtype = String(params.damageType ?? "poison").toLowerCase();
            return [{
                key: "system.traits.dr.value",
                mode: 2,
                value: dtype,
                priority: 20
            }];
        }
        return [];
    }

    // ── Activity Filtering ───────────────────────────────────

    filterActivities(activities) {
        return activities;
    }

    // ── Campfire ─────────────────────────────────────────────

    getFireCantrips() {
        return [
            "Produce Flame",
            "Flame Blade",
            "Prestidigitation",
            "Light"
        ];
    }
}
