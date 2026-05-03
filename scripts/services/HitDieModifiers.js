/**
 * Pure logic for Hit Die healing modifiers (Durable, Periapt of Wound Closure, Song of Rest).
 * No UI or DOM dependencies.
 */
export class HitDieModifiers {

    /**
     * @param {Actor} actor
     * @returns {{ hasDurable: boolean, hasPeriapt: boolean, conMod: number }}
     */
    static scan(actor) {
        const items = actor.items ?? [];
        const conMod = actor.system?.abilities?.con?.mod ?? 0;

        const hasDurable = items.some(i =>
            i.type === "feat" && HitDieModifiers.#isDurableFeatName(i.name)
        );

        const hasPeriapt = items.some(i => HitDieModifiers.#isAttunedPeriaptOfWoundClosure(i));

        return { hasDurable, hasPeriapt, conMod };
    }

    /**
     * PHB "Durable" only — not compound names like "Durable Summons".
     * @param {string} [name]
     * @returns {boolean}
     */
    static #isDurableFeatName(name) {
        if (!name || typeof name !== "string") return false;
        return name.trim().toLowerCase() === "durable";
    }

    /**
     * @param {Item} item
     * @returns {boolean}
     */
    static #isAttunedPeriaptOfWoundClosure(item) {
        const lowerName = (item.name?.toLowerCase() ?? "").replace(/\u00a0/g, " ");
        if (!lowerName.includes("periapt") || !lowerName.includes("wound") || !lowerName.includes("closure")) {
            return false;
        }
        return HitDieModifiers.#isItemAttuned(item);
    }

    /**
     * dnd5e v4+: {@code system.attuned} is a boolean (the actual attunement state).
     * {@code system.attunement} is a string ("required"/"optional"/"") — the requirement, not the state.
     * Legacy builds used numeric {@code system.attunement} (ATTUNED=2) or string {@code "attuned"}.
     * @param {Item} item
     * @returns {boolean}
     */
    static #isItemAttuned(item) {
        // Modern dnd5e v4+: attuned is a boolean on the item data.
        if (item.system?.attuned === true) return true;
        // Legacy fallbacks for older dnd5e builds:
        const att = item.system?.attunement;
        if (att === "attuned") return true;
        // Legacy numeric enum: ATTUNED = 2
        if (typeof att === "number" && att === 2) return true;
        return false;
    }

    /**
     * @param {number} dieResult Raw die total (no CON)
     * @param {number} conMod CON modifier
     * @param {{ hasDurable: boolean, hasPeriapt: boolean, conMod?: number }} modifiers From {@link HitDieModifiers.scan}
     * @returns {{ adjustedTotal: number, annotations: string[] }}
     */
    static modifyRoll(dieResult, conMod, modifiers) {
        const annotations = [];
        let die = dieResult;

        if (modifiers.hasPeriapt) {
            die *= 2;
            annotations.push("Periapt ×2");
        }

        let total = die + conMod;
        const durableFloor = 2 * conMod;

        if (modifiers.hasDurable && total < durableFloor) {
            total = durableFloor;
            annotations.push(`Durable (min ${durableFloor})`);
        }

        return { adjustedTotal: total, annotations };
    }

    /**
     * Homebrew: treat the Hit Die as having rolled its maximum face during short rests.
     * Does not apply CON or item modifiers; callers pass the rolled die-only total and merge annotations.
     *
     * @param {boolean} enabled True when world setting maxValueHitDice is enabled
     * @param {number} rawDie Rolled die total excluding CON (typically roll total minus CON mod)
     * @param {number} dieMaxFace Maximum die face (e.g. 10 for a d10)
     * @returns {{ rawDie: number, annotations: string[] }}
     */
    static applyMaxValueOverride(enabled, rawDie, dieMaxFace) {
        if (!enabled) return { rawDie, annotations: [] };
        const maxFace = Number(dieMaxFace);
        if (!Number.isFinite(maxFace) || maxFace <= 0) return { rawDie, annotations: [] };
        return { rawDie: maxFace, annotations: ["Max HD (homebrew)"] };
    }

    /**
     * @param {Actor[]} actors
     * @returns {{ hasBard: boolean, bardName: string, bardLevel: number, songDie: string|null }}
     */
    static scanPartyForSongOfRest(actors) {
        let best = { level: 0, name: "" };

        for (const actor of actors ?? []) {
            const classes = actor.items?.filter(i => i.type === "class") ?? [];
            for (const cls of classes) {
                const clsName = cls.name?.toLowerCase() ?? "";
                if (!/\bbard\b/.test(clsName)) continue;
                const levels = cls.system?.levels ?? 0;
                if (levels < 2) continue;
                if (levels > best.level) {
                    best = { level: levels, name: actor.name ?? "" };
                }
            }
        }

        if (best.level < 2) {
            return { hasBard: false, bardName: "", bardLevel: 0, songDie: null };
        }

        return {
            hasBard: true,
            bardName: best.name,
            bardLevel: best.level,
            songDie: HitDieModifiers.getSongDie(best.level),
        };
    }

    /**
     * @param {number} bardLevel
     * @returns {string|null}
     */
    static getSongDie(bardLevel) {
        if (bardLevel < 2) return null;
        if (bardLevel <= 8) return "1d6";
        if (bardLevel <= 12) return "1d8";
        if (bardLevel <= 16) return "1d10";
        return "1d12";
    }

    /**
     * Returns all party members who qualify as Song of Rest bards (bard class level 2+).
     * @param {Actor[]} actors
     * @returns {Array<{ actorId: string, bardName: string, bardLevel: number, songDie: string }>}
     */
    static scanAllEligibleBards(actors) {
        const bards = [];
        for (const actor of actors ?? []) {
            const classes = actor.items?.filter(i => i.type === "class") ?? [];
            for (const cls of classes) {
                const clsName = cls.name?.toLowerCase() ?? "";
                if (!/\bbard\b/.test(clsName)) continue;
                const levels = cls.system?.levels ?? 0;
                if (levels < 2) continue;
                bards.push({
                    actorId: actor.id,
                    bardName: actor.name ?? "",
                    bardLevel: levels,
                    songDie: HitDieModifiers.getSongDie(levels),
                });
            }
        }
        return bards;
    }

    /**
     * @param {string} songDie e.g. "1d6"
     * @param {string} bardName Bard or party context (reserved for future use)
     * @returns {Promise<{ total: number, formula: string }>}
     */
    static async rollSongBonus(songDie, bardName) {
        const roll = new Roll(songDie);
        await roll.evaluate();
        return { total: Number(roll.total) || 0, formula: roll.formula };
    }
}
