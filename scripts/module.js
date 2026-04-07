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

import { createAdapter } from "./adapters/adapterFactory.js";
import { PackRegistryApp } from "./apps/PackRegistryApp.js";
import { PartyRosterApp } from "./apps/PartyRosterApp.js";
import { CopySpellHandler } from "./services/CopySpellHandler.js";
import { ImageResolver } from "./util/ImageResolver.js";

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
 * Returns the GM-approved party actors from the world setting.
 * Falls back to all player-owned characters if the roster is empty (first use).
 * Exported so RestSetupApp, EventResolver, and other services can use it.
 * @returns {Actor[]} Array of approved party actors.
 */
export function getPartyActors() {
    const roster = game.settings.get(MODULE_ID, "partyRoster");
    if (!roster?.length) {
        return game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
    }
    return roster.map(id => game.actors.get(id)).filter(Boolean);
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
        /** Reload all connected clients, then reload the GM. */
        reloadAll: () => {
            if (!game.user.isGM) return;
            game.socket.emit(`module.${MODULE_ID}`, { type: "forceReload" });
            console.log(`${MODULE_ID} | Sent forceReload to all clients. GM reloading in 500ms...`);
            setTimeout(() => window.location.reload(), 500);
        },
        /** Debug: Add supplies to all party actors. Usage: game.ionrift.respite.addSupplies(50) */
        addSupplies: (qty = 50) => RestSetupApp._debugAddSupplies(qty),
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
        }
    };

    // Register settings

    // HEADER: Content Packs button (registerMenu renders above register items)
    game.settings.registerMenu(MODULE_ID, "contentPacks", {
        name: "Content Packs",
        label: "Manage Packs",
        hint: "Enable or disable event content packs. Shows event counts per terrain.",
        icon: "fas fa-box-open",
        type: PackRegistryApp,
        restricted: true
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

    game.settings.register(MODULE_ID, "enableStudy", {
        name: "Study Activity",
        hint: "Allow the Study activity during rests. Requires Arcana or Investigation proficiency.",
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
        config: true,
        type: String,
        default: "Campfire",
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

    // FOOTER: Discord + Wiki (standardised via ionrift-library)
    const { SettingsLayout } = await import("../../ionrift-library/scripts/SettingsLayout.js");
    SettingsLayout.registerFooter(MODULE_ID);

    // Debug (registers last so it renders at the bottom)
    game.settings.register(MODULE_ID, "debug", {
        name: "Debug Mode",
        hint: "Enable verbose logging for rest flow.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
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

Hooks.once("ready", async () => {
    console.log(`${MODULE_ID} | Ready hook firing...`);
    Logger.log?.(MODULE_LABEL, "Ready.");

    // Initialize image resolver (art pack detection — probes ionrift-data/)
    await ImageResolver.init();

    // Initialize terrain registry early so data is available before first rest
    await TerrainRegistry.init();

    // Register socket handler
    game.socket.on(`module.${MODULE_ID}`, _onSocketMessage);

    // Player: request current rest state in case a rest is already active
    if (!game.user.isGM) {
        setTimeout(() => {
            console.log(`${MODULE_ID} | Player requesting rest state...`);
            game.socket.emit(`module.${MODULE_ID}`, { type: "requestRestState", userId: game.user.id });
        }, 1000);

        // Auto-resync when player returns from minimize/tab switch (debounced)
        let _lastResyncTime = 0;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && _playerRestActive && activePlayerRestApp) {
                const now = Date.now();
                if (now - _lastResyncTime < 500) return;
                _lastResyncTime = now;
                console.log(`${MODULE_ID} | Tab visible, resyncing rest state...`);
                game.socket.emit(`module.${MODULE_ID}`, { type: "requestRestState", userId: game.user.id });
            }
        });
        return;
    }



    // Detect rest-recovery module collision
    const restRecovery = game.modules.get("rest-recovery");
    if (restRecovery?.active) {
        Logger.warn?.(MODULE_LABEL,
            "rest-recovery module detected. Respite will defer HP/HD modification to rest-recovery and only handle events/activities."
        );
        game.settings.set(MODULE_ID, "restRecoveryDetected", true);
    }

    // Detect Workshop for item handoff
    const workshop = game.modules.get("ionrift-workshop");
    if (workshop?.active && workshop.api?.items) {
        Logger.log?.(MODULE_LABEL, "Workshop detected. Items will be normalized via WorkshopItemFactory.");
    } else {
        Logger.log?.(MODULE_LABEL, "Workshop not detected. Items will be created with minimal normalization.");
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
        }

        if (resume) {
            try {
                const app = new RestSetupApp();
                const restored = await app._loadRestState();
                if (restored) {
                    registerActiveRestApp(app);
                    respiteFlowActive = true;

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

                    app.render({ force: true });
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
                } else {
                    respiteFlowActive = false;
                    ui.notifications.warn("Could not restore rest state. Starting fresh.");
                    await game.settings.set(MODULE_ID, "activeRest", {});
                }
            } catch (e) {
                respiteFlowActive = false;
                console.error(`${MODULE_ID} | Failed to restore rest state:`, e);
                await game.settings.set(MODULE_ID, "activeRest", {});
            }
        } else {
            respiteFlowActive = false;
            await game.settings.set(MODULE_ID, "activeRest", {});
            game.socket.emit(`module.${MODULE_ID}`, { type: "restResolved" });
            Logger.log?.(MODULE_LABEL, "Discarded interrupted rest.");
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
    if (result.updateData?.["system.attributes.hp.value"] !== undefined) {
        delete result.updateData["system.attributes.hp.value"];
    }

    // Suppress HD recovery: zero out the array of restored HD
    if (result.dhd !== undefined) result.dhd = 0;
    if (Array.isArray(result.updateItems)) {
        result.updateItems = result.updateItems.filter(u => {
            // Keep spell slot and feature recharges, strip HD restoration
            return !("system.hitDiceUsed" in u);
        });
    }

    // Suppress exhaustion recovery: Respite handles this via RecoveryHandler.
    // The system always tries to reduce exhaustion by 1 on long rest;
    // we must strip it unconditionally or it will revert our changes.
    if (result.updateData?.["system.attributes.exhaustion"] !== undefined) {
        delete result.updateData["system.attributes.exhaustion"];
    }

    Logger.log?.(MODULE_LABEL,
        `Suppressed default HP/HD recovery for ${actor.name} (Respite flow active).`
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
                activePlayerRestApp.receivePhaseChange(data.phase, data.phaseData ?? {});
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
            CampfireTokenLinker.setLightState(data.lit);
            break;

        // GM -> All: force all clients to reload (dev tool)
        case "forceReload":
            console.log(`${MODULE_ID} | Received forceReload, refreshing page...`);
            setTimeout(() => window.location.reload(), 200);
            break;

        // Short Rest: GM started short rest
        case "shortRestStarted":
            if (game.user.isGM) return;
            _handleShortRestStarted(data);
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
                activeShortRestApp.close();
                activeShortRestApp = null;
            }
            break;
    }
}

/**
 * Player handler: GM started a short rest, open ShortRestApp.
 */
function _handleShortRestStarted(data) {
    if (activeShortRestApp) activeShortRestApp.close();
    activeShortRestApp = new ShortRestApp();
    activeShortRestApp.receiveStarted(data);
    activeShortRestApp.render({ force: true });
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
                return;
            }
            // New rest: close old window and create fresh
            console.log(`${MODULE_ID} | Closing stale rest window for new rest`);
            ui.notifications.info("The GM has started a new rest. Refreshing your window.");
            activePlayerRestApp.close({ skipRejoin: true });
            activePlayerRestApp = null;
        }

        activePlayerRestApp = new RestSetupApp({}, data.restData);
        // Hook into the close to show rejoin notification
        const origClose = activePlayerRestApp.close.bind(activePlayerRestApp);
        activePlayerRestApp.close = (options = {}) => {
            origClose(options);
            activePlayerRestApp = null;
            if (_playerRestActive && !options.skipRejoin) {
                _showRejoinNotification();
            }
        };
        console.log(`${MODULE_ID} | RestSetupApp created in player mode, rendering...`);
        activePlayerRestApp.render({ force: true });

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
    if (activePlayerRestApp) {
        activePlayerRestApp.close({ skipRejoin: true });
        activePlayerRestApp = null;
    }
}

/**
 * Shows a persistent rejoin notification when the player closes the rest window.
 */
function _showRejoinNotification() {
    _removeRejoinNotification();
    const el = document.createElement("div");
    el.id = "respite-rejoin-bar";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>A rest is in progress.</span>
        <button type="button" id="respite-rejoin-btn">Rejoin</button>
    `;
    el.querySelector("#respite-rejoin-btn").addEventListener("click", () => {
        _rejoinRest();
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
    _removeGmRestIndicator();
    const el = document.createElement("div");
    el.id = "respite-gm-rest-bar";
    const awaitingCombat = app?._awaitingCombat;
    const phaseLabel = awaitingCombat ? "Awaiting combat resolution" : `Phase: ${app?._phase ?? "active"}`;
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Rest in progress (${phaseLabel})</span>
        <button type="button" id="respite-gm-resume-btn">${awaitingCombat ? "View" : "Resume"}</button>
    `;
    el.querySelector("#respite-gm-resume-btn").addEventListener("click", () => {
        _removeGmRestIndicator();
        if (app && !app.rendered) {
            app.render({ force: true });
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
    activePlayerRestApp.receivePhaseChange(data.phase, data.phaseData);
}

/**
 * Player handler: Submission status changed. Update the player's panel.
 */
function _handleSubmissionUpdate(data) {
    if (!activePlayerRestApp) return;
    activePlayerRestApp.receiveSubmissionUpdate(data.submissions);
}

/**
 * Bidirectional: AFK status changed. Update whichever rest app is active.
 */
function _handleAfkUpdate(data) {
    // Route to the active rest app (GM or player)
    const app = game.user.isGM ? activeRestSetupApp : activePlayerRestApp;
    if (app) {
        app.receiveAfkUpdate(data.characterId, data.isAfk);
    }
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
