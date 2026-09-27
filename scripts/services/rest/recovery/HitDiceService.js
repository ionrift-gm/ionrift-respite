import { Logger } from "../../../utils/Logger.js";
import { HitDieModifiers } from "./HitDieModifiers.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import {
    postRollAndSettle,
    settleAfter
} from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";

/** World setting: homebrew max-face Hit Dice on short rests. */
const MAX_VALUE_HD_KEY = "maxValueHitDice";

/**
 * Pure and controller service for Hit Dice information, spending, and healing modifier resolution.
 * Shared between ShortRestApp and BivouacApp.
 */
export class HitDiceService {

    /**
     * Inspects class items and system attributes to determine remaining and maximum Hit Dice,
     * as well as primary die denomination.
     *
     * @param {Actor} actor
     * @returns {{ remaining: number, max: number, die: number }}
     */
    static getHitDiceInfo(actor) {
        if (!actor) return { remaining: 0, max: 0, die: 8 };

        const classItems = actor.items?.filter(i => i.type === "class") ?? [];

        if (classItems.length) {
            let totalMax = 0;
            let totalUsed = 0;

            for (const cls of classItems) {
                totalMax += cls.system?.levels ?? 0;
                totalUsed += cls.system?.hitDiceUsed ?? cls.system?.hd?.spent ?? 0;
            }

            // Primary die = highest-level class (first if tied)
            const sorted = [...classItems].sort((a, b) =>
                (b.system?.levels ?? 0) - (a.system?.levels ?? 0)
            );
            const rawDie = sorted[0]?.system?.hitDice
                ?? sorted[0]?.system?.hd?.denomination
                ?? "d8";
            const primaryDie = typeof rawDie === "string"
                ? parseInt(rawDie.replace("d", "")) || 8
                : rawDie;

            return {
                remaining: Math.max(0, totalMax - totalUsed),
                max: totalMax,
                die: primaryDie,
            };
        }

        // Fallback: no class items (legacy or unusual actor)
        const hd = actor.system?.attributes?.hd;
        if (hd && typeof hd.value === "number") {
            return { remaining: hd.value, max: hd.max ?? 0, die: 8 };
        }
        const level = actor.system?.details?.level ?? 0;
        const spent = hd?.spent ?? 0;
        return { remaining: Math.max(0, level - spent), max: level, die: 8 };
    }

    /**
     * Finds the denomination string (e.g. "d8", "d10") for actor.rollHitDie().
     *
     * @param {Actor} actor
     * @returns {string}
     */
    static getHdDenomination(actor) {
        if (!actor) return "d8";
        const classItems = actor.items?.filter(i => i.type === "class") ?? [];
        if (classItems.length) {
            const cls = classItems[0];
            const hd = cls.system?.hitDice ?? cls.system?.hd?.denomination ?? cls.hitDice;
            if (typeof hd === "string") return hd;
            if (typeof hd === "number") return `d${hd}`;
        }
        const hd = actor.system?.attributes?.hd;
        if (typeof hd === "string") return hd;
        return "d8";
    }

    /**
     * Rolls a single Hit Die for the actor, applies modifiers (Durable, Periapt, Max-Value homebrew),
     * and adjusts HP if needed.
     *
     * @param {Actor} actor
     * @returns {Promise<{
     *   roll: Roll|null,
     *   rollTotal: number,
     *   adjustedTotal: number,
     *   die: number,
     *   conMod: number,
     *   annotations: string[]
     * }|null>}
     */
    static async spendHitDie(actor) {
        if (!actor) return null;

        const hdData = this.getHitDiceInfo(actor);
        if (hdData.remaining <= 0) {
            ui.notifications?.warn?.(`${actor.name} has no Hit Dice remaining.`);
            return null;
        }

        const hp = actor.system?.attributes?.hp ?? {};
        const hpBefore = hp.value ?? 0;
        const hpMax = hp.effectiveMax ?? hp.max ?? 0;

        let roll;
        try {
            const denom = this.getHdDenomination(actor);
            // modifyHitPoints: false keeps the system from writing HP before the die settles.
            roll = await settleAfter(() => actor.rollHitDie(
                { denomination: denom, modifyHitPoints: false },
                { configure: false }
            ));
        } catch (e) {
            Logger.warn(`rollHitDie failed, trying legacy:`, e);
            try {
                roll = await settleAfter(() => actor.rollHitDie({ dialog: false }));
            } catch (e2) {
                console.error(`${MODULE_ID} | rollHitDie failed entirely:`, e2);
                ui.notifications?.error?.("Could not roll Hit Die. See console for details.");
                return null;
            }
        }

        if (!roll) return null;

        const singleRoll = Array.isArray(roll) ? roll[0] : roll;
        const rollTotal = Number(singleRoll?.total) || 0;

        const conMod = actor.system?.abilities?.con?.mod ?? 0;
        const modifiers = HitDieModifiers.scan(actor);

        let rawDie = rollTotal - conMod;
        const maxHdEnabled = !!game.settings?.get?.(MODULE_ID, MAX_VALUE_HD_KEY);
        const maxOverride = HitDieModifiers.applyMaxValueOverride(maxHdEnabled, rawDie, hdData.die);
        rawDie = maxOverride.rawDie;
        const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(rawDie, conMod, modifiers);
        const mergedAnnotations = [...maxOverride.annotations, ...annotations];

        await HitDiceService.#commitHealing(actor, hpBefore, adjustedTotal, hpMax);

        return {
            roll: singleRoll,
            rollTotal,
            adjustedTotal,
            die: hdData.die,
            conMod,
            annotations: mergedAnnotations
        };
    }

    /**
     * Applies Song of Rest bonus healing to an actor if eligible.
     *
     * @param {Actor} actor
     * @param {{ songDie: string, bardName: string }} songVolunteer
     * @returns {Promise<{ total: number, formula: string, bardName: string }|null>}
     */
    static async applySongBonus(actor, songVolunteer) {
        if (!actor || !songVolunteer?.songDie) return null;

        const songRoll = await HitDiceService.#showDieThenSettle(actor, songVolunteer.songDie, {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>Song of Rest</strong> (${songVolunteer.bardName})`
        });
        if (!songRoll) return null;
        if (songRoll.total > 0) await HitDiceService.#restoreHp(actor, songRoll.total);

        return {
            total: songRoll.total,
            formula: songRoll.formula,
            bardName: songVolunteer.bardName,
        };
    }

    /**
     * Applies Chef Feat Replenishing Meal bonus healing (+1d8) to an actor.
     *
     * @param {Actor} actor
     * @param {{ chefName: string }} chefVolunteer
     * @returns {Promise<{ total: number, formula: string, chefName: string }|null>}
     */
    static async applyChefBonus(actor, chefVolunteer) {
        if (!actor || !chefVolunteer) return null;

        const chefRoll = await HitDiceService.#showDieThenSettle(actor, "1d8", {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>Replenishing Meal</strong> (${chefVolunteer.chefName ?? "Chef"})`
        });
        if (!chefRoll) return null;
        if (chefRoll.total > 0) await HitDiceService.#restoreHp(actor, chefRoll.total);

        return {
            total: chefRoll.total,
            formula: chefRoll.formula,
            chefName: chefVolunteer.chefName,
        };
    }

    /**
     * Applies Warm Camp healing bonus to an actor when spending a Hit Die.
     *
     * @param {Actor} actor
     * @param {string} warmthMode - "1" or "1d4"
     * @returns {Promise<{ total: number, formula: string }|null>}
     */
    static async applyWarmthBonus(actor, warmthMode) {
        if (!actor || !warmthMode || warmthMode === "none") return null;

        let total = 0;
        let formula = "";

        if (warmthMode === "1") {
            total = 1;
            formula = "1";
        } else if (warmthMode === "1d4") {
            const shown = await HitDiceService.#showDieThenSettle(actor, "1d4", {
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `<strong>Warm Campfire Healing</strong>`,
                whisper: game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id)
            });
            if (!shown) return null;
            total = shown.total;
            formula = "1d4";
        } else {
            return null;
        }

        if (total > 0) await HitDiceService.#restoreHp(actor, total);

        return { total, formula };
    }

    /**
     * Post a bonus die and wait for it to settle before the caller writes HP.
     * @param {Actor} actor
     * @param {string} formula
     * @param {object} messageData
     * @returns {Promise<{ total: number, formula: string }|null>}
     */
    static async #showDieThenSettle(actor, formula, messageData) {
        const roll = await new Roll(formula).evaluate();
        try {
            await postRollAndSettle(roll, messageData);
        } catch (err) {
            Logger.warn(`${MODULE_ID} | Bonus die chat failed:`, err);
        }
        return { total: Number(roll.total) || 0, formula: roll.formula };
    }

    /**
     * Write the hit-die total once, after dice have settled.
     * If a legacy roll already wrote HP, only the remaining delta is applied.
     * @param {Actor} actor
     * @param {number} hpBefore
     * @param {number} adjustedTotal
     * @param {number} hpMax
     */
    static async #commitHealing(actor, hpBefore, adjustedTotal, hpMax) {
        const targetHp = Math.min(hpBefore + adjustedTotal, hpMax);
        const hpAdapter = game.ionrift?.respite?.adapter;
        const current = hpAdapter
            ? hpAdapter.getHP(actor).value
            : (actor.system?.attributes?.hp?.value ?? 0);
        if (targetHp === current) return;
        const hpDelta = targetHp - current;
        if (hpAdapter && hpDelta > 0) {
            await hpAdapter.applyHPRestore(actor, hpDelta);
        } else if (hpAdapter && hpDelta < 0) {
            await hpAdapter.applyHPDamage(actor, -hpDelta);
        } else {
            await actor.update({ "system.attributes.hp.value": targetHp });
        }
    }

    /**
     * @param {Actor} actor
     * @param {number} amount
     */
    static async #restoreHp(actor, amount) {
        if (!(amount > 0)) return;
        const hpAdapter = game.ionrift?.respite?.adapter;
        if (hpAdapter) {
            await hpAdapter.applyHPRestore(actor, amount);
            return;
        }
        const hpNow = actor.system?.attributes?.hp;
        if (!hpNow) return;
        const cap = hpNow.effectiveMax ?? hpNow.max ?? 0;
        const newHp = Math.min((hpNow.value ?? 0) + amount, cap);
        await actor.update({ "system.attributes.hp.value": newHp });
    }
}
