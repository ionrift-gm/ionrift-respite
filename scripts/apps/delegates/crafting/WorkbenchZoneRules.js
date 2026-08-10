/**
 * Pure workbench Examine zone rules (Focus / Taste / Identify).
 * Citations: Identifying a Magic Item, DMG p.136; Identify spell PHB 2024 p.287;
 * Wizard Ritual Adept PHB 2024 p.115.
 */

/**
 * @param {{ zone: "gear"|"potion"|"spell", isPotion: boolean }} opts
 * @returns {{ ok: boolean, msg?: string }}
 */
export function validateWorkbenchZoneDrop({ zone, isPotion }) {
    if (zone === "gear") {
        if (isPotion) {
            return { ok: false, msg: "Drop potions onto the Taste circle." };
        }
        return { ok: true };
    }
    if (zone === "potion") {
        if (!isPotion) {
            return { ok: false, msg: "Drop that item onto the Focus circle." };
        }
        return { ok: true };
    }
    if (zone === "spell") {
        return { ok: true };
    }
    return { ok: false, msg: "Unknown workbench zone." };
}

/**
 * Focus: one non-potion item per rest (DMG p.136).
 * @param {{ focusUsed: boolean }} opts
 * @returns {{ ok: boolean, msg?: string }}
 */
export function canStageFocus({ focusUsed }) {
    if (focusUsed) {
        return { ok: false, msg: "Focus identify already used this rest for this character." };
    }
    return { ok: true };
}

/**
 * Identify spell drop zone: available caster or GM.
 * @param {{ identifyAvailable: boolean, isGm?: boolean }} opts
 * @returns {{ ok: boolean, msg?: string }}
 */
export function canStageIdentify({ identifyAvailable, isGm = false }) {
    if (identifyAvailable || isGm) return { ok: true };
    return { ok: false, msg: "Requires the Identify spell." };
}

/**
 * Taste and Identify spell paths are repeatable in the same rest.
 * Focus is not (see canStageFocus).
 * @param {"focus"|"taste"|"identify"} intent
 * @returns {boolean}
 */
export function isIntentRepeatableInRest(intent) {
    return intent === "taste" || intent === "identify";
}
