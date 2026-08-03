import { EventBrowserApp } from "../../../apps/events/EventBrowserApp.js";
import { ActivityConfigApp } from "../../../apps/crafting/ActivityConfigApp.js";
import { RecoveryConfigApp } from "../../../apps/rest/RecoveryConfigApp.js";
import { isComfortEnabled } from "../../camp/gear/ComfortCalculator.js";
import { PlayerRestrictionsApp } from "../../../apps/rest/PlayerRestrictionsApp.js";
import { RecipeEditorApp } from "../../../apps/crafting/RecipeEditorApp.js";
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
        name: "Event Pool",
        label: "Curate Event Pool",
        hint: "Browse, import, and enable camp night events.",
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
        name: "Food & Diet",
        label: "Configure Food & Diet",
        hint: "Meal tracking, house rules, and per-character diets.",
        icon: "fas fa-utensils",
        type: DietConfigApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "activityConfig", {
        name: "Travel & Activities",
        label: "Configure Travel & Activities",
        hint: "Travel phase and camp activity toggles, including Training and Fletching tiers.",
        icon: "fas fa-campground",
        type: ActivityConfigApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "recipeEditor", {
        name: "Custom Recipes",
        label: "Edit Custom Recipes",
        hint: "Homebrew recipes by profession. Ingredient names must match Respite Custom or Respite Items.",
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
        name: "Recovery Rules",
        label: "Configure Recovery",
        hint: "Armor sleep rules, spell recovery, Song of Rest, and Hit Dice options.",
        icon: "fas fa-heart-pulse",
        type: RecoveryConfigApp,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "playerRestrictions", {
        name: "Player Restrictions",
        label: "Configure Restrictions",
        hint: "Rest interception, quantity locks, and attunement limits.",
        icon: "fas fa-user-lock",
        type: PlayerRestrictionsApp,
        restricted: true
    });

    game.settings.register(MODULE_ID, "restInterfaceMode", {
        name: "Rest Interface Mode",
        hint: "One window: full rest in a panel. Camp stations: place camp pieces on the scene and move tokens to act.",
        scope: "world",
        config: true,
        type: String,
        default: "theater",
        choices: {
            theater: "One window",
            stations: "Camp stations"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "interceptRests", {
        name: "Intercept Player Rests",
        hint: "Block default Short/Long Rest buttons. Players use the Respite flow instead.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "armorDoffRule", {
        name: "Armor Sleep Penalties",
        hint: "Medium/heavy armor: fewer Hit Dice recovered, no exhaustion reduction (Xanathar's). Watch is exempt.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableComfort", {
        name: "Comfort Rules (Homebrew)",
        hint: "Terrain comfort, fire, and gear recovery. Off: no comfort penalties, fire phase, or terrain exhaustion saves.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: () => registerItemEnrichments()
    });

    game.settings.register(MODULE_ID, "enableCampfireMinigame", {
        name: "Campfire Minigame",
        hint: "Use the campfire minigame for lighting and fire intensity instead of tier buttons.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableWorkbenchIdentify", {
        name: "Workbench Identify Tab (TotM)",
        hint: "Show the Identify tab on the TotM workbench during Activities.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "spellRecoveryMaxLevel", {
        name: "Spell Recovery Max Level",
        hint: "Highest slot level for Arcane/Natural Recovery (2014 default: 5).",
        scope: "world",
        config: false,
        type: Number,
        default: 5,
        range: { min: 1, max: 9, step: 1 },
        restricted: true
    });

    game.settings.register(MODULE_ID, "songOfRestTiming", {
        name: "Song of Rest Timing",
        hint: "When the Song of Rest bonus die is rolled on a short rest.",
        scope: "world",
        config: false,
        type: String,
        default: "endOfRest",
        choices: {
            endOfRest: "End of short rest",
            withFirstHitDie: "With first Hit Die",
        },
        restricted: true,
    });

    game.settings.register(MODULE_ID, "maxValueHitDice", {
        name: "Short Rest: Max Hit Dice (Homebrew)",
        hint: "Short rest Hit Dice heal for maximum + CON instead of rolling.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
    });

    game.settings.register(MODULE_ID, "maxWaterPerDayCap", {
        name: "Max Water Needs Cap",
        hint: "Maximum water units required per character per day across all conditions and terrain.",
        scope: "world",
        config: false,
        type: Number,
        default: 4,
        restricted: true
    });

    game.settings.register(MODULE_ID, "maxFoodPerDayCap", {
        name: "Max Food Needs Cap",
        hint: "Maximum food units required per character per day across all conditions and terrain.",
        scope: "world",
        config: false,
        type: Number,
        default: 3,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableTraining", {
        name: "Training Activity (legacy)",
        hint: "Legacy boolean. Migrated to trainingXpTier on first load.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "trainingXpTier", {
        name: "Training XP Tier",
        hint: "0 off. 1-5: fail/pass XP per set (3/10 to 10/50).",
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
        name: "Crafting Professions",
        hint: "Show cooking and crafting during rest.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableBrewingAlcohol", {
        name: "Alcoholic Ferments",
        hint: "Allow alcoholic brewing recipes (wine, mead, draughts). Off for dry or younger tables. Steeps stay available.",
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
        name: "Chef Treats Only (RAW)",
        hint: "Disable camp meal crafting. Chef feat Bolstering Treats still work.",
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

    game.settings.register(MODULE_ID, "enableFletching", {
        name: "Fletching Activity (legacy)",
        hint: "Legacy boolean. Migrated to fletchingYieldTier on first load.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "fletchingYieldTier", {
        name: "Fletching Yield Tier",
        hint: "0 off. 1-5: success yield dice (2d4+prof to 2d20+prof).",
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
        name: "Night Encounters (Homebrew)",
        hint: "Night check, Keep Watch, and related camp defenses. Off: night passes with no check.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableCopySpell", {
        name: "Copy Spell Activity",
        hint: "Show Copy Spell on long rests for wizards with a spellbook.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enablePrayMeditate", {
        name: "Pray / Meditate Activity",
        hint: "Show Pray / Meditate. Religion or Insight for temp HP on success.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableScouting", {
        name: "Travel Scouting",
        hint: "Scout on the last travel day. Requires Use Travel.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableForaging", {
        name: "Travel Foraging",
        hint: "Allow foraging on travel days.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableHunting", {
        name: "Travel Hunting",
        hint: "Allow hunting on travel days.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "campFuelFindChance", {
        name: "Camp Fuel Find Chance",
        hint: "Percent chance a successful forage also grants kindling. 0 disables.",
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
        name: "Homebrew Provisions Only",
        hint: "Cooking, forage, and hunt use custom recipes and Respite Custom only.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: () => {
            const live = foundry.applications.instances.get("ionrift-respite-setup");
            applyCustomRecipesToLiveEngines({ render: true });
            if (live?._travel?.getTravelResolver) {
                import("../../travel/resolve/TravelProvisionIndex.js").then(async ({ applyTravelProvisionBatches }) => {
                    await applyTravelProvisionBatches(live._travel.getTravelResolver());
                    if (live.render) await live.render();
                });
            }
            import("../../travel/forage/ForageTableSync.js").then(({ ForageTableSync }) => {
                ForageTableSync.scheduleSync();
            });
        }
    });

    game.settings.register(MODULE_ID, "useTravel", {
        name: "Use Travel",
        hint: "Include the travel phase on long rests. Off skips to camp.",
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
        name: "Track Food & Water",
        hint: "Show the Meal phase on long rests (rations, water, starvation advisories).",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    // Default off so a fresh world matches the Standard Quick Setup profile;
    // the Survival profile turns this leniency on alongside meal tracking.
    game.settings.register(MODULE_ID, "partialSustenance", {
        name: "Partial Sustenance (House Rule)",
        hint: "Partial food/water in harsh terrains still helps (CON bonus or longer grace). Off for strict RAW.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    // Surfaced in the Food & Diet dialog (DietConfigApp), not the native panel.
    game.settings.register(MODULE_ID, "spoilageNameSuffix", {
        name: "Spoilage Name Suffixes",
        hint: "Append freshness to perishable names on grant (e.g. Bird Eggs (3d)) so stacks stay separate.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "lockPlayerQuantity", {
        name: "Lock Player Quantity Controls",
        hint: "Players cannot change item quantities. GM still can.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "lockAttuneOutsideRest", {
        name: "Lock Attunement to Rest",
        hint: "Players may only attune or unattune during a rest.",
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
        name: "Campfire Token Name",
        hint: "Scene token name linked to campfire light. Case-insensitive.",
        scope: "world",
        config: false,
        type: String,
        default: "Campfire",
        restricted: true
    });

    game.settings.register(MODULE_ID, "torchTokenName", {
        name: "Perimeter Torch Token Name",
        hint: "Scene token name for perimeter torches. All matches toggle together.",
        scope: "world",
        config: false,
        type: String,
        default: "Perimeter Torch",
        restricted: true
    });

    game.settings.register(MODULE_ID, "torchAutoLink", {
        name: "Auto-Link Torches to Campfire",
        hint: "Perimeter torches light and extinguish with the campfire.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "customFoodNames", {
        name: "Custom Food Items",
        hint: "Extra food names for the meal phase, comma-separated (e.g. scrap metal, goodberries).",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    game.settings.register(MODULE_ID, "customWaterNames", {
        name: "Custom Water Items",
        hint: "Extra water names for the meal phase, comma-separated (e.g. oil, wine, ale).",
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

    game.settings.register(MODULE_ID, "artPackDisabled", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

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

    // PF2e early-support advisory (one-time)
    game.settings.register(MODULE_ID, "pf2eAdvisoryShown", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    const SettingsLayout = game.ionrift?.library?.SettingsLayout;
    SettingsLayout?.registerFooter(MODULE_ID, {
        wiki: "https://github.com/ionrift-gm/ionrift-respite/wiki"
    });

    game.settings.register(MODULE_ID, "ambientAfkHud", {
        name: "Ambient AFK HUD",
        hint: "Keep the AFK strip visible outside active rests. Off: only during rest.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: onAmbientAfkChange,
        restricted: true
    });

    game.settings.register(MODULE_ID, "afkPanelLayout", {
        name: "AFK panel layout",
        scope: "client",
        config: false,
        type: Object,
        default: { locked: true, left: 12, top: 120 }
    });

    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for rest flow.",
        scope: "client",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.registerMenu(MODULE_ID, "clearRestState", {
        name: "Reset Rest State",
        label: "Reset Rest State",
        hint: "Clear stuck rest locks, remove camp tokens on the active scene, and reload clients.",
        icon: "fas fa-broom",
        type: class ClearRestStateApp extends FormApplication {
            async _updateObject() {
                await game.ionrift.respite.resetFlowState();
            }
            async render() {
                const proceed = await Dialog.confirm({
                    title: "Reset Rest State",
                    content: "<p>Clears rest locks and in-progress rest state, removes camp tokens on the active scene, and reloads all clients.</p>",
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

/**
 * Registers Respite-specific item enrichments with the shared library engine.
 * Called during init, after the library is available.
 */
export function registerItemEnrichments() {
    const comfortOn = isComfortEnabled();
    game.ionrift?.library?.enrichment?.registerBatch({

        "bedroll": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> A character carrying a bedroll recovers <strong>+1 Hit Die</strong> during a long rest, regardless of camp comfort level. This bonus stacks with normal HD recovery.</p>`
                : `<hr><p><strong>Respite:</strong> Bedroll tracked for rest flavour. <em>Comfort rules disabled. No HD bonus applied.</em></p>`,
            tags: comfortOn ? ["+1 HD Recovery"] : ["Comfort Off"]
        },

        "two-person tent": {
            html: `<hr><p><strong>Respite:</strong> Provides <strong>Shelter</strong> during rest. Shelter reduces the encounter DC and can negate minor weather effects.</p>`,
            tags: ["Shelter", "Weather Protection"]
        },
        "tent, two-person": {
            html: `<hr><p><strong>Respite:</strong> Provides <strong>Shelter</strong> during rest. Shelter reduces the encounter DC and can negate minor weather effects.</p>`,
            tags: ["Shelter", "Weather Protection"]
        },
        "pavilion": {
            html: `<hr><p><strong>Respite:</strong> A large pavilion tent provides <strong>Shelter</strong> during rest. Provides full weather protection and significantly reduces the encounter DC.</p>`,
            tags: ["Shelter", "Full Weather Protection"]
        },
        "tent": {
            html: `<hr><p><strong>Respite:</strong> Provides <strong>Shelter</strong> during rest. Shelter reduces the encounter DC and can negate minor weather effects.</p>`,
            tags: ["Shelter", "Weather Protection"]
        },

        "mess kit": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> A character carrying a mess kit gains <strong>advantage on the exhaustion save</strong> during rest, but only when the campfire is lit. Without a fire, the mess kit provides no mechanical benefit. Functions identically to Cook's Utensils for this purpose.</p>`
                : `<hr><p><strong>Respite:</strong> Mess kit tracked for rest flavour. <em>Comfort rules disabled. No exhaustion advantage applied.</em></p>`,
            tags: comfortOn ? ["Exhaustion Advantage (with fire)"] : ["Comfort Off"]
        },

        "cook's utensils": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> A character carrying Cook's Utensils gains <strong>advantage on the exhaustion save</strong> during rest when the campfire is lit. Also qualifies for the <strong>Cooking</strong> crafting profession, allowing the character to prepare meals that grant temporary buffs.</p>`
                : `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Cooking</strong> crafting profession during rest. <em>Comfort rules disabled. No exhaustion advantage applied.</em></p>`,
            tags: comfortOn ? ["Exhaustion Advantage (with fire)", "Cooking Profession"] : ["Cooking Profession", "Comfort Off"]
        },

        "rations": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 ration per day (some terrains require 2). Characters who go without food risk exhaustion after their grace period expires. Rations are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)"]
        },
        "rations (1 day)": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 ration per day (some terrains require 2). Characters who go without food risk exhaustion after their grace period expires. Rations are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)"]
        },

        "waterskin": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 waterskin per day (desert and arid terrains require 2). Dehydration is tracked separately from hunger and triggers a CON save. Waterskins are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)", "Dehydration Tracking"]
        },

        "herbalism kit": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Herbalism</strong> crafting profession during rest. Characters proficient with this kit can gather and prepare herbal remedies, antidotes, and poultices during the Activity phase.</p>`,
            tags: ["Herbalism Profession"]
        },

        "healer's kit": {
            html: `<hr><p><strong>Respite:</strong> Used during the <strong>Tend Wounds</strong> activity. Grants advantage on the Medicine check and adds 1d4 to the healing roll (1 charge spent). Characters with the <strong>Healer</strong> feat use the feat formula (1d6 + 4 + target level) instead.</p>`,
            tags: ["Tend Wounds Activity"]
        },

        "alchemist's supplies": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Alchemy</strong> crafting profession during rest. Characters proficient with these supplies can brew potions and concoctions during the Activity phase.</p>`,
            tags: ["Alchemy Profession"]
        },

        "tinker's tools": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Tinkering</strong> crafting profession during rest. Characters proficient with these tools can repair gear or craft small mechanical devices during the Activity phase.</p>`,
            tags: ["Tinkering Profession"]
        },

        "tinderbox": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> Required to <strong>light the campfire</strong> during the Camp phase. Without a tinderbox (or equivalent), the party cannot start a fire, losing access to cooking, warmth bonuses, and campfire-dependent activities. One tinderbox serves the whole party.</p>`
                : `<hr><p><strong>Respite:</strong> Tinderbox tracked for rest flavour. <em>Comfort rules disabled. Fire phase is bypassed.</em></p>`,
            tags: comfortOn ? ["Campfire (required)"] : ["Comfort Off"]
        },

        "fresh meat": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (1 day).</strong> Raw game meat from hunting. Spoils after 1 rest if not cooked or preserved. Used as a cooking ingredient for recipes that call for meat. Cooking transforms it into a meal that feeds the party and may grant temporary buffs.</p>`,
            tags: ["Perishable (1 day)", "Cooking Ingredient"]
        },
        "fresh fish": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (1 day).</strong> Caught fresh from rivers or marshland. Spoils after 1 rest if not cooked. Used as a cooking ingredient for fish-based recipes.</p>`,
            tags: ["Perishable (1 day)", "Cooking Ingredient"]
        },
        "choice cut": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (1 day).</strong> A prime cut from an exceptional hunt. Spoils after 1 rest but produces superior meals when cooked. Higher-quality recipes may require choice cuts specifically.</p>`,
            tags: ["Perishable (1 day)", "Premium Ingredient"]
        },
        "wild berries": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (3 days).</strong> Foraged fruit. Can be eaten raw or used as a cooking ingredient. Spoils after 3 rests. Recipes using berries tend to produce preserves that last longer.</p>`,
            tags: ["Perishable (3 days)", "Edible Raw", "Cooking Ingredient"]
        },
        "edible berries": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (3 days).</strong> Foraged fruit. Can be eaten raw or used as a cooking ingredient. Spoils after 3 rests.</p>`,
            tags: ["Perishable (3 days)", "Edible Raw", "Cooking Ingredient"]
        },
        "edible mushrooms": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (3 days).</strong> Foraged fungi. Can be eaten raw (with some risk) or used in cooking. Spoils after 3 rests.</p>`,
            tags: ["Perishable (3 days)", "Cooking Ingredient"]
        },
        "wild herbs": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (3 days).</strong> Aromatic herbs foraged in the wild. Essential cooking ingredient for many recipes. Also used in herbalism. Spoils after 3 rests.</p>`,
            tags: ["Perishable (3 days)", "Cooking Ingredient", "Herbalism Ingredient"]
        },
        "healing herbs": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (3 days).</strong> Medicinal herbs foraged in the wild. Used in herbalism recipes and some advanced cooking. Spoils after 3 rests.</p>`,
            tags: ["Perishable (3 days)", "Herbalism Ingredient"]
        },
        "spiced jerky": {
            html: `<hr><p><strong>Respite:</strong> Dried, seasoned meat strips. <strong>Shelf-stable</strong> (does not spoil). Equivalent to rations for the Meal Phase. A cooking output that preserves meat for long journeys.</p>`,
            tags: ["Shelf-stable", "Meal Phase (1/day)"]
        },
        "smoked fish": {
            html: `<hr><p><strong>Respite:</strong> Cured fish. <strong>Shelf-stable</strong> (does not spoil). Equivalent to rations for the Meal Phase. A cooking output that preserves fish for travel.</p>`,
            tags: ["Shelf-stable", "Meal Phase (1/day)"]
        },
        "bird eggs": {
            html: `<hr><p><strong>Respite:</strong> <strong>Perishable (1 day).</strong> Foraged or gathered from nests. Fragile and quick to spoil. Used as a cooking ingredient.</p>`,
            tags: ["Perishable (1 day)", "Cooking Ingredient"]
        }
    });
}

/**
 * All setting keys registered by this module.
 * Useful for structural tests that verify every expected key is present.
 */
export const SETTING_KEYS = [
    "partyRoster",
    "restInterfaceMode",
    "interceptRests",
    "armorDoffRule",
    "enableComfort",
    "enableCampfireMinigame",
    "enableWorkbenchIdentify",
    "spellRecoveryMaxLevel",
    "songOfRestTiming",
    "maxValueHitDice",
    "enableTraining",
    "trainingXpTier",
    "trainingXpTierMigrated",
    "enableProfessions",
    "enableBrewingAlcohol",
    "chefTreatCookingOnly",
    "enableFletching",
    "fletchingYieldTier",
    "fletchingYieldTierMigrated",
    "enableEncounters",
    "enableCopySpell",
    "enablePrayMeditate",
    "enableScouting",
    "enableForaging",
    "enableHunting",
    "campFuelFindChance",
    "homebrewProvisionOnly",
    "useTravel",
    "useTravelPhaseSemanticsMigrated",
    "trackFood",
    "partialSustenance",
    "spoilageNameSuffix",
    "lockPlayerQuantity",
    "lockAttuneOutsideRest",
    "safeRestSpot",
    "campfireTokenName",
    "torchTokenName",
    "torchAutoLink",
    "customFoodNames",
    "customWaterNames",
    "restRecoveryDetected",
    "lastRestDate",
    "lastTerrain",
    "lastWeather",
    "activeRest",
    "activeShortRest",
    "enabledPacks",
    "eventPoolSelection",
    "eventPoolInitialized",
    "eventPoolNudgeSuppressed",
    "eventPoolNudgeSnoozedUntil",
    "importedPacks",
    "artPackDisabled",
    "artPackCache",
    "artNudgeSnoozedUntil",
    "artNudgeSuppressed",
    "pf2eAdvisoryShown",
    "ambientAfkHud",
    "afkPanelLayout",
    "debug"
];

/**
 * All menu keys registered by this module.
 */
export const MENU_KEYS = [
    "dietConfigMenu",
    "clearRestState"
];

/**
 * All enrichment item names registered.
 */
export const ENRICHMENT_KEYS = [
    "bedroll",
    "two-person tent",
    "tent, two-person",
    "pavilion",
    "tent",
    "mess kit",
    "cook's utensils",
    "rations",
    "rations (1 day)",
    "waterskin",
    "herbalism kit",
    "healer's kit",
    "alchemist's supplies",
    "tinker's tools",
    "tinderbox",
    "fresh meat",
    "fresh fish",
    "choice cut",
    "wild berries",
    "edible berries",
    "edible mushrooms",
    "wild herbs",
    "healing herbs",
    "spiced jerky",
    "smoked fish",
    "bird eggs"
];
