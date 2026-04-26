/**
 * RestConstants.js
 * Shared constants for the Respite rest flow. Extracted from RestSetupApp
 * to reduce file size and improve maintainability.
 */

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
    act_study: "Ask the GM about a clue or detail",
    act_tell_tales: "Performance check, may grant Inspiration",
    act_cook: "Prepare a meal from ingredients",
    act_brew: "Brew a potion or salve",
    act_tailor: "Stitch materials into gear",
    act_craft: "Work raw materials into items",
    act_other: "Roleplay, journal, socialise"
};

/**
 * Generate a contextual advisory for an activity card.
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
            if (!partyState.hasWatcher)
                return { text: "No one is watching – party vulnerable", urgent: true };
            return { text: "Can't be surprised, +3 initiative", urgent: false };
        }
        case "act_tend_wounds": {
            const injured = partyState.injuredMembers.filter(m => m.id !== actor.id);
            if (injured.length) {
                const worst = injured[0];
                return { text: `${worst.name} is at ${worst.hpPct}% HP`, urgent: worst.hpPct < 50 };
            }
            return { text: "Medicine check, heals a companion", urgent: false };
        }
        case "act_defenses": {
            const dc = partyState.encounterDC ?? 14;
            if (dc <= 10)
                return { text: `Encounter DC is ${dc} – defenses would help`, urgent: true };
            return { text: "Lowers encounter risk for the party", urgent: false };
        }
        case "act_scout": {
            const dc = partyState.encounterDC ?? 14;
            if (dc <= 10)
                return { text: "High encounter risk – scout escape routes", urgent: true };
            return { text: "Stealth/Perception check, maps escape routes", urgent: false };
        }
        case "act_rest_fully": {
            if (hdDeficit >= 2)
                return { text: `Missing ${hdDeficit} Hit Dice – rest to recover`, urgent: true };
            if (hpPct < 50)
                return { text: `At ${hpPct}% HP – full rest maximises recovery`, urgent: true };
            return { text: "Best recovery, but vulnerable if attacked", urgent: false };
        }
        case "act_pray": {
            const tempHP = hp.temp ?? 0;
            if (tempHP === 0 && hpPct < 100)
                return { text: "No temp HP – meditation could help", urgent: false };
            return { text: "Temp HP on success", urgent: false };
        }
        case "act_fletch": {
            const ammo = _countAmmo(actor);
            if (ammo !== null && ammo < 10)
                return { text: `Low ammo: ${ammo} remaining`, urgent: true };
            return { text: "Craft arrows or bolts", urgent: false };
        }
        case "act_train": {
            const xp = actor.system?.details?.xp ?? {};
            if (xp.max && xp.value != null) {
                const gap = xp.max - xp.value;
                if (gap > 0 && gap <= 100)
                    return { text: `${gap} XP to next level`, urgent: true };
            }
            return { text: "Gain XP (levels 1–5 only)", urgent: false };
        }
        case "act_attune":
            return { text: "Bond with a magical item", urgent: false };
        case "act_scribe":
            return { text: "Transcribe a spell (costs gold)", urgent: false };
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
export function buildPartyState(partyActors, pendingSelections, encounterDC) {
    const hasWatcher = [...(pendingSelections?.values() ?? [])].includes("act_keep_watch");
    const injuredMembers = partyActors
        .map(a => {
            const hp = a.system?.attributes?.hp ?? {};
            const pct = hp.max ? Math.round((hp.value / hp.max) * 100) : 100;
            return { id: a.id, name: a.name, hpPct: pct };
        })
        .filter(m => m.hpPct < 100)
        .sort((a, b) => a.hpPct - b.hpPct);

    return { hasWatcher, injuredMembers, encounterDC: encounterDC ?? 14 };
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
