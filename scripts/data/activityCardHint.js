/**
 * Activity card status line.
 * One line in the station column. The detail view keeps the full description.
 * CARD_HINT_MAX_CHARS is the budget for that line at the card's hint size.
 */

export const CARD_HINT_MAX_CHARS = 42;

export const CARD_FADED_HINTS = Object.freeze({
    needsFire: "Needs a lit fire",
    needsHotFire: "Needs a campfire",
    noForage: "No provisions in this terrain",
    unavailable: "Not available"
});

/**
 * Keep a name inside the card budget once the fixed words are counted.
 * @param {string} name
 * @param {string} reserved Fixed words already in the hint
 * @returns {string}
 */
export function clipCardHintName(name, reserved) {
    const raw = String(name ?? "").trim();
    const room = CARD_HINT_MAX_CHARS - String(reserved ?? "").length;
    if (room <= 0) return "";
    if (raw.length <= room) return raw;
    if (room <= 3) return raw.slice(0, room);
    return `${raw.slice(0, room - 3)}...`;
}

/**
 * Faded card when a required spell is known but not prepared.
 * @param {string|string[]} spellNames
 * @returns {string}
 */
export function cardHintNotPrepared(spellNames) {
    const names = (Array.isArray(spellNames) ? spellNames : [spellNames]).filter(Boolean);
    if (names.length === 0) return CARD_FADED_HINTS.unavailable;
    if (names.length > 1) return `${names.length} spells unprepared`;
    const suffix = " is unprepared";
    return `${clipCardHintName(names[0], suffix)}${suffix}`;
}

/**
 * Collapse any card status to one line. The night list and the week
 * planner both call this, so a long hint cannot reopen the card.
 * @param {string} text
 * @returns {string}
 */
export function clipToCardHint(text) {
    const raw = String(text ?? "").replace(/\s+/g, " ").trim();
    if (raw.length <= CARD_HINT_MAX_CHARS) return raw;
    if (CARD_HINT_MAX_CHARS <= 3) return raw.slice(0, CARD_HINT_MAX_CHARS);
    return `${raw.slice(0, CARD_HINT_MAX_CHARS - 3)}...`;
}

/**
 * Faded card when this character already picked something else.
 * @param {string} label Activity or character label
 * @returns {string}
 */
export function cardHintTakenBy(label) {
    const prefix = "Taken by ";
    return `${prefix}${clipCardHintName(label, prefix)}`;
}
