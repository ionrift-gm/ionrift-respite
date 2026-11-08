/**
 * "Prepare spells" shortcut: opens the actor's own sheet on the spells tab.
 * Respite never edits spell preparation itself; the system sheet does.
 */

/**
 * @param {Item} spell
 * @returns {boolean} True when the spell is one the caster chooses to prepare.
 */
function isPreparableSpell(spell) {
    const system = spell?.system;
    if (!system || spell.type !== "spell") return false;
    if (Number(system.level ?? 0) < 1) return false;

    // dnd5e 5.x: method + prepared (0 unprepared, 1 prepared, 2 always).
    if (Object.hasOwn(system, "method")) {
        return system.method === "spell" && Number(system.prepared) !== 2;
    }
    return system.preparation?.mode === "prepared";
}

/**
 * @param {Actor} actor
 * @returns {boolean}
 */
export function actorHasPreparableSpells(actor) {
    if (game.system?.id !== "dnd5e") return false;
    if (!actor || actor.type !== "character") return false;
    for (const item of actor.items ?? []) {
        if (isPreparableSpell(item)) return true;
    }
    return false;
}

/**
 * Opens (or focuses) the actor sheet on its spells tab.
 * @param {Actor} actor
 */
export async function openActorSpellbook(actor) {
    const sheet = actor?.sheet;
    if (!sheet) return;
    if (!sheet.rendered) {
        await sheet.render({ force: true, tab: "spells" });
        return;
    }
    if (sheet.minimized) await sheet.maximize?.();
    sheet.changeTab?.("spells", "primary");
    sheet.bringToFront?.();
}
