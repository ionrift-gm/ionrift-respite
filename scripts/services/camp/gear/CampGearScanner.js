import { getPartyActors } from "../../party/partyActors.js";
import { MODULE_ID } from "../../../data/moduleId.js";

/**
 * Read an ionrift-respite flag from an item or document (handles both getFlag and plain objects).
 * @param {object} doc
 * @param {string} key
 * @returns {*}
 */
export function getRespiteFlag(doc, key) {
    if (!doc) return undefined;
    if (typeof doc.getFlag === "function") {
        try {
            const val = doc.getFlag(MODULE_ID, key);
            if (val !== undefined) return val;
        } catch { /* fall through */ }
    }
    return doc.flags?.[MODULE_ID]?.[key];
}

/**
 * Read normalized system identifier / slug from an item.
 * @param {Item|object} item
 * @returns {string}
 */
export function getItemIdentifier(item) {
    const raw = item?.system?.identifier ?? item?.system?.slug ?? "";
    return typeof raw === "string" ? raw.toLowerCase().trim() : "";
}

/**
 * Read lowercased compendium source UUID from an item or actor.
 * @param {object} doc
 * @returns {string}
 */
export function getDocSourceId(doc) {
    const raw = doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? "";
    return typeof raw === "string" ? raw.toLowerCase().trim() : "";
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isBedrollItem(item) {
    if (!item) return false;
    const role = getRespiteFlag(item, "campGearRole");
    const ref = getRespiteFlag(item, "itemRef");
    if (role === "bedroll" || ref === "bedroll") return true;
    const id = getItemIdentifier(item);
    if (id === "bedroll") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])bedroll$/i.test(src)) return true;
    return (item.name ?? "").toLowerCase().includes("bedroll");
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isTentItem(item) {
    if (!item) return false;
    const role = getRespiteFlag(item, "campGearRole");
    const ref = getRespiteFlag(item, "itemRef");
    if (role === "tent" || ref === "tent" || ref === "two-person-tent") return true;
    const id = getItemIdentifier(item);
    if (id === "tent" || id === "two-person-tent") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])(?:two-person-)?tent$/i.test(src)) return true;
    return /(?:^|[\s,\-])tent\b/i.test(item.name ?? "");
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isMessKitOnlyItem(item) {
    if (!item) return false;
    const role = getRespiteFlag(item, "campGearRole");
    const ref = getRespiteFlag(item, "itemRef");
    if (role === "messkit" || role === "mess-kit" || ref === "mess-kit" || ref === "messkit") return true;
    const id = getItemIdentifier(item);
    if (id === "mess-kit" || id === "messkit") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])mess-?kit$/i.test(src)) return true;
    return (item.name ?? "").toLowerCase().includes("mess kit");
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isCooksUtensilsItem(item) {
    if (!item) return false;
    const role = getRespiteFlag(item, "campGearRole");
    const ref = getRespiteFlag(item, "itemRef");
    if (role === "cooks-utensils" || role === "cooking-utensils" || ref === "cooks-utensils" || ref === "cooking-utensils") return true;
    const id = getItemIdentifier(item);
    if (id === "cooks-utensils" || id === "cook-utensils" || id === "cooking-utensils") return true;
    const baseItem = (item.system?.type?.baseItem ?? "").toLowerCase();
    if (baseItem === "cook" || baseItem === "cooks-utensils") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])cooks?-?utensils$/i.test(src)) return true;
    const n = (item.name ?? "").toLowerCase();
    if (n.includes("mess kit")) return false;
    return (n.includes("cook") && n.includes("utensil"));
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isMessKitItem(item) {
    return isMessKitOnlyItem(item) || isCooksUtensilsItem(item);
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isTinderboxItem(item) {
    if (!item) return false;
    const role = getRespiteFlag(item, "campGearRole");
    const ref = getRespiteFlag(item, "itemRef");
    if (role === "tinderbox" || ref === "tinderbox" || ref === "flint-and-steel") return true;
    const id = getItemIdentifier(item);
    if (id === "tinderbox" || id === "flint-and-steel") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])(?:tinderbox|flint-and-steel)$/i.test(src)) return true;
    const n = (item.name ?? "").toLowerCase();
    return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isTorchItem(item) {
    if (!item) return false;
    const role = getRespiteFlag(item, "campGearRole");
    const ref = getRespiteFlag(item, "itemRef");
    const fuelType = getRespiteFlag(item, "fuelType");
    if (role === "torch" || ref === "torch" || fuelType === "torch") return true;
    const id = getItemIdentifier(item);
    if (id === "torch") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])torch$/i.test(src)) return true;
    return (item.name ?? "").toLowerCase().includes("torch");
}

const FIRE_CANTRIP_IDENTIFIERS = new Set([
    "create-bonfire",
    "produce-flame",
    "fire-bolt",
    "prestidigitation",
    "control-flames",
    "druidcraft",
    "thaumaturgy"
]);

/**
 * @param {Item|object} item
 * @param {string[]} [fireCantrips]
 * @returns {boolean}
 */
export function isFireCantripItem(item, fireCantrips = []) {
    if (!item || item.type !== "spell" || (item.system?.level !== 0)) return false;
    if (getRespiteFlag(item, "isFireCantrip") === true) return true;
    const ref = getRespiteFlag(item, "itemRef");
    if (typeof ref === "string" && FIRE_CANTRIP_IDENTIFIERS.has(ref.toLowerCase())) return true;
    const id = getItemIdentifier(item);
    if (id && (FIRE_CANTRIP_IDENTIFIERS.has(id) || fireCantrips.some(fc => fc?.toLowerCase().replace(/\s+/g, "-") === id))) {
        return true;
    }
    const src = getDocSourceId(item);
    if (src && [...FIRE_CANTRIP_IDENTIFIERS].some(cid => src.endsWith(`.${cid}`) || src.endsWith(`/${cid}`))) {
        return true;
    }
    return fireCantrips.includes(item.name);
}

/**
 * @param {Item|object} cantrip
 * @returns {boolean}
 */
export function isCreateBonfireCantrip(cantrip) {
    if (!cantrip) return false;
    if (getRespiteFlag(cantrip, "itemRef") === "create-bonfire") return true;
    const id = getItemIdentifier(cantrip);
    if (id === "create-bonfire") return true;
    const src = getDocSourceId(cantrip);
    if (src && /(?:^|[.\/])create-bonfire$/i.test(src)) return true;
    return cantrip.name === "Create Bonfire";
}

/**
 * @param {Item} item
 * @returns {boolean}
 */
export function isActorFirewoodItem(item) {
    if (!item) return false;
    const firewoodType = getRespiteFlag(item, "firewoodType") ?? getRespiteFlag(item, "fuelType");
    if (firewoodType === "kindling" || firewoodType === "firewood") return true;
    const ref = getRespiteFlag(item, "itemRef");
    if (ref === "kindling" || ref === "firewood") return true;
    const id = getItemIdentifier(item);
    if (id === "kindling" || id === "firewood") return true;
    const src = getDocSourceId(item);
    if (src && /(?:^|[.\/])(?:kindling|firewood)$/i.test(src)) return true;
    const n = (item.name ?? "").toLowerCase();
    return n.includes("firewood") || n === "kindling";
}
import {
    COMFORT_TIERS,
    boostComfort,
    getHdPenalty,
    getHpFraction,
    getExhaustionDC,
    isComfortEnabled
} from "./ComfortCalculator.js";

/**
 * CampGearScanner
 *
 * Scans party inventory for camp-relevant gear (bedroll, tent, mess kit,
 * firewood, tinderbox) and computes dual-layer comfort:
 *   - Camp Comfort (shared): terrain base + fire level + shelter spells
 *   - Personal Comfort (per-PC): camp comfort + bedroll only (tent is weather / encounter elsewhere)
 *
 * Also provides recovery previews (HP/HD/exhaustion) so the Make Camp
 * phase can show players the mechanical impact of their gear and fire state.
 */

/**
 * @param {Actor} actor
 * @returns {number}
 */
export function countActorFirewood(actor) {
    if (!actor) return 0;
    return (actor.items ?? [])
        .filter(i => isActorFirewoodItem(i))
        .reduce((sum, i) => sum + (i.system?.quantity ?? 1), 0);
}

/**
 * First stack with firewood or kindling and quantity remaining.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function findConsumableFirewoodItem(actor) {
    if (!actor) return null;
    return (actor.items ?? []).find(i =>
        isActorFirewoodItem(i) && (i.system?.quantity ?? 1) > 0
    ) ?? null;
}

/** @param {Actor} actor @returns {boolean} */
export function actorHasTinderbox(actor) {
    if (!actor) return false;
    return (actor.items ?? []).some(i => isTinderboxItem(i));
}

export class CampGearScanner {

    static isBedrollItem(item) { return isBedrollItem(item); }
    static isTentItem(item) { return isTentItem(item); }
    static isMessKitOnlyItem(item) { return isMessKitOnlyItem(item); }
    static isCooksUtensilsItem(item) { return isCooksUtensilsItem(item); }
    static isMessKitItem(item) { return isMessKitItem(item); }
    static isTinderboxItem(item) { return isTinderboxItem(item); }
    static isTorchItem(item) { return isTorchItem(item); }
    static isFireCantripItem(item, fireCantrips) { return isFireCantripItem(item, fireCantrips); }
    static isCreateBonfireCantrip(cantrip) { return isCreateBonfireCantrip(cantrip); }
    static isActorFirewoodItem(item) { return isActorFirewoodItem(item); }

    /**
     * @param {Actor} actor
     * @returns {number}
     */
    static countActorFirewood(actor) {
        return countActorFirewood(actor);
    }

    /**
     * @param {Actor} actor
     * @returns {boolean}
     */
    static actorHasTinderbox(actor) {
        return actorHasTinderbox(actor);
    }

    /**
     * @param {Actor} actor
     * @returns {Item|null}
     */
    static findConsumableFirewoodItem(actor) {
        return findConsumableFirewoodItem(actor);
    }

    static getRules(tier) {
        return {
            hpFraction: getHpFraction(tier),
            hdPenalty: getHdPenalty(tier),
            exhaustionDC: getExhaustionDC(tier),
            label: CampGearScanner._tierLabel(tier)
        };
    }

    /**
     * Display label for a comfort tier id.
     * @param {string} tier
     * @returns {string}
     */
    static _tierLabel(tier) {
        switch (tier) {
            case "safe": return game.i18n.localize("ionrift-respite.campGear.tier.safe");
            case "sheltered": return game.i18n.localize("ionrift-respite.campGear.tier.sheltered");
            case "rough": return game.i18n.localize("ionrift-respite.campGear.tier.rough");
            case "hostile": return game.i18n.localize("ionrift-respite.campGear.tier.hostile");
            default: return tier.charAt(0).toUpperCase() + tier.slice(1);
        }
    }

    /**
     * Display label for a fire level id (unlit | embers | campfire | bonfire).
     * @param {string} level
     * @returns {string}
     */
    static fireLevelLabel(level) {
        switch (level) {
            case "unlit": return game.i18n.localize("ionrift-respite.fireLevel.unlit");
            case "embers": return game.i18n.localize("ionrift-respite.fireLevel.embers");
            case "campfire": return game.i18n.localize("ionrift-respite.fireLevel.campfire");
            case "bonfire": return game.i18n.localize("ionrift-respite.fireLevel.bonfire");
            default: return level.charAt(0).toUpperCase() + level.slice(1);
        }
    }

    /**
     * Concise recovery rule summary for a given comfort tier.
     * @param {string} tier - "safe" | "sheltered" | "rough" | "hostile"
     * @returns {string}
     */
    static getSummary(tier) {
        switch (tier) {
            case "safe":
                return game.i18n.localize("ionrift-respite.campGear.summary.safe");
            case "sheltered":
                return game.i18n.localize("ionrift-respite.campGear.summary.sheltered");
            case "rough":
                return game.i18n.localize("ionrift-respite.campGear.summary.rough");
            case "hostile":
                return game.i18n.localize("ionrift-respite.campGear.summary.hostile");
            default:
                return game.i18n.localize("ionrift-respite.campGear.summary.default");
        }
    }

    /**
     * Format a clear, non-punitive Hit Dice recovery label.
     * @param {object} params
     * @param {number} params.currentHd
     * @param {number} params.totalHd
     * @param {number} params.hdRecovered
     * @param {number} [params.hdPenalty=0]
     * @returns {string}
     */
    static formatHdRecoveryLabel({ currentHd, totalHd, hdRecovered, hdPenalty = 0 }) {
        if (totalHd <= 0) return game.i18n.localize("ionrift-respite.campGear.hd.none");
        if (currentHd >= totalHd) {
            return game.i18n.format("ionrift-respite.campGear.hd.atMax", { total: totalHd });
        }
        if (hdRecovered <= 0) {
            return hdPenalty > 0
                ? game.i18n.format("ionrift-respite.campGear.hd.noneRecoveredPenalty", { penalty: hdPenalty, current: currentHd, total: totalHd })
                : game.i18n.format("ionrift-respite.campGear.hd.noneRecovered", { current: currentHd, total: totalHd });
        }
        const needed = totalHd - currentHd;
        const effective = Math.min(hdRecovered, needed);
        const exitHd = currentHd + effective;
        if (hdPenalty > 0) {
            return effective === 1
                ? game.i18n.format("ionrift-respite.campGear.hd.recoverOnePenalty", { count: effective, exit: exitHd, total: totalHd, penalty: hdPenalty })
                : game.i18n.format("ionrift-respite.campGear.hd.recoverManyPenalty", { count: effective, exit: exitHd, total: totalHd, penalty: hdPenalty });
        }
        return effective === 1
            ? game.i18n.format("ionrift-respite.campGear.hd.recoverOne", { count: effective, exit: exitHd, total: totalHd })
            : game.i18n.format("ionrift-respite.campGear.hd.recoverMany", { count: effective, exit: exitHd, total: totalHd });
    }

    /**
     * Format the compact recovery benefit summary for chips/badges.
     * @param {object} params
     * @param {string} params.personalComfort - "safe" | "sheltered" | "rough" | "hostile"
     * @param {boolean} params.isAlreadyFull - whether character is already at max Hit Dice
     * @param {number} [params.hpFraction=1.0]
     * @returns {string} e.g. "Full HP · Max HD · DC 10 Save" or "Full HP · −1 HD Pen · DC 10 Save"
     */
    static formatBenefitSummary({ personalComfort, isAlreadyFull, hpFraction = 1.0 }) {
        const hpText = hpFraction < 1.0 ? game.i18n.format("ionrift-respite.campGear.benefit.hpPercent", { percent: Math.round(hpFraction * 100) }) : game.i18n.localize("ionrift-respite.campGear.benefit.hpFull");
        const hdText = isAlreadyFull
            ? game.i18n.localize("ionrift-respite.campGear.benefit.maxHd")
            : (personalComfort === "rough" ? game.i18n.localize("ionrift-respite.campGear.benefit.hdPenalty1") : personalComfort === "hostile" ? game.i18n.localize("ionrift-respite.campGear.benefit.hdPenalty2") : game.i18n.localize("ionrift-respite.campGear.benefit.normalHd"));
        const saveText = personalComfort === "rough"
            ? ` · ${game.i18n.localize("ionrift-respite.campGear.benefit.dc10Save")}`
            : personalComfort === "hostile"
                ? ` · ${game.i18n.localize("ionrift-respite.campGear.benefit.dc15Save")}`
                : "";
        return `${hpText} · ${hdText}${saveText}`;
    }

    /**
     * Format positive recovery perks without the exhaustion save attached.
     * @param {object} params
     * @param {string} params.personalComfort
     * @param {boolean} params.isAlreadyFull
     * @param {number} [params.hpFraction=1.0]
     * @returns {string} e.g. "Full HP · Max HD" or "Full HP · −1 HD Pen"
     */
    static formatPositiveBenefitSummary({ personalComfort, isAlreadyFull, hpFraction = 1.0 }) {
        const hpText = hpFraction < 1.0 ? game.i18n.format("ionrift-respite.campGear.benefit.hpPercent", { percent: Math.round(hpFraction * 100) }) : game.i18n.localize("ionrift-respite.campGear.benefit.hpFull");
        const hdText = isAlreadyFull
            ? game.i18n.localize("ionrift-respite.campGear.benefit.maxHd")
            : (personalComfort === "rough" ? game.i18n.localize("ionrift-respite.campGear.benefit.hdPenalty1") : personalComfort === "hostile" ? game.i18n.localize("ionrift-respite.campGear.benefit.hdPenalty2") : game.i18n.localize("ionrift-respite.campGear.benefit.normalHd"));
        return `${hpText} · ${hdText}`;
    }

    static FIREWOOD_COST_BY_LEVEL = Object.freeze({
        embers: 1,
        campfire: 2,
        bonfire: 3
    });

    /** @param {string} level - embers | campfire | bonfire */
    static firewoodCostLabel(level) {
        const n = this.FIREWOOD_COST_BY_LEVEL[level] ?? 0;
        return game.i18n.format("ionrift-respite.campGear.firewoodCost", { count: n });
    }

    /**
     * Encounter modifier from fire size.
     *
     * DESIGN RULE, DO NOT CHANGE WITHOUT A FAILING TEST:
     * Fire is a BEACON. A campfire attracts wandering monsters; a bonfire more so.
     * These values are NEGATIVE so that, in the RestFlowEngine formula
     *   effectiveDC = baseDC − campMods   (where campMods = shelter + weather + fire)
     * a negative fire value subtracts a negative, i.e. RAISES effectiveDC.
     * Higher effectiveDC = harder to roll over = more encounters. That is correct.
     *
     * Mnemonic: "fire raises the DC, fire raises the danger."
     * If you think it should be positive (safety angle), you are wrong. See RestFlowEngine.test.js.
     * "fire is a beacon" suite.
     */
    static FIRE_ENCOUNTER_MOD_BY_LEVEL = Object.freeze({
        cold_camp: 2,  // dark camp: stealth bonus, LOWERS effectiveDC (fewer encounters)
        unlit:     0,   // undecided, no modifier
        embers:    0,   // barely visible, no encounter change
        campfire: -1,  // visible glow: +1 encounter DC (harder to avoid encounters)
        bonfire:  -2   // obvious beacon: +2 encounter DC (significantly harder to avoid encounters)
    });

    /**
     * Canvas flame token: footprint, art scale, and light (bright/dim in scene distance units, usually feet).
     * Merged over template actor light when the fire is lit. Tuned so embers read as a small deep-red glow,
     * campfire as classic warm orange, bonfire as broad yellow-white.
     */
    static FIRE_TOKEN_VISUAL_BY_LEVEL = Object.freeze({
        embers: {
            width: 0.82,
            height: 0.82,
            textureScale: 0.86,
            light: {
                bright: 6,
                dim: 16,
                color: "#6e1418",
                alpha: 0.44,
                luminosity: 0.28,
                saturation: 0.12,
                coloration: 1,
                animation: { type: "torch", speed: 2, intensity: 2, reverse: false }
            }
        },
        campfire: {
            width: 0.95,
            height: 0.95,
            textureScale: 0.96,
            light: {
                bright: 10,
                dim: 22,
                color: "#ff9329",
                alpha: 0.40,
                luminosity: 0.44,
                saturation: 0.02,
                coloration: 1,
                animation: { type: "torch", speed: 3, intensity: 4, reverse: false }
            }
        },
        bonfire: {
            width: 1.12,
            height: 1.12,
            textureScale: 1.06,
            light: {
                bright: 15,
                dim: 26,
                color: "#ffb833",
                alpha: 0.44,
                luminosity: 0.50,
                saturation: 0.08,
                coloration: 1,
                animation: { type: "torch", speed: 4, intensity: 6, reverse: false }
            }
        }
    });

    /**
     * Scans a single actor's inventory for camp gear.
     * @param {Actor} actor
     * @returns {Object} Gear presence flags and item details.
     */
    static scanActor(actor) {
        const rawItems = Array.from(actor?.items ?? []);

        const hasBedroll = rawItems.some(i => isBedrollItem(i));
        const hasTent = rawItems.some(i => isTentItem(i));
        const hasMessKit = rawItems.some(i => isMessKitItem(i));
        const hasTinderbox = rawItems.some(i => isTinderboxItem(i));

        const firewoodCount = countActorFirewood(actor);

        return {
            actorId: actor.id,
            actorName: actor.name,
            actorImg: actor.img || "icons/svg/mystery-man.svg",
            hasBedroll,
            hasTent,
            hasMessKit,
            hasTinderbox,
            firewoodCount
        };
    }

    /**
     * Scans all party members and computes camp + personal comfort.
     * @param {string} terrainComfort - Base comfort from terrain (e.g. "rough").
     * @param {string} fireLevel - Fire level: "unlit", "embers", "campfire", or "bonfire".
     * @param {string|null} shelterSpell - Active shelter spell name, or null.
     * @param {string} comfortReason - Optional description of terrain comfort source.
     * @param {string} terrainLabel - Display name of the terrain.
     * @param {number} fireEncounterMod - Encounter DC modifier from having a fire.
     * @param {boolean} [safeRestSpot] - When true, skip comfort tiers and encounter fire modifier; fire reads as campfire for previews.
     * @returns {Object} Full camp scan results with comfort breakdown.
     */
    static scan(terrainComfort, fireLevel = "unlit", shelterSpell = null, comfortReason = "", terrainLabel = "", fireEncounterMod = 1, safeRestSpot = false, options = {}) {
        const {
            enforceBedroll = true,
            enforceTent = true,
            enforceMessKit = true
        } = options;
        const actors = getPartyActors();
        const members = actors.map(a => this.scanActor(a));

        if (safeRestSpot) {
            const campComfort = "safe";
            const rules = this.getRules(campComfort);
            const fireLevelEff = "campfire";
            const fireIsLit = true;
            const personalCards = members.map(m => {
                const effectiveHasBedroll = !enforceBedroll || m.hasBedroll;
                const effectiveHasTent = !enforceTent || m.hasTent;
                const effectiveHasMessKit = !enforceMessKit || m.hasMessKit;
                const actor = actors.find(a => a.id === m.actorId);
                const totalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
                const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));
                const hdRecovered = Math.max(0, rawHdRecovery - rules.hdPenalty + (effectiveHasBedroll ? 1 : 0));
                const currentHd = actor?.system?.attributes?.hd?.value ?? totalHd;
                const exitHd = Math.min(totalHd, currentHd + hdRecovered);
                const isAlreadyFull = currentHd >= totalHd;
                const breakdown = [];
                if (effectiveHasBedroll) {
                    breakdown.push({
                        label: !enforceBedroll && !m.hasBedroll ? game.i18n.localize("ionrift-respite.campGear.gear.bedrollWaived") : game.i18n.localize("ionrift-respite.campGear.gear.bedroll"),
                        icon: "fas fa-bed",
                        delta: 1
                    });
                }
                return {
                    ...m,
                    hasBedroll: effectiveHasBedroll,
                    hasTent: effectiveHasTent,
                    hasMessKit: effectiveHasMessKit,
                    bedrollWaived: !enforceBedroll && !m.hasBedroll,
                    tentWaived: !enforceTent && !m.hasTent,
                    messKitWaived: !enforceMessKit && !m.hasMessKit,
                    personalComfort: campComfort,
                    personalComfortLabel: rules.label,
                    personalMatchesCamp: true,
                    gearBreakdown: breakdown,
                    recovery: {
                        hpFull: true,
                        hpLabel: game.i18n.localize("ionrift-respite.campGear.recovery.regainAllHp"),
                        hpSeverity: "",
                        hdLabel: this.formatHdRecoveryLabel({
                            currentHd,
                            totalHd,
                            hdRecovered,
                            hdPenalty: rules.hdPenalty
                        }),
                        hdSeverity: "",
                        hdRecovered,
                        totalHd,
                        currentHd,
                        isAlreadyFull,
                        benefitSummary: this.formatBenefitSummary({
                            personalComfort: campComfort,
                            isAlreadyFull,
                            hpFraction: 1.0
                        }),
                        exhaustionDC: null,
                        exhaustionSeverity: null,
                        exhaustionAdvantage: false,
                        exhaustionLabel: game.i18n.localize("ionrift-respite.campGear.noExhaustionRisk")
                    }
                };
            });
            const fireLighters = members
                .filter(m => m.hasTinderbox)
                .map(m => ({
                    actorId: m.actorId,
                    actorName: m.actorName,
                    method: "Tinderbox"
                }));
            const firewoodHolders = members
                .filter(m => m.firewoodCount > 0)
                .map(m => ({ actorId: m.actorId, name: m.actorName, count: m.firewoodCount }));
            const totalFirewood = firewoodHolders.reduce((sum, h) => sum + h.count, 0);
            const costEmbers = this.FIREWOOD_COST_BY_LEVEL.embers ?? 0;
            const costCampfire = this.FIREWOOD_COST_BY_LEVEL.campfire ?? 1;
            const costBonfire = this.FIREWOOD_COST_BY_LEVEL.bonfire ?? 2;
            const canTinder = fireLighters.length > 0;
            return {
                campComfort,
                campComfortPreFire: campComfort,
                campComfortLabel: rules.label,
                comfortTooltip: game.i18n.localize("ionrift-respite.campGear.safeComfortTooltip"),
                campBreakdown: [{ label: terrainLabel || game.i18n.localize("ionrift-respite.campGear.breakdown.safeRestSpot"), value: "safe", delta: 0 }],
                comfortReason,
                terrainLabel,
                fireEncounterMod: 0,
                hasModifiers: false,
                personalCards,
                fireLighters,
                firewoodHolders,
                totalFirewood,
                canLightFire: fireLighters.length > 0,
                fireSelection: {
                    canPickEmbers: true,
                    canPickCampfire: true,
                    canPickBonfire: canTinder && totalFirewood >= costBonfire,
                    costEmbers,
                    costCampfire,
                    costBonfire
                },
                fireIsLit,
                fireLevel: fireLevelEff,
                shelterSpell: null,
                noFirePreview: null
            };
        }

        if (!isComfortEnabled()) {
            const campComfort = "safe";
            const rules = this.getRules(campComfort);
            const personalCards = members.map(m => {
                const effectiveHasBedroll = !enforceBedroll || m.hasBedroll;
                const effectiveHasTent = !enforceTent || m.hasTent;
                const effectiveHasMessKit = !enforceMessKit || m.hasMessKit;
                const actor = actors.find(a => a.id === m.actorId);
                const totalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
                const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));
                const currentHd = actor?.system?.attributes?.hd?.value ?? totalHd;
                const exitHd = Math.min(totalHd, currentHd + rawHdRecovery);
                const isAlreadyFull = currentHd >= totalHd;
                return {
                    ...m,
                    hasBedroll: effectiveHasBedroll,
                    hasTent: effectiveHasTent,
                    hasMessKit: effectiveHasMessKit,
                    bedrollWaived: !enforceBedroll && !m.hasBedroll,
                    tentWaived: !enforceTent && !m.hasTent,
                    messKitWaived: !enforceMessKit && !m.hasMessKit,
                    personalComfort: campComfort,
                    personalComfortLabel: rules.label,
                    personalMatchesCamp: true,
                    gearBreakdown: [],
                    recovery: {
                        hpFull: true,
                        hpLabel: game.i18n.localize("ionrift-respite.campGear.recovery.regainAllHp"),
                        hpSeverity: "",
                        hdLabel: this.formatHdRecoveryLabel({
                            currentHd,
                            totalHd,
                            hdRecovered: rawHdRecovery,
                            hdPenalty: 0
                        }),
                        hdSeverity: "",
                        hdRecovered: rawHdRecovery,
                        totalHd,
                        currentHd,
                        isAlreadyFull,
                        benefitSummary: this.formatBenefitSummary({
                            personalComfort: campComfort,
                            isAlreadyFull,
                            hpFraction: 1.0
                        }),
                        exhaustionDC: null,
                        exhaustionSeverity: null,
                        exhaustionAdvantage: false,
                        exhaustionLabel: game.i18n.localize("ionrift-respite.campGear.noExhaustionRisk")
                    }
                };
            });
            return {
                campComfort,
                campComfortPreFire: campComfort,
                campComfortLabel: rules.label,
                comfortTooltip: game.i18n.localize("ionrift-respite.campGear.comfortDisabledTooltip"),
                campBreakdown: [{ label: terrainLabel || game.i18n.localize("ionrift-respite.campGear.breakdown.baseTerrain"), value: "safe", delta: 0 }],
                comfortReason,
                terrainLabel,
                fireEncounterMod: 0,
                hasModifiers: false,
                personalCards,
                fireLighters: [],
                firewoodHolders: [],
                totalFirewood: 0,
                canLightFire: false,
                fireSelection: {
                    canPickEmbers: false,
                    canPickCampfire: false,
                    canPickBonfire: false,
                    costEmbers: this.FIREWOOD_COST_BY_LEVEL.embers,
                    costCampfire: this.FIREWOOD_COST_BY_LEVEL.campfire,
                    costBonfire: this.FIREWOOD_COST_BY_LEVEL.bonfire
                },
                fireIsLit: false,
                fireLevel: "unlit",
                shelterSpell,
                noFirePreview: null
            };
        }

        let campComfort = COMFORT_TIERS.includes(terrainComfort) ? terrainComfort : "rough";

        const campBreakdown = [
            { label: terrainLabel || game.i18n.localize("ionrift-respite.campGear.breakdown.baseTerrain"), value: campComfort, delta: 0 }
        ];

        // Shelter spell overrides to sheltered minimum
        if (shelterSpell) {
            if (campComfort === "hostile" || campComfort === "rough") {
                campBreakdown.push({ label: shelterSpell, value: "sheltered", delta: campComfort === "hostile" ? 2 : 1 });
                campComfort = "sheltered";
            }
        }

        const campComfortPreFire = campComfort;

        // Fire comfort matches resolution engine (FIRE_COMFORT_MOD):
        // unlit: -1 | embers: 0 | campfire: 0 | bonfire: +1
        const FIRE_COMFORT = { unlit: -1, cold_camp: -1, embers: 0, campfire: 0, bonfire: 1 };
        const fireComfortDelta = FIRE_COMFORT[fireLevel] ?? 0;
        const fireIsLit = fireLevel !== "unlit" && fireLevel !== "cold_camp";

        if (fireLevel === "cold_camp") {
            campBreakdown.push({ label: game.i18n.localize("ionrift-respite.campGear.breakdown.coldCamp"), value: "-1 comfort", delta: -1 });
            campComfort = boostComfort(campComfort, -1);
        } else if (fireLevel === "unlit") {
            campBreakdown.push({ label: game.i18n.localize("ionrift-respite.campGear.breakdown.noFire"), value: "-1 comfort", delta: 0 });
            campComfort = boostComfort(campComfort, -1);
        } else if (fireLevel === "embers") {
            campBreakdown.push({ label: game.i18n.localize("ionrift-respite.campGear.breakdown.embers"), value: "fire active", delta: 0 });
        } else if (fireLevel === "campfire") {
            campBreakdown.push({ label: game.i18n.localize("ionrift-respite.campGear.breakdown.campfire"), value: "fire active", delta: 0 });
        } else if (fireLevel === "bonfire") {
            campBreakdown.push({ label: game.i18n.localize("ionrift-respite.campGear.breakdown.bonfire"), value: "+1", delta: 1 });
            campComfort = boostComfort(campComfort, 1);
        }

        const campComfortLabel = this.getRules(campComfort).label;
        const _tr = this.getRules(campComfort);
        const _tipParts = [];
        _tipParts.push(_tr.hpFraction < 1 ? game.i18n.format("ionrift-respite.campGear.tip.hpPercentRecovery", { percent: Math.round(_tr.hpFraction * 100) }) : game.i18n.localize("ionrift-respite.campGear.tip.hpFullRecovery"));
        if (_tr.hdPenalty > 0) _tipParts.push(game.i18n.format("ionrift-respite.campGear.tip.hdRecovery", { penalty: _tr.hdPenalty }));
        if (_tr.exhaustionDC) _tipParts.push(game.i18n.format("ionrift-respite.campGear.conSaveOrExhaustion", { dc: _tr.exhaustionDC }));
        else _tipParts.push(game.i18n.localize("ionrift-respite.campGear.noExhaustionRisk"));
        const comfortTooltip = _tipParts.join(", ");

        const personalCards = members.map(m => {
            let personalComfort = campComfort;
            const breakdown = [];

            const effectiveHasBedroll = !enforceBedroll || m.hasBedroll;
            const effectiveHasTent = !enforceTent || m.hasTent;
            const effectiveHasMessKit = !enforceMessKit || m.hasMessKit;

            if (effectiveHasBedroll) {
                breakdown.push({
                    label: !enforceBedroll && !m.hasBedroll ? game.i18n.localize("ionrift-respite.campGear.gear.bedrollWaived") : game.i18n.localize("ionrift-respite.campGear.gear.bedroll"),
                    icon: "fas fa-bed",
                    delta: 1
                });
                personalComfort = boostComfort(personalComfort, 1);
            }
            // Tent: camp-wide weather shield and encounter DC buff. Benefits all party members, not personal comfort.

            const rules = this.getRules(personalComfort);

            // Recovery preview (approximate; final numbers come from RestFlowEngine)
            const actor = actors.find(a => a.id === m.actorId);
            const totalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
            const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));
            const hdRecovered = Math.max(0, rawHdRecovery - rules.hdPenalty + (effectiveHasBedroll ? 1 : 0));

            const currentHd = actor?.system?.attributes?.hd?.value ?? totalHd;
            const exitHd = Math.min(totalHd, currentHd + hdRecovered);

            const hpSeverity = rules.hpFraction < 1.0 ? "danger" : "";
            const isAlreadyFull = currentHd >= totalHd;
            let hdSeverity = "";
            if (isAlreadyFull) hdSeverity = "";
            else if (hdRecovered === 0) hdSeverity = "danger";
            else if (rules.hdPenalty > 0) hdSeverity = "warning";

            return {
                ...m,
                hasBedroll: effectiveHasBedroll,
                hasTent: effectiveHasTent,
                hasMessKit: effectiveHasMessKit,
                bedrollWaived: !enforceBedroll && !m.hasBedroll,
                tentWaived: !enforceTent && !m.hasTent,
                messKitWaived: !enforceMessKit && !m.hasMessKit,
                personalComfort,
                personalComfortLabel: rules.label,
                personalMatchesCamp: personalComfort === campComfort,
                gearBreakdown: breakdown,
                recovery: {
                    hpFull: rules.hpFraction >= 1.0,
                    hpLabel: rules.hpFraction >= 1.0 ? game.i18n.localize("ionrift-respite.campGear.recovery.regainAllHp") : game.i18n.format("ionrift-respite.campGear.recovery.regainPercentHp", { percent: Math.round(rules.hpFraction * 100) }),
                    hpSeverity,
                    hdLabel: this.formatHdRecoveryLabel({
                        currentHd,
                        totalHd,
                        hdRecovered,
                        hdPenalty: rules.hdPenalty
                    }),
                    hdSeverity,
                    hdRecovered,
                    totalHd,
                    currentHd,
                    isAlreadyFull,
                    benefitSummary: this.formatBenefitSummary({
                        personalComfort,
                        isAlreadyFull,
                        hpFraction: rules.hpFraction
                    }),
                    exhaustionDC: rules.exhaustionDC,
                    exhaustionSeverity: rules.exhaustionDC ? (personalComfort === "hostile" ? "danger" : "warning") : null,
                    exhaustionAdvantage: Boolean(rules.exhaustionDC && effectiveHasMessKit),
                    exhaustionLabel: (() => {
                        if (!rules.exhaustionDC) return game.i18n.localize("ionrift-respite.campGear.noExhaustionRisk");
                        const dc = rules.exhaustionDC;
                        if (!fireIsLit && !effectiveHasBedroll) return game.i18n.format("ionrift-respite.campGear.exhaustion.noCampfireNoBedroll", { dc });
                        if (!fireIsLit) return game.i18n.format("ionrift-respite.campGear.exhaustion.noCampfire", { dc });
                        if (!effectiveHasBedroll) return game.i18n.format("ionrift-respite.campGear.exhaustion.noBedroll", { dc });
                        return game.i18n.format("ionrift-respite.campGear.exhaustion.harshTerrain", { dc });
                    })()
                }
            };
        });

        const fireLighters = members
            .filter(m => m.hasTinderbox)
            .map(m => ({
                actorId: m.actorId,
                actorName: m.actorName,
                method: "Tinderbox"
            }));

        const firewoodHolders = members
            .filter(m => m.firewoodCount > 0)
            .map(m => ({ actorId: m.actorId, name: m.actorName, count: m.firewoodCount }));

        const totalFirewood = firewoodHolders.reduce((sum, h) => sum + h.count, 0);

        const costEmbers = this.FIREWOOD_COST_BY_LEVEL.embers ?? 0;
        const costCampfire = this.FIREWOOD_COST_BY_LEVEL.campfire ?? 1;
        const costBonfire = this.FIREWOOD_COST_BY_LEVEL.bonfire ?? 2;
        const canTinder = fireLighters.length > 0;
        const fireSelection = {
            canPickEmbers: canTinder && totalFirewood >= costEmbers,
            canPickCampfire: canTinder && totalFirewood >= costCampfire,
            canPickBonfire: canTinder && totalFirewood >= costBonfire,
            costEmbers,
            costCampfire,
            costBonfire
        };

        // Undo the current fire delta and apply the unlit penalty (-1)
        const noFireComfort = boostComfort(campComfortPreFire, FIRE_COMFORT.unlit);
        const noFireRules = this.getRules(noFireComfort);

        return {
            campComfort,
            campComfortPreFire,
            campComfortLabel,
            comfortTooltip,
            campBreakdown,
            comfortReason,
            terrainLabel,
            fireEncounterMod,
            hasModifiers: campBreakdown.length > 1,
            personalCards,
            fireLighters,
            firewoodHolders,
            totalFirewood,
            canLightFire: fireLighters.length > 0,
            fireSelection,
            fireIsLit,
            fireLevel,
            shelterSpell,

            // "Without fire" comparison data (only relevant if fire IS lit)
            noFirePreview: fireIsLit ? {
                comfort: noFireComfort,
                comfortLabel: noFireRules.label,
                hpLabel: noFireRules.hpFraction >= 1.0 ? game.i18n.localize("ionrift-respite.campGear.noFire.hpFull") : game.i18n.format("ionrift-respite.campGear.noFire.hpPercent", { percent: Math.round(noFireRules.hpFraction * 100) }),
                hdLabel: noFireRules.hdPenalty > 0
                    ? game.i18n.format("ionrift-respite.campGear.noFire.hdReduced", { penalty: noFireRules.hdPenalty })
                    : game.i18n.localize("ionrift-respite.campGear.noFire.hdUnchanged"),
                exhaustionDC: noFireRules.exhaustionDC,
                exhaustionLabel: noFireRules.exhaustionDC
                    ? game.i18n.format("ionrift-respite.campGear.conSaveOrExhaustion", { dc: noFireRules.exhaustionDC })
                    : game.i18n.localize("ionrift-respite.campGear.noExhaustionRisk")
            } : null
        };
    }
}
