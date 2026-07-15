/**
 * Tracks post-meal exhaustion floors during resolve so native longRest() cannot
 * strip deprivation gains that survive RecoveryHandler.
 */

import { MODULE_ID } from "./MealConstants.js";
import { getPartyActors } from "./partyActors.js";

const FLOOR_FLAG = "deprivationExhaustionFloor";

/** @type {Map<string, number>} */
let mealExhaustionFloors = new Map();

function readActorExhaustion(actor) {
    const adapter = game.ionrift?.respite?.adapter;
    return adapter
        ? adapter.getExhaustion(actor)
        : (actor.system?.attributes?.exhaustion ?? 0);
}

/**
 * @param {Map<string, number>} floors
 */
export function setMealExhaustionFloors(floors) {
    mealExhaustionFloors = new Map(floors ?? []);
}

export function clearMealExhaustionFloors() {
    mealExhaustionFloors.clear();
}

/**
 * @param {Actor} actor
 * @returns {number}
 */
export function readDeprivationExhaustionFloor(actor) {
    const flagFloor = actor?.getFlag?.(MODULE_ID, FLOOR_FLAG);
    return Number.isFinite(flagFloor) ? flagFloor : 0;
}

/**
 * Persist the actor's current exhaustion as the deprivation floor after meal-phase gains.
 * @param {Actor} actor
 * @param {number} [level] - Explicit floor level if known to avoid race conditions.
 */
export async function stampDeprivationExhaustionFloor(actor, level) {
    if (!actor) return;
    const finalLevel = level ?? readActorExhaustion(actor);
    if (finalLevel <= 0) return;
    await actor.setFlag(MODULE_ID, FLOOR_FLAG, finalLevel);
    mealExhaustionFloors.set(actor.id, Math.max(mealExhaustionFloors.get(actor.id) ?? 0, finalLevel));
}

/**
 * @param {Actor[]} actors
 */
export async function clearDeprivationExhaustionFloors(actors = getPartyActors()) {
    for (const actor of actors ?? []) {
        if (!actor) continue;
        if (actor.getFlag?.(MODULE_ID, FLOOR_FLAG) != null) {
            await actor.unsetFlag(MODULE_ID, FLOOR_FLAG);
        }
    }
    mealExhaustionFloors.clear();
}

/**
 * Build resolve-time floors from meal results and any persisted actor flags.
 * @param {object[]|null|undefined} mealResults
 * @returns {Map<string, number>}
 */
export function mergeMealExhaustionFloors(mealResults) {
    const floors = new Map();

    for (const mr of (mealResults ?? [])) {
        const applied = mr.mealExhaustionApplied ?? 0;
        const actor = game.actors.get(mr.characterId);
        const flagFloor = readDeprivationExhaustionFloor(actor);
        if (applied <= 0 && flagFloor <= 0) continue;
        const current = actor ? readActorExhaustion(actor) : applied;
        floors.set(mr.characterId, Math.max(applied, current, flagFloor));
    }

    for (const actor of getPartyActors()) {
        const flagFloor = readDeprivationExhaustionFloor(actor);
        if (flagFloor > 0) {
            floors.set(actor.id, Math.max(floors.get(actor.id) ?? 0, flagFloor));
        }
    }

    setMealExhaustionFloors(floors);
    return floors;
}

/**
 * @param {Actor} actor
 * @returns {number}
 */
export function mealExhaustionFloorFor(actor) {
    if (!actor) return 0;
    return Math.max(
        mealExhaustionFloors.get(actor.id) ?? 0,
        readDeprivationExhaustionFloor(actor)
    );
}

/**
 * @param {Actor} actor
 * @returns {Promise<boolean>} true when a correction was applied
 */
export async function reassertMealExhaustionFloor(actor) {
    const floor = mealExhaustionFloorFor(actor);
    if (!actor || floor <= 0) return false;

    const actual = readActorExhaustion(actor);
    if (actual >= floor) return false;

    const deficit = floor - actual;
    const adapter = game.ionrift?.respite?.adapter;
    if (adapter) {
        await adapter.applyExhaustionDelta(actor, deficit);
    } else {
        await actor.update({ "system.attributes.exhaustion": floor });
    }
    return true;
}
