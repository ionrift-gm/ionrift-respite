import { Logger as RespiteLog } from "./utils/Logger.js";
import { CalendarHandler } from "./services/rest/session/CalendarHandler.js";
import { TerrainRegistry } from "./services/events/resolve/TerrainRegistry.js";
import { RestSetupApp } from "./apps/rest/RestSetupApp.js";
import { ShortRestApp } from "./apps/rest/ShortRestApp.js";
import { TorchTokenLinker } from "./services/camp/props/TorchTokenLinker.js";
import { placeTorch, placePerimeter, clearTorches, toggleTorches, placeCampfire, placeCamp } from "./services/camp/props/CampPropPlacer.js";
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
} from "./services/camp/props/CompoundCampPlacer.js";

import { createRespiteContext } from "./composition/createRespiteContext.js";
import { PackRegistryApp } from "./apps/packs/PackRegistryApp.js";
import { ImageResolver } from "./utils/ImageResolver.js";
import { DietConfigApp } from "./apps/meal/DietConfigApp.js";
import { AfkPanelApp } from "./apps/rest/AfkPanelApp.js";
import * as RestAfkState from "./services/rest/session/RestAfkState.js";
import {
    setRestSessionAfkEmitter,
    setAfkUiRefresh
} from "./services/rest/session/restSessionAfkEmit.js";
import {
    initAfkBridge,
    reconcileFromAdapters
} from "./services/afk/AfkBridgeService.js";
import { MealPhaseHandler } from "./services/meal/phase/MealPhaseHandler.js";
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

export function registerActiveRestApp(app) {
    activeRestSetupApp = app;
    respiteFlowActive = true;
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
}

export function clearActiveShortRestApp() {
    activeShortRestApp = null;
    respiteFlowActive = false;
}

export function notifyShortRestActive() {
    _showShortRestRejoinNotification();
}

/** @type {AfkPanelApp|null} */
let activeAfkPanel = null;

export function showAfkPanel() {
    reconcileFromAdapters();
    if (activeAfkPanel?.rendered) {
        activeAfkPanel.render({ force: true });
        return;
    }
    activeAfkPanel = new AfkPanelApp();
    void activeAfkPanel.render({ force: true });
}

export function hideAfkPanel() {
    if (activeAfkPanel) {
        activeAfkPanel.close();
        activeAfkPanel = null;
    }
    RestAfkState.clear();
}

export function refreshAfkPanel() {
    if (activeAfkPanel?.rendered) {
        activeAfkPanel.render({ force: true });
    }
}

/** Long vs short socket type for AFK sync. */
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

/** Guard active flow and Simple Calendar one-rest-per-day. @returns {boolean} */
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
    const _registerPartial = (file, name) => {
        const path = `modules/ionrift-respite/templates/partials/${file}`;
        foundry.applications.handlebars.loadTemplates([path]);
        fetch(path)
            .then(r => r.text())
            .then(t => Handlebars.registerPartial(name, t))
            .catch(e => console.warn(`${MODULE_ID} | Failed to load ${file} partial:`, e));
    };
    _registerPartial("roster-strip.hbs", "rosterStrip");
    _registerPartial("workbench-identify-embed.hbs", "workbenchIdentifyEmbed");
    _registerPartial("workbench-identify-panel.hbs", "workbenchIdentifyPanel");
    _registerPartial("activity-portraits.hbs", "activityPortraits");
    _registerPartial("fire-tier-picker.hbs", "fireTierPicker");
    _registerPartial("fire-tier-body.hbs", "fireTierBody");
    _registerPartial("_training-panel.hbs", "trainingPanel");
    _registerPartial("craft-commit-panel.hbs", "craftCommitPanel");

    // Expose API via composition root
    const respiteRuntime = {
        get respiteFlowActive() { return respiteFlowActive; },
        set respiteFlowActive(v) { respiteFlowActive = v; },
        get activeRestSetupApp() { return activeRestSetupApp; },
        set activeRestSetupApp(v) { activeRestSetupApp = v; },
        get activeRestData() { return activeRestData; },
        set activeRestData(v) { activeRestData = v; },
        get activeShortRestApp() { return activeShortRestApp; },
        set activeShortRestApp(v) { activeShortRestApp = v; },
        hideAfkPanel
    };
    createRespiteContext(respiteRuntime);

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
        const { registerArtPackNudge } = await import("./services/packs/registry/artPackNudge.js");
        registerArtPackNudge();
    } catch (e) {
        console.warn(`${MODULE_ID} | Art pack nudge registration failed:`, e);
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
            const { TerrainRegistry } = await import("./services/events/resolve/TerrainRegistry.js");
            TerrainRegistry.reset();
            await TerrainRegistry.init();
        } catch (e) {
            console.warn(`${MODULE_ID} | Terrain registry reset failed:`, e);
        }
        return;
    }

    // Event/content overlay: invalidate cached event and profession data
    try {
        const { OverlayEventLoader } = await import("./services/packs/overlays/OverlayEventLoader.js");
        OverlayEventLoader.invalidate();
    } catch { /* loader not available */ }
    try {
        const { OverlayProfessionLoader } = await import("./services/packs/overlays/OverlayProfessionLoader.js");
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
                e => e.flags?.["ionrift-respite"]?.category === "forage"
            ).length;
            const huntCount = [...(idx ?? [])].filter(
                e => e.flags?.["ionrift-respite"]?.category === "hunt"
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
    registerSpoilageGrantHook();

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
            // Graceful fail ,  don't block startup for an advisory
        }
    }

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

    _maybeShowAmbientAfkPanelAtReady();

    initAfkBridge();

    RespiteLog.log(`${MODULE_ID} | Boot complete.`);
    if (game.user.isGM) {
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.openPreview()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.debugAnimation()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.watchAnimation()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.forceDcPulseTest()");
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
    // v5+ delta reporting (system applies this independently of updateData)
    if (result.deltas?.exhaustion !== undefined) result.deltas.exhaustion = 0;
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

Hooks.on("dnd5e.restCompleted", (actor) => {
    if (!respiteFlowActive) return;
    void reassertMealExhaustionFloor(actor);
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

