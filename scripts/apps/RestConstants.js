/**
 * RestConstants.js
 * Shared constants for the Respite rest flow. Extracted from RestSetupApp
 * to reduce file size and improve maintainability.
 */

import { isGearDeployed } from "../services/CompoundCampPlacer.js";
import { HD_PENALTY, boostComfort } from "../services/ComfortCalculator.js";

/**
 * Weather master table. Each entry defines comfort penalty, encounter DC modifier,
 * and tent interaction. `tentReduces` means tent lowers penalty by 1 (partial help).
 */
export const WEATHER_TABLE = {
    clear:          { label: "Clear",          hint: "No effect on comfort or encounters.",                                       comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    overcast:       { label: "Overcast",       hint: "No effect. Dimmer light, neutral conditions.",                              comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    fog:            { label: "Fog",            hint: "Encounter DC +2. Weather hides camp, but also masks approaching threats.",  comfortPenalty: 0, encounterDC: 2, tentCancels: true,  tentReduces: false },
    rain:           { label: "Rain",           hint: "Comfort -1 step if unsheltered. Tent cancels.",                             comfortPenalty: 1, encounterDC: 0, tentCancels: true,  tentReduces: false },
    heavy_rain:     { label: "Heavy Rain",     hint: "Comfort -1. Encounter DC +1. Tent cancels.",                               comfortPenalty: 1, encounterDC: 1, tentCancels: true,  tentReduces: false },
    thunderstorm:   { label: "Thunderstorm",   hint: "Comfort -2. Encounter DC +2. Tent reduces to -1. Hut cancels.",            comfortPenalty: 2, encounterDC: 2, tentCancels: false, tentReduces: true },
    snow:           { label: "Snow",           hint: "Comfort -1 step if unsheltered. Tent cancels.",                             comfortPenalty: 1, encounterDC: 0, tentCancels: true,  tentReduces: false },
    blizzard:       { label: "Blizzard",       hint: "Comfort -2. Encounter DC +1. Tent reduces to -1. Hut cancels.",            comfortPenalty: 2, encounterDC: 1, tentCancels: false, tentReduces: true },
    extreme_cold:   { label: "Extreme Cold",   hint: "Comfort -1. Extra CON DC 10 or +1 exhaustion. Tent: partial.",             comfortPenalty: 1, encounterDC: 0, tentCancels: false, tentReduces: true },
    extreme_heat:   { label: "Extreme Heat",   hint: "Comfort -1. Extra CON DC 10 or +1 exhaustion. Tent does not help.",        comfortPenalty: 1, encounterDC: 0, tentCancels: false, tentReduces: false },
    sandstorm:      { label: "Sandstorm",      hint: "Comfort -2. Encounter DC +2. Tent: partial. Hut cancels.",                 comfortPenalty: 2, encounterDC: 2, tentCancels: false, tentReduces: true },
    hail:           { label: "Hail",           hint: "Comfort -1. Minor damage risk. Tent cancels.",                             comfortPenalty: 1, encounterDC: 0, tentCancels: true,  tentReduces: false },
    volcanic_ash:   { label: "Volcanic Ash",   hint: "Comfort -1. Encounter DC +1. Difficult breathing.",                        comfortPenalty: 1, encounterDC: 1, tentCancels: false, tentReduces: true },
    fungal_spores:  { label: "Fungal Spores",  hint: "Comfort -1. CON save or poisoned. Tent: partial.",                         comfortPenalty: 1, encounterDC: 0, tentCancels: false, tentReduces: true },
    faerzress:      { label: "Faerzress",      hint: "No comfort penalty. Wild magic risk on spellcasting during rest.",          comfortPenalty: 0, encounterDC: 0, tentCancels: false, tentReduces: false },
    // Tavern atmosphere (flavor only, zero mechanical effect)
    tavern_rain:    { label: "Raining Outside",  hint: "Rain patters on the windows. A somber, reflective evening.",              comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_storm:   { label: "Stormy Outside",   hint: "Thunder rattles the shutters. Good night to be indoors.",                 comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    // Tavern grades (flavor only, zero mechanical effect)
    tavern_flophouse: { label: "Flophouse",      hint: "Hard beds, thin walls, sounds you'd rather not identify.",               comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_modest:    { label: "Modest Inn",      hint: "Clean sheets, warm stew. Nothing fancy, nothing wrong.",                comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_fine:      { label: "Fine Lodgings",   hint: "Feather pillows, a hot bath, and someone else's cooking.",              comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    tavern_luxury:    { label: "Luxury Suite",    hint: "You could get used to this. You probably shouldn't.",                   comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    // Underground atmosphere (flavor)
    dungeon_normal:   { label: "Normal",          hint: "Still air. Unremarkable conditions.",                                   comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false },
    dungeon_damp:     { label: "Damp",            hint: "Water drips from the ceiling. Everything feels clammy.",                comfortPenalty: 0, encounterDC: 0, tentCancels: true,  tentReduces: false }
};

/** DnD5e skill abbreviation -> readable name */
export const SKILL_NAMES = {
    acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics",
    dec: "Deception", his: "History", ins: "Insight", itm: "Intimidation",
    inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception",
    prf: "Performance", per: "Persuasion", rel: "Religion", sle: "Sleight of Hand",
    ste: "Stealth", sur: "Survival"
};

/** Comfort tier ranking for comparison and arithmetic */
export const COMFORT_RANK = { hostile: 0, rough: 1, sheltered: 2, safe: 3 };

/** Comfort tiers indexed by rank value */
export const RANK_TO_KEY = ["hostile", "rough", "sheltered", "safe"];

/** Activity icon mapping */
export const ACTIVITY_ICONS = {
    act_keep_watch: "fas fa-eye", act_rest_fully: "fas fa-bed",
    act_forage: "fas fa-leaf", act_study: "fas fa-book",
    act_scout: "fas fa-binoculars", act_tell_tales: "fas fa-theater-masks",
    act_tend_wounds: "fas fa-hand-holding-medical", act_pray: "fas fa-pray",
    act_cook: "fas fa-utensils", act_brew: "fas fa-flask", act_tailor: "fas fa-cut",
    act_craft: "fas fa-tools", act_fletch: "fas fa-crosshairs",
    act_defenses: "fas fa-shield-alt", act_train: "fas fa-dumbbell",
    act_identify: "fas fa-search", act_attune: "fas fa-gem", act_scribe: "fas fa-scroll",
    act_other: "fas fa-comments"
};

/** Static fallback hints for activities without dynamic advisories */
const ACTIVITY_HINTS_STATIC = {
    act_study: "Skill check DC 12. On success, GM may share a clue or detail",
    act_tell_tales: "Performance DC 10. Inspiration for one ally, all on exceptional",
    act_cook: "Prepare a meal from ingredients",
    act_brew: "Brew a potion or salve",
    act_tailor: "Stitch materials into gear",
    act_craft: "Work raw materials into items",
    act_other: "No check, no mechanical effect"
};

/**
 * Generate a contextual advisory for an activity card.
 * Advisory text is player-visible. Never include encounter DC or GM-only data.
 * @param {string} activityId - The activity ID
 * @param {Actor5e} actor - The actor considering this activity
 * @param {object} partyState - Pre-computed party state from buildPartyState()
 * @returns {{text: string, urgent: boolean}}
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
                return { text: "No one on watch. Watcher: +3 initiative, surprise immune, +1 party initiative", urgent: true };
            if (watchers >= 2)
                return { text: `${watchers} watchers already assigned. Consider another activity`, urgent: false };
            return { text: "On watch: +3 initiative, surprise immune, +1 party initiative", urgent: false };
        }
        case "act_tend_wounds": {
            const injured = partyState.injuredMembers.filter(m => m.id !== actor.id);
            const hasKit = actor.items?.some(i =>
                i.name?.toLowerCase().includes("healer") && i.name?.toLowerCase().includes("kit")
                && ((i.system?.uses?.value ?? i.system?.quantity ?? 0) > 0)
            );
            const hasFeat = actor.items?.some(i => i.type === "feat" && i.name?.toLowerCase() === "healer");
            const gearNote = hasFeat && hasKit ? " (Healer feat + kit)" : hasKit ? " (kit: advantage)" : "";
            if (!injured.length)
                return { text: "No one is injured", urgent: false, nonViable: true };
            const worst = injured[0];
            if (worst.hpPct < 50)
                return { text: `${worst.name} at ${worst.hpPct}% HP. Heals now + boosts their recovery tier${gearNote}`, urgent: true };
            return { text: `${worst.name} at ${worst.hpPct}% HP. Heals now + boosts their recovery tier${gearNote}`, urgent: false };
        }
        case "act_defenses": {
            if (partyState.hasDefenses)
                return { text: "Someone is already setting defenses. Consider another activity", urgent: false };
            return { text: "On success, lowers encounter chance by 2 and grants +1 party initiative", urgent: false };
        }
        case "act_scout": {
            if (partyState.hasScout)
                return { text: "Someone is already scouting. Consider another activity", urgent: false };
            return { text: "On success, advantage on initiative and surprise", urgent: false };
        }
        case "act_rest_fully": {
            const comfortTier = partyState.comfort ?? "sheltered";
            const isHostile = comfortTier === "hostile";
            const isRough = comfortTier === "rough";
            const adapter = game.ionrift?.respite?.adapter;
            const exhaustion = adapter ? adapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);

            const basePenalty = HD_PENALTY[comfortTier] ?? 0;
            const boostedPenalty = HD_PENALTY[boostComfort(comfortTier, 1)] ?? 0;
            const rawHdRecovery = Math.max(1, Math.floor(hdMax / 2));
            const hdWithout = Math.max(0, rawHdRecovery - basePenalty);
            const hdWith = Math.max(0, rawHdRecovery - boostedPenalty) + 1;
            const effectiveGain = Math.max(0, Math.min(hdWith, hdDeficit) - Math.min(hdWithout, hdDeficit));

            if (isHostile) {
                if (hdDeficit >= 1)
                    return { text: `Hostile camp. Rest Fully recovers ${effectiveGain || 1} extra HD, removes HP cap`, urgent: true };
                if (hpPct < 100)
                    return { text: "Hostile camp. Rest Fully removes the 75% HP cap", urgent: true };
                return { text: "All HD and HP full. No recovery benefit", urgent: false, nonViable: true };
            }
            if (isRough) {
                if (effectiveGain > 0) {
                    const exNote = exhaustion >= 1 ? ", clears exhaustion DC" : "";
                    return { text: `Rough camp. Rest Fully recovers ${effectiveGain} extra HD${exNote}`, urgent: true };
                }
                if (exhaustion >= 1)
                    return { text: `Rough camp + ${exhaustion} exhaustion. Rest Fully clears exhaustion DC`, urgent: true };
                if (hdDeficit >= 1)
                    return { text: "Recovery at this comfort covers all missing HD", urgent: false, nonViable: true };
                return { text: "No recovery benefit at this comfort", urgent: false, nonViable: true };
            }
            if (effectiveGain > 0)
                return { text: `Missing ${hdDeficit} HD. Rest Fully recovers +${effectiveGain} extra HD`, urgent: false };
            if (hdDeficit >= 1)
                return { text: "Recovery at this comfort covers all missing HD", urgent: false, nonViable: true };
            return { text: "All HD and HP full. No recovery benefit", urgent: false, nonViable: true };
        }
        case "act_pray": {
            const prof = actor.system?.attributes?.prof ?? 2;
            return { text: `On success, ${prof} temp HP (proficiency bonus)`, urgent: false };
        }
        case "act_fletch": {
            const ammo = _countAmmo(actor);
            const prof = actor.system?.attributes?.prof ?? 2;
            if (ammo !== null && ammo < 10)
                return { text: `Low ammo: ${ammo} remaining. Yields 1d4+${prof} on success`, urgent: true };
            return { text: `Craft arrows or bolts. Yields 1d4+${prof} on success`, urgent: false };
        }
        case "act_train": {
            const level = actor.system?.details?.level ?? 1;
            if (level > 5)
                return { text: "Training has no effect above level 5", urgent: false, nonViable: true };
            const xp = actor.system?.details?.xp ?? {};
            const gap = (xp.max && xp.value != null) ? (xp.max - xp.value) : null;
            const streak = actor.getFlag?.("ionrift-respite", "trainingStreak") ?? 0;
            const baseXP = 45;
            const reduction = streak * 5;
            const effectiveXP = Math.max(baseXP - reduction, 0);
            const effectiveFailXP = Math.max(15 - reduction, 0);
            if (effectiveXP <= 0)
                return { text: "Diminishing returns: no XP gain this rest. Try something else", urgent: false, nonViable: true };
            if (gap !== null && gap > 0 && gap <= effectiveXP)
                return { text: `${gap} XP to level up. Training can close that gap this rest`, urgent: true };
            if (streak >= 2)
                return { text: `Training streak (${streak}): XP reduced to ${effectiveXP} success / ${effectiveFailXP} fail`, urgent: false };
            if (gap !== null && gap > 0)
                return { text: `${gap} XP to next level. ${effectiveXP} XP on success, ${effectiveFailXP} on fail`, urgent: false };
            return { text: `${effectiveXP} XP on success (DC 13 ability check)`, urgent: false };
        }
        case "act_attune":
            return { text: "No check. Attune to one magical item during rest", urgent: false };
        case "act_scribe":
            return { text: "Arcana check (DC 10 + spell level), 50gp per level. Scroll consumed regardless", urgent: false };
        default:
            return { text: ACTIVITY_HINTS_STATIC[activityId] ?? null, urgent: false };
    }
}

/**
 * Pre-compute party state for advisory generation.
 * Call once per render, pass to each getActivityAdvisory call.
 * @param {Actor5e[]} partyActors - All actors in the rest
 * @param {Map} pendingSelections - Map of actorId → activityId
 * @param {number} encounterDC - Current effective encounter DC
 * @returns {object}
 */
export function buildPartyState(partyActors, pendingSelections, encounterDC, comfort) {
    const picks = [...(pendingSelections?.values() ?? [])];
    const watcherCount = picks.filter(id => id === "act_keep_watch").length;
    const hasWatcher = watcherCount > 0;
    const hasScout = picks.includes("act_scout");
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
        hasWatcher, watcherCount, hasScout, hasDefenses,
        partySize,
        injuredMembers,
        encounterDC: encounterDC ?? 14,
        comfort: comfort ?? "sheltered"
    };
}

/** Count ammunition (arrows, bolts, darts) in an actor's inventory */
function _countAmmo(actor) {
    const AMMO_NAMES = /arrow|bolt|dart|sling bullet/i;
    let total = 0;
    let found = false;
    for (const item of actor.items ?? []) {
        if (item.type === "consumable" && item.system?.type?.value === "ammo" &&
            AMMO_NAMES.test(item.name)) {
            total += item.system?.quantity ?? 0;
            found = true;
        }
    }
    return found ? total : null;
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
        tagline: "Identify, attune, study, scribe",
        activities: ["act_identify", "act_attune", "act_study", "act_scribe"]
    },
    {
        id: "weapon_rack",
        label: "Weapon Rack",
        icon: "fas fa-shield-alt",
        furnitureKey: "weaponRack",
        tagline: "Fletch, defences, watch, other",
        activities: ["act_fletch", "act_defenses", "act_keep_watch", "act_other"]
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
        tagline: "Rest, pray, train, tales, craft, tailor, other",
        activities: ["act_rest_fully", "act_pray", "act_train", "act_tell_tales", "act_craft", "act_tailor", "act_other"]
    },
    {
        id: "campfire",
        label: "Campfire",
        icon: "fas fa-fire",
        furnitureKey: "campfire",
        tagline: "Fire state, comfort, personal camp",
        activities: []
    },
    {
        id: "cooking_station",
        label: "Cooking Station",
        icon: "fas fa-utensils",
        furnitureKey: "cookingArea",
        tagline: "Cook, brew",
        activities: ["act_cook", "act_brew"]
    }
];

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

/**
 * Camp station placeholder (build site) before the fire is lit. Swapped in-place when promoted.
 * World Data path (same root as FURNITURE draft art in CompoundCampPlacer).
 * @type {{ name: string, path: string, width: number, height: number }}
 */
export const PLACEHOLDER_CAMP_STATION = {
    name: "Build site",
    path: "icons/svg/circle.svg",
    /** Half-grid footprint — small supply bundle, not a full station. */
    width: 0.5,
    height: 0.5
};

/** Shelter spell definitions. Used in setup phase for shelter detection. */
export const SHELTER_SPELLS = [
    { id: "tiny_hut", name: "Tiny Hut", altNames: ["leomund's tiny hut", "tiny hut", "cozy cabin"], icon: "fas fa-igloo", comfortFloor: "sheltered", encounterMod: 5, restTypes: ["long"], blocksFire: true,
        hint: "Impenetrable force dome. Comfort floor: Sheltered. Encounter DC +5. No campfire, cooking, or brewing (sealed dome).",
        rpPrompt: "Who casts it? What color is the dome? Can you see out? What does the air feel like inside?" },
    { id: "rope_trick", name: "Rope Trick", altNames: ["rope trick"], icon: "fas fa-hat-wizard", comfortFloor: null, encounterMod: 5, restTypes: ["short"], blocksFire: true,
        hint: "Hidden extradimensional space. Short rest only (1 hr). Encounter DC +5. No campfire (no ventilation).",
        rpPrompt: "Who casts it? Where does the rope lead? What does the space look like inside? Is it comfortable or unsettling?" },
    { id: "magnificent_mansion", name: "Mansion", altNames: ["magnificent mansion", "mordenkainen's magnificent mansion", "mordenkainen", "resplendent mansion"], icon: "fas fa-chess-rook", comfortFloor: "safe", encounterMod: 99, restTypes: ["long"], blocksFire: true,
        hint: "Separate dimension. No encounters. Safe rest guaranteed. Has its own hearth and kitchen.",
        rpPrompt: "Describe the entrance. What does the foyer look like? What's on the menu tonight? Do the servants have names?" }
];

/** Comfort tier tooltips for the camp status bar */
export const COMFORT_TIPS = {
    hostile: "Hostile: 75% HP, -2 HD, CON DC 15 or +1 exhaustion",
    rough: "Rough: full HP, -1 HD, CON DC 10 or +1 exhaustion",
    sheltered: "Sheltered: full HP, full HD recovery",
    safe: "Safe: full HP, full HD recovery, no encounter risk"
};

/** Identify tab: Detect Magic toolbar label and GM-only tooltip. */
export const DETECT_MAGIC_BTN_LABEL_PLAYER = "Cast Detect Magic";
/** Line break before "(" so the label stacks cleanly in the workbench button. */
export const DETECT_MAGIC_BTN_LABEL_GM = "Cast detect magic\n(GM cast it for them)";
export const DETECT_MAGIC_BTN_TITLE_GM = "Runs the aura pass for the whole party as host. Use when you are granting Detect Magic at the table. Skip if a player should trigger it from a character they control.";
