/**
 * SocketController — centralised socket emit helpers and message type constants.
 *
 * Phase 1.1 extraction from RestSetupApp.js (God class decomposition).
 * Provides:
 *  1. SOCKET_TYPES — frozen object of all socket message type strings
 *  2. Typed emit helpers wrapping `game.socket.emit(`module.${MODULE_ID}`, ...)`
 *
 * The dispatch handler (_onSocketMessage) remains in module.js since it routes
 * to multiple app instances. SocketController is emit-only.
 *
 * @module SocketController
 */

const MODULE_ID = "ionrift-respite";

// ── Message Type Constants ──────────────────────────────────────────────────

/**
 * Canonical socket message type strings.
 * Freezing prevents accidental mutation and typos.
 * @type {Readonly<Record<string, string>>}
 */
export const SOCKET_TYPES = Object.freeze({
    // ── Rest lifecycle ──
    REST_STARTED:          "restStarted",
    REST_PREPARING:        "restPreparing",
    REST_RESOLVED:         "restResolved",
    REST_ABANDONED:        "restAbandoned",
    REST_SNAPSHOT:          "restSnapshot",
    PHASE_CHANGED:         "phaseChanged",
    SUBMISSION_UPDATE:     "submissionUpdate",
    REQUEST_REST_STATE:    "requestRestState",
    FORCE_RELOAD:          "forceReload",

    // ── Activity choices ──
    ACTIVITY_CHOICE:       "activityChoice",

    // ── Camp ceremony ──
    CAMP_LIGHT_FIRE_REQUEST:  "campLightFireRequest",
    CAMP_FIRE_LEVEL_REQUEST:  "campFireLevelRequest",
    ACTIVITY_FIRE_LEVEL_REQUEST: "activityFireLevelRequest",
    CAMP_LIGHT_FIRE:       "campLightFire",
    CAMP_FIREWOOD_PLEDGE:  "campFirewoodPledge",
    CAMP_FIREWOOD_RECLAIM: "campFirewoodReclaim",
    CAMP_COLD_CAMP:        "campColdCamp",

    // ── Camp gear & stations ──
    CAMP_GEAR_PLACE:       "campGearPlace",
    CAMP_STATION_PLACE:    "campStationPlace",
    CAMP_GEAR_PLACED:      "campGearPlaced",
    CAMP_STATION_PLACED:   "campStationPlaced",
    CAMP_GEAR_CLEAR_PLAYER: "campGearClearPlayer",
    CAMP_GEAR_RECLAIM:     "campGearReclaim",
    CAMP_STATION_RECLAIM:  "campStationReclaim",
    CAMP_SCENE_CLEARED:    "campSceneCleared",

    // ── Meal ──
    MEAL_CHOICE:           "mealChoice",
    MEAL_DAY_CONSUMED:     "mealDayConsumed",
    DEHYDRATION_SAVE_REQUEST:    "dehydrationSaveRequest",
    DEHYDRATION_SAVE_RESULT:     "dehydrationSaveResult",
    DEHYDRATION_RESULTS_BROADCAST: "dehydrationResultsBroadcast",

    // ── Detect Magic ──
    DETECT_MAGIC_SCAN_BROADCAST: "detectMagicScanBroadcast",
    DETECT_MAGIC_SCAN_CLEARED:   "detectMagicScanCleared",

    // ── Workbench Identify ──
    WORKBENCH_IDENTIFY_REQUEST: "workbenchIdentifyRequest",
    WORKBENCH_IDENTIFY_RESULT:  "workbenchIdentifyResult",

    // ── Event rolls ──
    EVENT_ROLL_REQUEST:    "eventRollRequest",
    EVENT_ROLL_RESULT:     "eventRollResult",

    // ── Decision tree rolls ──
    TREE_ROLL_REQUEST:     "treeRollRequest",
    TREE_ROLL_RESULT:      "treeRollResult",

    // ── Camp activity rolls ──
    CAMP_ROLL_RESULT:      "campRollResult",

    // ── Travel ──
    TRAVEL_DECLARATION:        "travelDeclaration",
    TRAVEL_DECLARATIONS_SYNC:  "travelDeclarationsSync",
    TRAVEL_ROLL_REQUEST:       "travelRollRequest",
    TRAVEL_ROLL_RESULT:        "travelRollResult",
    TRAVEL_DEBRIEF:            "travelDebrief",
    TRAVEL_INDIVIDUAL_DEBRIEF: "travelIndividualDebrief",

    // ── AFK ──
    AFK_UPDATE:            "afkUpdate",

    // ── Armor ──
    ARMOR_TOGGLE:          "armorToggle",

    CONSUME_FIREWOOD:      "consumeFirewood",
    CAMPFIRE_TOKEN_SYNC:   "campfireTokenSync",
    TORCH_TOKEN_SYNC:      "torchTokenSync",

    // ── Copy Spell ──
    COPY_SPELL_PROPOSAL:   "copySpellProposal",
    COPY_SPELL_APPROVED:   "copySpellApproved",
    COPY_SPELL_DECLINED:   "copySpellDeclined",
    COPY_SPELL_ROLL_PROMPT: "copySpellRollPrompt",
    COPY_SPELL_RESULT:     "copySpellResult",
    COPY_SPELL_BUSY:       "copySpellBusy",

    // ── Short rest ──
    SHORT_REST_STARTED:    "shortRestStarted",
    SHORT_REST_AFK_UPDATE: "shortRestAfkUpdate",
    SHORT_REST_PLAYER_FINISHED: "shortRestPlayerFinished",
    SHORT_REST_SONG_VOLUNTEER:  "shortRestSongVolunteer",
    SHORT_REST_HD_SPENT:   "shortRestHdSpent",
    /** GM → players: in-window summary before native shortRest() runs */
    SHORT_REST_COMPLETION_SUMMARY: "shortRestCompletionSummary",
    SHORT_REST_COMPLETE:   "shortRestComplete",
    SHORT_REST_ABANDONED:  "shortRestAbandoned",
    SHORT_REST_DISMISSED:  "shortRestDismissed",
    REQUEST_SHORT_REST_STATE: "requestShortRestState",
    SHORT_REST_WORKBENCH_STAGING: "shortRestWorkbenchStaging",
    SHORT_REST_WORKBENCH_SYNC: "shortRestWorkbenchSync",

    // ── Monster cooking ──
    BUTCHER_PROMPT_POPUP:  "butcherPromptPopup",
});

// ── Internal emit helper ────────────────────────────────────────────────────

/**
 * Low-level emit. All typed helpers delegate here.
 * @param {string} type - One of SOCKET_TYPES values.
 * @param {object} [payload={}] - Additional data merged into the message.
 */
function _emit(type, payload = {}) {
    game.socket.emit(`module.${MODULE_ID}`, { type, ...payload });
}

// ── Rest Lifecycle Emitters ─────────────────────────────────────────────────

/**
 * GM → Players: a rest phase has started.
 * @param {object} restData - Rest payload (terrainTag, comfort, restType, activities, recipes).
 * @param {object} [opts] - Optional overrides (targetUserId, snapshot).
 */
export function emitRestStarted(restData, opts = {}) {
    // Guard: detect the double-wrap anti-pattern emitRestStarted({ restData: payload }).
    // The signature expects the payload directly; wrapping adds a spurious nesting layer
    // that strips activities from what players receive, causing all stations to render faded.
    if (restData && typeof restData === "object" && "restData" in restData && !("activities" in restData)) {
        console.error(
            `${MODULE_ID} | emitRestStarted called with double-wrapped payload { restData: ... }. ` +
            `Pass the payload directly: emitRestStarted(payload). Station resolver will be empty on player clients.`
        );
    }
    _emit(SOCKET_TYPES.REST_STARTED, { restData, ...opts });
}

/**
 * GM → Players: GM opened the setup wizard, rest is coming soon.
 */
export function emitRestPreparing() {
    _emit(SOCKET_TYPES.REST_PREPARING);
}

/**
 * GM → Players: rest resolved, close pickers.
 */
export function emitRestResolved() {
    _emit(SOCKET_TYPES.REST_RESOLVED);
}

/**
 * GM → Players: rest abandoned by the GM.
 */
export function emitRestAbandoned() {
    _emit(SOCKET_TYPES.REST_ABANDONED);
}

/**
 * GM → Players: full state snapshot for resync.
 * @param {object} snapshot
 */
export function emitRestSnapshot(snapshot) {
    _emit(SOCKET_TYPES.REST_SNAPSHOT, { snapshot });
}

/**
 * GM → Players: phase transition notification.
 * @param {string} phase - New phase name.
 * @param {object} [phaseData={}] - Phase-specific data.
 */
export function emitPhaseChanged(phase, phaseData = {}) {
    _emit(SOCKET_TYPES.PHASE_CHANGED, { phase, phaseData });
}

/**
 * GM → Players: submission status update (activity progress).
 * @param {object} submissions - Map of charId → { activityId, activityName, source }.
 *                              Must be a plain object; null/undefined is silently dropped.
 */
export function emitSubmissionUpdate(submissions) {
    if (!submissions || typeof submissions !== "object") {
        console.warn(`${MODULE_ID} | emitSubmissionUpdate called with invalid submissions payload — dropped.`);
        return;
    }
    // eslint-disable-next-line no-console
    console.debug(`${MODULE_ID} | [SYNC] emitSubmissionUpdate: keys=${Object.keys(submissions).join(",") || "none"}, sample=`, Object.values(submissions)[0] ?? "(empty)");
    _emit(SOCKET_TYPES.SUBMISSION_UPDATE, { submissions });
}

/**
 * Player → GM: request current rest state (late join / tab return).
 * @param {string} userId
 */
export function emitRequestRestState(userId) {
    _emit(SOCKET_TYPES.REQUEST_REST_STATE, { userId });
}

/**
 * GM → All: force all clients to reload.
 */
export function emitForceReload() {
    _emit(SOCKET_TYPES.FORCE_RELOAD);
}

// ── Activity Choice Emitters ────────────────────────────────────────────────

/**
 * Player → GM: activity choices submitted.
 * @param {string} userId
 * @param {object} choices
 * @param {object|null} [craftingResults=null]
 * @param {object|null} [followUps=null]
 */
export function emitActivityChoice(userId, choices, craftingResults = null, followUps = null, earlyResults = null) {
    _emit(SOCKET_TYPES.ACTIVITY_CHOICE, { userId, choices, craftingResults, followUps, earlyResults });
}

// ── Camp Fire Emitters ──────────────────────────────────────────────────────

/**
 * Player → GM: request to light campfire (GM performs item updates).
 * @param {string} userId
 */
export function emitCampLightFireRequest(userId) {
    _emit(SOCKET_TYPES.CAMP_LIGHT_FIRE_REQUEST, { userId });
}

/**
 * Player → GM: request a specific fire level.
 * @param {string} fireLevel
 * @param {string} [userId]
 */
export function emitCampFireLevelRequest(fireLevel, userId) {
    _emit(SOCKET_TYPES.CAMP_FIRE_LEVEL_REQUEST, { fireLevel, userId });
}

/**
 * Player → GM: request fire level change during activity phase.
 * @param {string} fireLevel
 */
export function emitActivityFireLevelRequest(fireLevel) {
    _emit(SOCKET_TYPES.ACTIVITY_FIRE_LEVEL_REQUEST, { fireLevel });
}

/**
 * Player → GM: light fire with a specific method.
 * @param {string} userId
 * @param {string} actorId
 * @param {string} [method="Tinderbox"]
 */
export function emitCampLightFire(userId, actorId, method = "Tinderbox") {
    _emit(SOCKET_TYPES.CAMP_LIGHT_FIRE, { userId, actorId, method });
}

/**
 * Player → GM: pledge firewood.
 * @param {string} userId
 * @param {string} actorId
 */
export function emitCampFirewoodPledge(userId, actorId) {
    _emit(SOCKET_TYPES.CAMP_FIREWOOD_PLEDGE, { userId, actorId });
}

/**
 * Player → GM: reclaim firewood pledge.
 * @param {string} userId
 */
export function emitCampFirewoodReclaim(userId) {
    _emit(SOCKET_TYPES.CAMP_FIREWOOD_RECLAIM, { userId });
}

// ── Meal Emitters ───────────────────────────────────────────────────────────

/**
 * Player → GM: meal choices submitted.
 * @param {string} userId
 * @param {object} choices
 */
export function emitMealChoice(userId, choices) {
    _emit(SOCKET_TYPES.MEAL_CHOICE, { userId, choices });
}

/**
 * Player → GM: consumed a meal day (multi-day flow).
 * @param {string} userId
 * @param {object} mealChoices
 */
export function emitMealDayConsumed(userId, mealChoices) {
    _emit(SOCKET_TYPES.MEAL_DAY_CONSUMED, { userId, mealChoices });
}

/**
 * GM → Player: dehydration save required.
 * @param {object} data - { targetUserId, characterId, actorName, dc }
 */
export function emitDehydrationSaveRequest(data) {
    _emit(SOCKET_TYPES.DEHYDRATION_SAVE_REQUEST, data);
}

/**
 * Player → GM: dehydration save result.
 * @param {object} data
 */
export function emitDehydrationSaveResult(data) {
    _emit(SOCKET_TYPES.DEHYDRATION_SAVE_RESULT, data);
}

/**
 * GM → Players: dehydration save results broadcast.
 * @param {object[]} results
 */
export function emitDehydrationResultsBroadcast(results) {
    _emit(SOCKET_TYPES.DEHYDRATION_RESULTS_BROADCAST, { results });
}

// ── Detect Magic Emitters ───────────────────────────────────────────────────

/**
 * Any → All: Detect Magic scan results.
 * @param {object[]} results
 * @param {string[]} partyActorIds
 * @param {boolean} magicScanComplete
 */
export function emitDetectMagicScanBroadcast(data) {
    _emit(SOCKET_TYPES.DETECT_MAGIC_SCAN_BROADCAST, data);
}

/**
 * GM → All: clear Detect Magic session.
 */
export function emitDetectMagicScanCleared() {
    _emit(SOCKET_TYPES.DETECT_MAGIC_SCAN_CLEARED);
}

// ── Event Roll Emitters ─────────────────────────────────────────────────────

/**
 * GM → Players: request skill check roll from watch characters.
 * @param {object} data
 */
export function emitEventRollRequest(data) {
    _emit(SOCKET_TYPES.EVENT_ROLL_REQUEST, data);
}

/**
 * Player → GM: skill check roll result.
 * @param {object} data
 */
export function emitEventRollResult(data) {
    _emit(SOCKET_TYPES.EVENT_ROLL_RESULT, data);
}

// ── Decision Tree Emitters ──────────────────────────────────────────────────

/**
 * GM → Players: request decision tree roll from party.
 * @param {object} data
 */
export function emitTreeRollRequest(data) {
    _emit(SOCKET_TYPES.TREE_ROLL_REQUEST, data);
}

/**
 * Player → GM: decision tree roll result.
 * @param {object} data
 */
export function emitTreeRollResult(data) {
    _emit(SOCKET_TYPES.TREE_ROLL_RESULT, data);
}

// ── Camp Activity Roll Emitters ─────────────────────────────────────────────

/**
 * Player → GM: camp activity roll result.
 * @param {object} data
 */
export function emitCampRollResult(data) {
    _emit(SOCKET_TYPES.CAMP_ROLL_RESULT, data);
}

// ── Travel Emitters ─────────────────────────────────────────────────────────

/**
 * Player → GM: travel activity declaration.
 * @param {object} data
 */
export function emitTravelDeclaration(data) {
    _emit(SOCKET_TYPES.TRAVEL_DECLARATION, data);
}

/**
 * GM → Players: live sync of all travel declarations.
 * @param {object} data
 */
export function emitTravelDeclarationsSync(data) {
    _emit(SOCKET_TYPES.TRAVEL_DECLARATIONS_SYNC, data);
}

/**
 * GM → Players: travel roll request.
 * @param {object} data
 */
export function emitTravelRollRequest(data) {
    _emit(SOCKET_TYPES.TRAVEL_ROLL_REQUEST, data);
}

/**
 * Player → GM: travel roll result.
 * @param {object} data
 */
export function emitTravelRollResult(data) {
    _emit(SOCKET_TYPES.TRAVEL_ROLL_RESULT, data);
}

/**
 * GM → specific Player: private travel debrief.
 * @param {object} data
 */
export function emitTravelDebrief(data) {
    _emit(SOCKET_TYPES.TRAVEL_DEBRIEF, data);
}

/**
 * GM → specific Player: one forage/hunt result.
 * @param {object} data
 */
export function emitTravelIndividualDebrief(data) {
    _emit(SOCKET_TYPES.TRAVEL_INDIVIDUAL_DEBRIEF, data);
}

// ── Camp Gear & Station Emitters ────────────────────────────────────────────

/**
 * Player → GM: place camp gear on scene.
 * @param {object} data
 */
export function emitCampGearPlace(data) {
    _emit(SOCKET_TYPES.CAMP_GEAR_PLACE, data);
}

/**
 * Player → GM: place camp station on scene.
 * @param {object} data
 */
export function emitCampStationPlace(data) {
    _emit(SOCKET_TYPES.CAMP_STATION_PLACE, data);
}

/**
 * GM → All: camp gear placed confirmation.
 * @param {object} [data={}]
 */
export function emitCampGearPlaced(data = {}) {
    _emit(SOCKET_TYPES.CAMP_GEAR_PLACED, data);
}

/**
 * GM → All: camp station placed confirmation.
 */
export function emitCampStationPlaced() {
    _emit(SOCKET_TYPES.CAMP_STATION_PLACED);
}

/**
 * Player → GM: clear own placed camp gear.
 * @param {object} data
 */
export function emitCampGearClearPlayer(data) {
    _emit(SOCKET_TYPES.CAMP_GEAR_CLEAR_PLAYER, data);
}

/**
 * Player → GM: reclaim gear item back to inventory.
 * @param {object} data
 */
export function emitCampGearReclaim(data) {
    _emit(SOCKET_TYPES.CAMP_GEAR_RECLAIM, data);
}

/**
 * Player → GM: reclaim station equipment.
 * @param {object} data
 */
export function emitCampStationReclaim(data) {
    _emit(SOCKET_TYPES.CAMP_STATION_RECLAIM, data);
}

/**
 * GM → All: camp tokens cleared from scene.
 * @param {object} [data={}]
 */
export function emitCampSceneCleared(data = {}) {
    _emit(SOCKET_TYPES.CAMP_SCENE_CLEARED, data);
}

// ── AFK Emitter ─────────────────────────────────────────────────────────────

/**
 * Bidirectional: AFK status update.
 * @param {string} characterId
 * @param {boolean} isAfk
 */
export function emitAfkUpdate(characterId, isAfk) {
    _emit(SOCKET_TYPES.AFK_UPDATE, { characterId, isAfk });
}

// ── Armor Emitter ───────────────────────────────────────────────────────────

/**
 * Bidirectional: armor doff/don toggle.
 * @param {object} data
 */
export function emitArmorToggle(data) {
    _emit(SOCKET_TYPES.ARMOR_TOGGLE, data);
}

// ── Copy Spell Emitters ─────────────────────────────────────────────────────

/**
 * Player → GM: Propose a spell to copy.
 * @param {object} data
 */
export function emitCopySpellProposal(data) {
    _emit(SOCKET_TYPES.COPY_SPELL_PROPOSAL, data);
}

/**
 * GM → Player: Approve spell copy proposal.
 * @param {object} data
 */
export function emitCopySpellApproved(data) {
    _emit(SOCKET_TYPES.COPY_SPELL_APPROVED, data);
}

/**
 * GM → Player: Decline spell copy proposal.
 * @param {object} data
 */
export function emitCopySpellDeclined(data) {
    _emit(SOCKET_TYPES.COPY_SPELL_DECLINED, data);
}

/**
 * GM → Player: Prompt for the spell copy skill roll.
 * @param {object} data
 */
export function emitCopySpellRollPrompt(data) {
    _emit(SOCKET_TYPES.COPY_SPELL_ROLL_PROMPT, data);
}

/**
 * Player → GM: The result of the copy spell roll.
 * @param {object} data
 */
export function emitCopySpellResult(data) {
    _emit(SOCKET_TYPES.COPY_SPELL_RESULT, data);
}

/**
 * GM → Player: Reject proposal because GM is busy copying another spell.
 * @param {object} data
 */
export function emitCopySpellBusy(data) {
    _emit(SOCKET_TYPES.COPY_SPELL_BUSY, data);
}

// ── Short Rest Emitters ─────────────────────────────────────────────────────

/**
 * GM → Players: short rest started.
 * @param {object} data
 */
export function emitShortRestStarted(data) {
    _emit(SOCKET_TYPES.SHORT_REST_STARTED, data);
}

/**
 * Short rest complete notification.
 */
export function emitShortRestComplete() {
    _emit(SOCKET_TYPES.SHORT_REST_COMPLETE);
}

/**
 * GM → players: show pre-native summary in ShortRestApp (filtered per client).
 * @param {{ lines: Array<{ actorId: string, name: string, line: string }> }} data
 */
export function emitShortRestCompletionSummary(data) {
    _emit(SOCKET_TYPES.SHORT_REST_COMPLETION_SUMMARY, data);
}

/**
 * @param {object} payload
 */
export function emitShortRestWorkbenchSync(payload) {
    _emit(SOCKET_TYPES.SHORT_REST_WORKBENCH_SYNC, payload);
}

/**
 * @param {object} payload
 */
export function emitShortRestWorkbenchStagingFromPlayer(payload) {
    _emit(SOCKET_TYPES.SHORT_REST_WORKBENCH_STAGING, payload);
}

/**
 * Short rest abandoned notification.
 */
export function emitShortRestAbandoned() {
    _emit(SOCKET_TYPES.SHORT_REST_ABANDONED);
}

/**
 * Short rest dismissed (window closed, rest still active).
 */
export function emitShortRestDismissed() {
    _emit(SOCKET_TYPES.SHORT_REST_DISMISSED);
}

/**
 * Player → GM: request short rest state (late join / rejoin).
 * @param {string} userId
 */
export function emitRequestShortRestState(userId) {
    _emit(SOCKET_TYPES.REQUEST_SHORT_REST_STATE, { userId });
}

/**
 * Bidirectional: short rest AFK status update.
 * @param {string} characterId
 * @param {boolean} isAfk
 */
export function emitShortRestAfkUpdate(characterId, isAfk) {
    _emit(SOCKET_TYPES.SHORT_REST_AFK_UPDATE, { characterId, isAfk });
}

// ── Monster Cooking Emitter ─────────────────────────────────────────────────

/**
 * GM → Players: butcher opportunity popup after combat.
 * @param {object} data - Creature info, tier, DC, holder IDs, etc.
 */
export function emitButcherPromptPopup(data) {
    _emit(SOCKET_TYPES.BUTCHER_PROMPT_POPUP, data);
}

// ── Workbench Identify (player → GM) ──

/**
 * Player to GM: request GM-side identification of a workbench item.
 * Used when Quartermaster is active or the item carries QM flags.
 * @param {{ actorId: string, itemId: string, requestId: string, targetUserId: string }} data
 */
export function emitWorkbenchIdentifyRequest(data) {
    _emit(SOCKET_TYPES.WORKBENCH_IDENTIFY_REQUEST, data);
}

/**
 * GM to requesting client: result of a workbench identify request.
 * @param {{ requestId: string, success: boolean, targetUserId: string }} data
 */
export function emitWorkbenchIdentifyResult(data) {
    _emit(SOCKET_TYPES.WORKBENCH_IDENTIFY_RESULT, data);
}
