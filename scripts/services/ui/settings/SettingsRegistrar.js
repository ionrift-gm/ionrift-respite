import { registerItemEnrichments, SETTING_KEYS, MENU_KEYS, ENRICHMENT_KEYS } from "./ItemEnrichmentsRegistrar.js";
import { EventBrowserApp } from "../../../apps/events/EventBrowserApp.js";
import { ActivityConfigApp } from "../../../apps/crafting/ActivityConfigApp.js";
import { RecoveryConfigApp } from "../../../apps/rest/RecoveryConfigApp.js";
import { isComfortEnabled } from "../../camp/gear/ComfortCalculator.js";
import { PlayerRestrictionsApp } from "../../../apps/rest/PlayerRestrictionsApp.js";
import { RecipeEditorApp } from "../../../apps/crafting/RecipeEditorApp.js";
import { ItemProvisionsApp } from "../../../apps/meal/ItemProvisionsApp.js";
import { applyCustomRecipesToLiveEngines } from "../../crafting/recipes/RecipeCatalog.js";
import { migrateFletchingYieldTier } from "../../crafting/settings/FletchingSettings.js";
import { migrateTrainingXpTier } from "../../crafting/settings/TrainingSettings.js";
import { migrateUseTravel } from "../../travel/settings/TravelSettings.js";
import { registerRespiteSettingsPanel } from "./SettingsPanelLayout.js";
import { MODULE_ID } from "../../../data/moduleId.js";

/**
 * Registers all module settings, menus, and item enrichment entries.
 * Must be called during the init hook, after `game.ionrift.respite` is constructed.
 *
 * @param {object} opts
 * @param {typeof import("../../../apps/meal/DietConfigApp.js").DietConfigApp} opts.DietConfigApp
 * @param {function} opts.onAmbientAfkChange - Callback when ambientAfkHud setting changes.
 */
export function registerAllSettings({ DietConfigApp, onAmbientAfkChange }) {

    game.settings.registerMenu(MODULE_ID, "eventBrowser", {
        name: "ionrift-respite.menus.eventBrowser.name",
        label: "ionrift-respite.menus.eventBrowser.label",
        hint: "ionrift-respite.menus.eventBrowser.hint",
        icon: "fas fa-book-open",
        type: EventBrowserApp,
        restricted: true
    });

    // Menu removed: roster UI now lives in ionrift-library (game.ionrift.library.party).
    // Setting kept so the library migration hook can seed from existing Respite data.
    game.settings.register(MODULE_ID, "partyRoster", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    game.settings.registerMenu(MODULE_ID, "dietConfigMenu", {
        name: "ionrift-respite.menus.dietConfigMenu.name",
        label: "ionrift-respite.menus.dietConfigMenu.label",
        hint: "ionrift-respite.menus.dietConfigMenu.hint",
        icon: "fas fa-utensils",
        type: DietConfigApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "itemProvisionsConfig", {
        name: "ionrift-respite.menus.itemProvisionsConfig.name",
        label: "ionrift-respite.menus.itemProvisionsConfig.label",
        hint: "ionrift-respite.menus.itemProvisionsConfig.hint",
        icon: "fas fa-carrot",
        type: ItemProvisionsApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "activityConfig", {
        name: "ionrift-respite.menus.activityConfig.name",
        label: "ionrift-respite.menus.activityConfig.label",
        hint: "ionrift-respite.menus.activityConfig.hint",
        icon: "fas fa-campground",
        type: ActivityConfigApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "recipeEditor", {
        name: "ionrift-respite.menus.recipeEditor.name",
        label: "ionrift-respite.menus.recipeEditor.label",
        hint: "ionrift-respite.menus.recipeEditor.hint",
        icon: "fas fa-mortar-pestle",
        type: RecipeEditorApp,
        restricted: true
    });

    game.settings.register(MODULE_ID, "customRecipes", {
        scope: "world",
        config: false,
        type: Object,
        default: {},
        restricted: true,
        onChange: () => {
            applyCustomRecipesToLiveEngines({ render: true });
        }
    });

    game.settings.registerMenu(MODULE_ID, "recoveryConfig", {
        name: "ionrift-respite.menus.recoveryConfig.name",
        label: "ionrift-respite.menus.recoveryConfig.label",
        hint: "ionrift-respite.menus.recoveryConfig.hint",
        icon: "fas fa-heart-pulse",
        type: RecoveryConfigApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "playerRestrictions", {
        name: "ionrift-respite.menus.playerRestrictions.name",
        label: "ionrift-respite.menus.playerRestrictions.label",
        hint: "ionrift-respite.menus.playerRestrictions.hint",
        icon: "fas fa-user-lock",
        type: PlayerRestrictionsApp,
        restricted: true
    });

    game.settings.register(MODULE_ID, "restInterfaceMode", {
        name: "ionrift-respite.settings.restInterfaceMode.name",
        hint: "ionrift-respite.settings.restInterfaceMode.hint",
        scope: "world",
        config: true,
        type: String,
        default: "theater",
        choices: {
            theater: "ionrift-respite.settings.restInterfaceMode.choices.theater",
            stations: "ionrift-respite.settings.restInterfaceMode.choices.stations"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "interceptRests", {
        name: "ionrift-respite.settings.interceptRests.name",
        hint: "ionrift-respite.settings.interceptRests.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "armorDoffRule", {
        name: "ionrift-respite.settings.armorDoffRule.name",
        hint: "ionrift-respite.settings.armorDoffRule.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableComfort", {
        name: "ionrift-respite.settings.enableComfort.name",
        hint: "ionrift-respite.settings.enableComfort.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: () => registerItemEnrichments()
    });

    game.settings.register(MODULE_ID, "enableCampfireMinigame", {
        name: "ionrift-respite.settings.enableCampfireMinigame.name",
        hint: "ionrift-respite.settings.enableCampfireMinigame.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableWorkbenchIdentify", {
        name: "ionrift-respite.settings.enableWorkbenchIdentify.name",
        hint: "ionrift-respite.settings.enableWorkbenchIdentify.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "spellRecoveryMaxLevel", {
        name: "ionrift-respite.settings.spellRecoveryMaxLevel.name",
        hint: "ionrift-respite.settings.spellRecoveryMaxLevel.hint",
        scope: "world",
        config: false,
        type: Number,
        default: 5,
        range: { min: 1, max: 9, step: 1 },
        restricted: true
    });

    game.settings.register(MODULE_ID, "songOfRestTiming", {
        name: "ionrift-respite.settings.songOfRestTiming.name",
        hint: "ionrift-respite.settings.songOfRestTiming.hint",
        scope: "world",
        config: false,
        type: String,
        default: "endOfRest",
        choices: {
            endOfRest: "ionrift-respite.settings.songOfRestTiming.choices.endOfRest",
            withFirstHitDie: "ionrift-respite.settings.songOfRestTiming.choices.withFirstHitDie",
        },
        restricted: true,
    });

    game.settings.register(MODULE_ID, "maxValueHitDice", {
        name: "ionrift-respite.settings.maxValueHitDice.name",
        hint: "ionrift-respite.settings.maxValueHitDice.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
    });

    game.settings.register(MODULE_ID, "shortRestFireWarmth", {
        name: "ionrift-respite.settings.shortRestFireWarmth.name",
        hint: "ionrift-respite.settings.shortRestFireWarmth.hint",
        scope: "world",
        config: false,
        type: String,
        default: "none",
        choices: {
            none: "ionrift-respite.settings.shortRestFireWarmth.choices.none",
            "1": "ionrift-respite.settings.shortRestFireWarmth.choices.n1",
            "1d4": "ionrift-respite.settings.shortRestFireWarmth.choices.n1d4"
        },
        restricted: true,
        onChange: () => {
            Object.values(ui.windows).forEach(w => {
                if (w?.constructor?.name === "BivouacApp" || w?.constructor?.name === "ShortRestApp") {
                    w.render();
                }
            });
        }
    });

    game.settings.register(MODULE_ID, "maxWaterPerDayCap", {
        name: "ionrift-respite.settings.maxWaterPerDayCap.name",
        hint: "ionrift-respite.settings.maxWaterPerDayCap.hint",
        scope: "world",
        config: false,
        type: Number,
        default: 16,
        restricted: true
    });

    game.settings.register(MODULE_ID, "maxFoodPerDayCap", {
        name: "ionrift-respite.settings.maxFoodPerDayCap.name",
        hint: "ionrift-respite.settings.maxFoodPerDayCap.hint",
        scope: "world",
        config: false,
        type: Number,
        default: 3,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableTraining", {
        name: "ionrift-respite.settings.enableTraining.name",
        hint: "ionrift-respite.settings.enableTraining.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "trainingXpTier", {
        name: "ionrift-respite.settings.trainingXpTier.name",
        hint: "ionrift-respite.settings.trainingXpTier.hint",
        scope: "world",
        config: false,
        type: Number,
        default: 0,
        restricted: true
    });

    game.settings.register(MODULE_ID, "trainingXpTierMigrated", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "enableProfessions", {
        name: "ionrift-respite.settings.enableProfessions.name",
        hint: "ionrift-respite.settings.enableProfessions.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableBrewingAlcohol", {
        name: "ionrift-respite.settings.enableBrewingAlcohol.name",
        hint: "ionrift-respite.settings.enableBrewingAlcohol.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => {
            const live = foundry.applications.instances.get("ionrift-respite-setup");
            if (live?.render) live.render();
        }
    });

    game.settings.register(MODULE_ID, "chefTreatCookingOnly", {
        name: "ionrift-respite.settings.chefTreatCookingOnly.name",
        hint: "ionrift-respite.settings.chefTreatCookingOnly.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: () => {
            const live = foundry.applications.instances.get("ionrift-respite-setup");
            applyCustomRecipesToLiveEngines({ render: true });
            if (live?.render) live.render();
        }
    });

    game.settings.register(MODULE_ID, "chefTreatsProvideSustenance", {
        name: "ionrift-respite.settings.chefTreatsProvideSustenance.name",
        hint: "ionrift-respite.settings.chefTreatsProvideSustenance.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableFletching", {
        name: "ionrift-respite.settings.enableFletching.name",
        hint: "ionrift-respite.settings.enableFletching.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "fletchingYieldTier", {
        name: "ionrift-respite.settings.fletchingYieldTier.name",
        hint: "ionrift-respite.settings.fletchingYieldTier.hint",
        scope: "world",
        config: false,
        type: Number,
        default: 1,
        restricted: true
    });

    game.settings.register(MODULE_ID, "fletchingYieldTierMigrated", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "enableEncounters", {
        name: "ionrift-respite.settings.enableEncounters.name",
        hint: "ionrift-respite.settings.enableEncounters.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableCopySpell", {
        name: "ionrift-respite.settings.enableCopySpell.name",
        hint: "ionrift-respite.settings.enableCopySpell.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enablePrayMeditate", {
        name: "ionrift-respite.settings.enablePrayMeditate.name",
        hint: "ionrift-respite.settings.enablePrayMeditate.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableForaging", {
        name: "ionrift-respite.settings.enableForaging.name",
        hint: "ionrift-respite.settings.enableForaging.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableHunting", {
        name: "ionrift-respite.settings.enableHunting.name",
        hint: "ionrift-respite.settings.enableHunting.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "campFuelFindChance", {
        name: "ionrift-respite.settings.campFuelFindChance.name",
        hint: "ionrift-respite.settings.campFuelFindChance.hint",
        scope: "world",
        config: false,
        type: Number,
        default: 5,
        restricted: true,
        onChange: () => {
            import("../../travel/forage/ForageTableSync.js").then(({ ForageTableSync }) => {
                ForageTableSync.scheduleSync();
            });
        }
    });

    game.settings.register(MODULE_ID, "homebrewProvisionOnly", {
        name: "ionrift-respite.settings.homebrewProvisionOnly.name",
        hint: "ionrift-respite.settings.homebrewProvisionOnly.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: () => {
            const live = foundry.applications.instances.get("ionrift-respite-setup");
            applyCustomRecipesToLiveEngines({ render: true });
            import("../../rest/forage/GatherYieldService.js").then(async ({ GatherYieldService }) => {
                const resolver = GatherYieldService.getResolver();
                if (resolver) {
                    const { applyTravelProvisionBatches } = await import("../../travel/resolve/TravelProvisionIndex.js");
                    await applyTravelProvisionBatches(resolver);
                }
                if (live?.render) await live.render();
            });
            import("../../travel/forage/ForageTableSync.js").then(({ ForageTableSync }) => {
                ForageTableSync.scheduleSync();
            });
        }
    });

    game.settings.register(MODULE_ID, "useTravel", {
        name: "ionrift-respite.settings.useTravel.name",
        hint: "ionrift-respite.settings.useTravel.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "useTravelMigrated", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "useTravelPhaseSemanticsMigrated", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    // Surfaced in the Food & Diet dialog (DietConfigApp), not the native panel.
    // Default off so a fresh world matches the Standard Quick Setup profile;
    // the Survival profile turns meal tracking on.
    game.settings.register(MODULE_ID, "trackFood", {
        name: "ionrift-respite.settings.trackFood.name",
        hint: "ionrift-respite.settings.trackFood.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    // Default off so a fresh world matches the Standard Quick Setup profile;
    // the Survival profile turns this leniency on alongside meal tracking.
    game.settings.register(MODULE_ID, "partialSustenance", {
        name: "ionrift-respite.settings.partialSustenance.name",
        hint: "ionrift-respite.settings.partialSustenance.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    // Surfaced in the Food & Diet dialog (DietConfigApp), not the native panel.
    game.settings.register(MODULE_ID, "spoilageNameSuffix", {
        name: "ionrift-respite.settings.spoilageNameSuffix.name",
        hint: "ionrift-respite.settings.spoilageNameSuffix.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "lockPlayerQuantity", {
        name: "ionrift-respite.settings.lockPlayerQuantity.name",
        hint: "ionrift-respite.settings.lockPlayerQuantity.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "lockAttuneOutsideRest", {
        name: "ionrift-respite.settings.lockAttuneOutsideRest.name",
        hint: "ionrift-respite.settings.lockAttuneOutsideRest.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    /** Remembered from Rest Setup: long rest uses safe rest spot (no encounter risk). */
    game.settings.register(MODULE_ID, "safeRestSpot", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "campfireTokenName", {
        name: "ionrift-respite.settings.campfireTokenName.name",
        hint: "ionrift-respite.settings.campfireTokenName.hint",
        scope: "world",
        config: false,
        type: String,
        default: "Campfire",
        restricted: true
    });

    game.settings.register(MODULE_ID, "torchTokenName", {
        name: "ionrift-respite.settings.torchTokenName.name",
        hint: "ionrift-respite.settings.torchTokenName.hint",
        scope: "world",
        config: false,
        type: String,
        default: "Perimeter Torch",
        restricted: true
    });

    game.settings.register(MODULE_ID, "torchAutoLink", {
        name: "ionrift-respite.settings.torchAutoLink.name",
        hint: "ionrift-respite.settings.torchAutoLink.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "customFoodNames", {
        name: "ionrift-respite.settings.customFoodNames.name",
        hint: "ionrift-respite.settings.customFoodNames.hint",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    game.settings.register(MODULE_ID, "customWaterNames", {
        name: "ionrift-respite.settings.customWaterNames.name",
        hint: "ionrift-respite.settings.customWaterNames.hint",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    game.settings.register(MODULE_ID, "restRecoveryDetected", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "lastRestDate", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "lastTerrain", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "lastWeather", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "activeRest", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "activeShortRest", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "activeGrittyRest", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "enabledPacks", {
        scope: "world",
        config: false,
        type: Object,
        default: { base: true }
    });

    game.settings.register(MODULE_ID, "eventPoolSelection", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    game.settings.register(MODULE_ID, "eventPoolInitialized", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "eventPoolNudgeSuppressed", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "eventPoolNudgeSnoozedUntil", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "importedPacks", {
        scope: "world",
        config: false,
        type: Object,
        default: {}
    });

    // Legacy: no longer read. Art follows each overlay's active state.
    game.settings.register(MODULE_ID, "artPackDisabled", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    // ArtOverlayCatalog writes the GM's merged art scan here for players.
    game.settings.register(MODULE_ID, "artPackCache", {
        scope: "world",
        config: false,
        type: Object,
        default: { active: false, path: null, terrains: [] }
    });

    game.settings.register(MODULE_ID, "artNudgeSnoozedUntil", {
        scope: "world",
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID, "artNudgeSuppressed", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    const SettingsLayout = game.ionrift?.library?.SettingsLayout;
    SettingsLayout?.registerFooter(MODULE_ID, {
        wiki: "https://github.com/ionrift-gm/ionrift-respite/wiki"
    });

    // Parked. Kept registered so existing worlds still load. Not shown in settings.
    game.settings.register(MODULE_ID, "ambientAfkHud", {
        name: "ionrift-respite.settings.ambientAfkHud.name",
        hint: "ionrift-respite.settings.ambientAfkHud.hint",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        onChange: onAmbientAfkChange,
        restricted: true
    });

    game.settings.register(MODULE_ID, "hideTerrainBanners", {
        name: "ionrift-respite.settings.hideTerrainBanners.name",
        hint: "ionrift-respite.settings.hideTerrainBanners.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: () => {
            for (const app of Object.values(ui.windows ?? {})) {
                if (app.id === "ionrift-respite-setup" || app.id === "short-rest-app" || app.constructor?.name === "RestSetupApp" || app.constructor?.name === "ShortRestApp") {
                    app.render(false);
                }
            }
        }
    });

    game.settings.register(MODULE_ID, "uiTheme", {
        name: "ionrift-respite.settings.uiTheme.name",
        hint: "ionrift-respite.settings.uiTheme.hint",
        scope: "client",
        config: false,
        type: String,
        choices: {
            "glass": "ionrift-respite.settings.uiTheme.choices.glass",
            "cockpit": "ionrift-respite.settings.uiTheme.choices.cockpit"
        },
        default: "glass",
        onChange: (theme) => {
            const apps = [
                ...Object.values(ui.windows ?? {}),
                ...(foundry.applications?.instances ? Array.from(foundry.applications.instances.values()) : [])
            ];
            for (const app of apps) {
                if (app.element) {
                    app.element.classList.toggle("theme-ionrift-glass", theme === "glass");
                    app.element.classList.toggle("theme-respite-cockpit", theme === "cockpit");
                }
                if (app.id === "ionrift-respite-setup" || app.id === "short-rest-app" || app.id === "ionrift-bivouac-hud" || app.constructor?.name === "RestSetupApp" || app.constructor?.name === "ShortRestApp" || app.constructor?.name === "BivouacApp") {
                    app.render(false);
                }
            }
        }
    });

    game.settings.register(MODULE_ID, "afkPanelLayout", {
        name: "ionrift-respite.settings.afkPanelLayout.name",
        scope: "client",
        config: false,
        type: Object,
        default: { locked: true, left: 12, top: 120 }
    });

    game.settings.register(MODULE_ID, "debug", {
        name: "ionrift-respite.settings.debug.name",
        hint: "ionrift-respite.settings.debug.hint",
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "clearRestState", {
        name: "ionrift-respite.menus.clearRestState.name",
        label: "ionrift-respite.menus.clearRestState.label",
        hint: "ionrift-respite.menus.clearRestState.hint",
        icon: "fas fa-broom",
        type: class ClearRestStateApp extends FormApplication {
            async _updateObject() {
                await game.ionrift.respite.resetFlowState();
            }
            async render() {
                const proceed = await Dialog.confirm({
                    title: game.i18n.localize("ionrift-respite.menus.clearRestState.dialogTitle"),
                    content: game.i18n.localize("ionrift-respite.menus.clearRestState.dialogContent"),
                    yes: () => true,
                    no: () => false,
                    defaultYes: false
                });
                if (proceed) await this._updateObject();
            }
        },
        restricted: true
    });

    registerRespiteSettingsPanel();
}

Hooks.once("ready", () => {
    migrateTrainingXpTier();
    migrateFletchingYieldTier();
    migrateUseTravel();
});

export { registerItemEnrichments, SETTING_KEYS, MENU_KEYS, ENRICHMENT_KEYS };
