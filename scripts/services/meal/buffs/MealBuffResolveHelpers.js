/**
 * Shared meal buff roll/apply helpers used by stub fallback resolution.
 */

export async function rollBuffFormula(actor, formula) {
    if (!formula) return { total: 0, roll: null };
    try {
        const roll = new Roll(String(formula), actor.getRollData?.() ?? {});
        await roll.evaluate();
        return { total: Math.floor(Number(roll.total) || 0), roll };
    } catch {
        return { total: 0, roll: null };
    }
}

export function rollForChat(roll) {
    if (!roll) return null;
    const formula = String(roll.formula ?? "");
    if (roll.dice?.length > 0 || /(^|[^0-9])d\d+/i.test(formula)) return roll;
    return null;
}

export async function restoreHitDice(actor, amount) {
    if (amount <= 0) return 0;
    const hdAdapter = game.ionrift?.respite?.adapter;
    if (hdAdapter?.applyHDRestore) {
        await hdAdapter.applyHDRestore(actor, amount);
        return amount;
    }
    if (game.system.id !== "dnd5e") return 0;
    let remaining = amount;
    const classes = actor.items.filter(item => item.type === "class");
    classes.sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0));
    let restored = 0;
    for (const cls of classes) {
        if (remaining <= 0) break;
        const used = cls.system?.hitDiceUsed ?? 0;
        if (used <= 0) continue;
        const delta = Math.min(used, remaining);
        await cls.update({ "system.hitDiceUsed": used - delta });
        remaining -= delta;
        restored += delta;
    }
    return restored;
}
