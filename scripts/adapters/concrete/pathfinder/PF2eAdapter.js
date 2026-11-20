import { MODULE_ID } from "../../../data/moduleId.js";
import { SystemAdapter } from "../../SystemAdapter.js";
import { findPf2eRestArmor } from "../../../services/camp/gear/RestArmorHelper.js";

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
 * │  Proficiency ........ Tiered: rank 0-4 (untrained, legendary)  │
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

    get supportsShortRest() { return false; }

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
        sle: "thievery",
        slt: "thievery",
        ste: "stealth",
        sur: "survival",
        crafting: "crafting",
    };

    static SKILL_LABELS = {
        acrobatics: "Acrobatics",
        arcana: "Arcana",
        athletics: "Athletics",
        crafting: "Crafting",
        deception: "Deception",
        diplomacy: "Diplomacy",
        intimidation: "Intimidation",
        medicine: "Medicine",
        nature: "Nature",
        occultism: "Occultism",
        performance: "Performance",
        perception: "Perception",
        religion: "Religion",
        society: "Society",
        stealth: "Stealth",
        survival: "Survival",
        thievery: "Thievery",
    };

    // DnD5e save keys ,  PF2e save keys
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

    getSkillLabel(skillKey) {
        const key = this.normalizeSkillKey(skillKey);
        return PF2eAdapter.SKILL_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
    }

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
        // PF2e has no single global proficiency bonus. Respite features that
        // consume this method are modeled around a bounded DnD-style bonus.
        // Map level to a 5e-equivalent progression so values stay in-range.
        const level = Math.max(1, Number(this.getLevel(actor)) || 1);
        return Math.min(6, Math.max(2, Math.floor((level - 1) / 4) + 2));
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
            const flagKey = item.flags?.[MODULE_ID]?.toolKey;
            if (flagKey) profKeys.push(String(flagKey).toLowerCase());
            if (item.type === "lore") {
                const slug = (item.system?.slug ?? item.system?.identifier ?? "").toLowerCase().replace(/[-_]+lore$/i, "").replace(/[-_]+/g, " ").trim();
                if (slug) profKeys.push(slug);
                profKeys.push(item.name?.toLowerCase().replace(/\s+lore$/i, "") ?? "");
            }
        }
        return profKeys.filter(Boolean);
    }

    getHitDice(actor) {
        // PF2e has no Hit Dice. Return level-based recovery resource
        // to keep the recovery math functional (half-level HD on long rest).
        const level = this.getLevel(actor);
        return { current: level, max: level };
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

    findItemByName(actor, name) {
        if (!name) return null;
        const lower = name.toLowerCase().trim();
        const normTarget = lower.replace(/[-_'’]+/g, " ").replace(/\s+/g, " ").trim();
        return (actor.items ?? []).find(i => {
            const rf = i.flags?.[MODULE_ID] ?? {};
            for (const cand of [rf.itemRef, rf.campGearRole, rf.toolKey, i.system?.identifier, i.system?.slug, i.system?.type?.baseItem]) {
                if (!cand) continue;
                const cLow = String(cand).toLowerCase().trim();
                const cNorm = cLow.replace(/[-_'’]+/g, " ").replace(/\s+/g, " ").trim();
                if (cLow === lower || cNorm === normTarget || cNorm.includes(normTarget)) return true;
            }
            return i.name?.toLowerCase().includes(lower);
        }) ?? null;
    }

    hasItemByName(actor, name) {
        return this.findItemByName(actor, name) !== null;
    }

    getEquippedArmor(actor) {
        const armorItem = (actor.items ?? []).find(i =>
            i.type === "armor" && (i.isEquipped || (i.system?.equipped?.carryType === "worn" && i.system?.equipped?.inSlot === true))
        );
        if (!armorItem) return null;
        const category = armorItem.system?.category ?? "unarmored";
        const weight = category === "heavy" ? "heavy"
                     : category === "medium" ? "medium"
                     : "light";
        return { name: armorItem.name, weight };
    }

    getEquippedRestArmor(actor) {
        return findPf2eRestArmor(actor);
    }

    async setArmorEquipped(actor, item, equipped) {
        if (!item) return;
        if (typeof actor?.changeCarryType === "function") {
            await actor.changeCarryType(item, {
                carryType: "worn",
                handsHeld: 0,
                inSlot: Boolean(equipped)
            });
            return;
        }
        await item.update?.({
            "system.equipped.carryType": "worn",
            "system.equipped.inSlot": Boolean(equipped)
        });
    }

    getConditionValue(actor, slug) {
        if (!actor || !slug) return 0;
        try {
            const direct = actor.getCondition?.(slug);
            if (direct) return Number(direct.value ?? direct.system?.value?.value ?? 1) || 1;
            const bySlug = actor.conditions?.bySlug?.(slug);
            if (bySlug?.length > 0) {
                const first = bySlug[0];
                return Number(first.value ?? first.system?.value?.value ?? 1) || 1;
            }
        } catch { /* fall through */ }
        const found = (actor.items ?? []).find(i =>
            i.type === "condition" && (i.slug === slug || i.system?.slug === slug)
        );
        if (!found) return 0;
        return Number(found.value ?? found.system?.value?.value ?? 1) || 1;
    }

    getDrained(actor) {
        return Math.max(0, Math.min(4, this.getConditionValue(actor, "drained")));
    }

    async setFatigued(actor, active) {
        const target = Boolean(active);
        const current = this.getExhaustion(actor) > 0;
        if (current === target) return;
        if (typeof actor?.toggleCondition === "function") {
            await actor.toggleCondition("fatigued");
            return;
        }
        const items = Array.isArray(actor?.items) ? actor.items : null;
        if (target) {
            const doc = { id: "cond-fatigued", type: "condition", name: "Fatigued", system: { slug: "fatigued" } };
            if (typeof actor?.createEmbeddedDocuments === "function") {
                await actor.createEmbeddedDocuments("Item", [doc]);
            } else if (items) {
                items.push(doc);
            }
        } else {
            const existing = (actor?.items ?? []).find(i => i.type === "condition" && i.system?.slug === "fatigued");
            if (!existing) return;
            if (typeof actor?.deleteEmbeddedDocuments === "function" && existing.id) {
                await actor.deleteEmbeddedDocuments("Item", [existing.id]);
            } else if (items) {
                const idx = items.indexOf(existing);
                if (idx >= 0) items.splice(idx, 1);
            }
        }
    }

    async _setValuedCondition(actor, slug, targetValue, maxVal = 4) {
        const target = Math.max(0, Math.min(maxVal, Math.floor(Number(targetValue) || 0)));
        const current = this.getConditionValue(actor, slug);
        if (current === target) return;

        if (typeof actor?.increaseCondition === "function" && typeof actor?.decreaseCondition === "function") {
            if (target === 0) {
                await actor.decreaseCondition(slug, { forceRemove: true });
            } else if (target > current) {
                await actor.increaseCondition(slug, { value: target - current, max: maxVal });
            } else {
                const steps = current - target;
                for (let i = 0; i < steps; i++) {
                    await actor.decreaseCondition(slug);
                }
            }
            return;
        }

        const existing = (actor?.items ?? []).find(i =>
            i.type === "condition" && (i.slug === slug || i.system?.slug === slug)
        );
        const items = Array.isArray(actor?.items) ? actor.items : null;
        if (target === 0) {
            if (!existing) return;
            if (typeof actor?.deleteEmbeddedDocuments === "function" && existing.id) {
                await actor.deleteEmbeddedDocuments("Item", [existing.id]);
            } else if (items) {
                const idx = items.indexOf(existing);
                if (idx >= 0) items.splice(idx, 1);
            }
            return;
        }
        if (existing) {
            if (typeof existing.update === "function") {
                await existing.update({ "system.value.value": target });
            } else if (typeof actor?.updateEmbeddedDocuments === "function" && existing.id) {
                await actor.updateEmbeddedDocuments("Item", [{ _id: existing.id, "system.value.value": target }]);
            } else {
                existing.system = existing.system ?? {};
                existing.system.value = { ...(existing.system.value ?? {}), value: target };
            }
            return;
        }
        const label = slug.charAt(0).toUpperCase() + slug.slice(1);
        const doc = {
            id: `cond-${slug}`,
            type: "condition",
            name: label,
            system: { slug, value: { isValued: true, value: target } }
        };
        if (typeof actor?.createEmbeddedDocuments === "function") {
            await actor.createEmbeddedDocuments("Item", [doc]);
        } else if (items) {
            items.push(doc);
        }
    }

    async setDrained(actor, targetValue) {
        await this._setValuedCondition(actor, "drained", targetValue, 4);
    }

    async clearWellRestedEffects(actor) {
        const ids = (actor?.items ?? [])
            .filter(i => i.flags?.[MODULE_ID]?.wellRested === true && i.id)
            .map(i => i.id);
        if (!ids.length) return;
        if (typeof actor?.deleteEmbeddedDocuments === "function") {
            await actor.deleteEmbeddedDocuments("Item", ids);
        } else if (Array.isArray(actor?.items)) {
            for (const id of ids) {
                const idx = actor.items.findIndex(i => i.id === id);
                if (idx >= 0) actor.items.splice(idx, 1);
            }
        }
    }

    async applyWellRestedEffect(actor) {
        await this.clearWellRestedEffects(actor);
        const effectDoc = {
            id: "fx-well-rested",
            type: "effect",
            name: "Well-Rested",
            img: "icons/magic/perception/eye-ringed-glow-angry-small-teal.webp",
            system: {
                description: { value: "<p>+1 circumstance bonus to Initiative from Resting Fully in sheltered or safe conditions.</p>" },
                rules: [{
                    key: "FlatModifier",
                    selector: "initiative",
                    type: "circumstance",
                    value: 1,
                    label: "Well-Rested"
                }],
                duration: { value: 24, unit: "hours", sustained: false, expiry: null },
                tokenIcon: { show: true },
                badge: null,
                context: null,
                traits: { value: [] },
                level: { value: 1 },
                start: { value: 0, initiative: null },
                target: null
            },
            flags: {
                [MODULE_ID]: {
                    wellRested: true
                }
            }
        };
        if (typeof actor?.createEmbeddedDocuments === "function") {
            await actor.createEmbeddedDocuments("Item", [effectDoc]);
        } else if (Array.isArray(actor?.items)) {
            actor.items.push(effectDoc);
        }
    }

    isToolProficient(actor, toolKey) {
        if (toolKey === "cook" || toolKey === "cook's utensils") {
            return this.isSkillProficient(actor, "crafting");
        }
        const keyLower = toolKey.toLowerCase();
        return (actor.items ?? []).some(i => {
            if (i.type !== "lore") return false;
            const probe = `${i.flags?.[MODULE_ID]?.toolKey ?? ""} ${i.system?.slug ?? ""} ${i.system?.identifier ?? ""} ${i.name ?? ""}`.toLowerCase();
            return probe.includes(keyLower);
        });
    }

    getCurrency(actor) {
        return actor.system?.currency?.gp ?? 0;
    }

    async deductCurrency(actor, amount) {
        const current = this.getCurrency(actor);
        const next = Math.max(0, current - amount);
        await actor.update({ "system.currency.gp": next });
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

    async applyHDRestore(_actor, _count) {
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

    async triggerNativeRest(actor, restType, recovery = null) {
        if (restType !== "long") return;
        const preserveRespiteState = Boolean(recovery?.pf2eHandled);
        const hpTarget = preserveRespiteState ? this.getHP(actor).value : null;
        const fatiguedTarget = preserveRespiteState ? (this.getExhaustion(actor) > 0) : null;
        const drainedTarget = preserveRespiteState ? this.getDrained(actor) : null;
        const woundedBefore = preserveRespiteState ? this.getConditionValue(actor, "wounded") : 0;

        try {
            if (game.pf2e?.actions?.restForTheNight) {
                await game.pf2e.actions.restForTheNight({ actors: actor, skipDialog: true });
            }
        } catch (err) {
            console.warn("ionrift-respite | PF2eAdapter: restForTheNight() failed:", err);
        }

        if (!preserveRespiteState) return;
        try {
            if (hpTarget != null && this.getHP(actor).value !== hpTarget) {
                await actor.update?.({ "system.attributes.hp.value": hpTarget });
            }
            await this.setFatigued(actor, fatiguedTarget);
            await this.setDrained(actor, drainedTarget);

            if (recovery.pf2eReachedMaxHp && recovery.comfortLevel !== "hostile") {
                if (this.getConditionValue(actor, "wounded") > 0) {
                    await this._setValuedCondition(actor, "wounded", 0, 4);
                }
            } else if (woundedBefore > 0 && this.getConditionValue(actor, "wounded") === 0) {
                await this._setValuedCondition(actor, "wounded", woundedBefore, 4);
            }
        } catch (err) {
            console.warn("ionrift-respite | PF2eAdapter: failed to reconcile post-rest state:", err);
        }
    }

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

    static INCOMPATIBLE = ["act_attune", "act_scribe"];

    filterActivities(activities) {
        return activities.filter(a => !PF2eAdapter.INCOMPATIBLE.includes(a.id));
    }

    getFireCantrips() {
        return [
            "Produce Flame",
            "Ignition",
            "Prestidigitation"
        ];
    }

    getBeddingStatusIds() {
        const conditions = CONFIG.PF2E?.statusEffects?.conditions ?? CONFIG.statusEffects ?? {};
        const statusIds = ["unconscious"];
        if ("prone" in conditions) statusIds.push("prone");
        return statusIds;
    }
}
