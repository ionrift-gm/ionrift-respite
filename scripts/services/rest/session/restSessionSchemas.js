/**
 * State schemas for each rest session type.
 *
 * These are pure data. Adding a field here is the only step needed to get it
 * persisted, snapshotted on reconnect, and pushed on live sync. Adding a
 * session type means adding a schema here and registering it below; nothing
 * in the sync layer needs to learn the new name.
 */

import { RestSessionSchema, field } from "./RestSessionState.js";

/**
 * Older saves stored a per-actor sustenance role instead of a seven day
 * gathering schedule. Expand those into the current shape on load.
 *
 * @param {Array<[string, object|Array]>} roles
 * @returns {Array<[string, Array<object>]>}
 */
function expandLegacySustenanceRoles(roles) {
    return roles.map(([actorId, data]) => {
        if (Array.isArray(data)) return [actorId, data];
        const mode = data?.role === "hunt" ? "hunt" : "forage";
        const schedule = [1, 2, 3, 4, 5, 6, 7].map(day => ({
            day,
            mode: day === 7 ? "skip" : mode,
            rolled: data?.rolled ?? false,
            rollTotal: data?.rollTotal ?? null,
            dc: data?.dc ?? null,
            success: data?.success ?? null,
            yield: data?.yield ?? 0
        }));
        return [actorId, schedule];
    });
}

/**
 * @param {object} state
 * @returns {object}
 */
function migrateDowntime(state) {
    const next = { ...state };
    if (!Array.isArray(next.gatheringSchedule) && Array.isArray(next.sustenanceRoles)) {
        next.gatheringSchedule = expandLegacySustenanceRoles(next.sustenanceRoles);
    }
    if (typeof next.foodDaysNeeded !== "number" && typeof next.patronSuppliedDays === "number") {
        next.foodDaysNeeded = Math.max(0, Math.min(7, 7 - next.patronSuppliedDays));
    }
    return next;
}

/**
 * The short rest blob predates this codec and stored its actor maps as plain
 * objects rather than entry pairs. Normalise them so an interrupted session
 * survives the upgrade.
 *
 * @param {object} state
 * @returns {object}
 */
function migrateShortRest(state) {
    const next = { ...state };
    for (const key of ["rolls", "songBonuses", "chefMealBonuses"]) {
        const value = next[key];
        if (value && !Array.isArray(value) && typeof value === "object") {
            next[key] = Object.entries(value);
        }
    }
    return next;
}

export const SHORT_REST_STATE_SCHEMA = new RestSessionSchema({
    type: "shortrest",
    systemRestType: "short",
    settingKey: "activeShortRest",
    migrate: migrateShortRest,
    fields: [
        field({ key: "activeShelter", type: "string" }),
        field({ key: "rolls", kind: "map" }),
        field({ key: "songVolunteer", type: "object", nullable: true }),
        field({ key: "songBonuses", kind: "map", prop: "_songBonusByActor" }),
        field({ key: "chefVolunteer", type: "object", nullable: true }),
        field({ key: "chefMealServedCount", type: "number" }),
        field({ key: "chefMealBonuses", kind: "map", prop: "_chefMealBonusByActor" }),
        field({ key: "confirmedRecovery", kind: "set" }),
        field({ key: "finishedUserIds", kind: "set", prop: "_finishedUsers" }),
        // Mirror of the module-scoped AFK singleton. ShortRestApp pushes it
        // back into RestAfkState after a load; the codec only moves the copy.
        field({ key: "afkCharacterIds", kind: "set", prop: "_afkCharacters" }),
        field({ key: "workbenchFocusActorId", type: "string", nullable: true }),
        field({ key: "magicScanResults", type: "object", nullable: true }),
        field({ key: "magicScanComplete", type: "boolean" }),
        field({ key: "workbenchStaging", kind: "map", prop: "_workbenchIdentifyStaging" }),
        field({ key: "workbenchAck", kind: "map", prop: "_workbenchIdentifyAcknowledge" }),
        field({ key: "completionPhase", type: "boolean" }),
        field({ key: "completionSummaryLines", type: "array" }),
        field({ key: "encounterDc", type: "number", gmOnly: true }),
        field({ key: "patrolCheckEnabled", type: "boolean", gmOnly: true })
    ]
});

export const BIVOUAC_STATE_SCHEMA = new RestSessionSchema({
    type: "bivouac",
    systemRestType: "short",
    settingKey: "activeGrittyRest",
    gritty: true,
    fields: [
        field({ key: "terrainTag", type: "string" }),
        field({ key: "dangerDC", type: "number" }),
        field({ key: "safePassage", type: "boolean" }),
        field({ key: "stance", kind: "codec", prop: "_campStanceManager" }),
        field({ key: "chefVolunteered", type: "boolean" }),
        field({ key: "chefVolunteer", type: "object", nullable: true }),
        field({ key: "plateChoices", kind: "map" }),
        field({ key: "waterChoices", kind: "map" }),
        field({ key: "rolls", kind: "map" }),
        field({ key: "songVolunteer", type: "object", nullable: true }),
        field({ key: "songBonuses", kind: "map", prop: "_songBonusByActor" }),
        field({ key: "chefMealBonuses", kind: "map", prop: "_chefMealBonusByActor" }),
        field({ key: "finishedUserIds", kind: "set", prop: "_finishedUsers" }),
        field({ key: "activeTab", type: "string" }),
        field({ key: "workbenchFocusActorId", type: "string", nullable: true }),
        field({ key: "magicScanResults", type: "object", nullable: true }),
        field({ key: "magicScanComplete", type: "boolean" }),
        field({ key: "workbenchStaging", kind: "map", prop: "_workbenchIdentifyStaging" }),
        field({ key: "workbenchAck", kind: "map", prop: "_workbenchIdentifyAcknowledge" })
    ]
});

export const DOWNTIME_STATE_SCHEMA = new RestSessionSchema({
    type: "downtime",
    systemRestType: "long",
    settingKey: "activeGrittyRest",
    gritty: true,
    migrate: migrateDowntime,
    fields: [
        field({ key: "terrainTag", type: "string" }),
        field({ key: "weather", type: "string" }),
        field({ key: "campComfort", type: "string", nullable: true }),
        field({ key: "fireLevel", type: "string", nullable: true }),
        field({ key: "activeShelters", type: "array" }),
        field({ key: "dangerDC", type: "number" }),
        // Read back by the constructor when the GM resumes an interrupted
        // session. The budget delegate is what actually restores it.
        field({ key: "haven", prop: "_havenForResume", derived: true }),
        field({ key: "budget", kind: "codec", prop: "_budgetDelegate" }),
        field({ key: "foodDaysNeeded", type: "number" }),
        field({ key: "foodNominations", kind: "map" }),
        field({ key: "departureMeals", kind: "map" }),
        field({ key: "departureDrinks", kind: "map" }),
        field({ key: "committedActors", kind: "set", prop: "_committedActorIds" }),
        field({ key: "mealsLocked", kind: "set", prop: "_mealsLockedActorIds" }),
        field({ key: "sustenanceEdits", kind: "map", prop: "_sustenanceEdits" }),
        field({ key: "forageDC", type: "number" }),
        field({ key: "huntDC", type: "number" }),
        field({ key: "gatheringSchedule", kind: "map" }),
        field({ key: "activityRolls", kind: "map" }),
        // Encounters for each night. Sanitized for players so unrolled events/monsters remain hidden.
        field({
            key: "encounterDraft",
            type: "array",
            transformForPlayers: (draft) => {
                if (!Array.isArray(draft)) return [];
                return draft.map(entry => {
                    const isRolled = Boolean(entry.isRolled);
                    return {
                        nightIndex: entry.nightIndex,
                        effectiveDC: entry.effectiveDC ?? 15,
                        isRolled,
                        state: isRolled ? (entry.state ?? null) : null,
                        category: isRolled ? (entry.category ?? null) : null,
                        isDisaster: isRolled ? Boolean(entry.isDisaster) : false,
                        triggered: isRolled ? Boolean(entry.triggered) : false,
                        forcedSafe: isRolled ? Boolean(entry.forcedSafe) : false,
                        rollTotal: isRolled ? (entry.rollTotal ?? null) : null,
                        event: (isRolled && entry.event) ? {
                            title: entry.event.title ?? "",
                            description: entry.event.description ?? ""
                        } : null,
                        sentryName: entry.sentryName ?? null,
                        sentrySurprised: isRolled ? Boolean(entry.sentrySurprised) : false,
                        hasActiveGuard: Boolean(entry.hasActiveGuard),
                        fortifyCount: entry.fortifyCount ?? 0,
                        guardCount: entry.guardCount ?? 0,
                        fortifyActors: Array.isArray(entry.fortifyActors) ? [...entry.fortifyActors] : [],
                        guardActors: Array.isArray(entry.guardActors) ? [...entry.guardActors] : [],
                        manualOffset: entry.manualOffset ?? 0,
                        activityNudge: entry.activityNudge ?? 0,
                        fireNudge: entry.fireNudge ?? 0
                    };
                });
            }
        }),
        field({ key: "pacingActive", type: "boolean" }),
        field({ key: "activePacingNight", type: "number" }),
        field({ key: "sendoffOpen", type: "boolean" }),
        field({ key: "sendoffApplied", type: "array" }),
        field({ key: "awaitingCombat", type: "boolean" }),
        field({ key: "completedCombatNights", kind: "set" }),
        field({ key: "enforceBedroll", type: "boolean" }),
        field({ key: "enforceTent", type: "boolean" }),
        field({ key: "enforceMessKit", type: "boolean" }),
        field({ key: "workbenchStaging", kind: "map", prop: "_workbenchIdentifyStaging" }),
        field({ key: "workbenchAck", kind: "map", prop: "_workbenchIdentifyAcknowledge" }),
        field({ key: "workbenchFocusCounts", kind: "map", prop: "_workbenchFocusCounts" }),
        field({ key: "magicScanResults", type: "object", nullable: true }),
        field({ key: "magicScanComplete", type: "boolean" }),
        field({ key: "exhaustionDraft", kind: "map", prop: "_exhaustionDraft" })
    ]
});

/**
 * Every session type the sync layer knows about, keyed by session type.
 *
 * @type {Record<string, RestSessionSchema>}
 */
export const REST_SESSION_SCHEMAS = Object.freeze({
    shortrest: SHORT_REST_STATE_SCHEMA,
    bivouac: BIVOUAC_STATE_SCHEMA,
    downtime: DOWNTIME_STATE_SCHEMA
});

/**
 * @param {string} restType
 * @returns {RestSessionSchema|null}
 */
export function getRestSessionSchema(restType) {
    return REST_SESSION_SCHEMAS[restType] ?? null;
}
