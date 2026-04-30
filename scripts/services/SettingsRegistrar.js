/**
 * @module SettingsRegistrar
 * @description Registers all module settings, menus, and item enrichments for ionrift-respite.
 * Extracted from module.js to reduce monolith size (Phase 2.1).
 *
 * Call {@link registerAllSettings} from the `Hooks.once("init", ...)` block.
 */

import { MONSTER_COOKING_FEATURE_LIVE } from "../FeatureFlags.mjs";

const MODULE_ID = "ionrift-respite";

/**
 * Registers all module settings, menus, and item enrichment entries.
 * Must be called during the init hook, after `game.ionrift.respite` is constructed.
 *
 * @param {object} opts
 * @param {typeof import("../apps/PackRegistryApp.js").PackRegistryApp} opts.PackRegistryApp
 * @param {typeof import("../apps/PartyRosterApp.js").PartyRosterApp} opts.PartyRosterApp
 * @param {typeof import("../apps/DietConfigApp.js").DietConfigApp} opts.DietConfigApp
 * @param {function} opts.onAmbientAfkChange - Callback when ambientAfkHud setting changes.
 */
export function registerAllSettings({ PackRegistryApp, PartyRosterApp, DietConfigApp, onAmbientAfkChange }) {

    // ── Content Packs button (via kernel) ────────────────────────────
    const SettingsLayoutForPack = game.ionrift?.library?.SettingsLayout;
    SettingsLayoutForPack?.registerPackButton(MODULE_ID, PackRegistryApp, {
        hint: "Enable or disable event content packs. Shows event counts per terrain."
    });

    // ── Menu: Party Roster ───────────────────────────────────────────
    game.settings.registerMenu(MODULE_ID, "partyRosterMenu", {
        name: "Party Roster",
        label: "Edit Roster",
        hint: "Choose which characters participate in Respite rests. Excludes summons, familiars, and companion sheets.",
        icon: "fas fa-users",
        type: PartyRosterApp,
        restricted: true
    });

    game.settings.register(MODULE_ID, "partyRoster", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    // ── Menu: Diet Profiles ──────────────────────────────────────────
    game.settings.registerMenu(MODULE_ID, "dietConfigMenu", {
        name: "Diet Profiles",
        label: "Configure Diets",
        hint: "Set per-character dietary rules: what each character can eat and drink, preset profiles (Warforged, Herbivore, etc.), and custom overrides.",
        icon: "fas fa-utensils",
        type: DietConfigApp,
        restricted: true
    });

    // ── Gameplay Settings ────────────────────────────────────────────

    game.settings.register(MODULE_ID, "interceptRests", {
        name: "Intercept Player Rests",
        hint: "Block the default Short/Long Rest buttons for players. Rests must go through the GM-managed Respite flow.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "armorDoffRule", {
        name: "Armor Sleep Penalties",
        hint: "Characters sleeping in medium or heavy armor recover fewer Hit Dice and cannot reduce exhaustion (Xanathar's). Characters on watch are exempt.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "spellRecoveryMaxLevel", {
        name: "Spell Recovery Max Level",
        hint: "Maximum spell slot level recoverable via Arcane Recovery and Natural Recovery. The default matches the 2014 rules cap of 5. Increase for homebrew.",
        scope: "world",
        config: true,
        type: Number,
        default: 5,
        range: { min: 1, max: 9, step: 1 },
    });

    game.settings.register(MODULE_ID, "songOfRestTiming", {
        name: "Song of Rest Timing",
        hint: "End of rest: bonus die is rolled for each qualifying character when the GM completes the short rest (strict table timing). With first Hit Die: each character's bonus is rolled and applied as soon as they spend their first Hit Die this rest (clearer at the table, still once per character per rest).",
        scope: "world",
        config: true,
        type: String,
        default: "endOfRest",
        choices: {
            endOfRest: "End of short rest (strict timing)",
            withFirstHitDie: "With first Hit Die (per character, immediate)",
        },
        restricted: true,
    });

    game.settings.register(MODULE_ID, "enableStudy", {
        name: "Study Activity",
        hint: "Enables the Study workbench activity (check and follow-up UI). Off by default. When on, requires Arcana or Investigation proficiency.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableTraining", {
        name: "Training Activity",
        hint: "Allow the Training activity during long rests. Characters level 5 and below can train to earn XP.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "trackFood", {
        name: "Track Food & Water",
        hint: "Show the Meal phase during long rests. Characters consume rations and water, with advisories for starvation and dehydration.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "partialSustenance", {
        name: "Partial Sustenance (House Rule)",
        hint: "In terrains requiring double rations or water, partial fulfilment grants a benefit: +2 to CON save (water) or extended grace period (food). Disable for strict RAW.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    // ── Hidden/Internal Settings ─────────────────────────────────────

    game.settings.register(MODULE_ID, "campfireTokenName", {
        name: "Campfire Token Name",
        hint: "Name of the token on the scene to link with the campfire. When the campfire is lit, the token's light turns on. Case-insensitive.",
        scope: "world",
        config: false,
        type: String,
        default: "Campfire",
        restricted: true
    });

    game.settings.register(MODULE_ID, "torchTokenName", {
        name: "Perimeter Torch Token Name",
        hint: "Name of the tokens on the scene used as perimeter torches. All matching tokens toggle together. Case-insensitive.",
        scope: "world",
        config: false,
        type: String,
        default: "Perimeter Torch",
        restricted: true
    });

    game.settings.register(MODULE_ID, "torchAutoLink", {
        name: "Auto-Link Torches to Campfire",
        hint: "When enabled, perimeter torches automatically light and extinguish with the campfire.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "customFoodNames", {
        name: "Custom Food Items",
        hint: "Comma-separated list of additional item names to recognise as food in the meal phase. Case-insensitive. Example: scrap metal, goodberries, dried fish",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    game.settings.register(MODULE_ID, "customWaterNames", {
        name: "Custom Water Items",
        hint: "Comma-separated list of additional item names to recognise as water in the meal phase. Case-insensitive. Example: oil, wine, ale, milk",
        scope: "world",
        config: false,
        type: String,
        default: "",
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableMonsterCooking", {
        name: "Monster Cooking",
        hint: "After combat with notable creatures, characters carrying the Dungeon Gourmand's Handbook can butcher carcasses for exotic cooking ingredients. Requires a content pack with monster recipes and a butcher registry.",
        scope: "world",
        config: MONSTER_COOKING_FEATURE_LIVE,
        type: Boolean,
        default: false,
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

    // PF2e early-support advisory (one-time)
    game.settings.register(MODULE_ID, "pf2eAdvisoryShown", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    // ── Footer (Discord + Wiki via ionrift-library) ──────────────────
    const SettingsLayout = game.ionrift?.library?.SettingsLayout;
    SettingsLayout?.registerFooter(MODULE_ID);

    // ── Ambient AFK HUD ──────────────────────────────────────────────
    game.settings.register(MODULE_ID, "ambientAfkHud", {
        name: "Ambient AFK HUD",
        hint: "Keeps the party AFK strip on screen when not at camp or in a rest flow. Toggle off to show it only during long or short rest.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: onAmbientAfkChange
    });

    // ── Client: AFK HUD position ─────────────────────────────────────
    game.settings.register(MODULE_ID, "afkPanelLayout", {
        name: "AFK panel layout",
        scope: "client",
        config: false,
        type: Object,
        default: { locked: true, left: 12, top: 120 }
    });

    // ── Debug Mode (renders last) ────────────────────────────────────
    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for rest flow.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    // ── Reset Rest Date (lightweight cooldown clear) ─────────────────
    game.settings.registerMenu(MODULE_ID, "resetRestDate", {
        name: "Reset Daily Rest Cooldown",
        label: "Reset Rest Date",
        hint: "Clears the 'already rested today' flag so the party can rest again on the same in-game day.",
        icon: "fas fa-calendar-minus",
        type: class ResetRestDateApp extends FormApplication {
            async _updateObject() {
                await game.settings.set(MODULE_ID, "lastRestDate", "");
                ui.notifications.info("Daily rest cooldown cleared.");
            }
            async render() {
                const proceed = await Dialog.confirm({
                    title: "Reset Daily Rest Cooldown",
                    content: "<p>This clears the 'already rested today' flag. The party will be able to start a new rest on the current in-game day.</p><p>No rest data is lost and no reload is needed.</p>",
                    yes: () => true,
                    no: () => false,
                    defaultYes: true
                });
                if (proceed) await this._updateObject();
            }
        },
        restricted: true
    });

    // ── Clear Rest State Menu (GM escape hatch) ──────────────────────
    game.settings.registerMenu(MODULE_ID, "clearRestState", {
        name: "Reset Rest State",
        label: "Reset Rest State",
        hint: "Clears rest state, flow locks, active rest data, and the daily rest cooldown. Also removes Respite camp tokens and Camp Prop torches on the active scene. Use when resting will not start or a rest did not clean up.",
        icon: "fas fa-broom",
        type: class ClearRestStateApp extends FormApplication {
            async _updateObject() {
                await game.ionrift.respite.resetFlowState();
            }
            async render() {
                const proceed = await Dialog.confirm({
                    title: "Reset Rest State",
                    content: "<p>This will discard any in-progress rest, clear the daily rest cooldown, remove Respite camp and perimeter torch tokens on the <strong>active scene</strong>, and reload all connected clients.</p><p>Only use this if resting is stuck or blocked.</p>",
                    yes: () => true,
                    no: () => false,
                    defaultYes: false
                });
                if (proceed) await this._updateObject();
            }
        },
        restricted: true
    });
}

/**
 * Registers Respite-specific item enrichments with the shared library engine.
 * Called during init, after the library is available.
 */
export function registerItemEnrichments() {
    game.ionrift?.library?.enrichment?.registerBatch({
        // ── Bedroll ────────────────────────────────────────────────────
        "bedroll": {
            html: `<hr><p><strong>Respite:</strong> A character carrying a bedroll recovers <strong>+1 Hit Die</strong> during a long rest, regardless of camp comfort level. This bonus stacks with normal HD recovery.</p>`,
            tags: ["+1 HD Recovery"]
        },

        // ── Tents ──────────────────────────────────────────────────────
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

        // ── Mess Kit ───────────────────────────────────────────────────
        "mess kit": {
            html: `<hr><p><strong>Respite:</strong> A character carrying a mess kit gains <strong>advantage on the exhaustion save</strong> during rest, but only when the campfire is lit. Without a fire, the mess kit provides no mechanical benefit. Functions identically to Cook's Utensils for this purpose.</p>`,
            tags: ["Exhaustion Advantage (with fire)"]
        },

        // ── Cook's Utensils ────────────────────────────────────────────
        "cook's utensils": {
            html: `<hr><p><strong>Respite:</strong> A character carrying Cook's Utensils gains <strong>advantage on the exhaustion save</strong> during rest when the campfire is lit. Also qualifies for the <strong>Cooking</strong> crafting profession, allowing the character to prepare meals that grant temporary buffs.</p>`,
            tags: ["Exhaustion Advantage (with fire)", "Cooking Profession"]
        },

        // ── Rations ────────────────────────────────────────────────────
        "rations": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 ration per day (some terrains require 2). Characters who go without food risk exhaustion after their grace period expires. Rations are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)"]
        },
        "rations (1 day)": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 ration per day (some terrains require 2). Characters who go without food risk exhaustion after their grace period expires. Rations are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)"]
        },

        // ── Waterskin ──────────────────────────────────────────────────
        "waterskin": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 waterskin per day (desert and arid terrains require 2). Dehydration is tracked separately from hunger and triggers a CON save. Waterskins are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)", "Dehydration Tracking"]
        },

        // ── Herbalism Kit ──────────────────────────────────────────────
        "herbalism kit": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Herbalism</strong> crafting profession during rest. Characters proficient with this kit can gather and prepare herbal remedies, antidotes, and poultices during the Activity phase.</p>`,
            tags: ["Herbalism Profession"]
        },

        // ── Healer's Kit ───────────────────────────────────────────────
        "healer's kit": {
            html: `<hr><p><strong>Respite:</strong> Used during the <strong>Tend Wounds</strong> activity. Grants advantage on the Medicine check and adds 1d4 to the healing roll (1 charge spent). Characters with the <strong>Healer</strong> feat use the feat formula (1d6 + 4 + target level) instead.</p>`,
            tags: ["Tend Wounds Activity"]
        },

        // ── Alchemist's Supplies ───────────────────────────────────────
        "alchemist's supplies": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Alchemy</strong> crafting profession during rest. Characters proficient with these supplies can brew potions and concoctions during the Activity phase.</p>`,
            tags: ["Alchemy Profession"]
        },

        // ── Tinker's Tools ─────────────────────────────────────────────
        "tinker's tools": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Tinkering</strong> crafting profession during rest. Characters proficient with these tools can repair gear or craft small mechanical devices during the Activity phase.</p>`,
            tags: ["Tinkering Profession"]
        },

        // ── Dungeon Gourmand's Handbook ──────────────────────────────
        "dungeon gourmand's handbook": {
            html: `<hr><p><strong>Respite:</strong> After combat with notable creatures (<strong>CR 2+</strong>), characters carrying this book are offered the chance to <strong>butcher the carcass</strong> for exotic cooking ingredients. The quality of the yield depends on a Survival check. The resulting ingredients unlock special <strong>monster recipes</strong> during the next rest.</p>`,
            tags: ["Monster Cooking", "Butchering"]
        },

        // ── Tinderbox ─────────────────────────────────────────────────
        "tinderbox": {
            html: `<hr><p><strong>Respite:</strong> Required to <strong>light the campfire</strong> during the Camp phase. Without a tinderbox (or equivalent), the party cannot start a fire, losing access to cooking, warmth bonuses, and campfire-dependent activities. One tinderbox serves the whole party.</p>`,
            tags: ["Campfire (required)"]
        },

        // ── Perishable Foods ──────────────────────────────────────────
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
    "interceptRests",
    "armorDoffRule",
    "spellRecoveryMaxLevel",
    "songOfRestTiming",
    "enableStudy",
    "enableTraining",
    "trackFood",
    "partialSustenance",
    "campfireTokenName",
    "torchTokenName",
    "torchAutoLink",
    "customFoodNames",
    "customWaterNames",
    "enableMonsterCooking",
    "restRecoveryDetected",
    "lastRestDate",
    "lastTerrain",
    "activeRest",
    "activeShortRest",
    "enabledPacks",
    "importedPacks",
    "artPackDisabled",
    "artPackCache",
    "pf2eAdvisoryShown",
    "ambientAfkHud",
    "afkPanelLayout",
    "debug"
];

/**
 * All menu keys registered by this module.
 */
export const MENU_KEYS = [
    "partyRosterMenu",
    "dietConfigMenu",
    "resetRestDate",
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
    "dungeon gourmand's handbook",
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
