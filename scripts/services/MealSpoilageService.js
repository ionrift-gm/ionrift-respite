/**
 * Food spoilage resolution for the Meal phase. Rest-phase spoilage uses rests
 * since the last long rest; calendar-driven spoilage uses harvestedDate against
 * world time. Spoiled items are replaced with a stacking "Spoiled Food" loot
 * item rather than silently deleted.
 */

import { ItemClassifier } from "./ItemClassifier.js";
import { CalendarHandler } from "./CalendarHandler.js";
import { SpoilageClock } from "./SpoilageClock.js";
import { MODULE_ID, SPOILED_FOOD_TEMPLATE } from "./MealConstants.js";
import { grantMealItem } from "./MealItemGrant.js";

/**
 * @param {Object[]} report - Spoilage report from resolveSpoilage / resolveCalendarSpoilage
 * @param {string} intro - Lead sentence before the item list (no trailing markup)
 * @param {string} gmContext - Short phrase for the GM whisper summary
 */
async function postSpoilageChat(report, intro, gmContext) {
    if (!report.length) return;

    const lines = report.flatMap(r =>
        r.spoiled.map(s => `<strong>${r.actorName}</strong> lost ${s.qty}x ${s.name}`)
    );

    await ChatMessage.create({
        content: `<div class="respite-recovery-chat"><p><i class="fas fa-skull-crossbones"></i> <strong>Spoilage</strong></p><p>${intro}</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul></div>`,
        speaker: { alias: "Respite" }
    });

    const totalSpoiled = report.reduce((sum, r) => sum + r.spoiled.reduce((s, i) => s + i.qty, 0), 0);
    await ChatMessage.create({
        content: `<p><i class="fas fa-info-circle"></i> <strong>Spoilage Report:</strong> ${totalSpoiled} item(s) spoiled across ${report.length} character(s) ${gmContext}.</p>`,
        speaker: { alias: "Respite" },
        whisper: ChatMessage.getWhisperRecipients?.("GM")
            ?? game.users.filter(u => u.isGM).map(u => u.id),
        type: CONST.CHAT_MESSAGE_TYPES.WHISPER ?? 4
    });
}

/**
 * Resolve food spoilage across all party members before the meal phase.
 *
 * Rest-phase spoilage uses **elapsed rests since last long rest**, not the
 * calendar `harvestedDate`. Calendar-driven spoilage (`resolveCalendarSpoilage`)
 * runs on world time advances and uses `harvestedDate` when present. Both can
 * apply to the same item in worlds that use calendar tracking; GMs should treat
 * whichever fires first as authoritative for that beat.
 *
 * Checks every inventory item with a `spoilsAfter` flag against
 * `daysSinceLastRest`. Spoiled items are replaced with a stacking
 * "Spoiled Food" loot item rather than silently deleted.
 * Items foraged/hunted during this rest (flagged `foragedThisRest`) are skipped.
 *
 * @param {string[]} characterIds - Actor IDs in the rest
 * @param {number} daysSinceLastRest - Days elapsed since last rest
 * @returns {Object[]} Spoilage report per character: { actorName, spoiled: [{ name, qty }] }
 */
export async function resolveSpoilage(characterIds, daysSinceLastRest = 1) {
    const report = [];

    for (const charId of characterIds) {
        const actor = game.actors.get(charId);
        if (!actor) continue;

        const result = await spoilActorItems(actor, (item, flags) => {
            if (flags.foragedThisRest) return false;
            const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
            if (spoilsAfter === null || spoilsAfter <= 0) return false;
            return daysSinceLastRest >= spoilsAfter;
        });

        if (result.spoiled.length) {
            report.push({ characterId: charId, actorName: actor.name, spoiled: result.spoiled });
        }
    }

    if (report.length) {
        const dayLabel = daysSinceLastRest === 1 ? "1 day" : `${daysSinceLastRest} days`;
        await postSpoilageChat(
            report,
            `After ${dayLabel} of travel, perishable food has gone off:`,
            `after ${dayLabel}`
        );
    }

    return report;
}

/**
 * Calendar-driven spoilage. Called when world time advances.
 * Uses harvestedDate + spoilsAfter to determine expiry.
 * Rest-phase spoilage (`resolveSpoilage`) uses rests since last long rest instead;
 * both can apply in the same world. See note on `resolveSpoilage`.
 *
 * @param {Actor[]} actors - Party actors to check
 * @returns {Object[]} Spoilage report
 */
export async function resolveCalendarSpoilage(actors) {
    const now = CalendarHandler.getCurrentDate();
    const nowEpoch = game.time.worldTime;
    const report = [];

    // First pass: stamp harvestedDate on any perishable items that lack one
    for (const actor of actors) {
        if (!actor) continue;
        const toStamp = [];
        for (const item of actor.items) {
            const spoilsHours = ItemClassifier.getSpoilsAfterHours(item);
            const spoilsAfter = spoilsHours ? null : ItemClassifier.getSpoilsAfter(item);
            if (spoilsAfter === null && !spoilsHours) continue;
            if (spoilsAfter !== null && spoilsAfter <= 0) continue;
            const flags = item.flags?.[MODULE_ID] ?? {};
            if (flags.harvestedDate) continue;
            const stamp = spoilsHours ? String(nowEpoch) : (now ?? String(nowEpoch));
            toStamp.push({ _id: item.id, [`flags.${MODULE_ID}.harvestedDate`]: stamp });
        }
        if (toStamp.length) {
            await actor.updateEmbeddedDocuments("Item", toStamp);
        }
    }

    // Second pass: check for expired items
    for (const actor of actors) {
        if (!actor) continue;

        const result = await spoilActorItems(actor, (item, flags) => {
            const spoilsHours = ItemClassifier.getSpoilsAfterHours(item);
            if (spoilsHours) {
                const harvested = flags.harvestedDate;
                if (!harvested) return false;
                const harvestedEpoch = parseInt(harvested, 10);
                if (Number.isNaN(harvestedEpoch)) return false;
                const hoursPassed = (nowEpoch - harvestedEpoch) / 3600;
                return hoursPassed >= spoilsHours;
            }

            const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
            if (spoilsAfter === null || spoilsAfter <= 0) return false;

            const harvested = flags.harvestedDate;
            if (!harvested) return false;

            // Calendar-based: compare date strings (Y-M-D format)
            if (now && harvested.includes("-")) {
                const daysPassed = SpoilageClock.dateDiffDays(harvested, now);
                return daysPassed >= spoilsAfter;
            }

            // Epoch-based fallback: harvestedDate stored as worldTime seconds
            const harvestedEpoch = parseInt(harvested, 10);
            if (!isNaN(harvestedEpoch)) {
                const secondsPerDay = 86400;
                const daysPassed = Math.floor((nowEpoch - harvestedEpoch) / secondsPerDay);
                return daysPassed >= spoilsAfter;
            }

            return false;
        });

        if (result.spoiled.length) {
            report.push({ characterId: actor.id, actorName: actor.name, spoiled: result.spoiled });
        }
    }

    if (report.length) {
        const formattedDate = CalendarHandler.getFormattedDate();
        const intro = formattedDate
            ? `On ${formattedDate}, perishable food has gone off:`
            : "Perishable food has gone off:";
        await postSpoilageChat(report, intro, "during time advance");
    }

    return report;
}

/**
 * Core spoilage processor for a single actor. Replaces spoiled items
 * with a stacking "Spoiled Food" loot item.
 *
 * @param {Actor} actor
 * @param {Function} shouldSpoil - (item, flags) => boolean predicate
 * @returns {{ spoiled: Array<{name: string, qty: number}> }}
 */
export async function spoilActorItems(actor, shouldSpoil) {
    const spoiled = [];
    const deletes = [];
    let spoiledQty = 0;

    for (const item of actor.items) {
        const flags = item.flags?.[MODULE_ID] ?? {};
        if (!shouldSpoil(item, flags)) continue;

        const qty = item.system?.quantity ?? 1;
        spoiled.push({ name: item.name, qty });
        deletes.push(item.id);
        spoiledQty += qty;
    }

    if (deletes.length) {
        await actor.deleteEmbeddedDocuments("Item", deletes);

        // Stack onto existing Spoiled Food or create a new one
        const existing = actor.items.find(
            i => i.name === "Spoiled Food" && i.flags?.[MODULE_ID]?.spoiled
        );
        if (existing) {
            const currentQty = existing.system?.quantity ?? 0;
            await existing.update({ "system.quantity": currentQty + spoiledQty });
        } else {
            const data = foundry.utils.deepClone(SPOILED_FOOD_TEMPLATE);
            data.system.quantity = spoiledQty;
            await grantMealItem(actor, data, "spoiled_food");
        }
    }

    return { spoiled };
}
