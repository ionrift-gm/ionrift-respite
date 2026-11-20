import { registerReadyTokenAndResumeFlow, registerDnd5eRestHooks, registerPf2eRestHooks } from "./composition/RespiteBootAndRestHooks.js";
import { Logger as RespiteLog } from "./utils/Logger.js";
import { CalendarHandler } from "./services/rest/session/CalendarHandler.js";
import { TerrainRegistry } from "./services/events/resolve/TerrainRegistry.js";
import { RestSetupApp } from "./apps/rest/RestSetupApp.js";
import { RestSetupDebugJumps } from "./apps/delegates/rest/debug/RestSetupDebugJumps.js";
import { ShortRestApp } from "./apps/rest/ShortRestApp.js";
import { BivouacApp } from "./apps/bivouac/BivouacApp.js";
import { DowntimeLedgerApp } from "./apps/downtime/DowntimeLedgerApp.js";
import {
    clearCampTokens,
    resetCampSession,
    registerCampFurnitureZOrderGuards,
    clampCampFloorTokenInPreUpdate
} from "./services/camp/props/CompoundCampPlacer.js";

import { createRespiteContext } from "./composition/createRespiteContext.js";
import { ImageResolver } from "./utils/ImageResolver.js";
import { DietConfigApp } from "./apps/meal/DietConfigApp.js";
import * as RestAfkState from "./services/rest/session/RestAfkState.js";
import {
    setRestSessionAfkEmitter,
    setAfkUiRefresh
} from "./services/rest/session/restSessionAfkEmit.js";
import { initAfkBridge } from "./services/afk/AfkBridgeService.js";
import { MealPhaseHandler } from "./services/meal/phase/MealPhaseHandler.js";
import {
    emitRequestRestState,
    emitRestStarted,
    emitRestSnapshot,
    emitRestResolved,
    emitAfkUpdate,
    registerSocketListener
} from "./services/socket/SocketController.js";
import { registerAllSettings, registerItemEnrichments } from "./services/ui/settings/SettingsRegistrar.js";
import { registerUiHooks, refreshZzzOverlay, refreshSpoilageBadgesOnOpenSheets } from "./services/ui/sheet/UiInjections.js";
import { registerSpoilageMergeGuard } from "./services/meal/spoilage/SpoilageMergeGuard.js";
import { registerSpoilageGrantHook } from "./services/meal/spoilage/SpoilageGrantHook.js";
import { syncPartyCohortSuffixes } from "./services/meal/spoilage/SpoilageCohortSync.js";
import { registerInventoryContextMenu } from "./services/ui/sheet/InventoryContextMenu.js";
import { registerLockdownHooks } from "./services/ui/sheet/PlayerLockdownService.js";
import {
    showRejoinNotification, removeRejoinNotification,
    showShortRestRejoinNotification, removeShortRestRejoinNotification,
    showGmRestIndicator, removeGmRestIndicator, refreshGmRestIndicator,
    refreshRejoinBar,
    showGmShortRestIndicator, removeGmShortRestIndicator
} from "./services/ui/sheet/RejoinManager.js";
import { dispatch as socketDispatch } from "./services/socket/SocketRouter.js";
import { isNativeShortRestUnsuppressed } from "./services/rest/flow/NativeRestPass.js";
import { reassertMealExhaustionFloor } from "./services/meal/phase/MealExhaustionGuard.js";
import { getActiveRestSessionApp, emitRestSessionAbandoned } from "./services/rest/session/RestSessionSync.js";
import { clearAllBeddingPoses } from "./services/rest/session/BeddingPose.js";
import { MODULE_ID, MODULE_LABEL } from "./data/moduleId.js";

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

/** Active TotM campfire minigame embed (socket sync). */
let activeCampfireEmbed = null;

let _playerRestActive = false;

/** @param {import("./apps/camp/CampfireEmbed.js").CampfireEmbed|null} embed */
export function registerCampfireEmbed(embed) {
    activeCampfireEmbed = embed;
}

export function clearCampfireEmbed() {
    activeCampfireEmbed = null;
}

function _notifyRestStateChanged() {
    try {
        const active = Boolean(
            respiteFlowActive
            || _playerRestActive
            || activeRestSetupApp
            || activePlayerRestApp
            || activeShortRestApp
            || getActiveRestSessionApp?.("bivouac")
            || getActiveRestSessionApp?.("downtime")
        );
        Hooks?.callAll?.("ionrift.respiteRestStateChanged", { active });
    } catch { /* ignore */ }
}

export function registerActiveRestApp(app) {
    activeRestSetupApp = app;
    respiteFlowActive = true;
    _notifyRestStateChanged();
}

export function setActiveRestData(data) {
    activeRestData = data;
}

export function clearActiveRestApp() {
    activeRestSetupApp = null;
    activeRestData = null;
    clearCampfireEmbed();
    respiteFlowActive = false;
    _removeGmRestIndicator();
    hideAfkPanelAfterRest();
    _notifyRestStateChanged();
}

/**
 * Keep GM RestSetupApp ref when closing to the footer indicator during activity.
 * Rest stays active; needed for handleRequestRestState late-join snapshots.
 * Only from RestSetupApp.close({ retainGmRestApp: true }).
 */
export function retainGmRestAppFooter() {
    _removeGmRestIndicator();
}

export function registerActiveShortRestApp(app) {
    activeShortRestApp = app;
    respiteFlowActive = true;
    _notifyRestStateChanged();
}

export function clearActiveShortRestApp() {
    activeShortRestApp = null;
    respiteFlowActive = false;
    _notifyRestStateChanged();
}

export function notifyShortRestActive() {
    _showShortRestRejoinNotification();
}

export function setRespiteFlowActive(active) {
    respiteFlowActive = Boolean(active);
    _notifyRestStateChanged();
}

/** @type {object|null} */
let activeAfkPanel = null;

/**
 * Parked. The AFK strip is unfit and stays closed until it is revised.
 * Callers may still invoke this; it only dismisses a panel that is already open.
 */
export function showAfkPanel() {
    if (!activeAfkPanel) return;
    activeAfkPanel.close();
    activeAfkPanel = null;
}

export function hideAfkPanel() {
    if (activeAfkPanel) {
        activeAfkPanel.close();
        activeAfkPanel = null;
    }
    RestAfkState.clear();
}

/** AFK status uses one channel for every rest mode. */
export function emitAfkSocket(characterId, isAfk) {
    emitAfkUpdate(characterId, isAfk);
}

/**
 * @returns {boolean}
 */
function _ambientAfkHudWorldEnabled() {
    return false;
}

/** After rest ends: clear AFK, then ambient HUD if the world allows it. */
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
 * Guard active flow and calendar one-rest-per-day.
 * @param {"long"|"short"} [restType="long"] - Only long rests are limited to once per day.
 * @returns {boolean}
 */
function _revealInProgressRest() {
    if (!game.user?.isGM) return;
    if (document.getElementById("respite-gm-resume-btn") || document.getElementById("respite-gm-short-rest-resume-btn")) return;

    if (activeRestSetupApp) {
        if (activeRestSetupApp.rendered) {
            activeRestSetupApp.bringToFront?.();
            return;
        }
        _showGmRestIndicator(activeRestSetupApp);
        return;
    }
    if (activeShortRestApp && !activeShortRestApp.rendered) {
        _showGmShortRestIndicator();
        return;
    }
    const gritty = getActiveRestSessionApp?.("downtime") || getActiveRestSessionApp?.("bivouac");
    if (gritty && !gritty.rendered) {
        _showGmRestIndicator(gritty);
        return;
    }
    try {
        const savedShort = game.settings.get(MODULE_ID, "activeShortRest");
        if (savedShort?.timestamp) {
            _showGmShortRestIndicator();
            return;
        }
        const savedGritty = game.settings.get(MODULE_ID, "activeGrittyRest");
        if (savedGritty?.type) {
            _showGmRestIndicator({
                _phase: savedGritty.type,
                render() {
                    const app = savedGritty.type === "bivouac"
                        ? new BivouacApp(savedGritty)
                        : new DowntimeLedgerApp(savedGritty);
                    app._rehydrate?.(savedGritty);
                    app.render({ force: true });
                }
            });
        }
    } catch { /* settings not registered yet */ }
}

function _canStartRest(restType = "long") {
    const hasResumeIndicator = Boolean(
        document.getElementById("respite-gm-resume-btn")
        || document.getElementById("respite-gm-short-rest-resume-btn")
    );

    const renderedApp = (activeRestSetupApp?.rendered ? activeRestSetupApp : null)
        || (activeShortRestApp?.rendered ? activeShortRestApp : null)
        || (getActiveRestSessionApp?.("downtime")?.rendered ? getActiveRestSessionApp("downtime") : null)
        || (getActiveRestSessionApp?.("bivouac")?.rendered ? getActiveRestSessionApp("bivouac") : null);

    if (renderedApp) {
        renderedApp.bringToFront?.();
        ui.notifications.warn(game.i18n.localize("ionrift-respite.restStart.alreadyInProgress"));
        return false;
    }

    if (hasResumeIndicator) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.restStart.inProgressUseResume"));
        return false;
    }

    // If respiteFlowActive is true or world settings have residual keys, but no UI is running and no indicator exists,
    // this is an orphaned/ghost state (e.g. from an abandoned rest or interrupted session). Self-heal immediately.
    if (respiteFlowActive) {
        clearActiveRestApp();
        clearActiveShortRestApp();
        respiteFlowActive = false;
    }

    try {
        const savedLong = game.settings.get(MODULE_ID, "activeRest");
        const savedShort = game.settings.get(MODULE_ID, "activeShortRest");
        const savedGritty = game.settings.get(MODULE_ID, "activeGrittyRest");
        if (savedLong?.engine || savedShort?.timestamp || savedGritty?.type) {
            game.settings.set(MODULE_ID, "activeRest", {}).catch(() => {});
            game.settings.set(MODULE_ID, "activeShortRest", {}).catch(() => {});
            game.settings.set(MODULE_ID, "activeGrittyRest", {}).catch(() => {});
        }
    } catch { /* settings not registered yet */ }

    // Calendar: 1 long rest per in-game day (short rests are unlimited per RAW)
    if (restType === "long" && CalendarHandler.hasRestedToday()) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.restStart.alreadyRestedToday"));
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
        const map = {
            next_rest: game.i18n.localize("ionrift-respite.helpers.duration.nextRest"),
            end_of_rest: game.i18n.localize("ionrift-respite.helpers.duration.endOfRest"),
            "1_hour": game.i18n.localize("ionrift-respite.helpers.duration.oneHour"),
            "8_hours": game.i18n.localize("ionrift-respite.helpers.duration.eightHours"),
            permanent: game.i18n.localize("ionrift-respite.helpers.duration.permanent")
        };
        return typeof d === "string" ? (map[d] ?? d.replace(/_/g, " ")) : d;
    });
    // Shared comfort-tier explanation. Used as a tooltip wherever a comfort badge
    // renders, so the mechanical meaning travels with the label.
    Handlebars.registerHelper("comfortHint", (tier) => {
        const map = {
            safe: game.i18n.localize("ionrift-respite.helpers.comfortHint.safe"),
            sheltered: game.i18n.localize("ionrift-respite.helpers.comfortHint.sheltered"),
            rough: game.i18n.localize("ionrift-respite.helpers.comfortHint.rough"),
            hostile: game.i18n.localize("ionrift-respite.helpers.comfortHint.hostile")
        };
        return map[typeof tier === "string" ? tier.toLowerCase() : tier] ?? game.i18n.localize("ionrift-respite.helpers.comfortHint.fallback");
    });
    Handlebars.registerHelper("fireTierPlain", (id) => {
        const map = {
            embers: game.i18n.localize("ionrift-respite.helpers.fireTierPlain.embers"),
            campfire: game.i18n.localize("ionrift-respite.helpers.fireTierPlain.campfire"),
            bonfire: game.i18n.localize("ionrift-respite.helpers.fireTierPlain.bonfire")
        };
        return map[typeof id === "string" ? id : ""] ?? "";
    });

    // Register partials through loadTemplates only. Raw fetch text resolves even
    // for a CDN error page (Cloudflare 524 on Forge) and would become the partial.
    const partials = {};
    const _registerPartial = (file, name) => {
        partials[name] = `modules/ionrift-respite/templates/partials/${file}`;
    };
    _registerPartial("roster-strip.hbs", "rosterStrip");
    _registerPartial("workbench-identify-embed.hbs", "workbenchIdentifyEmbed");
    _registerPartial("workbench-identify-panel.hbs", "workbenchIdentifyPanel");
    _registerPartial("activity-portraits.hbs", "activityPortraits");
    _registerPartial("fire-tier-picker.hbs", "fireTierPicker");
    _registerPartial("fire-tier-body.hbs", "fireTierBody");
    _registerPartial("_training-panel.hbs", "trainingPanel");
    _registerPartial("craft-commit-panel.hbs", "craftCommitPanel");
    _registerPartial("camp-logistics-drawer.hbs", "campLogisticsDrawer");
    _registerPartial("encounter-draft-footer.hbs", "encounterDraftFooter");
    _registerPartial("daily-sustenance-pips.hbs", "dailySustenancePips");
    _registerPartial("workflow-stepper.hbs", "workflowStepper");
    _registerPartial("terrain-banner.hbs", "terrainBanner");
    _registerPartial("rest-header.hbs", "restHeader");
    _registerPartial("rest-footer.hbs", "restFooter");
    _registerPartial("encounter-dc-stepper.hbs", "encounterDcStepper");
    _registerPartial("encounter-threshold.hbs", "encounterThreshold");
    _registerPartial("meal-body.hbs", "mealBody");
    _registerPartial("campfire-drag-handle.hbs", "campfireDragHandle");
    _registerPartial("rest-hero-card.hbs", "restHeroCard");
    _registerPartial("rest-dock.hbs", "restDock");
    _registerPartial("dawn-exhaustion-stage.hbs", "dawnExhaustionStage");
    _registerPartial("meal-buff-beat.hbs", "mealBuffBeat");
    _registerPartial("rest-companion-deck.hbs", "restCompanionDeck");
    _registerPartial("rest-gm-party-deck.hbs", "restGmPartyDeck");
    _registerPartial("sustenance-diegetic.hbs", "sustenanceDiegetic");
    _registerPartial("sustenance-card-foot.hbs", "sustenanceCardFoot");
    _registerPartial("rest-fire-rail.hbs", "restFireRail");
    _registerPartial("rest-sustenance-with-fire.hbs", "restSustenanceWithFire");
    _registerPartial("rest-examine-with-fire.hbs", "restExamineWithFire");
    _registerPartial("rest-choice-with-fire.hbs", "restChoiceWithFire");
    _registerPartial("rest-choice-picker.hbs", "restChoicePicker");
    _registerPartial("rest-step-commit.hbs", "restStepCommit");
    _registerPartial("downtime-activity-stations.hbs", "downtimeActivityStations");
    foundry.applications.handlebars.loadTemplates(partials)
        .catch(e => console.warn(`${MODULE_ID} | Failed to load partials:`, e));

    // Expose API via composition root
    const respiteRuntime = {
        get respiteFlowActive() { return respiteFlowActive; },
        set respiteFlowActive(v) { respiteFlowActive = v; _notifyRestStateChanged(); },
        get playerRestActive() { return _playerRestActive; },
        set playerRestActive(v) { _playerRestActive = Boolean(v); _notifyRestStateChanged(); },
        get activeRestSetupApp() { return activeRestSetupApp; },
        set activeRestSetupApp(v) { activeRestSetupApp = v; _notifyRestStateChanged(); },
        get activePlayerRestApp() { return activePlayerRestApp; },
        set activePlayerRestApp(v) { activePlayerRestApp = v; _notifyRestStateChanged(); },
        get activeRestData() { return activeRestData; },
        set activeRestData(v) { activeRestData = v; },
        get activeShortRestApp() { return activeShortRestApp; },
        set activeShortRestApp(v) { activeShortRestApp = v; _notifyRestStateChanged(); },
        getActiveRestSessionApp,
        hideAfkPanel
    };
    createRespiteContext(respiteRuntime);
    game.ionrift.respite.fillRestParty = () => RestSetupDebugJumps.fillRestParty();

    registerAllSettings({
        DietConfigApp,
        onAmbientAfkChange: () => {
            if (!respiteFlowActive) hideAfkPanel();
        }
    });

    // Register Respite-specific item enrichments with the shared library engine.
    registerItemEnrichments();

});

// ── Custom terrain import listeners ───────────────────────────────────
Hooks.on("ionrift.terrainImported", (data) => {
    // Register a custom terrain stub so the Respite picker shows it.
    // If the import included a respite section with full comfort/weather/events,
    // a future pass can store and use that data. For now, the stub is correct
    // behavior: the terrain appears in the picker with "(custom)" and a note
    // that travel/forage are off until a terrain pack is installed.
    if (data?.id) {
        TerrainRegistry.syncCustomTerrains([data.id]);
    }
});

Hooks.on("ionrift.terrainRemoved", (id) => {
    // Remove the custom stub if it exists. The picker will stop showing it
    // after the next render.
    if (id && TerrainRegistry._customTerrains.has(id)) {
        TerrainRegistry._customTerrains.delete(id);
    }
});

Hooks.on("ionrift.overlayContentChanged", async (detail) => {
    if (detail?.moduleId !== MODULE_ID) return;

    try {
        const { OverlayProfessionLoader } = await import("./services/packs/overlays/OverlayProfessionLoader.js");
        OverlayProfessionLoader.invalidate();
    } catch { /* loader not available */ }

    try {
        const { ProvisionOverlayMaterialiser } = await import("./services/meal/provisions/ProvisionOverlayMaterialiser.js");
        await ProvisionOverlayMaterialiser.onOverlayContentChanged(detail);
    } catch (err) {
        console.warn(`${MODULE_ID} | Overlay materialiser update failed:`, err);
    }

    // Installed art may have changed with any overlay. Re-scan, then sync
    // item icons against whatever art is now present.
    try {
        await ImageResolver.init();
        const { ItemArtSync } = await import("./services/art/ItemArtSync.js");
        await ItemArtSync.apply();
    } catch (e) {
        console.warn(`${MODULE_ID} | Art refresh failed:`, e);
    }

    // Any overlay may add or remove events, disasters, or terrains. Refresh
    // all of them generically so no pack id is special-cased here.
    try {
        const { OverlayEventLoader } = await import("./services/packs/overlays/OverlayEventLoader.js");
        OverlayEventLoader.invalidate();
    } catch { /* loader not available */ }
    try {
        const { TerrainRegistry } = await import("./services/events/resolve/TerrainRegistry.js");
        TerrainRegistry.reset();
        await TerrainRegistry.init();
    } catch (e) {
        console.warn(`${MODULE_ID} | Terrain registry reset failed:`, e);
    }
    RespiteLog.log(`${MODULE_ID} | Overlay content changed: ${detail.overlayId} (active=${detail.active})`);
});

// Players read overlays through the GM-published index. When it changes,
// drop everything discovered from it so terrains and packs match the GM.
Hooks.on("ionrift.overlayIndexChanged", async () => {
    try {
        const { OverlayProfessionLoader } = await import("./services/packs/overlays/OverlayProfessionLoader.js");
        OverlayProfessionLoader.invalidate();
    } catch { /* loader not available */ }
    try {
        const { OverlayEventLoader } = await import("./services/packs/overlays/OverlayEventLoader.js");
        OverlayEventLoader.invalidate();
    } catch { /* loader not available */ }
    try {
        const { TerrainRegistry } = await import("./services/events/resolve/TerrainRegistry.js");
        TerrainRegistry.reset();
        await TerrainRegistry.init();
    } catch (e) {
        console.warn(`${MODULE_ID} | Terrain registry reset failed:`, e);
    }
});

// Scene Controls: Campfire button in the token controls group
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM || !controls) return;

    const startRest = () => {
        if (!_canStartRest()) return;
        new RestSetupApp().render({ force: true });
    };

    if (game.ionrift?.hud?.registerSceneControl) {
        game.ionrift.hud.registerSceneControl(controls, {
            group: "tokens",
            name: "respite",
            title: game.i18n.localize("ionrift-respite.sceneControl.beginRest"),
            icon: "fas fa-campground",
            order: 10,
            onClick: startRest
        });
        return;
    }

    // Foundry v13+: controls is an object with named groups (controls.tokens)
    // Foundry v12:  controls is an array, use .find()
    const tokenGroup = Array.isArray(controls)
        ? controls.find(c => c.name === "token" || c.name === "tokens")
        : (controls.tokens || controls.token);
    if (!tokenGroup) return;

    const toolDef = {
        name: "respite",
        title: game.i18n.localize("ionrift-respite.sceneControl.beginRest"),
        icon: "fas fa-campground",
        button: true,
        order: 10
    };

    // v13 uses an object map for tools with onChange(event, active); v12 uses
    // an array with onClick.
    if (Array.isArray(tokenGroup.tools)) {
        toolDef.onClick = startRest;
        tokenGroup.tools.push(toolDef);
    } else {
        toolDef.visible = true;
        toolDef.onChange = startRest;
        tokenGroup.tools[toolDef.name] = toolDef;
    }
});

// Chat commands: /respite, /bivouac, /downtime
Hooks.on("chatMessage", (log, message, _chatData) => {
    if (!game.user.isGM) return;
    const msg = message.trim().toLowerCase();

    if (msg === "/bivouac") {
        if (game.ionrift?.respite?.adapter?.supportsShortRest === false) {
            ui.notifications.info(game.i18n.localize("ionrift-respite.chatCommand.shortRestsNotUsed"));
            return false;
        }
        if (!_canStartRest("short")) return false;
        new RestSetupApp({ restType: "short" }).render({ force: true });
        return false;
    }
    if (msg === "/downtime") {
        if (!_canStartRest("long")) return false;
        new RestSetupApp({ restType: "long" }).render({ force: true });
        return false;
    }
    if (msg === "/respite") {
        if (!_canStartRest("long")) return false;
        new RestSetupApp().render({ force: true });
        return false;
    }
});

registerUiHooks();

registerInventoryContextMenu();

// When in-game time advances (Simple Calendar or core worldTime), check all
// party member inventories for perishable items that have expired based on
// their harvestedDate. Replaces spoiled items with "Spoiled Food" and posts
// spoilage chat (public card + GM whisper) via MealSpoilageService.
{
    let _spoilageDebounce = null;

    function _scheduleSpoilageTick() {
        if (_spoilageDebounce) clearTimeout(_spoilageDebounce);
        _spoilageDebounce = setTimeout(() => _runSpoilageTick(), 2000);
    }

    Hooks.on("updateWorldTime", () => {
        _scheduleSpoilageTick();
    });

    // Simple Calendar fires its own date change hook
    Hooks.on("simple-calendar-date-time-change", () => {
        _scheduleSpoilageTick();
    });

    // Calendaria fires its own date/time change hook
    Hooks.on("calendaria.dateTimeChange", () => {
        _scheduleSpoilageTick();
    });

    async function _runSpoilageTick() {
        _spoilageDebounce = null;

        refreshSpoilageBadgesOnOpenSheets();

        if (!game.user.isGM) return;

        try {
            const actors = game.ionrift?.library?.party?.getMembers() ?? [];
            if (!actors.length) return;

            await syncPartyCohortSuffixes(actors);

            const report = await MealPhaseHandler.resolveCalendarSpoilage(actors);

            if (report.length) {
                const totalSpoiled = report.reduce(
                    (sum, r) => sum + r.spoiled.reduce((s, i) => s + i.qty, 0), 0
                );
                Logger?.log?.(MODULE_LABEL, `Calendar spoilage: ${totalSpoiled} items spoiled across ${report.length} characters.`);
            }

            for (const actor of actors) {
                try {
                    actor?.sheet?.render(false);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Calendar spoilage sheet refresh failed:`, e);
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Calendar spoilage check failed:`, e);
        }
    }
}

// [CARVED OUT, WS-6] Monster Cooking chat card wiring removed for v2.0.
// Archived: ionrift-brand/Assets/Archived/butcher_system/REINTEGRATION.md

// Item Enrichment hooks are now wired by ionrift-library (ItemEnrichmentEngine).
// Respite enrichment data is registered in the init hook below via registerBatch().

// _refreshZzzOverlay is imported at the top of this file.

Hooks.once("ready", async () => {
    RespiteLog.log(`${MODULE_ID} | Ready hook firing...`);
    Logger.log?.(MODULE_LABEL, "Ready.");

    // Register Respite's Well Fed serve with the shared cooking abstraction so
    // serveDish routes communal feeding and the single shared slot through
    // Respite. Additive; no-op when the kernel has no cooking namespace.
    try {
        MealPhaseHandler.registerFeedProvider();
    } catch (e) {
        console.warn(`${MODULE_ID} | Cooking feed provider registration failed:`, e);
    }

    // ImageResolver, TerrainRegistry, and EventPoolMigration have no
    // interdependencies. Running them concurrently instead of sequentially
    // eliminates the largest single-thread bottleneck (was ~10s serial).
    const initPhase1 = [
        ImageResolver.init().catch(err => {
            console.warn(`${MODULE_ID} | ImageResolver init failed:`, err);
        }),
        TerrainRegistry.init().catch(err => {
            console.warn(`${MODULE_ID} | TerrainRegistry init failed:`, err);
        }),
        import("./services/events/catalog/EventPoolMigration.js")
            .then(({ initializeEventPoolIfNeeded }) => initializeEventPoolIfNeeded())
            .catch(err => {
                console.warn(`${MODULE_ID} | EventPoolMigration failed:`, err);
            })
    ];
    await Promise.allSettled(initPhase1);

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

    // Provision materialiser, meal buff presets/handlers, and profession
    // plugins are all independent of each other. Running them concurrently
    // instead of sequentially saves ~15s on worlds with overlay content.
    if (game.user.isGM) {
        const mealBuffRegistry = await import("./services/meal/buffs/MealBuffHandlerRegistry.js");
        const professionRegistry = await import("./services/packs/registry/ProfessionPluginRegistry.js");

        const gmPhase2 = [
            import("./services/meal/provisions/ProvisionOverlayMaterialiser.js")
                .then(({ ProvisionOverlayMaterialiser }) => ProvisionOverlayMaterialiser.materialiseAll())
                .catch(err => {
                    console.error(`${MODULE_ID} | Overlay provision materialisation failed:`, err);
                }),
            import("./services/packs/overlays/OverlayMealBuffPresetLoader.js")
                .then(({ OverlayMealBuffPresetLoader }) => OverlayMealBuffPresetLoader.loadAll())
                .catch(err => {
                    console.warn(`${MODULE_ID} | Meal buff preset loader failed:`, err);
                }),
            import("./services/packs/overlays/OverlayMealBuffHandlerLoader.js")
                .then(({ OverlayMealBuffHandlerLoader }) => OverlayMealBuffHandlerLoader.loadAll())
                .catch(err => {
                    console.warn(`${MODULE_ID} | Overlay meal buff handler loader failed:`, err);
                }),
            import("./services/packs/overlays/OverlayProfessionPluginLoader.js")
                .then(({ OverlayProfessionPluginLoader }) => OverlayProfessionPluginLoader.loadAll())
                .catch(err => {
                    console.warn(`${MODULE_ID} | Profession pack plugin loaders failed:`, err);
                })
        ];
        await Promise.allSettled(gmPhase2);

        // Expose APIs now that all loaders have settled
        game.ionrift.respite.mealBuffHandlers = {
            get: mealBuffRegistry.getMealBuffHandler,
            list: mealBuffRegistry.listMealBuffHandlers,
            dispatch: mealBuffRegistry.dispatchMealBuffHandler
        };
        game.ionrift.respite.professionPlugins = {
            get: professionRegistry.getProfessionPlugin,
            list: professionRegistry.listProfessionPlugins
        };

        const { ForageTableSync } = await import("./services/travel/forage/ForageTableSync.js");
        ForageTableSync.registerHooks();
        void ForageTableSync.lockDownRollTableVisibility().catch(err => {
            console.error(`${MODULE_ID} | Roll table lockdown failed:`, err);
        });
        ForageTableSync.scheduleSync();
    }

    try {
        const respiteItemsPack = game.packs.get("ionrift-respite.respite-items");
        if (respiteItemsPack && game.ionrift?.respite) {
            game.ionrift.respite.travelBasePoolIndex = await respiteItemsPack.getIndex({
                fields: ["flags", "name", "img", "type", "system"]
            });
            const idx = game.ionrift.respite.travelBasePoolIndex;
            const forageCount = [...(idx ?? [])].filter(
                e => e.flags?.[MODULE_ID]?.category === "forage"
            ).length;
            const huntCount = [...(idx ?? [])].filter(
                e => e.flags?.[MODULE_ID]?.category === "hunt"
            ).length;
            RespiteLog.log(`${MODULE_ID} | Base pool index: ${idx?.size ?? 0} items, ${forageCount} forage, ${huntCount} hunt`);
            if (forageCount === 0) {
                console.warn(`${MODULE_ID} | No forage items in respite-items compendium. Camp forage will rely on content pack pools only.`);
            }
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | Failed to load respite-items index for travel pools:`, e);
    }

    const socketContext = {
        get activeRestSetupApp() {
            // Self-heal: if the GM reference was lost (e.g. a render post-step
            // threw and an older build cleared it) but the rest sheet is still
            // mounted, recover the live instance so player, GM sockets keep
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
        setActivePlayerRestApp(v) { activePlayerRestApp = v; _notifyRestStateChanged(); },
        setActiveShortRestApp(v) { activeShortRestApp = v; _notifyRestStateChanged(); },
        setPlayerRestActive(v) { _playerRestActive = Boolean(v); _notifyRestStateChanged(); },
        registerActiveShortRestApp(app) { registerActiveShortRestApp(app); },
        showAfkPanel() { showAfkPanel(); },
        hideAfkPanelAfterRest() { hideAfkPanelAfterRest(); },
    };
    registerSocketListener((data) => socketDispatch(data, socketContext));

    registerCampFurnitureZOrderGuards();
    registerLockdownHooks();
    registerSpoilageMergeGuard();
    registerSpoilageGrantHook();

    await registerReadyTokenAndResumeFlow({
        MODULE_ID, MODULE_LABEL, Logger, RespiteLog,
        refreshZzzOverlay, clearAllBeddingPoses, clampCampFloorTokenInPreUpdate,
        setRestSessionAfkEmitter, emitAfkSocket, setAfkUiRefresh,
        getActiveRestSetupApp: () => activeRestSetupApp,
        getActivePlayerRestApp: () => activePlayerRestApp,
        getActiveShortRestApp: () => activeShortRestApp,
        getActiveAfkPanel: () => activeAfkPanel,
        getPlayerRestActive: () => _playerRestActive,
        getRespiteFlowActive: () => respiteFlowActive,
        setRespiteFlowActive: (v) => { respiteFlowActive = Boolean(v); _notifyRestStateChanged(); },
        emitRequestRestState, getActiveRestSessionApp, BivouacApp, DowntimeLedgerApp, ShortRestApp,
        registerActiveShortRestApp, showAfkPanel, _maybeShowAmbientAfkPanelAtReady,
        clearCampTokens, resetCampSession, RestSetupApp, registerActiveRestApp, setActiveRestData,
        clearActiveRestApp, emitRestStarted, emitRestSnapshot, emitRestResolved,
        emitRestSessionAbandoned, initAfkBridge
    });
});

registerDnd5eRestHooks({
    MODULE_ID, MODULE_LABEL,
    getLogger: () => Logger,
    getRespiteFlowActive: () => respiteFlowActive,
    isNativeShortRestUnsuppressed,
    canStartRest: _canStartRest,
    RestSetupApp,
    reassertMealExhaustionFloor
});

registerPf2eRestHooks({
    MODULE_ID,
    getRespiteFlowActive: () => respiteFlowActive,
    canStartRest: _canStartRest,
    RestSetupApp
});

function _showRejoinNotification(app) {
    showRejoinNotification(app, _rejoinRest);
}

/** Re-exported for RestSetupApp post-activity auto-open. */
export function _removeRejoinBar() {
    removeRejoinNotification();
}

function _showShortRestRejoinNotification() {
    showShortRestRejoinNotification(_rejoinShortRest);
}

/**
 * Player rejoins an in-progress short rest by requesting state from the GM.
 */
function _rejoinShortRest() {
    removeShortRestRejoinNotification();
    import("./services/rest/session/RestSessionSync.js")
        .then(m => m.emitRestSessionRequestState(game.user.id))
        .catch(() => {});
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
        if (phaseSpan) phaseSpan.textContent = game.i18n.format("ionrift-respite.rejoinBar.phaseLabel", { phase: app?._phase ?? game.i18n.localize("ionrift-respite.rejoinBar.phaseActive") });
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
        ui.notifications.warn(game.i18n.localize("ionrift-respite.resume.short.noState"));
        respiteFlowActive = false;
        return;
    }
    const app = new ShortRestApp({ initialShelter: saved.activeShelter ?? "none" });
    const restored = app._loadShortRestState();
    if (!restored) {
        ui.notifications.warn(game.i18n.localize("ionrift-respite.resume.short.restoreFailed"));
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

