import { Logger as RespiteLog } from "./lib/Logger.js";
import { RestFlowEngine } from "./services/RestFlowEngine.js";
import { ActivityResolver } from "./services/ActivityResolver.js";
import { EventResolver } from "./services/EventResolver.js";
import { ResourcePoolRoller } from "./services/ResourcePoolRoller.js";
import { CalendarHandler } from "./services/CalendarHandler.js";
import { TerrainRegistry } from "./services/TerrainRegistry.js";
import { RestSetupApp } from "./apps/RestSetupApp.js";
import { ShortRestApp } from "./apps/ShortRestApp.js";
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
import { ImageResolver } from "./util/ImageResolver.js";
import { ItemClassifier } from "./services/ItemClassifier.js";
import { DietConfigApp } from "./apps/DietConfigApp.js";
import { AfkPanelApp } from "./apps/AfkPanelApp.js";
import * as RestAfkState from "./services/RestAfkState.js";
import {
    setRestSessionAfkEmitter,
    setAfkUiRefresh
} from "./services/restSessionAfkEmit.js";
import {
    initAfkBridge,
    reconcileFromAdapters
} from "./services/afk/AfkBridgeService.js";
import { MealPhaseHandler } from "./services/MealPhaseHandler.js";
import {
    setDetectMagicInventoryGlowAdapter,
    getDetectMagicInventoryGlowAdapter
} from "./services/DetectMagicInventoryGlowBridge.js";
import {
    emitForceReload,
    emitRequestRestState,
    emitRequestShortRestState,
    emitRestStarted,
    emitRestSnapshot,
    emitRestResolved,
    emitShortRestAbandoned,
    emitShortRestAfkUpdate,
    emitAfkUpdate,
} from "./services/SocketController.js";
import { registerAllSettings, registerItemEnrichments } from "./services/SettingsRegistrar.js";
import {
    buildRollRequestContext,
    buildEventPlayerRollContext,
    buildEventGmRollContext,
    buildTreePlayerRollContext,
    buildCampActivityRollContext,
    buildTravelActivityRollContext,
    buildCopySpellRollContext,
    buildMockRollRequestContext,
    buildRollParticipants,
    buildRollTargetLabel,
    sortRollParticipants,
    layoutRollParticipants,
    findPreviewPlayerActor,
    centerRollRequestRoster,
    ROLL_REQUEST_PREVIEW_VARIANTS
} from "./services/RollRequestView.js";
import {
    ensureDcPulseAnimation,
    inspectDcAnimation,
    watchDcAnimation,
    forceDcPulseTest
} from "./services/RollRequestDcPulse.js";
import { RollRequestPreviewApp } from "./apps/RollRequestPreviewApp.js";
import { registerUiHooks, refreshZzzOverlay } from "./services/UiInjections.js";
import { registerSpoilageMergeGuard } from "./services/SpoilageMergeGuard.js";
import { registerInventoryContextMenu } from "./services/InventoryContextMenu.js";
import { registerLockdownHooks } from "./services/PlayerLockdownService.js";
import {
    showRejoinNotification, removeRejoinNotification,
    showShortRestRejoinNotification, removeShortRestRejoinNotification,
    showGmRestIndicator, removeGmRestIndicator, refreshGmRestIndicator,
    refreshRejoinBar,
    showGmShortRestIndicator, removeGmShortRestIndicator
} from "./services/RejoinManager.js";
import { dispatch as socketDispatch } from "./services/SocketRouter.js";
import { isNativeShortRestUnsuppressed } from "./services/NativeRestPass.js";

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

// Active short rest app reference for socket routing.
let activeShortRestApp = null;

// Active player rest app reference for socket routing.
let activePlayerRestApp = null;

/** Active TotM campfire minigame embed (socket sync for whittle, sticks, emotes). */
let activeCampfireEmbed = null;

// Tracks whether a player-side rest flow is currently active.
let _playerRestActive = false;

/**
 * Registers the active CampfireEmbed for socket routing.
 * @param {import("./apps/CampfireEmbed.js").CampfireEmbed|null} embed
 */
export function registerCampfireEmbed(embed) {
    activeCampfireEmbed = embed;
}

/** Clears the active CampfireEmbed reference. */
export function clearCampfireEmbed() {
    activeCampfireEmbed = null;
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
    clearCampfireEmbed();
    respiteFlowActive = false;
    _removeGmRestIndicator();
    hideAfkPanelAfterRest();
}

/**
 * Keeps the GM RestSetupApp ref alive when the app closes to the footer indicator
 * during the activity phase. The rest is still active; the ref is needed for
 * handleRequestRestState to build snapshots for late-joining players.
 *
 * Does not clear activeRestData or activeRestSetupApp.
 * Only called from RestSetupApp.close({ retainGmRestApp: true }).
 */
export function retainGmRestAppFooter() {
    // respiteFlowActive stays true; rest is still running.
    // activeRestSetupApp and activeRestData are intentionally left intact.
    _removeGmRestIndicator();
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



/** @type {AfkPanelApp|null} */
let activeAfkPanel = null;

/**
 * Shows the persistent AFK panel during an active rest (long or short).
 */
export function showAfkPanel() {
    reconcileFromAdapters();
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
    if (shortOnly) {
        emitShortRestAfkUpdate(characterId, isAfk);
    } else {
        emitAfkUpdate(characterId, isAfk);
    }
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
    RespiteLog.log(`${MODULE_ID} | Initializing...`);
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
    // Shared comfort-tier explanation. Used as a tooltip wherever a comfort badge
    // renders, so the mechanical meaning travels with the label.
    Handlebars.registerHelper("comfortHint", (tier) => {
        const map = {
            safe: "Safe: full HP and Hit Dice back. No risk of a night event.",
            sheltered: "Sheltered: full HP and Hit Dice back. A normal night.",
            rough: "Rough: full HP, 1 fewer Hit Die back. CON save DC 10 or +1 exhaustion.",
            hostile: "Hostile: regain 75% of max HP from the rest, 2 fewer Hit Dice back. Existing exhaustion sticks. CON save DC 15 or +1 exhaustion."
        };
        return map[typeof tier === "string" ? tier.toLowerCase() : tier] ?? "Rest comfort affects HP and Hit Dice recovery.";
    });
    Handlebars.registerHelper("fireTierPlain", (id) => {
        const map = {
            embers: "No cooking. No comfort change.",
            campfire: "Cooking and warmth. Easier for enemies to spot (higher encounter chance).",
            bonfire: "+1 camp comfort. Visible from far off; enemies spot the camp easily."
        };
        return map[typeof id === "string" ? id : ""] ?? "";
    });

    // Register partials
    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/roster-strip.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/roster-strip.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("rosterStrip", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load roster-strip partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/workbench-identify-embed.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/workbench-identify-embed.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("workbenchIdentifyEmbed", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load workbench identify partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/workbench-identify-panel.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/workbench-identify-panel.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("workbenchIdentifyPanel", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load workbench identify panel partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/activity-portraits.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/activity-portraits.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("activityPortraits", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load activity-portraits partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/fire-tier-picker.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/fire-tier-picker.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("fireTierPicker", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load fire-tier-picker partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/fire-tier-body.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/fire-tier-body.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("fireTierBody", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load fire-tier-body partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/craft-commit-panel.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/craft-commit-panel.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("craftCommitPanel", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load craft-commit-panel partial:`, e));

    foundry.applications.handlebars.loadTemplates(["modules/ionrift-respite/templates/partials/_training-panel.hbs"]);
    fetch("modules/ionrift-respite/templates/partials/_training-panel.hbs")
        .then(r => r.text())
        .then(t => Handlebars.registerPartial("trainingPanel", t))
        .catch(e => console.warn(`${MODULE_ID} | Failed to load training-panel partial:`, e));

    // Expose API
    const adapter = createAdapter();
    game.ionrift = game.ionrift || {};
    game.ionrift.respite = {
        adapter,
        rollRequest: {
            buildContext: buildRollRequestContext,
            buildEventPlayerContext: buildEventPlayerRollContext,
            buildEventGmContext: buildEventGmRollContext,
            buildTreePlayerContext: buildTreePlayerRollContext,
            buildCampActivityContext: buildCampActivityRollContext,
            buildTravelActivityContext: buildTravelActivityRollContext,
            buildCopySpellContext: buildCopySpellRollContext,
            buildParticipants: buildRollParticipants,
            sortParticipants: sortRollParticipants,
            layoutParticipants: layoutRollParticipants,
            centerRoster: centerRollRequestRoster,
            findPreviewPlayerActor,
            buildTargetLabel: buildRollTargetLabel,
            buildMockContext: buildMockRollRequestContext,
            variants: ROLL_REQUEST_PREVIEW_VARIANTS,
            partial: "rollRequest",
            openPreview: (options) => RollRequestPreviewApp.open(options),
            ensureDcPulse: ensureDcPulseAnimation,
            debugAnimation: inspectDcAnimation,
            watchAnimation: watchDcAnimation,
            forceDcPulseTest,
            request: (opts) => game.ionrift?.library?.rollRequest?.request?.(opts),
            requestDetached: (opts, callback) => game.ionrift?.library?.rollRequest?.requestDetached?.(opts, callback)
        },
        RestFlowEngine,
        ActivityResolver,
        EventResolver,
        ResourcePoolRoller,
        openRestSetup: () => {
            if (!game.user.isGM) return;
            new RestSetupApp().render({ force: true });
        },
        /**
         * Console diagnostic: rebuild and dump travel forage/hunt pools for a terrain.
         * Run as: await game.ionrift.respite.dumpTravelPools("forest")
         * @param {string} [terrain]
         * @returns {Promise<object>}
         */
        dumpTravelPools: async (terrain = "forest") => {
            const app = foundry.applications.instances.get("ionrift-respite-setup");
            const resolver = app?._travel?.getTravelResolver?.();
            if (!resolver) {
                console.warn(`${MODULE_ID} | dumpTravelPools: open Make Camp first.`);
                return { error: "no active rest" };
            }
            const { applyTravelProvisionBatches } = await import("./services/TravelProvisionIndex.js");
            const loaded = await applyTravelProvisionBatches(resolver);

            const forageKey = `${terrain}_forage`;
            const huntKey = `${terrain}_hunt`;
            const roller = resolver.resourcePoolRoller;
            const resPool = roller.pools.get(`resource_pool_${terrain}`);
            const { ForageTableSync } = await import("./services/ForageTableSync.js");
            const forageTable = ForageTableSync.getTableForTerrain(terrain);
            const report = {
                terrain,
                batches: loaded.batches.map(b => ({ packId: b.packId, count: [...(b.entries ?? [])].length })),
                basePoolCoverage: resolver.basePoolCoverage,
                forageBaseEntries: resolver.getBasePoolEntries(forageKey),
                huntBaseEntries: resolver.getBasePoolEntries(huntKey),
                resourcePoolEntries: (resPool?.entries ?? []).map(e => ({
                    itemRef: e.itemRef,
                    hasItemData: !!e.itemData,
                    name: e.itemData?.name ?? null
                })),
                forageTable: forageTable ? {
                    name: forageTable.name,
                    formula: forageTable.formula,
                    resultCount: forageTable.results?.size ?? 0,
                    results: Array.from(forageTable.results ?? []).map(r => ({
                        itemRef: r.getFlag?.("ionrift-respite", "itemRef") ?? r.text,
                        weight: r.weight,
                        range: r.range
                    }))
                } : null
            };
            console.log(`${MODULE_ID} | Travel pool dump for "${terrain}":`, report);
            return report;
        },
        /**
         * Rebuild forage RollTables from compendium folders (GM).
         * @returns {Promise<object>}
         */
        syncForageTables: async () => {
            if (!game.user?.isGM) return { error: "gm only" };
            const { ForageTableSync } = await import("./services/ForageTableSync.js");
            return await ForageTableSync.syncAll({ notify: true });
        },
        /**
         * Open the camp fuel roll table (5% trigger; kindling 1-100 when rolled). Observer access.
         * @returns {Promise<boolean>}
         */
        openCampFuelTable: async () => {
            const { CampFuelTableSync } = await import("./services/CampFuelTableSync.js");
            return await CampFuelTableSync.openSheet();
        },
        /**
         * Open the forage roll table for a terrain tag. All users with observer access.
         * @param {string} [terrain]
         * @returns {Promise<boolean>}
         */
        openForageTable: async (terrain = "forest") => {
            const { ForageTableSync } = await import("./services/ForageTableSync.js");
            const table = ForageTableSync.getTableForTerrain(terrain);
            if (!table) {
                ui.notifications.warn(`Respite: No forage table for "${terrain}".`);
                return false;
            }
            await table.sheet.render({ force: true });
            return true;
        },
        /**
         * Opens a Respite guide journal from compendium packs.
         * Player and cooking pages live in respite-guide (PLAYER: OBSERVER).
         * GM reference lives in respite-guide-gm (GAMEMASTER: OWNER).
         *
         * @param {string} [pageId] - Optional page _id to jump to.
         * @returns {Promise<void>}
         */
        openPlayerGuide: async (pageId) => {
            const GUIDE_PAGES = {
                player: "aQc3PtQPrYDi9Mlx",
                gm: "dvr4TYdYmX88MCCf",
                cooking: "cK8pRQdW2nFb4Xvj",
                training: "mN8kTrXpGmRef001",
            };
            const GUIDE_JOURNALS = {
                player: "1Zh2gDQ1xOLFUrhW",
                gm: "hG4mR3fRespGuide01",
            };

            const isGM = game.user?.isGM;
            let packName;
            let journalId;
            let focusPageId;

            if (!isGM) {
                packName = `${MODULE_ID}.respite-guide`;
                journalId = GUIDE_JOURNALS.player;
                focusPageId = pageId === GUIDE_PAGES.cooking
                    ? GUIDE_PAGES.cooking
                    : GUIDE_PAGES.player;
            } else if (!pageId || pageId === GUIDE_PAGES.gm || pageId === GUIDE_PAGES.training) {
                packName = `${MODULE_ID}.respite-guide-gm`;
                journalId = GUIDE_JOURNALS.gm;
                focusPageId = pageId === GUIDE_PAGES.training ? GUIDE_PAGES.training : GUIDE_PAGES.gm;
            } else {
                packName = `${MODULE_ID}.respite-guide`;
                journalId = GUIDE_JOURNALS.player;
                focusPageId = pageId;
            }

            const pack = game.packs.get(packName);
            if (!pack) {
                ui.notifications?.warn("Respite: guide compendium not available.");
                return;
            }
            try {
                const journal = await pack.getDocument(journalId);
                if (!journal) {
                    ui.notifications?.warn("Respite: guide journal not found in compendium.");
                    return;
                }
                const opts = focusPageId ? { pageId: focusPageId } : {};
                journal.sheet.render(true, opts);
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to open player guide:`, e);
                ui.notifications?.error("Respite: failed to open the player guide. See console.");
            }
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
            emitForceReload();
            RespiteLog.log(`${MODULE_ID} | Sent forceReload to all clients. GM reloading in 500ms...`);
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
            RespiteLog.log(results);
            return results;
        },
        /** Write LINK_PACKS to cmd.txt for the DevTools CommandListener. */
        linkPacks: async () => {
            if (!game.user.isGM) return;
            const file = new File(["LINK_PACKS"], "cmd.txt", { type: "text/plain" });
                const FP = game.ionrift?.library?.platform?.FP ?? FilePicker;
                await FP.upload("data", "ionrift_debug", file, { notify: false });
            ui.notifications.info("LINK_PACKS command sent. Waiting for DevTools to execute...");
        },
        /** Write UNLINK_PACKS to cmd.txt for the DevTools CommandListener. */
        unlinkPacks: async () => {
            if (!game.user.isGM) return;
            const file = new File(["UNLINK_PACKS"], "cmd.txt", { type: "text/plain" });
                const FP = game.ionrift?.library?.platform?.FP ?? FilePicker;
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
                    RespiteLog.log(`${MODULE_ID} | resetFlowState removed ${removed} camp or torch token(s) from the active scene.`);
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | resetFlowState camp cleanup failed:`, e);
            } finally {
                resetCampSession();
            }
            await game.settings.set(MODULE_ID, "activeRest", {});
            await game.settings.set(MODULE_ID, "activeShortRest", {});
            await game.settings.set(MODULE_ID, "lastRestDate", "");
            emitForceReload();
            ui.notifications.info("Rest state cleared. Reloading...");
            setTimeout(() => window.location.reload(), 500);
        },
        /** Item Enrichment: delegates to ionrift-library kernel (backward compat). */
        getItemEnrichment: (itemName) => game.ionrift?.library?.enrichment?.get(itemName) ?? null,
        /** Item Enrichment: returns all registered enrichment names (debug). */
        getEnrichmentNames: () => game.ionrift?.library?.enrichment?.getRegisteredNames() ?? [],
        /** Item classification: unified food/water/fuel classification. */
        ItemClassifier,
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
        /** Apply a preset diet. Usage: game.ionrift.respite.applyDietPreset(actor, "construct") */
        applyDietPreset: (actor, presetId) => ItemClassifier.applyPreset(actor, presetId),
        /** List available diet presets. Usage: game.ionrift.respite.getDietPresets() */
        getDietPresets: () => ItemClassifier.getPresets(),

        // â”€â”€ Camp Prop Placement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        TorchTokenLinker,
        /** Whether a Respite rest flow (long or short) is currently active. Used by PlayerLockdownService. */
        get isRestActive() { return respiteFlowActive; }
    };

    // Register settings (extracted to SettingsRegistrar.js â€” Phase 2.1)
    registerAllSettings({
        PackRegistryApp,
        DietConfigApp,
        onAmbientAfkChange: (value) => {
            if (value) void showAfkPanel();
            else if (!respiteFlowActive) hideAfkPanel();
        }
    });

    // Register Respite-specific item enrichments with the shared library engine.
    registerItemEnrichments();

    // Register Core Art Pack nudge with the shared library service so the
    // Settings panel surfaces it alongside the in-app camp-phase nudge.
    try {
        const { registerArtPackNudge } = await import("./artPackNudge.js");
        registerArtPackNudge();
    } catch (e) {
        console.warn(`${MODULE_ID} | Art pack nudge registration failed:`, e);
    }
});

Hooks.on("ionrift.overlayContentChanged", async (detail) => {
    if (detail?.moduleId !== MODULE_ID) return;

    // Art overlay
    if (detail.overlayId === "respite-core-overlay") {
        const disabled = !detail.installed || !detail.active;
        await game.settings.set(MODULE_ID, "artPackDisabled", disabled);
        await ImageResolver.init();
        return;
    }

    // Terrain art supplements (Frost & Stone, Bone & Dust). These overlays also
    // gate which terrains the local registry surfaces, so it has to re-evaluate
    // every time their active state changes.
    if (detail.overlayId === "respite-frost-stone-overlay" || detail.overlayId === "respite-bone-dust-overlay") {
        await ImageResolver.init();
        try {
            const { TerrainRegistry } = await import("./services/TerrainRegistry.js");
            TerrainRegistry.reset();
            await TerrainRegistry.init();
        } catch (e) {
            console.warn(`${MODULE_ID} | Terrain registry reset failed:`, e);
        }
        return;
    }

    // Event/content overlay: invalidate cached event and recipe data.
    // The next rest start or browser open will re-scan overlays.
    try {
        const { OverlayEventLoader } = await import("./services/OverlayEventLoader.js");
        OverlayEventLoader.invalidate();
    } catch { /* loader not available */ }
    try {
        const { OverlayProfessionLoader } = await import("./services/OverlayProfessionLoader.js");
        OverlayProfessionLoader.invalidate();
    } catch { /* loader not available */ }
    RespiteLog.log(`${MODULE_ID} | Overlay content changed: ${detail.overlayId} (active=${detail.active})`);
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

    const startRest = () => {
        if (!_canStartRest()) return;
        new RestSetupApp().render({ force: true });
    };

    const toolDef = {
        name: "respite",
        title: "Begin Rest (Respite)",
        icon: "fas fa-campground",
        button: true
    };

    // v13 uses an object map for tools with onChange(event, active); v12 uses
    // an array with onClick.
    if (Array.isArray(tokenGroup.tools)) {
        toolDef.onClick = startRest;
        tokenGroup.tools.push(toolDef);
    } else {
        toolDef.order = Object.keys(tokenGroup.tools).length;
        toolDef.visible = true;
        toolDef.onChange = startRest;
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

// â”€â”€ Actor Sheet Injections (extracted to UiInjections.js â€” Phase 2.3) â”€â”€â”€â”€
registerUiHooks();

// ── Inventory Context Menu (Consume at Camp) ───────────────────────────
registerInventoryContextMenu();

// â”€â”€ Calendar-Driven Spoilage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            const actors = game.ionrift?.library?.party?.getMembers() ?? [];
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

// â”€â”€ Monster Cooking: Chat Card Button Wiring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// [CARVED OUT, WS-6] Monster Cooking chat card wiring removed for v2.0.
// Archived: ionrift-brand/Assets/Archived/butcher_system/REINTEGRATION.md
// [CARVED OUT - WS-6] Monster Cooking chat card wiring removed for v2.0.
// See: ionrift-brand/Assets/Archived/butcher_system/REINTEGRATION.md


// Item Enrichment hooks are now wired by ionrift-library (ItemEnrichmentEngine).
// Respite enrichment data is registered in the init hook below via registerBatch().

// Zzz overlay extracted to UiInjections.js â€” Phase 2.3
// _refreshZzzOverlay is imported at the top of this file.

Hooks.once("ready", async () => {
    RespiteLog.log(`${MODULE_ID} | Ready hook firing...`);
    Logger.log?.(MODULE_LABEL, "Ready.");

    // Initialize image resolver (art pack detection â€” probes ionrift-data/)
    await ImageResolver.init();

    const { guardLinkedCompendiumOutputDelete } = await import("./services/RecipeOutputCompendium.js");
    Hooks.on("preDeleteItem", (item, options, userId) => {
        if (userId !== game.user?.id) return;
        return guardLinkedCompendiumOutputDelete(item, options);
    });

    const refreshOpenRestSetup = () => {
        if (activeRestSetupApp?.rendered) activeRestSetupApp.render();
    };
    Hooks.on("ionrift.partyChanged", refreshOpenRestSetup);
    Hooks.on("updateActor", (actor, changes) => {
        const partyId = game.actors?.party?.id;
        if (partyId && actor.id === partyId && foundry.utils.hasProperty(changes, "system.members")) {
            refreshOpenRestSetup();
        }
    });

    // Initialize terrain registry early so data is available before first rest.
    // The registry is Respite-local under strict sovereignty: nothing is pushed
    // into the shared library spine, and other modules are expected to build
    // their own view on top of `game.ionrift.library.terrains.getBase()`.
    await TerrainRegistry.init();

    const { initializeEventPoolIfNeeded } = await import("./services/EventPoolMigration.js");
    await initializeEventPoolIfNeeded();

    // Materialise active overlay item payloads into world compendiums and
    // register them with the travel pipeline before the provision index loads,
    // so an enabled overlay's forage/hunt items are picked up on this boot.
    if (game.user?.isGM) {
        try {
            const { migrateBolsteringTreatIcons } = await import("./services/RecipeIcons.js");
            await migrateBolsteringTreatIcons();
        } catch (e) {
            console.warn(`${MODULE_ID} | Bolstering treat icon migration failed on ready:`, e);
        }

        try {
            const { ProvisionOverlayMaterialiser } = await import("./services/ProvisionOverlayMaterialiser.js");
            await ProvisionOverlayMaterialiser.materialiseAll();
        } catch (e) {
            console.warn(`${MODULE_ID} | Overlay item materialisation failed on ready:`, e);
        }
    }

    try {
        const { loadTravelProvisionBatches } = await import("./services/TravelProvisionIndex.js");
        const { PROVISIONS_CUSTOM_PACK_ID } = await import("./services/ProvisionsCustomPack.js");
        if (game.ionrift?.respite) {
            const loaded = await loadTravelProvisionBatches();
            game.ionrift.respite.travelProvisionBatches = loaded.batches;
            game.ionrift.respite.travelBasePoolIndex = loaded.batches[0]?.entries ?? null;
            game.ionrift.respite.travelFolderPathMap = loaded.batches[0]?.folderPathMap ?? null;
            game.ionrift.respite.provisionsCustomPackId = PROVISIONS_CUSTOM_PACK_ID;

            let forageCount = 0;
            let huntCount = 0;
            for (const batch of loaded.batches) {
                for (const entry of batch.entries) {
                    const cat = entry.flags?.[MODULE_ID]?.category;
                    if (cat === "forage") forageCount++;
                    if (cat === "hunt") huntCount++;
                }
            }
            RespiteLog.log(
                `${MODULE_ID} | Travel provision index: ${loaded.totalEntries} items`
                + ` (${forageCount} forage, ${huntCount} hunt flags; folders also qualify)`
            );
            if (forageCount === 0 && loaded.batches.length <= 1) {
                console.warn(
                    `${MODULE_ID} | No forage items in respite-items compendium.`
                    + " Camp forage will rely on content pack pools only."
                );
            }
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | Failed to load travel provision indexes:`, e);
    }

    if (game.user?.isGM) {
        try {
            const { ForageTableInstaller } = await import("./services/ForageTableInstaller.js");
            const { ForageTableSync } = await import("./services/ForageTableSync.js");
            ForageTableSync.registerHooks();
            await ForageTableInstaller.install();
        } catch (e) {
            console.warn(`${MODULE_ID} | Forage table sync failed on ready:`, e);
        }

        // Re-materialise overlay items and resync forage tables when a GM
        // enables, disables, or uninstalls a Respite overlay in the Library.
        Hooks.on("ionrift.overlayContentChanged", async (detail) => {
            try {
                const { ProvisionOverlayMaterialiser } = await import("./services/ProvisionOverlayMaterialiser.js");
                await ProvisionOverlayMaterialiser.onOverlayContentChanged(detail);
            } catch (e) {
                console.warn(`${MODULE_ID} | Overlay content change handling failed:`, e);
            }
        });

        // Migration: strip the retired registry-injection profession previews.
        // Profession content now ships via disk overlays, not the importedPacks
        // registry, so remove any preview-flagged entries seeded by older builds.
        try {
            const imported = game.settings.get(MODULE_ID, "importedPacks") ?? {};
            const enabled = game.settings.get(MODULE_ID, "enabledPacks") ?? {};
            let changed = false;
            for (const [id, data] of Object.entries(imported)) {
                if (data?.preview === true) {
                    delete imported[id];
                    delete enabled[id];
                    changed = true;
                }
            }
            if (changed) {
                await game.settings.set(MODULE_ID, "importedPacks", imported);
                await game.settings.set(MODULE_ID, "enabledPacks", enabled);
                RespiteLog.log(`${MODULE_ID} | Removed retired profession preview packs from registry.`);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Profession preview cleanup failed on ready:`, e);
        }

        // Surface the disk-staged profession overlays in the Patreon Library via
        // the library's local dev registry. Display metadata only; the content
        // itself loads from disk through OverlayProfessionLoader. Lets the GM
        // toggle them in the overlay UI for local e2e without a registry publish.
        try {
            const settingExists = game.settings.settings.has("ionrift-library.devOverlayRegistry");
            if (settingExists) {
                const PREVIEW_OVERLAYS = {
                    "respite-cooking-overlay": {
                        latest: "0.1.0", tier: "Free", sublayer: "cooking", moduleId: MODULE_ID,
                        minModuleVersion: "3.0.0", packLabel: "Core Cooking Pack (preview)",
                        description: "Cooking recipes. Free tier."
                    },
                    "respite-subscriber-overlay": {
                        latest: "0.1.0", tier: "Initiate", sublayer: "subscriber", moduleId: MODULE_ID,
                        minModuleVersion: "3.0.0", packLabel: "Profession Catalogues (preview)",
                        description: "Brewing, tailoring, and leatherworking recipes. Subscriber tier."
                    },
                    "respite-premium-overlay": {
                        latest: "0.1.0", tier: "Acolyte", sublayer: "premium", moduleId: MODULE_ID,
                        minModuleVersion: "3.0.0", packLabel: "Delicious Dungeon (preview)",
                        description: "Monster harvesting and exotic recipes. Premium tier."
                    }
                };
                const current = game.settings.get("ionrift-library", "devOverlayRegistry") ?? {};
                const merged = { ...current, ...PREVIEW_OVERLAYS };
                if (JSON.stringify(current) !== JSON.stringify(merged)) {
                    await game.settings.set("ionrift-library", "devOverlayRegistry", merged);
                    RespiteLog.log(`${MODULE_ID} | Registered profession preview overlays in the library dev registry.`);
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Dev overlay registration failed on ready:`, e);
        }
    }

    // Register socket handler (dispatch extracted to SocketRouter.js — Phase 2.2)
    const socketContext = {
        get activeRestSetupApp() {
            // Self-heal: if the GM reference was lost (e.g. a render post-step
            // threw and an older build cleared it) but the rest sheet is still
            // mounted, recover the live instance so player→GM sockets keep
            // landing instead of silently dropping.
            if (!activeRestSetupApp && game.user?.isGM) {
                const live = foundry.applications.instances.get("ionrift-respite-setup");
                if (live && !live._terminated) {
                    activeRestSetupApp = live;
                }
            }
            return activeRestSetupApp;
        },
        get activePlayerRestApp() { return activePlayerRestApp; },
        get activeShortRestApp() { return activeShortRestApp; },
        get activeCampfireEmbed() { return activeCampfireEmbed; },
        get playerRestActive() { return _playerRestActive; },
        get activeRestData() { return activeRestData; },
        setActivePlayerRestApp(v) { activePlayerRestApp = v; },
        setActiveShortRestApp(v) { activeShortRestApp = v; },
        setPlayerRestActive(v) { _playerRestActive = v; },
        registerActiveShortRestApp(app) { registerActiveShortRestApp(app); },
        showAfkPanel() { showAfkPanel(); },
        hideAfkPanelAfterRest() { hideAfkPanelAfterRest(); },
    };
    game.socket.on(`module.${MODULE_ID}`, (data) => socketDispatch(data, socketContext));

    registerCampFurnitureZOrderGuards();
    registerLockdownHooks();
    registerSpoilageMergeGuard();

    // Zzz overlay on tokens for characters bedded down during reflection.
    Hooks.on("refreshToken", (token) => {
        try {
            refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });
    // Flag-only updates (e.g. beddingDown) do not always trigger a token refresh on
    // all clients; sync the overlay when respite token flags change.
    Hooks.on("updateToken", (tokenDoc, change, _options, _userId) => {
        try {
            if (!change.flags?.[MODULE_ID]) return;
            const token = tokenDoc.object;
            if (!token) return;
            refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });
    Hooks.on("createToken", (token) => {
        try {
            refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });
    Hooks.on("canvasReady", () => {
        try {
            const placeables = canvas.tokens?.placeables;
            if (!placeables?.length) return;
            for (const token of placeables) {
                refreshZzzOverlay(token);
            }
        } catch {
            /* ignore */
        }
    });

    /** Block manual deletion of camp layout tokens during a rest (use Move fire in the rest window). */
    Hooks.on("preDeleteToken", (document, options, userId) => {
        try {
            if (options?.ionriftAllowCampDelete) return;
            const f = document.flags?.[MODULE_ID];
            if (!f?.isCampFurniture || f.isPlayerGear) return;
            const user = game.users.get(userId);
            if (user?.isGM) {
                ui.notifications.warn("Use Move fire in the Respite window to relocate the campfire and stations.");
            } else {
                ui.notifications.warn("Camp layout tokens cannot be deleted during a rest.");
            }
            return false;
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
            RespiteLog.log(`${MODULE_ID} | Player requesting rest state (${label})...`);
            emitRequestRestState(game.user.id);
            emitRequestShortRestState(game.user.id);
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
                    RespiteLog.log(`${MODULE_ID} | Tab visible, resyncing rest state...`);
                    emitRequestRestState(game.user.id);
                }
                if (activeShortRestApp) {
                    RespiteLog.log(`${MODULE_ID} | Tab visible, resyncing short rest state...`);
                    emitRequestShortRestState(game.user.id);
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

    // â”€â”€ PF2e Early-Support Advisory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            // Graceful fail â€” don't block startup for an advisory
        }
    }

    // â”€â”€ Session Recovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
                    registerActiveRestApp(app);
                    const restPayload = {
                        restId: savedRest.restId ?? `rest_${savedRest.timestamp ?? Date.now()}`,
                        terrainTag: app._engine?.terrainTag,
                        comfort: app._engine?.comfort,
                        restType: app._engine?.restType,
                        phase: app._phase,
                        fireLevel: app._fireLevel ?? "unlit",
                        coldCampDecided: !!app._coldCampDecided,
                        safeRestSpot: !!app._engine?.safeRestSpot,
                        tavernTotmOverride: !!app._tavernTotmOverride,
                        activities: app._activities ?? [],
                        recipes: app._craftingEngine?.recipes
                            ? Object.fromEntries(app._craftingEngine.recipes)
                            : {}
                    };
                    app._restId = restPayload.restId;
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
                            const snapshot = app.getRestSnapshot?.() ?? null;
                            emitRestStarted(restPayload, snapshot ? { snapshot } : {});
                            if (snapshot) {
                                setTimeout(() => emitRestSnapshot(snapshot), 200);
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
            emitRestResolved();
            clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on discard failed:`, err));
            resetCampSession();
            Logger.log?.(MODULE_LABEL, "Discarded interrupted rest.");
        }
    }

    // â”€â”€ Short Rest Session Recovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            emitShortRestAbandoned();
            Logger.log?.(MODULE_LABEL, "Discarded interrupted short rest.");
        }
    }

    // â”€â”€ Combat Blocking Hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Monster Cooking: Butcher Prompt after Combat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€



    _maybeShowAmbientAfkPanelAtReady();

    initAfkBridge();

    RespiteLog.log(`${MODULE_ID} | Boot complete.`);
    if (game.user.isGM) {
        RespiteLog.log("  → game.ionrift.respite.rollRequest.openPreview()");
        RespiteLog.log("  → game.ionrift.respite.rollRequest.debugAnimation()");
        RespiteLog.log("  → game.ionrift.respite.rollRequest.watchAnimation()");
        RespiteLog.log("  → game.ionrift.respite.rollRequest.forceDcPulseTest()");
    }
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
 * Funnel a rest initiated on the primary party group actor into the Respite
 * flow instead of the system's native group rest. From Foundry v14 the party
 * is a native group actor whose sheet exposes Short/Long Rest buttons; those
 * call initiateRest on the group, firing dnd5e.preShortRest / preLongRest.
 * Returning false there cancels the native group rest. Only the designated
 * primary party is intercepted, and only for the GM (players are handled by
 * _blockPlayerRest). Individual actor rests are left to the system.
 * @param {Actor} actor - The actor being rested.
 * @param {"short"|"long"} type - Rest length.
 * @returns {boolean} false to cancel the native rest.
 */
function _interceptPartyRest(actor, type) {
    if (actor?.type !== "group") return true;
    const party = game.actors?.party;
    if (!party || actor.id !== party.id) return true;
    if (!game.user.isGM) return true;
    if (!game.settings.get(MODULE_ID, "interceptRests")) return true;

    // Cancel the native group rest regardless; only launch when one can start.
    if (_canStartRest()) {
        if (type === "long") new RestSetupApp().render({ force: true });
        else new ShortRestApp().render({ force: true });
    }
    return false;
}

Hooks.on("dnd5e.preShortRest", (actor) => _interceptPartyRest(actor, "short"));
Hooks.on("dnd5e.preLongRest", (actor) => _interceptPartyRest(actor, "long"));

/**
 * DnD5e rest hook: suppress default HP/HD recovery when Respite is managing it.
 * This fires BEFORE the system applies its own recovery.
 * We zero out HP and HD restoration so the system doesn't double-apply.
 * Spell slots, class features, and other recharges are left untouched.
 */
Hooks.on("dnd5e.preRestCompleted", (actor, result, config) => {
    if (!respiteFlowActive) return true;
    if (isNativeShortRestUnsuppressed()) return true;

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

// â”€â”€ Socket dispatch extracted to SocketRouter.js â€” Phase 2.2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// _onSocketMessage, _handleRestStarted, _handleActivityChoice,
// _handleRestResolved, _handleShortRestStarted, _showButcherPopup,
// and all _handle* functions now live in SocketRouter.js / SocketRouterHandlers.js.
//
// Keeping this comment block as a tombstone for git blame navigation.

/**
 * Shows a persistent rejoin notification when the player closes the rest window.
 * @param {RestSetupApp} [app] - Active player rest app for phase/progress info.
 */
/**
 * Shows a persistent rejoin notification when the player closes the rest window.
 * Delegates to RejoinManager (Phase 2.4).
 */
function _showRejoinNotification(app) {
    showRejoinNotification(app, _rejoinRest);
}

/**
 * Removes the player rejoin bar. Re-exported for RestSetupApp to use
 * when auto-opening the player window on post-activity phase transitions.
 */
export function _removeRejoinBar() {
    removeRejoinNotification();
}

/**
 * Shows a persistent short rest rejoin notification.
 * Delegates to RejoinManager (Phase 2.4).
 */
function _showShortRestRejoinNotification() {
    showShortRestRejoinNotification(_rejoinShortRest);
}

/** @deprecated Use removeShortRestRejoinNotification() directly. */
function _removeShortRestRejoinNotification() {
    removeShortRestRejoinNotification();
}

/**
 * Player rejoins an in-progress short rest by requesting state from the GM.
 */
function _rejoinShortRest() {
    removeShortRestRejoinNotification();
    emitRequestShortRestState(game.user.id);
}


/**
 * Shows a persistent GM indicator when the rest window is closed but a rest is still active.
 * Re-exported for external consumers.
 */
export function _showGmRestIndicator(app) {
    showGmRestIndicator(app);
}

/** Re-exported for external consumers. */
export function _removeGmRestIndicator() {
    removeGmRestIndicator();
}

/**
 * Refreshes the task-count span in the existing GM rest bar in-place.
 * Call whenever _characterChoices changes while the bar is visible.
 */
export function _refreshGmRestIndicator(app) {
    refreshGmRestIndicator(app);
}

/**
 * Refreshes the task-count span in the existing player rejoin bar in-place.
 * Call whenever _characterChoices changes while the bar is visible.
 */
export function _refreshRejoinBar(app) {
    refreshRejoinBar(app);
}

/**
 * Ensures the player rejoin bar is visible. If it already exists, refreshes it.
 * If it doesn't exist, creates it. Call this after phase transitions where the
 * player RSA may not be rendered but the rest is still active.
 * @param {object} app - The active player RestSetupApp instance.
 */
export function _ensureRejoinBar(app) {
    const existing = document.getElementById("respite-rejoin-bar");
    if (existing) {
        // Bar exists; update the phase label and progress
        const phaseSpan = existing.querySelector("span:not(.respite-bar-progress)");
        if (phaseSpan) phaseSpan.textContent = `Rest in progress (Phase: ${app?._phase ?? "active"})`;
        refreshRejoinBar(app);
        return;
    }
    // Bar doesn't exist; create it
    showRejoinNotification(app, _rejoinRest);
}

/**
 * Shows a persistent GM indicator when the short rest window is closed.
 * Re-exported for external consumers.
 */
export function _showGmShortRestIndicator() {
    showGmShortRestIndicator(_resumeGmShortRest);
}

/** Re-exported for external consumers. */
export function _removeGmShortRestIndicator() {
    removeGmShortRestIndicator();
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
    removeRejoinNotification();
    emitRequestRestState(game.user.id);
}

