import { SystemAdapter } from "./SystemAdapter.js";

/**
 * OSEAdapter: Old-School Essentials support for Ionrift Respite.
 * Uses system.hp and system.scores; no native rest API beyond spell slot refresh.
 */
export class OSEAdapter extends SystemAdapter {

    get id() { return "ose"; }

    // ── Actor Stats ──────────────────────────────────────────

    getHP(actor) {
        const hp = actor.system?.hp;
        return { value: hp?.value ?? 0, max: hp?.max ?? 0 };
    }

    getLevel(actor) {
        return actor.system?.details?.level ?? 0;
    }

    getAbilityMod(actor, key) {
        return actor.system?.scores?.[key]?.mod ?? 0;
    }

    getProficiencyBonus(actor) {
        return 0;
    }

    getSaveBonus(actor, saveKey) {
        const saveMap = {
            str: "death", dex: "breath", con: "death",
            int: "spell", wis: "spell", cha: "spell",
            death: "death", breath: "breath", paralysis: "paralysis",
            spell: "spell", wand: "wand"
        };
        const key = saveMap[saveKey] ?? saveKey;
        return actor.system?.saves?.[key]?.value ?? 0;
    }

    // ── Skills & Checks ──────────────────────────────────────

    normalizeSkillKey(skillKey) { return skillKey; }

    getSkillTotal(actor, skillKey) {
        const scoreMap = {
            ath: "str", acr: "dex", ste: "dex", prc: "wis",
            ins: "wis", inv: "int", arc: "int", his: "int",
            dec: "cha", per: "cha", itm: "cha", sur: "wis"
        };
        const scoreKey = scoreMap[skillKey] ?? skillKey;
        return this.getAbilityMod(actor, scoreKey);
    }

    isSkillProficient(_actor, _skillKey) {
        return false;
    }

    getSkillKeys(_actor) {
        return ["ath", "acr", "ste", "prc", "sur", "dec", "per", "itm", "inv", "arc", "his"];
    }

    getToolProficiencies(_actor) {
        return [];
    }

    // ── Resources ────────────────────────────────────────────

    getHitDice(actor) {
        const level = this.getLevel(actor);
        return { current: level, max: level };
    }

    hasSpellSlots(actor) {
        const spells = actor.system?.spells ?? {};
        return Object.values(spells).some(s => (s?.max ?? 0) > 0);
    }

    getExhaustion(_actor) {
        return 0;
    }

    hasSpellbook(actor) {
        return (actor.items ?? []).some(i => i.type === "spell");
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
            i.type === "armor" && i.system?.equipped
        );
        if (!armor) return null;
        const weight = armor.system?.ac?.type ?? "light";
        return { name: armor.name, weight };
    }

    isToolProficient(_actor, _toolKey) {
        return false;
    }

    // ── Currency ──────────────────────────────────────────────

    getCurrency(actor) {
        const carried = actor.system?.carriedTreasure ?? actor.system?.details?.treasure;
        if (typeof carried === "number") return carried;
        return 0;
    }

    async deductCurrency(_actor, _amount) {
        // OSE tracks treasure on items; no single gp field to deduct.
    }

    // ── Recovery (write-side) ────────────────────────────────

    async applyHPRestore(actor, amount) {
        const hp = actor.system?.hp;
        if (!hp) return;
        const newHp = Math.min(hp.max, hp.value + amount);
        await actor.update({ "system.hp.value": newHp });
    }

    async applyTempHP(_actor, _amount) {
        // OSE has no temp HP track in core data model.
    }

    async applyHDRestore(_actor, _count) {
        // OSE HD recovery is manual via rollHitDice; no spent-HD pool.
    }

    async applyExhaustionDelta(_actor, _delta) {
        // No exhaustion track in OSE core.
    }

    // ── Native Rest ───────────────────────────────────────────

    get hasHookableRest() { return false; }

    getRestHookNames() {
        return { preShort: null, preLong: null, preCompleted: null };
    }

    suppressDefaultRecovery(_result) {
        // No native rest flow to suppress.
    }

    async triggerNativeRest(actor, restType) {
        if (restType !== "long") return;
        const spells = actor.system?.spells;
        if (!spells) return;

        const updates = {};
        for (const [level, data] of Object.entries(spells)) {
            if (data?.max !== undefined) {
                updates[`system.spells.${level}.value`] = data.max;
            }
        }
        if (Object.keys(updates).length) {
            await actor.update(updates);
        }
    }

    // ── Active Effects ────────────────────────────────────────

    getActiveEffectChanges(buffType, params) {
        if (buffType === "temp_hp") {
            return [{
                key: "system.hp.value",
                mode: 2,
                value: String(params.value ?? 0),
                priority: 20
            }];
        }
        return [];
    }

    // ── Activity Filtering ───────────────────────────────────

    filterActivities(activities) {
        return activities.filter(a => a.id !== "act_attune");
    }

    // ── Campfire ─────────────────────────────────────────────

    getFireCantrips() {
        return ["Light"];
    }
}
