import { getFletchingTierLabel } from "../../crafting/settings/FletchingSettings.js";
import { getTrainingTierLabel } from "../../crafting/settings/TrainingSettings.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const COMPLEXITY_KEYS = [
    "enableComfort",
    "enableCampfireMinigame",
    "enableProfessions",
    "trainingXpTier",
    "fletchingYieldTier",
    "enableEncounters",
    "enableCopySpell",
    "enablePrayMeditate",
    "enableWorkbenchIdentify",
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

// Getters: registered at init and read at render, after translations load.
const KEY_LABELS = {
    get enableComfort() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableComfort"); },
    get enableCampfireMinigame() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableCampfireMinigame"); },
    get enableProfessions() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableProfessions"); },
    get trainingXpTier() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.trainingXpTier"); },
    get fletchingYieldTier() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.fletchingYieldTier"); },
    get enableEncounters() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableEncounters"); },
    get enableCopySpell() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableCopySpell"); },
    get enablePrayMeditate() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enablePrayMeditate"); },
    get enableWorkbenchIdentify() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableWorkbenchIdentify"); },
    get enableForaging() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableForaging"); },
    get enableHunting() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.enableHunting"); },
    get useTravel() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.useTravel"); },
    get trackFood() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.trackFood"); },
    get partialSustenance() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.partialSustenance"); },
    get armorDoffRule() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.armorDoffRule"); },
    get interceptRests() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.interceptRests"); },
    get lockAttuneOutsideRest() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.lockAttuneOutsideRest"); },
    get lockPlayerQuantity() { return game.i18n.localize("ionrift-respite.settingsPanel.keyLabels.lockPlayerQuantity"); }
};

const PROFILES = [
    {
        id: "simple",
        get label() { return game.i18n.localize("ionrift-respite.settingsPanel.profiles.simple.label"); },
        icon: "fas fa-feather",
        get desc() { return game.i18n.localize("ionrift-respite.settingsPanel.profiles.simple.desc"); },
        values: {
            enableComfort: false,
            enableCampfireMinigame: false,
            enableProfessions: false,
            trainingXpTier: 0,
            fletchingYieldTier: 0,
            enableEncounters: false,
            enableCopySpell: false,
            enablePrayMeditate: false,
            enableWorkbenchIdentify: false,
            enableForaging: false,
            enableHunting: false,
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
        get label() { return game.i18n.localize("ionrift-respite.settingsPanel.profiles.standard.label"); },
        icon: "fas fa-campground",
        get desc() { return game.i18n.localize("ionrift-respite.settingsPanel.profiles.standard.desc"); },
        values: {
            enableComfort: false,
            enableCampfireMinigame: true,
            enableProfessions: true,
            trainingXpTier: 0,
            fletchingYieldTier: 1,
            enableEncounters: true,
            enableCopySpell: true,
            enablePrayMeditate: false,
            enableWorkbenchIdentify: true,
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
        get label() { return game.i18n.localize("ionrift-respite.settingsPanel.profiles.survival.label"); },
        icon: "fas fa-mountain-sun",
        get desc() { return game.i18n.localize("ionrift-respite.settingsPanel.profiles.survival.desc"); },
        values: {
            enableComfort: true,
            enableCampfireMinigame: true,
            enableProfessions: true,
            trainingXpTier: 0,
            fletchingYieldTier: 1,
            enableEncounters: true,
            enableCopySpell: true,
            enablePrayMeditate: false,
            enableWorkbenchIdentify: true,
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
    { get title() { return game.i18n.localize("ionrift-respite.settingsPanel.groups.startHere"); }, icon: "fas fa-flag", keys: ["restInterfaceMode", "eventBrowser"] },
    { get title() { return game.i18n.localize("ionrift-respite.settingsPanel.groups.rulesActivities"); }, icon: "fas fa-scroll", keys: ["recoveryConfig", "activityConfig", "dietConfigMenu"] },
    { get title() { return game.i18n.localize("ionrift-respite.settingsPanel.groups.players"); }, icon: "fas fa-users", keys: ["playerRestrictions"] },
    { get title() { return game.i18n.localize("ionrift-respite.settingsPanel.groups.display"); }, icon: "fas fa-eye", keys: ["hideTerrainBanners"] },
    { get title() { return game.i18n.localize("ionrift-respite.settingsPanel.groups.tools"); }, icon: "fas fa-wrench", keys: ["clearRestState"] }
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
    return { text: value ? game.i18n.localize("ionrift-respite.settingsPanel.cellOn") : game.i18n.localize("ionrift-respite.settingsPanel.cellOff"), cssClass: value ? "on" : "off" };
}

export function registerRespiteSettingsPanel() {
    const MCP = game.ionrift?.library?.ModuleConfigProfiles;
    if (!MCP) return;

    MCP.register({
        moduleId: MODULE_ID,
        moduleLabel: "Respite",
        anchorKey: "eventBrowser",
        quickSetup: {
            get title() { return game.i18n.localize("ionrift-respite.settingsPanel.quickSetup.title"); },
            get subtitle() { return game.i18n.localize("ionrift-respite.settingsPanel.quickSetup.subtitle"); },
            profiles: PROFILES,
            profileKeys: PROFILE_KEYS,
            keyLabels: KEY_LABELS,
            formatCell: formatProfileCell,
            get confirmNote() { return game.i18n.localize("ionrift-respite.settingsPanel.quickSetup.confirmNote"); },
            confirmRowGroups: [{ beforeKey: PLAYER_KEYS[0], get label() { return game.i18n.localize("ionrift-respite.settingsPanel.quickSetup.playerRulesGroup"); } }]
        },
        groups: GROUPS
    });
}
