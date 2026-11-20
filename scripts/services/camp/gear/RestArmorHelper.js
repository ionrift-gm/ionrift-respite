/**
 * System-aware rest armor lookup and doff/don helper.
 *
 * DnD5e: medium or heavy equipment worn while sleeping incurs Xanathar penalties.
 * PF2e: light, medium, or heavy armor worn without the "comfort" trait inflicts
 * Fatigued on rest (Player Core). Unarmored items (Explorer's Clothing) and
 * armor with the "comfort" trait (padded armor, Comfort rune) are exempt.
 */

function pf2eHasComfortTrait(item) {
    if (!item) return false;
    if (typeof item.traits?.has === "function" && item.traits.has("comfort")) {
        return true;
    }
    const rawTraits = item.system?.traits?.value;
    if (Array.isArray(rawTraits)) {
        return rawTraits.some(t => String(t).toLowerCase() === "comfort");
    }
    return false;
}

function pf2eIsArmorEquipped(item) {
    if (!item || item.type !== "armor") return false;
    if (item.isEquipped === true) return true;
    const eq = item.system?.equipped;
    if (eq && typeof eq === "object") {
        return eq.carryType === "worn" && eq.inSlot === true;
    }
    return false;
}

/**
 * Find equipped armor on an actor that incurs a sleeping-in-armor penalty.
 * @param {Actor|object} actor
 * @returns {{ item: object, id: string, name: string, weight: string, donTime: string }|null}
 */
export function findPf2eRestArmor(actor) {
    const items = Array.from(actor?.items ?? []);
    const weightOrder = { heavy: 3, medium: 2, light: 1 };
    const candidates = items
        .filter(item => {
            if (!pf2eIsArmorEquipped(item)) return false;
            const category = String(item.system?.category ?? "light").toLowerCase();
            if (!["light", "medium", "heavy"].includes(category)) return false;
            return !pf2eHasComfortTrait(item);
        })
        .sort((a, b) => (weightOrder[b.system?.category] ?? 0) - (weightOrder[a.system?.category] ?? 0));

    const match = candidates[0];
    if (!match) return null;
    const weight = String(match.system?.category ?? "light").toLowerCase();
    const donTime = weight === "light" ? "1 min" : "5 min";
    return {
        item: match,
        id: match.id,
        name: match.name,
        weight,
        donTime
    };
}

/**
 * Default DnD5e rest armor lookup (medium or heavy equipped armor).
 * @param {Actor|object} actor
 * @returns {{ item: object, id: string, name: string, weight: string, donTime: string }|null}
 */
export function findDefaultRestArmor(actor) {
    const items = Array.from(actor?.items ?? []);
    const heavy = items.find(i =>
        i.type === "equipment"
        && i.system?.equipped
        && (i.system?.type?.value ?? i.system?.armor?.type) === "heavy"
    );
    const medium = heavy ? null : items.find(i =>
        i.type === "equipment"
        && i.system?.equipped
        && (i.system?.type?.value ?? i.system?.armor?.type) === "medium"
    );
    const match = heavy ?? medium;
    if (!match) return null;
    const weight = (match.system?.type?.value ?? match.system?.armor?.type) === "heavy" ? "heavy" : "medium";
    const donTime = weight === "heavy" ? "10 min" : "5 min";
    return {
        item: match,
        id: match.id,
        name: match.name,
        weight,
        donTime
    };
}

/**
 * Resolve equipped armor that triggers sleeping-in-armor penalties for the active system.
 * @param {Actor|object} actor
 * @returns {{ item: object, id: string, name: string, weight: string, donTime: string }|null}
 */
export function getEquippedRestArmor(actor) {
    if (!actor) return null;
    const adapter = globalThis.game?.ionrift?.respite?.adapter;
    if (typeof adapter?.getEquippedRestArmor === "function") {
        return adapter.getEquippedRestArmor(actor);
    }
    const sysId = adapter?.id ?? globalThis.game?.system?.id ?? "";
    if (sysId === "pf2e") {
        return findPf2eRestArmor(actor);
    }
    return findDefaultRestArmor(actor);
}

/**
 * Doff or don an armor item using the active system's data model.
 * @param {Actor|object} actor
 * @param {Item|object} item
 * @param {boolean} equipped
 * @returns {Promise<void>}
 */
export async function setRestArmorEquipped(actor, item, equipped) {
    if (!item) return;
    const adapter = globalThis.game?.ionrift?.respite?.adapter;
    if (typeof adapter?.setArmorEquipped === "function") {
        await adapter.setArmorEquipped(actor, item, equipped);
        return;
    }
    const sysId = adapter?.id ?? globalThis.game?.system?.id ?? "";
    if (sysId === "pf2e") {
        if (typeof actor?.changeCarryType === "function") {
            await actor.changeCarryType(item, {
                carryType: "worn",
                handsHeld: 0,
                inSlot: Boolean(equipped)
            });
            return;
        }
        await item.update?.({
            "system.equipped.carryType": "worn",
            "system.equipped.inSlot": Boolean(equipped)
        });
        return;
    }
    await item.update?.({ "system.equipped": Boolean(equipped) });
}
