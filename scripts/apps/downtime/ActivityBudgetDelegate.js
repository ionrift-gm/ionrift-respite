import { MODULE_ID } from "../../data/moduleId.js";
import { ActivityRegistry, DOWNTIME_STATIONS } from "../../data/downtime/ActivityRegistry.js";
import { clipToCardHint } from "../../data/activityCardHint.js";

/** Total downtime days available in a Gritty Long Rest */
export const TOTAL_DOWNTIME_DAYS = 7;

/** Week planner columns. Two columns left the tall station stacked high enough to scroll. */
const STATION_COLUMN_COUNT = 3;

/**
 * Pack stations into a few columns, left to right, so a short station
 * sits beside a tall one. Each column stays a contiguous slice.
 * @param {Array<{activities?: unknown[]}>} stations
 * @param {number} [columnCount]
 * @returns {Array<Array<object>>}
 */
export function packStationColumns(stations, columnCount = STATION_COLUMN_COUNT) {
    const count = Math.min(Math.max(columnCount, 1), stations.length);
    if (!count) return [];

    const weightOf = (station) => 1 + (station.activities?.length ?? 0);
    const prefix = [0];
    for (const station of stations) prefix.push(prefix.at(-1) + weightOf(station));
    const span = (start, end) => prefix[end] - prefix[start];

    let best = null;
    const cuts = [];
    const consider = () => {
        const bounds = [0, ...cuts, stations.length];
        const weights = [];
        for (let index = 0; index < bounds.length - 1; index++) {
            weights.push(span(bounds[index], bounds[index + 1]));
        }
        const max = Math.max(...weights);
        const uneven = weights.reduce((sum, weight) => sum + weight * weight, 0);
        if (!best || max < best.max || (max === best.max && uneven < best.uneven)) {
            best = { max, uneven, bounds: bounds.slice() };
        }
    };
    const choose = (start, left) => {
        if (left === 1) {
            consider();
            return;
        }
        const last = stations.length - (left - 1);
        for (let cut = start + 1; cut <= last; cut++) {
            cuts.push(cut);
            choose(cut, left - 1);
            cuts.pop();
        }
    };
    choose(0, count);

    const columns = [];
    for (let index = 0; index < best.bounds.length - 1; index++) {
        columns.push(stations.slice(best.bounds[index], best.bounds[index + 1]));
    }
    return columns;
}

/**
 * Manages 7-day downtime activity allocations per character with click-to-dump ergonomics,
 * diminishing return caps, and habit repetition.
 */
export class ActivityBudgetDelegate {

    /** @type {Map<string, Map<string, number>>} actorId -> (activityId -> days) */
    #allocations = new Map();

    /** @type {Map<string, Array<{patientId: string, days: number}>>} actorId -> patient assignments for Tend Wounds */
    #tendTargets = new Map();

    /** @type {"civilized"|"wilderness"} */
    #haven = "wilderness";

    constructor({ haven = "wilderness", initialAllocations = null } = {}) {
        this.#haven = haven;
        if (initialAllocations instanceof Map) {
            this.#allocations = initialAllocations;
        }
    }

    get haven() {
        return this.#haven;
    }

    setHaven(haven) {
        this.#haven = haven === "civilized" ? "civilized" : "wilderness";
        // Clean out any allocations that are no longer valid in the new haven for each actor
        for (const [actorId, map] of this.#allocations) {
            const actor = game.actors?.get(actorId);
            const validActivities = new Set(ActivityRegistry.getActivitiesForActor(actor, this.#haven).map(a => a.id));
            for (const activityId of map.keys()) {
                if (!validActivities.has(activityId)) {
                    map.delete(activityId);
                }
            }
        }
    }

    /**
     * Ensures an allocation map exists for the actor, defaulting to 7 days of Rest & Recovery.
     * @param {string} actorId
     * @returns {Map<string, number>}
     */
    #getActorMap(actorId) {
        if (!this.#allocations.has(actorId)) {
            const map = new Map();
            this.#allocations.set(actorId, map);
        }
        const map = this.#allocations.get(actorId);
        for (const activityId of [...map.keys()]) {
            if (!ActivityRegistry.getActivity(activityId)) map.delete(activityId);
        }
        return map;
    }

    /**
     * Calculates total days allocated so far for an actor.
     * @param {string} actorId
     * @returns {number}
     */
    getAllocatedDays(actorId) {
        const map = this.#getActorMap(actorId);
        let sum = 0;
        for (const days of map.values()) {
            sum += days;
        }
        return sum;
    }

    /**
     * Calculates days allocated to a specific activity for an actor.
     * @param {string} actorId
     * @param {string} activityId
     * @returns {number}
     */
    getActivityDays(actorId, activityId) {
        return this.#allocations.get(actorId)?.get(activityId) ?? 0;
    }

    /**
     * Calculates unallocated days remaining in the 7-day budget.
     * @param {string} actorId
     * @returns {number}
     */
    getUnallocatedDays(actorId) {
        return Math.max(0, TOTAL_DOWNTIME_DAYS - this.getAllocatedDays(actorId));
    }

    /**
     * Click-to-dump: dumps all unassigned days into the target activity,
     * respecting per-activity maxDays caps.
     * If all days are already allocated to "rest", replaces rest with target activity.
     *
     * @param {string} actorId
     * @param {string} activityId
     * @returns {number} Days newly assigned to the activity
     */
    dumpDays(actorId, activityId) {
        const actor = game.actors?.get(actorId);
        const validActivities = new Set(ActivityRegistry.getActivitiesForActor(actor, this.#haven).map(a => a.id));
        if (!validActivities.has(activityId)) return 0;

        const activity = ActivityRegistry.getActivity(activityId);
        if (!activity) return 0;

        const map = this.#getActorMap(actorId);
        const currentRestDays = map.get("rest") ?? 0;

        // If the actor only has the default 7d rest allocated, wipe rest so we can dump
        if (currentRestDays === TOTAL_DOWNTIME_DAYS && activityId !== "rest") {
            map.delete("rest");
        }

        const currentAssigned = map.get(activityId) ?? 0;
        const unassigned = this.getUnallocatedDays(actorId);

        if (unassigned <= 0) return currentAssigned;

        const maxAllowed = activity.maxDays ?? TOTAL_DOWNTIME_DAYS;
        const room = Math.max(0, maxAllowed - currentAssigned);
        const toAdd = Math.min(unassigned, room);

        const newTotal = currentAssigned + toAdd;
        if (newTotal > 0) {
            map.set(activityId, newTotal);
        }
        return newTotal;
    }

    /**
     * Steps allocated days up or down for a specific activity.
     *
     * @param {string} actorId
     * @param {string} activityId
     * @param {number} delta (+1, -1, -2, etc.)
     * @returns {number} New total for that activity
     */
    stepDays(actorId, activityId, delta) {
        const activity = ActivityRegistry.getActivity(activityId);
        if (!activity) return 0;

        const map = this.#getActorMap(actorId);
        const current = map.get(activityId) ?? 0;

        if (delta > 0) {
            const actor = game.actors?.get(actorId);
            const validActivities = new Set(ActivityRegistry.getActivitiesForActor(actor, this.#haven).map(a => a.id));
            if (!validActivities.has(activityId)) return current;

            const unassigned = this.getUnallocatedDays(actorId);
            const maxAllowed = activity.maxDays ?? TOTAL_DOWNTIME_DAYS;
            const room = Math.min(delta, unassigned, Math.max(0, maxAllowed - current));
            if (room <= 0) return current;

            map.set(activityId, current + room);
            return current + room;
        } else if (delta < 0) {
            const toRemove = Math.min(current, Math.abs(delta));
            const newTotal = current - toRemove;
            if (newTotal <= 0) {
                map.delete(activityId);
                return 0;
            } else {
                map.set(activityId, newTotal);
                return newTotal;
            }
        }
        return current;
    }

    /**
     * Clears all allocated days for an activity on an actor.
     * @param {string} actorId
     * @param {string} activityId
     * @returns {number} 0
     */
    clearDays(actorId, activityId) {
        const map = this.#getActorMap(actorId);
        map.delete(activityId);
        if (activityId === "tend") this.#tendTargets.delete(actorId);
        return 0;
    }

    // ─── TEND WOUNDS PATIENT TARGETING (Side-Map) ────────────────────────

    /**
     * Assigns tend days to a specific patient. Does NOT change the core
     * allocation map — the total tend days must already be allocated via
     * dumpDays/stepDays. This breaks those N days into per-patient blocks.
     *
     * @param {string} actorId The medic actor ID
     * @param {string} patientId The target patient actor ID
     * @param {number} days Days of care for this patient
     */
    setTendTarget(actorId, patientId, days) {
        const totalTendDays = this.#getActorMap(actorId).get("tend") ?? 0;
        if (totalTendDays <= 0 || days <= 0) return;

        const targets = this.#tendTargets.get(actorId) ?? [];
        const existing = targets.find(t => t.patientId === patientId);
        if (existing) {
            existing.days = days;
        } else {
            targets.push({ patientId, days });
        }

        // Clamp: total patient days cannot exceed total tend days
        let assigned = 0;
        for (const t of targets) {
            const room = Math.max(0, totalTendDays - assigned);
            t.days = Math.min(t.days, room);
            assigned += t.days;
        }
        // Remove zero-day entries
        const cleaned = targets.filter(t => t.days > 0);
        this.#tendTargets.set(actorId, cleaned);
    }

    /**
     * Removes a specific patient assignment.
     * @param {string} actorId
     * @param {string} patientId
     */
    removeTendTarget(actorId, patientId) {
        const targets = this.#tendTargets.get(actorId);
        if (!targets) return;
        const filtered = targets.filter(t => t.patientId !== patientId);
        if (filtered.length === 0) {
            this.#tendTargets.delete(actorId);
        } else {
            this.#tendTargets.set(actorId, filtered);
        }
    }

    /**
     * Returns patient assignments for an actor's tend days.
     * @param {string} actorId
     * @returns {Array<{patientId: string, days: number}>}
     */
    getTendTargets(actorId) {
        return this.#tendTargets.get(actorId) ?? [];
    }

    /**
     * Clears all patient assignments for an actor.
     * @param {string} actorId
     */
    clearTendTargets(actorId) {
        this.#tendTargets.delete(actorId);
    }

    /**
     * Resets the actor's allocation to 7 days of Rest & Recovery.
     * @param {string} actorId
     */
    autoRest(actorId) {
        const map = new Map();
        map.set("rest", TOTAL_DOWNTIME_DAYS);
        this.#allocations.set(actorId, map);
        this.#tendTargets.delete(actorId);
    }

    /**
     * Copies saved allocations (e.g. from last rest) to the actor.
     *
     * @param {string} actorId
     * @param {Array<string>|Record<string, number>} saved
     */
    repeatAllocations(actorId, saved) {
        if (!saved) return;
        const map = new Map();
        const actor = game.actors?.get(actorId);
        const validActivities = new Set(ActivityRegistry.getActivitiesForActor(actor, this.#haven).map(a => a.id));

        if (Array.isArray(saved)) {
            // Array of 7 activity IDs
            for (const actId of saved) {
                if (validActivities.has(actId)) {
                    map.set(actId, (map.get(actId) ?? 0) + 1);
                }
            }
        } else if (typeof saved === "object") {
            for (const [actId, days] of Object.entries(saved)) {
                if (validActivities.has(actId) && typeof days === "number") {
                    map.set(actId, days);
                }
            }
        }

        // Validate total and caps
        for (const [actId, days] of map) {
            const act = ActivityRegistry.getActivity(actId);
            const capped = Math.min(days, act?.maxDays ?? TOTAL_DOWNTIME_DAYS);
            map.set(actId, capped);
        }

        this.#allocations.set(actorId, map);
    }

    /**
     * Repeats previous week's allocations if saved; otherwise leaves empty.
     * @param {string} actorId
     * @param {Array<string>|Record<string, number>|null} saved
     */
    repeatOrRest(actorId, saved) {
        if (saved) {
            this.repeatAllocations(actorId, saved);
        }
    }

    /**
     * Exports compact allocation array (7 activity IDs) for actor flags.
     * @param {string} actorId
     * @returns {string[]}
     */
    exportCompact(actorId) {
        const map = this.#getActorMap(actorId);
        if (!map.size) return Array(TOTAL_DOWNTIME_DAYS).fill("rest");

        const result = [];
        for (const [activityId, days] of map) {
            for (let i = 0; i < days; i++) {
                if (result.length < TOTAL_DOWNTIME_DAYS) {
                    result.push(activityId);
                }
            }
        }
        while (result.length < TOTAL_DOWNTIME_DAYS) {
            result.push("rest");
        }
        return result;
    }

    /**
     * Generates view model data for UI rendering.
     *
     * @param {Actor} actor
     * @returns {object}
     */
    getActorViewModel(actor) {
        const actorId = actor.id;
        const map = this.#getActorMap(actorId);
        const allocatedDays = this.getAllocatedDays(actorId);
        const unallocatedDays = this.getUnallocatedDays(actorId);
        const availableActivities = ActivityRegistry.getActivitiesForActor(actor, this.#haven);

        const activitiesView = availableActivities.map(act => {
            const assignedDays = map.get(act.id) ?? 0;
            const isCapped = assignedDays >= (act.maxDays ?? TOTAL_DOWNTIME_DAYS);
            return {
                id: act.id,
                label: act.label,
                icon: act.icon,
                hint: clipToCardHint(act.hint),
                maxDays: act.maxDays,
                stationId: act.stationId ?? "bedroll",
                assignedDays,
                isActive: assignedDays > 0,
                isCapped,
                canStepUp: assignedDays < (act.maxDays ?? TOTAL_DOWNTIME_DAYS) && unallocatedDays > 0,
                canStepDown: assignedDays > 0
            };
        });

        // Group available activities by station in canonical order
        const stations = DOWNTIME_STATIONS.map(st => {
            const acts = activitiesView.filter(a => a.stationId === st.id);
            if (!acts.length) return null;
            return {
                id: st.id,
                label: st.label,
                icon: st.icon,
                activities: acts
            };
        }).filter(Boolean);

        // 7-segment allocation bar segments
        const segments = [];
        let segCount = 0;
        for (const [actId, days] of map) {
            const act = ActivityRegistry.getActivity(actId);
            for (let i = 0; i < days; i++) {
                if (segCount < TOTAL_DOWNTIME_DAYS) {
                    segments.push({
                        dayNumber: segCount + 1,
                        filled: true,
                        activityId: actId,
                        icon: act?.icon ?? "fas fa-check",
                        label: act?.label ?? actId
                    });
                    segCount++;
                }
            }
        }
        while (segCount < TOTAL_DOWNTIME_DAYS) {
            segments.push({
                dayNumber: segCount + 1,
                filled: false,
                activityId: null,
                icon: null,
                label: "Unallocated"
            });
            segCount++;
        }

        return {
            actorId,
            allocatedDays,
            unallocatedDays,
            isComplete: unallocatedDays === 0,
            segments,
            stations,
            columnStations: packStationColumns(stations),
            activities: activitiesView
        };
    }

    toJSON() {
        const obj = {};
        for (const [actorId, map] of this.#allocations) {
            obj[actorId] = Object.fromEntries(map);
        }
        const tendObj = {};
        for (const [actorId, targets] of this.#tendTargets) {
            tendObj[actorId] = targets;
        }
        return {
            haven: this.#haven,
            allocations: obj,
            tendTargets: tendObj
        };
    }

    fromJSON(data) {
        if (data?.haven) this.#haven = data.haven;
        if (data?.allocations && typeof data.allocations === "object") {
            this.#allocations.clear();
            for (const [actorId, actObj] of Object.entries(data.allocations)) {
                this.#allocations.set(actorId, new Map(Object.entries(actObj)));
            }
        }
        if (data?.tendTargets && typeof data.tendTargets === "object") {
            this.#tendTargets.clear();
            for (const [actorId, targets] of Object.entries(data.tendTargets)) {
                if (Array.isArray(targets)) {
                    this.#tendTargets.set(actorId, targets);
                }
            }
        }
    }
}
