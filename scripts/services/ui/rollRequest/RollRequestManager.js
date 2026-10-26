/**
 * RollRequestManager
 * Shared utility functions for player-driven skill checks across Respite.
 *
 * Used by: event checks, camp activity rolls, decision tree rolls.
 * NOT a stateful class. Each context owns its own state (pending rolls,
 * collected results, resolution). This module provides the mechanical
 * helpers that all three share.
 */

/**
 * Picks the best skill for an actor from a list of options.
 * Uses the actor's modifiers to choose the highest.
 * @param {Actor} actor
 * @param {string[]} skills - Skill abbreviations (e.g. ["dex", "str", "ath"])
 * @returns {string} Best skill abbreviation.
 */
import { MODULE_ID } from "../../../data/moduleId.js";
import { armDiceSoNiceSettle } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";

export {
    armDiceSoNiceSettle,
    postRollAndSettle,
    presentRoll,
    waitForDiceSoNice
} from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
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
    const adapter = game.ionrift?.respite?.adapter;
    if (adapter) {
        const normalizedKey = adapter.normalizeSkillKey(key);
        const skillTotal = adapter.getSkillTotal(actor, normalizedKey);
        if (skillTotal !== 0) return skillTotal;
        return adapter.getAbilityMod(actor, key);
    }
    const skill = actor.system?.skills?.[key];
    if (skill) return skill.total ?? skill.mod ?? 0;
    const ability = actor.system?.abilities?.[key];
    if (ability) return ability.mod ?? 0;
    return 0;
}

/**
 * Builds a skill roll for a given actor, skill, and roll mode.
 * Does NOT evaluate or post to chat.
 * @param {Actor} actor
 * @param {string} skillKey - Skill abbreviation.
 * @param {'normal'|'advantage'|'disadvantage'} [rollMode='normal']
 * @returns {{ roll: Roll, modifier: number, skillKey: string }}
 */
export function buildSkillRoll(actor, skillKey, rollMode = "normal") {
    const modifier = getSkillMod(actor, skillKey);
    const formula = rollMode === "advantage"    ? `2d20kh1 + ${modifier}`
                  : rollMode === "disadvantage" ? `2d20kl1 + ${modifier}`
                  : `1d20 + ${modifier}`;
    const roll = new Roll(formula);
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
 * Natural d20 face from a standard 1d20+mod skill roll (Foundry v12+ Roll terms).
 * @param {Roll} roll
 * @returns {number|null}
 */
export function getNatD20FromRoll(roll) {
    const t0 = roll?.terms?.[0];
    const r0 = t0?.results?.[0]?.result;
    if (typeof r0 === "number") return r0;
    return roll?.dice?.[0]?.results?.[0]?.result ?? null;
}

export function disableRollButton(target) {
    if (!target) return;
    target.disabled = true;
    target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize("ionrift-respite.rollRequest.rolling")}`;
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
 * @param {'normal'|'advantage'|'disadvantage'} [rollMode='normal']
 * @returns {Promise<{ total: number, passed: boolean, skill: string, modifier: number, natD20: number|null }>}
 */
export async function rollForPlayer(actor, skills, dc, context = null, rollMode = "normal") {
    const skillList = Array.isArray(skills) ? skills : [skills];
    const skill = pickBestSkill(actor, skillList);
    const { roll, modifier } = buildSkillRoll(actor, skill, rollMode);
    await roll.evaluate();

    const ctx = context ?? game.i18n.localize("ionrift-respite.rollRequest.skillCheck");
    const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill.toUpperCase();
    const passed = roll.total >= dc;
    const modeLabel = rollMode === "advantage" ? ` [${game.i18n.localize("ionrift-respite.rollRequest.advantage")}]` : (rollMode === "disadvantage" ? ` [${game.i18n.localize("ionrift-respite.rollRequest.disadvantage")}]` : "");
    const gmRollTag = ` [${game.i18n.localize("ionrift-respite.rollRequest.gmRoll")}]`;
    const flavor = game.i18n.format("ionrift-respite.rollRequest.gmRollFlavor", { name: actor.name, context: ctx, skill: skillName, dc, gmRoll: gmRollTag, mode: modeLabel });

    const gate = armDiceSoNiceSettle();
    try {
        await postRollToChat(actor, roll, flavor);
    } catch (err) {
        gate.cancel();
        throw err;
    }
    await gate.wait();

    return { total: roll.total, passed, skill, modifier, natD20: getNatD20FromRoll(roll) };
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
 * @param {'normal'|'advantage'|'disadvantage'} [rollMode='normal']
 * @returns {Promise<{ total: number, passed: boolean, roll: Roll }>}
 */
export async function executePlayerRoll(actor, skillKey, dc, flavorText, buttonTarget, rollMode = "normal") {
    const { roll } = buildSkillRoll(actor, skillKey, rollMode);
    await roll.evaluate();

    if (buttonTarget) disableRollButton(buttonTarget);

    // Dice So Nice animates from the chat message. Arm the gate first so a
    // fast throw cannot finish before the listener exists.
    const gate = armDiceSoNiceSettle();
    try {
        await postRollToChat(actor, roll, flavorText);
    } catch (err) {
        gate.cancel();
        throw err;
    }
    await gate.wait();

    return { total: roll.total, passed: roll.total >= dc, roll };
}

/**
 * Executes a player-side ability check (training, etc.): evaluate, post to chat,
 * wait for Dice So Nice, disable button, and return the result.
 *
 * @param {Actor} actor
 * @param {string} abilityKey - Ability abbreviation (str, dex, etc.).
 * @param {number} modifier - Precomputed ability modifier.
 * @param {number} dc
 * @param {string} flavorText
 * @param {HTMLElement} [buttonTarget]
 * @param {'normal'|'advantage'|'disadvantage'} [rollMode='normal']
 * @returns {Promise<{ total: number, passed: boolean, roll: Roll }>}
 */
export async function executeAbilityRoll(actor, abilityKey, modifier, dc, flavorText, buttonTarget, rollMode = "normal") {
    const formula = rollMode === "advantage"    ? `2d20kh1 + ${modifier}`
                  : rollMode === "disadvantage" ? `2d20kl1 + ${modifier}`
                  : `1d20 + ${modifier}`;
    const roll = new Roll(formula);
    await roll.evaluate();

    if (buttonTarget) disableRollButton(buttonTarget);

    const gate = armDiceSoNiceSettle();
    try {
        await postRollToChat(actor, roll, flavorText);
    } catch (err) {
        gate.cancel();
        throw err;
    }
    await gate.wait();

    return { total: roll.total, passed: roll.total >= dc, roll };
}

/**
 * Display name lookup for skill abbreviations.
 * Used by rollForPlayer to label chat messages.
 */
export const SKILL_DISPLAY_NAMES = {
    get acr() { return game.i18n.localize("ionrift-respite.skills.acr"); },
    get ani() { return game.i18n.localize("ionrift-respite.skills.ani"); },
    get arc() { return game.i18n.localize("ionrift-respite.skills.arc"); },
    get ath() { return game.i18n.localize("ionrift-respite.skills.ath"); },
    get dec() { return game.i18n.localize("ionrift-respite.skills.dec"); },
    get his() { return game.i18n.localize("ionrift-respite.skills.his"); },
    get ins() { return game.i18n.localize("ionrift-respite.skills.ins"); },
    get itm() { return game.i18n.localize("ionrift-respite.skills.itm"); },
    get inv() { return game.i18n.localize("ionrift-respite.skills.inv"); },
    get med() { return game.i18n.localize("ionrift-respite.skills.med"); },
    get nat() { return game.i18n.localize("ionrift-respite.skills.nat"); },
    get prc() { return game.i18n.localize("ionrift-respite.skills.prc"); },
    get prf() { return game.i18n.localize("ionrift-respite.skills.prf"); },
    get per() { return game.i18n.localize("ionrift-respite.skills.per"); },
    get rel() { return game.i18n.localize("ionrift-respite.skills.rel"); },
    get sle() { return game.i18n.localize("ionrift-respite.skills.sle"); },
    get slt() { return game.i18n.localize("ionrift-respite.skills.slt"); },
    get ste() { return game.i18n.localize("ionrift-respite.skills.ste"); },
    get sur() { return game.i18n.localize("ionrift-respite.skills.sur"); },
    // Ability abbreviations
    get str() { return game.i18n.localize("ionrift-respite.skills.str"); },
    get dex() { return game.i18n.localize("ionrift-respite.skills.dex"); },
    get con() { return game.i18n.localize("ionrift-respite.skills.con"); },
    get int() { return game.i18n.localize("ionrift-respite.skills.int"); },
    get wis() { return game.i18n.localize("ionrift-respite.skills.wis"); },
    get cha() { return game.i18n.localize("ionrift-respite.skills.cha"); }
};
