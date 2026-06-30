/**
 * Meal buff resolution: dispatch to registered handlers (with stub fallback),
 * preview labels, dnd5e duration hints, and Active Effect change building for
 * deferred buffs.
 */

import {
    dispatchMealBuffHandler,
    getMealBuffHandler,
    warnUnknownMealBuffType
} from "./MealBuffHandlerRegistry.js";
import { rollBuffFormula, rollForChat } from "./MealBuffResolveHelpers.js";
import { resolveStubMealBuff } from "./MealBuffStubFallback.js";
import { cookingAeChanges, localAeChanges } from "./CookingBuffBridge.js";

/** @private */
export function isKnownStubBuffType(type) {
    return ["temp_hp", "heal", "exhaustion_save", "hit_die", "advantage", "resistance"].includes(type);
}

/**
 * @returns {Promise<{ summary: string|null, roll: Roll|null }|null>}
 */
export async function resolveBuff(actor, buff, { chatDetail = false } = {}) {
    if (!buff?.type) return null;

    if (getMealBuffHandler(buff.type)) {
        return dispatchMealBuffHandler(actor, buff, { chatDetail });
    }

    const stubResult = await resolveStubMealBuff(actor, buff, { chatDetail });
    if (stubResult !== null || isKnownStubBuffType(buff.type)) {
        return stubResult;
    }

    warnUnknownMealBuffType(buff.type);
    return null;
}

export function buffSummaryLabel(buff) {
    if (!buff?.type) return "";

    const handler = getMealBuffHandler(buff.type);
    if (handler?.preview) {
        try {
            const preview = handler.preview(buff);
            if (typeof preview === "string" && preview.trim()) return preview;
        } catch {
            // fall through to legacy labels
        }
    }

    if (buff.type === "temp_hp") return `temp HP (${buff.formula ?? "?"})`;
    if (buff.type === "heal") return `healing (${buff.formula ?? "?"})`;
    if (buff.type === "advantage") {
        const ab = buff.save?.ability ?? buff.formula ?? "con";
        return `advantage on ${String(ab).toUpperCase()} saves (${buff.duration ?? "nextSave"})`;
    }
    if (buff.type === "resistance") {
        const dt = buff.damageType ?? buff.formula ?? "?";
        return `resistance (${dt}, ${buff.duration ?? "untilLongRest"})`;
    }
    return buff.type;
}

/**
 * Map duration tag to dnd5e ActiveEffect hints (best-effort across system versions).
 *
 * specialDuration is intentionally omitted here. Eating happens before native
 * longRest()/shortRest() runs, so setting specialDuration at creation time would
 * cause DAE to strip the AE the moment the rest fires, before recovery is
 * visible to the player. stampWellFedDuration() adds the correct DAE specialDuration
 * after longRest() completes, so it only triggers on the NEXT rest.
 */
export function wellFedDnd5eDurationFlags(durationTag) {
    const out = { duration: {}, effectFlags: {}, manualNote: "" };
    const durationAdapter = game.ionrift?.respite?.adapter;
    if ((durationAdapter && durationAdapter.id !== "dnd5e") || (!durationAdapter && game.system.id !== "dnd5e")) {
        out.manualNote = "Remove this Well Fed effect when the listed rest ends (or replace with another meal).";
        return out;
    }
    if (durationTag === "untilLongRest" || durationTag === "untilShortRest") {
        // No specialDuration on creation. stampWellFedDuration() sets it post-rest.
        foundry.utils.mergeObject(out.effectFlags, {
            dnd5e: { duration: { type: "none" } }
        });
        return out;
    }
    if (durationTag === "nextSave" || durationTag === "nextCheck") {
        out.manualNote = "Expires after the next qualifying save (remove manually if needed).";
        return out;
    }
    out.manualNote = "Remove when the buff would end per the recipe.";
    return out;
}

/**
 * Build ActiveEffect change list for deferred (non-immediate) buffs.
 */
export async function buffToActiveEffectPartsAsync(actor, buff) {
    const changes = [];
    const descriptions = [];
    if (!buff?.type) return { changes, description: "" };

    if (buff.type === "temp_hp") {
        const { total, roll } = await rollBuffFormula(actor, buff.formula);
        if (total <= 0) return { changes, description: "" };
        const aeAdapter = game.ionrift?.respite?.adapter;
        const aeChanges = aeAdapter
            ? aeAdapter.getActiveEffectChanges("temp_hp", { value: total })
            : [{ key: "system.attributes.hp.temp", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: String(total), priority: 20 }];
        changes.push(...aeChanges);
        if (aeChanges.length) descriptions.push(`Temporary hit points: ${total}.`);
        return {
            changes,
            description: descriptions.join(" "),
            summaryLine: `temp HP +${total}`,
            roll: rollForChat(roll)
        };
    }

    if (buff.type === "advantage") {
        const ab = (buff.save?.ability ?? buff.formula ?? "con").toLowerCase();
        const aeChanges = cookingAeChanges({ type: "advantage", save: { ability: ab }, duration: buff.duration }, actor)
            ?? localAeChanges("advantage", { ability: ab });
        changes.push(...aeChanges);
        descriptions.push(
            `Advantage on ${ab.toUpperCase()} saving throws (${buff.duration ?? "nextSave"}).`
        );
        const daeSpecialDuration = [];
        if (buff.duration === "nextSave") {
            daeSpecialDuration.push(`isSave.${ab}`);
        }
        const summaryLine = `advantage on ${ab.toUpperCase()} saves (${buff.duration ?? "nextSave"})`;
        return { changes, description: descriptions.join(" "), daeSpecialDuration, summaryLine };
    }

    if (buff.type === "resistance") {
        const dtype = String(buff.damageType ?? buff.formula ?? "poison").toLowerCase();
        const aeChanges = cookingAeChanges({ type: "resistance", damageType: dtype }, actor)
            ?? localAeChanges("resistance", { damageType: dtype });
        changes.push(...aeChanges);
        descriptions.push(
            `Damage resistance (${dtype}).`
        );
        const summaryLine = `resistance (${dtype})`;
        return { changes, description: descriptions.join(" "), daeSpecialDuration: [], summaryLine };
    }

    return { changes, description: "", daeSpecialDuration: [] };
}
