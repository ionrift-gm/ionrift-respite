import { SpoilageClock } from "../../services/meal/spoilage/SpoilageClock.js";
import { waterGlassFromPints } from "../../services/meal/phase/SustenanceEditPlan.js";
import { normalizeBeverageClass } from "../../services/meal/phase/MealOptionBuilder.js";

export function tipEsc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** Short HTML tooltip: a title plus one fact per line. */
export function bulletTip(title, lines) {
    const items = (lines ?? []).filter(Boolean).map(line => `<li>${tipEsc(line)}</li>`).join("");
    const head = title ? `<div class='tooltip-title'>${tipEsc(title)}</div>` : "";
    return `<div class='ledger-tip'>${head}<ul>${items}</ul></div>`;
}

export const GATHERING_DAYS = 7;

export function emptyGatherDay(day, mode = "forage") {
    return {
        day,
        mode,
        rolled: false,
        rollTotal: null,
        dc: null,
        success: null,
        yield: 0
    };
}

export function normalizeGatheringSchedule(existing, defaultMode = "forage") {
    const byDay = new Map((Array.isArray(existing) ? existing : []).map(entry => [entry.day, entry]));
    return Array.from({ length: GATHERING_DAYS }, (_, i) => {
        const day = i + 1;
        const prev = byDay.get(day);
        if (prev) return { ...emptyGatherDay(day, prev.mode ?? defaultMode), ...prev, day };
        return emptyGatherDay(day, day === 7 ? "skip" : defaultMode);
    });
}

/**
 * Build the `sustenanceDiegetic` context consumed by
 * `templates/partials/sustenance-diegetic.hbs`. Maps existing per-character
 * sustenance data into the mock's two-column pile / vessel shape.
 */
export function buildSustenanceDiegetic({
    actorId, foodFlow, waterFlow, foodDailyPips, waterDailyPips,
    selectedDepartureMeal, selectedDepartureDrink,
    departureFoodOptions, departureDrinkOptions,
    climateLabel, climateTooltip, isTraitPill,
    waterNeedPerDay, mealsLocked, canUnlock
}) {
    const foodBudgetDone = !foodFlow?.isShort;
    const waterBudgetDone = !waterFlow?.isShort;
    const itemArt = new Map();
    const spoilById = new Map();
    for (const option of [...(departureFoodOptions ?? []), ...(departureDrinkOptions ?? [])]) {
        if (option?.id && option.img) itemArt.set(option.id, option.img);
        if (option?.id && option.perishable) spoilById.set(option.id, option);
    }
    const artFor = (itemId, fallback) => (itemId && itemArt.get(itemId)) || fallback || "";
    const spoilFor = (itemId) => SpoilageClock.viewFromOption(itemId ? spoilById.get(itemId) : null);

    const foodSlots = (foodDailyPips ?? []).map((pip, i) => ({
        day: pip.day ?? i + 1,
        isEmpty: !pip.isFed || pip.isCleared,
        name: pip.isCleared ? "" : (pip.name ?? ""),
        img: pip.isCleared ? "" : artFor(pip.itemId, pip.img),
        ...spoilFor(pip.isCleared ? "" : pip.itemId),
        isSend: pip.isDeparture ?? false,
        isBuff: false,
        editable: !!pip.editable
    }));

    const need = waterNeedPerDay ?? (waterFlow?.needed ? Math.ceil(waterFlow.needed / 7) : 2);

    const waterDays = (waterDailyPips ?? []).map((pip, i) => {
        const isSend = pip.isDeparture ?? false;
        const pints = [];
        const pours = Array.isArray(pip.pours) ? pip.pours : null;
        if (pours) {
            for (const pour of pours) {
                for (let n = 0; n < (pour.pints || 0) && pints.length < need; n++) {
                    pints.push({
                        filled: true,
                        sourceId: pour.itemId ?? "waterskin",
                        sourceClass: normalizeBeverageClass(pour.name),
                        name: pour.name ?? "",
                        img: artFor(pour.itemId, pour.img),
                        ...spoilFor(pour.itemId),
                        editable: !!pip.editable
                    });
                }
            }
            while (pints.length < need) {
                pints.push({ filled: false, sourceId: "", sourceClass: "", name: "", editable: !!pip.editable });
            }
        } else {
            const filledCount = pip.isHydrated ? need : (pip.filledPints ?? 0);
            for (let p = 0; p < need; p++) {
                pints.push({
                    filled: p < filledCount,
                    sourceId: pip.sourceId ?? "waterskin",
                    sourceClass: normalizeBeverageClass(pip.name),
                    name: pip.name ?? "",
                    img: p < filledCount ? artFor(pip.sourceId, pip.img) : "",
                    ...(p < filledCount ? spoilFor(pip.sourceId) : SpoilageClock.viewFromOption(null)),
                    editable: false
                });
            }
        }
        let lastFilledIdx = -1;
        for (let p = pints.length - 1; p >= 0; p--) {
            if (pints[p].filled) {
                lastFilledIdx = p;
                break;
            }
        }
        if (lastFilledIdx >= 0) {
            pints[lastFilledIdx].isSurface = true;
        }
        return {
            day: pip.day ?? i + 1,
            isSend,
            hasBuff: pip.hasBuff ?? false,
            dayIndex: i,
            pints,
            ...waterGlassFromPints(pints)
        };
    });

    const foodSendoff = selectedDepartureMeal
        ? { empty: false, itemName: selectedDepartureMeal.name, hasBuff: selectedDepartureMeal.hasBuff, buffSummary: selectedDepartureMeal.buffSummary ?? "" }
        : { empty: true };
    const waterSendoff = selectedDepartureDrink
        ? { empty: false, itemName: selectedDepartureDrink.name, hasBuff: selectedDepartureDrink.hasBuff, buffSummary: selectedDepartureDrink.buffSummary ?? "" }
        : { empty: true };

    const foodInventory = (departureFoodOptions ?? []).map(o => ({
        id: o.id, name: o.name, img: o.img ?? "", available: o.quantity, hasBuff: o.hasBuff, isDry: o.quantity <= 0, isSelected: o.isSelected,
        ...SpoilageClock.viewFromOption(o)
    }));
    const waterInventory = (departureDrinkOptions ?? []).map(o => ({
        id: o.id, name: o.name, img: o.img ?? "", available: o.quantity, hasBuff: o.hasBuff, isDry: o.quantity <= 0, isSelected: o.isSelected,
        ...SpoilageClock.viewFromOption(o)
    }));

    return {
        actorId,
        isMultiDay: true,
        mealsLocked: Boolean(mealsLocked),
        canUnlock: Boolean(canUnlock),
        canInteract: Boolean(canUnlock),
        trait: isTraitPill ? { label: climateLabel, tooltip: climateTooltip } : null,
        food: {
            budget: { text: foodBudgetDone ? game.i18n.localize("ionrift-respite.downtimeLedger.fed") : game.i18n.format("ionrift-respite.downtimeLedger.daysShort", { days: foodFlow?.shortfallDays ?? 0 }), isDone: foodBudgetDone },
            slots: foodSlots,
            sendoff: foodSendoff,
            inventory: foodInventory
        },
        water: {
            budget: { text: waterBudgetDone ? game.i18n.localize("ionrift-respite.downtimeLedger.hydrated") : game.i18n.format("ionrift-respite.downtimeLedger.daysShort", { days: waterFlow?.shortfallDays ?? 0 }), isDone: waterBudgetDone },
            days: waterDays,
            sendoff: waterSendoff,
            inventory: waterInventory,
            need
        }
    };
}
