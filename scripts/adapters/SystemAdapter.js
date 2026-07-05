/**
 * SystemAdapter: Abstract base class for system-specific data access.
 *
 * Respite's core logic (rest flow, activities, crafting, recovery) calls
 * adapter methods instead of touching actor.system directly.  Each game
 * system gets its own concrete subclass.
 *
 * @abstract
 */
export class SystemAdapter {

    /** @returns {string} System identifier, e.g. "dnd5e", "pf2e", "daggerheart" */
    get id() { throw new Error("SystemAdapter.id not implemented"); }

    // ── Actor Stats ──────────────────────────────────────────

    /** @returns {{ value: number, max: number }} */
    getHP(actor) { this._notImpl("getHP"); }

    /** @returns {number} Character level */
    getLevel(actor) { this._notImpl("getLevel"); }

    /** @returns {number} Ability modifier for the given key (e.g. "str") */
    getAbilityMod(actor, key) { this._notImpl("getAbilityMod"); }

    /** @returns {number} Proficiency bonus */
    getProficiencyBonus(actor) { this._notImpl("getProficiencyBonus"); }

    /**
     * Total saving throw bonus for a given save key.
     * DnD5e: "con", "dex", etc. PF2e: "fortitude", "reflex", "will".
     * @param {Actor} actor
     * @param {string} saveKey
     * @returns {number}
     */
    getSaveBonus(actor, saveKey) { this._notImpl("getSaveBonus"); }

    // ── Skills & Checks ──────────────────────────────────────

    /**
     * Translate a system-agnostic or DnD5e skill abbreviation into the
     * key used by the active system. Pass-through if already native.
     * @param {string} skillKey - e.g. "sur", "survival", "prc"
     * @returns {string} The native skill key for the active system
     */
    normalizeSkillKey(skillKey) { return skillKey; }

    /** @returns {number} Total skill modifier */
    getSkillTotal(actor, skillKey) { this._notImpl("getSkillTotal"); }

    /** @returns {boolean} Whether the actor is proficient in the skill */
    isSkillProficient(actor, skillKey) { this._notImpl("isSkillProficient"); }

    /** @returns {string[]} All skill keys the actor has */
    getSkillKeys(actor) { this._notImpl("getSkillKeys"); }

    // ── Resources ────────────────────────────────────────────

    /** @returns {{ current: number, max: number }} Hit dice or equivalent recovery resource */
    getHitDice(actor) { this._notImpl("getHitDice"); }

    /** @returns {boolean} Whether the actor has any spell slots or equivalent */
    hasSpellSlots(actor) { this._notImpl("hasSpellSlots"); }

    /** @returns {number} Exhaustion level (0-6 for 5e, or equivalent) */
    getExhaustion(actor) { this._notImpl("getExhaustion"); }


    // ── Equipment & Inventory ────────────────────────────────

    /**
     * @param {string} name - item name to search (case-insensitive)
     * @returns {Object|null} The found item, or null
     */
    findItemByName(actor, name) { this._notImpl("findItemByName"); }

    /** @returns {boolean} */
    hasItemByName(actor, name) { this._notImpl("hasItemByName"); }

    /**
     * @returns {{ name: string, weight: string }|null}
     * weight is "light", "medium", or "heavy"
     */
    getEquippedArmor(actor) { this._notImpl("getEquippedArmor"); }

    /** @returns {boolean} Whether the actor is proficient with the given tool */
    isToolProficient(actor, toolKey) { this._notImpl("isToolProficient"); }

    // ── Currency ──────────────────────────────────────────────

    /**
     * @returns {number} Gold pieces (or equivalent primary currency).
     */
    getCurrency(actor) { this._notImpl("getCurrency"); }

    /**
     * Deduct gold (or equivalent) from the actor.
     * @param {Actor} actor
     * @param {number} amount
     * @returns {Promise}
     */
    async deductCurrency(actor, amount) { this._notImpl("deductCurrency"); }

    // ── Recovery (write-side) ────────────────────────────────

    /** @returns {Promise} */
    async applyHPRestore(actor, amount) { this._notImpl("applyHPRestore"); }

    /**
     * Apply HP damage (reduce HP by amount, floor at 0).
     * @param {Actor} actor
     * @param {number} amount - positive damage value
     * @returns {Promise}
     */
    async applyHPDamage(actor, amount) {
        const hp = this.getHP(actor);
        const delta = -Math.min(amount, hp.value);
        if (delta !== 0) await this.applyHPRestore(actor, delta);
    }

    /** @returns {Promise} */
    async applyHDRestore(actor, count) { this._notImpl("applyHDRestore"); }

    /** @returns {Promise} */
    async applyExhaustionDelta(actor, delta) { this._notImpl("applyExhaustionDelta"); }

    /**
     * Apply temporary HP to the actor. Only sets if new value exceeds current.
     * @param {Actor} actor
     * @param {number} amount
     * @returns {Promise}
     */
    async applyTempHP(actor, amount) { this._notImpl("applyTempHP"); }

    // ── Native Rest ───────────────────────────────────────────

    /** @returns {{ preShort: string|null, preLong: string|null, preCompleted: string|null }} */
    getRestHookNames() { this._notImpl("getRestHookNames"); }

    /** Mutate the system rest result to prevent default HP/HD recovery */
    suppressDefaultRecovery(result) { this._notImpl("suppressDefaultRecovery"); }

    /**
     * Whether the system exposes hookable rest events that Respite can intercept.
     * If false, Respite skips hook-based suppression and calls triggerNativeRest() directly.
     * @returns {boolean}
     */
    get hasHookableRest() { return true; }

    /**
     * Trigger the system's native rest for spell slots, feature recovery, etc.
     * @param {Actor} actor
     * @param {"long"|"short"} restType
     * @returns {Promise}
     */
    async triggerNativeRest(actor, restType) { this._notImpl("triggerNativeRest"); }

    // ── Active Effects ────────────────────────────────────────

    /**
     * Build system-appropriate ActiveEffect changes for a buff type.
     * @param {"temp_hp"|"advantage"|"resistance"} buffType
     * @param {Object} params - buff-specific parameters
     * @returns {Object[]} Array of AE change objects { key, mode, value, priority }
     */
    getActiveEffectChanges(buffType, params) { return []; }

    // ── Activity Filtering ───────────────────────────────────

    /**
     * Remove activities that are incompatible with the current system.
     * @param {Object[]} activities
     * @returns {Object[]}
     */
    filterActivities(activities) { return activities; }

    /**
     * Whether the actor has a spellbook (Wizard) or equivalent.
     * Used to gate spell-copying activities.
     * @param {Actor} actor
     * @returns {boolean}
     */
    hasSpellbook(actor) { return false; }

    /**
     * Whether the actor is a spellcaster (has any spell slots or casting entries).
     * @param {Actor} actor
     * @returns {boolean}
     */
    isSpellcaster(actor) { return this.hasSpellSlots(actor); }

    /**
     * Returns proficient skill keys for the actor.
     * @param {Actor} actor
     * @returns {string[]}
     */
    getProficientSkillKeys(actor) {
        return this.getSkillKeys(actor).filter(k => this.isSkillProficient(actor, k));
    }

    /**
     * Returns tool proficiency keys for the actor.
     * @param {Actor} actor
     * @returns {string[]}
     */
    getToolProficiencies(actor) { return []; }

    // ── Campfire ─────────────────────────────────────────────

    /**
     * Returns cantrip names that can light a campfire.
     * System-specific: override in concrete adapters.
     * @returns {string[]}
     */
    getFireCantrips() { return []; }

    // ── Bedding Down ─────────────────────────────────────────

    /**
     * Status or condition slugs applied when the camp beds down for the night.
     * First entry is the primary overlay; remaining entries are secondary posture cues.
     * @returns {string[]}
     */
    getBeddingStatusIds() {
        const raw = CONFIG.statusEffects ?? [];
        const all = Array.isArray(raw) ? raw : Object.values(raw);
        const has = (id) => all.some(e => e.id === id);
        const primary = has("incapacitated") ? "incapacitated"
            : (has("unconscious") ? "unconscious" : "incapacitated");
        const statusIds = [primary];
        if (has("prone")) statusIds.push("prone");
        return statusIds;
    }

    // ── Internal ─────────────────────────────────────────────

    /** @private */
    _notImpl(method) {
        throw new Error(`SystemAdapter.${method}() not implemented for ${this.id}`);
    }
}
