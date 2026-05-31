/**
 * @module SettingsRegistrar
 * @description Registers all module settings, menus, and item enrichments for ionrift-respite.
 * Extracted from module.js to reduce monolith size (Phase 2.1).
 *
 * Call {@link registerAllSettings} from the `Hooks.once("init", ...)` block.
 */


import { EventBrowserApp } from "../apps/EventBrowserApp.js";
import { ActivityConfigApp } from "../apps/ActivityConfigApp.js";
import { RecoveryConfigApp } from "../apps/RecoveryConfigApp.js";
import { isComfortEnabled } from "./ComfortCalculator.js";
import { PlayerRestrictionsApp } from "../apps/PlayerRestrictionsApp.js";

const MODULE_ID = "ionrift-respite";

/**
 * Registers all module settings, menus, and item enrichment entries.
 * Must be called during the init hook, after `game.ionrift.respite` is constructed.
 *
 * @param {object} opts
 * @param {typeof import("../apps/PackRegistryApp.js").PackRegistryApp} opts.PackRegistryApp
 * @param {typeof import("../apps/DietConfigApp.js").DietConfigApp} opts.DietConfigApp
 * @param {function} opts.onAmbientAfkChange - Callback when ambientAfkHud setting changes.
 */
export function registerAllSettings({ PackRegistryApp, DietConfigApp, onAmbientAfkChange }) {

    // ── Event Pool curation (per-event opt-in roll pool) ──
    game.settings.registerMenu(MODULE_ID, "eventBrowser", {
        name: "Event Pool",
        label: "Curate Event Pool",
        hint: "Browse camp events and choose which ones can occur when you roll the night check.",
        icon: "fas fa-book-open",
        type: EventBrowserApp,
        restricted: true
    });

    // Legacy pack manager: only when Patreon Library does not own overlay delivery.
    const overlayPackUi = game.ionrift?.library?.isOverlayDistributionActive?.();
    if (!overlayPackUi) {
        const SettingsLayoutForPack = game.ionrift?.library?.SettingsLayout;
        SettingsLayoutForPack?.registerPackButton(MODULE_ID, PackRegistryApp, {
            hint: "Enable or disable event content packs. Shows event counts per terrain."
        });
    }

    // ── Party Roster (migration-only) ────────────────────────────────
    // Menu removed: roster UI now lives in ionrift-library (game.ionrift.library.party).
    // Setting kept so the library migration hook can seed from existing Respite data.
    game.settings.register(MODULE_ID, "partyRoster", {
        scope: "world",
        config: false,
        type: Array,
        default: []
    });

    // ── Menu: Food & Diet (meal tracking + per-character diets) ──────
    game.settings.registerMenu(MODULE_ID, "dietConfigMenu", {
        name: "Food & Diet",
        label: "Configure Food & Diet",
        hint: "Turn meal tracking on or off, set the partial-sustenance house rule, and set per-character dietary rules (what each character can eat and drink, preset profiles, and custom overrides).",
        icon: "fas fa-utensils",
        type: DietConfigApp,
        restricted: true
    });

    // ── Rest Activities submenu ──────────────────────────────────────
    game.settings.registerMenu(MODULE_ID, "activityConfig", {
        name: "Rest Activities",
        label: "Configure Activities",
        hint: "Toggle crafting, fletching, and training activities on or off.",
        icon: "fas fa-campground",
        type: ActivityConfigApp,
        restricted: true
    });

    // ── Recovery Rules submenu ───────────────────────────────────────
    game.settings.registerMenu(MODULE_ID, "recoveryConfig", {
        name: "Recovery Rules",
        label: "Configure Recovery",
        hint: "Armor penalties, spell recovery, Song of Rest timing, and homebrew hit die rules.",
        icon: "fas fa-heart-pulse",
        type: RecoveryConfigApp,
        restricted: true
    });

    // ── Player Restrictions submenu ──────────────────────────────────
    game.settings.registerMenu(MODULE_ID, "playerRestrictions", {
        name: "Player Restrictions",
        label: "Configure Restrictions",
        hint: "Control rest interception, quantity locks, and attunement rules.",
        icon: "fas fa-user-lock",
        type: PlayerRestrictionsApp,
        restricted: true
    });

    // ── Gameplay Settings ────────────────────────────────────────────

    game.settings.register(MODULE_ID, "restInterfaceMode", {
        name: "Rest Interface Mode",
        hint: "Choose how the table engages with camp. One window runs the whole rest in a single panel, with players picking activities from a list. Camp stations drops the camp onto the scene in one click; players move their tokens to a piece to act there, which suits groups that prefer to stay in character.",
        scope: "world",
        config: true,
        type: String,
        default: "theater",
        choices: {
            theater: "One window (run camp as a single panel)",
            stations: "Camp stations (place pieces on the scene, move tokens)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "interceptRests", {
        name: "Intercept Player Rests",
        hint: "Block the default Short/Long Rest buttons for players. Rests must go through the GM-managed Respite flow.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "armorDoffRule", {
        name: "Armor Sleep Penalties",
        hint: "Characters sleeping in medium or heavy armor recover fewer Hit Dice and cannot reduce exhaustion (Xanathar's). Characters on watch are exempt.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableComfort", {
        name: "Comfort Rules (Homebrew)",
        hint: "Enable terrain comfort tiers, fire mechanics, and gear-driven recovery modifiers. Disable for simplified rests with no comfort penalties, no fire phase, and no exhaustion saves from terrain.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => registerItemEnrichments()
    });

    game.settings.register(MODULE_ID, "spellRecoveryMaxLevel", {
        name: "Spell Recovery Max Level",
        hint: "Maximum spell slot level recoverable via Arcane Recovery and Natural Recovery. The default matches the 2014 rules cap of 5. Increase for homebrew.",
        scope: "world",
        config: false,
        type: Number,
        default: 5,
        range: { min: 1, max: 9, step: 1 },
        restricted: true
    });

    game.settings.register(MODULE_ID, "songOfRestTiming", {
        name: "Song of Rest Timing",
        hint: "End of rest: bonus die is rolled for each qualifying character when the GM completes the short rest (strict table timing). With first Hit Die: each character's bonus is rolled and applied as soon as they spend their first Hit Die this rest (clearer at the table, still once per character per rest).",
        scope: "world",
        config: false,
        type: String,
        default: "endOfRest",
        choices: {
            endOfRest: "End of short rest (strict timing)",
            withFirstHitDie: "With first Hit Die (per character, immediate)",
        },
        restricted: true,
    });

    game.settings.register(MODULE_ID, "maxValueHitDice", {
        name: "Short Rest: Max Hit Dice (Homebrew)",
        hint: "During short rests only, each Hit Die heals for the die's maximum roll plus CON modifier (not a random roll). Native Hit Die spend and chat card still run; HP is corrected to match. Optional rule, not RAW.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true,
    });

    game.settings.register(MODULE_ID, "enableTraining", {
        name: "Training Activity",
        hint: "Allow the Training activity during long rests. Characters level 5 and below can train to earn XP.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableProfessions", {
        name: "Crafting Professions",
        hint: "Show cooking, brewing, tailoring, and crafting activities during rest. Disable for a simpler rest without profession crafting. Also auto-skips the travel phase when disabled.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableFletching", {
        name: "Fletching Activity",
        hint: "Show the Fletch Arrows activity during long rests. Available to all characters.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    // Surfaced in the Food & Diet dialog (DietConfigApp), not the native panel.
    game.settings.register(MODULE_ID, "trackFood", {
        name: "Track Food & Water",
        hint: "Show the Meal phase during long rests. Characters consume rations and water, with advisories for starvation and dehydration.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "partialSustenance", {
        name: "Partial Sustenance (House Rule)",
        hint: "In terrains requiring double rations or water, partial fulfilment grants a benefit: +2 to CON save (water) or extended grace period (food). Disable for strict RAW.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "lockPlayerQuantity", {
        name: "Lock Player Quantity Controls",
        hint: "Prevents players from adjusting item quantities on their character sheet. The GM can still modify quantities. Useful when tracking rations and consumables through the Respite rest flow.",
        scope: "world",
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "lockAttuneOutsideRest", {
        name: "Lock Attunement to Rest",
        hint: "Players can only attune or de-attune items during an active rest (long or short). Outside of rest, the attunement toggle is disabled. RAW: attunement requires a short rest.",
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    // ── Hidden/Internal Settings ─────────────────────────────────────

    /** Remembered from Rest Setup: long rest uses safe rest spot (no encounter risk). */
    game.settings.register(MODULE_ID, "safeRestSpot", {
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

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
        onChange: onAmbientAfkChange,
        restricted: true
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
        config: false,
        type: Boolean,
        default: false,
        restricted: true
    });

    // ── Reset Rest State (GM escape hatch) ───────────────────────────
    game.settings.registerMenu(MODULE_ID, "clearRestState", {
        name: "Reset Rest State",
        label: "Reset Rest State",
        hint: "Clears rest locks so the party can rest again, including the same in-game day. Removes camp tokens on the active scene and reloads all clients.",
        icon: "fas fa-broom",
        type: class ClearRestStateApp extends FormApplication {
            async _updateObject() {
                await game.ionrift.respite.resetFlowState();
            }
            async render() {
                const proceed = await Dialog.confirm({
                    title: "Reset Rest State",
                    content: "<p>Rest locks and any in-progress rest will be cleared. Camp tokens on the active scene are removed and all clients reload.</p><p>Use when rest will not start, the party needs to rest again today, or a rest did not finish cleanly.</p>",
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
    const comfortOn = isComfortEnabled();
    game.ionrift?.library?.enrichment?.registerBatch({
        // ── Bedroll ────────────────────────────────────────────────────
        "bedroll": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> A character carrying a bedroll recovers <strong>+1 Hit Die</strong> during a long rest, regardless of camp comfort level. This bonus stacks with normal HD recovery.</p>`
                : `<hr><p><strong>Respite:</strong> Bedroll tracked for rest flavour. <em>Comfort rules disabled — no HD bonus applied.</em></p>`,
            tags: comfortOn ? ["+1 HD Recovery"] : ["Comfort Off"]
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
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> A character carrying a mess kit gains <strong>advantage on the exhaustion save</strong> during rest, but only when the campfire is lit. Without a fire, the mess kit provides no mechanical benefit. Functions identically to Cook's Utensils for this purpose.</p>`
                : `<hr><p><strong>Respite:</strong> Mess kit tracked for rest flavour. <em>Comfort rules disabled — no exhaustion advantage applied.</em></p>`,
            tags: comfortOn ? ["Exhaustion Advantage (with fire)"] : ["Comfort Off"]
        },

        // ── Cook's Utensils ────────────────────────────────────────────
        "cook's utensils": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> A character carrying Cook's Utensils gains <strong>advantage on the exhaustion save</strong> during rest when the campfire is lit. Also qualifies for the <strong>Cooking</strong> crafting profession, allowing the character to prepare meals that grant temporary buffs.</p>`
                : `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Cooking</strong> crafting profession during rest. <em>Comfort rules disabled — no exhaustion advantage applied.</em></p>`,
            tags: comfortOn ? ["Exhaustion Advantage (with fire)", "Cooking Profession"] : ["Cooking Profession", "Comfort Off"]
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


        // ── Tinderbox ─────────────────────────────────────────────────
        "tinderbox": {
            html: comfortOn
                ? `<hr><p><strong>Respite:</strong> Required to <strong>light the campfire</strong> during the Camp phase. Without a tinderbox (or equivalent), the party cannot start a fire, losing access to cooking, warmth bonuses, and campfire-dependent activities. One tinderbox serves the whole party.</p>`
                : `<hr><p><strong>Respite:</strong> Tinderbox tracked for rest flavour. <em>Comfort rules disabled — fire phase is bypassed.</em></p>`,
            tags: comfortOn ? ["Campfire (required)"] : ["Comfort Off"]
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
    "restInterfaceMode",
    "interceptRests",
    "armorDoffRule",
    "enableComfort",
    "spellRecoveryMaxLevel",
    "songOfRestTiming",
    "maxValueHitDice",
    "enableTraining",
    "enableProfessions",
    "enableFletching",
    "trackFood",
    "partialSustenance",
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
