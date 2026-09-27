/**
 * Well Fed serving and effect lifecycle. Removes the prior shared cooking-slot
 * effect, resolves immediate buffs, builds the replacement Active Effect, and
 * handles communal (party-meal) serving, leftovers, and rest-boundary cleanup.
 */

import { Logger } from "../../../utils/Logger.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MODULE_ID } from "../inventory/MealConstants.js";
import { grantMealItem } from "../inventory/MealItemGrant.js";
import { isCookingSlotEffect, stampCookingSlotFlag, actorHasCookingSlot, isCookingSlotItem } from "./CookingBuffBridge.js";
import {
    resolveBuff,
    buffToActiveEffectPartsAsync,
    wellFedDnd5eDurationFlags
} from "./MealBuffResolution.js";

/**
 * Clone a crafted meal snapshot as a single leftover portion (not a whole-party dish).
 * @param {object} itemSnapshot
 * @returns {object}
 */
export function mealSnapshotAsSingleLeftover(itemSnapshot) {
    const data = foundry.utils.duplicate(itemSnapshot);
    delete data._id;
    data.system = foundry.utils.mergeObject(data.system ?? {}, { quantity: 1 });
    const flags = foundry.utils.duplicate(data.flags ?? {});
    flags[MODULE_ID] = { ...(flags[MODULE_ID] ?? {}), partyMeal: false };
    data.flags = flags;
    return data;
}

/**
 * Apply Well Fed + optional chat after one serving is removed from inventory.
 */
export async function dispatchWellFedMealServing({ consumerActor, itemSnapshot, partyIds, verb = "eats" }) {
    const rf = itemSnapshot.flags?.[MODULE_ID] ?? {};
    const itemName = itemSnapshot.name ?? "Meal";
    const action = verb === "drinks" ? "drinks" : "eats";
    if (rf.partyMeal) {
        const summaries = [];
        const partyRolls = [];
        for (const pid of partyIds) {
            const member = game.actors.get(pid);
            if (!member) continue;
            if (!ItemClassifier.acceptsFoodBuffs(member)) continue;
            const alreadyWellFed = actorHasCookingSlot(member);
            if (alreadyWellFed) {
                const doc = mealSnapshotAsSingleLeftover(itemSnapshot);
                const ref = doc.flags?.[MODULE_ID]?.itemRef ?? doc.name ?? itemName;
                await grantMealItem(member, doc, ref, { separateItem: true });
                summaries.push(`<strong>${member.name}</strong>: packed serving (already Well Fed)`);
            } else {
                const part = await applyWellFedEffect(member, itemSnapshot);
                if (part.lines?.length) summaries.push(`<strong>${member.name}</strong>: ${part.lines.join("; ")}`);
                if (part.rolls?.length) partyRolls.push(...part.rolls);
            }
        }
        if (summaries.length) {
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${consumerActor.name}</strong>'s <strong>${itemName}</strong> feeds the whole party.</p><p>${summaries.join("<br>")}</p></div>`,
                rolls: partyRolls,
                speaker: ChatMessage.getSpeaker({ actor: consumerActor })
            });
        }
        return { lines: summaries.map(line => line.replace(/<[^>]+>/g, "")) };
    } else {
        if (!ItemClassifier.acceptsFoodBuffs(consumerActor)) {
            return { lines: [] };
        }
        const alreadyWellFed = actorHasCookingSlot(consumerActor);
        if (alreadyWellFed) {
            const doc = mealSnapshotAsSingleLeftover(itemSnapshot);
            const ref = doc.flags?.[MODULE_ID]?.itemRef ?? doc.name ?? itemName;
            await grantMealItem(consumerActor, doc, ref, { separateItem: true });
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><p><i class="fas fa-box-open"></i> <strong>${consumerActor.name}</strong> could not take another yet. <strong>${itemName}</strong> was packed away.</p></div>`,
                speaker: ChatMessage.getSpeaker({ actor: consumerActor })
            });
            return { lines: [`${itemName} packed away`] };
        } else {
            const { lines, rolls } = await applyWellFedEffect(consumerActor, itemSnapshot);
            if (lines?.length) {
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${consumerActor.name}</strong> ${action} <strong>${itemName}</strong>. ${lines.join("; ")}</p></div>`,
                    rolls: rolls ?? [],
                    speaker: ChatMessage.getSpeaker({ actor: consumerActor })
                });
            }
            return { lines: lines ?? [] };
        }
    }
}

/**
 * Apply one consumed meal or drink. Chef treats, Well Fed meals, and
 * drinks that carry a buff all come through here.
 * @param {{ consumerActor: Actor, itemSnapshot: object, partyIds?: string[], kind?: "food"|"drink" }} args
 * @returns {Promise<{ lines: string[] }>}
 */
export async function applyProvisionBuff({ consumerActor, itemSnapshot, partyIds = [], kind = "food" }) {
    const flags = itemSnapshot?.flags?.[MODULE_ID] ?? {};
    const verb = kind === "drink" ? "drinks" : "eats";
    const wellFedPayload = flags.wellFed === true && flags.buff !== null && flags.buff !== undefined;
    if (!wellFedPayload && flags.chefTreat) {
        const pb = Number(flags.chefTreatProfBonus) || 0;
        const resolved = await resolveBuff(
            consumerActor,
            { type: "temp_hp", formula: String(pb > 0 ? pb : 1) },
            { chatDetail: true }
        );
        const line = resolved?.summary ?? "Bolstering Treat";
        await ChatMessage.create({
            content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${consumerActor.name}</strong> ${verb} <strong>${itemSnapshot.name ?? "Treat"}</strong>. ${line}</p></div>`,
            rolls: resolved?.roll ? [resolved.roll] : [],
            speaker: ChatMessage.getSpeaker({ actor: consumerActor })
        });
        return { lines: [line] };
    }
    let snapshot = itemSnapshot;
    if (!wellFedPayload && flags.buff) {
        snapshot = foundry.utils.duplicate(itemSnapshot);
        snapshot.flags = snapshot.flags ?? {};
        snapshot.flags[MODULE_ID] = { ...(snapshot.flags[MODULE_ID] ?? {}), wellFed: true };
    }
    return dispatchWellFedMealServing({
        consumerActor,
        itemSnapshot: snapshot,
        partyIds,
        verb
    });
}

/**
 * Well Fed exclusive slot: remove prior AE, resolve buffs, create replacement AE when needed.
 * @param {Actor} actor
 * @param {Item|object} item - Item document or plain item data (e.g. toObject snapshot)
 * @returns {Promise<{ lines: string[], rolls: Roll[] }>} Chat lines and dice rolls for chat/DSN
 */
export async function applyWellFedEffect(actor, item) {
    const flags = item?.flags?.[MODULE_ID] ?? {};

    if (!ItemClassifier.acceptsFoodBuffs(actor)) return { lines: [], rolls: [] };
    if (flags.wellFed !== true) return { lines: [], rolls: [] };
    const buffRaw = flags.buff;
    if (buffRaw === null) return { lines: [], rolls: [] };

    const buffs = Array.isArray(buffRaw) ? buffRaw : [buffRaw];
    await removeWellFedEffects(actor);

    const immediateLines = [];
    const buffRolls = [];
    const deferredBuffs = [];
    for (const buff of buffs) {
        if (!buff?.type) continue;
        const duration = buff.duration ?? "untilLongRest";
        const forceImmediate = buff.type === "heal";
        if (duration === "immediate" || forceImmediate) {
            const resolved = await resolveBuff(actor, buff, { chatDetail: true });
            if (resolved?.summary) immediateLines.push(resolved.summary);
            if (resolved?.roll) buffRolls.push(resolved.roll);
        } else {
            deferredBuffs.push(buff);
        }
    }

    const aeChanges = [];
    const aeDescriptions = [];
    const aeDaeSpecials = [];
    const deferredSummaries = [];
    const systemId = game.ionrift?.respite?.adapter?.id ?? game.system?.id;
    const applicator = game.ionrift?.library?.cooking?.applicator;
    const itemName = item.name ?? "Meal";
    const usePf2e = systemId === "pf2e" && applicator?.hasAutomatableBuffs?.(deferredBuffs);

    if (deferredBuffs.length && usePf2e) {
        const pf2eResult = await applicator.applyBuffsRouted(actor, deferredBuffs, {
            item,
            title: `Well Fed: ${itemName}`,
            extraFlags: { [MODULE_ID]: { wellFed: true, expiresAt: "nextRestStart" } },
            clearSlot: true
        });
        if (pf2eResult.lines?.length) deferredSummaries.push(...pf2eResult.lines);
        if (pf2eResult.approximateNotes?.length) deferredSummaries.push(...pf2eResult.approximateNotes);
    } else if (deferredBuffs.length) {
        for (const buff of deferredBuffs) {
            const built = await buffToActiveEffectPartsAsync(actor, buff);
            if (built.changes?.length) aeChanges.push(...built.changes);
            if (built.description) aeDescriptions.push(built.description);
            if (built.daeSpecialDuration?.length) aeDaeSpecials.push(...built.daeSpecialDuration);
            if (built.summaryLine) deferredSummaries.push(built.summaryLine);
            if (built.roll) buffRolls.push(built.roll);
        }

        if (aeChanges.length || aeDescriptions.length) {
            const durationTag = deferredBuffs[0]?.duration ?? "untilLongRest";
            const dndFlags = wellFedDnd5eDurationFlags(durationTag);

            const ceActive = !!game.modules?.get?.("dfreds-convenient-effects")?.active;
            if (!ceActive && aeChanges.length) {
                aeDescriptions.push(
                    "Convenient Effects is not installed. This effect applies basic roll mode changes only. "
                    + "conditional automation (Midi-QoL triggers, advantage reminders) will not function."
                );
            }

            const desc = [aeDescriptions.filter(Boolean).join(" "), dndFlags.manualNote].filter(Boolean).join("\n");
            const aeFlags = {
                [MODULE_ID]: { wellFed: true, expiresAt: "nextRestStart" },
                core: { overlay: false },
                "dfreds-convenient-effects": { isConvenient: true },
                ...dndFlags.effectFlags
            };

            stampCookingSlotFlag(aeFlags);

            if (aeDaeSpecials.length) {
                const existing = aeFlags.dae?.specialDuration ?? [];
                aeFlags.dae = { specialDuration: [...new Set([...existing, ...aeDaeSpecials])] };
            }

            await actor.createEmbeddedDocuments("ActiveEffect", [{
                name: `Well Fed: ${itemName}`,
                img: item.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                origin: actor.uuid,
                transfer: false,
                disabled: false,
                duration: dndFlags.duration ?? {},
                changes: aeChanges,
                description: desc || undefined,
                flags: aeFlags
            }]);

            if (!ceActive) {
                const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
                if (gmIds.length) {
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><p><i class="fas fa-exclamation-triangle"></i> <strong>Well Fed: ${itemName}</strong> applied to <strong>${actor.name}</strong> with basic AE changes. <em>Convenient Effects</em> is not installed. Conditional triggers (expire on next save, advantage reminders) require CE + DAE/Midi-QoL.</p></div>`,
                        whisper: gmIds,
                        speaker: { alias: "Respite" }
                    });
                }
            }
        }
    }

    return { lines: [...immediateLines, ...deferredSummaries], rolls: buffRolls };
}

export async function removeWellFedEffects(actor) {
    const aeIds = actor.effects?.filter(e => isCookingSlotEffect(e)).map(e => e.id) ?? [];
    const itemIds = actor.items?.filter(i => isCookingSlotItem(i)).map(i => i.id) ?? [];
    if (aeIds.length) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", aeIds);
    }
    if (itemIds.length) {
        await actor.deleteEmbeddedDocuments("Item", itemIds);
    }
}

/**
 * Strip all Well Fed effects from party actors at the start of a new rest.
 * Called from RestSetupApp.#onBeginRest so the effect persists between
 * sessions but is cleaned up when the next long rest begins.
 * @param {Actor[]} actors - Party actors starting a new rest.
 * @returns {Promise<number>} Count of effects removed.
 */
export async function cleanupWellFedEffects(actors) {
    let removed = 0;
    for (const actor of actors) {
        const aeIds = actor.effects?.filter(e => isCookingSlotEffect(e)).map(e => e.id) ?? [];
        const itemIds = actor.items?.filter(i => isCookingSlotItem(i)).map(i => i.id) ?? [];
        if (aeIds.length) {
            await actor.deleteEmbeddedDocuments("ActiveEffect", aeIds);
            removed += aeIds.length;
        }
        if (itemIds.length) {
            await actor.deleteEmbeddedDocuments("Item", itemIds);
            removed += itemIds.length;
        }
    }
    if (removed > 0) {
        Logger.log(`[Respite:Meal] Cleaned ${removed} Well Fed effect(s) at rest start`);
    }
    return removed;
}

/**
 * Stamp specialDuration onto Well Fed AEs after longRest()/shortRest() has run.
 * Called after the native rest loop in RestSetupApp so the duration flag only
 * triggers on the NEXT rest rather than the one that just completed.
 *
 * @param {Actor[]} actors
 */
export async function stampWellFedDuration(actors) {
    for (const actor of actors) {
        const wellFedEffects = actor.effects?.filter(
            e => e.flags?.[MODULE_ID]?.wellFed === true
        ) ?? [];
        for (const ae of wellFedEffects) {
            const existing = ae.flags?.dae?.specialDuration ?? [];
            if (!existing.includes("longRest")) {
                const merged = [...new Set([...existing, "longRest"])];
                if (typeof ae?.update === "function") {
                    await ae.update({ "flags.dae.specialDuration": merged });
                } else if (ae?.flags) {
                    ae.flags.dae = ae.flags.dae || {};
                    ae.flags.dae.specialDuration = merged;
                }
            }
        }
    }
}
