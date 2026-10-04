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

/**
 * One click is one pour, kept as its own layer so it can come off in one step.
 * @param {object[]} pours
 * @param {string} itemId
 * @param {string} name
 * @param {string} img
 * @param {number} count
 */
export function addPints(pours, itemId, name, img, count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const next = clonePours(pours);
    if (!n) return next;
    next.push({ itemId, name: name || "", img: img || null, pints: n });
    return next;
}

/** Drop the most recent pour, not a single pint. */
export function removeLastPour(pours) {
    const next = clonePours(pours);
    next.pop();
    return next;
}

/**
 * Take the last click off a night's water, or empty the glass.
 * `waterPours` is the pint count of each click. If it does not match the
 * filled ids, the trailing run of the same source comes off instead.
 * @param {string[]} water
 * @param {number[]} pourSizes
 * @param {"pour"|"all"} mode
 */
export function undoWaterAssignment(water, pourSizes, mode) {
    const filled = (Array.isArray(water) ? water : []).filter(value => value && value !== "skip");
    if (mode === "all" || filled.length === 0) return { water: [], waterPours: [] };
    const sizes = (Array.isArray(pourSizes) ? pourSizes : [])
        .map(count => Math.floor(Number(count) || 0))
        .filter(count => count > 0);
    const sum = sizes.reduce((total, count) => total + count, 0);
    if (sizes.length && sum === filled.length) {
        const last = sizes.pop();
        return { water: filled.slice(0, filled.length - last), waterPours: sizes };
    }
    const id = filled[filled.length - 1];
    let cut = filled.length;
    while (cut > 0 && filled[cut - 1] === id) cut -= 1;
    return { water: filled.slice(0, cut), waterPours: [] };
}

/**
 * Fill ratio for one day's glass. `pints` is the expanded stack, empty cells included.
 * @param {object[]} pints
 */
export function waterGlassFromPints(pints) {
    const list = Array.isArray(pints) ? pints : [];
    const need = list.length;
    let filled = 0;
    let surface = null;
    for (const pint of list) {
        if (!pint?.filled) continue;
        filled += 1;
        surface = pint;
    }
    return {
        need,
        filled,
        fillPercent: need > 0 ? Math.round((filled / need) * 100) : 0,
        showHalf: need > 1,
        sourceClass: surface?.sourceClass || "",
        surfaceName: surface?.name || "",
        canUndo: filled > 0,
        canEmpty: filled > 0
    };
}
