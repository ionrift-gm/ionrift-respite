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
    act_identify: "fas fa-search", act_attune: "fas fa-gem", act_scribe: "fas fa-scroll"
};

/** Shelter spell definitions. Used in setup phase for shelter detection. */
export const SHELTER_SPELLS = [
    { id: "tiny_hut", name: "Tiny Hut", altNames: ["leomund's tiny hut", "tiny hut"], icon: "fas fa-igloo", comfortFloor: "sheltered", encounterMod: 5, restTypes: ["long"], blocksFire: true,
        hint: "Impenetrable force dome. Comfort floor: Sheltered. Encounter DC +5. No campfire, cooking, or brewing (sealed dome).",
        rpPrompt: "Who casts it? What color is the dome? Can you see out? What does the air feel like inside?" },
    { id: "rope_trick", name: "Rope Trick", altNames: ["rope trick"], icon: "fas fa-hat-wizard", comfortFloor: null, encounterMod: 5, restTypes: ["short"], blocksFire: true,
        hint: "Hidden extradimensional space. Short rest only (1 hr). Encounter DC +5. No campfire (no ventilation).",
        rpPrompt: "Who casts it? Where does the rope lead? What does the space look like inside? Is it comfortable or unsettling?" },
    { id: "magnificent_mansion", name: "Mansion", altNames: ["magnificent mansion", "mordenkainen's magnificent mansion", "mordenkainen"], icon: "fas fa-chess-rook", comfortFloor: "safe", encounterMod: 99, restTypes: ["long"], blocksFire: true,
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
