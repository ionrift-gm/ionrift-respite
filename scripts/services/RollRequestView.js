/**
 * RollRequestView
 * Normalized view model for the shared player roll-request UI component.
 * Flow-specific state (event, tree, camp, etc.) maps into this shape via helpers.
 */

/**
 * @typedef {object} RollRequestParticipant
 * @property {string} id
 * @property {string} name
 * @property {string} [img]
 * @property {'normal'|'advantage'|'disadvantage'} rollMode
 * @property {boolean} rolled
 * @property {number|null} [total]
 * @property {boolean|null} [passed]
 * @property {boolean} isOwner
 * @property {boolean} canRoll
 */

/**
 * Build participant rows for every character challenged on this roll.
 * @param {string[]} participantIds
 * @param {object} [options]
 * @returns {RollRequestParticipant[]}
 */
export function buildRollParticipants(participantIds, options = {}) {
    const rollModes = options.rollModes ?? {};
    const resolvedRolls = options.resolvedRolls ?? [];
    const resolvedById = new Map(
        resolvedRolls.map((entry) => [entry.characterId ?? entry.id, entry])
    );
    const rolledLocal = options.rolledCharacters ?? new Set();

    return participantIds.map((id) => {
        const actor = game.actors.get(id);
        const resolved = resolvedById.get(id);
        const rolled = (rolledLocal.has?.(id) ?? rolledLocal.includes?.(id) ?? false) || !!resolved;
        const isOwner = actor?.isOwner ?? false;

        return {
            id,
            name: actor?.name ?? resolved?.name ?? "Unknown",
            img: actor?.img ?? "",
            rollMode: rollModes[id] ?? "normal",
            rolled,
            total: resolved?.total ?? null,
            passed: resolved?.passed ?? null,
            isOwner,
            canRoll: isOwner && !rolled
        };
    });
}

/**
 * Default participant order for GM views and single-character rolls.
 * @param {RollRequestParticipant[]} participants
 * @returns {RollRequestParticipant[]}
 */
export function sortRollParticipants(participants = []) {
    return [...participants].sort((left, right) => {
        if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
        if (left.canRoll !== right.canRoll) return left.canRoll ? -1 : 1;
        if (left.rolled !== right.rolled) return left.rolled ? 1 : -1;
        return (left.name ?? "").localeCompare(right.name ?? "");
    });
}

/**
 * Place the current player's character in the center with others split to each side.
 * @param {RollRequestParticipant[]} participants
 * @returns {RollRequestParticipant[]}
 */
export function layoutRollParticipants(participants = [], options = {}) {
    const { centerFocus = true, gmView = false } = options;
    if (gmView || !centerFocus) return sortRollParticipants(participants);

    const owner = participants.find((entry) => entry.isOwner);
    if (!owner) return sortRollParticipants(participants);

    const others = participants
        .filter((entry) => !entry.isOwner)
        .sort((left, right) => {
            if (left.rolled !== right.rolled) return left.rolled ? -1 : 1;
            return (left.name ?? "").localeCompare(right.name ?? "");
        });

    const splitAt = Math.ceil(others.length / 2);
    return [...others.slice(0, splitAt), owner, ...others.slice(splitAt)];
}

/**
 * Pick one actor to stand in for the player POV during GM preview.
 * Prefers a character owned by a non-GM user.
 * @param {Actor[]} candidates
 * @returns {Actor|null}
 */
export function findPreviewPlayerActor(candidates = []) {
    for (const actor of candidates) {
        const hasPlayerOwner = game.users?.some(
            (user) => !user.isGM && actor.testUserPermission?.(user, "OWNER")
        );
        if (hasPlayerOwner) return actor;
    }
    return candidates[0] ?? null;
}

/**
 * Scroll a focus-center roster so the current player's token sits in the middle.
 * @param {ParentNode|null} root
 */
export function centerRollRequestRoster(root) {
    const roster = root?.querySelector?.(".ionrift-roll-request__roster--focus-center");
    const focus = roster?.querySelector?.(".ionrift-roll-participant.is-yours");
    if (!roster || !focus) return;
    focus.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
}

/**
 * Build target line for the centered check module (matches event GM UI).
 * @param {object} [mechanical]
 * @returns {string}
 */
export function buildRollTargetLabel(mechanical = {}) {
    const scope = mechanical.targets === "all" ? "Entire party" : "Watch only";
    const policy = mechanical.checkPolicy === "individual" ? "Individual checks" : "Group Check (averaged)";
    return `${scope} · ${policy}`;
}

/**
 * Build a normalized roll-request context for templates and preview harnesses.
 * @param {object} [opts]
 * @returns {object}
 */
export function buildRollRequestContext(opts = {}) {
    const rawParticipants = opts.participants ?? opts.targets ?? [];
    const hasFocus = rawParticipants.some((entry) => entry.isOwner);
    const participants = layoutRollParticipants(rawParticipants, {
        centerFocus: hasFocus && !opts.gmView,
        gmView: opts.gmView ?? false
    });
    const actionTargets = opts.actionTargets ?? participants.filter((entry) => entry.canRoll);
    const rolledCount = participants.filter((entry) => entry.rolled).length;
    const totalCount = participants.length;
    const allRolled = totalCount > 0 && rolledCount === totalCount;

    let state = opts.state ?? "pending";
    if (!opts.state) {
        if (allRolled) state = "submitted";
        else if (rolledCount > 0) state = "partial";
    }

    return {
        title: opts.title ?? "Skill Check",
        skillKey: opts.skillKey ?? "sur",
        skillName: opts.skillName ?? "Survival",
        dc: opts.dc ?? 10,
        participants,
        actionTargets,
        targets: participants,
        state,
        results: opts.results ?? [],
        gmView: opts.gmView ?? false,
        flow: opts.flow ?? "event",
        meta: opts.meta ?? {},
        multiTarget: totalCount > 1,
        targetLabel: opts.targetLabel ?? "",
        checkContext: opts.checkContext ?? "",
        progressLabel: totalCount > 1 ? `${rolledCount} / ${totalCount} rolled` : "",
        rolledCount,
        totalCount,
        allRolled,
        rosterScroll: totalCount >= 6,
        rosterFocusCenter: hasFocus && !(opts.gmView ?? false),
        gmRollAction: opts.gmRollAction ?? "rollEventForPlayer"
    };
}

/**
 * Map a player-side pending event roll into the shared component context.
 * @param {object|null} pendingEventRoll
 * @param {object|null} [triggeredEvent]
 * @returns {object|null}
 */
export function buildEventPlayerRollContext(pendingEventRoll, triggeredEvent = null) {
    if (!pendingEventRoll) return null;

    const targetIds = pendingEventRoll.targets ?? [];
    const participants = buildRollParticipants(targetIds, {
        rollModes: pendingEventRoll.rollModes ?? {},
        resolvedRolls: triggeredEvent?.resolvedRolls ?? [],
        rolledCharacters: pendingEventRoll.rolledCharacters ?? new Set()
    });

    return buildRollRequestContext({
        title: pendingEventRoll.eventTitle ?? "Skill Check",
        skillKey: pendingEventRoll.skill ?? "sur",
        skillName: pendingEventRoll.skillName ?? "Survival",
        dc: pendingEventRoll.dc ?? 10,
        participants,
        flow: "event",
        meta: { eventIndex: pendingEventRoll.eventIndex },
        targetLabel: pendingEventRoll.targetLabel ?? "",
        checkContext: pendingEventRoll.checkContext ?? ""
    });
}

/**
 * Map a GM-side awaiting event roll into the shared component context.
 * @param {object} event
 * @param {number} eventIndex
 * @returns {object|null}
 */
export function buildEventGmRollContext(event, eventIndex) {
    if (!event?.awaitingRolls) return null;

    const targetIds = event.targets?.length
        ? event.targets
        : [
            ...(event.pendingRolls ?? []),
            ...(event.resolvedRolls ?? []).map((entry) => entry.characterId)
        ];

    const uniqueIds = [...new Set(targetIds.filter(Boolean))];
    const participants = buildRollParticipants(uniqueIds, {
        rollModes: event.rollModes ?? {},
        resolvedRolls: event.resolvedRolls ?? [],
        rolledCharacters: new Set((event.resolvedRolls ?? []).map((entry) => entry.characterId))
    });

    const skillKey = event.mechanical?.skill ?? "sur";

    return buildRollRequestContext({
        title: event.title ?? event.name ?? "Skill Check",
        skillKey,
        skillName: event.skillName ?? skillKey.toUpperCase(),
        dc: event.mechanical?.dc ?? 10,
        participants,
        gmView: true,
        flow: "event",
        meta: { eventIndex },
        targetLabel: buildRollTargetLabel(event.mechanical),
        checkContext: event.checkContext ?? "",
        results: (event.resolvedRolls ?? []).map((entry) => ({
            name: entry.name,
            total: entry.total,
            passed: entry.passed
        })),
        gmRollAction: "rollEventForPlayer"
    });
}

/** Preview harness variant ids. */
export const ROLL_REQUEST_PREVIEW_VARIANTS = [
    { id: "pending-single", label: "Pending (single)" },
    { id: "pending-multi", label: "Pending (multi)" },
    { id: "party-partial", label: "Party partial (2/5)" },
    { id: "pending-advantage", label: "Pending (advantage)" },
    { id: "pending-disadvantage", label: "Pending (disadvantage)" },
    { id: "submitted", label: "Submitted" },
    { id: "resolved-pass", label: "Resolved (pass)" },
    { id: "resolved-fail", label: "Resolved (fail)" },
    { id: "gm-pending", label: "GM pending" }
];

const MOCK_PARTY = [
    { id: "a1", name: "Aldric" },
    { id: "a2", name: "Bruna" },
    { id: "a3", name: "Cade" },
    { id: "a4", name: "Dara" },
    { id: "a5", name: "Elowen" }
];

/**
 * Build mock roll-request contexts for the DevTools preview harness.
 * @param {string} variantId
 * @returns {object}
 */
export function buildMockRollRequestContext(variantId = "pending-single") {
    const base = {
        title: "Night Watch Check",
        skillKey: "prc",
        skillName: "Perception",
        dc: 12,
        flow: "preview",
        meta: { eventIndex: 0 },
        targetLabel: "Watch only · Group Check (averaged)",
        checkContext: "Perception check. High roll means the watcher caught it early and scared it off before it got much. Low roll means it had all night."
    };

    switch (variantId) {
        case "pending-multi":
            return buildRollRequestContext({
                ...base,
                participants: [
                    { id: "a1", name: "Aldric", rollMode: "normal", rolled: false, isOwner: true, canRoll: true },
                    { id: "a2", name: "Bruna", rollMode: "normal", rolled: false, isOwner: false, canRoll: false }
                ]
            });
        case "party-partial":
            return buildRollRequestContext({
                ...base,
                participants: MOCK_PARTY.map((member, index) => ({
                    id: member.id,
                    name: member.name,
                    rollMode: index === 1 ? "advantage" : "normal",
                    rolled: index < 2,
                    total: index < 2 ? 14 + index : null,
                    passed: index < 2 ? true : null,
                    isOwner: index === 2,
                    canRoll: index === 2
                }))
            });
        case "pending-advantage":
            return buildRollRequestContext({
                ...base,
                participants: [{ id: "a1", name: "Aldric", rollMode: "advantage", rolled: false, isOwner: true, canRoll: true }]
            });
        case "pending-disadvantage":
            return buildRollRequestContext({
                ...base,
                participants: [{ id: "a1", name: "Aldric", rollMode: "disadvantage", rolled: false, isOwner: true, canRoll: true }]
            });
        case "submitted":
            return buildRollRequestContext({
                ...base,
                state: "submitted",
                participants: [{ id: "a1", name: "Aldric", rollMode: "normal", rolled: true, isOwner: true, canRoll: false }]
            });
        case "resolved-pass":
            return buildRollRequestContext({
                ...base,
                state: "resolved",
                participants: [{ id: "a1", name: "Aldric", rollMode: "normal", rolled: true, total: 17, passed: true, isOwner: true, canRoll: false }],
                results: [{ name: "Aldric", total: 17, passed: true }]
            });
        case "resolved-fail":
            return buildRollRequestContext({
                ...base,
                state: "resolved",
                participants: [{ id: "a1", name: "Aldric", rollMode: "normal", rolled: true, total: 8, passed: false, isOwner: true, canRoll: false }],
                results: [{ name: "Aldric", total: 8, passed: false }]
            });
        case "gm-pending":
            return buildRollRequestContext({
                ...base,
                gmView: true,
                participants: MOCK_PARTY.map((member, index) => ({
                    id: member.id,
                    name: member.name,
                    rollMode: index === 1 ? "advantage" : "normal",
                    rolled: index < 2,
                    total: index < 2 ? 15 - index : null,
                    passed: index < 2 ? true : null,
                    isOwner: false,
                    canRoll: false
                })),
                results: MOCK_PARTY.slice(0, 2).map((member, index) => ({
                    name: member.name,
                    total: 15 - index,
                    passed: true
                })),
                meta: { eventIndex: 0 }
            });
        case "pending-single":
        default:
            return buildRollRequestContext({
                ...base,
                participants: [{ id: "a1", name: "Aldric", rollMode: "normal", rolled: false, isOwner: true, canRoll: true }]
            });
    }
}
