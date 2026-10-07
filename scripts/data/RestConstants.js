import { isGearDeployed } from "../services/camp/props/CompoundCampPlacer.js";
import { HD_PENALTY, boostComfort, isComfortEnabled, getComfortDcMod, COMFORT_RANK, RANK_TO_KEY } from "../services/camp/gear/ComfortCalculator.js";
import { isSimpleStationsMode } from "../services/rest/flow/RestProfileSettings.js";
import { isFletchingEnabled } from "../services/crafting/settings/FletchingSettings.js";
import { getTrainingXpValues, getTrainingXpReduction, isTrainingEnabled } from "../services/crafting/settings/TrainingSettings.js";
import { isPrayMeditateEnabled } from "../services/rest/flow/ActivityResolver.js";
import { isForagingEnabled, isHuntingEnabled } from "../services/travel/settings/TravelSettings.js";
import { MODULE_ID } from "./moduleId.js";
import { clipCardHintName } from "./activityCardHint.js";

/**
 * Weather master table. `encounterDC` raises the night check when positive.
 * `tentReduces` means a tent lowers the comfort penalty by 1.
 */
export const WEATHER_TABLE = {
    clear:          { label: "Clear",            icon: "fas fa-sun",                 hint: "No effect on comfort or encounters.",                                       comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    overcast:       { label: "Overcast",         icon: "fas fa-cloud",               hint: "No effect. Dimmer light, neutral conditions.",                              comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    fog:            { label: "Fog",              icon: "fas fa-smog",                hint: "Night check +2. Hard to see what is approaching.",                          comfortPenalty: 0, encounterDC: 2, tentCancels: true,  tentReduces: false },
    rain:           { label: "Rain",             icon: "fas fa-cloud-rain",          hint: "Comfort -1 step if unsheltered. Tent cancels.",                             comfortPenalty: 1, encounterDC: 0, tentCancels: true,  tentReduces: false },
    heavy_rain:     { label: "Heavy Rain",       icon: "fas fa-cloud-showers-heavy", hint: "Comfort -1. Night check +1. Tent cancels.",                                comfortPenalty: 1, encounterDC: 1, tentCancels: true,  tentReduces: false },
    thunderstorm:   { label: "Thunderstorm",     icon: "fas fa-bolt",                hint: "Comfort -2. Night check +2. Tent reduces comfort loss to -1. Hut cancels.", comfortPenalty: 2, encounterDC: 2, tentCancels: false, tentReduces: true },
    snow:           { label: "Snow",             icon: "fas fa-snowflake",           hint: "Comfort -1 step if unsheltered. Tent cancels.",                             comfortPenalty: 1, encounterDC: 0, tentCancels: true,  tentReduces: false },
    blizzard:       { label: "Blizzard",         icon: "fas fa-icicles",             hint: "Comfort -2. Night check +1. Tent reduces comfort loss to -1. Hut cancels.", comfortPenalty: 2, encounterDC: 1, tentCancels: false, tentReduces: true },
    extreme_cold:   { label: "Extreme Cold",     icon: "fas fa-temperature-low",     hint: "Comfort -1. Extra CON DC 10 or +1 exhaustion. Tent: partial.",             comfortPenalty: 1, encounterDC: 0, tentCancels: false, tentReduces: true },
    extreme_heat:   { label: "Extreme Heat",     icon: "fas fa-temperature-high",    hint: "Comfort -1. Extra CON DC 10 or +1 exhaustion. Tent does not help.",        comfortPenalty: 1, encounterDC: 0, tentCancels: false, tentReduces: false },
    sandstorm:      { label: "Sandstorm",        icon: "fas fa-wind",                hint: "Comfort -2. Night check +2. Tent: partial. Hut cancels.",                  comfortPenalty: 2, encounterDC: 2, tentCancels: false, tentReduces: true },
    hail:           { label: "Hail",             icon: "fas fa-cloud-meatball",      hint: "Comfort -1. Minor damage risk. Tent cancels.",                             comfortPenalty: 1, encounterDC: 0, tentCancels: true,  tentReduces: false },
    volcanic_ash:   { label: "Volcanic Ash",     icon: "fas fa-fire",                hint: "Comfort -1. Night check +1. Difficult breathing.",                         comfortPenalty: 1, encounterDC: 1, tentCancels: false, tentReduces: true },
    fungal_spores:  { label: "Fungal Spores",    icon: "fas fa-biohazard",           hint: "Comfort -1. CON save or poisoned. Tent: partial.",                         comfortPenalty: 1, encounterDC: 0, tentCancels: false, tentReduces: true },
    faerzress:      { label: "Faerzress",        icon: "fas fa-magic",               hint: "No comfort penalty. Wild magic risk on spellcasting during rest.",          comfortPenalty: 0, encounterDC: 0, tentCancels: false, tentReduces: false },
    // Tavern atmosphere (flavor only, zero mechanical effect)
    tavern_rain:    { label: "Raining Outside",  icon: "fas fa-cloud-rain",          hint: "Rain patters on the windows. A somber, reflective evening.",              comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_storm:   { label: "Stormy Outside",   icon: "fas fa-bolt",                hint: "Thunder rattles the shutters. Good night to be indoors.",                 comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    // Tavern grades (flavor only, zero mechanical effect)
    tavern_flophouse: { label: "Flophouse",      icon: "fas fa-bed",                 hint: "Hard beds, thin walls, sounds you'd rather not identify.",               comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_modest:    { label: "Modest Inn",     icon: "fas fa-home",                hint: "Clean sheets, warm stew. Nothing fancy, nothing wrong.",                comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_fine:      { label: "Fine Lodgings",  icon: "fas fa-concierge-bell",      hint: "Feather pillows, a hot bath, and someone else's cooking.",              comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_luxury:    { label: "Luxury Suite",   icon: "fas fa-gem",                 hint: "You could get used to this. You probably shouldn't.",                   comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    // Underground atmosphere (flavor)
    dungeon_normal:   { label: "Normal",         icon: "fas fa-dungeon",             hint: "Still air. Unremarkable conditions.",                                   comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    dungeon_damp:     { label: "Damp",           icon: "fas fa-tint",                hint: "Water drips from the ceiling. Everything feels clammy.",                comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false }
};

/** DnD5e skill abbreviation -> readable name */
export const SKILL_NAMES = {
    acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics",
    dec: "Deception", his: "History", ins: "Insight", itm: "Intimidation",
    inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception",
    prf: "Performance", per: "Persuasion", rel: "Religion", sle: "Sleight of Hand",
    ste: "Stealth", sur: "Survival"
};

export { COMFORT_RANK, RANK_TO_KEY };

/** Activity icon mapping */
export const ACTIVITY_ICONS = {
    act_keep_watch: "fas fa-eye", act_rest_fully: "fas fa-bed",
    act_forage: "fas fa-seedling", act_hunt: "fas fa-crosshairs",
    act_tell_tales: "fas fa-theater-masks",
    act_tend_wounds: "fas fa-hand-holding-medical", act_pray: "fas fa-pray",
    act_cook: "fas fa-utensils", act_brew: "fas fa-flask-vial", act_tailor: "fas fa-cut",
    act_craft: "fas fa-tools", act_fletch: "fas fa-feather-alt",
    act_defenses: "fas fa-shield-alt", act_train: "fas fa-dumbbell",
    act_identify: "fas fa-search", act_scribe: "fas fa-scroll",
    act_other: "fas fa-comments"
};

/** @returns {boolean} Identify tab, Examine (focus/potion), and short-rest workbench. */
export function isWorkbenchIdentifyUiEnabled() {
    try {
        return !!game.settings.get(MODULE_ID, "enableWorkbenchIdentify");
    } catch {
        return true;
    }
}

/** Focus, potion tasting, and spell Identify UI; same world toggle as Identify. */
export function isWorkbenchExamineUiEnabled() {
    return isWorkbenchIdentifyUiEnabled();
}

/**
 * One-line status for activities with no dynamic advisory.
 * The detail view keeps activity.description. Stay within CARD_HINT_MAX_CHARS.
 * Do not restate the skill or DC; the check label already shows them.
 */
export const ACTIVITY_CARD_HINTS = {
    act_tell_tales: "Inspires an ally",
    act_cook: "A meal from ingredients",
    act_tailor: "Stitch gear",
    act_craft: "Work raw materials",
    act_brew: "A trail drink",
    act_identify: "Examine an item",
    act_attune: "Bond with a magic item",
    act_other: "Your own evening",
    act_forage: "Plants, herbs, and kindling",
    act_hunt: "Fresh meat and provisions"
};

/**
 * Generate a contextual advisory for an activity card.
 * Advisory text is player-visible. Never include encounter DC or GM-only data.
 *
 * Return shape: { text, urgent, nonViable?, cardOnly? }
 *
 *   cardOnly: true when the advisory is a static mechanical summary that
 *   simply mirrors the success-outcome chevron. The card list shows it as a
 *   useful at-a-glance hint, but the detail panel suppresses it so the blue
 *   pill does not visually compete with the green outcome chevron immediately
 *   below. Use cardOnly only when the text adds nothing the outcome chevron
 *   does not already say.
 *
 * @param {string} activityId - The activity ID
 * @param {Actor5e} actor - The actor considering this activity
 * @param {object} partyState - Pre-computed party state from buildPartyState()
 * @returns {{text: string, urgent: boolean, nonViable?: boolean, cardOnly?: boolean}}
 */
export function getActivityAdvisory(activityId, actor, partyState) {
    const hp = actor.system?.attributes?.hp ?? {};
    const hpPct = hp.max ? Math.round((hp.value / hp.max) * 100) : 100;
    const hd = actor.system?.attributes?.hd ?? {};
    const hdAvail = typeof hd.value === "number" ? hd.value : (hd.available ?? 0);
    const hdMax = hd.max ?? actor.system?.details?.level ?? 1;
    const hdDeficit = hdMax - hdAvail;

    switch (activityId) {
        case "act_keep_watch": {
            const watchers = partyState.watcherCount ?? 0;
            if (!partyState.hasWatcher)
                return { text: "No one on watch", urgent: true };
            if (watchers >= 2)
                return { text: `${watchers} already on watch`, urgent: false };
            return { text: "+3 initiative, +1 party initiative", urgent: false, cardOnly: true };
        }
        case "act_tend_wounds": {
            const injured = partyState.injuredMembers.filter(m => m.id !== actor.id);
            const hasKit = actor.items?.some(i =>
                i.name?.toLowerCase().includes("healer") && i.name?.toLowerCase().includes("kit")
                && ((i.system?.uses?.value ?? i.system?.quantity ?? 0) > 0)
            );
            const hasFeat = actor.items?.some(i => i.type === "feat" && i.name?.toLowerCase() === "healer");
            const gearNote = hasFeat && hasKit ? " + Healer"
                : hasKit ? " + kit"
                : "";
            if (!injured.length)
                return { text: "No one injured", urgent: false, nonViable: true };
            const worst = injured[0];
            const suffix = ` at ${worst.hpPct}%${gearNote}`;
            return { text: `${clipCardHintName(worst.name, suffix)}${suffix}`, urgent: worst.hpPct < 50 };
        }
        case "act_defenses": {
            if (partyState.hasDefenses)
                return { text: "Defenses already set", urgent: false };
            return { text: "Fewer encounters, +1 initiative", urgent: false, cardOnly: true };
        }
        case "act_rest_fully": {
            const comfortTier = partyState.comfort ?? "sheltered";
            const isHostile = comfortTier === "hostile";
            const isRough = comfortTier === "rough";
            const isSafe = comfortTier === "safe";
            const adapter = game.ionrift?.respite?.adapter;
            const exhaustion = adapter ? adapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);

            const basePenalty = HD_PENALTY[comfortTier] ?? 0;
            const boostedPenalty = HD_PENALTY[boostComfort(comfortTier, 1)] ?? 0;
            const rawHdRecovery = Math.max(1, Math.floor(hdMax / 2));
            const hdWithout = Math.max(0, rawHdRecovery - basePenalty);
            const hdWith = Math.max(0, rawHdRecovery - boostedPenalty) + 1;
            const effectiveGain = Math.max(0, Math.min(hdWith, hdDeficit) - Math.min(hdWithout, hdDeficit));

            // Safe rest spot: Rest Fully's main value is the extra -1 exhaustion
            if (isSafe) {
                if (exhaustion >= 2)
                    return { text: `${exhaustion} exhaustion, one extra level`, urgent: true };
                if (exhaustion === 1)
                    return { text: "Clears the last exhaustion", urgent: false };
                if (hdDeficit >= 1 && effectiveGain > 0)
                    return { text: `+${effectiveGain} Hit Dice`, urgent: false };
                return { text: "No extra benefit", urgent: false, nonViable: true };
            }
            if (isHostile) {
                if (hdDeficit >= 1)
                    return { text: `Hostile. +${effectiveGain || 1} Hit Dice`, urgent: true };
                if (hpPct < 100)
                    return { text: "Hostile. Full HP recovery", urgent: true };
                return { text: "No recovery benefit", urgent: false, nonViable: true };
            }
            if (isRough) {
                if (effectiveGain > 0)
                    return { text: `Rough. +${effectiveGain} Hit Dice`, urgent: true };
                if (exhaustion >= 1)
                    return { text: "Rough. Clears exhaustion", urgent: true };
                if (hdDeficit >= 1)
                    return { text: "Comfort covers your Hit Dice", urgent: false, nonViable: true };
                return { text: "No benefit at this comfort", urgent: false, nonViable: true };
            }
            if (effectiveGain > 0)
                return { text: `+${effectiveGain} Hit Dice`, urgent: false };
            if (hdDeficit >= 1)
                return { text: "Comfort covers your Hit Dice", urgent: false, nonViable: true };
            return { text: "No recovery benefit", urgent: false, nonViable: true };
        }
        case "act_pray": {
            if (!isPrayMeditateEnabled())
                return { text: "Pray is off", urgent: false, nonViable: true };
            const prof = actor.system?.attributes?.prof ?? 2;
            return { text: `+${prof} temp HP`, urgent: false };
        }
        case "act_fletch": {
            if (!isFletchingEnabled())
                return { text: "Fletching is off", urgent: false, nonViable: true };
            const ammo = _ammoStock(actor);
            if (ammo && ammo.total < 10)
                return { text: ammo.text, urgent: true };
            return { text: "Arrows or bolts", urgent: false };
        }
        case "act_train": {
            if (!isTrainingEnabled())
                return { text: "Training is off", urgent: false, nonViable: true };
            const level = actor.system?.details?.level ?? 1;
            if (level > 5)
                return { text: "No effect above level 5", urgent: false, nonViable: true };
            const xpValues = getTrainingXpValues();
            const passXp = xpValues?.passXp ?? 10;
            const xp = actor.system?.details?.xp ?? {};
            const gap = (xp.max && xp.value !== null && xp.value !== undefined) ? (xp.max - xp.value) : null;
            const streak = actor.getFlag?.("ionrift-respite", "trainingStreak") ?? 0;
            const baseXP = 3 * passXp;
            const reduction = getTrainingXpReduction(streak);
            const effectiveXP = Math.max(baseXP - reduction, 0);
            if (effectiveXP <= 0)
                return { text: "No XP this rest", urgent: false, nonViable: true };
            if (gap !== null && gap > 0 && gap <= effectiveXP)
                return { text: `${gap} XP to level`, urgent: true };
            if (streak >= 1)
                return { text: `Streak ${streak}, up to ${effectiveXP} XP`, urgent: false };
            if (gap !== null && gap > 0)
                return { text: `${gap} XP away, up to ${effectiveXP}`, urgent: false };
            return { text: `Up to ${effectiveXP} XP`, urgent: false };
        }
        case "act_scribe":
            return { text: "50 gp per spell level", urgent: false };
        case "act_forage": {
            if (!isForagingEnabled())
                return { text: "Foraging is off", urgent: false, nonViable: true };
            return { text: ACTIVITY_CARD_HINTS.act_forage, urgent: false };
        }
        case "act_hunt": {
            if (!isHuntingEnabled())
                return { text: "Hunting is off", urgent: false, nonViable: true };
            return { text: ACTIVITY_CARD_HINTS.act_hunt, urgent: false };
        }
        default:
            return { text: ACTIVITY_CARD_HINTS[activityId] ?? null, urgent: false };
    }
}

/**
 * Pre-compute party state for advisory generation.
 * Call once per render, pass to each getActivityAdvisory call.
 * @param {Actor5e[]} partyActors - All actors in the rest
 * @param {Map} pendingSelections - Map of actorId ,  activityId
 * @param {number} encounterDC - Current effective encounter DC
 * @returns {object}
 */
export function buildPartyState(partyActors, pendingSelections, encounterDC, comfort) {
    const picks = [...(pendingSelections?.values() ?? [])];
    const watcherCount = picks.filter(id => id === "act_keep_watch").length;
    const hasWatcher = watcherCount > 0;
    const hasDefenses = picks.includes("act_defenses");
    const partySize = partyActors.length;

    const injuredMembers = partyActors
        .map(a => {
            const hp = a.system?.attributes?.hp ?? {};
            const pct = hp.max ? Math.round((hp.value / hp.max) * 100) : 100;
            return { id: a.id, name: a.name, hpPct: pct };
        })
        .filter(m => m.hpPct < 100)
        .sort((a, b) => a.hpPct - b.hpPct);

    return {
        hasWatcher, watcherCount, hasDefenses,
        partySize,
        injuredMembers,
        encounterDC: encounterDC ?? 14,
        comfort: comfort ?? "sheltered"
    };
}

/**
 * Ammunition on hand, named by kind so a low count is not just "8 left".
 * @param {Actor} actor
 * @returns {{ total: number, text: string }|null}
 */
function _ammoStock(actor) {
    const kinds = [
        { test: /bolt/i, one: "bolt", many: "bolts", count: 0 },
        { test: /arrow/i, one: "arrow", many: "arrows", count: 0 },
        { test: /dart/i, one: "dart", many: "darts", count: 0 },
        { test: /sling bullet|bullet/i, one: "bullet", many: "bullets", count: 0 }
    ];
    let found = false;
    for (const item of actor.items ?? []) {
        if (item.type !== "consumable" || item.system?.type?.value !== "ammo") continue;
        const name = item.name ?? "";
        const kind = kinds.find(entry => entry.test.test(name));
        if (!kind) continue;
        kind.count += item.system?.quantity ?? 0;
        found = true;
    }
    if (!found) return null;
    const parts = kinds
        .filter(entry => entry.count > 0)
        .map(entry => `${entry.count} ${entry.count === 1 ? entry.one : entry.many}`);
    const total = kinds.reduce((sum, entry) => sum + entry.count, 0);
    const text = parts.length === 1 ? `${parts[0]} left` : `${parts.join(", ")} left`;
    return { total, text };
}

/**
 * Camp station definitions. Each station groups activities by the campsite
 * furniture they are performed at. Order determines display order.
 * `furnitureKey` ties back to CompoundCampPlacer token flags.
 */
export const CAMP_STATIONS = [
    {
        id: "workbench",
        label: "Workbench",
        icon: "fas fa-tools",
        furnitureKey: "table",
        tagline: "Identify & scribe",
        activities: ["act_identify", "act_scribe"]
    },
    {
        id: "weapon_rack",
        label: "Weapon Rack",
        icon: "fas fa-shield-alt",
        furnitureKey: "weaponRack",
        tagline: "Fletch, defences, watch, other",
        activities: ["act_fletch", "act_defenses", "act_keep_watch", "act_other"],
        terrainHide: ["tavern"]
    },
    {
        id: "medical_bed",
        label: "Medical Bed",
        icon: "fas fa-hand-holding-medical",
        furnitureKey: "medicalBed",
        tagline: "Tend wounds, rest fully",
        activities: ["act_tend_wounds", "act_rest_fully"]
    },
    {
        id: "bedroll",
        label: "Your Bedroll",
        icon: "fas fa-bed",
        furnitureKey: null,
        tagline: "Rest, pray, train, tales, craft, forage, hunt, other",
        activities: ["act_rest_fully", "act_pray", "act_train", "act_tell_tales", "act_craft", "act_forage", "act_hunt", "act_other"],
        terrainLabel: { tavern: "Your Room" }
    },
    {
        id: "campfire",
        label: "Campfire",
        icon: "fas fa-fire",
        furnitureKey: "campfire",
        tagline: "Fire state, comfort, personal camp",
        activities: [],
        terrainHide: ["tavern"]
    },
    {
        id: "cooking_station",
        label: "Cooking Station",
        icon: "fas fa-utensils",
        furnitureKey: "cookingArea",
        tagline: "Cook, brew",
        activities: ["act_cook", "act_brew"],
        terrainLabel: { tavern: "Hearth & Table" }
    }
];

/**
 * Returns CAMP_STATIONS filtered and adjusted for a given terrain.
 * Hidden stations are removed; activities from hidden stations that should
 * migrate are folded into fallback stations (e.g. Keep Watch ,  bedroll in taverns).
 * Labels are overridden per terrainLabel where defined.
 * @param {string} terrainTag
 * @param {boolean} [safeRestSpot] - Hides medical bed and relabels weapon rack for safe rest flow
 * @param {{ simpleStations?: boolean }} [options]
 * @returns {Object[]}
 */
export function getStationsForTerrain(terrainTag, safeRestSpot = false, options = {}) {
    const simpleStations = options.simpleStations ?? isSimpleStationsMode();
    const isTavern = terrainTag === "tavern";
    const hidden = new Set();
    /** Activities orphaned by hidden stations that should migrate to bedroll. */
    const MIGRATING_ACTIVITIES = isTavern
        ? new Set([])
        : new Set(["act_keep_watch", "act_other"]);
    const orphanedActivities = [];

    // First pass: collect hidden station ids and their migrating activities.
    for (const station of CAMP_STATIONS) {
        if (station.terrainHide?.includes(terrainTag)) {
            hidden.add(station.id);
            for (const actId of station.activities ?? []) {
                if (MIGRATING_ACTIVITIES.has(actId)) orphanedActivities.push(actId);
            }
        }
    }

    // Second pass: build adjusted station list.
    const result = [];
    for (const station of CAMP_STATIONS) {
        if (hidden.has(station.id)) continue;
        if (isTavern && station.id === "cooking_station") continue;
        if ((safeRestSpot || isTavern) && station.id === "medical_bed") continue;
        let label = station.terrainLabel?.[terrainTag] ?? station.label;
        let activities = [...(station.activities ?? [])];
        let tagline = station.tagline;
        if (isTavern && station.id === "bedroll") {
            activities = activities.filter(id => id !== "act_rest_fully");
        }
        if (safeRestSpot && station.id === "weapon_rack") {
            label = "Supply Table";
            tagline = "Fletch, other";
            activities = ["act_fletch", "act_other"];
        }
        const extra = station.id === "bedroll" ? orphanedActivities : [];
        const mergedActivities = extra.length
            ? [...activities, ...extra.filter(id => !activities.includes(id))]
            : activities;
        result.push({ ...station, label, activities: mergedActivities, tagline });
    }

    if (!simpleStations) return result;

    return result
        .filter(s => ["workbench", "bedroll"].includes(s.id))
        .map(s => {
            if (s.id === "bedroll") {
                return {
                    ...s,
                    label: "Bedrolls",
                    furnitureKey: "sharedBedroll",
                    tagline: "Rest by the fire",
                    activities: ["act_other"]
                };
            }
            if (s.id === "workbench") {
                return {
                    ...s,
                    tagline: "Workbench",
                    activities: (s.activities ?? []).filter(id => id !== "act_scribe")
                };
            }
            return s;
        });
}

/**
 * Activity ids a character can pick from visible TotM station sections (excludes
 * campfire and Identify-tab-only activities).
 * @param {string} terrainTag
 * @param {boolean} safeRestSpot
 * @param {Set<string>|Iterable<string>} availableIds
 * @param {{ simpleStations?: boolean }} [options]
 * @returns {Set<string>}
 */
export function getStationOfferedActivityIds(terrainTag, safeRestSpot, availableIds, options = {}) {
    const available = availableIds instanceof Set ? availableIds : new Set(availableIds);
    const stations = getStationsForTerrain(terrainTag, safeRestSpot, options);
    const skipStations = new Set(["campfire"]);
    const offered = new Set();
    for (const station of stations) {
        if (skipStations.has(station.id)) continue;
        for (const id of station.activities ?? []) {
            if (available.has(id)) offered.add(id);
        }
    }
    return offered;
}

/**
 * One canvas station id for a chosen activity (used for overlay portraits).
 * When an activity appears on both bedroll and campfire, picks from deployed bedroll gear;
 * otherwise the first matching station in {@link CAMP_STATIONS} order.
 * @param {string} activityId
 * @param {string|null} [actorId]
 * @returns {string}
 */
export function inferCanvasStationForActivity(activityId, actorId = null) {
    if (!activityId) return "campfire";
    if (activityId === "act_other" && isSimpleStationsMode()) return "bedroll";
    const hits = CAMP_STATIONS.filter(s => (s.activities ?? []).includes(activityId));
    if (!hits.length) return "campfire";
    if (hits.length === 1) return hits[0].id;
    const hasBed = hits.some(h => h.id === "bedroll");
    const hasFire = hits.some(h => h.id === "campfire");
    if (hasBed && hasFire && actorId) {
        return isGearDeployed(actorId, "bedroll") ? "bedroll" : "campfire";
    }
    return hits[0].id;
}

/** Maximum distance (grid squares) a player token may be from a station to interact with it. */
export const STATION_RANGE_SQUARES = 3;

/** Max assignment portraits on an activity card before showing a +N overflow badge. */
export const ACTIVITY_PORTRAIT_DISPLAY_CAP = 3;

/**
 * Attach portrait bubbles and overflow count to an activity list item.
 * @param {object} item
 * @param {object[]} assigned
 */
export function applyActivityPortraitAssignments(item, assigned) {
    const cap = ACTIVITY_PORTRAIT_DISPLAY_CAP;
    item.assignedPortraits = assigned.slice(0, cap);
    item.assignedOverflow = Math.max(0, assigned.length - cap);
    item.hasAssignments = assigned.length > 0;
}

/** Shelter spell definitions. Used in setup phase for shelter detection. */
export const SHELTER_SPELLS = [
    { id: "tiny_hut", name: "Tiny Hut", altNames: ["leomund's tiny hut", "tiny hut", "cozy cabin"], icon: "fas fa-igloo", comfortFloor: "sheltered", encounterMod: 5, restTypes: ["long"], blocksFire: true,
        hint: "Impenetrable force dome. Comfort floor: Sheltered. Night check -5. No campfire, cooking, or brewing (sealed dome)." },
    { id: "rope_trick", name: "Rope Trick", altNames: ["rope trick"], icon: "fas fa-hat-wizard", comfortFloor: null, encounterMod: 5, restTypes: ["short"], blocksFire: true,
        hint: "Hidden extradimensional space. Short rest only (1 hr). Night check -5. No campfire (no ventilation)." },
    { id: "magnificent_mansion", name: "Mansion", altNames: ["magnificent mansion", "mordenkainen's magnificent mansion", "mordenkainen", "resplendent mansion"], icon: "fas fa-chess-rook", comfortFloor: "safe", encounterMod: 99, restTypes: ["long"], blocksFire: true,
        hint: "Separate dimension. No encounters. Safe rest guaranteed. Has its own hearth and kitchen." }
];

/** Comfort tier tooltips for the camp status bar */
export function getComfortTip(tier) {
    if (!isComfortEnabled()) return "Comfort rules disabled, full recovery";
    const tips = {
        hostile: "Hostile: 75% max HP cap, -2 HD penalty, DC 15 Con save vs exhaustion",
        rough: "Rough: full HP, -1 HD penalty, DC 10 Con save vs exhaustion",
        sheltered: "Sheltered: full HP, normal HD recovery, no exhaustion check",
        safe: "Safe: full HP & HD recovery, no nocturnal encounter danger"
    };
    return tips[tier] ?? tips.sheltered;
}

/** Identify tab: Detect Magic toolbar label. */
export const DETECT_MAGIC_BTN_LABEL_PLAYER = "Detect Magic";
export const DETECT_MAGIC_BTN_LABEL_GM = "Detect Magic";
/** Shown when a scan is already active; clicking again dismisses it. */
export const DETECT_MAGIC_BTN_LABEL_DISMISS = "Dismiss";
export const DETECT_MAGIC_BTN_TITLE_GM = "Cast Detect Magic for the party. Use when you are granting the spell at the table; skip if a player should trigger it from their own character.";
export const DETECT_MAGIC_BTN_TITLE_PLAYER = "Cast Detect Magic";
export const DETECT_MAGIC_BTN_TITLE_NONE = "No Detect Magic available in the party";

/**
 * Build per-activity portrait assignment map.
 * Shared between StationActivityDialog (spatial) and TotM card grid.
 * @param {Map<string,string>} characterChoices - actorId -> activityId
 * @param {Map<string,object>} earlyResults - actorId -> { result, narrative }
 * @param {Set<string>|null} [filterActivityIds] - If provided, only include these activity IDs
 * @returns {Object<string, Array<{actorId, actorName, portraitImg, status}>>}
 */
export function buildActivityAssignments(characterChoices, earlyResults, filterActivityIds = null) {
    const assignments = {};
    if (!characterChoices?.size) return assignments;
    for (const [charId, actId] of characterChoices) {
        if (filterActivityIds && !filterActivityIds.has(actId)) continue;
        const actor = game.actors.get(charId);
        if (!actor) continue;
        let status = "pending";
        const earlyResult = earlyResults?.get(charId);
        if (earlyResult) {
            if (earlyResult.result === "success" || earlyResult.result === "exceptional") status = "success";
            else if (earlyResult.result === "failure" || earlyResult.result === "failure_complication") status = "fail";
        }
        if (!assignments[actId]) assignments[actId] = [];
        assignments[actId].push({
            actorId: charId,
            actorName: actor.name,
            portraitImg: actor.img ?? actor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
            status
        });
    }
    return assignments;
}

/**
 * Fold portrait assignments for activities not visible on this client's cards
 * onto act_other so party picks (e.g. scribe, cook) stay visible to everyone.
 *
 * @param {Object<string, object[]>} assignments
 * @param {Set<string>|Iterable<string>} visibleActivityIds
 * @param {string} [fallbackActivityId='act_other']
 */
export function foldOrphanedAssignmentsOntoOther(assignments, visibleActivityIds, fallbackActivityId = "act_other") {
    const visible = visibleActivityIds instanceof Set ? visibleActivityIds : new Set(visibleActivityIds);
    const folded = [];
    for (const [actId, assigned] of Object.entries(assignments)) {
        if (actId === fallbackActivityId || visible.has(actId)) continue;
        if (assigned?.length) folded.push(...assigned);
    }
    if (!folded.length) return;
    const target = assignments[fallbackActivityId] ??= [];
    const seen = new Set(target.map(entry => entry.actorId));
    for (const entry of folded) {
        if (seen.has(entry.actorId)) continue;
        target.push(entry);
        seen.add(entry.actorId);
    }
}

/**
 * Follow-up input descriptor for an activity (shared by TotM inline panels).
 * @param {string|null} [currentValue] - Existing answer for pre-selection
 * @returns {object|null}
 */
export function buildFollowUpDataForActivity(activityId, activity, actor, currentValue = null) {
    if (!activity?.followUp) return null;

    const fu = activity.followUp;
    const result = {
        type: fu.type,
        label: fu.label,
        currentValue
    };

    if (fu.type === "partyMember") {
        const partyActors = (() => {
            try { return game.actors.filter(a => a.hasPlayerOwner && a.type === "character" && a.id !== actor?.id); }
            catch { return []; }
        })();
        result.options = partyActors.sort((a, b) => {
            const aRatio = (a.system?.attributes?.hp?.value ?? 0) / (a.system?.attributes?.hp?.max ?? 1);
            const bRatio = (b.system?.attributes?.hp?.value ?? 0) / (b.system?.attributes?.hp?.max ?? 1);
            return aRatio - bRatio;
        }).map(a => {
            const hp = a.system?.attributes?.hp;
            const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
            return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
        });

    } else if (fu.type === "radio" || fu.type === "select") {
        const selectedVal = currentValue || fu.default || fu.options?.[0]?.value;

        if (activityId === "act_scribe") {
            const currentGold = actor?.system?.currency?.gp ?? 0;
            result.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;
            result.options = (fu.options ?? []).map(opt => {
                const cost = parseInt(opt.value, 10) * 50;
                return {
                    ...opt,
                    label: currentGold >= cost ? opt.label : `${opt.label} (can't afford)`,
                    isSelected: opt.value === selectedVal,
                    isDisabled: currentGold < cost
                };
            });
        } else {
            result.options = (fu.options ?? []).map(opt => ({ ...opt, isSelected: opt.value === selectedVal }));
        }

        if (result.options?.length && !result.options.some(o => o.isSelected)) {
            result.options[0].isSelected = true;
        }

    } else if (fu.type === "actorItem" && fu.filter === "attuneable") {
        const attuneItems = (actor?.items ?? []).filter(i => {
            const att = i.system?.attunement;
            return (att === "required" || att === 1) && !i.system?.attuned;
        });
        result.options = attuneItems.map(i => ({
            value: i.id,
            label: i.name,
            isSelected: i.id === currentValue
        }));
        const attunement = actor?.system?.attributes?.attunement;
        if (attunement) {
            const current = attunement.value ?? 0;
            const max = attunement.max ?? 3;
            result.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
        }
    }

    return result;
}

/**
 * Build a short check label string for a given activity (e.g. "Arcana check, DC 15").
 * Mirrors the check label logic in StationActivityDialog._buildDetailContext().
 *
 * @param {object} activity - Activity schema from ActivityResolver
 * @param {Actor5e} actor
 * @param {string} [comfort] - Comfort tier key
 * @param {string|null} [followUpValue] - Current follow-up value (used for copySpell DC)
 * @returns {string|null}
 */
export function buildCheckLabelForActivity(activity, actor, comfort = "sheltered", followUpValue = null) {
    if (!activity?.check) return null;

    const comfortMod = getComfortDcMod(comfort);

    let baseDc = activity.check.dc ?? 12;
    if (activity.check.dynamicDc === "copySpell") {
        const spellLevel = Math.min(9, Math.max(1, parseInt(followUpValue || activity.followUp?.default || "1", 10) || 1));
        baseDc = 10 + spellLevel;
    }

    const rcAdapter = game.ionrift?.respite?.adapter;
    let checkKind = "";
    if (activity.check.skill) {
        let chosenSkill = activity.check.skill;
        if (activity.check.altSkill && actor) {
            const primary = rcAdapter ? rcAdapter.getSkillTotal(actor, rcAdapter.normalizeSkillKey(activity.check.skill)) : (actor.system?.skills?.[activity.check.skill]?.total ?? 0);
            const alt = rcAdapter ? rcAdapter.getSkillTotal(actor, rcAdapter.normalizeSkillKey(activity.check.altSkill)) : (actor.system?.skills?.[activity.check.altSkill]?.total ?? 0);
            if (alt > primary) chosenSkill = activity.check.altSkill;
        }
        const skillCfg = CONFIG.DND5E?.skills?.[chosenSkill];
        const localized = skillCfg?.label ? (game.i18n?.localize ? game.i18n.localize(skillCfg.label) : skillCfg.label) : null;
        checkKind = localized || (rcAdapter?.getSkillLabel ? rcAdapter.getSkillLabel(chosenSkill) : null) || (chosenSkill.charAt(0).toUpperCase() + chosenSkill.slice(1));
    } else if (activity.check.ability) {
        let abilityKey = activity.check.ability;
        if (abilityKey === "best" && actor) {
            let bestKey = "str"; let bestMod = -99;
            const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
            for (const key of abilityKeys) {
                const mod = rcAdapter ? rcAdapter.getAbilityMod(actor, key) : (actor.system?.abilities?.[key]?.mod ?? 0);
                if (mod > bestMod) { bestMod = mod; bestKey = key; }
            }
            abilityKey = bestKey;
        }
        checkKind = abilityKey.toUpperCase();
    }

    if (activity.check.dynamicDc === "copySpell") {
        return `${checkKind} check, DC ${baseDc}`;
    }
    if (comfortMod > 0) {
        return `${checkKind} check, DC ${baseDc + comfortMod} (${baseDc} base +${comfortMod} terrain)`;
    }
    return `${checkKind} check, DC ${baseDc}`;
}
