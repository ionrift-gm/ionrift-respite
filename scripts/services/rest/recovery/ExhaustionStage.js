import { isPf2eSystem } from "../../camp/gear/Pf2eComfortRules.js";

/**
 * Dawn exhaustion check shared by the normal rest close.
 * Gritty downtime keeps its own ledger copy of the same save.
 * A rolled result is stamped onto recovery so RecoveryHandler
 * does not roll the Constitution save a second time.
 */

export function exhaustionReason(comfortLevel, mustRoll, saveBonus = 0) {
    const pf2e = isPf2eSystem();
    if (!mustRoll) return pf2e ? "No Fortitude save." : "No exhaustion save.";
    if (pf2e) {
        const bonusNote = saveBonus > 0 ? ` (+${saveBonus} circumstance from mess kit)` : "";
        if (comfortLevel === "hostile") return `Hostile ground. Fortitude save or Fatigued / Drained${bonusNote}.`;
        if (comfortLevel === "rough") return `Rough camp. Fortitude save or Fatigued${bonusNote}.`;
        return `Fortitude save or Fatigued${bonusNote}.`;
    }
    if (comfortLevel === "hostile") return "Hostile ground. Constitution save or gain exhaustion.";
    if (comfortLevel === "rough") return "Rough camp. Constitution save or gain exhaustion.";
    return "Constitution save or gain exhaustion.";
}

/**
 * @param {Actor} actor
 * @param {{ exhaustionDC?: number|null, exhaustionAdvantage?: boolean, exhaustionSaveBonus?: number, comfortLevel?: string }} preview
 */
export function createExhaustionEntry(actor, preview = {}) {
    const dc = preview.exhaustionDC ?? null;
    const mustRoll = dc != null;
    const saveBonus = preview.exhaustionSaveBonus ?? 0;
    return {
        actorId: actor.id,
        mustRoll,
        waived: !mustRoll,
        advMode: preview.exhaustionAdvantage ? "adv" : "norm",
        saveBonus,
        dc: dc ?? 10,
        reason: exhaustionReason(preview.comfortLevel ?? "safe", mustRoll, saveBonus),
        rolled: false,
        rollTotal: null,
        d20Value: null,
        saveDegree: null,
        passed: null
    };
}

/**
 * @param {object} recovery
 * @param {object} entry
 */
export function stampExhaustionRecovery(recovery, entry) {
    if (!recovery || !entry) return;
    if (!entry.mustRoll || entry.waived) {
        recovery.exhaustionAdjudicated = true;
        recovery.exhaustionSaveResult = "waived";
        recovery.exhaustionSaveDegree = null;
        return;
    }
    if (!entry.rolled) return;
    recovery.exhaustionAdjudicated = true;
    recovery.exhaustionDC = entry.dc;
    recovery.exhaustionAdvantage = entry.advMode === "adv";
    if (typeof entry.saveBonus === "number") {
        recovery.exhaustionSaveBonus = entry.saveBonus;
    }
    recovery.exhaustionSaveResult = entry.passed ? "passed" : "failed";
    recovery.exhaustionSaveDegree = entry.saveDegree ?? null;
    recovery.exhaustionSaveTotal = entry.rollTotal ?? null;
}

export function exhaustionSummary(entries = []) {
    const pending = entries.filter(entry => entry.mustRoll && !entry.rolled).length;
    return {
        total: entries.length,
        pending,
        failed: entries.filter(entry => entry.rolled && !entry.passed).length,
        passed: entries.filter(entry => entry.rolled && entry.passed).length,
        waived: entries.filter(entry => entry.waived || !entry.mustRoll).length,
        allSettled: pending === 0
    };
}

export function conSaveBonus(actor) {
    const adapter = globalThis.game?.ionrift?.respite?.adapter;
    if (isPf2eSystem(adapter) && adapter?.getSaveBonus) {
        return adapter.getSaveBonus(actor, "con");
    }
    try {
        const fromRollData = actor.getRollData?.()?.abilities?.con?.save;
        if (typeof fromRollData === "number") return fromRollData;
    } catch { /* roll data unavailable */ }
    if (adapter?.getSaveBonus) return adapter.getSaveBonus(actor, "con");
    const mod = actor.system?.abilities?.con?.mod ?? 0;
    const prof = actor.system?.attributes?.prof ?? 0;
    const proficient = actor.system?.abilities?.con?.proficient ?? 0;
    return mod + (proficient > 0 ? prof : 0);
}
