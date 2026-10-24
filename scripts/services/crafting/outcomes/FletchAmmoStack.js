/**
 * Fletched ammo joins the stack the character already carries.
 * Matches on the system ammo subtype first so localized and plural item
 * names ("Arrows", translated compendiums) still stack. Magic ammo is skipped.
 */

const AMMO_SUBTYPES = { arrows: "arrow", bolts: "crossbowBolt" };
const NAME_PATTERNS = { arrows: /arrow/i, bolts: /bolt/i };

/**
 * @param {string} [value] Follow-up value from the activity ("arrows" | "bolts").
 * @returns {"arrows"|"bolts"}
 */
export function fletchAmmoKind(value) {
    return value === "bolts" ? "bolts" : "arrows";
}

/**
 * System ammo subtype for a fletch kind.
 * @param {"arrows"|"bolts"} kind
 * @returns {string}
 */
export function fletchAmmoSubtype(kind) {
    return AMMO_SUBTYPES[fletchAmmoKind(kind)];
}

function isMagicAmmo(item) {
    const props = item.system?.properties;
    if (props?.has?.("mgc")) return true;
    if (Array.isArray(props) && props.includes("mgc")) return true;
    return /\+\d/.test(item.name ?? "");
}

/**
 * Existing mundane ammo stack of the given kind, or null.
 * @param {Actor} actor
 * @param {"arrows"|"bolts"} kind
 * @returns {Item|null}
 */
export function findFletchAmmoStack(actor, kind) {
    const resolvedKind = fletchAmmoKind(kind);
    const ammo = (actor?.items ?? []).filter(item =>
        item.type === "consumable"
        && item.system?.type?.value === "ammo"
        && !isMagicAmmo(item)
    );
    const subtype = AMMO_SUBTYPES[resolvedKind];
    return ammo.find(item => item.system?.type?.subtype === subtype)
        ?? ammo.find(item => !item.system?.type?.subtype && NAME_PATTERNS[resolvedKind].test(item.name ?? ""))
        ?? null;
}
