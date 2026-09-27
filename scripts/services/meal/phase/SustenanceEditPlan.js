/**
 * Player edits on top of the automatic ration and waterskin fill.
 * A cleared day stays empty. A chosen item fills the first open day.
 * Automatic fill still runs for days nobody has touched.
 */

export function ensureSustenancePlan(plans, actorId) {
    let plan = plans.get(actorId);
    if (!plan) {
        plan = { food: {}, water: {} };
        plans.set(actorId, plan);
    }
    return plan;
}

function giveFood(options, itemId, units, name) {
    if (!itemId || units <= 0) return;
    const opt = options.find(entry => entry.id === itemId);
    if (opt) {
        opt.quantity = (opt.quantity ?? 0) + units;
        return;
    }
    options.push({
        id: itemId,
        name: name || "Ration",
        quantity: units,
        hasBuff: false,
        isSelected: false,
        isDual: false,
        buffSummary: ""
    });
}

function takeFood(options, itemId, units) {
    if (!itemId || units <= 0) return;
    const opt = options.find(entry => entry.id === itemId);
    if (!opt) return;
    opt.quantity = Math.max(0, (opt.quantity ?? 0) - units);
}

/**
 * @param {{food?: object, water?: object}|null} plan
 * @param {object[]} foodPips
 * @param {object[]} waterPips
 * @param {object[]} foodOptions
 */
export function applySustenancePlan(plan, foodPips, waterPips, foodOptions) {
    const foodEdits = plan?.food ?? {};
    const waterEdits = plan?.water ?? {};

    for (const [key, edit] of Object.entries(foodEdits)) {
        const pip = foodPips[Number(key)];
        if (!pip?.editable) continue;
        if (edit === "") {
            giveFood(foodOptions, pip.itemId, pip.units ?? 1, pip.name);
            pip.isFed = false;
            pip.name = "";
            pip.img = null;
            pip.itemId = null;
            pip.units = 0;
            pip.isCleared = true;
            pip.editable = true;
            continue;
        }
        if (edit?.itemId) {
            const units = pip.units || 1;
            if (pip.itemId !== edit.itemId) {
                if (pip.itemId) giveFood(foodOptions, pip.itemId, units, pip.name);
                takeFood(foodOptions, edit.itemId, units);
            }
            pip.isFed = true;
            pip.name = edit.name || pip.name || "Ration";
            pip.img = edit.img || pip.img || null;
            pip.itemId = edit.itemId;
            pip.units = units;
            pip.isCleared = false;
            pip.editable = true;
        }
    }

    for (const [key, pours] of Object.entries(waterEdits)) {
        const pip = waterPips[Number(key)];
        if (!pip?.editable && !Array.isArray(pours)) continue;
        if (!pip) continue;
        const list = Array.isArray(pours) ? pours : [];
        pip.pours = list.map(pour => ({
            itemId: pour.itemId ?? null,
            name: pour.name ?? "",
            img: pour.img ?? null,
            pints: pour.pints ?? 0
        }));
        pip.name = list.map(pour => pour.name).filter(Boolean).join(", ");
        pip.isHydrated = false;
        pip.isCleared = list.length === 0;
        pip.editable = true;
    }

    const foodShort = foodPips.filter(pip => !pip.isFed).length;
    const waterShort = waterPips.filter(pip => {
        if (!pip.editable) return false;
        const need = pip.need ?? 0;
        const filled = (pip.pours ?? []).reduce((sum, pour) => sum + (pour.pints || 0), 0);
        if (pip.pours) return need > 0 && filled < need;
        return !pip.isHydrated;
    }).length;

    return { foodShort, waterShort };
}

export function pourCount(pours) {
    return (pours ?? []).reduce((sum, pour) => sum + (pour.pints || 0), 0);
}

export function clonePours(pours) {
    return (pours ?? []).map(pour => ({
        itemId: pour.itemId ?? null,
        name: pour.name ?? "",
        img: pour.img ?? null,
        pints: pour.pints ?? 0
    }));
}

export function removePint(pours, pintIndex) {
    const next = clonePours(pours);
    let cursor = 0;
    for (const pour of next) {
        if (pintIndex < cursor + pour.pints) {
            pour.pints -= 1;
            break;
        }
        cursor += pour.pints;
    }
    return next.filter(pour => pour.pints > 0);
}

export function addPint(pours, itemId, name, img) {
    const next = clonePours(pours);
    const existing = next.find(pour => pour.itemId === itemId);
    if (existing) {
        existing.pints += 1;
        if (img) existing.img = img;
    } else {
        next.push({ itemId, name, img: img || null, pints: 1 });
    }
    return next;
}
