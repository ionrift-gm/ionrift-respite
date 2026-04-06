/**
 * RollRequestManager
 * Shared utility functions for player-driven skill checks across Respite.
 *
 * Used by: event checks, camp activity rolls, decision tree rolls.
 * NOT a stateful class. Each context owns its own state (pending rolls,
 * collected results, resolution). This module provides the mechanical
 * helpers that all three share.
 */

const MODULE_ID = "ionrift-respite";

/**
 * Picks the best skill for an actor from a list of options.
 * Uses the actor's modifiers to choose the highest.
 * @param {Actor} actor
 * @param {string[]} skills - Skill abbreviations (e.g. ["dex", "str", "ath"])
 * @returns {string} Best skill abbreviation.
 */
export function pickBestSkill(actor, skills) {
    if (!skills?.length) return "dex";
    let best = skills[0];
    let bestMod = -99;
    for (const s of skills) {
        const mod = getSkillMod(actor, s);
        if (mod > bestMod) {
            bestMod = mod;
            best = s;
        }
    }
    return best;
}

/**
 * Gets the modifier for a skill or ability on an actor.
 * Handles both dnd5e skill abbreviations and ability abbreviations.
 * @param {Actor} actor
 * @param {string} key - Skill/ability abbreviation.
 * @returns {number}
 */
export function getSkillMod(actor, key) {
    const skill = actor.system?.skills?.[key];
    if (skill) return skill.total ?? skill.mod ?? 0;
    const ability = actor.system?.abilities?.[key];
    if (ability) return ability.mod ?? 0;
    return 0;
}

/**
 * Builds a 1d20 + modifier roll for a given actor and skill.
 * Does NOT evaluate or post to chat.
 * @param {Actor} actor
 * @param {string} skillKey - Skill abbreviation.
 * @returns {{ roll: Roll, modifier: number, skillKey: string }}
 */
export function buildSkillRoll(actor, skillKey) {
    const modifier = getSkillMod(actor, skillKey);
    const roll = new Roll(`1d20 + ${modifier}`);
    return { roll, modifier, skillKey };
}

/**
 * Posts a completed roll to chat with a flavor message.
 * @param {Actor} actor
 * @param {Roll} roll - Already evaluated roll.
 * @param {string} flavor - Chat message flavor text.
 * @returns {Promise<ChatMessage>}
 */
export async function postRollToChat(actor, roll, flavor) {
    return roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor
    });
}

/**
 * Waits for Dice So Nice animation to complete, with a safety timeout.
 * No-op if DSN is not installed.
 * @param {number} [timeoutMs=5000] - Maximum wait time.
 * @returns {Promise<void>}
 */
export async function waitForDiceSoNice(timeoutMs = 5000) {
    if (!game.modules.get("dice-so-nice")?.active) return;
    return new Promise(resolve => {
        const timeout = setTimeout(resolve, timeoutMs);
        Hooks.once("diceSoNiceRollComplete", () => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

/**
 * Disables a roll button and shows a spinner.
 * @param {HTMLElement} target - The button element.
 */
export function disableRollButton(target) {
    if (!target) return;
    target.disabled = true;
    target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;
}

/**
 * GM fallback: rolls a skill check on behalf of a player.
 * Picks the best skill from the check's skill list, evaluates,
 * posts to chat, and returns the result.
 *
 * @param {Actor} actor - The actor to roll for.
 * @param {string|string[]} skills - Skill key or array of skill keys.
 * @param {number} dc - Difficulty class.
 * @param {string} [context="Skill check"] - Context label for chat flavor.
 * @returns {Promise<{ total: number, passed: boolean, skill: string, modifier: number }>}
 */
export async function rollForPlayer(actor, skills, dc, context = "Skill check") {
    const skillList = Array.isArray(skills) ? skills : [skills];
    const skill = pickBestSkill(actor, skillList);
    const { roll, modifier } = buildSkillRoll(actor, skill);
    await roll.evaluate();

    const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill.toUpperCase();
    const passed = roll.total >= dc;
    const flavor = `<strong>${actor.name}</strong> - ${context} (${skillName}, DC ${dc}) [GM roll]`;

    await postRollToChat(actor, roll, flavor);
    await waitForDiceSoNice();

    return { total: roll.total, passed, skill, modifier };
}

/**
 * Executes a player-side skill check: evaluate, post to chat, wait for DSN,
 * disable button, and return the result.
 *
 * @param {Actor} actor - The actor rolling.
 * @param {string} skillKey - Skill abbreviation.
 * @param {number} dc - Difficulty class.
 * @param {string} flavorText - Chat message flavor.
 * @param {HTMLElement} [buttonTarget] - Optional button to disable.
 * @returns {Promise<{ total: number, passed: boolean }>}
 */
export async function executePlayerRoll(actor, skillKey, dc, flavorText, buttonTarget) {
    const { roll } = buildSkillRoll(actor, skillKey);
    await roll.evaluate();

    await postRollToChat(actor, roll, flavorText);

    if (buttonTarget) disableRollButton(buttonTarget);

    await waitForDiceSoNice();

    return { total: roll.total, passed: roll.total >= dc };
}

/**
 * Display name lookup for skill abbreviations.
 * Used by rollForPlayer to label chat messages.
 */
export const SKILL_DISPLAY_NAMES = {
    acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana",
    ath: "Athletics", dec: "Deception", his: "History",
    ins: "Insight", itm: "Intimidation", inv: "Investigation",
    med: "Medicine", nat: "Nature", prc: "Perception",
    prf: "Performance", per: "Persuasion", rel: "Religion",
    slt: "Sleight of Hand", ste: "Stealth", sur: "Survival",
    // Ability abbreviations
    str: "Strength", dex: "Dexterity", con: "Constitution",
    int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};
