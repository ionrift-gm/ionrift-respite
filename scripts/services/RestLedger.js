/**
 * RestLedger: structured audit trail for a rest session.
 * Records every significant event, decision, and outcome during
 * the respite flow so the GM can review "why and how" each phase
 * played out. GM-only, not broadcast to players.
 */

/** @typedef {"setup"|"travel"|"camp"|"activity"|"meal"|"events"|"resolve"} LedgerPhase */

/**
 * @typedef {Object} LedgerEntry
 * @property {string} id           Unique identifier.
 * @property {number} timestamp    Date.now() at creation.
 * @property {LedgerPhase} phase   Rest phase that produced this entry.
 * @property {string} category     Semantic tag for filtering.
 * @property {string|null} actor   Actor id, if entry is character-scoped.
 * @property {string} actorName    Display name (empty for system entries).
 * @property {string} icon         FontAwesome class for the entry row.
 * @property {string} summary      One-line description shown in the list.
 * @property {string} [detail]     Optional longer explanation.
 */

const VALID_PHASES = new Set([
    "setup", "travel", "camp", "activity", "meal", "events", "resolve"
]);

const VALID_CATEGORIES = new Set([
    "terrain", "weather", "shelter", "fire", "comfort", "scouting",
    "activity", "meal", "event", "encounter", "recovery", "override",
    "cold_camp", "meal_rations", "meal_missing", "meal_buff",
    "night_check", "night_pass", "exhaustion"
]);

let _idCounter = 0;

function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    _idCounter += 1;
    return `ledger_${Date.now()}_${_idCounter}`;
}

export class RestLedger {

    /** @type {LedgerEntry[]} */
    #entries = [];

    /**
     * Append an entry to the ledger.
     * @param {Partial<LedgerEntry> & { phase: LedgerPhase, category: string, summary: string }} entry
     * @returns {LedgerEntry} The finalized entry.
     */
    add(entry) {
        const finalized = {
            id: entry.id ?? generateId(),
            timestamp: entry.timestamp ?? Date.now(),
            phase: VALID_PHASES.has(entry.phase) ? entry.phase : "setup",
            category: VALID_CATEGORIES.has(entry.category) ? entry.category : entry.category ?? "override",
            actor: entry.actor ?? null,
            actorName: entry.actorName ?? "",
            icon: entry.icon ?? "fas fa-bookmark",
            summary: entry.summary ?? "",
            detail: entry.detail ?? ""
        };
        this.#entries.push(finalized);
        return finalized;
    }

    /** @returns {LedgerEntry[]} All entries in insertion order. */
    getAll() {
        return [...this.#entries];
    }

    /**
     * @param {LedgerPhase} phase
     * @returns {LedgerEntry[]}
     */
    getByPhase(phase) {
        return this.#entries.filter(e => e.phase === phase);
    }

    /**
     * @param {string} category
     * @returns {LedgerEntry[]}
     */
    getByCategory(category) {
        return this.#entries.filter(e => e.category === category);
    }

    /** @returns {object} Plain-object snapshot safe for JSON serialization. */
    serialize() {
        return { entries: this.#entries.map(e => ({ ...e })) };
    }

    /**
     * Restore from a previously serialized snapshot.
     * @param {object|null} data
     */
    deserialize(data) {
        this.#entries = [];
        if (!data?.entries || !Array.isArray(data.entries)) return;
        for (const raw of data.entries) {
            this.#entries.push({
                id: raw.id ?? generateId(),
                timestamp: raw.timestamp ?? 0,
                phase: raw.phase ?? "setup",
                category: raw.category ?? "override",
                actor: raw.actor ?? null,
                actorName: raw.actorName ?? "",
                icon: raw.icon ?? "fas fa-bookmark",
                summary: raw.summary ?? "",
                detail: raw.detail ?? ""
            });
        }
    }

    /** Remove all entries. */
    clear() {
        this.#entries = [];
    }

    /** @returns {number} Total entry count. */
    get length() {
        return this.#entries.length;
    }

    /**
     * Build ledger-entry fields from a MealApplicationService result.
     * Returns null for exempt characters (sustenance not required).
     * @param {object} r - Single result from applyMealChoices
     * @returns {Partial<LedgerEntry>|null}
     */
    static formatMealEntry(r) {
        if (r.exempt) return null;

        const foodNeeded = r.foodConsumed + r.foodShortfall;
        const waterNeeded = r.waterConsumed + r.waterShortfall;
        const fullyFed = r.foodShortfall === 0 && r.waterShortfall === 0;
        const partiallyFed = !fullyFed && (r.ate || r.drank);

        let summary;
        let category;
        let icon;
        if (fullyFed) {
            summary = "Fed";
            category = "meal_rations";
            icon = "fas fa-utensils";
        } else if (partiallyFed) {
            const short = [];
            if (r.foodShortfall > 0) short.push("food");
            if (r.waterShortfall > 0) short.push("water");
            summary = `Partially fed (short on ${short.join(" and ")})`;
            category = "meal_missing";
            icon = "fas fa-utensils";
        } else {
            summary = "Went hungry";
            category = "meal_missing";
            icon = "fas fa-exclamation-triangle";
        }

        const detailParts = [];
        if (fullyFed) {
            if (r.foodConsumed > 0) detailParts.push(`Food: ${r.foodConsumed}`);
            if (r.waterConsumed > 0) detailParts.push(`Water: ${r.waterConsumed}`);
        } else {
            if (foodNeeded > 0) detailParts.push(`Food: ${r.foodConsumed}/${foodNeeded}`);
            if (waterNeeded > 0) detailParts.push(`Water: ${r.waterConsumed}/${waterNeeded}`);
        }
        if (r.starvationExhaustion > 0) {
            detailParts.push(`+${r.starvationExhaustion} exhaustion (starvation)`);
        }
        if (r.dehydrationSaveDC > 0) {
            detailParts.push(`CON save DC ${r.dehydrationSaveDC}`);
        }
        if (r.dehydrationAutoFail) {
            detailParts.push(`Dehydration (auto-fail)`);
        }

        return {
            phase: "meal",
            category,
            icon,
            actor: r.characterId ?? null,
            actorName: r.actorName ?? "",
            summary,
            detail: detailParts.join(", ")
        };
    }

    /**
     * Produces a dedicated exhaustion ledger entry when starvation or
     * dehydration inflicts exhaustion during the meal phase.
     * Returns null if no exhaustion was applied.
     * @param {object} r - Single result from applyMealChoices
     * @returns {Partial<LedgerEntry>|null}
     */
    static formatMealExhaustionEntry(r) {
        if (r.exempt) return null;

        let levels = 0;
        const reasons = [];

        if (r.starvationExhaustion > 0) {
            levels += r.starvationExhaustion;
            reasons.push(`starvation (+${r.starvationExhaustion})`);
        }
        if (r.dehydrationAutoFail) {
            levels += 1;
            reasons.push("dehydration auto-fail (+1)");
        }

        if (levels === 0) return null;

        return {
            phase: "meal",
            category: "exhaustion",
            icon: "fas fa-tired",
            actor: r.characterId ?? null,
            actorName: r.actorName ?? "",
            summary: `+${levels} exhaustion`,
            detail: reasons.join(", ")
        };
    }
}
