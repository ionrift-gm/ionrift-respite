/**
 * Helpers for communal dish serving: build the party-meal snapshot that carries
 * the supplied buffs, and credit satiation into the active rest's meal tracking.
 */

import { MODULE_ID } from "../inventory/MealConstants.js";

/**
 * Build a party-meal snapshot that carries the supplied buffs so the
 * existing communal serve applies them. Buffs use the same descriptor shape
 * Respite already stores under `flags["ionrift-respite"].buff`.
 */
export function buildServeSnapshot(item, buffs, title) {
    let snapshot;
    if (item && typeof item.toObject === "function") snapshot = item.toObject(false);
    else snapshot = item ? foundry.utils.deepClone(item) : {};
    snapshot.name = title ?? snapshot.name ?? "Meal";
    const rf = { ...(snapshot.flags?.[MODULE_ID] ?? {}) };
    rf.partyMeal = true;
    if (Array.isArray(buffs) && buffs.length) {
        rf.wellFed = true;
        rf.buff = buffs;
    }
    snapshot.flags = { ...(snapshot.flags ?? {}), [MODULE_ID]: rf };
    return snapshot;
}

/**
 * Credit satiation for a communally served dish into the active rest's meal
 * tracking. No-ops when no rest is running (satiation has no store outside a
 * rest). Mirrors the TotM feast-serve crediting.
 */
export async function creditCommunalSatiation(snapshot, partyIds) {
    const restApp = game.ionrift?.respite?.getActiveApp?.();
    if (!restApp) return false;
    const rf = snapshot.flags?.[MODULE_ID] ?? {};
    const satiates = Array.isArray(rf.satiates) ? rf.satiates : [];
    if (!satiates.length) return false;

    let foodPerDay = 1;
    let waterPerDay = 2;
    try {
        const { TerrainRegistry } = await import("../../events/resolve/TerrainRegistry.js");
        const tag = restApp._engine?.terrainTag ?? restApp._selectedTerrain ?? "forest";
        const mealRules = TerrainRegistry.getDefaults?.(tag)?.mealRules ?? {};
        if (mealRules.foodPerDay != null) foodPerDay = mealRules.foodPerDay;
        if (mealRules.waterPerDay != null) waterPerDay = mealRules.waterPerDay;
    } catch { /* terrain rules unavailable: use baseline */ }

    if (!restApp._mealChoices) restApp._mealChoices = new Map();
    if (!restApp._activityMealRationsSubmitted) restApp._activityMealRationsSubmitted = new Set();

    for (const pid of partyIds) {
        if (restApp._activityMealRationsSubmitted.has(pid)) continue;
        const existing = restApp._mealChoices.get(pid) ?? {};
        if (satiates.includes("food")) {
            const foodArr = Array.isArray(existing.food) ? [...existing.food] : [];
            const foodLocked = Array.isArray(existing.foodLockedSlots) ? [...existing.foodLockedSlots] : [];
            for (let i = 0; i < foodPerDay; i++) {
                if (!foodArr[i] || foodArr[i] === "skip") {
                    foodArr[i] = "__feast_food";
                    if (!foodLocked.includes(i)) foodLocked.push(i);
                }
            }
            existing.food = foodArr;
            existing.foodLockedSlots = foodLocked;
        }
        if (satiates.includes("water")) {
            const waterArr = Array.isArray(existing.water) ? [...existing.water] : [];
            const waterLocked = Array.isArray(existing.waterLockedSlots) ? [...existing.waterLockedSlots] : [];
            for (let i = 0; i < waterPerDay; i++) {
                if (!waterArr[i] || waterArr[i] === "skip") {
                    waterArr[i] = "__feast_water";
                    if (!waterLocked.includes(i)) waterLocked.push(i);
                }
            }
            existing.water = waterArr;
            existing.waterLockedSlots = waterLocked;
        }
        const consumedDays = Array.isArray(existing.consumedDays) ? [...existing.consumedDays] : [];
        consumedDays.push({
            food: [...(existing.food ?? [])],
            water: [...(existing.water ?? [])],
            essence: [...(existing.essence ?? [])]
        });
        restApp._mealChoices.set(pid, {
            ...existing,
            consumedDays,
            currentDay: consumedDays.length,
            food: [],
            water: [],
            essence: existing.essence ?? [],
            itemsConsumed: true,
            foodLockedSlots: existing.foodLockedSlots ?? [],
            waterLockedSlots: existing.waterLockedSlots ?? []
        });
        restApp._activityMealRationsSubmitted.add(pid);
    }
    try { if (typeof restApp._saveRestState === "function") await restApp._saveRestState(); } catch { /* persistence is best-effort */ }
    return true;
}
