import { MODULE_ID } from "../../../data/moduleId.js";

export const WATCH_ALERT_BONUS_DEFAULT = 2;
export const WATCH_ALERT_BONUS_MIN = 1;
export const WATCH_ALERT_BONUS_MAX = 20;

const SURPRISE_PHRASE = /cannot be surprised|immune to surprise|surprise immune/gi;

/**
 * How Keep Watch states the alert benefit.
 * immune: Cannot be surprised. advantage: Advantage. bonus: +N to rolls.
 * @returns {"immune"|"advantage"|"bonus"}
 */
export function getWatchAlertMode() {
    try {
        const raw = game.settings.get(MODULE_ID, "watchAlertMode");
        if (raw === "advantage" || raw === "bonus") return raw;
    } catch {
        /* Setting is absent before registration, or in a headless test. */
    }
    return "immune";
}

/** @returns {number} */
export function getWatchAlertBonus() {
    try {
        const raw = Number(game.settings.get(MODULE_ID, "watchAlertBonus"));
        if (Number.isFinite(raw)) {
            return Math.min(
                WATCH_ALERT_BONUS_MAX,
                Math.max(WATCH_ALERT_BONUS_MIN, Math.round(raw))
            );
        }
    } catch {
        /* Setting is absent before registration, or in a headless test. */
    }
    return WATCH_ALERT_BONUS_DEFAULT;
}

/** Clause on the combat readiness card. */
export function watchAlertCombatLine() {
    const mode = getWatchAlertMode();
    if (mode === "advantage") return "Advantage";
    if (mode === "bonus") return `+${getWatchAlertBonus()} to rolls`;
    return "Cannot be surprised";
}

/** Short clause on the Keep Watch activity card. */
export function watchAlertCardClause() {
    const mode = getWatchAlertMode();
    if (mode === "advantage") return "advantage";
    if (mode === "bonus") return `+${getWatchAlertBonus()} to rolls`;
    return "surprise immune";
}

function replacementFor(match) {
    const mode = getWatchAlertMode();
    if (mode === "bonus") return `+${getWatchAlertBonus()} to rolls`;
    const phrase = "advantage";
    const lead = match.charAt(0);
    if (lead && lead === lead.toUpperCase() && lead !== lead.toLowerCase()) {
        return "Advantage";
    }
    return phrase;
}

/**
 * Rewrite authored surprise-immunity copy when the table uses another benefit.
 * Immune mode leaves the source text alone.
 * @param {string} text
 * @returns {string}
 */
export function applyWatchAlertPhrase(text) {
    if (!text || getWatchAlertMode() === "immune") return text;
    return String(text).replace(SURPRISE_PHRASE, (match) => replacementFor(match));
}

/**
 * Display copy of combat modifiers. Does not mutate the loaded activity.
 * @param {object|null|undefined} mods
 * @returns {object|null}
 */
export function presentCombatModifiers(mods) {
    if (!mods?.description) return mods ?? null;
    const description = applyWatchAlertPhrase(mods.description);
    if (description === mods.description) return mods;
    return { ...mods, description };
}
