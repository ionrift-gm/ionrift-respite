import { SystemAdapter } from "./SystemAdapter.js";

/**
 * DnD5eAdapter: Full implementation for Dungeons & Dragons 5th Edition.
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

    getSaveBonus(actor, saveKey) {
        const rollData = actor.getRollData?.() ?? {};
        const fromRollData = rollData?.abilities?.[saveKey]?.save;
        if (typeof fromRollData === "number") return fromRollData;
        const mod = actor.system?.abilities?.[saveKey]?.mod ?? 0;
        const prof = actor.system?.attributes?.prof ?? 0;
        const proficient = actor.system?.abilities?.[saveKey]?.proficient ?? 0;
        return mod + (proficient > 0 ? prof : 0);
    }

    // ── Skills & Checks ──────────────────────────────────────

    normalizeSkillKey(skillKey) { return skillKey; }

    getSkillTotal(actor, skillKey) {
        return actor.system?.skills?.[skillKey]?.total ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        return (actor.system?.skills?.[skillKey]?.proficient ?? 0) > 0;
    }

    getSkillKeys(actor) {
        return Object.keys(actor.system?.skills ?? {});
    }

    getToolProficiencies(actor) {
        const profKeys = new Set();
        const tools = actor.system?.tools ?? {};
        for (const [key, data] of Object.entries(tools)) {
            if ((data?.value ?? 0) > 0 || (data?.effectValue ?? 0) > 0) {
                profKeys.add(key);
            }
        }
        for (const item of actor.items ?? []) {
            const baseItem = item.system?.type?.baseItem;
            if (baseItem) profKeys.add(baseItem);
            const nameLower = (item.name ?? "").toLowerCase();
            if (item.type === "tool" && nameLower) {
                const match = nameLower.match(/^(\w+)/);
                if (match) profKeys.add(match[1]);
            }
        }
        return [...profKeys];
    }

    // ── Resources ────────────────────────────────────────────

    getHitDice(actor) {
        const hd = actor.system?.attributes?.hd;
        if (hd) return { current: hd.value ?? 0, max: hd.max ?? 0 };
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

    hasSpellbook(actor) {
        const classEntries = actor.classes ?? {};
        const classNames = new Set(
            Object.values(classEntries).map(c => c.name?.toLowerCase().trim())
        );
        const isWizard = !!classEntries.wizard || classNames.has("wizard");
        if (isWizard) return true;
        // Warlock with Pact of the Tome (Book of Shadows) is the only other class
        // that transcribes spells into a book. Other classes carrying a spellbook
        // item (loot, divine casters, etc.) do not qualify.
        const isWarlock = !!classEntries.warlock || classNames.has("warlock");
        if (!isWarlock) return false;
        return (actor.items ?? []).some(i =>
            i.name?.toLowerCase().includes("spellbook") ||
            i.name?.toLowerCase().includes("book of shadows")
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
            i.type === "equipment" && i.system?.equipped &&
            ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
        );
        if (!armor) return null;
        const weight = armor.system?.type?.value ?? armor.system?.armor?.type ?? "light";
        return { name: armor.name, weight };
    }

    isToolProficient(actor, toolKey) {
        const toolData = actor.system?.tools?.[toolKey];
        if (toolData && (toolData.proficient ?? 0) > 0) return true;
        if (toolData && ((toolData.value ?? 0) > 0 || (toolData.effectValue ?? 0) > 0)) return true;
        return (actor.items ?? []).some(i =>
            i.type === "tool" &&
            (i.system?.type?.value === toolKey ||
             i.system?.type?.baseItem === toolKey ||
             i.name?.toLowerCase().includes(toolKey))
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
        if (!classes.length) return;
        const useNewField = classes[0]?.system?.hd !== undefined;
        const sorted = [...classes]
            .map(cls => ({
                item: cls,
                spent: useNewField
                    ? (cls.system?.hd?.spent ?? 0)
                    : (cls.system?.hitDiceUsed ?? 0)
            }))
            .filter(c => c.spent > 0);
        let remaining = count;
        for (const cls of sorted) {
            if (remaining <= 0) break;
            const restore = Math.min(cls.spent, remaining);
            if (useNewField) {
                await cls.item.update({ "system.hd.spent": cls.spent - restore });
            } else {
                await cls.item.update({ "system.hitDiceUsed": cls.spent - restore });
            }
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

    // ── Native Rest ───────────────────────────────────────────

    get hasHookableRest() { return true; }

    getRestHookNames() {
        return {
            preShort: "dnd5e.preShortRest",
            preLong: "dnd5e.preLongRest",
            preCompleted: "dnd5e.preRestCompleted"
        };
    }

    suppressDefaultRecovery(result) {
        if (result.updateData) {
            delete result.updateData["system.attributes.hp.value"];
            delete result.updateData["system.attributes.exhaustion"];
        }
        if (result.updateItems) {
            result.updateItems.length = 0;
        }
    }

    async triggerNativeRest(actor, restType) {
        if (restType === "long") {
            await actor.longRest({ dialog: false, chat: false, advanceTime: false });
        } else {
            await actor.shortRest({ dialog: false, chat: false, advanceTime: false });
        }
        const { reassertMealExhaustionFloor } = await import("../services/MealExhaustionGuard.js");
        await reassertMealExhaustionFloor(actor);
    }

    // ── Active Effects ────────────────────────────────────────

    getActiveEffectChanges(buffType, params) {
        const buffs = game.ionrift?.library?.cooking?.buffs;
        const descriptor = this._buffDescriptorFromParams(buffType, params);
        if (buffs?.toActiveEffectChanges && descriptor) {
            const kernel = buffs.toActiveEffectChanges(null, descriptor);
            if (Array.isArray(kernel) && kernel.length) return kernel;
        }
        return this._legacyActiveEffectChanges(buffType, params);
    }

    /** @private */
    _buffDescriptorFromParams(buffType, params) {
        if (buffType === "temp_hp") {
            return { type: "temp_hp", formula: String(params.value ?? 0) };
        }
        if (buffType === "advantage") {
            return {
                type: "advantage",
                save: { ability: params.ability ?? "con" },
                duration: params.duration ?? "nextSave"
            };
        }
        if (buffType === "resistance") {
            return {
                type: "resistance",
                damageType: params.damageType ?? "poison",
                duration: params.duration ?? "untilLongRest"
            };
        }
        return null;
    }

    /** @private */
    _legacyActiveEffectChanges(buffType, params) {
        if (buffType === "temp_hp") {
            return [{
                key: "system.attributes.hp.temp",
                mode: 4, // CONST.ACTIVE_EFFECT_MODES.OVERRIDE
                value: String(params.value ?? 0),
                priority: 20
            }];
        }
        if (buffType === "advantage") {
            const ab = (params.ability ?? "con").toLowerCase();
            return [{
                key: `system.abilities.${ab}.save.roll.mode`,
                mode: 2, // CONST.ACTIVE_EFFECT_MODES.ADD
                value: "1",
                priority: 20
            }];
        }
        if (buffType === "resistance") {
            const dtype = String(params.damageType ?? "poison").toLowerCase();
            return [{
                key: "system.traits.dr.value",
                mode: 2, // CONST.ACTIVE_EFFECT_MODES.ADD
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
            "Fire Bolt", "Produce Flame", "Create Bonfire",
            "Control Flames", "Prestidigitation",
            "Elementalism", "Thaumaturgy", "Druidcraft"
        ];
    }
}
