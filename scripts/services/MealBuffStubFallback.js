/**
 * STUB_FALLBACK meal buff resolution for demo/stub recipes when no profession
 * pack handler is registered. Production effects ship in overlay plugins.
 */

import { restoreHitDice, rollBuffFormula, rollForChat } from "./MealBuffResolveHelpers.js";

/**
 * @param {Actor} actor
 * @param {object} buff
 * @param {{ chatDetail?: boolean }} [ctx]
 * @returns {Promise<{ summary?: string, roll?: Roll|null }|null>}
 */
export async function resolveStubMealBuff(actor, buff, { chatDetail = false } = {}) {
    if (!buff?.type) return null;

    switch (buff.type) {
        case "temp_hp": {
            const { total, roll } = await rollBuffFormula(actor, buff.formula);
            if (total <= 0) return null;
            const buffAdapter = game.ionrift?.respite?.adapter;
            if (buffAdapter?.applyTempHP) {
                await buffAdapter.applyTempHP(actor, total);
            } else {
                const cur = foundry.utils.getProperty(actor, "system.attributes.hp.temp") ?? 0;
                const next = Math.max(cur, total);
                await actor.update({ "system.attributes.hp.temp": next });
            }
            const summary = `temp HP +${total}`;
            return { summary, roll: rollForChat(roll) };
        }
        case "heal": {
            const { total: heal, roll } = await rollBuffFormula(actor, buff.formula);
            if (heal <= 0) return null;
            const healAdapter = game.ionrift?.respite?.adapter;
            if (healAdapter?.applyHPRestore) {
                await healAdapter.applyHPRestore(actor, heal);
            } else {
                const hp = foundry.utils.getProperty(actor, "system.attributes.hp.value") ?? 0;
                const max = foundry.utils.getProperty(actor, "system.attributes.hp.effectivemax")
                    ?? foundry.utils.getProperty(actor, "system.attributes.hp.max") ?? hp;
                await actor.update({ "system.attributes.hp.value": Math.min(max, hp + heal) });
            }
            const summary = `healing +${heal}`;
            return { summary, roll: rollForChat(roll) };
        }
        case "exhaustion_save": {
            const dc = Number(buff.save?.dc ?? buff.formula ?? 15);
            const exAdapter = game.ionrift?.respite?.adapter;
            const conSaveBonus = exAdapter?.getSaveBonus
                ? exAdapter.getSaveBonus(actor, "con")
                : (() => {
                    const rollData = actor.getRollData?.() ?? {};
                    const fromRollData = rollData?.abilities?.con?.save;
                    if (typeof fromRollData === "number") return fromRollData;
                    const conMod = actor.system?.abilities?.con?.mod ?? 0;
                    const profBonus = actor.system?.attributes?.prof ?? 0;
                    const proficient = actor.system?.abilities?.con?.proficient ?? 0;
                    return conMod + (proficient > 0 ? Math.floor(profBonus * proficient) : 0);
                })();
            const roll = await new Roll(`1d20 + ${conSaveBonus}`).evaluate();
            const total = roll.total;
            const pass = total >= dc;
            if (pass) {
                if (exAdapter?.applyExhaustionDelta) {
                    await exAdapter.applyExhaustionDelta(actor, -1);
                } else {
                    const ex = foundry.utils.getProperty(actor, "system.attributes.exhaustion") ?? 0;
                    if (ex > 0) await actor.update({ "system.attributes.exhaustion": ex - 1 });
                }
            }
            const detail = `1d20 + ${conSaveBonus} = ${total} vs DC ${dc} (${pass ? "pass" : "fail"})`;
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>Meal Buff: Exhaustion Save</strong></p><p><i class="fas fa-dice-d20"></i> <strong>${actor.name}</strong> ${detail}. ${pass ? "Removes 1 exhaustion." : "No exhaustion removed."}</p></div>`,
                rolls: [roll],
                speaker: ChatMessage.getSpeaker({ actor })
            });
            const summary = chatDetail ? `exhaustion save (${detail})` : `exhaustion save (${pass ? "pass" : "fail"})`;
            return { summary, roll };
        }
        case "hit_die": {
            const raw = buff.formula ?? "1";
            let n = parseInt(raw, 10);
            if (Number.isNaN(n) || n <= 0) {
                const r = await new Roll(String(raw), actor.getRollData?.() ?? {}).evaluate();
                n = Math.max(0, Math.floor(Number(r.total) || 0));
            }
            const restored = await restoreHitDice(actor, n);
            if (restored > 0) {
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-heart"></i> <strong>${actor.name}</strong> restores <strong>${restored}</strong> hit die.</p></div>`,
                    speaker: ChatMessage.getSpeaker({ actor })
                });
            }
            return { summary: `hit die +${restored}`, roll: null };
        }
        case "advantage":
        case "resistance":
            return null;
        default:
            return null;
    }
}
