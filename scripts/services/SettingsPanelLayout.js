/**
 * @module SettingsPanelLayout
 * @description Registers Respite Quick Setup and settings grouping via ionrift-library.
 */

import { getFletchingTierLabel } from "./FletchingSettings.js";
import { getTrainingTierLabel } from "./TrainingSettings.js";

const MODULE_ID = "ionrift-respite";

const COMPLEXITY_KEYS = [
    "enableComfort",
    "enableCampfireMinigame",
    "enableProfessions",
    "trainingXpTier",
    "fletchingYieldTier",
    "enableEncounters",
    "enableCopySpell",
    "enablePrayMeditate",
    "enableScouting",
    "enableForaging",
    "enableHunting",
    "useTravel",
    "trackFood",
    "partialSustenance",
    "armorDoffRule"
];

const PLAYER_KEYS = [
    "interceptRests",
    "lockAttuneOutsideRest",
    "lockPlayerQuantity"
];

const PROFILE_KEYS = [...COMPLEXITY_KEYS, ...PLAYER_KEYS];

const KEY_LABELS = {
    enableComfort: "Comfort rules",
    enableCampfireMinigame: "Campfire minigame (TotM)",
    enableProfessions: "Crafting professions (and travel phase)",
    trainingXpTier: "Training activity",
    fletchingYieldTier: "Fletching yield",
    enableEncounters: "Night encounters & watch",
    enableCopySpell: "Copy Spell activity",
    enablePrayMeditate: "Pray / Meditate activity",
    enableScouting: "Travel scouting",
    enableForaging: "Travel foraging",
    enableHunting: "Travel hunting",
    useTravel: "Use travel",
    trackFood: "Meal tracking",
    partialSustenance: "Partial sustenance",
    armorDoffRule: "Armor sleep penalties",
    interceptRests: "Intercept player rests",
    lockAttuneOutsideRest: "Lock attunement to rest",
    lockPlayerQuantity: "Lock player quantities"
};

const PROFILES = [
    {
        id: "simple",
        label: "Simple",
        icon: "fas fa-feather",
        desc: "Bare-bones rest. No comfort, professions, food, encounters, or extra activities.",
        values: {
            enableComfort: false,
            enableCampfireMinigame: false,
            enableProfessions: false,
            trainingXpTier: 0,
            fletchingYieldTier: 0,
            enableEncounters: false,
            enableCopySpell: false,
            enablePrayMeditate: false,
            enableScouting: false,
            enableForaging: true,
            enableHunting: true,
            useTravel: false,
            trackFood: false,
            partialSustenance: false,
            armorDoffRule: false,
            interceptRests: true,
            lockAttuneOutsideRest: false,
            lockPlayerQuantity: false
        }
    },
    {
        id: "standard",
        label: "Standard",
        icon: "fas fa-campground",
        desc: "Full camp: professions, fletching, and night encounters. No comfort tiers, food, or scouting.",
        values: {
            enableComfort: false,
            enableCampfireMinigame: true,
            enableProfessions: true,
            trainingXpTier: 0,
            fletchingYieldTier: 1,
            enableEncounters: true,
            enableCopySpell: true,
            enablePrayMeditate: false,
            enableScouting: false,
            enableForaging: true,
            enableHunting: true,
            useTravel: true,
            trackFood: false,
            partialSustenance: false,
            armorDoffRule: true,
            interceptRests: true,
            lockAttuneOutsideRest: true,
            lockPlayerQuantity: false
        }
    },
    {
        id: "survival",
        label: "Survival",
        icon: "fas fa-mountain-sun",
        desc: "Standard plus comfort tiers, food, water, and travel scouting. Strict rations, locked quantities.",
        values: {
            enableComfort: true,
            enableCampfireMinigame: true,
            enableProfessions: true,
            trainingXpTier: 0,
            fletchingYieldTier: 1,
            enableEncounters: true,
            enableCopySpell: true,
            enablePrayMeditate: false,
            enableScouting: true,
            enableForaging: true,
            enableHunting: true,
            useTravel: true,
            trackFood: true,
            partialSustenance: true,
            armorDoffRule: true,
            interceptRests: true,
            lockAttuneOutsideRest: true,
            lockPlayerQuantity: true
        }
    }
];

const GROUPS = [
    { title: "Start here", icon: "fas fa-flag", keys: ["restInterfaceMode", "eventBrowser"] },
    { title: "Rules & activities", icon: "fas fa-scroll", keys: ["recoveryConfig", "activityConfig", "dietConfigMenu"] },
    { title: "Players", icon: "fas fa-users", keys: ["playerRestrictions"] },
    { title: "Display", icon: "fas fa-eye", keys: ["ambientAfkHud"] },
    { title: "Tools", icon: "fas fa-wrench", keys: ["clearRestState"] }
];

/**
 * @param {string} key
 * @param {*} value
 * @returns {{ text: string, cssClass: string }}
 */
function formatProfileCell(key, value) {
    if (key === "trainingXpTier") {
        const tier = Number(value) || 0;
        const text = getTrainingTierLabel(tier);
        return { text, cssClass: tier > 0 ? "on" : "off" };
    }
    if (key === "fletchingYieldTier") {
        const tier = Number(value) || 0;
        const text = getFletchingTierLabel(tier);
        return { text, cssClass: tier > 0 ? "on" : "off" };
    }
    return { text: value ? "On" : "Off", cssClass: value ? "on" : "off" };
}

export function registerRespiteSettingsPanel() {
    const MCP = game.ionrift?.library?.ModuleConfigProfiles;
    if (!MCP) return;

    MCP.register({
        moduleId: MODULE_ID,
        moduleLabel: "Respite",
        anchorKey: "eventBrowser",
        quickSetup: {
            title: "Quick setup",
            subtitle: "Pick a starting point for the table. Every option stays adjustable in the panels below.",
            profiles: PROFILES,
            profileKeys: PROFILE_KEYS,
            keyLabels: KEY_LABELS,
            formatCell: formatProfileCell,
            confirmNote: "The interface mode, scene token names, and per-character diets are left as they are. Fine-tune anything afterward in the panels below.",
            confirmRowGroups: [{ beforeKey: PLAYER_KEYS[0], label: "Player rules" }],
            guideTooltip: "Opens the in-Foundry player guide: rest phases, comfort tiers, and what your nightly camp activity does.",
            onGuide: () => game.ionrift?.respite?.openPlayerGuide?.()
        },
        groups: GROUPS
    });
}

/** @deprecated Use library ModuleConfigProfiles; kept for harness compatibility */
export function enhanceRespiteSettings(root) {
    const config = game.ionrift?.library?.ModuleConfigProfiles?._registry?.get(MODULE_ID);
    if (config) game.ionrift.library.ModuleConfigProfiles.enhanceSettingsSection(root, config);
}
