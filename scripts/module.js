import { RestFlowEngine } from "./services/RestFlowEngine.js";
import { ActivityResolver } from "./services/ActivityResolver.js";
import { EventResolver } from "./services/EventResolver.js";
import { ResourcePoolRoller } from "./services/ResourcePoolRoller.js";
import { ItemOutcomeHandler } from "./services/ItemOutcomeHandler.js";
import { CalendarHandler } from "./services/CalendarHandler.js";
import { TerrainRegistry } from "./services/TerrainRegistry.js";
import { RestSetupApp } from "./apps/RestSetupApp.js";
import { ActivityPickerApp } from "./apps/ActivityPickerApp.js";
import { CampfireApp } from "./apps/CampfireApp.js";
import { ShortRestApp } from "./apps/ShortRestApp.js";
import { CampfireTokenLinker } from "./services/CampfireTokenLinker.js";
import { TorchTokenLinker } from "./services/TorchTokenLinker.js";
import { placeTorch, placePerimeter, clearTorches, toggleTorches, placeCampfire, placeCamp } from "./services/CampPropPlacer.js";
import {
    placePlayerGear,
    placeStation,
    canPlaceStation,
    clearCampTokens,
    clearPlayerCampGear,
    clearPlayerCampGearType,
    clearSharedCampStation,
    resetCampSession,
    registerCampFurnitureZOrderGuards,
    clampCampFloorTokenInPreUpdate
} from "./services/CompoundCampPlacer.js";

import { createAdapter } from "./adapters/adapterFactory.js";
import { PackRegistryApp } from "./apps/PackRegistryApp.js";
import { PartyRosterApp } from "./apps/PartyRosterApp.js";
import { CopySpellHandler } from "./services/CopySpellHandler.js";
import { ImageResolver } from "./util/ImageResolver.js";
import { ItemClassifier } from "./services/ItemClassifier.js";
import { DietConfigApp } from "./apps/DietConfigApp.js";
import { ButcherResolver } from "./services/ButcherResolver.js";
import { AfkPanelApp } from "./apps/AfkPanelApp.js";
import * as RestAfkState from "./services/RestAfkState.js";
import { getPartyActors as getPartyActorsFromSetting } from "./services/partyActors.js";
import { MONSTER_COOKING_FEATURE_LIVE, isMonsterCookingUnlocked } from "./FeatureFlags.mjs";
import {
    setRestSessionAfkEmitter,
    setAfkUiRefresh,
    refreshAfterAfkChange
} from "./services/restSessionAfkEmit.js";
import { MealPhaseHandler } from "./services/MealPhaseHandler.js";
import {
    setDetectMagicInventoryGlowAdapter,
    getDetectMagicInventoryGlowAdapter,
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "./services/DetectMagicInventoryGlowBridge.js";

const MODULE_ID = "ionrift-respite";
const MODULE_LABEL = "Respite";

// Shared logger reference; falls back to console if ionrift-lib unavailable.
let Logger;

// Tracks whether a Respite rest flow is currently active.
// When true, the dnd5e.preRestCompleted hook will suppress default HP/HD recovery.
let respiteFlowActive = false;

// Active GM app reference, used by socket handler to push incoming choices.
let activeRestSetupApp = null;

// Cached rest data payload so late-joining players can retrieve it.
let activeRestData = null;

// Active campfire panel reference for socket routing.
let activeCampfireApp = null;

// Active short rest app reference for socket routing.
let activeShortRestApp = null;

/**
 * Registers the active CampfireApp so socket events route to it.
 */
export function registerCampfireApp(app) {
    activeCampfireApp = app;
}

/**
 * Clears the active CampfireApp reference.
 */
export function clearCampfireApp() {
    activeCampfireApp = null;
}

/**
 * Registers the active RestSetupApp so the socket handler can route to it.
 * Called by RestSetupApp on render.
 */
export function registerActiveRestApp(app) {
    activeRestSetupApp = app;
    respiteFlowActive = true;
}

/**
 * Stores the current rest data so late-joining players can retrieve it.
 */
export function setActiveRestData(data) {
    activeRestData = data;
}

/**
 * Clears the active RestSetupApp reference.
 * Called by RestSetupApp on close.
 */
export function clearActiveRestApp() {
    activeRestSetupApp = null;
    activeRestData = null;
    respiteFlowActive = false;
    _removeGmRestIndicator();
    hideAfkPanelAfterRest();
}

/**
 * Registers the active ShortRestApp so socket messages route to it.
 */
export function registerActiveShortRestApp(app) {
    activeShortRestApp = app;
    respiteFlowActive = true;
}

/**
 * Clears the active ShortRestApp reference.
 */
export function clearActiveShortRestApp() {
    activeShortRestApp = null;
    respiteFlowActive = false;
}

/**
 * Called by players to show a rejoin notification for an active short rest.
 */
export function notifyShortRestActive() {
    _showShortRestRejoinNotification();
}

/**
 * Returns the GM-approved party actors from the world setting.
 * Re-exported from partyActors.js (single source for AFK panel and module).
 * @returns {Actor[]} Array of approved party actors.
 */
export function getPartyActors() {
    return getPartyActorsFromSetting();
}

/** @type {AfkPanelApp|null} */
let activeAfkPanel = null;

/**
 * Shows the persistent AFK panel during an active rest (long or short).
 */
export function showAfkPanel() {
    if (activeAfkPanel?.rendered) {
        activeAfkPanel.render({ force: true });
        return;
    }
    activeAfkPanel = new AfkPanelApp();
    void activeAfkPanel.render({ force: true });
}

/**
 * Hides the AFK panel and clears shared AFK state.
 */
export function hideAfkPanel() {
    if (activeAfkPanel) {
        activeAfkPanel.close();
        activeAfkPanel = null;
    }
    RestAfkState.clear();
}

/**
 * Refreshes the AFK panel after socket updates (no-op if not shown).
 */
export function refreshAfkPanel() {
    if (activeAfkPanel?.rendered) {
        activeAfkPanel.render({ force: true });
    }
}

/**
 * Emits AFK sync using the correct socket type for the active rest (long vs short).
 * @param {string} characterId
 * @param {boolean} isAfk
 */
export function emitAfkSocket(characterId, isAfk) {
    const longRest = !!(activeRestSetupApp ?? activePlayerRestApp);
    const shortOnly = !!activeShortRestApp && !longRest;
    const type = shortOnly ? "shortRestAfkUpdate" : "afkUpdate";
    game.socket.emit(`module.${MODULE_ID}`, { type, characterId, isAfk });
}

/**
 * @returns {boolean}
 */
function _ambientAfkHudWorldEnabled() {
    try {
        return !!game.settings.get(MODULE_ID, "ambientAfkHud");
    } catch {
        return false;
    }
}

/** After a rest ends: clear AFK state and panel, then show ambient HUD if the world allows it. */
export function hideAfkPanelAfterRest() {
    hideAfkPanel();
    if (_ambientAfkHudWorldEnabled()) void showAfkPanel();
}

function _maybeShowAmbientAfkPanelAtReady() {
    if (!_ambientAfkHudWorldEnabled()) return;
    if (respiteFlowActive) return;
    void showAfkPanel();
}

/**
 * Checks whether a new rest can be started.
 * Guards against: active flow already open, and Simple Calendar 1-rest-per-day.
 * @returns {boolean} true if a rest can start, false if blocked.
 */
function _canStartRest() {
    if (respiteFlowActive) {
        ui.notifications.warn("A rest is already in progress.");
        return false;
    }

    // Belt-and-suspenders: check world settings in case respiteFlowActive lost sync
    try {
        const savedLong = game.settings.get(MODULE_ID, "activeRest");
        const savedShort = game.settings.get(MODULE_ID, "activeShortRest");
        if (savedLong?.engine || savedShort?.timestamp) {
            ui.notifications.warn("A rest is already in progress. Clear it from module settings if stuck.");
            return false;
        }
    } catch { /* settings not registered yet */ }

    // Calendar: 1 long rest per in-game day
    if (CalendarHandler.hasRestedToday()) {
        ui.notifications.warn("The party has already rested today. Advance the calendar to rest again.");
        return false;
    }

    return true;
}


Hooks.once("init", async () => {
    console.log(`${MODULE_ID} | Initializing...`);
    Logger = game.ionrift?.library?.Logger ?? console;
    Logger.log?.(MODULE_LABEL, "Initializing...");

    // Register Handlebars helpers
    Handlebars.registerHelper("gte", (a, b) => a >= b);
    Handlebars.registerHelper("eq", (a, b) => a === b);
    Handlebars.registerHelper("join", (arr, sep) => Array.isArray(arr) ? arr.join(sep) : "");
    Handlebars.registerHelper("upper", (str) => typeof str === "string" ? str.toUpperCase() : str);
    Handlebars.registerHelper("humanDuration", (d) => {
        const map = { next_rest: "until next rest", end_of_rest: "end of rest", "1_hour": "1 hour", "8_hours": "8 hours", permanent: "permanent" };
        return typeof d === "string" ? (map[d] ?? d.replace(/_/g, " ")) : d;
    });

    // Register partials
    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/roster-strip.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/roster-strip.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("rosterStrip", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load roster-strip partial:`, e));

    // Expose API
    const adapter = createAdapter();
    game.ionrift = game.ionrift || {};
    game.ionrift.respite = {
        adapter,
        RestFlowEngine,
        ActivityResolver,
        EventResolver,
        ResourcePoolRoller,
        openRestSetup: () => {
            if (!game.user.isGM) return;
            new RestSetupApp().render({ force: true });
        },
        /** Debug: force the next event roll to always trigger an encounter. */
        forceEncounter: () => {
            if (!game.user.isGM) return;
            if (!activeRestSetupApp) {
                console.warn(`${MODULE_ID} | No active rest. Start a rest first.`);
                return;
            }
            activeRestSetupApp._forceEncounter = true;
            ui.notifications.info("Next event roll will force an encounter.");
        },
        /** Debug: get the active RestSetupApp instance. */
        getActiveApp: () => activeRestSetupApp,
        /** Run regression test suite. GM only. Requires local test files (not shipped). */
        runTests: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | Tests are GM-only.`); return; }
            try {
                const probe = await fetch(`modules/${MODULE_ID}/scripts/tests/RespiteTestRunner.js`, { method: "HEAD" });
                if (!probe.ok) { console.warn(`${MODULE_ID} | Test suite not found. Tests are dev-only and not included in release builds.`); return; }
                const { RespiteTestRunner } = await import("./tests/RespiteTestRunner.js");
                const runner = new RespiteTestRunner();
                return await runner.runAll();
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load test suite:`, e.message);
            }
        },
        /** Run short rest feature parity E2E tests only. GM only. Dev builds only. */
        runShortRestE2E: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | Tests are GM-only.`); return; }
            try {
                const probe = await fetch(`modules/${MODULE_ID}/scripts/tests/RespiteTestRunner.js`, { method: "HEAD" });
                if (!probe.ok) { console.warn(`${MODULE_ID} | Test suite not found (dev-only, not in releases).`); return; }
                const { RespiteTestRunner } = await import("./tests/RespiteTestRunner.js");
                const runner = new RespiteTestRunner();
                return await runner.runShortRestE2E();
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load test suite:`, e.message);
            }
        },
        /** Run short rest state persistence tests only. GM only. Dev builds only. */
        runShortRestPersistenceTests: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | Tests are GM-only.`); return; }
            try {
                const probe = await fetch(`modules/${MODULE_ID}/scripts/tests/RespiteTestRunner.js`, { method: "HEAD" });
                if (!probe.ok) { console.warn(`${MODULE_ID} | Test suite not found (dev-only, not in releases).`); return; }
                const { RespiteTestRunner } = await import("./tests/RespiteTestRunner.js");
                const runner = new RespiteTestRunner();
                return await runner.runShortRestPersistence();
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load test suite:`, e.message);
            }
        },
        /** Reload all connected clients, then reload the GM. */
        reloadAll: () => {
            if (!game.user.isGM) return;
            game.socket.emit(`module.${MODULE_ID}`, { type: "forceReload" });
            console.log(`${MODULE_ID} | Sent forceReload to all clients. GM reloading in 500ms...`);
            setTimeout(() => window.location.reload(), 500);
        },
        /** Debug: Add supplies to all party actors. Usage: game.ionrift.respite.addSupplies(50) */
        addSupplies: (qty = 50) => RestSetupApp._debugAddSupplies(qty),
        /**
         * Plug in a module that replaces the built-in school-colored inventory glow after Detect Magic.
         * Pass null to restore the default sheet highlights. See scripts/services/DetectMagicInventoryGlowBridge.js.
         */
        setDetectMagicInventoryGlowAdapter,
        getDetectMagicInventoryGlowAdapter,
        /** Check which terrain packs are currently linked (accessible). */
        packStatus: async () => {
            if (!game.user.isGM) return;
            await TerrainRegistry.init();
            const coreTerrains = new Set(["forest", "swamp", "desert", "urban", "dungeon", "tavern"]);
            const results = {};
            for (const t of TerrainRegistry.getAvailableIds()) {
                if (coreTerrains.has(t)) continue; // Core terrains are always present
                try {
                    const resp = await fetch(`modules/${MODULE_ID}/data/terrains/${t}/events.json?t=${Date.now()}`);
                    results[t] = resp.ok ? "LINKED" : "MISSING";
                } catch { results[t] = "MISSING"; }
            }
            console.table(results);
            return results;
        },
        /** Write LINK_PACKS to cmd.txt for the DevTools CommandListener. */
        linkPacks: async () => {
            if (!game.user.isGM) return;
            const file = new File(["LINK_PACKS"], "cmd.txt", { type: "text/plain" });
            const FP = foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
            await FP.upload("data", "ionrift_debug", file, { notify: false });
            ui.notifications.info("LINK_PACKS command sent. Waiting for DevTools to execute...");
        },
        /** Write UNLINK_PACKS to cmd.txt for the DevTools CommandListener. */
        unlinkPacks: async () => {
            if (!game.user.isGM) return;
            const file = new File(["UNLINK_PACKS"], "cmd.txt", { type: "text/plain" });
            const FP = foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
            await FP.upload("data", "ionrift_debug", file, { notify: false });
            ui.notifications.info("UNLINK_PACKS command sent. Waiting for DevTools to execute...");
        },
        /** GM escape hatch: clears stale rest state, removes camp tokens on the scene, reloads. Usage: game.ionrift.respite.resetFlowState() */
        resetFlowState: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | resetFlowState is GM-only.`); return; }
            respiteFlowActive = false;
            activeRestSetupApp = null;
            activeRestData = null;
            activeShortRestApp = null;
            hideAfkPanel();
            try {
                const removed = await clearCampTokens();
                if (removed > 0) {
                    console.log(`${MODULE_ID} | resetFlowState removed ${removed} camp or torch token(s) from the active scene.`);
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | resetFlowState camp cleanup failed:`, e);
            } finally {
                resetCampSession();
            }
            await game.settings.set(MODULE_ID, "activeRest", {});
            await game.settings.set(MODULE_ID, "activeShortRest", {});
            await game.settings.set(MODULE_ID, "lastRestDate", "");
            game.socket.emit(`module.${MODULE_ID}`, { type: "forceReload" });
            ui.notifications.info("Rest state cleared. Reloading...");
            setTimeout(() => window.location.reload(), 500);
        },
        /** Item Enrichment: delegates to ionrift-library kernel (backward compat). */
        getItemEnrichment: (itemName) => game.ionrift?.library?.enrichment?.get(itemName) ?? null,
        /** Item Enrichment: returns all registered enrichment names (debug). */
        getEnrichmentNames: () => game.ionrift?.library?.enrichment?.getRegisteredNames() ?? [],
        /** Item classification: unified food/water/fuel classification. */
        ItemClassifier,
        /** Monster butchering: graduated outcome resolution. */
        ButcherResolver,
        /** Diet configuration UI. Usage: game.ionrift.respite.openDietConfig() or game.ionrift.respite.openDietConfig(actorId) */
        DietConfigApp,
        openDietConfig: (actorId) => {
            if (!game.user.isGM) return;
            new DietConfigApp(actorId ? { actorId } : {}).render({ force: true });
        },
        /** Classify a single item. Usage: game.ionrift.respite.classifyItem(item) */
        classifyItem: (item) => ItemClassifier.classify(item),
        /** Get an actor's diet profile. Usage: game.ionrift.respite.getDiet(actor) */
        getDiet: (actor) => ItemClassifier.getDiet(actor),
        /** Set an actor's diet profile. Usage: game.ionrift.respite.setDiet(actor, { label: "Custom", canEat: ["food", "fuel"] }) */
        setDiet: (actor, diet) => ItemClassifier.setDiet(actor, diet),
        /** Apply a preset diet. Usage: game.ionrift.respite.applyDietPreset(actor, "warforged") */
        applyDietPreset: (actor, presetId) => ItemClassifier.applyPreset(actor, presetId),
        /** List available diet presets. Usage: game.ionrift.respite.getDietPresets() */
        getDietPresets: () => ItemClassifier.getPresets(),

        // ── Camp Prop Placement ──────────────────────────────────────
        /** Place a campfire (base + fire overlay) via crosshair. GM only. */
        placeCampfire,
        /** Place a single torch pair (stake + fire overlay) via crosshair. GM only. */
        placeTorch,
        /** Place a ring of torch pairs around the selected token or a clicked point. GM only. */
        placePerimeter,
        /** Place a full camp: campfire + perimeter ring, one click. GM only. */
        placeCamp,
        /** Remove all torch tokens (stakes + fire overlays) from the scene. GM only. */
        clearTorches,
        /** Toggle all perimeter torch lights on/off. GM only. */
        toggleTorches,
        /** TorchTokenLinker service reference. */
        TorchTokenLinker
    };

    // Register settings

    // HEADER: Content Packs button (via kernel)
    const SettingsLayoutForPack = game.ionrift?.library?.SettingsLayout;
    SettingsLayoutForPack?.registerPackButton(MODULE_ID, PackRegistryApp, {
        hint: "Enable or disable event content packs. Shows event counts per terrain."
    });

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

    game.settings.registerMenu(MODULE_ID, "dietConfigMenu", {
        name: "Diet Profiles",
        label: "Configure Diets",
        hint: "Set per-character dietary rules: what each character can eat and drink, preset profiles (Warforged, Herbivore, etc.), and custom overrides.",
        icon: "fas fa-utensils",
        type: DietConfigApp,
        restricted: true
    });

    // BODY: Gameplay settings
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
        hint: "End of rest: bonus die is rolled for each qualifying character when the GM completes the short rest (strict table timing). With first Hit Die: each character’s bonus is rolled and applied as soon as they spend their first Hit Die this rest (clearer at the table, still once per character per rest).",
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

    // FOOTER: Discord + Wiki (standardised via ionrift-library)
    // Use the published library API — direct cross-repo path breaks on CI (single-repo checkout).
    const SettingsLayout = game.ionrift?.library?.SettingsLayout;
    SettingsLayout?.registerFooter(MODULE_ID);

    // World: show AFK HUD outside camp / rest (party roster still from party setting)
    game.settings.register(MODULE_ID, "ambientAfkHud", {
        name: "Ambient AFK HUD",
        hint: "Keeps the party AFK strip on screen when not at camp or in a rest flow. Toggle off to show it only during long or short rest.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: (value) => {
            if (value) void showAfkPanel();
            else if (!respiteFlowActive) hideAfkPanel();
        }
    });

    // Client: AFK HUD position (dock vs free-drag)
    game.settings.register(MODULE_ID, "afkPanelLayout", {
        name: "AFK panel layout",
        scope: "client",
        config: false,
        type: Object,
        default: { locked: true, left: 12, top: 120 }
    });

    // Debug (registers last so it renders at the bottom)
    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for rest flow.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    // Clear Rest State: GM escape hatch for stuck rests (renders below debug)
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

    // Register Respite-specific item enrichments with the shared library engine.
    // The library (ItemEnrichmentEngine) owns the hook wiring and injection logic.
    // Other modules can add their own entries via game.ionrift.library.enrichment.register().
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
});


// Scene Controls: Campfire button in the token controls group
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    // Foundry v13+: controls is an object with named groups (controls.tokens)
    // Foundry v12:  controls is an array, use .find()
    const tokenGroup = Array.isArray(controls)
        ? controls.find(c => c.name === "token")
        : controls.tokens;
    if (!tokenGroup) return;

    const toolDef = {
        name: "respite",
        title: "Rest Phase",
        icon: "fas fa-campground",
        button: true,
        onClick: () => {
            if (!_canStartRest()) return;
            new RestSetupApp().render({ force: true });
        }
    };

    // v13 uses an object map for tools, v12 uses an array
    if (Array.isArray(tokenGroup.tools)) {
        tokenGroup.tools.push(toolDef);
    } else {
        tokenGroup.tools[toolDef.name] = toolDef;
    }
});

// Chat command: /respite
Hooks.on("chatMessage", (log, message, chatData) => {
    if (!game.user.isGM) return;
    if (message.trim().toLowerCase() === "/respite") {
        if (!_canStartRest()) return false;
        new RestSetupApp().render({ force: true });
        return false;
    }
});

// ── Diet Config: Actor Sheet Button ──────────────────────────
// Injects a small "Diet" icon button into character sheet headers so GMs can
// open DietConfigApp scoped to that actor without hunting through module settings.
function _injectDietButton(app, html) {
    if (!game.user.isGM) return;
    const actor = app.actor ?? app.document;
    if (!actor || actor.type !== "character") return;

    // Normalise html to a DOM element (jQuery or raw)
    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    // Avoid duplicate injection
    if (el.querySelector(".respite-diet-btn")) return;

    // ApplicationV2: header is inside the app element
    // ApplicationV1: header is .window-header inside the passed html
    const header = el.querySelector("header.window-header")
        ?? el.closest?.(".app")?.querySelector("header.window-header")
        ?? el.querySelector(".window-header");
    if (!header) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "header-control-button respite-diet-btn";
    btn.dataset.tooltip = "Diet Configuration";
    btn.setAttribute("aria-label", "Diet Configuration");
    btn.innerHTML = `<i class="fas fa-utensils"></i>`;
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        new DietConfigApp({ actorId: actor.id }).render({ force: true });
    });

    // Insert before the close button if present, otherwise append to header
    const closeBtn = header.querySelector("button.close, button[data-action='close']");
    if (closeBtn) {
        closeBtn.before(btn);
    } else {
        header.appendChild(btn);
    }
}

// Register on all possible actor sheet hook names (v1 + ApplicationV2 + dnd5e specific)
for (const hookName of [
    "renderActorSheet",
    "renderActorSheetV2",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter"
]) {
    Hooks.on(hookName, (app, html, context) => _injectDietButton(app, html));
}

// ── Spoilage Badge: Inventory Item Freshness Indicator ───────
// Scans visible inventory item rows on character sheets and injects a small
// badge showing days remaining before spoilage. Uses ItemClassifier.getSpoilsAfter()
// to recognise perishable items by flag OR by name/food-tag inference.
// Only shows on active party roster members.
function _injectSpoilageBadges(app, html) {
    const actor = app.actor ?? app.document;
    if (!actor || actor.type !== "character") return;

    // Only badge party roster members
    try {
        const roster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
        if (roster.length && !roster.includes(actor.id)) return;
    } catch { /* setting not yet registered */ }

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    const now = CalendarHandler.getCurrentDate();
    const nowEpoch = game.time.worldTime;

    // Find all item list entries (dnd5e v4 uses [data-item-id])
    const itemRows = el.querySelectorAll("[data-item-id]");
    for (const row of itemRows) {
        const itemId = row.dataset.itemId;
        if (!itemId) continue;

        const item = actor.items.get(itemId);
        if (!item) continue;

        // Use ItemClassifier to detect spoilage (flag or inferred from food tag)
        const flags = item.flags?.[MODULE_ID] ?? {};
        if (flags.spoiled) continue;

        const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
        if (spoilsAfter == null || spoilsAfter <= 0) continue;

        // Avoid duplicate badges
        if (row.querySelector(".respite-spoil-badge")) continue;

        // Calculate days remaining (items with harvestedDate use calendar math)
        let daysLeft = spoilsAfter;
        const harvested = flags.harvestedDate;
        if (harvested) {
            if (now && harvested.includes("-")) {
                const daysPassed = MealPhaseHandler._dateDiffDays(harvested, now);
                daysLeft = Math.max(0, spoilsAfter - daysPassed);
            } else {
                const harvestedEpoch = parseInt(harvested, 10);
                if (!isNaN(harvestedEpoch)) {
                    const daysPassed = Math.floor((nowEpoch - harvestedEpoch) / 86400);
                    daysLeft = Math.max(0, spoilsAfter - daysPassed);
                }
            }
        }

        const badge = document.createElement("span");
        badge.className = "respite-spoil-badge";
        if (daysLeft <= 0) {
            badge.classList.add("spoil-expired");
            badge.textContent = "SPOILED";
            badge.dataset.tooltip = "This food has gone off.";
        } else if (daysLeft === 1) {
            badge.classList.add("spoil-urgent");
            badge.textContent = "1d";
            badge.dataset.tooltip = "Spoils within a day. Eat or cook it.";
        } else {
            badge.classList.add("spoil-fresh");
            badge.textContent = `${daysLeft}d`;
            badge.dataset.tooltip = `${daysLeft} days until spoilage.`;
        }

        // Insert into the item name area
        const nameEl = row.querySelector(".item-name, .entry-name, h4, .name");
        if (nameEl) {
            nameEl.appendChild(badge);
        } else {
            row.appendChild(badge);
        }
    }
}

for (const hookName of [
    "renderActorSheet",
    "renderActorSheetV2",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter"
]) {
    Hooks.on(hookName, (app, html, context) => _injectSpoilageBadges(app, html));
}

// ── Calendar-Driven Spoilage ─────────────────────────────────
// When in-game time advances (Simple Calendar or core worldTime), check all
// party member inventories for perishable items that have expired based on
// their harvestedDate. Replaces spoiled items with "Spoiled Food" and
// whispers a summary to the GM.
{
    let _spoilageDebounce = null;

    Hooks.on("updateWorldTime", (worldTime, dt) => {
        if (!game.user.isGM) return;
        if (_spoilageDebounce) clearTimeout(_spoilageDebounce);
        _spoilageDebounce = setTimeout(() => _runCalendarSpoilage(), 2000);
    });

    // Simple Calendar fires its own date change hook
    Hooks.on("simple-calendar-date-time-change", () => {
        if (!game.user.isGM) return;
        if (_spoilageDebounce) clearTimeout(_spoilageDebounce);
        _spoilageDebounce = setTimeout(() => _runCalendarSpoilage(), 2000);
    });

    async function _runCalendarSpoilage() {
        _spoilageDebounce = null;
        try {
            const roster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
            const actors = roster.map(id => game.actors.get(id)).filter(Boolean);
            if (!actors.length) return;

            const report = await MealPhaseHandler.resolveCalendarSpoilage(actors);

            // Re-render open actor sheets so spoilage badges update live
            for (const actor of actors) {
                actor?.sheet?.render(false);
            }

            if (!report.length) return;

            const totalSpoiled = report.reduce(
                (sum, r) => sum + r.spoiled.reduce((s, i) => s + i.qty, 0), 0
            );
            const lines = report.flatMap(r =>
                r.spoiled.map(s => `<strong>${r.actorName}</strong>: ${s.qty}x ${s.name}`)
            );

            await ChatMessage.create({
                content: `<p><i class="fas fa-hourglass-end"></i> <strong>Food Spoilage (time advance):</strong> ${totalSpoiled} item(s) have spoiled.</p><ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul>`,
                speaker: { alias: "Respite" },
                whisper: game.users.filter(u => u.isGM).map(u => u.id),
                type: CONST.CHAT_MESSAGE_TYPES.WHISPER ?? 4
            });

            Logger?.log?.(MODULE_LABEL, `Calendar spoilage: ${totalSpoiled} items spoiled across ${report.length} characters.`);
        } catch (e) {
            console.warn(`${MODULE_ID} | Calendar spoilage check failed:`, e);
        }
    }
}

// ── Monster Cooking: Chat Card Button Wiring ─────────────────
// Wires "Butcher" and "Pass" buttons on the butcher prompt chat cards.
Hooks.on("renderChatMessage", (message, html) => {
    if (!isMonsterCookingUnlocked()) return;
    const card = html[0]?.querySelector?.(".respite-butcher-card")
        ?? html.find?.(".respite-butcher-card")?.[0];
    if (!card) return;

    const butcherBtn = card.querySelector(".btn-butcher");
    const passBtn = card.querySelector(".btn-butcher-pass");

    if (butcherBtn) {
        butcherBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.currentTarget.disabled = true;

            const flags = message.flags?.[MODULE_ID];
            if (!flags?.butcherPrompt) return;

            const holderIds = flags.holderIds ?? [];
            const userActors = game.actors.filter(a =>
                a.hasPlayerOwner && holderIds.includes(a.id) &&
                a.ownership?.[game.user.id] >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
            );

            let actor;
            if (game.user.isGM) {
                actor = game.actors.get(holderIds[0]);
            } else if (userActors.length === 1) {
                actor = userActors[0];
            } else if (userActors.length > 1) {
                actor = userActors[0];
            } else {
                ui.notifications.warn("None of the characters carrying the Handbook belong to this player.");
                ev.currentTarget.disabled = false;
                return;
            }

            if (!actor) {
                ui.notifications.warn("Could not find the butchering character.");
                ev.currentTarget.disabled = false;
                return;
            }

            const target = {
                combatant: { id: flags.combatantId },
                actor: game.actors.get(flags.creatureId) ?? { id: flags.creatureId },
                actorName: flags.creatureName,
                actorImg: flags.creatureImg,
                classifierResult: { id: flags.classifierId },
                registryEntry: ButcherResolver.lookup(flags.classifierId, flags.cr),
                cr: flags.cr
            };

            if (!target.registryEntry) {
                ui.notifications.warn("Butcher registry entry not found for this creature.");
                ev.currentTarget.disabled = false;
                return;
            }

            const result = await ButcherResolver.resolve(actor, target);
            const resultContent = ButcherResolver.buildResultCard(result, actor.name);

            await ChatMessage.create({
                content: resultContent,
                speaker: { alias: "Respite" },
                flags: {
                    [MODULE_ID]: {
                        butcherResult: true,
                        outcome: result.outcome,
                        tier: result.tier
                    }
                }
            });

            butcherBtn.style.display = "none";
            if (passBtn) passBtn.style.display = "none";
        });
    }

    if (passBtn) {
        passBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            if (butcherBtn) butcherBtn.style.display = "none";
            passBtn.style.display = "none";
            const actionsDiv = card.querySelector(".butcher-card-actions");
            if (actionsDiv) {
                actionsDiv.innerHTML = `<span class="butcher-passed"><i class="fas fa-times"></i> Passed</span>`;
            }
        });
    }
});

// Item Enrichment hooks are now wired by ionrift-library (ItemEnrichmentEngine).
// Respite enrichment data is registered in the init hook below via registerBatch().

const ZZZ_CHILD_NAME = "ionrift-respite-zzz";

/**
 * Add or remove the Zzz PIXI text overlay on a token based on its beddingDown flag.
 * Called from the refreshToken hook so it runs for every client on each token draw/update.
 * @param {Token} token
 */
function _refreshZzzOverlay(token) {
    const isSleeping = !!(token.document?.getFlag?.(MODULE_ID, "beddingDown"));
    let child = token.getChildByName?.(ZZZ_CHILD_NAME) ?? null;

    if (isSleeping) {
        if (!child) {
            child = new PIXI.Text("Zzz", {
                fontFamily: "Signika, Arial, sans-serif",
                fontSize: Math.max(12, (token.w ?? 50) * 0.28),
                fontStyle: "italic",
                fill: 0xadd8ff,
                dropShadow: true,
                dropShadowColor: 0x000033,
                dropShadowDistance: 2,
                dropShadowBlur: 4,
                dropShadowAlpha: 0.8
            });
            child.name = ZZZ_CHILD_NAME;
            child.alpha = 0.9;
            token.addChild(child);
        }
        const tw = token.w ?? 50;
        const th = token.h ?? 50;
        child.position.set(tw * 0.55, th * 0.04);
    } else if (child) {
        token.removeChild(child);
        child.destroy();
    }
}

Hooks.once("ready", async () => {
    console.log(`${MODULE_ID} | Ready hook firing...`);
    Logger.log?.(MODULE_LABEL, "Ready.");

    // ── Register adapter contract tests ──────────────────────
    if (game.ionrift?.library?.tests) {
        game.ionrift.library.tests.register("ionrift-respite", {
            name: "Respite System Adapters",
            description: "Contract tests for DnD5e + PF2e adapters (mock actors, any world)",
            runFn: async () => {
                const { runAdapterTests } = await import("./tests/AdapterTests.js");
                return runAdapterTests();
            }
        });
    }

    // Initialize image resolver (art pack detection — probes ionrift-data/)
    await ImageResolver.init();

    // Initialize terrain registry early so data is available before first rest
    await TerrainRegistry.init();

    // Load butcher registry for monster cooking (from imported packs or dev fallback)
    if (game.user.isGM) {
        try {
            if (isMonsterCookingUnlocked()) {
                let loaded = false;

                // 1. Try imported content packs
                const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};
                for (const [, packData] of Object.entries(importedPacks)) {
                    if (packData.butcherRegistry) {
                        ButcherResolver.load(packData.butcherRegistry);
                        loaded = true;
                        break;
                    }
                }

                // 2. Dev fallback: load from workshop pack on disk
                if (!loaded) {
                    try {
                        const resp = await fetch("ionrift-pack-workshop/packs/respite/content/cooking/butcher_registry.json");
                        if (resp.ok) {
                            const data = await resp.json();
                            ButcherResolver.load(data);
                            loaded = true;
                        }
                    } catch { /* no workshop pack on disk, that's fine */ }
                }

                if (loaded) {
                    console.log(`${MODULE_ID} | Butcher registry loaded (${Object.keys(ButcherResolver._registry ?? {}).length} entries)`);
                } else {
                    console.log(`${MODULE_ID} | Monster cooking enabled but no butcher registry found.`);
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to load butcher registry:`, e);
        }
    }

    // Register socket handler
    game.socket.on(`module.${MODULE_ID}`, _onSocketMessage);

    registerCampFurnitureZOrderGuards();

    // Zzz overlay on tokens for characters bedded down during reflection.
    Hooks.on("refreshToken", (token) => {
        try {
            _refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });

    /** Block non-GM canvas drags for shared station tokens (belt-and-suspenders with TokenDocument#locked). */
    Hooks.on("preUpdateToken", (document, updateData, _options, userId) => {
        try {
            clampCampFloorTokenInPreUpdate(document, updateData);
        } catch {
            /* ignore */
        }
        try {
            const f = document.flags?.[MODULE_ID];
            if (!f?.isSharedStation) return;
            if (!("x" in updateData) && !("y" in updateData)) return;
            const user = game.users.get(userId);
            if (user?.isGM) return;
            return false;
        } catch {
            /* ignore */
        }
    });

    setRestSessionAfkEmitter(emitAfkSocket);
    setAfkUiRefresh(() => {
        void activeRestSetupApp?.render?.();
        void activePlayerRestApp?.render?.({ force: true });
        void activeShortRestApp?.render?.({ force: true });
        void activeAfkPanel?.render?.({ force: true });
    });

    // Player: request current rest state in case a rest is already active (GM may still be resuming after F5)
    if (!game.user.isGM) {
        const requestRestAndShortRestState = (label) => {
            console.log(`${MODULE_ID} | Player requesting rest state (${label})...`);
            game.socket.emit(`module.${MODULE_ID}`, { type: "requestRestState", userId: game.user.id });
            game.socket.emit(`module.${MODULE_ID}`, { type: "requestShortRestState", userId: game.user.id });
        };
        setTimeout(() => requestRestAndShortRestState("initial"), 1000);
        setTimeout(() => {
            if (!_playerRestActive && !activeShortRestApp) {
                requestRestAndShortRestState("retry");
            }
        }, 4500);

        // Auto-resync when player returns from minimize/tab switch (debounced)
        let _lastResyncTime = 0;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                const now = Date.now();
                if (now - _lastResyncTime < 500) return;
                _lastResyncTime = now;
                if (_playerRestActive && activePlayerRestApp) {
                    console.log(`${MODULE_ID} | Tab visible, resyncing rest state...`);
                    game.socket.emit(`module.${MODULE_ID}`, { type: "requestRestState", userId: game.user.id });
                }
                if (activeShortRestApp) {
                    console.log(`${MODULE_ID} | Tab visible, resyncing short rest state...`);
                    game.socket.emit(`module.${MODULE_ID}`, { type: "requestShortRestState", userId: game.user.id });
                }
            }
        });
        _maybeShowAmbientAfkPanelAtReady();
        return;
    }



    // Detect rest-recovery module collision
    const restRecovery = game.modules.get("rest-recovery");
    if (restRecovery?.active) {
        Logger.warn?.(MODULE_LABEL,
            "rest-recovery module detected. Respite will defer HP/HD modification to rest-recovery and only handle events/activities."
        );
        game.settings.set(MODULE_ID, "restRecoveryDetected", true);
    } else {
        // Clear the flag if rest-recovery was previously active but has since been removed
        const wasDetected = game.settings.get(MODULE_ID, "restRecoveryDetected");
        if (wasDetected) {
            Logger.log?.(MODULE_LABEL, "rest-recovery no longer active. Resuming native rest recovery.");
            game.settings.set(MODULE_ID, "restRecoveryDetected", false);
        }
    }

    // Detect Quartermaster for item handoff
    const workshop = game.modules.get("ionrift-quartermaster");
    if (workshop?.active && workshop.api?.items) {
        Logger.log?.(MODULE_LABEL, "Quartermaster detected. Items will be normalized via WorkshopItemFactory.");
    } else {
        Logger.log?.(MODULE_LABEL, "Quartermaster not detected. Items will be created with minimal normalization.");
    }

    // ── PF2e Early-Support Advisory ───────────────────────────────
    if (game.system.id === "pf2e") {
        try {
            const shown = game.settings.get(MODULE_ID, "pf2eAdvisoryShown");
            if (!shown) {
                const openDiscord = await game.ionrift.library.confirm({
                    title: "Pathfinder 2e: Early Support",
                    content: `
                        <p>Respite's <strong>Pathfinder 2e support is early</strong>. The core rest flow (activities, campfire, terrain events, comfort tiers, and recovery) is functional.</p>
                        <p>However, some PF2e-specific mechanics are <strong>not yet implemented</strong>:</p>
                        <ul>
                            <li>Treat Wounds (Medicine activity)</li>
                            <li>Refocus (Focus Point recovery activity)</li>
                            <li>Repair (Shield / equipment repair)</li>
                            <li>Subsist (Earn income / forage equivalent)</li>
                        </ul>
                        <p>If you hit a bug or have a suggestion, please report it on Discord. Your feedback shapes what gets built next.</p>
                    `,
                    yesLabel: "Join Discord",
                    noLabel: "Got It",
                    yesIcon: "fab fa-discord",
                    noIcon: "fas fa-check",
                    defaultYes: false
                });
                if (openDiscord) {
                    window.open("https://discord.gg/vFGXf7Fncj", "_blank");
                }
                game.settings.set(MODULE_ID, "pf2eAdvisoryShown", true);
            }
        } catch (e) {
            // Graceful fail — don't block startup for an advisory
        }
    }

    // ── Session Recovery ──────────────────────────────────────────
    // Check for interrupted rest state saved in world settings
    const savedRest = game.settings.get(MODULE_ID, "activeRest");
    if (savedRest?.engine) {
        const age = Date.now() - (savedRest.timestamp ?? 0);
        const ageLabel = age < 3600000
            ? `${Math.round(age / 60000)} minutes ago`
            : age < 86400000
                ? `${Math.round(age / 3600000)} hours ago`
                : `${Math.round(age / 86400000)} days ago`;

        // Block new rest creation while the resume prompt is open
        respiteFlowActive = true;

        const isPastSetup = savedRest.phase && savedRest.phase !== "setup";
        const rewardWarning = isPastSetup
            ? `<p style="color: #e8a44a;"><i class="fas fa-exclamation-triangle"></i> <strong>Warning:</strong> Activities have been selected. Spell copies or event discoveries may have already granted items. Discarding and re-resting could produce duplicate rewards.</p>`
            : "";

        let resume = false;
        try {
            resume = await game.ionrift.library.confirm({
                title: "Interrupted Rest Found",
                content: `<p>An interrupted rest was found (saved ${ageLabel}).</p><p><strong>Phase:</strong> ${savedRest.phase ?? "unknown"}</p><p><strong>Terrain:</strong> ${savedRest.engine.terrainTag ?? "unknown"}</p>${rewardWarning}`,
                yesLabel: "Resume Rest",
                noLabel: "Discard",
                yesIcon: "fas fa-campground",
                noIcon: "fas fa-trash",
                defaultYes: true
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Resume dialog failed, clearing stale state:`, e);
            respiteFlowActive = false;
            await game.settings.set(MODULE_ID, "activeRest", {});
            clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on dialog error:`, err));
            resetCampSession();
        }

        if (resume) {
            try {
                const app = new RestSetupApp();
                const restored = await app._loadRestState();
                if (restored) {
                    const restPayload = {
                        terrainTag: app._engine?.terrainTag,
                        comfort: app._engine?.comfort,
                        restType: app._engine?.restType,
                        activities: app._activities ?? [],
                        recipes: app._craftingEngine?.recipes
                            ? Object.fromEntries(app._craftingEngine.recipes)
                            : {}
                    };
                    setActiveRestData(restPayload);

                    let resumeUiOk = true;
                    try {
                        if (app._phase === "activity") {
                            await app.applyRestoredPhaseUi();
                        } else {
                            await Promise.resolve(app.render({ force: true }));
                        }
                    } catch (e) {
                        clearActiveRestApp();
                        console.error(`${MODULE_ID} | Failed to open restored rest UI:`, e);
                        ui.notifications.warn(
                            "Could not open the rest window. Saved rest is still in world settings. Reload after updating the module, or discard Active Rest in module settings if you must start over."
                        );
                        resumeUiOk = false;
                    }

                    if (resumeUiOk) {
                        ui.notifications.info("Interrupted rest resumed.");
                        Logger.log?.(MODULE_LABEL, "Restored interrupted rest from world flags.");

                        setTimeout(() => {
                            game.socket.emit(`module.${MODULE_ID}`, {
                                type: "restStarted",
                                restData: restPayload
                            });
                            const snapshot = app.getRestSnapshot?.();
                            if (snapshot) {
                                setTimeout(() => {
                                    game.socket.emit(`module.${MODULE_ID}`, {
                                        type: "restSnapshot",
                                        snapshot
                                    });
                                }, 200);
                            }
                        }, 500);
                    }
                } else {
                    respiteFlowActive = false;
                    ui.notifications.warn("Could not restore rest state. Starting fresh.");
                    await game.settings.set(MODULE_ID, "activeRest", {});
                    clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on failed restore:`, err));
                    resetCampSession();
                }
            } catch (e) {
                respiteFlowActive = false;
                console.error(`${MODULE_ID} | Failed to restore rest state:`, e);
                await game.settings.set(MODULE_ID, "activeRest", {});
                clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on restore error:`, err));
                resetCampSession();
            }
        } else {
            respiteFlowActive = false;
            await game.settings.set(MODULE_ID, "activeRest", {});
            game.socket.emit(`module.${MODULE_ID}`, { type: "restResolved" });
            clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on discard failed:`, err));
            resetCampSession();
            Logger.log?.(MODULE_LABEL, "Discarded interrupted rest.");
        }
    }

    // ── Short Rest Session Recovery ───────────────────────────────
    const savedShortRest = game.settings.get(MODULE_ID, "activeShortRest");
    if (savedShortRest?.timestamp && !respiteFlowActive) {
        const age = Date.now() - (savedShortRest.timestamp ?? 0);
        const ageLabel = age < 3600000
            ? `${Math.round(age / 60000)} minutes ago`
            : age < 86400000
                ? `${Math.round(age / 3600000)} hours ago`
                : `${Math.round(age / 86400000)} days ago`;

        respiteFlowActive = true;

        let resume = false;
        try {
            resume = await game.ionrift.library.confirm({
                title: "Interrupted Short Rest Found",
                content: `<p>An interrupted short rest was found (saved ${ageLabel}).</p><p><strong>Shelter:</strong> ${savedShortRest.activeShelter ?? "none"}</p>`,
                yesLabel: "Resume Short Rest",
                noLabel: "Discard",
                yesIcon: "fas fa-mug-hot",
                noIcon: "fas fa-trash",
                defaultYes: true
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Short rest resume dialog failed:`, e);
            respiteFlowActive = false;
            await game.settings.set(MODULE_ID, "activeShortRest", {});
        }

        if (resume) {
            try {
                const app = new ShortRestApp({ initialShelter: savedShortRest.activeShelter ?? "none" });
                const restored = app._loadShortRestState();
                if (restored) {
                    registerActiveShortRestApp(app);
                    app.render({ force: true });
                    ui.notifications.info("Interrupted short rest resumed.");
                    Logger.log?.(MODULE_LABEL, "Restored interrupted short rest from world settings.");
                } else {
                    respiteFlowActive = false;
                    ui.notifications.warn("Could not restore short rest state. Starting fresh.");
                    await game.settings.set(MODULE_ID, "activeShortRest", {});
                }
            } catch (e) {
                respiteFlowActive = false;
                console.error(`${MODULE_ID} | Failed to restore short rest state:`, e);
                await game.settings.set(MODULE_ID, "activeShortRest", {});
            }
        } else {
            respiteFlowActive = false;
            await game.settings.set(MODULE_ID, "activeShortRest", {});
            game.socket.emit(`module.${MODULE_ID}`, { type: "shortRestAbandoned" });
            Logger.log?.(MODULE_LABEL, "Discarded interrupted short rest.");
        }
    }

    // ── Combat Blocking Hook ─────────────────────────────────────
    // When combat ends and a rest is awaiting combat resolution, resume the rest flow
    Hooks.on("deleteCombat", (combat, options, userId) => {
        if (!activeRestSetupApp) return;
        if (!activeRestSetupApp._awaitingCombat) return;
        activeRestSetupApp._awaitingCombat = false;
        activeRestSetupApp._combatAcknowledged = true;
        activeRestSetupApp._saveRestState();
        activeRestSetupApp.render({ force: true });
        ui.notifications.info("Combat resolved. Rest may now proceed.");
        Logger.log?.(MODULE_LABEL, "Combat ended, rest flow unblocked.");
    });

    // ── Monster Cooking: Butcher Prompt after Combat ──────────────
    // Double gate: setting enabled + cookbook holder + registry loaded.
    // Posts a butcher prompt card to chat when a notable creature is killed.
    Hooks.on("deleteCombat", async (combat, options, userId) => {
        if (!game.user.isGM) return;
        if (!isMonsterCookingUnlocked()) return;

        if (!ButcherResolver.hasRegistry) {
            Logger.log?.(MODULE_LABEL, "Monster cooking enabled but no butcher registry loaded. Skipping.");
            return;
        }

        const partyActors = getPartyActors();
        const holders = ButcherResolver.findCookbookHolders(partyActors);
        if (!holders.length) return;

        const targets = ButcherResolver.findButcherTargets(combat);
        if (!targets.length) return;

        const bestTarget = targets[0];
        Logger.log?.(MODULE_LABEL,
            `Butcher opportunity: ${bestTarget.actorName} (CR ${bestTarget.cr}, ${bestTarget.registryEntry.tier})`
        );

        const promptFlags = {
            butcherPrompt: true,
            creatureId: bestTarget.actor?.id ?? null,
            combatantId: bestTarget.combatant?.id ?? null,
            creatureName: bestTarget.actorName,
            creatureImg: bestTarget.actorImg,
            classifierId: bestTarget.classifierResult?.id,
            cr: bestTarget.cr,
            tier: bestTarget.registryEntry.tier,
            holderIds: holders.map(a => a.id)
        };

        const content = ButcherResolver.buildPromptCard(bestTarget, holders);
        await ChatMessage.create({
            content,
            speaker: { alias: "Respite" },
            flags: { [MODULE_ID]: promptFlags }
        });

        // Send popup to owning players (and GM for solo testing)
        const dc = ButcherResolver.calculateDC(bestTarget.cr);
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "butcherPromptPopup",
            creatureName: bestTarget.actorName,
            creatureImg: bestTarget.actorImg,
            tier: bestTarget.registryEntry.tier ?? "common",
            flavour: bestTarget.registryEntry.flavour ?? "",
            cr: bestTarget.cr,
            dc,
            holderIds: holders.map(a => a.id),
            holderNames: holders.map(a => a.name).join(", "),
            flags: promptFlags
        });

        // Also show on GM client immediately
        _showButcherPopup({
            creatureName: bestTarget.actorName,
            creatureImg: bestTarget.actorImg,
            tier: bestTarget.registryEntry.tier ?? "common",
            flavour: bestTarget.registryEntry.flavour ?? "",
            cr: bestTarget.cr,
            dc,
            holderIds: holders.map(a => a.id),
            holderNames: holders.map(a => a.name).join(", "),
            flags: promptFlags
        });
    });

    _maybeShowAmbientAfkPanelAtReady();

    console.log(`${MODULE_ID} | Boot complete.`);
});

/**
 * Block player-initiated rests when interception is enabled.
 * GMs can always rest normally. Players see a notification
 * directing them to the GM-managed Respite flow.
 */
function _blockPlayerRest(actor, config) {
    if (game.user.isGM) return true;
    if (!game.settings.get(MODULE_ID, "interceptRests")) return true;

    ui.notifications.warn(
        "Rests are managed by the GM through Respite. Ask your GM to start a rest phase."
    );
    return false;
}

Hooks.on("dnd5e.preShortRest", _blockPlayerRest);
Hooks.on("dnd5e.preLongRest", _blockPlayerRest);

/**
 * DnD5e rest hook: suppress default HP/HD recovery when Respite is managing it.
 * This fires BEFORE the system applies its own recovery.
 * We zero out HP and HD restoration so the system doesn't double-apply.
 * Spell slots, class features, and other recharges are left untouched.
 */
Hooks.on("dnd5e.preRestCompleted", (actor, result, config) => {
    if (!respiteFlowActive) return true;

    // Suppress HP recovery: system would set hp to max, we zero the delta and strip the payload
    if (result.dhp !== undefined) result.dhp = 0;
    if (result.deltas?.hitPoints !== undefined) result.deltas.hitPoints = 0;
    // Flat dot-notation keys (v3 direct assignment in _getRestHitPointRecovery)
    delete result.updateData?.["system.attributes.hp.value"];
    delete result.updateData?.["system.attributes.hp.temp"];
    delete result.updateData?.["system.attributes.hp.tempmax"];
    // Nested keys: DnD5e v5 mergeObject expands dot-notation into an object tree
    if (result.updateData?.system?.attributes?.hp) {
        delete result.updateData.system.attributes.hp;
    }

    // Suppress HD recovery: zero out the array of restored HD
    // v3: "system.hitDiceUsed", v4+: "system.hd.spent"
    if (result.dhd !== undefined) result.dhd = 0;
    if (result.deltas?.hitDice !== undefined) result.deltas.hitDice = 0;
    if (Array.isArray(result.updateItems)) {
        result.updateItems = result.updateItems.filter(u => {
            return !("system.hitDiceUsed" in u) && !("system.hd.spent" in u);
        });
    }

    // Suppress exhaustion recovery: Respite handles this via RecoveryHandler.
    // v5+: system reads config.exhaustionDelta to decide reduction.
    if (config.exhaustionDelta) config.exhaustionDelta = 0;
    // Flat key (v3)
    delete result.updateData?.["system.attributes.exhaustion"];
    // Nested key (v5 mergeObject expansion)
    if (result.updateData?.system?.attributes?.exhaustion !== undefined) {
        delete result.updateData.system.attributes.exhaustion;
    }

    Logger.log?.(MODULE_LABEL,
        `Suppressed default HP/HD/exhaustion recovery for ${actor.name} (Respite flow active).`
    );
    return true;
});

/**
 * Central socket message router.
 * GM receives player choices; Players receive rest-start broadcasts.
 */
function _onSocketMessage(data) {
    if (!data?.type) return;
    console.log(`${MODULE_ID} | Socket received:`, data.type, `isGM=${game.user.isGM}`);

    switch (data.type) {
        // GM -> Players: rest phase started, open your picker
        case "restStarted":
            if (game.user.isGM) return;
            _removePrepNotification();
            _handleRestStarted(data);
            break;

        // GM -> Players: GM opened setup wizard, rest coming soon
        case "restPreparing":
            if (game.user.isGM) return;
            _showPrepNotification();
            break;

        // Player -> GM: activity choices submitted
        case "activityChoice":
            if (!game.user.isGM) return;
            _handleActivityChoice(data);
            break;

        // Player -> GM: light campfire and consume firewood (GM-only item updates)
        case "campLightFireRequest":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?._runSetCampFireLevelForGm) {
                void activeRestSetupApp._runSetCampFireLevelForGm("campfire", data.userId ?? null).catch(err => {
                    console.error(`${MODULE_ID} | campLightFireRequest:`, err);
                    ui.notifications.error("Could not set fire level. Check the console.");
                });
            } else {
                ui.notifications.warn("Open the rest session on the GM client first.");
            }
            break;

        case "campFireLevelRequest":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?._runSetCampFireLevelForGm) {
                void activeRestSetupApp._runSetCampFireLevelForGm(data.fireLevel, data.userId ?? null).catch(err => {
                    console.error(`${MODULE_ID} | campFireLevelRequest:`, err);
                    ui.notifications.error("Could not set fire level. Check the console.");
                });
            } else {
                ui.notifications.warn("Open the rest session on the GM client first.");
            }
            break;

        case "activityFireLevelRequest":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.changeFireLevelDuringActivity) {
                void activeRestSetupApp.changeFireLevelDuringActivity(data.fireLevel).catch(err => {
                    console.error(`${MODULE_ID} | activityFireLevelRequest:`, err);
                });
            } else {
                ui.notifications.warn("Open the rest session on the GM client first.");
            }
            break;

        case "campLightFire":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?._lightFire) {
                void activeRestSetupApp._lightFire(data.userId, data.actorId, data.method ?? "Tinderbox").catch(err => {
                    console.error(`${MODULE_ID} | campLightFire:`, err);
                });
            } else {
                ui.notifications.warn("Open the rest session on the GM client first.");
            }
            break;

        case "campFirewoodPledge":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?._addFirewoodPledge) {
                void activeRestSetupApp._addFirewoodPledge(data.userId, data.actorId).catch(err => {
                    console.error(`${MODULE_ID} | campFirewoodPledge:`, err);
                });
            } else {
                ui.notifications.warn("Open the rest session on the GM client first.");
            }
            break;

        case "campFirewoodReclaim":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?._removeFirewoodPledge) {
                void activeRestSetupApp._removeFirewoodPledge(data.userId).catch(err => {
                    console.error(`${MODULE_ID} | campFirewoodReclaim:`, err);
                });
            } else {
                ui.notifications.warn("Open the rest session on the GM client first.");
            }
            break;

        // Player -> GM: meal choices submitted
        case "mealChoice":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveMealChoices) {
                activeRestSetupApp.receiveMealChoices(data.userId, data.choices);
            }
            break;

        // Player -> GM: consumed a meal day (multi-day flow)
        case "mealDayConsumed":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveMealDayConsumed) {
                activeRestSetupApp.receiveMealDayConsumed(data.userId, data.mealChoices);
            }
            break;

        // GM -> Player: dehydration save required
        case "dehydrationSaveRequest":
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            // Route to the player's app instance (not the GM's)
            const dehydApp = activePlayerRestApp ?? activeRestSetupApp;
            if (dehydApp?.receiveDehydrationPrompt) {
                dehydApp.receiveDehydrationPrompt(data.characterId, data.actorName, data.dc);
            } else {
                console.warn(`[Respite] Dehydration save request received but no active app to route to`);
            }
            break;

        // Player -> GM: dehydration save result
        case "dehydrationSaveResult":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveDehydrationResult) {
                activeRestSetupApp.receiveDehydrationResult(data);
            }
            break;

        // GM -> Players: dehydration save results broadcast
        case "dehydrationResultsBroadcast":
            if (game.user.isGM) return;
            if (activePlayerRestApp) {
                activePlayerRestApp._dehydrationResults = data.results ?? [];
                activePlayerRestApp.render();
            }
            break;

        // Any client -> all: Detect Magic scan results (inventory glow + Identify tab)
        case "detectMagicScanBroadcast": {
            const results = data.results ?? [];
            const partyActorIds = data.partyActorIds ?? [];
            const dmApp = activeRestSetupApp ?? activePlayerRestApp;
            if (dmApp) {
                dmApp._magicScanResults = results;
                dmApp._magicScanComplete = !!data.magicScanComplete;
                if (dmApp.rendered) void dmApp.render(false);
            }
            notifyDetectMagicScanApplied(
                { _magicScanResults: results, _magicScanComplete: !!data.magicScanComplete },
                partyActorIds
            );
            break;
        }

        // GM -> all: clear Detect Magic session (glow + embedded scan state)
        case "detectMagicScanCleared": {
            const clrApp = activeRestSetupApp ?? activePlayerRestApp;
            if (clrApp) {
                clrApp._magicScanResults = null;
                clrApp._magicScanComplete = false;
                clrApp._workbenchIdentifyStaging?.clear();
                clrApp._workbenchIdentifyAcknowledge?.clear();
                if (clrApp.rendered) void clrApp.render(false);
            }
            Hooks.callAll(`${MODULE_ID}.workbenchIdentifyStagingTouched`);
            notifyDetectMagicScanCleared();
            break;
        }

        // GM -> Players: rest resolved, close your picker
        case "restResolved":
            if (game.user.isGM) return;
            _handleRestResolved(data);
            break;

        // GM -> Players: rest abandoned, close your picker
        case "restAbandoned":
            if (game.user.isGM) return;
            ui.notifications.info("The GM has abandoned the rest.");
            _handleRestResolved(data);
            break;

        // GM -> Players: phase changed
        case "phaseChanged":
            if (game.user.isGM) return;
            console.log(`${MODULE_ID} | phaseChanged handler: phase=${data.phase}, hasApp=${!!activePlayerRestApp}, hasMethod=${!!activePlayerRestApp?.receivePhaseChange}`);
            if (activePlayerRestApp?.receivePhaseChange) {
                void activePlayerRestApp.receivePhaseChange(data.phase, data.phaseData ?? {}).catch(err => {
                    console.error(`${MODULE_ID} | receivePhaseChange failed`, err);
                });
            } else {
                console.warn(`${MODULE_ID} | phaseChanged: no activePlayerRestApp or missing receivePhaseChange`);
            }
            break;

        // GM -> Players: submission status update
        case "submissionUpdate":
            if (game.user.isGM) return;
            _handleSubmissionUpdate(data);
            break;

        // Player -> GM: request current rest state (late join)
        case "requestRestState":
            if (!game.user.isGM) return;
            _handleRequestRestState(data);
            break;

        // Player -> GM: travel activity declaration
        case "travelDeclaration":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveTravelDeclaration) {
                activeRestSetupApp.receiveTravelDeclaration(data);
            }
            break;

        // GM -> Players: live sync of all travel declarations (multi-day)
        case "travelDeclarationsSync":
            if (game.user.isGM) return;
            if (activePlayerRestApp) {
                activePlayerRestApp._syncedTravelDeclarations = data.declarations ?? {};
                if (data.activeDay != null) activePlayerRestApp._travelActiveDay = data.activeDay;
                if (data.totalDays != null) activePlayerRestApp._travelTotalDays = data.totalDays;
                if (data.scoutingAllowed != null) activePlayerRestApp._travelScoutingAllowed = data.scoutingAllowed;
                if (data.forageDC != null) activePlayerRestApp._travelForageDC = data.forageDC;
                if (data.huntDC != null) activePlayerRestApp._travelHuntDC = data.huntDC;
                activePlayerRestApp.render();
            }
            break;

        // GM -> Players: travel roll request
        case "travelRollRequest":
            if (game.user.isGM) return;
            if (activePlayerRestApp?.receiveTravelRollRequest) {
                activePlayerRestApp.receiveTravelRollRequest(data);
            }
            break;

        // Player -> GM: travel roll result
        case "travelRollResult":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveTravelRollResult) {
                activeRestSetupApp.receiveTravelRollResult(data);
            }
            break;

        // GM -> specific Player: private travel debrief
        case "travelDebrief":
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            if (activePlayerRestApp) {
                if (!activePlayerRestApp._travelDebrief) activePlayerRestApp._travelDebrief = [];
                activePlayerRestApp._travelDebrief.push(...(data.results ?? []));
                activePlayerRestApp._travelFullyResolved = !!data.fullyResolved;
                activePlayerRestApp._travelScoutingDone = !!data.scoutingDone;
                activePlayerRestApp.render();
            }
            break;

        // GM -> specific Player: one forage/hunt result as soon as the roll is resolved
        case "travelIndividualDebrief":
            if (game.user.isGM) return;
            if (data.targetUserId !== game.user.id) return;
            if (activePlayerRestApp) {
                if (!activePlayerRestApp._travelDebrief) activePlayerRestApp._travelDebrief = [];
                if (data.result) {
                    activePlayerRestApp._travelDebrief.push(data.result);
                }
                activePlayerRestApp.render();
            }
            break;

        // Player -> GM: camp activity roll result
        case "campRollResult":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveCampRollResult) {
                activeRestSetupApp.receiveCampRollResult(data);
            }
            break;

        // Bidirectional: AFK status update
        case "afkUpdate":
            _handleAfkUpdate(data);
            break;

        // Bidirectional: armor doff/don toggle
        case "armorToggle":
            _handleArmorToggle(data);
            break;

        // GM -> Players: full state snapshot for resync
        case "restSnapshot":
            if (game.user.isGM) return;
            if (activePlayerRestApp?.receiveRestSnapshot) {
                activePlayerRestApp.receiveRestSnapshot(data.snapshot);
            }
            break;

        // GM -> Players: request skill check roll from watch characters
        case "eventRollRequest":
            if (game.user.isGM) return;
            if (activePlayerRestApp?.receiveRollRequest) {
                activePlayerRestApp.receiveRollRequest(data);
            }
            break;

        // Player -> GM: skill check roll result
        case "eventRollResult":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveRollResult) {
                activeRestSetupApp.receiveRollResult(data);
            }
            break;

        // GM -> Players: request decision tree roll from party
        case "treeRollRequest":
            if (game.user.isGM) return;
            if (activePlayerRestApp?.receiveTreeRollRequest) {
                activePlayerRestApp.receiveTreeRollRequest(data);
            }
            break;

        // Player -> GM: decision tree roll result
        case "treeRollResult":
            if (!game.user.isGM) return;
            if (activeRestSetupApp?.receiveTreeRollResult) {
                activeRestSetupApp.receiveTreeRollResult(data);
            }
            break;

        // Bidirectional: campfire flint strike
        case "campfireStrike":
            if (activeCampfireApp?.receiveStrike) {
                activeCampfireApp.receiveStrike(data);
            }
            break;

        // Bidirectional: campfire stick added
        case "campfireStick":
            if (activeCampfireApp?.receiveStick) {
                activeCampfireApp.receiveStick(data);
            }
            break;

        // Bidirectional: campfire poke (spark burst)
        case "campfirePoke":
            if (activeCampfireApp?.receivePoke) {
                activeCampfireApp.receivePoke(data);
            }
            break;

        // Bidirectional: campfire trinket tossed
        case "campfireTrinket":
            if (activeCampfireApp?.receiveTrinket) {
                activeCampfireApp.receiveTrinket(data);
            }
            break;

        // Bidirectional: campfire emote
        case "campfireEmote":
            if (activeCampfireApp?.receiveEmote) {
                activeCampfireApp.receiveEmote(data);
            }
            break;

        // Bidirectional: campfire whittle
        case "campfireWhittle":
            if (activeCampfireApp?.receiveWhittle) {
                activeCampfireApp.receiveWhittle(data);
            }
            break;

        // Bidirectional: Copy Spell transaction proposal
        case "copySpellProposal":
            if (game.user.isGM) {
                // Player initiated: GM receives proposal and can execute the transaction
                CopySpellHandler.receiveProposalAsGM(data, activeRestSetupApp);
            } else {
                // GM initiated: player receives proposal for gold approval
                CopySpellHandler.receiveProposal(data, activePlayerRestApp);
            }
            break;

        // Player -> GM: Copy Spell approved
        case "copySpellApproved":
            if (!game.user.isGM) return;
            CopySpellHandler.handleApproval(data);
            break;

        // Player -> GM: Copy Spell declined
        case "copySpellDeclined":
            if (!game.user.isGM) return;
            CopySpellHandler.handleDecline(data);
            break;

        // GM -> Player: Gold charged, player should roll Arcana
        case "copySpellRollPrompt":
            if (game.user.isGM) return;
            CopySpellHandler.handleRollPrompt(data, activePlayerRestApp);
            break;

        // Bidirectional: Copy Spell result (player rolled, both sides get result)
        case "copySpellResult":
            CopySpellHandler.receiveResult(data, game.user.isGM ? activeRestSetupApp : activePlayerRestApp);
            break;

        // GM -> Player: GM is busy with another Copy Spell transaction
        case "copySpellBusy":
            if (game.user.isGM) return;
            ui.notifications.warn(`The GM is processing another Copy Spell transaction. Please wait and try again.`);
            // Unlock the player's character so they can re-select
            if (activePlayerRestApp && data.actorId) {
                activePlayerRestApp._lockedCharacters?.delete(data.actorId);
                activePlayerRestApp._earlyResults?.delete(data.actorId);
                activePlayerRestApp.render();
            }
            break;
        // Bidirectional: campfire whittled item dropped onto fire
        case "campfireWhittleDrop":
            if (activeCampfireApp?.receiveWhittleDrop) {
                activeCampfireApp.receiveWhittleDrop(data);
            }
            break;

        // Bidirectional: campfire pile ignited
        case "campfirePileIgnite":
            if (activeCampfireApp?.receivePileIgnite) {
                activeCampfireApp.receivePileIgnite(data);
            }
            break;

        // Bidirectional: campfire whittled item settled (authoritative position sync)
        case "campfireWhittleSettle":
            if (activeCampfireApp?.receiveWhittleSettle) {
                activeCampfireApp.receiveWhittleSettle(data);
            }
            break;

        // Player -> GM: consume firewood from actor inventory
        case "consumeFirewood":
            if (!game.user.isGM) return;
            _handleConsumeFirewood(data);
            break;

        // Player -> GM: toggle campfire token light on canvas
        case "campfireTokenSync":
            if (!game.user.isGM) return;
            CampfireTokenLinker.setLightState(data.lit, data.fireLevel ?? null);
            break;

        // Player -> GM: toggle perimeter torch tokens on canvas
        case "torchTokenSync":
            if (!game.user.isGM) return;
            TorchTokenLinker.setLightState(data.lit);
            break;

        // GM -> All: force all clients to reload (dev tool)
        case "forceReload":
            console.log(`${MODULE_ID} | Received forceReload, refreshing page...`);
            setTimeout(() => window.location.reload(), 200);
            break;

        // Short Rest: GM started short rest
        case "shortRestStarted":
            if (game.user.isGM) return;
            if (data.targetUserId && data.targetUserId !== game.user.id) return;
            _handleShortRestStarted(data);
            break;

        case "shortRestAfkUpdate":
            RestAfkState.applyUpdate(data.characterId, data.isAfk);
            refreshAfterAfkChange();
            break;

        case "shortRestPlayerFinished":
            if (activeShortRestApp?.receivePlayerFinished) {
                activeShortRestApp.receivePlayerFinished(data);
            }
            break;

        case "shortRestSongVolunteer":
            if (activeShortRestApp?.receiveSongVolunteer) {
                activeShortRestApp.receiveSongVolunteer(data);
            }
            break;

        // Short Rest: HD spent (broadcast)
        case "shortRestHdSpent":
            if (activeShortRestApp?.receiveHdSpent) {
                activeShortRestApp.receiveHdSpent(data);
            }
            break;

        // Short Rest: complete
        case "shortRestComplete":
            if (game.user.isGM) return;
            if (activeShortRestApp) {
                ui.notifications.info("Short rest complete. Class features recovered.");
                activeShortRestApp._isTerminating = true;
                activeShortRestApp.close();
                activeShortRestApp = null;
            }
            _removeShortRestRejoinNotification();
            hideAfkPanelAfterRest();
            break;

        // Short Rest: abandoned by GM
        case "shortRestAbandoned":
            if (game.user.isGM) return;
            if (activeShortRestApp) {
                ui.notifications.info("The GM has abandoned the short rest.");
                activeShortRestApp._isTerminating = true;
                activeShortRestApp.close();
                activeShortRestApp = null;
            }
            _removeShortRestRejoinNotification();
            hideAfkPanelAfterRest();
            break;

        // Short Rest: GM dismissed window (rest still active, players close)
        case "shortRestDismissed":
            if (game.user.isGM) return;
            if (activeShortRestApp) {
                activeShortRestApp._isTerminating = true;
                activeShortRestApp.close();
                activeShortRestApp = null;
            }
            _showShortRestRejoinNotification();
            break;

        // Player -> GM: request short rest state (late join / rejoin)
        case "requestShortRestState":
            if (!game.user.isGM) return;
            _handleRequestShortRestState(data);
            break;

        // GM -> Players: butcher opportunity popup
        case "butcherPromptPopup":
            if (game.user.isGM) return;
            if (!isMonsterCookingUnlocked()) return;
            _showButcherPopup(data);
            break;

        // Player -> GM: place camp gear on scene
        case "campGearPlace":
            if (!game.user.isGM) return;
            _handleCampGearPlace(data);
            break;

        case "campStationPlace":
            if (!game.user.isGM) return;
            _handleCampStationPlace(data);
            break;

        // Player -> GM: remove own placed camp gear only
        case "campGearClearPlayer":
            if (!game.user.isGM) return;
            _handleCampGearClearPlayer(data);
            break;

        case "campGearReclaim":
            if (!game.user.isGM) return;
            _handleCampGearReclaim(data);
            break;

        case "campStationReclaim":
            if (!game.user.isGM) return;
            _handleCampStationReclaim(data);
            break;

        // GM -> All: camp gear placed confirmation
        case "campGearPlaced": {
            const campApp = activeRestSetupApp ?? activePlayerRestApp;
            if (campApp) {
                void campApp.render();
                campApp.refreshCanvasStationOverlaysIfActivity?.();
                campApp.refreshOpenStationDialogAfterCampGear?.();
            }
            break;
        }

        case "campStationPlaced": {
            const campAppStation = activeRestSetupApp ?? activePlayerRestApp;
            if (campAppStation) {
                void campAppStation.render();
                campAppStation.refreshCanvasStationOverlaysIfActivity?.();
            }
            break;
        }

        // GM -> All: camp tokens were removed from the scene
        case "campSceneCleared": {
            const campApp2 = activeRestSetupApp ?? activePlayerRestApp;
            if (data.resetFireLevel && campApp2) {
                campApp2._fireLevel = "unlit";
                campApp2._campFirePreviewLevel = null;
                if (campApp2._engine) {
                    campApp2._engine.fireLevel = "unlit";
                    campApp2._engine.fireRollModifier = 0;
                }
            }
            if (campApp2) campApp2.render();
            break;
        }

    }
}

/**
 * Shows an in-your-face butcher opportunity popup to relevant players/GM.
 * Only displays if the current user owns one of the cookbook-holding characters.
 */
function _showButcherPopup(data) {
    if (!isMonsterCookingUnlocked()) return;
    const holderIds = data.holderIds ?? [];

    // Only show to users who own a cookbook holder (or GM)
    if (!game.user.isGM) {
        const ownsHolder = holderIds.some(id => {
            const actor = game.actors.get(id);
            return actor?.ownership?.[game.user.id] >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        });
        if (!ownsHolder) return;
    }

    const tierColors = { common: "#8b8b8b", uncommon: "#1a9c3a", rare: "#4a6de5", legendary: "#c44ade" };
    const tierColor = tierColors[data.tier] ?? tierColors.common;

    const overlay = document.createElement("div");
    overlay.classList.add("ionrift-armor-modal-overlay");
    overlay.style.zIndex = "10001";
    overlay.innerHTML = `
        <div class="ionrift-armor-modal" style="max-width: 420px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
                <img src="${data.creatureImg}" alt="${data.creatureName}"
                     style="width: 64px; height: 64px; border-radius: 8px; border: 2px solid ${tierColor}; object-fit: cover;" />
                <div>
                    <h3 style="margin: 0;"><i class="fas fa-drumstick-bite"></i> Butcher Opportunity</h3>
                    <p style="margin: 2px 0; font-size: 1.1em; font-weight: bold;">${data.creatureName}</p>
                    <span style="background: ${tierColor}; color: #fff; padding: 1px 8px; border-radius: 3px; font-size: 0.8em; text-transform: uppercase;">${data.tier}</span>
                </div>
            </div>
            <p style="font-style: italic; margin: 6px 0; color: #ccc;">${data.flavour}</p>
            <p style="margin: 6px 0;"><strong>Survival DC:</strong> ${data.dc} &nbsp; <strong>CR:</strong> ${data.cr}</p>
            <p style="margin: 6px 0;"><i class="fas fa-book"></i> ${data.holderNames} can butcher this creature.</p>
            <p style="margin: 8px 0; font-size: 0.9em; color: #aaa;">Use the <strong>Butcher</strong> button in chat to attempt the harvest.</p>
            <div class="ionrift-armor-modal-buttons">
                <button class="btn-armor-confirm"><i class="fas fa-check"></i> Got it</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => overlay.remove());

    // Auto-dismiss after 30 seconds
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 30000);
}

/**
 * Player handler: GM started a short rest, open ShortRestApp.
 */
function _handleShortRestStarted(data) {
    _removeShortRestRejoinNotification();
    _removePrepNotification();
    if (activeShortRestApp) {
        activeShortRestApp._isTerminating = true;
        activeShortRestApp.close();
    }
    activeShortRestApp = new ShortRestApp();
    activeShortRestApp.receiveStarted(data);
    activeShortRestApp.render({ force: true });
    showAfkPanel();
}

/**
 * Player handler: GM started a rest, open the shared rest panel.
 */
let activePlayerRestApp = null;
let _playerRestActive = false;

function _handleRestStarted(data) {
    console.log(`${MODULE_ID} | _handleRestStarted called`, data);

    // If targeted to a specific user, ignore if not for us
    if (data.targetUserId && data.targetUserId !== game.user.id) return;

    try {
        _playerRestActive = true;
        _removeRejoinNotification();
        _removeGmRestIndicator();

        // If an old rest window exists, close it gracefully before opening the new one
        if (activePlayerRestApp) {
            // Check if this is a genuinely new rest (different restId) or just a resync
            const isNewRest = !data.restData?.restId ||
                activePlayerRestApp._restId !== data.restData.restId;
            if (!isNewRest) {
                // Same rest, just apply snapshot if provided
                if (data.snapshot && activePlayerRestApp.receiveRestSnapshot) {
                    activePlayerRestApp.receiveRestSnapshot(data.snapshot);
                } else {
                    activePlayerRestApp.render({ force: true });
                }
                showAfkPanel();
                return;
            }
            // New rest: close old window and create fresh
            console.log(`${MODULE_ID} | Closing stale rest window for new rest`);
            ui.notifications.info("The GM has started a new rest. Refreshing your window.");
            activePlayerRestApp.close({ skipRejoin: true });
            activePlayerRestApp = null;
        }

        activePlayerRestApp = new RestSetupApp({}, data.restData);
        // Hook into the close to show rejoin notification and clear the global ref.
        // retainPlayerApp: window hides but the instance stays registered (activity phase canvas UI).
        const origClose = activePlayerRestApp.close.bind(activePlayerRestApp);
        activePlayerRestApp.close = async (options = {}) => {
            try {
                await origClose(options);
            } finally {
                if (options.retainPlayerApp) {
                    console.log(`${MODULE_ID} | Player rest window closed; app ref retained for canvas phase`);
                    if (_playerRestActive && !options.skipRejoin) {
                        _showRejoinNotification(activePlayerRestApp);
                    }
                    return;
                }
                activePlayerRestApp = null;
                if (_playerRestActive && !options.skipRejoin) {
                    _showRejoinNotification();
                }
            }
        };
        console.log(`${MODULE_ID} | RestSetupApp created in player mode, rendering...`);
        activePlayerRestApp.render({ force: true });
        showAfkPanel();

        // Apply embedded snapshot immediately (phase-correct from first render)
        if (data.snapshot && activePlayerRestApp.receiveRestSnapshot) {
            setTimeout(() => {
                activePlayerRestApp.receiveRestSnapshot(data.snapshot);
            }, 300);
        }

        // Open campfire panel alongside the rest window
        setTimeout(() => {
            if (activePlayerRestApp?._openCampfire) {
                console.log(`${MODULE_ID} | Opening campfire for player on rest start`);
                activePlayerRestApp._openCampfire();
            }
        }, 500);
    } catch (err) {
        console.error(`${MODULE_ID} | Error in _handleRestStarted:`, err);
    }
}

/**
 * GM handler: A player submitted their activity choices.
 * Routes to the active RestSetupApp for live display.
 */
function _handleActivityChoice(data) {
    if (!activeRestSetupApp) return;
    activeRestSetupApp.receivePlayerChoices(data.userId, data.choices, data.craftingResults ?? null, data.followUps ?? null);
}

/**
 * Player handler: GM resolved the rest, close the rest panel.
 */
function _handleRestResolved(data) {
    _playerRestActive = false;
    _removeRejoinNotification();
    _removeGmRestIndicator();
    notifyDetectMagicScanCleared();
    if (activePlayerRestApp) {
        activePlayerRestApp.close({ skipRejoin: true });
        activePlayerRestApp = null;
    }
    hideAfkPanelAfterRest();
}

/**
 * Shows a persistent rejoin notification when the player closes the rest window.
 * @param {RestSetupApp} [app] - Active player rest app for phase/progress info.
 */
function _showRejoinNotification(app) {
    _removeRejoinNotification();
    const el = document.createElement("div");
    el.id = "respite-rejoin-bar";
    const phaseLabel = app?._phase ? `Phase: ${app._phase}` : "active";
    const isActivity = app?._phase === "activity";
    const partySize = isActivity ? (getPartyActors().length || 0) : 0;
    const activitiesResolved = isActivity ? (app?._characterChoices?.size ?? 0) : 0;
    const trackFood = isActivity && game.settings.get("ionrift-respite", "trackFood");
    const rationsResolved = trackFood ? (app?._activityMealRationsSubmitted?.size ?? 0) : 0;
    const totalTasks = partySize + (trackFood ? partySize : 0);
    const resolvedTasks = activitiesResolved + rationsResolved;
    const progressHtml = isActivity
        ? `<span class="respite-bar-progress">${resolvedTasks} / ${totalTasks} tasks to complete</span>`
        : "";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Rest in progress (${phaseLabel})</span>
        ${progressHtml}
        <button type="button" id="respite-rejoin-btn">Resume</button>
    `;
    el.querySelector("#respite-rejoin-btn").addEventListener("click", () => {
        _removeRejoinNotification();
        if (app && !app.rendered) {
            app.render({ force: true });
        } else {
            _rejoinRest();
        }
    });
    document.body.appendChild(el);
}

/**
 * Removes the rejoin notification bar.
 */
function _removeRejoinNotification() {
    document.getElementById("respite-rejoin-bar")?.remove();
}

/**
 * Shows a persistent rejoin notification when the player's short rest window
 * is closed but the short rest is still active.
 */
function _showShortRestRejoinNotification() {
    _removeShortRestRejoinNotification();
    const el = document.createElement("div");
    el.id = "respite-short-rest-rejoin-bar";
    el.innerHTML = `
        <i class="fas fa-mug-hot"></i>
        <span>A short rest is in progress.</span>
        <button type="button" id="respite-short-rest-rejoin-btn">Rejoin</button>
    `;
    el.querySelector("#respite-short-rest-rejoin-btn").addEventListener("click", () => {
        _rejoinShortRest();
    });
    document.body.appendChild(el);
}

/**
 * Removes the short rest rejoin notification bar.
 */
function _removeShortRestRejoinNotification() {
    document.getElementById("respite-short-rest-rejoin-bar")?.remove();
}

/**
 * Player rejoins an in-progress short rest by requesting state from the GM.
 */
function _rejoinShortRest() {
    _removeShortRestRejoinNotification();
    game.socket.emit(`module.${MODULE_ID}`, { type: "requestShortRestState", userId: game.user.id });
}

/**
 * GM handler: A player requested short rest state (late join / rejoin).
 * Broadcasts shortRestStarted with full state back to the requesting user.
 */
function _handleRequestShortRestState(data) {
    if (!activeShortRestApp) {
        // No live app — check if persisted state exists in settings (GM may have dismissed window)
        const saved = game.settings.get(MODULE_ID, "activeShortRest");
        if (!saved?.timestamp) return;

        // Re-create the app from saved state, then broadcast
        const app = new ShortRestApp({ initialShelter: saved.activeShelter ?? "none" });
        const restored = app._loadShortRestState();
        if (!restored) return;

        registerActiveShortRestApp(app);
        // Don't render on GM side (window was deliberately closed)
        // Just broadcast state to the requesting player
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "shortRestStarted",
            targetUserId: data.userId ?? null,
            rolls: app._serializeRolls(),
            songBonuses: app._serializeSongBonuses(),
            afkCharacterIds: RestAfkState.getAfkCharacterIds(),
            finishedUserIds: [...app._finishedUsers],
            activeShelter: app._activeShelter,
            rpPrompt: app._rpPrompt,
            songVolunteer: app._songVolunteer,
        });
        return;
    }

    // Live app exists -- broadcast current state to the requesting player
    game.socket.emit(`module.${MODULE_ID}`, {
        type: "shortRestStarted",
        targetUserId: data.userId ?? null,
        rolls: activeShortRestApp._serializeRolls(),
        songBonuses: activeShortRestApp._serializeSongBonuses(),
        afkCharacterIds: RestAfkState.getAfkCharacterIds(),
        finishedUserIds: [...activeShortRestApp._finishedUsers],
        activeShelter: activeShortRestApp._activeShelter,
        rpPrompt: activeShortRestApp._rpPrompt,
        songVolunteer: activeShortRestApp._songVolunteer,
    });
}

/**
 * Shows a "preparing rest" notification when the GM opens the setup wizard.
 */
function _showPrepNotification() {
    _removePrepNotification();
    const el = document.createElement("div");
    el.id = "respite-prep-bar";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Your GM is preparing a rest...</span>
    `;
    document.body.appendChild(el);
}

/**
 * Removes the prep notification bar.
 */
function _removePrepNotification() {
    document.getElementById("respite-prep-bar")?.remove();
}

/**
 * Shows a persistent GM indicator when the rest window is closed but a rest is still active.
 * @param {RestSetupApp} app - The active RestSetupApp instance.
 */
export function _showGmRestIndicator(app) {
    if (!game.user?.isGM) return;
    _removeGmRestIndicator();
    const el = document.createElement("div");
    el.id = "respite-gm-rest-bar";
    const awaitingCombat = app?._awaitingCombat;
    const phaseLabel = awaitingCombat ? "Awaiting combat resolution" : `Phase: ${app?._phase ?? "active"}`;
    const isActivity = app?._phase === "activity";
    const partySize = isActivity ? getPartyActors().length : 0;
    const activitiesResolved = isActivity ? (app?._characterChoices?.size ?? 0) : 0;
    const trackFood = isActivity && game.settings.get("ionrift-respite", "trackFood");
    const rationsResolved = trackFood ? (app?._activityMealRationsSubmitted?.size ?? 0) : 0;
    const totalTasks = partySize + (trackFood ? partySize : 0);
    const resolvedTasks = activitiesResolved + rationsResolved;
    const progressHtml = isActivity
        ? `<span class="respite-bar-progress">${resolvedTasks} / ${totalTasks} tasks to complete</span>`
        : "";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Rest in progress (${phaseLabel})</span>
        ${progressHtml}
        <button type="button" id="respite-gm-resume-btn">${awaitingCombat ? "View" : "Resume"}</button>
    `;
    el.querySelector("#respite-gm-resume-btn").addEventListener("click", () => {
        _removeGmRestIndicator();
        if (app) {
            app._canvasFocusedStationId = null;
            if (!app.rendered) app.render({ force: true });
        }
    });
    document.body.appendChild(el);
}

/**
 * Removes the GM rest indicator bar.
 */
export function _removeGmRestIndicator() {
    document.getElementById("respite-gm-rest-bar")?.remove();
}

/**
 * Shows a persistent GM indicator when the short rest window is closed but the rest persists.
 * The Resume button reconstructs ShortRestApp from the world setting.
 */
export function _showGmShortRestIndicator() {
    if (!game.user?.isGM) return;
    _removeGmShortRestIndicator();
    const el = document.createElement("div");
    el.id = "respite-gm-short-rest-bar";
    el.innerHTML = `
        <i class="fas fa-mug-hot"></i>
        <span>Short rest in progress</span>
        <button type="button" id="respite-gm-short-rest-resume-btn">Resume</button>
    `;
    el.querySelector("#respite-gm-short-rest-resume-btn").addEventListener("click", () => {
        _removeGmShortRestIndicator();
        _resumeGmShortRest();
    });
    document.body.appendChild(el);
}

/**
 * Removes the GM short rest indicator bar.
 */
export function _removeGmShortRestIndicator() {
    document.getElementById("respite-gm-short-rest-bar")?.remove();
}

/**
 * Reconstructs and re-opens the GM short rest app from persisted state.
 */
function _resumeGmShortRest() {
    const saved = game.settings.get(MODULE_ID, "activeShortRest");
    if (!saved?.timestamp) {
        ui.notifications.warn("No short rest state found.");
        respiteFlowActive = false;
        return;
    }
    const app = new ShortRestApp({ initialShelter: saved.activeShelter ?? "none" });
    const restored = app._loadShortRestState();
    if (!restored) {
        ui.notifications.warn("Could not restore short rest state.");
        return;
    }
    registerActiveShortRestApp(app);
    app.render({ force: true });
}

/**
 * Re-requests the current rest state from the GM.
 */
function _rejoinRest() {
    _removeRejoinNotification();
    game.socket.emit(`module.${MODULE_ID}`, { type: "requestRestState", userId: game.user.id });
}

/**
 * Player handler: GM changed phases. Update the player's panel.
 */
function _handlePhaseChanged(data) {
    if (!activePlayerRestApp) return;
    void activePlayerRestApp.receivePhaseChange(data.phase, data.phaseData).catch(err => {
        console.error(`${MODULE_ID} | receivePhaseChange (_handlePhaseChanged)`, err);
    });
}

/**
 * Player handler: Submission status changed. Update the player's panel.
 */
function _handleSubmissionUpdate(data) {
    if (!activePlayerRestApp) return;
    activePlayerRestApp.receiveSubmissionUpdate(data.submissions);
}

/**
 * Bidirectional: AFK status changed. Update whichever long-rest app is active.
 */
function _handleAfkUpdate(data) {
    RestAfkState.applyUpdate(data.characterId, data.isAfk);
    refreshAfterAfkChange();
}

/**
 * Bidirectional: Armor doff/don state changed. Sync to all clients.
 */
function _handleArmorToggle(data) {
    const app = game.user.isGM ? activeRestSetupApp : activePlayerRestApp;
    if (app) {
        app.receiveArmorToggle(data.actorId, data.itemId, data.isDoffed);
    }
}

/**
 * GM handler: A late-joining or rejoining player requested the current rest state.
 * Sends a single restSnapshot with all state, or restStarted + restSnapshot for new connections.
 */
function _handleRequestRestState(data) {
    if (!activeRestData) return;

    const snapshot = activeRestSetupApp?.getRestSnapshot?.() ?? null;
    const requestingUserId = data.userId ?? null;

    // Send restStarted with embedded snapshot so the player initializes at the correct phase
    game.socket.emit(`module.${MODULE_ID}`, {
        type: "restStarted",
        restData: activeRestData,
        snapshot,
        targetUserId: requestingUserId
    });
}

/**
 * GM handler: A player requested firewood consumption from an actor they
 * cannot modify directly. The GM performs the item mutation on their behalf.
 */
async function _handleConsumeFirewood(data) {
    const actor = game.actors.get(data.actorId);
    if (!actor) return;

    const firewood = actor.items.get(data.itemId);
    if (!firewood) return;

    const qty = firewood.system?.quantity ?? 1;
    if (qty <= 1) {
        await firewood.delete();
    } else {
        await firewood.update({ "system.quantity": qty - 1 });
    }
    console.log(`${MODULE_ID} | GM consumed firewood for ${actor.name} (remaining: ${qty - 1})`);
}

/**
 * GM handler: a player requested camp gear placement on the scene.
 * GM creates the token on their behalf and broadcasts confirmation.
 */
async function _handleCampGearPlace(data) {
    const { actorId, gearType, x, y } = data;
    if (!actorId || !gearType || x == null || y == null) return;

    const placed = await placePlayerGear(x, y, gearType, actorId);
    if (placed) {
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campGearPlaced",
            actorId,
            gearType
        });
        if (activeRestSetupApp) {
            void activeRestSetupApp.render();
            activeRestSetupApp.refreshCanvasStationOverlaysIfActivity?.();
        }
    }
}

/**
 * GM handler: a player requested placement of a shared camp station.
 */
async function _handleCampStationPlace(data) {
    const { actorId, stationKey, x, y, userId } = data;
    if (!actorId || !stationKey || x == null || y == null || !userId) return;

    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;

    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campStationPlace rejected (not owner)`);
        return;
    }
    if (!canPlaceStation(actor, stationKey)) {
        ui.notifications.warn("That character cannot place this station.");
        return;
    }

    const placed = await placeStation(x, y, stationKey);
    if (placed) {
        game.socket.emit(`module.${MODULE_ID}`, { type: "campStationPlaced" });
        if (activeRestSetupApp) {
            void activeRestSetupApp.render();
            activeRestSetupApp.refreshCanvasStationOverlaysIfActivity?.();
        }
        void activePlayerRestApp?.render();
    }
}

/**
 * GM handler: a player asked to pick up one deployed camp gear token.
 */
async function _handleCampGearReclaim(data) {
    const { actorId, gearType, userId, sceneId } = data;
    if (!actorId || !gearType || !userId) return;

    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;

    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campGearReclaim rejected (not owner)`);
        return;
    }

    const n = await clearPlayerCampGearType(actorId, gearType, sceneId ?? null);
    if (n > 0) {
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campGearPlaced",
            actorId,
            gearType
        });
    }
    activeRestSetupApp?.render();
    activePlayerRestApp?.render();
}

/**
 * GM handler: a player asked to remove a shared camp station from the scene.
 */
async function _handleCampStationReclaim(data) {
    const { actorId, stationKey, userId } = data;
    if (!actorId || !stationKey || !userId) return;

    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;

    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campStationReclaim rejected (not owner)`);
        return;
    }
    if (!canPlaceStation(actor, stationKey)) {
        ui.notifications.warn("That character cannot pick up this station.");
        return;
    }

    const n = await clearSharedCampStation(stationKey);
    if (n > 0) {
        game.socket.emit(`module.${MODULE_ID}`, { type: "campStationPlaced" });
    } else {
        ui.notifications.info("Nothing to pick up on the scene for that station.");
    }
    activeRestSetupApp?.render();
    activePlayerRestApp?.render();
}

/**
 * GM: player asked to remove their own tent, bedroll, and mess kit tokens.
 */
async function _handleCampGearClearPlayer(data) {
    const { actorId, userId, sceneId } = data;
    if (!actorId || !userId) return;

    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;

    if (!actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
        console.warn(`${MODULE_ID} | campGearClearPlayer rejected (not owner)`);
        return;
    }

    const n = await clearPlayerCampGear(actorId, sceneId ?? null);
    if (n > 0) {
        game.socket.emit(`module.${MODULE_ID}`, { type: "campSceneCleared", actorId });
    }
    activeRestSetupApp?.render();
    activePlayerRestApp?.render();
}
