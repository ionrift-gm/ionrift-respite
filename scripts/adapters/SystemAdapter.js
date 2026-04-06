/**
 * SystemAdapter – Abstract base class for system-specific data access.
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

    // ── Skills & Checks ──────────────────────────────────────

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
     * @param {string} name – item name to search (case-insensitive)
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

    // ── Recovery (write-side) ────────────────────────────────

    /** @returns {Promise} */
    async applyHPRestore(actor, amount) { this._notImpl("applyHPRestore"); }

    /** @returns {Promise} */
    async applyHDRestore(actor, count) { this._notImpl("applyHDRestore"); }

    /** @returns {Promise} */
    async applyExhaustionDelta(actor, delta) { this._notImpl("applyExhaustionDelta"); }

    // ── Hooks ────────────────────────────────────────────────

    /** @returns {{ preShort: string, preLong: string, preCompleted: string }} */
    getRestHookNames() { this._notImpl("getRestHookNames"); }

    /** Mutate the system rest result to prevent default HP/HD recovery */
    suppressDefaultRecovery(result) { this._notImpl("suppressDefaultRecovery"); }

    // ── Activity Filtering ───────────────────────────────────

    /**
     * Remove activities that are incompatible with the current system.
     * @param {Object[]} activities
     * @returns {Object[]}
     */
    filterActivities(activities) { return activities; }

    // ── Campfire ─────────────────────────────────────────────

    /**
     * Returns cantrip names that can light a campfire.
     * System-specific: override in concrete adapters.
     * @returns {string[]}
     */
    getFireCantrips() { return []; }

    // ── Internal ─────────────────────────────────────────────

    /** @private */
    _notImpl(method) {
        throw new Error(`SystemAdapter.${method}() not implemented for ${this.id}`);
    }
}
