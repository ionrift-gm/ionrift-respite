import { RestFlowEngine } from "../services/RestFlowEngine.js";
import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { ActivityResolver } from "../services/ActivityResolver.js";
import { EventResolver } from "../services/EventResolver.js";
import { DecisionTreeResolver } from "../services/DecisionTreeResolver.js";
import { CraftingEngine } from "../services/CraftingEngine.js";
import { ResourcePoolRoller } from "../services/ResourcePoolRoller.js";
import { ItemOutcomeHandler } from "../services/ItemOutcomeHandler.js";
import { RecoveryHandler } from "../services/RecoveryHandler.js";
import { CalendarHandler } from "../services/CalendarHandler.js";
import { CopySpellHandler } from "../services/CopySpellHandler.js";
import { MealPhaseHandler } from "../services/MealPhaseHandler.js";
import { ConditionAdvisory } from "../services/ConditionAdvisory.js";
import { CampfireTokenLinker } from "../services/CampfireTokenLinker.js";
import { ImageResolver } from "../util/ImageResolver.js";
import { CraftingPickerApp } from "./CraftingPickerApp.js";
import { CampfireEmbed } from "./CampfireEmbed.js";
import { CraftingDelegate } from "./delegates/CraftingDelegate.js";
import { MealDelegate } from "./delegates/MealDelegate.js";
import { CopySpellDelegate } from "./delegates/CopySpellDelegate.js";
import { WEATHER_TABLE, SKILL_NAMES, COMFORT_RANK, RANK_TO_KEY, ACTIVITY_ICONS, SHELTER_SPELLS, COMFORT_TIPS } from "./RestConstants.js";
import { ShortRestApp } from "./ShortRestApp.js";
import { registerActiveRestApp, clearActiveRestApp, setActiveRestData, registerCampfireApp, clearCampfireApp, _showGmRestIndicator, _removeGmRestIndicator } from "../module.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;




/**
 * RestSetupApp (v2)
 * GM-facing application for initiating and managing a rest phase.
 * Handles the four-phase flow: Setup, Activity, Events, Resolution.
 * Broadcasts to player clients and live-tracks incoming choices.
 */
export class RestSetupApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-respite-setup",
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app"],
        window: {
            title: "Respite: Rest Phase",
            resizable: true
        },
        position: {
            width: 720,
            height: "auto"
        },
        actions: {
            beginRest: RestSetupApp.#onBeginRest,
            beginShortRest: RestSetupApp.#onBeginShortRest,
            submitActivities: RestSetupApp.#onSubmitActivities,
            proceedToEvents: RestSetupApp.#onProceedToEvents,
            setFireLevel: RestSetupApp.#onSetFireLevel,
            rollEvents: RestSetupApp.#onRollEvents,
            resolveEvents: RestSetupApp.#onResolveEvents,
            resolveTreeChoice: RestSetupApp.#onResolveTreeChoice,
            acknowledgeEncounter: RestSetupApp.#onAcknowledgeEncounter,
            openCrafting: RestSetupApp.#onOpenCrafting,
            craftDrawerSelectRecipe: RestSetupApp.#onCraftDrawerSelectRecipe,
            craftDrawerSelectRisk: RestSetupApp.#onCraftDrawerSelectRisk,
            craftDrawerCraft: RestSetupApp.#onCraftDrawerCraft,
            craftDrawerToggleMissing: RestSetupApp.#onCraftDrawerToggleMissing,
            craftDrawerClose: RestSetupApp.#onCraftDrawerClose,
            activityDetailConfirm: RestSetupApp.#onActivityDetailConfirm,
            activityDetailBack: RestSetupApp.#onActivityDetailBack,
            finalize: RestSetupApp.#onFinalize,
            gmOverride: RestSetupApp.#onGmOverride,
            toggleShelter: RestSetupApp.#onToggleShelter,
            setupContinue: RestSetupApp.#onSetupContinue,
            setupBack: RestSetupApp.#onSetupBack,
            setupDefaults: RestSetupApp.#onSetupDefaults,
            encounterAdjUp: RestSetupApp.#onEncounterAdjUp,
            encounterAdjDown: RestSetupApp.#onEncounterAdjDown,
            resolveSkillCheck: RestSetupApp.#onResolveSkillCheck,
            rollEventCheck: RestSetupApp.#onRollEventCheck,
            disasterChoice: RestSetupApp.#onDisasterChoice,
            afkToggle: RestSetupApp.#onAfkToggle,
            rollCampCheck: RestSetupApp.#onRollCampCheck,
            adjustCampDC: RestSetupApp.#onAdjustCampDC,
            requestCampRoll: RestSetupApp.#onRequestCampRoll,
            toggleResolvedEvent: RestSetupApp.#onToggleResolvedEvent,
            grantDiscoveryItem: RestSetupApp.#onGrantDiscoveryItem,
            completeEncounter: RestSetupApp.#onCompleteEncounter,
            detectMagicScan: RestSetupApp.#onDetectMagicScan,
            identifyScannedItem: RestSetupApp.#onIdentifyScannedItem,
            abandonRest: RestSetupApp.#onAbandonRest,
            approveCopySpell: RestSetupApp.#onApproveCopySpell,
            declineCopySpell: RestSetupApp.#onDeclineCopySpell,
            processGmCopySpell: RestSetupApp.#onProcessGmCopySpell,
            dismissGmCopySpell: RestSetupApp.#onDismissGmCopySpell,
            resendCopySpellRoll: RestSetupApp.#onResendCopySpellRoll,
            gmCopySpellFallback: RestSetupApp.#onGmCopySpellFallback,
            rollCopySpellArcana: RestSetupApp.#onRollCopySpellArcana,
            mealSelectFood: RestSetupApp.#onMealSelectFood,
            mealSelectWater: RestSetupApp.#onMealSelectWater,
            proceedFromMeal: RestSetupApp.#onProceedFromMeal,
            submitMealChoices: RestSetupApp.#onSubmitMealChoices,
            consumeMealDay: RestSetupApp.#onConsumeMealDay,
            adjustDaysSinceRest: RestSetupApp.#onAdjustDaysSinceRest,
            skipPendingSaves: RestSetupApp.#onSkipPendingSaves,
            hideWindow: RestSetupApp.#onHideWindow
        }
    };

    static PARTS = {
        "rest-setup": {
            template: `modules/${MODULE_ID}/templates/rest-setup.hbs`
        }
    };



    /** DnD5e skill abbreviation -> readable name */
    static SKILL_NAMES = SKILL_NAMES;

    /** Comfort tier ranking for comparison and arithmetic */
    static COMFORT_RANK = COMFORT_RANK;

    /** Comfort tiers indexed by rank value */
    static RANK_TO_KEY = RANK_TO_KEY;

    constructor(options = {}, restData = null) {
        super(options);
        this._isGM = game.user.isGM;
        this._engine = null;
        this._activityResolver = new ActivityResolver();
        this._eventResolver = new EventResolver();
        this._craftingEngine = new CraftingEngine();
        this._poolRoller = new ResourcePoolRoller();
        this._phase = restData ? "activity" : "setup";
        this._outcomes = [];
        this._triggeredEvents = [];
        this._activeTreeState = null;
        this._craftingResults = new Map();
        this._fireLevel = "unlit";
        this._campfireApp = null;
        this._campfireSnapshot = null;
        this._selectedCharacterId = null;

        // Inline crafting drawer state
        this._craftingDrawerOpen = false;
        this._craftingDrawerProfession = null;
        this._craftingDrawerRecipeId = null;
        this._craftingDrawerRisk = "standard";
        this._craftingDrawerResult = null;
        this._craftingDrawerHasCrafted = false;
        this._craftingDrawerShowMissing = false;

        // Activity detail panel state
        this._activityDetailId = null;

        // Dual-track: GM overrides and player submissions
        this._characterChoices = new Map();
        this._earlyResults = new Map();
        this._playerSubmissions = new Map();
        this._gmOverrides = new Map();
        this._gmFollowUps = new Map();
        this._afkCharacters = new Set();
        this._lockedCharacters = new Set();

        // Party discovery item grants: key = "eventId:itemRef", value = { actorName, rolled, itemName }
        this._grantedDiscoveries = new Map();

        // Delegates
        this._crafting = new CraftingDelegate(this);
        this._meals = new MealDelegate(this);
        this._copySpell = new CopySpellDelegate(this);

        // Player mode: receive rest data from socket instead of loading files
        this._restData = restData;
        if (restData) {
            this._restId = restData.restId ?? null;
            this._activities = restData.activities ?? [];
            this._activityResolver.load(this._activities);
            if (restData.recipes) {
                for (const [profId, recipeList] of Object.entries(restData.recipes)) {
                    this._craftingEngine.load(profId, recipeList);
                }
            }
            // Identify this player's characters
            this._myCharacterIds = new Set(
                game.actors.filter(a => a.hasPlayerOwner && a.isOwner && a.type === "character")
                    .map(a => a.id)
            );
        } else {
            this._dataReady = this._loadData();
        }

        // Expose debug API
        if (!game.ionrift) game.ionrift = {};
        if (!game.ionrift.respite) game.ionrift.respite = {};
        game.ionrift.respite.jumpToResolution = () => this._debugJumpToResolution();
        game.ionrift.respite.jumpToEncounter = () => this._debugJumpToEncounter();

        // Inventory sync: auto-refresh meal options when items change (e.g. player transfers)
        this._inventoryDebounce = null;
        this._inventoryHookHandler = (item) => {
            if (this._phase !== "meal") return;
            if (this._inventoryDebounce) clearTimeout(this._inventoryDebounce);
            this._inventoryDebounce = setTimeout(() => {
                console.log(`${MODULE_ID} | Inventory changed (${item?.name}), refreshing meal panel`);
                this.render();
            }, 500);
        };
        this._inventoryHookIds = [
            Hooks.on("createItem", this._inventoryHookHandler),
            Hooks.on("deleteItem", this._inventoryHookHandler),
            Hooks.on("updateItem", this._inventoryHookHandler)
        ];
    }

    /**
     * Debug: Jump directly to the resolution phase with a discovery event.
     * Usage: game.ionrift.respite.jumpToResolution()
     */
    async _debugJumpToResolution() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = this._engine?.terrainTag ?? "forest";
        const targets = game.actors.filter(a => a.hasPlayerOwner).map(a => a.id);

        // Create a minimal engine if none exists
        if (!this._engine) {
            this._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        // Register all player characters for Keep Watch
        for (const id of targets) {
            this._engine.registerChoice(id, "act_keep_watch");
            this._characterChoices.set(id, "act_keep_watch");
        }

        // Inject a discovery event with items
        this._triggeredEvents = [{
            id: "test_discovery", name: "Hidden Grove", category: "discovery",
            description: "A cluster of medicinal plants grows near the campsite.",
            mechanical: {
                type: "skill_check", skill: "nat", dc: 10, targets: "watch",
                onSuccess: { narrative: "You gather the herbs carefully.", items: [{ itemRef: "jungle_herbs", quantity: "1d4" }] },
                onFailure: { narrative: "The plants crumble at your touch.", effects: [] }
            },
            targets, rollTotal: 15, result: "triggered",
            narrative: "A cluster of medicinal plants grows near the campsite.",
            resolvedOutcome: "success",
            items: [{ itemRef: "jungle_herbs", quantity: "1d4" }],
            effects: []
        }];

        // Build outcomes via the engine
        this._eventsRolled = true;
        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, new Map());
        this._phase = "resolve";
        this._engine._phase = "resolve";

        // Register app so socket handlers and state syncs work properly
        registerActiveRestApp(this);

        // Broadcast to player clients
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
        };
        setActiveRestData(restPayload);
        game.socket.emit(`module.${MODULE_ID}`, { type: "restStarted", restData: restPayload });

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot });
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "phaseChanged", phase: "resolve", phaseData: { outcomes: this._outcomes }
            });
        }, 200);

        this.render(true);
        console.log("[Respite:Debug] Jumped to resolution with Hidden Grove discovery");
    }

    /**
     * Debug: Jump to the events phase with activities assigned and force an encounter.
     * Usage: game.ionrift.respite.jumpToEncounter()
     * After calling, click "Roll Events" to trigger the encounter and see the combat buff whisper.
     */
    async _debugJumpToEncounter() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = this._engine?.terrainTag ?? "forest";
        const targets = game.actors.filter(a => a.hasPlayerOwner).map(a => a.id);

        if (!this._engine) {
            this._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        // Mixed activities for combat buff variety
        const activities = ["act_keep_watch", "act_set_defenses", "act_keep_watch", "act_keep_watch", "act_keep_watch"];
        for (let i = 0; i < targets.length; i++) {
            const actId = activities[i % activities.length];
            this._engine.registerChoice(targets[i], actId);
            this._characterChoices.set(targets[i], actId);
        }

        // Inject a mock encounter event (already triggered)
        this._triggeredEvents = [{
            id: "debug_encounter", name: "Prowling Predators", category: "encounter",
            description: "A pack of creatures stalks the edge of your campfire light.",
            narrative: "A pack of creatures stalks the edge of your campfire light.",
            targets, result: "triggered", resolvedOutcome: null,
            effects: []
        }];
        this._eventsRolled = true;
        this._phase = "events";
        this._engine._phase = "events";

        // Generate combat buffs from the registered activities
        if (this._activityResolver) {
            this._combatBuffs = this._engine.aggregateCombatBuffs(this._activityResolver);
        }

        // Register app so socket handlers and state syncs work properly
        registerActiveRestApp(this);

        // Broadcast to player clients
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
        };
        setActiveRestData(restPayload);
        game.socket.emit(`module.${MODULE_ID}`, { type: "restStarted", restData: restPayload });

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot });
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "phaseChanged", phase: "events",
                phaseData: { triggeredEvents: this._triggeredEvents, eventsRolled: true }
            });
        }, 200);

        this.render(true);
        console.log("[Respite:Debug] Jumped to events phase with mock encounter and combat readiness report.");
    }

    // ── Rest State Persistence ────────────────────────────────────

    /**
     * Persists the current rest state to a world setting.
     * Called on every phase transition and before combat blocking.
     */
    async _saveRestState() {
        if (!game.user.isGM || !this._engine) return;
        const state = {
            engine: this._engine.serialize(),
            phase: this._phase,
            triggeredEvents: this._triggeredEvents,
            eventsRolled: this._eventsRolled ?? false,
            activeTreeState: this._activeTreeState,
            fireLevel: this._fireLevel,
            selectedTerrain: this._selectedTerrain,
            selectedRestType: this._selectedRestType,
            selectedWeather: this._selectedWeather,
            selectedScout: this._selectedScout,
            characterChoices: Array.from(this._characterChoices.entries()),
            earlyResults: Array.from(this._earlyResults.entries()),
            gmOverrides: Array.from(this._gmOverrides.entries()),
            playerSubmissions: Array.from(this._playerSubmissions.entries()),
            lockedCharacters: Array.from(this._lockedCharacters),
            gmFollowUps: Array.from(this._gmFollowUps.entries()),
            craftingResults: Array.from(this._craftingResults.entries()),
            awaitingCombat: this._awaitingCombat ?? false,
            gmCopySpellProposal: this._gmCopySpellProposal?.charged ? this._gmCopySpellProposal : null,
            mealChoices: this._mealChoices ? Array.from(this._mealChoices.entries()) : [],
            mealSubmissions: this._mealSubmissions ? Array.from(this._mealSubmissions.entries()) : [],
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            campfireSnapshot: this._campfireApp ? {
                lit: this._campfireApp._lit ?? false,
                litBy: this._campfireApp._litBy ?? null,
                heat: this._campfireApp._heat ?? 0,
                strikeCount: this._campfireApp._strikeCount ?? 0,
                kindlingPlaced: this._campfireApp._kindlingPlaced ?? 0,
                peakHeat: this._campfireApp._peakHeat ?? 0,
                lastFireLevel: this._campfireApp._lastFireLevel ?? "unlit"
            } : (this._campfireSnapshot ?? null),
            timestamp: Date.now()
        };
        await game.settings.set(MODULE_ID, "activeRest", state);
    }

    /**
     * Attempts to restore rest state from a world setting.
     * @returns {boolean} True if state was found and restored.
     */
    async _loadRestState() {
        const state = game.settings.get(MODULE_ID, "activeRest");
        if (!state?.engine) return false;

        this._engine = RestFlowEngine.deserialize(state.engine);
        this._phase = state.phase ?? "setup";
        this._triggeredEvents = state.triggeredEvents ?? [];
        this._eventsRolled = state.eventsRolled ?? false;
        console.log(`[Respite:State] _loadRestState — phase=${this._phase}, eventsRolled=${this._eventsRolled}, hasEngine=${!!this._engine}`);
        this._activeTreeState = state.activeTreeState ?? null;
        this._fireLevel = state.fireLevel ?? "unlit";
        this._selectedTerrain = state.selectedTerrain;
        this._selectedRestType = state.selectedRestType;
        this._selectedWeather = state.selectedWeather;
        this._selectedScout = state.selectedScout;
        this._characterChoices = new Map(state.characterChoices ?? []);
        this._earlyResults = new Map(state.earlyResults ?? []);
        this._gmOverrides = new Map(state.gmOverrides ?? []);
        this._playerSubmissions = new Map(state.playerSubmissions ?? []);
        this._lockedCharacters = new Set(state.lockedCharacters ?? []);
        this._gmFollowUps = new Map(state.gmFollowUps ?? []);
        this._craftingResults = new Map(state.craftingResults ?? []);
        this._awaitingCombat = state.awaitingCombat ?? false;
        this._gmCopySpellProposal = state.gmCopySpellProposal ?? null;
        this._mealChoices = new Map(state.mealChoices ?? []);
        this._mealSubmissions = new Map(state.mealSubmissions ?? []);
        this._daysSinceLastRest = state.daysSinceLastRest ?? 1;
        this._campfireSnapshot = state.campfireSnapshot ?? null;

        // Ensure _loadData has finished so resolvers and _activities are available
        if (this._dataReady) await this._dataReady;

        // Rebuild _characterChoices from the restored submissions and overrides
        this._rebuildCharacterChoices();

        console.log(`[Respite:State] Restored — characterChoices=${this._characterChoices.size}, playerSubmissions=${this._playerSubmissions.size}, gmOverrides=${this._gmOverrides.size}`);

        return true;
    }

    /**
     * Clears persisted rest state. Called on rest completion or cancellation.
     */
    async _clearRestState() {
        if (!game.user.isGM) return;
        try {
            await game.settings.set(MODULE_ID, "activeRest", {});
        } catch (e) {
            // Setting may not be registered yet
        }
    }

    async _loadData() {
        try {
            const activityResp = await fetch(`modules/${MODULE_ID}/data/activities/default_activities.json`);
            const activities = await activityResp.json();
            this._activities = activities;
            this._activityResolver.load(activities);

            // Always load shared camp disasters (terrain-agnostic decision tree events)
            const disasterResp = await fetch(`modules/${MODULE_ID}/data/core/events/camp_disasters.json`);
            const disasters = await disasterResp.json();
            this._eventResolver.load(disasters.tables, disasters.events);

            // Content packs: events are added to data/ when vetted and shipped as module updates.
            // See ionrift-respite-packs repo for authoring workspace.
        } catch (e) {
            console.error(`${MODULE_ID} | Failed to load seed data:`, e);
        }
    }

    /**
     * Loads terrain-specific event data. Additive; safe to call multiple times.
     */
    async _loadTerrainEvents(terrainTag) {
        if (this._eventResolver.tables.has(terrainTag)) return;

        // Resolve path from TerrainRegistry manifest; fall back to convention
        const path = TerrainRegistry.getEventsPath(terrainTag)
            ?? `modules/${MODULE_ID}/data/terrains/${terrainTag}/events.json`;

        try {
            const resp = await fetch(path);
            if (!resp.ok) {
                console.warn(`${MODULE_ID} | No event file for terrain: ${terrainTag}`);
                return;
            }
            const data = await resp.json();
            this._eventResolver.load(data.tables, data.events);
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to load events for ${terrainTag}:`, e);
        }
    }

    render(options = {}) {
        if (this._isGM) {
            registerActiveRestApp(this);
            // Broadcast "preparing" to players on first open
            if (!this._prepBroadcast) {
                this._prepBroadcast = true;
                game.socket.emit(`module.${MODULE_ID}`, { type: "restPreparing" });
            }
        }
        return super.render(options);
    }

    async close(options = {}) {
        if (this._isGM) {
            // If rest is in resolution phase but auto-apply hasn't completed, confirm
            if (this._phase === "resolve" && !this._restApplied && !options.resolved) {
                // Check for ungranted discoveries
                let ungrantedCount = 0;
                if (this._grantedDiscoveries && this._outcomes?.length) {
                    const seenEvents = new Set();
                    for (const o of this._outcomes) {
                        for (const sub of (o.outcomes ?? [])) {
                            if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                                seenEvents.add(sub.eventId);
                                for (const item of sub.items) {
                                    const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                                    if (!this._grantedDiscoveries.has(key)) ungrantedCount++;
                                }
                            }
                        }
                    }
                }

                const ungrantedNote = ungrantedCount > 0
                    ? `<p><strong>${ungrantedCount} discovered item${ungrantedCount > 1 ? "s have" : " has"} not been granted.</strong> These will be lost.</p>`
                    : "";

                return new Promise(resolve => {
                    const overlay = document.createElement("div");
                    overlay.classList.add("ionrift-armor-modal-overlay");
                    overlay.innerHTML = `
                        <div class="ionrift-armor-modal">
                            <h3><i class="fas fa-exclamation-triangle"></i> Discard Rest?</h3>
                            <p>The rest has not been applied yet. Closing now will discard all results.</p>
                            ${ungrantedNote}
                            <div class="ionrift-armor-modal-buttons">
                                <button class="btn-armor-confirm"><i class="fas fa-times"></i> Discard</button>
                                <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                            </div>
                        </div>`;
                    document.body.appendChild(overlay);
                    overlay.querySelector(".btn-armor-confirm").addEventListener("click", async () => {
                        overlay.remove();
                        game.socket.emit(`module.${MODULE_ID}`, { type: "restResolved" });
                        await super.close(options);
                        resolve();
                    });
                    overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                        overlay.remove();
                        resolve();
                    });
                });
            }

            // If rest is unresolved (not in resolve phase), show persistent indicator
            const restActive = this._phase && this._phase !== "resolve" && this._phase !== "setup";
            if (restActive && !options.resolved) {
                // Don't clear the active app reference; rest is still in progress
                _showGmRestIndicator(this);
            } else {
                clearActiveRestApp();
                _removeGmRestIndicator();
            }
        }
        // Deregister inventory hooks
        if (this._inventoryHookIds) {
            Hooks.off("createItem", this._inventoryHookIds[0]);
            Hooks.off("deleteItem", this._inventoryHookIds[1]);
            Hooks.off("updateItem", this._inventoryHookIds[2]);
            this._inventoryHookIds = null;
        }
        return super.close(options);
    }

    async _prepareContext(options) {
        // Ensure terrain registry is loaded (no-ops after first call)
        await TerrainRegistry.init();

        if (!this._pendingSelections) this._pendingSelections = new Map();
        if (!this._expandedCards) this._expandedCards = new Set();
        if (!this._craftingInProgress) this._craftingInProgress = new Set();
        if (!this._shelterOverrides) this._shelterOverrides = {};

        const partyActors = game.actors.filter(a => a.hasPlayerOwner);
        const emptyParty = partyActors.length === 0;
        if (!this._selectedTerrain) {
            const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
            if (lastTerrain && TerrainRegistry.get(lastTerrain)) this._selectedTerrain = lastTerrain;
        }
        const terrainDefaults = TerrainRegistry.getDefaults(this._selectedTerrain ?? "forest");
        const defaultComfort = terrainDefaults.comfort;

        // ── Shelter detection ──


        // Determine current rest type from form (defaults to long)
        const currentRestType = this.element?.querySelector('[name="restType"]')?.value ?? "long";

        // Detect tents from party inventory
        const tentOwners = partyActors.filter(a =>
            a.items?.some(i => i.name?.toLowerCase().includes("tent"))
        );
        const tentAvailable = tentOwners.length > 0;
        const tentOwnerNames = tentOwners.map(a => a.name).join(", ");

        // Detect shelter spells from party spell lists, filtered by rest type
        const shelterOptions = SHELTER_SPELLS
            .filter(spell => spell.restTypes.includes(currentRestType))
            .map(spell => {
                const casters = partyActors.filter(a =>
                    a.items?.some(i => {
                        if (i.type !== "spell") return false;
                        const spellName = i.name?.toLowerCase() ?? "";
                        return spell.altNames.some(alt => spellName.includes(alt));
                    })
                );
                return {
                    ...spell,
                    available: casters.length > 0,
                    casterNames: casters.map(a => a.name).join(", "),
                    active: !!this._shelterOverrides[spell.id]
                };
            });

        // Add tent as first shelter option (long rest only)
        if (currentRestType === "long") {
            shelterOptions.unshift({
                id: "tent",
                name: "Tent",
                icon: "fas fa-campground",
                available: tentAvailable,
                casterNames: tentOwnerNames,
                hint: tentAvailable ? `Carried by ${tentOwnerNames}. Weather shield. Encounter DC +2.` : "No tent in party inventory.",
                rpPrompt: "Who sets it up? Where do they pitch it? Is it large enough for everyone, or do some sleep outside?",
                comfortFloor: null,
                encounterMod: 2,
                active: !!this._shelterOverrides.tent
            });
        }

        // Add "No Shelter" as the last option (always available)
        shelterOptions.push({
            id: "none",
            name: "Open Air",
            icon: "fas fa-cloud-moon",
            available: true,
            casterNames: null,
            hint: "Under the open sky. No protection from weather or encounters.",
            rpPrompt: null,
            comfortFloor: null,
            encounterMod: 0,
            active: !!this._shelterOverrides.none
        });

        // Compute active shelter effect for comfort indicator
        const activeShelterId = Object.entries(this._shelterOverrides ?? {}).find(([, v]) => v)?.[0];
        const isTavern = (this._selectedTerrain ?? "forest") === "tavern";
        const shelterChosen = isTavern || !!activeShelterId;
        const activeShelter = activeShelterId ? shelterOptions.find(s => s.id === activeShelterId) : null;
        const COMFORT_RANK = RestSetupApp.COMFORT_RANK;
        const shelterEffect = activeShelter ? {
            name: activeShelter.name,
            comfortFloor: activeShelter.comfortFloor,
            encounterMod: activeShelter.encounterMod ?? 0,
            rpPrompt: activeShelter.rpPrompt ?? null,
            casterNames: activeShelter.casterNames ?? null
        } : null;

        const SKILL_NAMES = RestSetupApp.SKILL_NAMES;

        // Activity icon mapping


        const characterStatuses = partyActors.map(a => {
            const gmOverride = this._gmOverrides.get(a.id);
            const playerChoice = this._getPlayerChoiceForCharacter(a.id);
            const effectiveChoice = gmOverride ?? playerChoice?.activityId ?? null;
            let source = gmOverride ? "gm" : playerChoice ? "player" : "pending";

            let activityName = null;
            if (effectiveChoice) {
                const act = this._activities?.find(act => act.id === effectiveChoice);
                activityName = act?.name ?? effectiveChoice;
            }

            // Fallback: use submission status from socket for non-owned characters (player side)
            if (!this._isGM && source === "pending" && this._submissionStatus?.[a.id]) {
                const sub = this._submissionStatus[a.id];
                source = sub.source ?? "player";
                activityName = sub.activityName ?? activityName;
            }

            // Derive profession badges from available crafting activities
            const professionBadges = [];
            const professionIcons = {
                cooking: "fas fa-utensils", alchemy: "fas fa-flask",
                smithing: "fas fa-hammer", leatherworking: "fas fa-shield-alt",
                brewing: "fas fa-flask", tailoring: "fas fa-cut"
            };
            const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
            const { available: avail, faded: fadedActivities, minor: minorActivities, fadedMinor: fadedMinorActivities } = this._activityResolver.getAvailableActivitiesWithFaded(a, this._engine?.restType ?? "long", { isFireLit });
            for (const act of avail) {
                if (act.crafting?.enabled) {
                    professionBadges.push({
                        label: act.name,
                        icon: professionIcons[act.crafting.profession] ?? "fas fa-tools"
                    });
                }
            }

            // Armor don/doff advisory (Xanathar's optional rule)
            let armorWarning = null;
            try {
                const armorDoffEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
                if (armorDoffEnabled) {
                    if (!this._doffedArmor) this._doffedArmor = new Map();
                    const doffedItemId = this._doffedArmor.get(a.id);

                    // Check for currently equipped medium/heavy armor
                    const equippedArmor = a.itemTypes?.equipment?.find(i =>
                        i.system?.equipped && i.system?.type?.value === "heavy"
                    ) ?? a.itemTypes?.equipment?.find(i =>
                        i.system?.equipped && i.system?.type?.value === "medium"
                    );

                    if (equippedArmor) {
                        const armorType = equippedArmor.system?.type?.value;
                        const donTime = armorType === "heavy" ? "10 min" : "5 min";
                        armorWarning = {
                            type: armorType,
                            name: equippedArmor.name,
                            itemId: equippedArmor.id,
                            actorId: a.id,
                            isDoffed: false,
                            donTime,
                            hint: `${equippedArmor.name} (${armorType}) equipped. Don time: ${donTime}.`
                        };
                    } else if (doffedItemId) {
                        // Character doffed armor this rest - show re-equip option
                        const doffedItem = a.items.get(doffedItemId);
                        if (doffedItem) {
                            const armorType = doffedItem.system?.type?.value ?? "medium";
                            const donTime = armorType === "heavy" ? "10 min" : "5 min";
                            armorWarning = {
                                type: armorType,
                                name: doffedItem.name,
                                itemId: doffedItemId,
                                actorId: a.id,
                                isDoffed: true,
                                donTime,
                                hint: `${doffedItem.name} removed for rest. Better recovery, but vulnerable if attacked. Don time: ${donTime}.`
                            };
                        }
                    } else {
                        // Check inventory for unequipped medium/heavy armor (offer best available)
                        const inventoryArmor = a.itemTypes?.equipment?.find(i =>
                            !i.system?.equipped && i.system?.type?.value === "heavy"
                        ) ?? a.itemTypes?.equipment?.find(i =>
                            !i.system?.equipped && i.system?.type?.value === "medium"
                        );
                        if (inventoryArmor) {
                            const armorType = inventoryArmor.system?.type?.value;
                            const donTime = armorType === "heavy" ? "10 min" : "5 min";
                            armorWarning = {
                                type: armorType,
                                name: inventoryArmor.name,
                                itemId: inventoryArmor.id,
                                actorId: a.id,
                                isDoffed: true,
                                donTime,
                                hint: `${inventoryArmor.name} available in inventory. Don time: ${donTime}.`
                            };
                        }
                    }
                }
            } catch (e) { /* setting may not exist yet */ }

            // Build unified tile list with tooltips
            const pendingId = this._pendingSelections.get(a.id);
            const tileActivities = avail.map(act => {
                // Build tooltip lines
                const lines = [act.description];
                if (act.check) {
                    if (act.check.ability) {
                        const abilityLabel = act.check.ability.toUpperCase();
                        lines.push(`Check: ${abilityLabel}, DC ${act.check.dc ?? 12}`);
                    } else {
                        const primary = SKILL_NAMES[act.check.skill] ?? act.check.skill;
                        const alt = act.check.altSkill ? ` or ${SKILL_NAMES[act.check.altSkill] ?? act.check.altSkill}` : "";
                        lines.push(`Check: ${primary}${alt}, DC ${act.check.dc ?? 12}`);
                    }
                }
                if (act.outcomes?.success?.effects?.length) {
                    lines.push(act.outcomes.success.effects.map(e => e.description).join(". "));
                }
                if (act.outcomes?.success?.items?.length) {
                    lines.push(act.outcomes.success.items.map(i => {
                        const qty = i.quantity ?? 1;
                        return `Creates: ${typeof qty === "string" ? qty : qty + "x"} ${i.itemRef ?? i.pool ?? "items"}`;
                    }).join(", "));
                }
                if (!act.check && act.outcomes?.success?.narrative) {
                    lines.push(act.outcomes.success.narrative);
                }



                // Determine type tag
                let typeTag = "Passive";
                if (act.crafting?.enabled) typeTag = "Craft";
                else if (act.check) typeTag = "Skill";
                if (act.group) typeTag = "Group";

                return {
                    id: act.id,
                    name: act.name,
                    description: act.description ?? "",
                    icon: ACTIVITY_ICONS[act.id] ?? "fas fa-circle",
                    typeTag,
                    category: act.category ?? "active",
                    tooltip: lines.join("\n"),
                    isCrafting: !!act.crafting?.enabled,
                    profession: act.crafting?.profession ?? null,
                    isSelected: pendingId === act.id,
                    isDisabled: false,
                    check: act.check ?? null,
                    outcomes: act.outcomes ?? null,
                    combatModifiers: act.combatModifiers ?? null,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false,
                    hasAttuneable: act.id === "act_attune"
                };
            });

            // Build faded tile objects
            const fadedTiles = fadedActivities.map(act => {
                let typeTag = "Spell";
                if (act.crafting?.enabled) typeTag = "Craft";
                else if (act.check) typeTag = "Skill";
                return {
                    id: act.id,
                    name: act.name,
                    icon: ACTIVITY_ICONS[act.id] ?? "fas fa-circle",
                    typeTag,
                    category: act.category ?? "arcane",
                    tooltip: act.fadedHint,
                    isCrafting: !!act.crafting?.enabled,
                    profession: act.crafting?.profession ?? null,
                    isSelected: false,
                    isDisabled: true,
                    isFaded: true,
                    fadedHint: act.fadedHint,
                    combatModifiers: act.combatModifiers ?? null,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false
                };
            });

            // Group non-crafting tiles by category (ordered martial -> clerical)
            const allTiles = [...tileActivities.filter(t => !t.isCrafting), ...fadedTiles];
            const CATEGORY_ORDER = [
                { keys: ["camp", "recovery"], label: "Camp Duties" },
                { keys: ["active", "arcane"], label: "Personal" }
            ];
            // Arcane tiles (Attune, Copy Spell) sort last within Personal
            const SORT_LAST_CATS = new Set(["arcane"]);
            const tileCategories = CATEGORY_ORDER
                .map(cat => ({
                    label: cat.label,
                    tiles: allTiles
                        .filter(t => cat.keys.includes(t.category))
                        .sort((a, b) => (SORT_LAST_CATS.has(a.category) ? 1 : 0) - (SORT_LAST_CATS.has(b.category) ? 1 : 0))
                }))
                .filter(cat => cat.tiles.length > 0);

            const professionTiles = [
                ...tileActivities.filter(t => t.isCrafting),
                ...fadedTiles.filter(t => t.isCrafting)
            ];

            // Comfort gear badges
            const actorItems = a.items?.map(i => i.name?.toLowerCase()) ?? [];
            const gearBadges = [
                { id: "bedroll", icon: "fas fa-bed", name: "Bedroll", present: actorItems.some(n => n?.includes("bedroll")), tooltip: "Bedroll: +1 Hit Die recovered during long rest" },
                { id: "messkit", icon: "fas fa-utensils", name: "Mess Kit", present: actorItems.some(n => n?.includes("mess kit") || (n?.includes("cook") && n?.includes("utensil"))), tooltip: "Mess Kit: +1 HP recovered during long rest" },
                { id: "tent", icon: "fas fa-campground", name: "Tent", present: actorItems.some(n => n?.includes("tent")), tooltip: "Tent: personal shelter, cancels or reduces weather penalties" }
            ];

            return {
                id: a.id,
                name: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                choice: effectiveChoice,
                activityName,
                source,
                professionBadges,
                tileCategories,
                professionTiles,
                armorWarning,
                gearBadges,
                minorActivities: minorActivities.map(m => ({
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    icon: ACTIVITY_ICONS[m.id] ?? "fas fa-circle"
                })),
                fadedMinorActivities: (fadedMinorActivities ?? []).map(m => ({
                    id: m.id,
                    name: m.name,
                    fadedHint: m.fadedHint,
                    icon: ACTIVITY_ICONS[m.id] ?? "fas fa-circle"
                })),
                hasProfessionTiles: professionTiles.length > 0,
                hasPending: !!pendingId,
                isOwner: this._isGM || this._myCharacterIds?.has(a.id),
                isAfk: this._afkCharacters.has(a.id),
                isLocked: source !== "pending" || this._lockedCharacters.has(a.id),
                earlyResult: (() => {
                    // Suppress early result if a Copy Spell result exists (final replaces pending)
                    if (this._copySpellResult?.actorId === a.id) return null;
                    const er = this._earlyResults?.get(a.id);
                    if (!er) return null;
                    const tier = er.result === "exceptional" ? "Exceptional"
                        : er.result === "success" ? "Success"
                        : er.result === "failure_complication" ? "Failed"
                        : er.result === "failure" ? "Failed"
                        : er.result === "pending_approval" ? "Pending"
                        : er.result;
                    const isPending = er.result === "pending_approval";
                    return { tier, narrative: er.narrative ?? "", isSuccess: er.result === "success" || er.result === "exceptional", isFailure: er.result === "failure" || er.result === "failure_complication", isPending };
                })(),
                isExpanded: this._isGM ? (this._expandedCards?.has(a.id) ?? false) : true,
                isCraftingInProgress: this._craftingInProgress?.has(a.id) ?? false,
                exhaustion: a.system?.attributes?.exhaustion ?? 0,
                copySpellProposal: this._copySpellProposal?.actorId === a.id ? this._copySpellProposal : null,
                copySpellResult: this._copySpellResult?.actorId === a.id ? this._copySpellResult : null
            };
        });

        // Split into hero cards (owned, interactive) and party cards (others, info only)
        // GM sees all as heroes since they manage all characters
        const heroCharacters = this._isGM
            ? characterStatuses
            : characterStatuses.filter(c => c.isOwner);
        const partyCharacters = this._isGM
            ? []
            : characterStatuses.filter(c => !c.isOwner);

        // Roster strip: compact summary for ALL characters (everyone sees the full party)
        if (!this._selectedCharacterId && heroCharacters.length > 0) {
            this._selectedCharacterId = heroCharacters[0].id;
        }
        const roster = characterStatuses.map(c => {
            // Check event roll status for this character
            let pendingRoll = false;
            let rolledResult = null;

            if (this._isGM) {
                // GM: check triggeredEvents for awaiting rolls
                const awaitingEvent = (this._triggeredEvents ?? []).find(e => e.awaitingRolls);
                if (awaitingEvent) {
                    if (awaitingEvent.pendingRolls?.includes(c.id)) pendingRoll = true;
                    const resolved = awaitingEvent.resolvedRolls?.find(r => r.characterId === c.id);
                    if (resolved) rolledResult = resolved.total;
                }
                // Also check camp activity rolls
                if (!pendingRoll && !rolledResult && this._pendingCampRolls?.length) {
                    const campEntry = this._pendingCampRolls.find(p => p.characterId === c.id);
                    if (campEntry) {
                        if (campEntry.status === "pending") pendingRoll = true;
                        else rolledResult = campEntry.total ?? "done";
                    }
                }
            } else {
                // Player: check pendingEventRoll
                if (this._pendingEventRoll) {
                    const targets = this._pendingEventRoll.targets ?? [];
                    if (targets.includes(c.id)) {
                        if (this._pendingEventRoll.rolledCharacters?.has(c.id)) {
                            rolledResult = "done";
                        } else {
                            pendingRoll = true;
                        }
                    }
                }
                // Also check camp activity rolls
                if (!pendingRoll && !rolledResult && this._pendingCampRoll) {
                    const campAct = this._pendingCampRoll.activities?.find(a => a.characterId === c.id);
                    if (campAct) {
                        if (this._pendingCampRoll.rolledCharacters?.has(c.id)) {
                            rolledResult = "done";
                        } else {
                            pendingRoll = true;
                        }
                    }
                }
            }

            // Look up assigned activity for roster label (all phases once chosen)
            let activityLabel = null;
            const actId = this._gmOverrides?.get(c.id) ?? this._characterChoices?.get(c.id);
            if (actId) {
                const act = this._activities?.find(a => a.id === actId);
                activityLabel = act?.name ?? null;
            }

            return {
                id: c.id,
                name: c.name.split(" ")[0],  // First name only
                fullName: c.name,
                img: c.img,
                source: c.source,
                isAfk: this._afkCharacters?.has(c.id) ?? false,
                isOwner: c.isOwner,
                isSelected: c.id === this._selectedCharacterId,
                exhaustion: c.exhaustion,
                pendingRoll,
                rolledResult,
                activityLabel
            };
        });

        // GM chip: right-aligned in roster, shows GM roll status
        let gmPending = false;
        let gmRolled = null;
        if (this._phase === "events" && !this._eventsRolled) {
            const campPrepsResolved = !this._pendingCampRolls?.length || this._pendingCampRolls.every(p => p.status !== "pending");
            if (campPrepsResolved) gmPending = true;
        } else if (this._phase === "events" && this._eventsRolled) {
            gmRolled = "done";
        }
        const gmRosterChip = {
            id: "gm",
            name: "GM",
            fullName: game.users.find(u => u.isGM)?.name ?? "Game Master",
            img: null,
            source: "gm",
            isAfk: this._afkCharacters?.has("gm") ?? false,
            isOwner: this._isGM,
            isGmChip: true,
            pendingRoll: gmPending,
            rolledResult: gmRolled
        };
        const selectedCharacter = heroCharacters.find(c => c.id === this._selectedCharacterId) ?? heroCharacters[0] ?? null;

        const totalCharacters = partyActors.length;
        const resolvedCount = characterStatuses.filter(c => c.source !== "pending").length;
        const allResolved = resolvedCount === totalCharacters && !this._gmCopySpellProposal;

        // Build recovery summary for the resolution phase
        let recoverySummary = [];
        let activitySummary = [];
        let partyDiscoveries = [];
        if (this._phase === "resolve" && this._outcomes?.length) {
            const scopedOutcomes = this._isGM
                ? this._outcomes
                : this._outcomes.filter(o => this._myCharacterIds?.has(o.characterId));
            recoverySummary = scopedOutcomes.map(o => ({
                name: o.characterName,
                hp: o.recovery?.hpRestored ?? 0,
                hd: o.recovery?.hdRestored ?? 0,
                exhaustionDelta: o.recovery?.exhaustionDelta ?? 0,
                gearBonuses: o.recovery?.gearBonuses ?? {},
                gearDescriptors: o.recovery?.gearDescriptors ?? []
            }));
            // Extract activity outcomes for badges
            for (const o of scopedOutcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "activity" && sub.activityId) {
                        const act = this._activityResolver?.activities?.get(sub.activityId);
                        activitySummary.push({
                            name: o.characterName,
                            activityName: act?.name ?? sub.activityId ?? "Activity",
                            result: sub.result ?? "success"
                        });
                    }
                }
            }

            // Aggregate event item rewards into party discoveries (shown once, not per-character)
            const seenEvents = new Set();
            for (const o of this._outcomes ?? []) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const grantKey = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            const grantInfo = this._grantedDiscoveries.get(grantKey);
                            partyDiscoveries.push({
                                eventName: sub.eventName ?? "Event",
                                itemRef: item.itemRef ?? item.name ?? "Unknown",
                                name: item.name ?? null,
                                quantity: item.quantity ?? 1,
                                grantKey,
                                granted: !!grantInfo,
                                grantedTo: grantInfo?.actorName ?? null,
                                grantedQty: grantInfo?.rolled ?? null,
                                grantedItemName: grantInfo?.itemName ?? null
                            });
                        }
                    }
                }
            }
        }

        // Player: filter outcomes to owned characters
        const personalOutcomes = this._isGM
            ? this._outcomes
            : (this._outcomes ?? []).filter(o => this._myCharacterIds?.has(o.characterId));

        return {
            isGM: this._isGM,
            emptyParty,
            trackFood: game.settings.get(MODULE_ID, "trackFood"),
            gmCopySpellProposal: this._gmCopySpellProposal ?? null,
            copySpellRollPrompt: this._copySpellRollPrompt ?? null,
            phase: this._phase,
            terrainOptions: (() => {
                const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
                const opts = TerrainRegistry.getAll().map(t => ({ value: t.id, label: t.label }));
                if (lastTerrain) {
                    const match = opts.find(o => o.value === lastTerrain);
                    if (match) match.label += " (last used)";
                }
                return opts;
            })(),
            terrainPreview: (() => {
                const t = this._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                const scout = d.scoutingAvailable !== false ? "Scouting available." : "No scouting.";
                return `Implied comfort: ${comfort}. ${scout}`;
            })(),
            weatherOptions: TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")
                .map(key => ({ value: key, ...WEATHER_TABLE[key] }))
                .filter(w => w.label),
            defaultWeather: TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")[0] ?? "clear",
            comfortOptions: (() => {
                const opts = [
                    { value: "safe", label: "Safe", hint: "Full HP. HD: half level recovered. No exhaustion risk. Taverns, strongholds, warded sanctuaries." },
                    { value: "sheltered", label: "Sheltered", hint: "Full HP. HD: half level recovered. No exhaustion risk. Caves, solid ruins, decent cover." },
                    { value: "rough", label: "Rough", hint: "Full HP. HD: half level minus 1 recovered. CON DC 10 or +1 exhaustion. Open wilderness, exposed camps." },
                    { value: "hostile", label: "Hostile", hint: "3/4 HP. HD: half level minus 2 recovered. CON DC 15 or +1 exhaustion. Enemy territory, cursed ground." }
                ];
                const match = opts.find(o => o.value === defaultComfort);
                if (match) match.label += " (terrain default)";
                return opts;
            })(),
            comfortReason: TerrainRegistry.get(this._selectedTerrain ?? "forest")?.comfortReason ?? "",
            setupStep: this._setupStep ?? 1,
            selectedTerrain: this._selectedTerrain ?? "forest",
            terrainBanner: (() => {
                const t = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
                const p = this._phase ?? "setup";
                
                // All terrains look in their specific folder.
                const filename = (p === "activity" || p === "reflection" || p === "meal") ? "banner.png" : `${p}.png`;
                return ImageResolver.terrainBanner(t, filename);
            })(),
            terrainBannerFallback: ImageResolver.fallbackBanner,
            terrainBannerPos: "center", // banners are pre-cropped 640×120 strips
            selectedTerrainLabel: this._terrainLabel ?? "Forest",
            selectedRestType: this._selectedRestType ?? "long",
            selectedRestTypeLabel: this._selectedRestType === "short" ? "Short Rest" : "Long Rest",
            isShortRest: (this._selectedRestType ?? "long") === "short",
            selectedWeatherLabel: WEATHER_TABLE[this._selectedWeather]?.label ?? "Clear",
            selectedScoutLabel: this._selectedScout ?? "None",
            scoutingAvailable: terrainDefaults.scoutingAvailable ?? false,
            scoutSkill: (() => {
                const g = terrainDefaults.scoutGuidance ?? "";
                return g.startsWith("Investigation") ? "Investigation" : "Survival";
            })(),
            scoutTiers: (() => {
                const g = terrainDefaults.scoutGuidance ?? "";
                const m = g.match(/Poor:\s*([^|]+)\|\s*Average:\s*([^|]+)\|\s*Good:\s*(.+?)\./);
                if (!m) return null;
                return { poor: m[1].trim(), average: m[2].trim(), good: m[3].trim() };
            })(),
            scoutAdvantage: (() => {
                const g = terrainDefaults.scoutGuidance ?? "";
                const parts = g.split(". ").filter(p => p.includes("advantage") || p.includes("disadvantage"));
                return parts.map(p => p.replace(/\.$/, "")).join(". ") || null;
            })(),
            shelterNeeded: (this._selectedTerrain ?? "forest") !== "tavern",
            defaultComfort,
            shelterOptions,
            shelterEffect,
            shelterChosen,
            heroCharacters,
            roster,
            gmRosterChip,
            selfAfk: game.user.isGM
                ? (this._afkCharacters?.has("gm") ?? false)
                : roster.some(r => r.isOwner && r.isAfk),
            selfAfkId: game.user.isGM
                ? "gm"
                : (roster.find(r => r.isOwner)?.id ?? ""),
            selectedCharacter,
            partyCharacters,
            totalCharacters,
            resolvedCount,
            allResolved,
            outcomes: personalOutcomes ?? [],
            triggeredEvents: (this._triggeredEvents ?? []).map(e => {
                // Resolve target IDs to actor names for the template
                const targetNames = (e.targets ?? [])
                    .map(id => game.actors.get(id)?.name)
                    .filter(Boolean);
                const SKILL_NAMES = RestSetupApp.SKILL_NAMES;
                const skillName = e.mechanical?.skill
                    ? (SKILL_NAMES[e.mechanical.skill] ?? e.mechanical.skill)
                    : null;
                // Enrich resolved rolls with ownership for player-side filtering
                const resolvedRolls = (e.resolvedRolls ?? []).map(r => ({
                    ...r,
                    isOwner: game.actors.get(r.characterId)?.isOwner ?? false
                }));
                return { ...e, targetNames, skillName, resolvedRolls };
            }),
            allEventChecksResolved: !(this._triggeredEvents ?? []).some(
                e => e.mechanical?.type === "skill_check" && (!e.resolvedOutcome || e.awaitingRolls)
            ),
            anyEventAwaitingRolls: (this._triggeredEvents ?? []).some(e => e.awaitingRolls),
            pendingEventRoll: this._pendingEventRoll ? (() => {
                // Build list of targets this player owns and hasn't rolled yet
                const ownedTargets = (this._pendingEventRoll.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(a => a?.isOwner)
                    .map(a => ({
                        id: a.id,
                        name: a.name,
                        rolled: this._pendingEventRoll.rolledCharacters?.has(a.id) ?? false
                    }));
                return { ...this._pendingEventRoll, ownedTargets };
            })() : null,
            eventsRolled: this._eventsRolled ?? false,
            pendingCampRolls: this._pendingCampRolls ?? [],
            campPrepsResolved: !this._pendingCampRolls?.length || this._pendingCampRolls.every(p => p.status !== "pending"),
            pendingCampRoll: this._pendingCampRoll ? {
                activities: (this._pendingCampRoll.activities ?? []).filter(a => {
                    const actor = game.actors.get(a.characterId);
                    return actor?.isOwner;
                }).map(a => ({
                    ...a,
                    rolled: this._pendingCampRoll.rolledCharacters?.has(a.characterId) ?? false,
                    status: a.status ?? "pending",
                    total: a.total ?? null
                }))
            } : null,
            disasterChoice: this._disasterChoice ? {
                ...this._disasterChoice,
                normalsLabel: (this._disasterChoice.normals?.length ?? 0) > 1
                    ? "Two Complications"
                    : "One Complication"
            } : null,
            hasEncounterEvent: (this._triggeredEvents ?? []).some(e => e.category === "encounter" && e.resolvedOutcome !== "success") && !this._awaitingCombat && !this._combatAcknowledged,
            combatBuffs: this._combatBuffs ?? null,
            awaitingCombat: this._awaitingCombat ?? false,
            encounterAwareness: (() => {
                const enc = (this._triggeredEvents ?? []).find(e => e.category === "encounter" && e.resolvedOutcome !== "success");
                if (!enc) return null;
                const hints = enc.mechanical?.onFailure?.effects?.find(ef => ef.type === "encounter")?.encounterHints;
                return hints?.awareness ?? null;
            })(),
            fireLevel: this._fireLevel ?? "campfire",
            campfireTokenDetected: CampfireTokenLinker.hasCampfireToken(),
            campfireTokenSettingName: CampfireTokenLinker.getTokenName(),
            activeTreeState: this._activeTreeState,
            engine: this._engine,
            recoverySummary,
            activitySummary,
            partyDiscoveries,
            grantActors: game.actors.filter(a => a.hasPlayerOwner).map(a => ({ id: a.id, name: a.name })),
            activityDetail: this._buildActivityDetailContext(selectedCharacter),
            campStatus: this._engine ? (() => {
                const comfort = this._engine.comfort;

                const weatherKey = this._engine.weather ?? "clear";
                const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
                const weatherParts = [];
                if (wx.comfortPenalty > 0) weatherParts.push(`Comfort -${wx.comfortPenalty} step`);
                if (wx.encounterDC > 0) weatherParts.push(`Encounter DC +${wx.encounterDC}`);
                if (wx.tentCancels) weatherParts.push("Tent cancels");
                else if (wx.tentReduces) weatherParts.push("Tent reduces by 1");
                const SHELTER_TOOLTIPS = {
                    tent: "Tent: +2 encounter DC, cancels or reduces weather",
                    tiny_hut: "Tiny Hut: comfort floor sheltered, +5 encounter DC",
                    rope_trick: "Rope Trick: +5 encounter DC, extradimensional shelter",
                    magnificent_mansion: "Mansion: comfort floor safe, no encounters"
                };
                const FIRE_TIPS = {
                    unlit: "Unlit: -1 comfort step at resolution",
                    embers: "Embers: no comfort change, fire active",
                    campfire: "Campfire: +1 encounter DC (aids watchkeeping)",
                    bonfire: "Bonfire: +1 comfort step, -1 encounter DC (visible)"
                };
                return this._campStatus = {
                    comfort,
                    comfortTooltip: COMFORT_TIPS[comfort] ?? comfort,
                    weather: weatherKey !== "clear" ? weatherKey : null,
                    weatherTooltip: weatherParts.length ? `${wx.label}: ${weatherParts.join(", ")}` : wx.label,
                    fireLevel: this._fireLevel ?? "unlit",
                    fireTooltip: FIRE_TIPS[this._fireLevel ?? "unlit"] ?? "Fire",
                    hasTent: (this._engine.activeShelters ?? []).includes("tent"),
                    activeShelters: (this._engine.activeShelters ?? []).map(id => {
                        const SHELTER_LABELS = { tent: "Tent", tiny_hut: "Tiny Hut", rope_trick: "Rope Trick", magnificent_mansion: "Mansion", none: "Open Air" };
                        const SHELTER_ICONS = { tent: "fas fa-campground", tiny_hut: "fas fa-igloo", rope_trick: "fas fa-hat-wizard", magnificent_mansion: "fas fa-chess-rook", none: "fas fa-cloud-moon" };
                        return { id, name: SHELTER_LABELS[id] ?? id, icon: SHELTER_ICONS[id] ?? "fas fa-shield-alt", tooltip: SHELTER_TOOLTIPS[id] ?? SHELTER_LABELS[id] ?? id };
                    })
                };
            })() : this._campStatus ?? null,
            craftingDrawer: this._buildCraftingDrawerContext(),
            encounterBar: (this._engine && !this._eventsRolled) ? (() => {
                const bd = this._engine._encounterBreakdown ?? {};
                const shelter = bd.shelter ?? 0;
                const weather = bd.weather ?? 0;
                const scouting = bd.scouting ?? 0;
                const fire = this._engine.fireRollModifier ?? 0;
                const gmAdj = this._engine.gmEncounterAdj ?? 0;
                const complication = this._engine.scoutingComplication ?? false;
                const defenses = bd.defenses ?? 0;
                const total = shelter + weather + scouting + fire;
                const terrainTable = this._eventResolver?.tables?.get(this._engine.terrainTag);
                const baseDC = terrainTable?.noEventThreshold ?? 15;
                const effectiveDC = Math.max(1, baseDC - total + gmAdj - defenses);
                console.log(`[Respite:UI] encounterBar — baseDC=${baseDC}, shelter=${shelter}, weather=${weather}, scouting=${scouting}, fire=${fire}, total=${total}, defenses=${defenses}, gmAdj=${gmAdj} → effectiveDC=${effectiveDC}`);
                const fmt = (v) => v > 0 ? `+${v}` : `${v}`;
                const chips = [];
                if (weather !== 0) chips.push({ label: bd.weatherName ?? "Weather", value: fmt(weather), icon: "fas fa-cloud-sun-rain" });
                if (shelter !== 0) chips.push({ label: "Shelter", value: fmt(shelter), icon: "fas fa-campground" });
                if (scouting !== 0) chips.push({ label: `Scout: ${bd.scoutingResult ?? "?"}`, value: fmt(scouting), icon: "fas fa-binoculars" });
                if (complication) chips.push({ label: "Complication", value: "", icon: "fas fa-exclamation-triangle", warn: true });
                if (fire !== 0) chips.push({ label: this._fireLevel ?? "Fire", value: fmt(fire), icon: "fas fa-fire" });
                if (defenses !== 0) chips.push({ label: "Defenses", value: fmt(-defenses), icon: "fas fa-shield-alt" });
                if (gmAdj !== 0) chips.push({ label: "GM", value: fmt(gmAdj), icon: "fas fa-gavel" });
                return {
                    total,
                    baseDC,
                    effectiveDC,
                    totalLabel: `Encounter DC ${effectiveDC}`,
                    chips,
                    complication,
                    isGM: game.user.isGM,
                    gmAdj
                };
            })() : null,
            magicScanResults: this._magicScanResults ?? null,
            magicScanComplete: this._magicScanComplete ?? false,

            // Meal phase context
            mealCards: (() => {
                if (this._phase !== "meal") return null;
                const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
                const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};

                // GM: all characters. Player: only owned characters.
                let characterIds;
                if (this._isGM) {
                    characterIds = this._engine?.characterChoices ? Array.from(this._engine.characterChoices.keys()) : [];
                } else {
                    characterIds = this._myCharacterIds ? Array.from(this._myCharacterIds) : [];
                }

                const allCards = MealPhaseHandler.buildMealContext(
                    characterIds, terrainTag, terrainMealRules,
                    this._daysSinceLastRest ?? 1, this._mealChoices ?? new Map()
                );

                // Mark cards where the owning player has already submitted their choices
                if (this._isGM && this._mealSubmissions) {
                    for (const card of allCards) {
                        const actor = game.actors.get(card.characterId);
                        if (!actor) continue;
                        const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
                        if (ownerUser && this._mealSubmissions.has(ownerUser.id)) {
                            card.playerSubmitted = true;
                        }
                    }
                }

                // GM: filter to selected roster character
                if (this._isGM && this._selectedCharacterId) {
                    const filtered = allCards.filter(c => c.characterId === this._selectedCharacterId);
                    return filtered.length > 0 ? filtered : allCards.slice(0, 1);
                }

                return allCards;
            })(),
            mealSubmitted: this._mealSubmitted ?? false,
            mealSubmissions: this._mealSubmissions ? Object.fromEntries(this._mealSubmissions) : {},
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            // Global multi-day flags (computed from ALL characters, not roster-filtered)
            allMealsConsumed: (() => {
                if (this._phase !== "meal") return false;
                const characterIds = this._engine?.characterChoices ? Array.from(this._engine.characterChoices.keys()) : [];
                if (!characterIds.length) return false;
                const totalDays = Math.max(1, this._daysSinceLastRest ?? 1);
                if (totalDays <= 1) return true; // single-day: no consume step needed
                for (const charId of characterIds) {
                    const choice = this._mealChoices?.get(charId);
                    const consumed = choice?.consumedDays?.length ?? 0;
                    if (consumed < totalDays) return false;
                }
                return true;
            })(),
            pendingDehydrationSaves: this._pendingDehydrationSaves?.length > 0 ? this._pendingDehydrationSaves.length : 0,
            allDehydrationResolved: this._pendingDehydrationSaves?.length > 0 && this._pendingDehydrationSaves.every(s => s.resolved),
            hasUnresolvedSaves: this._pendingDehydrationSaves?.length > 0 && this._pendingDehydrationSaves.some(s => !s.resolved),
            dehydrationResults: (() => {
                // GM: use pending saves data; Player: use broadcast results
                const fromPending = (this._pendingDehydrationSaves ?? []).filter(s => s.resolved).map(s => ({
                    actorName: s.actorName,
                    total: s.total ?? 0,
                    dc: s.dc,
                    passed: s.passed ?? false,
                    reason: s.reason ?? null,
                    pending: false
                }));
                return fromPending.length > 0 ? fromPending : (this._dehydrationResults ?? []);
            })(),
            isMultiDay: (this._daysSinceLastRest ?? 1) > 1,
            mealCurrentDay: (() => {
                if (this._phase !== "meal") return 1;
                const characterIds = this._engine?.characterChoices ? Array.from(this._engine.characterChoices.keys()) : [];
                if (!characterIds.length) return 1;
                let minDay = Infinity;
                for (const charId of characterIds) {
                    const choice = this._mealChoices?.get(charId);
                    const consumed = choice?.consumedDays?.length ?? 0;
                    minDay = Math.min(minDay, consumed + 1);
                }
                return minDay === Infinity ? 1 : minDay;
            })(),
            mealProcessed: this._mealProcessed ?? false,
            mealTerrainNote: (() => {
                if (this._phase !== "meal") return null;
                const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
                return TerrainRegistry.getDefaults(terrainTag)?.mealRules?.note ?? null;
            })()
        };
    }

    /**
     * Builds context data for the inline crafting drawer.
     */
    _buildCraftingDrawerContext() {
        return this._crafting.buildContext();
    }

    /**
     * Builds context data for the activity detail preview panel.
     */
    _buildActivityDetailContext(selectedCharacter) {
        if (!this._activityDetailId || !selectedCharacter) return null;

        // Find the tile from the selected character's tiles
        const allTiles = [
            ...(selectedCharacter.tileCategories?.flatMap(c => c.tiles) ?? []),
            ...(selectedCharacter.professionTiles ?? [])
        ];
        const tile = allTiles.find(t => t.id === this._activityDetailId);
        if (!tile) return null;

        // Build outcome hints from success, exceptional, and failure
        const outcomeHints = [];
        if (tile.outcomes?.success?.effects?.length) {
            for (const eff of tile.outcomes.success.effects) {
                outcomeHints.push({ text: eff.description, type: "success" });
            }
        }
        if (tile.outcomes?.exceptional?.effects?.length) {
            for (const eff of tile.outcomes.exceptional.effects) {
                outcomeHints.push({ text: eff.description, type: "exceptional" });
            }
        }
        if (tile.outcomes?.failure?.effects?.length) {
            for (const eff of tile.outcomes.failure.effects) {
                outcomeHints.push({ text: eff.description, type: "failure" });
            }
        }

        // Build follow-up interactive data for GM
        let followUpData = null;
        if (tile.followUp) {
            const currentValue = this._getFollowUpForCharacter(selectedCharacter.id)
                ?? this._gmFollowUps?.get(selectedCharacter.id) ?? null;
            followUpData = {
                type: tile.followUp.type,
                label: tile.followUp.label,
                currentValue
            };

            if (tile.followUp.type === "partyMember") {
                const partyActors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character" && a.id !== selectedCharacter.id);
                followUpData.options = partyActors.sort((a, b) => {
                    const aRatio = a.system.attributes?.hp?.value / a.system.attributes?.hp?.max;
                    const bRatio = b.system.attributes?.hp?.value / b.system.attributes?.hp?.max;
                    return aRatio - bRatio;
                }).map(a => {
                    const hp = a.system.attributes?.hp;
                    const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
                    return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
                });
            } else if (tile.followUp.type === "radio" || tile.followUp.type === "select") {
                const selectedVal = currentValue || tile.followUp.default || tile.followUp.options?.[0]?.value;

                // Copy Spell: enrich options with gold awareness
                if (tile.id === "act_scribe") {
                    const actor = game.actors.get(selectedCharacter.id);
                    const currentGold = actor?.system?.currency?.gp ?? 0;
                    followUpData.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;

                    followUpData.options = tile.followUp.options.map(opt => {
                        const cost = parseInt(opt.value, 10) * 50;
                        const canAfford = currentGold >= cost;
                        return {
                            ...opt,
                            label: canAfford ? opt.label : `${opt.label} (can't afford)`,
                            isSelected: opt.value === selectedVal,
                            isDisabled: !canAfford
                        };
                    });
                } else {
                    followUpData.options = tile.followUp.options.map(opt => ({
                        ...opt,
                        isSelected: opt.value === selectedVal
                    }));
                }

                // Safety net: if somehow no option is selected, force-select the first
                if (followUpData.options?.length && !followUpData.options.some(o => o.isSelected)) {
                    followUpData.options[0].isSelected = true;
                }
            } else if (tile.followUp.type === "actorItem" && tile.followUp.filter === "attuneable") {
                const actor = game.actors.get(selectedCharacter.id);
                const attuneItems = (actor?.items ?? []).filter(i => {
                    const att = i.system?.attunement;
                    // Requires attunement but NOT currently attuned
                    return (att === "required" || att === 1) && !i.system?.attuned;
                });
                followUpData.options = attuneItems.map(i => ({
                    value: i.id,
                    label: i.name,
                    isSelected: i.id === currentValue
                }));
                // Attunement slot counter
                const attunement = actor?.system?.attributes?.attunement;
                if (attunement) {
                    const current = attunement.value ?? 0;
                    const max = attunement.max ?? 3;
                    followUpData.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
                }
            }
        }

        // Build armor-aware hint (gated by Xanathar's rest rules setting)
        let armorHint = null;
        try {
            const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
            if (armorRuleEnabled) {
                const actor = game.actors.get(selectedCharacter.id);
                const equippedArmor = actor?.items?.find(i => i.type === "equipment" && i.system?.equipped && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type));
                if (equippedArmor && tile.armorSleepWaiver) {
                    armorHint = { text: "Sleeping light between rotations. Armor stays on, weapon close. No HP or HD recovery penalty.", type: "positive" };
                } else if (equippedArmor && !tile.armorSleepWaiver) {
                    // Resting activities: armor sleep penalty applies
                    armorHint = { text: "Sleeping in armor. Recover only 1/4 Hit Dice, exhaustion not reduced (Xanathar's). Consider doffing first.", type: "warning" };
                }
            }
        } catch (e) { /* setting may not exist yet */ }

        return {
            id: tile.id,
            name: tile.name,
            description: tile.description || "No additional details available.",
            icon: tile.icon,
            typeTag: tile.typeTag,
            isCrafting: tile.isCrafting,
            profession: tile.profession,
            check: tile.check ? this._formatCheckLabel(tile.check, selectedCharacter) : null,
            outcomeHints,
            combatModifiers: tile.combatModifiers ?? null,
            followUpData,
            armorHint,
            characterId: selectedCharacter.id
        };
    }

    /**
     * Formats a check label, resolving "best" ability to the character's highest score.
     */
    _formatCheckLabel(check, character) {
        let abilityLabel = check.ability?.toUpperCase() ?? "";

        if (check.ability === "best" && character?.id) {
            const actor = game.actors.get(character.id);
            if (actor?.system?.abilities) {
                const abilities = actor.system.abilities;
                let bestKey = null;
                let bestVal = -1;
                for (const [key, data] of Object.entries(abilities)) {
                    const val = data.value ?? 0;
                    if (val > bestVal) { bestVal = val; bestKey = key; }
                }
                if (bestKey) abilityLabel = `${bestKey.toUpperCase()} (${bestVal})`;
            }
        }

        const skillPart = check.skill ? ` (${check.skill})` : "";
        return `${abilityLabel}${skillPart} DC ${check.dc ?? "?"}`;
    }

    _onRender(context, options) {
        // Re-center window vertically after content changes
        requestAnimationFrame(() => {
            const el = this.element;
            if (!el) return;
            const h = el.offsetHeight;
            const top = Math.max(10, (window.innerHeight - h) / 2);
            this.setPosition({ top });
        });

        // Bind meal drag-drop when in meal phase
        if (this._phase === "meal") {
            this._bindMealDragDrop(this.element);
        }

        // Auto-open or re-mount campfire drawer when meal/activity/reflection phase renders
        if (this._phase === "meal" || this._phase === "activity" || this._phase === "reflection") {
            const drawerContainer = this.element?.querySelector(".campfire-drawer-content");
            if (!this._campfireApp && drawerContainer) {
                // First open (or re-open after _campfireApp was lost)
                this._openCampfire();
                // Restore from saved snapshot if available
                if (this._campfireSnapshot && this._campfireApp) {
                    this._campfireApp._lit = this._campfireSnapshot.lit;
                    this._campfireApp._litBy = this._campfireSnapshot.litBy;
                    this._campfireApp._heat = this._campfireSnapshot.heat;
                    this._campfireApp._strikeCount = this._campfireSnapshot.strikeCount;
                    this._campfireApp._kindlingPlaced = this._campfireSnapshot.kindlingPlaced;
                    this._campfireApp._peakHeat = this._campfireSnapshot.peakHeat;
                    this._campfireApp._lastFireLevel = this._campfireSnapshot.lastFireLevel;
                    this._campfireApp.render();
                }
            } else if (this._campfireApp && drawerContainer) {
                // Save state before re-mount (DOM was replaced)
                this._campfireSnapshot = {
                    lit: this._campfireApp._lit,
                    litBy: this._campfireApp._litBy,
                    heat: this._campfireApp._heat,
                    strikeCount: this._campfireApp._strikeCount,
                    kindlingPlaced: this._campfireApp._kindlingPlaced,
                    peakHeat: this._campfireApp._peakHeat,
                    lastFireLevel: this._campfireApp._lastFireLevel
                };
                // Re-mount to fresh DOM container
                this._campfireApp._container = drawerContainer;
                this._campfireApp.render();
                // Re-expand instantly (no animation) if user hasn't manually collapsed
                const drawer = this.element?.querySelector(".campfire-drawer");
                if (drawer && !this._campfireCollapsed) {
                    drawer.style.transition = "none";
                    drawer.classList.add("open");
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            drawer.style.transition = "";
                        });
                    });
                }
            }
        }

        // GM follow-up input binding (Tier 2 activity pickers)
        const gmFollowUpPanel = this.element.querySelector(".gm-followup");
        if (gmFollowUpPanel) {
            const charId = gmFollowUpPanel.dataset.characterId;
            const inputs = gmFollowUpPanel.querySelectorAll(".gm-followup-input");
            for (const input of inputs) {
                input.addEventListener("change", () => {
                    if (input.type === "radio") {
                        if (input.checked) this._gmFollowUps.set(charId, input.value);
                    } else {
                        this._gmFollowUps.set(charId, input.value);
                    }
                });
            }
            // Auto-set default for first render if no value exists
            if (!this._gmFollowUps.has(charId)) {
                const firstSelect = gmFollowUpPanel.querySelector("select");
                const checkedRadio = gmFollowUpPanel.querySelector("input[type=radio]:checked");
                if (firstSelect?.value) this._gmFollowUps.set(charId, firstSelect.value);
                else if (checkedRadio?.value) this._gmFollowUps.set(charId, checkedRadio.value);
            }
        }

        // Rest type toggle buttons: update hidden input + hints on click
        const restTypeButtons = this.element.querySelectorAll('.rest-type-btn');
        const restTypeInput = this.element.querySelector('[name="restType"]');
        const restTypeHint = this.element.querySelector('.rest-type-hint');
        const terrainHint = this.element.querySelector('.terrain-hint');
        if (restTypeButtons.length && restTypeInput) {
            const hints = {
                long: "8 hrs. HP and Hit Dice recovery varies by comfort and conditions.",
                short: "1 hr. Spend Hit Dice to heal. Continue to pick a shelter."
            };
            const terrainHintShort = "Sets the backdrop for the rest.";
            // Cache server-rendered terrain hint for restoration
            if (terrainHint && !terrainHint.dataset.longHint) {
                terrainHint.dataset.longHint = terrainHint.textContent;
            }
            const _applyRestType = (value) => {
                const isShort = value === "short";
                restTypeInput.value = value;
                restTypeButtons.forEach(btn => {
                    btn.classList.toggle("active", btn.dataset.restType === value);
                });
                if (restTypeHint) restTypeHint.textContent = hints[value] ?? "";
                if (terrainHint) {
                    terrainHint.textContent = isShort
                        ? terrainHintShort
                        : (terrainHint.dataset.longHint ?? terrainHint.textContent);
                }
                const daysBlock = this.element.querySelector(".days-since-rest-block");
                if (daysBlock) daysBlock.style.display = isShort ? "none" : "";
            };
            restTypeButtons.forEach(btn => {
                btn.addEventListener("click", () => _applyRestType(btn.dataset.restType));
            });
            // Apply initial state from hidden input value
            _applyRestType(restTypeInput.value ?? "long");
        }

        // Comfort hint: update on dropdown change
        const comfortSelect = this.element.querySelector('[name="comfort"]');
        const comfortHint = this.element.querySelector('.comfort-hint');
        if (comfortSelect && comfortHint) {
            comfortSelect.addEventListener("change", () => {
                const selected = comfortSelect.options[comfortSelect.selectedIndex];
                comfortHint.textContent = selected?.title ?? "";
            });
        }

        // Terrain change: update weather dropdown options
        const terrainSelect = this.element.querySelector('[name="terrain"]');
        if (terrainSelect) {
            terrainSelect.addEventListener("change", () => {
                this._selectedTerrain = terrainSelect.value;
                this.render();
            });
        }

        // Weather hint: update on dropdown change
        const weatherSelect = this.element.querySelector('[name="weather"]');
        const weatherHint = this.element.querySelector('.weather-hint');
        if (weatherSelect && weatherHint) {
            weatherSelect.addEventListener("change", () => {
                const selected = weatherSelect.options[weatherSelect.selectedIndex];
                weatherHint.textContent = selected?.title ?? "";
            });
        }

        // Scouting hint: update on dropdown change with terrain flavor text
        const scoutingSelect = this.element.querySelector('[name="scouting"]');
        const scoutingHint = this.element.querySelector('.scouting-hint');
        if (scoutingSelect && scoutingHint) {
            scoutingSelect.addEventListener("change", () => {
                const selected = scoutingSelect.options[scoutingSelect.selectedIndex];
                const scoutVal = selected?.value;
                const terrain = this._selectedTerrain ?? "forest";
                const flavorPool = TerrainRegistry.getDefaults(terrain)?.scoutFlavor?.[scoutVal];
                const flavor = flavorPool ? flavorPool[Math.floor(Math.random() * flavorPool.length)] : "";
                const mechanic = selected?.title ?? "";
                scoutingHint.innerHTML = flavor
                    ? `<em>"${flavor}"</em><br>${mechanic}`
                    : mechanic;
                updatePreview();
            });
        }

        // Live preview bar: compute effective comfort + encounter DC
        const previewComfort = this.element.querySelector('#preview-comfort');
        const previewEncounter = this.element.querySelector('#preview-encounter');

        const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
        const COMFORT_LABELS = { hostile: "Hostile", rough: "Rough", sheltered: "Sheltered", safe: "Safe" };

        const updatePreview = () => {
            if (!previewComfort || !previewEncounter) return;

            // Base comfort from dropdown
            const baseComfort = comfortSelect?.value ?? "sheltered";
            let comfortIdx = COMFORT_TIERS.indexOf(baseComfort);
            if (comfortIdx < 0) comfortIdx = 1;

            // Scouting bonus
            const scoutVal = scoutingSelect?.value ?? "none";
            if (scoutVal === "average" || scoutVal === "good") comfortIdx += 1;
            else if (scoutVal === "nat20") comfortIdx += 2;

            // Weather penalty
            const weatherVal = weatherSelect?.value ?? "clear";
            const weatherData = WEATHER_TABLE[weatherVal];
            if (weatherData?.comfortPenalty) comfortIdx -= weatherData.comfortPenalty;

            // Clamp
            comfortIdx = Math.max(0, Math.min(COMFORT_TIERS.length - 1, comfortIdx));
            const effectiveComfort = COMFORT_TIERS[comfortIdx];
            previewComfort.textContent = COMFORT_LABELS[effectiveComfort];

            // Color code
            const comfortColors = { hostile: "#e55", rough: "#e95", sheltered: "#eb5", safe: "#5e8" };
            previewComfort.style.color = comfortColors[effectiveComfort] ?? "#fff";

            // Encounter DC modifier
            let encounterMod = weatherData?.encounterDC ?? 0;
            if (scoutVal === "good") encounterMod += 1;
            const sign = encounterMod >= 0 ? "+" : "";
            previewEncounter.textContent = `${sign}${encounterMod}`;
            previewEncounter.style.color = encounterMod > 0 ? "#5e8" : encounterMod < 0 ? "#e55" : "rgba(255,255,255,0.6)";

            // Nat 1 hidden complication indicator
            let complicationEl = this.element.querySelector('#preview-complication');
            if (!complicationEl) {
                complicationEl = document.createElement("div");
                complicationEl.id = "preview-complication";
                complicationEl.className = "preview-complication";
                previewEncounter.closest('.setup-preview')?.appendChild(complicationEl);
            }
            if (scoutVal === "nat1") {
                complicationEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Hidden complication will trigger during events`;
                complicationEl.style.display = "";
            } else {
                complicationEl.style.display = "none";
            }
        };

        // Hook into all dropdowns
        if (weatherSelect) weatherSelect.addEventListener("change", updatePreview);
        if (comfortSelect) comfortSelect.addEventListener("change", updatePreview);
        // Initial computation
        updatePreview();

        // Bind click events on activity tiles
        const tiles = this.element.querySelectorAll(".activity-tile");
        for (const tile of tiles) {
            tile.addEventListener("click", () => {
                const grid = tile.closest(".activity-grid");
                const characterId = grid?.dataset.characterId;
                const activityId = tile.dataset.activityId;
                if (!characterId || !activityId) return;

                // Block if crafting picker is open for this character
                if (this._craftingInProgress?.has(characterId)) return;

                // Crafting tiles: open the crafting drawer directly
                if (tile.dataset.isCrafting === "true") {
                    const syntheticTarget = { dataset: { characterId, profession: tile.dataset.profession } };
                    RestSetupApp.#onOpenCrafting.call(this, null, syntheticTarget);
                    return;
                }

                // Non-crafting tiles: open the detail preview panel
                this._activityDetailId = activityId;
                this.render();
            });
        }

        // Bind confirm buttons (player only)
        const confirmBtns = this.element.querySelectorAll(".btn-confirm-activity");
        for (const btn of confirmBtns) {
            btn.addEventListener("click", () => {
                const characterId = btn.dataset.characterId;
                const activityId = this._pendingSelections?.get(characterId);
                if (!characterId || !activityId) return;

                // Block if crafting picker is open for this character
                if (this._craftingInProgress?.has(characterId)) return;

                // Check if this is a crafting activity - open picker instead of locking
                const activity = this._activities?.find(a => a.id === activityId);
                if (activity?.crafting?.enabled) {
                    const syntheticTarget = { dataset: { characterId, profession: activity.crafting.profession } };
                    RestSetupApp.#onOpenCrafting.call(this, null, syntheticTarget);
                    this._pendingSelections.delete(characterId);
                    return;
                }

                // Lock and submit
                this._characterChoices.set(characterId, activityId);
                this._lockedCharacters.add(characterId);
                this._pendingSelections.delete(characterId);

                // Early resolve: roll the activity now so the player sees results immediately
                const actor = game.actors.get(characterId);

                // Copy Spell: send proposal via socket instead of resolving immediately
                // This runs outside the _engine guard because players don't have the engine
                if (activityId === "act_scribe" && actor) {
                    const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
                    const spellLevel = parseInt(followUpValue, 10) || 1;
                    const cost = spellLevel * 50;
                    const dc = 10 + spellLevel;

                    if (game.user.isGM) {
                        // GM initiated: send proposal to player for gold approval
                        CopySpellHandler.sendProposal(characterId, spellLevel);
                    } else {
                        // Player initiated: notify GM
                        game.socket.emit(`module.${MODULE_ID}`, {
                            type: "copySpellProposal",
                            actorId: characterId,
                            actorName: actor.name,
                            spellLevel,
                            cost,
                            dc,
                            initiatedBy: game.user.name
                        });
                    }

                    this._earlyResults.set(characterId, {
                        source: "activity",
                        activityId,
                        result: "pending_approval",
                        narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
                    });
                    this.render();
                } else if (actor && this._engine) {
                    const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
                    this._activityResolver.resolve(
                        activityId, actor, this._engine.terrainTag, this._engine.comfort, { followUpValue }
                    ).then(result => {
                        this._earlyResults.set(characterId, result);
                        const tier = result.result === "exceptional" ? "Exceptional!"
                            : result.result === "success" ? "Success"
                            : result.result === "failure_complication" ? "Failed (complication)"
                            : result.result === "failure" ? "Failed" : result.result;
                        const actName = activity?.name ?? activityId;
                        ui.notifications.info(`${actor.name}: ${actName} - ${tier}`);
                        this.render();
                    });
                }

                // Optimistic UI update
                let mySub = this._playerSubmissions.get(game.user.id) || { choices: {}, userName: game.user.name, timestamp: Date.now() };
                mySub.choices[characterId] = activityId;
                this._playerSubmissions.set(game.user.id, mySub);

                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "activityChoice",
                    userId: game.user.id,
                    choices: Object.fromEntries(this._characterChoices)
                });

                const actName = activity?.name ?? activityId;
                ui.notifications.info(`${game.actors.get(characterId)?.name ?? "Character"} will ${actName}.`);
                this.render();
            });
        }

        // Roster chip click: switch selected character
        const rosterChips = this.element.querySelectorAll("[data-roster-id]");
        for (const chip of rosterChips) {
            chip.addEventListener("click", () => {
                if (chip.classList.contains("not-owned")) return;
                const charId = chip.dataset.rosterId;
                if (!charId || charId === this._selectedCharacterId) return;
                this._selectedCharacterId = charId;
                this._activityDetailId = null;
                this._craftingDrawerOpen = false;
                this.render();
            });
        }

        // AFK checkboxes (both GM and player)
        // Armor doff/don toggles
        const armorToggles = this.element.querySelectorAll(".btn-armor-toggle");
        for (const btn of armorToggles) {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const actorId = btn.dataset.actorId;
                const itemId = btn.dataset.itemId;
                const isDoffed = btn.dataset.isDoffed === "true";
                if (!actorId || !itemId) return;

                const actor = game.actors.get(actorId);
                const item = actor?.items.get(itemId);
                if (!item) return;

                if (!this._doffedArmor) this._doffedArmor = new Map();

                if (isDoffed) {
                    // Don: re-equip
                    await item.update({ "system.equipped": true });
                    this._doffedArmor.delete(actorId);
                } else {
                    // Doff: unequip
                    await item.update({ "system.equipped": false });
                    this._doffedArmor.set(actorId, itemId);
                }

                // Broadcast armor toggle to all clients
                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "armorToggle",
                    actorId,
                    itemId,
                    isDoffed: !isDoffed
                });

                this.render();
            });
        }

        const afkBoxes = this.element.querySelectorAll(".afk-checkbox");
        for (const box of afkBoxes) {
            box.addEventListener("change", () => {
                const charId = box.dataset.characterId;
                if (box.checked) {
                    this._afkCharacters.add(charId);
                } else {
                    this._afkCharacters.delete(charId);
                }
                // Broadcast AFK status
                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "afkUpdate",
                    characterId: charId,
                    isAfk: box.checked,
                    characterName: game.actors.get(charId)?.name ?? "Unknown"
                });
                this.render();
            });
        }
    }

    // ──────── Static action handlers ────────

    /**
     * Toggle a shelter option in the setup form.
     */
    static #onToggleShelter(event, target) {
        const shelterId = target.dataset.shelterId;
        if (!shelterId) return;
        if (!this._shelterOverrides) this._shelterOverrides = {};

        // Radio-style: deselect all others, toggle the clicked one
        const wasActive = !!this._shelterOverrides[shelterId];
        for (const key of Object.keys(this._shelterOverrides)) {
            this._shelterOverrides[key] = false;
        }
        this._shelterOverrides[shelterId] = !wasActive;

        this.render();
    }

    /** Setup wizard: advance to next section, capturing form values. */
    static #onSetupContinue(event, target) {
        const step = parseInt(target.dataset.step, 10);
        const form = this.element.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};

        if (step === 1) {
            this._selectedTerrain = formData.terrain ?? this._selectedTerrain ?? "forest";
            this._selectedRestType = formData.restType ?? "long";
            const terrainOpt = this.element.querySelector('[name="terrain"] option:checked');
            this._terrainLabel = terrainOpt?.textContent?.trim()?.replace(" (last used)", "") ?? this._selectedTerrain;
            // Persist last-used terrain
            game.settings.set(MODULE_ID, "lastTerrain", this._selectedTerrain);
            this._daysSinceLastRest = this._daysSinceLastRest ?? 1;

            // Short rest: advance to shelter step (step 2) instead of bypassing entirely
            if (this._selectedRestType === "short") {
                if (!this._shelterOverrides) this._shelterOverrides = {};
                this._setupStep = 2;
                this.render();
                return;
            }
        } else if (step === 2) {
            this._selectedWeather = formData.weather ?? "clear";
            this._selectedComfort = formData.comfort ?? "sheltered";
            this._selectedScoutingValue = formData.scouting ?? "none";
            this._selectedScout = this.element.querySelector('[name="scouting"] option:checked')?.textContent?.trim() ?? "None";
            // Skip shelter for tavern
            if (this._selectedTerrain === "tavern") {
                this._setupStep = 3;
                this.render();
                return;
            }
        }

        this._setupStep = step + 1;
        this.render();
    }

    /** Setup wizard: go back to a previous section. */
    static #onSetupBack(event, target) {
        const step = parseInt(target.dataset.step, 10);
        this._setupStep = step;
        this.render();
    }

    /** Adjust days since last rest via +/- stepper buttons. */
    static #onAdjustDaysSinceRest(event, target) {
        const delta = parseInt(target.dataset.delta, 10) || 0;
        this._daysSinceLastRest = Math.max(1, Math.min(9, (this._daysSinceLastRest ?? 1) + delta));
        this.render();
    }

    /** Setup wizard: skip to section 3 with defaults. */
    static #onSetupDefaults(event, target) {
        const form = this.element.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};
        this._selectedTerrain = formData.terrain ?? this._selectedTerrain ?? "forest";
        this._selectedRestType = formData.restType ?? "long";

        const terrainOpt = this.element.querySelector('[name="terrain"] option:checked');
        this._terrainLabel = terrainOpt?.textContent?.trim() ?? this._selectedTerrain;
        this._selectedWeather = "clear";
        this._selectedComfort = "sheltered";
        this._selectedScoutingValue = "none";
        this._selectedScout = "None";
        this._setupStep = 3;
        this.render();
    }

    static #onEncounterAdjUp(event, target) {
        if (!game.user.isGM || !this._engine) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) + 1;
        this.render({ force: true });
    }

    static #onEncounterAdjDown(event, target) {
        if (!game.user.isGM || !this._engine) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) - 1;
        this.render({ force: true });
    }

    /**
     * Toggle AFK status for a character (or GM). GM-only control.
     * Broadcasts the change to all players via socket.
     */
    static #onAfkToggle(event, target) {
        const rosterId = target.dataset.rosterId
            ?? target.closest("[data-roster-id]")?.dataset.rosterId;
        if (!rosterId) return;

        if (!this._afkCharacters) this._afkCharacters = new Set();

        // Build list of IDs to toggle
        let ids = [rosterId];

        // If this is the AFK button, toggle ALL owned characters
        const isBtn = target.closest(".roster-afk-btn") || target.classList?.contains("roster-afk-btn");
        if (isBtn) {
            if (game.user.isGM) {
                ids = ["gm"];
            } else {
                ids = game.actors
                    .filter(a => a.hasPlayerOwner && a.isOwner && a.type === "character")
                    .map(a => a.id);
            }
        } else {
            // Roster chip click: GM can toggle individual characters
            if (!game.user.isGM) return;
        }

        // Simple toggle: if all are AFK, un-AFK. Otherwise, mark all AFK.
        const allAfk = ids.every(id => this._afkCharacters.has(id));
        const newState = !allAfk;

        for (const id of ids) {
            if (newState) {
                this._afkCharacters.add(id);
            } else {
                this._afkCharacters.delete(id);
            }

            game.socket.emit(`module.${MODULE_ID}`, {
                type: "afkUpdate",
                characterId: id,
                isAfk: newState
            });
        }

        this.render();
    }

    /**
     * Player action: roll a camp activity check (Set Up Defenses, Scout Perimeter).
     * Mirrors the event roll check pattern.
     */
    static async #onRollCampCheck(event, target) {
        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = this._pendingCampRoll;
        if (!pending || !characterId) return;

        const activityEntry = pending.activities?.find(a => a.characterId === characterId);
        if (!activityEntry) return;

        const actor = game.actors.get(characterId);
        if (!actor || !actor.isOwner) return;

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        // Build roll using the actor's actual skill modifier (bypasses Midi-QoL wrapper issues)
        const skillData = actor.system?.skills?.[activityEntry.skill];
        const modifier = skillData?.total ?? 0;
        console.log(`[Respite:CampRoll] ${actor.name} rolling ${activityEntry.skillName} (${activityEntry.skill}), modifier: ${modifier}`);
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${actor.name}</strong> - ${activityEntry.activityName} (${activityEntry.skillName}) DC ${activityEntry.dc}`
        });

        // Disable roll button
        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;

        // Wait for Dice So Nice
        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                Hooks.once("diceSoNiceRollComplete", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        // Mark as rolled locally
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

        // Send result to GM
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campRollResult",
            characterId,
            characterName: actor.name,
            activityId: activityEntry.activityId,
            total
        });

        ui.notifications.info(`${actor.name} rolled ${total} for ${activityEntry.activityName}.`);
        this.render();
    }

    /**
     * GM adjusts camp activity DC for a specific character.
     */
    static #onAdjustCampDC(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        const delta = parseInt(target.dataset.delta) || 0;
        if (!characterId || !delta) return;

        const entry = this._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        entry.dc = Math.max(1, entry.dc + delta);

        // GM-local only: re-render to show updated DC. Player sees final DC only when GM sends request.
        this.render();
    }

    /**
     * GM requests a camp activity roll from a specific player.
     */
    static #onRequestCampRoll(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = this._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        // Mark as requested so controls disable and snapshot only sends released entries
        entry.requested = true;

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                eventsRolled: this._eventsRolled ?? false,
                fireLevel: this._fireLevel,
                campStatus: this._campStatus,
                campRollRequest: {
                    activities: [{
                        characterId: entry.characterId,
                        activityId: entry.activityId,
                        activityName: entry.activityName,
                        skill: entry.skill,
                        skillName: entry.skillName,
                        dc: entry.dc,
                        status: entry.status,
                        total: entry.total
                    }]
                }
            }
        });

        ui.notifications.info(`Roll request sent to ${entry.characterName} for ${entry.activityName}.`);
        this.render();
    }


    /**
     * GM receives a camp activity roll result from a player.
     * Updates _pendingCampRolls, consumes effects, re-renders.
     */
    receiveCampRollResult(data) {
        if (!this._pendingCampRolls) return;

        const entry = this._pendingCampRolls.find(
            p => p.characterId === data.characterId && p.activityId === data.activityId
        );
        if (!entry) return;

        entry.total = data.total;
        entry.status = data.total >= entry.dc ? "pass" : "fail";

        // Look up the activity for narrative/effect data
        const activity = this._activities?.find(a => a.id === data.activityId);
        const outcomeKey = entry.status === "pass" ? "success" : "failure";
        const outcome = activity?.outcomes?.[outcomeKey];

        // Store narrative and effects on the pending entry for GM display
        entry.narrative = outcome?.narrative ?? "";
        entry.effectDescriptions = (outcome?.effects ?? []).map(e => e.description).filter(Boolean);

        // Consume encounter_reduction effect for Set Up Defenses success
        if (entry.status === "pass" && entry.activityId === "act_defenses") {
            const defenseMod = 2; // encounter_reduction value from activity data
            if (this._engine?._encounterBreakdown) {
                this._engine._encounterBreakdown.defenses = defenseMod;
            }
        }

        // Store early result so it's not re-rolled at resolution
        this._earlyResults.set(data.characterId, {
            source: "activity",
            activityId: data.activityId,
            result: entry.status === "pass" ? "success" : "failure",
            total: data.total,
            effects: outcome?.effects ?? [],
            narrative: entry.narrative
        });

        // Check if all camp rolls are resolved
        const allDone = this._pendingCampRolls.every(p => p.status !== "pending");

        // Broadcast updated state to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                eventsRolled: this._eventsRolled ?? false,
                fireLevel: this._fireLevel,
                campStatus: this._campStatus,
                campRollsUpdate: this._pendingCampRolls.map(p => ({
                    characterId: p.characterId,
                    activityName: p.activityName,
                    status: p.status,
                    total: p.total,
                    narrative: p.narrative ?? "",
                    effectDescriptions: p.effectDescriptions ?? []
                }))
            }
        });

        this.render();
    }

    /**
     * Resolve a skill check event. Auto-rolls using the best watcher's modifier,
     * or force-sets the outcome if GM overrides.
     */
    static async #onResolveSkillCheck(event, target) {
        if (!game.user.isGM) return;
        event.preventDefault?.();

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const outcomeMode = target.dataset.outcome ?? target.closest("[data-outcome]")?.dataset.outcome ?? "auto";
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent || !triggeredEvent.mechanical) return;

        // Block if another event is currently awaiting rolls (prevent multi-event collision)
        const anotherAwaiting = (this._triggeredEvents ?? []).some(
            (e, i) => i !== eventIndex && e.awaitingRolls
        );
        if (anotherAwaiting) {
            ui.notifications.warn("Resolve the current event check before starting another.");
            return;
        }

        const dc = triggeredEvent.mechanical.dc ?? 10;
        const skill = triggeredEvent.mechanical.skill ?? "sur";

        const skillKey = skill;

         let outcome = outcomeMode;

        if (outcomeMode === "auto") {
            // Instead of rolling here, broadcast a roll request to players
            const watchIds = triggeredEvent.targets ?? [];
            const actors = watchIds.length > 0
                ? watchIds.map(id => game.actors.get(id)).filter(Boolean)
                : game.actors.filter(a => a.hasPlayerOwner);

            const pendingRolls = actors.map(a => a.id);
            triggeredEvent.awaitingRolls = true;
            triggeredEvent.pendingRolls = [...pendingRolls];
            triggeredEvent.resolvedRolls = [];

            const skillName = RestSetupApp.SKILL_NAMES[skill] ?? skill;

            // Broadcast roll request to players
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "eventRollRequest",
                eventIndex,
                skill: skillKey,
                skillName,
                dc,
                targets: pendingRolls,
                eventTitle: triggeredEvent.title ?? "Event"
            });

            // Also broadcast the updated event state so players see the pending UI
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "phaseChanged",
                phase: "events",
                phaseData: {
                    triggeredEvents: this._triggeredEvents,
                    activeTreeState: this._activeTreeState,
                    eventsRolled: true,
                    campStatus: this._campStatus
                }
            });

            await this._saveRestState();
            this.render();
            return; // Wait for player results via receiveRollResult
        }

        // Force Pass/Fail: resolve immediately
        triggeredEvent.resolvedOutcome = outcome;

        // Broadcast to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                campStatus: this._campStatus
            }
        });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM receives a skill check roll result from a player.
     * Collects results and auto-resolves when all expected rolls are in.
     */
    async receiveRollResult(data) {
        if (!game.user.isGM) return;
        const { eventIndex, characterId, characterName, total } = data;
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent || !triggeredEvent.awaitingRolls) return;

        const dc = triggeredEvent.mechanical?.dc ?? 10;
        const passed = total >= dc;

        // Add to resolved rolls (avoid duplicates)
        if (!triggeredEvent.resolvedRolls) triggeredEvent.resolvedRolls = [];
        if (triggeredEvent.resolvedRolls.some(r => r.characterId === characterId)) return;
        triggeredEvent.resolvedRolls.push({ characterId, name: characterName, total, passed });

        // Remove from pending
        if (triggeredEvent.pendingRolls) {
            triggeredEvent.pendingRolls = triggeredEvent.pendingRolls.filter(id => id !== characterId);
        }

        // Check if all rolls are in
        if (!triggeredEvent.pendingRolls?.length) {
            // All rolls received -- auto-resolve
            const rolls = triggeredEvent.resolvedRolls;
            const checkPolicy = triggeredEvent.mechanical.checkPolicy ?? "group";

            if (checkPolicy === "individual") {
                // Individual: per-character consequences
                // Overall outcome = majority for summary display
                const passCount = rolls.filter(r => r.passed).length;
                const outcome = passCount > rolls.length / 2 ? "success" : "failure";
                triggeredEvent.resolvedOutcome = outcome;
                triggeredEvent.checkPolicy = "individual";
                // Per-character outcomes already embedded in each roll's .passed
            } else {
                // Group: average of all rolls vs DC
                const avg = rolls.reduce((sum, r) => sum + r.total, 0) / rolls.length;
                const roundedAvg = Math.round(avg);
                triggeredEvent.groupAverage = roundedAvg;

                let outcome;
                if (roundedAvg >= dc + 5 || rolls.every(r => r.passed)) {
                    outcome = "success";
                } else if (roundedAvg >= dc) {
                    // Partial: average passes but not by much
                    outcome = triggeredEvent.mechanical.onPartial ? "partial" : "success";
                } else {
                    outcome = "failure";
                }
                triggeredEvent.resolvedOutcome = outcome;
                triggeredEvent.checkPolicy = "group";
            }

            triggeredEvent.awaitingRolls = false;
            triggeredEvent.resolvedRoller = rolls.find(r => r.total === Math.max(...rolls.map(r2 => r2.total)))?.name ?? "Unknown";
            triggeredEvent.resolvedRollTotal = Math.max(...rolls.map(r => r.total));

            // Let the last dice animation settle before showing verdict
            if (game.modules.get("dice-so-nice")?.active) {
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 4000);
                    Hooks.once("diceSoNiceRollComplete", () => { clearTimeout(timeout); resolve(); });
                });
            }
        }

        // Broadcast updated state to all players (partial or complete)
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                campStatus: this._campStatus
            }
        });

        this._saveRestState();
        this.render();
    }

    /**
     * Player receives a roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     */
    receiveRollRequest(data) {
        this._pendingEventRoll = {
            eventIndex: data.eventIndex,
            skill: data.skill,
            skillName: data.skillName,
            dc: data.dc,
            targets: data.targets ?? [],
            eventTitle: data.eventTitle,
            rolledCharacters: new Set()
        };
        this.render();
    }

    /**
     * Player action: roll a skill check for an owned character.
     * Posts the roll to chat and sends the result back to the GM.
     */
    static async #onRollEventCheck(event, target) {
        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = this._pendingEventRoll;
        if (!pending || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        // Verify this player owns this actor
        if (!actor.isOwner) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        // Build roll using actor's actual skill modifier (bypasses Midi-QoL wrapper issues)
        const skillData = actor.system?.skills?.[pending.skill];
        const modifier = skillData?.total ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        const msg = await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${actor.name}</strong> attempts ${pending.skillName} check (DC ${pending.dc})`
        });
        const rollMessageId = msg?.id ?? null;

        // Disable the button to prevent double-clicks
        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;

        // Wait for Dice So Nice animation to complete (if present)
        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000); // 5s safety fallback
                Hooks.once("diceSoNiceRollComplete", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        // Mark as rolled locally
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

        // Send result to GM
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "eventRollResult",
            eventIndex: pending.eventIndex,
            characterId,
            characterName: actor.name,
            total
        });

        ui.notifications.info(`${actor.name} rolled ${total} for ${pending.skillName}.`);
        this.render();
    }

    /**
     * Toggle expand/collapse on a resolved event card.
     */
    static #onToggleResolvedEvent(event, target) {
        const card = target.closest(".respite-event-card");
        if (card) card.classList.toggle("collapsed");
    }

    /**
     * Grant a discovered item to a selected actor.
     * Rolls quantity dice, creates item on actor sheet via ItemOutcomeHandler.
     */
    static async #onGrantDiscoveryItem(event, target) {
        if (!game.user.isGM) return;

        const grantKey = target.dataset.grantKey;
        const itemRef = target.dataset.itemRef;
        const quantity = target.dataset.quantity;

        // Find the sibling select element for actor selection
        const row = target.closest(".party-discovery-item");
        const select = row?.querySelector(".discovery-actor-select");
        const actorId = select?.value;

        if (!actorId || !itemRef) {
            ui.notifications.warn("Select a character to receive the items.");
            return;
        }

        try {
            const { ItemOutcomeHandler } = await import("../services/ItemOutcomeHandler.js");
            const result = await ItemOutcomeHandler.grantToActor(actorId, itemRef, quantity);

            // Track the grant
            this._grantedDiscoveries.set(grantKey, result);
            ui.notifications.info(`Granted ${result.rolled}x ${result.itemName} to ${result.actorName}.`);
            this.render();
        } catch (e) {
            console.error(`[Respite] Failed to grant item:`, e);
            ui.notifications.error(`Failed to grant ${itemRef}: ${e.message}`);
        }
    }

    /**
     * Begin Short Rest: reads selected shelter and launches ShortRestApp.
     * Called from the short-rest shelter step (step 2).
     */
    static async #onBeginShortRest(event, target) {
        // Find the active shelter from overrides (the one marked active)
        const activeShelter = Object.entries(this._shelterOverrides ?? {})
            .find(([, v]) => v)?.[0] ?? "none";
        this.close();
        new ShortRestApp({ initialShelter: activeShelter }).render({ force: true });
    }

    /**
     * Phase 1 -> 2: Begin rest, broadcast to all connected players.
     */
    static async #onBeginRest(event, target) {
        const form = this.element.querySelector("form");
        const formData = Object.fromEntries(new FormData(form));

        const terrainTag = this._selectedTerrain ?? formData.terrain ?? "forest";
        await this._loadTerrainEvents(terrainTag);

        // Determine shelter effects from active overrides
        const activeShelters = Object.entries(this._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        let shelterComfortFloor = null;
        let shelterEncounterMod = 0;
        const SHELTER_EFFECTS = {
            tent: { comfortFloor: null, encounterMod: 2 },
            tiny_hut: { comfortFloor: "sheltered", encounterMod: 5 },
            rope_trick: { comfortFloor: null, encounterMod: 5 },
            magnificent_mansion: { comfortFloor: "safe", encounterMod: 99 }
        };
        const COMFORT_RANK = RestSetupApp.COMFORT_RANK;
        for (const id of activeShelters) {
            const effect = SHELTER_EFFECTS[id];
            if (!effect) continue;
            shelterEncounterMod = Math.max(shelterEncounterMod, effect.encounterMod);
            if (effect.comfortFloor && (COMFORT_RANK[effect.comfortFloor] ?? 0) > (COMFORT_RANK[shelterComfortFloor] ?? -1)) {
                shelterComfortFloor = effect.comfortFloor;
            }
        }

        // Apply comfort floor override from shelters (Tiny Hut, Mansion)
        let effectiveComfort = this._selectedComfort ?? formData.comfort ?? "sheltered";
        if (shelterComfortFloor && (COMFORT_RANK[shelterComfortFloor] ?? 0) > (COMFORT_RANK[effectiveComfort] ?? 0)) {
            effectiveComfort = shelterComfortFloor;
        }

        // Scouting: adjust comfort and encounter DC
        const scouting = this._selectedScoutingValue ?? formData.scouting ?? "none";
        const SCOUTING_EFFECTS = {
            none:    { comfortBonus: 0, encounterDC: 0, complication: false },
            nat1:    { comfortBonus: 0, encounterDC: 0, complication: true },
            poor:    { comfortBonus: 0, encounterDC: 0, complication: false },
            average: { comfortBonus: 1, encounterDC: 0, complication: false },
            good:    { comfortBonus: 1, encounterDC: 1, complication: false },
            nat20:   { comfortBonus: 2, encounterDC: 0, complication: false }
        };
        const scout = SCOUTING_EFFECTS[scouting] ?? SCOUTING_EFFECTS.none;
        if (scout.comfortBonus > 0) {
            let rank = COMFORT_RANK[effectiveComfort] ?? 2;
            rank = Math.min(3, rank + scout.comfortBonus);
            effectiveComfort = RestSetupApp.RANK_TO_KEY[rank];
        }

        // Weather penalty: reduce comfort unless shelter cancels
        const weather = this._selectedWeather ?? formData.weather ?? "clear";
        const wx = WEATHER_TABLE[weather] ?? WEATHER_TABLE.clear;
        const hasTentActive = activeShelters.includes("tent");
        const hasHutActive = activeShelters.some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

        // Hut cancels all weather. Tent fully cancels (tentCancels) or partially reduces (tentReduces).
        let weatherPenalty = wx.comfortPenalty;
        let weatherCancelled = false;
        if (hasHutActive) {
            weatherPenalty = 0;
            weatherCancelled = true;
        } else if (hasTentActive) {
            if (wx.tentCancels) {
                weatherPenalty = 0;
                weatherCancelled = true;
            } else if (wx.tentReduces) {
                weatherPenalty = Math.max(0, weatherPenalty - 1);
            }
        }

        if (weatherPenalty > 0) {
            let rank = COMFORT_RANK[effectiveComfort] ?? 2;
            rank = Math.max(0, rank - weatherPenalty);
            effectiveComfort = RestSetupApp.RANK_TO_KEY[rank];
        }

        // Add weather encounter DC modifier
        const weatherEncounterMod = weatherCancelled ? 0 : (wx.encounterDC ?? 0);
        const scoutEncounterMod = scout.encounterDC ?? 0;

        this._engine = new RestFlowEngine({
            restType: formData.restType ?? "long",
            terrainTag,
            comfort: effectiveComfort
        });
        this._engine.shelterEncounterMod = shelterEncounterMod + weatherEncounterMod + scoutEncounterMod;
        // Store individual modifiers for encounter bar breakdown
        this._engine._encounterBreakdown = {
            shelter: shelterEncounterMod,
            weather: weatherEncounterMod,
            scouting: scoutEncounterMod,
            weatherName: weather,
            scoutingResult: scouting
        };
        this._engine.gmEncounterAdj = this._engine.gmEncounterAdj ?? 0;
        this._engine.activeShelters = activeShelters;
        this._engine.weather = weather;
        this._engine.scoutingResult = scouting;
        this._engine.scoutingComplication = scout.complication;
        // Store base DC from terrain table on engine for event roll threshold calculation
        const terrainTable = this._eventResolver?.tables?.get(terrainTag);
        this._engine._baseDC = terrainTable?.noEventThreshold ?? 15;
        this._engine.setup();

        const restPayload = {
            restId: `rest_${Date.now()}`,
            terrainTag: this._engine.terrainTag,
            comfort: this._engine.comfort,
            restType: this._engine.restType,
            activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine.recipes)
        };

        setActiveRestData(restPayload);

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "restStarted",
            restData: restPayload
        });

        ui.notifications.info("Rest phase started. Activity pickers sent to all players.");
        this._phase = "activity";
        // Reset event-related state from any prior rest
        this._eventsRolled = false;
        this._triggeredEvents = [];
        this._earlyResults = new Map();
        this._disasterChoice = null;
        this._activeTreeState = null;
        await this._saveRestState();

        // Campfire opens after render (see _onRender)
        this.render();
    }

    /**
     * GM manually overrides a character's activity selection.
     */
    static #onGmOverride(event, target) {
        const characterId = target.dataset.characterId;
        const activityId = target.value;

        if (activityId) {
            this._gmOverrides.set(characterId, activityId);
        } else {
            this._gmOverrides.delete(characterId);
        }

        this._rebuildCharacterChoices();
        this._saveRestState();
        this.render();

        // Broadcast updated submission status to players
        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: this._gmOverrides.has(charId) ? "gm" : "player" };
        }
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "submissionUpdate",
            submissions
        });
    }

    /**
     * Opens the CraftingPickerApp for a character.
     * GM: stores result locally, broadcasts submission update.
     * Player: auto-submits choice + crafting result to GM.
     */
    static #onOpenCrafting(event, target) {
        const characterId = target.dataset.characterId;
        const profession = target.dataset.profession;
        if (!characterId || !profession) return;

        // Block re-crafting for locked characters
        if (this._lockedCharacters?.has(characterId)) {
            ui.notifications.warn("This character has already submitted their activity.");
            return;
        }

        // Open inline crafting drawer
        this._craftingDrawerOpen = true;
        this._craftingDrawerProfession = profession;
        this._craftingDrawerRecipeId = null;
        this._craftingDrawerRisk = "standard";
        this._craftingDrawerResult = null;
        this._craftingDrawerHasCrafted = false;
        this._craftingDrawerShowMissing = false;

        // Mark crafting as in progress
        if (!this._craftingInProgress) this._craftingInProgress = new Set();
        this._craftingInProgress.add(characterId);
        this._pendingSelections?.delete(characterId);
        this.render();
    }

    /**
     * Crafting drawer: select a recipe.
     */
    static #onCraftDrawerSelectRecipe(event, target) { this._crafting.onSelectRecipe(event, target); }
    static #onCraftDrawerSelectRisk(event, target) { this._crafting.onSelectRisk(event, target); }
    static async #onCraftDrawerCraft(event, target) { await this._crafting.onCraft(event, target); }
    static #onCraftDrawerToggleMissing(event, target) { this._crafting.onToggleMissing(event, target); }
    static #onCraftDrawerClose(event, target) { this._crafting.onClose(event, target); }

    /**
     * Activity detail panel: confirm the selected activity.
     */
    static #onActivityDetailConfirm(event, target) {
        const characterId = this._selectedCharacterId;
        const activityId = this._activityDetailId;
        if (!characterId || !activityId) return;

        // Armor sleep penalty confirmation (gated by Xanathar's setting)
        if (!this._armorConfirmed) {
            try {
                const armorRuleEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
                if (armorRuleEnabled) {
                    const actor = game.actors.get(characterId);
                    const equippedArmor = actor?.items?.find(i =>
                        i.type === "equipment" && i.system?.equipped &&
                        ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                    );
                    const activity = this._activities?.find(a => a.id === activityId);
                    if (equippedArmor && !activity?.armorSleepWaiver) {
                        const armorType = equippedArmor.system?.type?.value ?? "heavy";
                        // Custom modal overlay (not Foundry Dialog) for full styling control
                        const overlay = document.createElement("div");
                        overlay.classList.add("ionrift-armor-modal-overlay");
                        overlay.innerHTML = `
                            <div class="ionrift-armor-modal">
                                <h3><i class="fas fa-shield-alt"></i> Sleeping in Armor</h3>
                                <p><strong>${actor.name}</strong> is wearing <strong>${equippedArmor.name}</strong> (${armorType}).</p>
                                <p>Sleeping in medium or heavy armor reduces Hit Dice recovery to 1/4 and prevents exhaustion reduction (Xanathar's).</p>
                                <p>Confirm this activity, or go back and doff armor first?</p>
                                <div class="ionrift-armor-modal-buttons">
                                    <button class="btn-armor-confirm"><i class="fas fa-check"></i> Confirm</button>
                                    <button class="btn-armor-cancel"><i class="fas fa-times"></i> Go Back</button>
                                </div>
                            </div>`;
                        document.body.appendChild(overlay);
                        overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                            overlay.remove();
                            this._armorConfirmed = true;
                            RestSetupApp.#onActivityDetailConfirm.call(this, event, target);
                        });
                        overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                            overlay.remove();
                        });
                        return;
                    }
                }
            } catch (e) { /* setting may not exist */ }
        }
        this._armorConfirmed = false;

        if (this._isGM) {
            // Check if player already submitted for this character
            const actor = game.actors.get(characterId);
            const ownerUser = actor ? game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) : null;
            const playerAlreadySubmitted = ownerUser && this._playerSubmissions?.has(ownerUser.id);
            if (playerAlreadySubmitted && !this._gmOverrides.has(characterId)) {
                ui.notifications.warn(`${actor.name}'s player already submitted. Overriding their choice.`);
            }
            // GM: override + broadcast
            this._gmOverrides.set(characterId, activityId);
            this._characterChoices.set(characterId, activityId);
            this._rebuildCharacterChoices();

            const submissions = {};
            for (const [charId, actId] of this._characterChoices) {
                const act = this._activities?.find(a => a.id === actId);
                submissions[charId] = {
                    activityId: actId,
                    activityName: act?.name ?? actId,
                    source: this._gmOverrides.has(charId) ? "gm" : "player"
                };
            }
            game.socket.emit(`module.${MODULE_ID}`, { type: "submissionUpdate", submissions });
        } else {
            // Player: submit + lock
            this._characterChoices.set(characterId, activityId);
            this._lockedCharacters = this._lockedCharacters ?? new Set();
            this._lockedCharacters.add(characterId);

            // Copy Spell: send proposal to GM instead of normal submission
            if (activityId === "act_scribe") {
                const actor = game.actors.get(characterId);
                // Read followUp value from the dropdown in the detail panel
                const followUpEl = this.element?.querySelector(".gm-followup-input");
                const followUpValue = followUpEl?.value ?? "1";
                const spellLevel = parseInt(followUpValue, 10) || 1;
                const cost = spellLevel * 50;
                const dc = 10 + spellLevel;

                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "copySpellProposal",
                    actorId: characterId,
                    actorName: actor?.name ?? "Unknown",
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });

                // Show pending state
                this._earlyResults = this._earlyResults ?? new Map();
                this._earlyResults.set(characterId, {
                    source: "activity",
                    activityId,
                    result: "pending_approval",
                    narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
                });

                if (actor) ui.notifications.info(`${actor.name}: Copy Spell Level ${spellLevel} submitted.`);
            } else {
                const actor = game.actors.get(characterId);
                if (actor) ui.notifications.info(`${actor.name}'s activity submitted.`);
            }

            game.socket.emit(`module.${MODULE_ID}`, {
                type: "activityChoice",
                userId: game.user.id,
                choices: Object.fromEntries(this._characterChoices)
            });
        }

        this._activityDetailId = null;
        this.render();
    }

    /**
     * Activity detail panel: go back to the activity grid.
     */
    static #onActivityDetailBack(event, target) {
        this._activityDetailId = null;
        this.render();
    }

    /**
     * Phase 2 -> 3: Lock in all choices, transition to events phase.
     * Event roll is deferred until GM clicks 'Roll for Events'.
     */
    static async #onSubmitActivities(event, target) {
        for (const [characterId, activityId] of this._characterChoices) {
            const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
            this._engine.registerChoice(characterId, activityId, { followUpValue });
        }

        // Short rest: skip reflection and events entirely
        if (this._engine.restType === "short") {
            this._triggeredEvents = [];
            this._eventsRolled = true;
            this._phase = "resolve";
        } else {
            // Long rest: check if food tracking is enabled
            const trackFood = game.settings.get(MODULE_ID, "trackFood");
            const terrainTag = this._engine?.terrainTag ?? "forest";
            const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};

            // Skip meal phase if tracking is off or tavern provides food
            if (!trackFood || (terrainMealRules.waterPerDay === 0 && terrainMealRules.foodPerDay === 0)) {
                this._phase = "reflection";
            } else {
                // Initialize meal state
                this._mealChoices = this._mealChoices ?? new Map();
                this._daysSinceLastRest = this._daysSinceLastRest ?? 1;
                this._phase = "meal";
            }
        }

        // Broadcast phase change to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: this._phase,
            phaseData: {
                campStatus: this._campStatus,
                daysSinceLastRest: this._daysSinceLastRest ?? 1,
                selectedTerrain: this._selectedTerrain ?? "forest"
            }
        });

        await this._saveRestState();
        this.render();
    }

    /**
     * Opens the campfire as a slide-out drawer inside the rest window.
     */
    _openCampfire() {
        if (this._campfireApp) return;

        // Magical shelters block campfire (sealed dome, no ventilation, etc.)
        const magicalShelters = ["tiny_hut", "rope_trick", "magnificent_mansion"];
        const activeShelterIds = Object.entries(this._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        if (activeShelterIds.some(id => magicalShelters.includes(id))) {
            console.log(`${MODULE_ID} | Campfire skipped: magical shelter active`);
            return;
        }

        console.log(`${MODULE_ID} | _openCampfire called, isGM=${game.user.isGM}`);

        try {
            const drawerContainer = this.element?.querySelector(".campfire-drawer-content");
            if (!drawerContainer) {
                console.warn(`${MODULE_ID} | No .campfire-drawer-content found in DOM`);
                return;
            }

            const restApp = this;
            this._campfireApp = new CampfireEmbed(drawerContainer, {
                onFireLevelChange: (level) => {
                    restApp._fireLevel = level;
                    // Save snapshot on every fire level change
                    if (restApp._campfireApp) {
                        restApp._campfireSnapshot = {
                            lit: restApp._campfireApp._lit,
                            litBy: restApp._campfireApp._litBy,
                            heat: restApp._campfireApp._heat,
                            strikeCount: restApp._campfireApp._strikeCount,
                            kindlingPlaced: restApp._campfireApp._kindlingPlaced,
                            peakHeat: restApp._campfireApp._peakHeat,
                            lastFireLevel: restApp._campfireApp._lastFireLevel
                        };
                    }
                    // Update fire level badge without full re-render
                    const badge = restApp.element?.querySelector(".camp-status-chip.fire-chip");
                    if (badge) {
                        const textEl = badge.querySelector(".fire-level-text");
                        if (textEl) textEl.textContent = level;
                        badge.className = badge.className.replace(/fire-(unlit|embers|campfire|bonfire)/g, `fire-${level}`);
                        badge.title = `Fire: ${level}`;
                    }
                    // Re-render activity tiles when fire level changes (cook/brew availability)
                    if (restApp._lastRenderedFireLevel !== level) {
                        restApp._lastRenderedFireLevel = level;
                        restApp.render({ force: true });
                    }
                    restApp._saveRestState();
                }
            });
            registerCampfireApp(this._campfireApp);

            // Render campfire into the drawer
            this._campfireApp.render().then(() => {
                console.log(`${MODULE_ID} | CampfireEmbed rendered into drawer`);
                // Expand the window to show the drawer
                const drawer = this.element?.querySelector(".campfire-drawer");
                if (drawer) drawer.classList.add("open");
            }).catch(err => {
                console.error(`${MODULE_ID} | CampfireEmbed render failed:`, err);
            });
        } catch (err) {
            console.error(`${MODULE_ID} | _openCampfire error:`, err);
        }
    }

    /**
     * Closes the campfire drawer.
     */
    _closeCampfire() {
        if (this._campfireApp) {
            this._campfireApp.destroy();
            this._campfireApp = null;
            clearCampfireApp();
        }
        const drawer = this.element?.querySelector(".campfire-drawer");
        if (drawer) drawer.classList.remove("open");

        // Turn off the campfire token's light on the canvas
        CampfireTokenLinker.setLightState(false);
    }

    /**
     * Phase 3 (reflection): GM adjusts the campfire level.
     * Syncs fire level to all players.
     */
    static async #onSetFireLevel(event, target) {
        const level = target.dataset.fireLevel;
        if (!level) return;
        this._fireLevel = level;

        // Sync to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "reflection",
            phaseData: { fireLevel: level }
        });

        this.render();
    }

    // ── Meal Phase Handlers ──────────────────────────────────────

    /**
     * Bind drag-and-drop for meal inventory items onto plate/goblet drop zones.
     * Pattern mirrors CampfireApp._bindTrinketDragDrop.
     */
    _bindMealDragDrop(el) {
        if (!el) return;
        if (this._mealSubmitted) return; // Lock UI after submission

        // Clear any stuck drag classes from previous render cycles or cancelled drags
        el.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
        el.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));

        const items = el.querySelectorAll(".meal-inv-item[draggable]");
        const dropZones = el.querySelectorAll(".meal-drop-zone");

        // Helper: set choice for a slot (both food and water are arrays)
        const setChoice = (charId, slot, itemId, slotIndex) => {
            if (!this._mealChoices) this._mealChoices = new Map();
            const existing = this._mealChoices.get(charId) ?? {};
            const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];

            // Check available quantity -- prevent over-assignment
            const trayItem = el.querySelector(`.meal-inv-item[data-item-id="${itemId}"][data-slot="${slot}"][data-character-id="${charId}"]`);
            const available = trayItem ? parseInt(trayItem.dataset.available || "1") : 1;
            const alreadyAssigned = arr.filter(v => v === itemId).length;

            // If assigning to a specific slot that already has this item, it's a re-assign (allow)
            const isReassign = slotIndex !== undefined && arr[slotIndex] === itemId;
            if (!isReassign && alreadyAssigned >= available) {
                ui.notifications.warn(`Not enough ${slot === "food" ? "rations" : "water"} to fill another slot.`);
                return;
            }

            if (slotIndex !== undefined) {
                arr[slotIndex] = itemId;
            } else {
                // Fill first empty slot
                const emptyIdx = arr.findIndex(v => !v || v === "skip");
                if (emptyIdx >= 0) {
                    arr[emptyIdx] = itemId;
                } else {
                    arr.push(itemId);
                }
            }
            this._mealChoices.set(charId, { ...existing, [slot]: arr });
            this.render();
        };

        // Draggable + clickable inventory items
        for (const item of items) {
            if (item._mealBound) continue;
            item._mealBound = true;
            item.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", `meal:${item.dataset.slot}:${item.dataset.itemId}:${item.dataset.characterId}`);
                item.classList.add("dragging");
            });
            item.addEventListener("dragend", () => item.classList.remove("dragging"));

            // Click to select
            item.addEventListener("click", () => {
                const slot = item.dataset.slot;
                const charId = item.dataset.characterId;
                const itemId = item.dataset.itemId;
                if (!slot || !charId || !itemId) return;
                setChoice(charId, slot, itemId);
            });
        }

        // Drop zones (plates and goblets)
        for (const zone of dropZones) {
            if (zone._mealBound) continue;
            zone._mealBound = true;
            const slot = zone.dataset.slot;
            const charId = zone.dataset.characterId;
            const slotIndex = zone.dataset.slotIndex !== undefined ? parseInt(zone.dataset.slotIndex) : undefined;

            zone.addEventListener("dragover", (e) => {
                if (!e.dataTransfer.types.includes("text/plain")) return;
                e.preventDefault();
                zone.classList.add("drop-hover");
            });

            zone.addEventListener("dragleave", () => zone.classList.remove("drop-hover"));

            zone.addEventListener("drop", (e) => {
                e.preventDefault();
                zone.classList.remove("drop-hover");
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw?.startsWith("meal:")) return;

                const [, dragSlot, itemId, dragCharId] = raw.split(":");
                if (dragSlot !== slot || dragCharId !== charId) return;
                setChoice(charId, slot, itemId, slotIndex);
            });

            // Click on filled zone = clear it
            zone.addEventListener("click", () => {
                if (!this._mealChoices) return;
                const existing = this._mealChoices.get(charId) ?? {};
                const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];
                if (slotIndex !== undefined && arr[slotIndex] && arr[slotIndex] !== "skip") {
                    arr[slotIndex] = "skip";
                    this._mealChoices.set(charId, { ...existing, [slot]: arr });
                    this.render();
                }
            });
        }
    }

    /**
     * Meal: GM selects a food option for a character.
     */
    static #onMealSelectFood(event, target) { this._meals.onSelectFood(event, target); }
    static #onMealSelectWater(event, target) { this._meals.onSelectWater(event, target); }

    /**
     * Meal: Consume the current day's food/water for all owned characters.
     * Deducts items from inventory immediately, saves state, advances to next day.
     */
    static async #onConsumeMealDay(event, target) { await this._meals.onConsumeMealDay(event, target); }

    /**
     * Meal: Player submits their meal choices via socket to the GM.
     */
    static async #onSubmitMealChoices(event, target) { await this._meals.onSubmitMealChoices(event, target); }

    /**
     * GM receives meal choices from a player via socket.
     * Merges into _mealChoices and tracks submission status.
     */
    receiveMealChoices(userId, choices) { this._meals.receiveMealChoices(userId, choices); }

    async receiveMealDayConsumed(userId, clientChoices) { await this._meals.receiveMealDayConsumed(userId, clientChoices); }

    async receiveDehydrationPrompt(characterId, actorName, dc) { await this._meals.receiveDehydrationPrompt(characterId, actorName, dc); }

    async receiveDehydrationResult(data) { await this._meals.receiveDehydrationResult(data); }

    /**
     * Meal -> Reflection: GM proceeds from meal phase.
     * Applies consumption (decrements rations/waterskin) and updates tracking flags.
     */
    static async #onProceedFromMeal(event, target) { await this._meals.onProceedFromMeal(event, target); }

    /**
     * GM skips all unresolved dehydration saves, auto-failing them.
     * Applies exhaustion and posts chat for each, then unblocks the flow.
     */
    static async #onSkipPendingSaves(event, target) { await this._meals.onSkipPendingSaves(event, target); }

    /**
     * Phase 3 (reflection) -> 4 (events): GM moves past campfire to the night.
     * Applies fire level comfort modifications before events.
     */
    static async #onProceedToEvents(event, target) {
        // Read peak fire level from campfire app if available
        if (this._campfireApp) {
            const level = this._campfireApp.peakFireLevel;
            if (level && level !== "unlit") {
                this._fireLevel = level;
            }
        }

        // Apply fire level comfort modifications
        // Unlit: -1 comfort step | Embers: 0 | Campfire: 0 | Bonfire: +1 comfort step
        const FIRE_COMFORT_MOD = { unlit: -1, embers: 0, campfire: 0, bonfire: 1 };
        const fireComfortMod = FIRE_COMFORT_MOD[this._fireLevel] ?? 0;
        if (fireComfortMod !== 0 && this._engine) {
            const COMFORT_RANK = RestSetupApp.COMFORT_RANK;
            let rank = COMFORT_RANK[this._engine.comfort] ?? 1;
            rank = Math.max(0, Math.min(3, rank + fireComfortMod));
            this._engine.comfort = RestSetupApp.RANK_TO_KEY[rank];
        }

        // Fire encounter DC modifier:
        // Unlit: 0 | Embers: 0 | Campfire: +1 (light aids watchkeeping) | Bonfire: -1 (visible from a distance)
        const FIRE_ENCOUNTER_MOD = { unlit: 0, embers: 0, campfire: 1, bonfire: -1 };
        if (this._engine) {
            this._engine.fireRollModifier = FIRE_ENCOUNTER_MOD[this._fireLevel] ?? 0;
        }

        // Close campfire panel
        this._closeCampfire();

        this._eventsRolled = false;
        console.log(`[Respite:State] #onProceedToEvents — eventsRolled reset to false`);
        this._phase = "events";

        // ── Camp Preparations: identify camp activities needing pre-event rolls ──
        this._pendingCampRolls = [];
        const campActivities = (this._activities ?? []).filter(a => a.category === "camp");
        const partyActors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");

        for (const actor of partyActors) {
            const gmOverride = this._gmOverrides.get(actor.id);
            const playerChoice = this._getPlayerChoiceForCharacter(actor.id);
            const activityId = gmOverride ?? playerChoice?.activityId ?? null;
            if (!activityId) continue;

            const activity = campActivities.find(a => a.id === activityId);
            if (!activity) continue;

            if (!activity.check) {
                // Keep Watch: no check, auto-resolve immediately
                this._earlyResults.set(actor.id, {
                    source: "activity",
                    activityId,
                    result: "success",
                    effects: activity.outcomes?.success?.effects ?? [],
                    narrative: activity.outcomes?.success?.narrative ?? activity.description
                });
                continue;
            }

            // Activity needs a player roll (Set Up Defenses, Scout Perimeter)
            // Calculate adjusted DC with comfort friction
            const comfortDcMod = { safe: 0, sheltered: 0, rough: 2, hostile: 5 };
            const baseDc = activity.check.dc ?? 12;
            const adjustedDc = baseDc + (comfortDcMod[this._engine?.comfort] ?? 0);

            // Determine best skill for this character
            let skillKey = activity.check.skill;
            if (activity.check.altSkill) {
                const primary = actor.system?.skills?.[activity.check.skill]?.total ?? 0;
                const alt = actor.system?.skills?.[activity.check.altSkill]?.total ?? 0;
                if (alt > primary) skillKey = activity.check.altSkill;
            }
            const skillName = RestSetupApp.SKILL_NAMES[skillKey] ?? skillKey;

            this._pendingCampRolls.push({
                characterId: actor.id,
                characterName: actor.name,
                activityId,
                activityName: activity.name,
                icon: activity.id === "act_defenses" ? "fas fa-shield-alt" : "fas fa-binoculars",
                skill: skillKey,
                skillName,
                dc: adjustedDc,
                baseDC: adjustedDc,
                requested: false,
                status: "pending",
                total: null,
                result: null
            });
        }

        await this._saveRestState();

        // Broadcast phase change (camp roll requests are sent individually via GM "request roll" button)
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                eventsRolled: false,
                fireLevel: this._fireLevel,
                campStatus: this._campStatus
            }
        });

        this.render();
    }

    /**
     * Phase 3: GM rolls for events. Performs the actual event table roll
     * and displays results.
     */
    static async #onRollEvents(event, target) {
        // Debug: force an encounter event if flag is set
        if (this._forceEncounter) {
            this._forceEncounter = false;
            const terrainTag = this._engine?.terrainTag ?? "forest";
            const table = this._eventResolver.tables.get(terrainTag);
            if (table) {
                const encounterEntry = table.entries.find(e => {
                    const ev = this._eventResolver.events.get(e.eventId);
                    return ev?.category === "encounter";
                });
                if (encounterEntry) {
                    const ev = this._eventResolver.events.get(encounterEntry.eventId);
                    const targets = game.actors.filter(a => a.hasPlayerOwner).map(a => a.id);
                    this._triggeredEvents = [{
                        id: ev.id, name: ev.name, category: ev.category,
                        description: ev.description, mechanical: ev.mechanical,
                        isDecisionTree: ev.mechanical?.type === "decision_tree",
                        targets, rollTotal: 1, result: "triggered",
                        narrative: ev.description,
                        items: ev.mechanical?.onSuccess?.items ?? [],
                        effects: ev.mechanical?.onFailure?.effects ?? []
                    }];
                    ui.notifications.info(`Forced encounter: ${ev.name}`);
                } else {
                    this._triggeredEvents = await this._engine.resolveEvents(this._eventResolver, this._engine._encounterBreakdown?.scoutingResult);
                }
            } else {
                this._triggeredEvents = await this._engine.resolveEvents(this._eventResolver, this._engine._encounterBreakdown?.scoutingResult);
            }
        } else {
            this._triggeredEvents = await this._engine.resolveEvents(this._eventResolver, this._engine._encounterBreakdown?.scoutingResult);
        }

        // Check for disaster choice (nat 1)
        if (this._triggeredEvents.disasterChoice) {
            this._disasterChoice = this._triggeredEvents.disasterChoice;
            this._triggeredEvents = []; // Clear until GM picks
            this._eventsRolled = true;
            await this._saveRestState();
            this.render();
            return; // Wait for GM to pick via #onDisasterChoice
        }

        this._eventsRolled = true;
        console.log(`[Respite:State] #onRollEvents — eventsRolled set to true, events=${this._triggeredEvents?.length ?? 0}`);

        // Store combat buff summary for UI display when encounter detected
        const hasEncounter = this._triggeredEvents?.some(e => e.category === "encounter" || e.category === "combat");
        if (hasEncounter && this._engine && this._activityResolver) {
            const buffs = this._engine.aggregateCombatBuffs(this._activityResolver);
            this._combatBuffs = buffs;
            if (buffs.perCharacter.length > 0) {
                const lines = buffs.perCharacter.map(b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`);
                if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
                await ChatMessage.create({
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        // Check for decision tree events
        const treeEvent = this._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
        }

        // Broadcast results to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true
            }
        });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM acknowledges an encounter event and begins combat.
     * Sets awaitingCombat flag, saves state, and closes the rest window
     * so the GM can set up the fight. The GM indicator bar will appear.
     */
    static async #onAcknowledgeEncounter(event, target) {
        this._awaitingCombat = true;
        this._combatAcknowledged = false;
        this._combatBuffs = this._combatBuffs ?? null;
        await this._saveRestState();

        // Broadcast to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                awaitingCombat: true
            }
        });

        ui.notifications.info("Set up and run the encounter. Reopen Respite and click 'Combat Complete' when done.");

        // Close the window (GM indicator bar will show)
        this.close();
    }

    /**
     * GM marks the encounter combat as complete.
     * Clears the awaiting flag so the GM can proceed to resolution.
     */
    static async #onCompleteEncounter(event, target) {
        this._awaitingCombat = false;
        this._combatAcknowledged = true;
        await this._saveRestState();

        // Broadcast to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                awaitingCombat: false
            }
        });

        this.render();
    }

    /**
     * Hide the rest window during combat without ending the rest.
     * GM can reopen via the persistent GM banner.
     */
    static #onHideWindow(event, target) {
        this.close();
    }

    /**
     * Detect Magic: scan party inventories for unidentified magical items.
     */
    static async #onDetectMagicScan(event, target) {

        const { DetectMagicScanner } = await import("../services/DetectMagicScanner.js");

        // Get party actors directly (same source as _prepareContext, not engine.roster)
        const actorIds = game.actors
            .filter(a => a.hasPlayerOwner && a.type === "character")
            .map(a => a.id);
        console.log(`[Respite:Scan] Scanning ${actorIds.length} actors:`, actorIds);
        const results = DetectMagicScanner.scanParty(actorIds);

        this._magicScanResults = results;
        this._magicScanComplete = true;

        if (results.length === 0) {
            ui.notifications.info("No unidentified magical items detected among the party's gear.");
        }

        this.render();
    }

    /**
     * Identify a specific scanned item via ritual casting.
     */
    static async #onIdentifyScannedItem(event, target) {
        if (!game.user.isGM) return;

        const actorId = target.dataset.actorId;
        const itemId = target.dataset.itemId;
        if (!actorId || !itemId) return;

        try {
            const { DetectMagicScanner } = await import("../services/DetectMagicScanner.js");
            const result = await DetectMagicScanner.identifyItem(actorId, itemId);

            // Mark as identified in local scan results
            if (this._magicScanResults) {
                for (const actorResult of this._magicScanResults) {
                    if (actorResult.actorId === actorId) {
                        const item = actorResult.items.find(i => i.itemId === itemId);
                        if (item) {
                            item.identified = true;
                            item.trueName = result.trueName;
                            item.requiresAttunement = result.requiresAttunement;
                        }
                    }
                }
            }

            ui.notifications.info(`Identified: ${result.trueName} (${DetectMagicScanner.schoolLabel(result.school)})`);
            this.render();
        } catch (e) {
            console.error(`[Respite] Failed to identify item:`, e);
            ui.notifications.error(`Failed to identify item: ${e.message}`);
        }
    }

    /**
     * GM: Abandon the active rest after confirmation.
     * Clears state, notifies players, and closes the window.
     */
    static async #onAbandonRest(event, target) {
        if (!game.user.isGM) return;

        const confirmed = await new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal">
                    <h3><i class="fas fa-exclamation-triangle"></i> Abandon Rest?</h3>
                    <p>This will cancel the rest for all players. Any unsaved progress will be lost.</p>
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="fas fa-times"></i> Abandon</button>
                        <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Continue Resting</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                overlay.remove();
                resolve(true);
            });
            overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                overlay.remove();
                resolve(false);
            });
        });
        if (!confirmed) return;

        // Clear persisted rest state
        await game.settings.set(MODULE_ID, "activeRest", {});

        // Broadcast to players so they close their windows
        game.socket.emit(`module.${MODULE_ID}`, { type: "restAbandoned" });

        // Clear module-level references
        const { clearActiveRestApp } = await import("../module.js");
        clearActiveRestApp();

        ui.notifications.info("Rest abandoned.");
        this.close({ resolved: true });
    }

    /**
     * Player approves a Copy Spell transaction.
     */
    static #onApproveCopySpell(event, target) { this._copySpell.onApprove(event, target); }
    static #onDeclineCopySpell(event, target) { this._copySpell.onDecline(event, target); }
    static async #onProcessGmCopySpell(event, target) { await this._copySpell.onProcessGm(event, target); }
    static async #onDismissGmCopySpell(event, target) { await this._copySpell.onDismiss(event, target); }
    static #onResendCopySpellRoll(event, target) { this._copySpell.onResendRoll(event, target); }
    static async #onGmCopySpellFallback(event, target) { await this._copySpell.onGmFallback(event, target); }
    static async #onRollCopySpellArcana(event, target) { await this._copySpell.onRollArcana(event, target); }

    /**
     * Phase 3 (events): GM chooses between disaster tree, combat encounter, or two normal events after a nat 1.
     */
    static async #onDisasterChoice(event, target) {
        const pick = target.dataset.pick; // "tree", "encounter", "normals", or "dismiss"
        if (!this._disasterChoice || !pick) return;

        if (pick === "dismiss") {
            // GM discretion: skip disaster events entirely
            this._disasterChoice = null;
        } else if (pick === "tree" && this._disasterChoice.tree) {
            this._triggeredEvents = [this._disasterChoice.tree];
        } else if (pick === "encounter" && this._disasterChoice.encounter) {
            this._triggeredEvents = [this._disasterChoice.encounter];
        } else if (pick === "normals" && this._disasterChoice.normals?.length) {
            this._triggeredEvents = [...this._disasterChoice.normals];
        } else {
            // Fallback: use whatever is available (tree > encounter > normals)
            this._triggeredEvents = this._disasterChoice.tree
                ? [this._disasterChoice.tree]
                : this._disasterChoice.encounter
                    ? [this._disasterChoice.encounter]
                    : [...(this._disasterChoice.normals ?? [])];
        }

        this._disasterChoice = null;

        // Store combat buff summary for UI display when encounter/combat events chosen
        const hasEncounter = this._triggeredEvents?.some(e => e.category === "encounter" || e.category === "combat");
        if (hasEncounter && this._engine && this._activityResolver) {
            const buffs = this._engine.aggregateCombatBuffs(this._activityResolver);
            this._combatBuffs = buffs;
            if (buffs.perCharacter.length > 0) {
                const lines = buffs.perCharacter.map(b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`);
                if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
                await ChatMessage.create({
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        // Check for decision tree events
        const treeEvent = this._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
        }

        // Broadcast results to players
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "events",
            phaseData: {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true
            }
        });

        await this._saveRestState();
        this.render();
    }

    /**
     * Phase 3 (events): GM selects a decision tree choice.
     * Resolves the check and advances or resolves the tree.
     */
    static async #onResolveTreeChoice(event, target) {
        const choiceId = target.dataset.choiceId;
        if (!choiceId || !this._activeTreeState) return;

        this._activeTreeState = await DecisionTreeResolver.resolveChoice(
            this._activeTreeState, choiceId
        );

        // If tree is resolved, merge effects into triggered events
        if (this._activeTreeState.resolved) {
            // Replace the original decision tree event with the resolved outcome
            const idx = this._triggeredEvents.findIndex(e => e.id === this._activeTreeState.eventId);
            if (idx >= 0) {
                this._triggeredEvents[idx] = {
                    ...this._triggeredEvents[idx],
                    narrative: this._activeTreeState.finalNarrative,
                    effects: this._activeTreeState.finalEffects,
                    isDecisionTree: false,
                    resolved: true,
                    treeHistory: this._activeTreeState.history
                };
            }
            this._activeTreeState = null;
        }

        this.render();
    }

    /**
     * Phase 3 -> 4: Resolve rest outcomes.
     * Injects stored crafting results into activity outcomes.
     */
    static async #onResolveEvents(event, target) {
        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, this._earlyResults);

        // Inject crafting results into outcomes
        for (const outcome of this._outcomes) {
            const craftResult = this._craftingResults.get(outcome.characterId);
            if (!craftResult) continue;

            // Find the activity outcome and replace it
            for (const sub of (outcome.outcomes ?? [])) {
                if (sub.source === "activity" && ["act_cook", "act_brew", "act_tailor"].includes(sub.activityId)) {
                    sub.narrative = craftResult.narrative;
                    sub.result = craftResult.success ? "success" : "failure";
                    if (craftResult.success && craftResult.output) {
                        sub.items = [{
                            name: craftResult.output.name,
                            quantity: craftResult.output.quantity ?? 1,
                            img: craftResult.output.img ?? "icons/consumables/food/bowl-stew-brown.webp"
                        }];
                    } else {
                        sub.items = [];
                    }
                    sub.craftingResult = craftResult;
                }
            }
        }

        this._phase = "resolve";
        this._clearRestState();

        // Auto re-equip doffed armor if no encounter occurred
        const reequippedArmor = new Map();
        if (this._doffedArmor?.size > 0) {
            const hadEncounter = (this._triggeredEvents ?? []).some(e =>
                e.category === "encounter" || e.category === "combat"
            );
            if (!hadEncounter) {
                for (const [actorId, itemId] of this._doffedArmor) {
                    try {
                        const actor = game.actors.get(actorId);
                        const item = actor?.items.get(itemId);
                        if (item) {
                            await item.update({ "system.equipped": true });
                            reequippedArmor.set(actorId, item.name);
                            console.log(`${MODULE_ID} | Auto re-equipped ${item.name} on ${actor.name}`);

                            // Also inject narrative note into the outcome
                            const outcome = this._outcomes.find(o => o.characterId === actorId);
                            if (outcome) {
                                if (!outcome.outcomes) outcome.outcomes = [];
                                outcome.outcomes.push({
                                    source: "armor",
                                    narrative: `You don your ${item.name} as you break camp.`,
                                    items: []
                                });
                            }
                        }
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Failed to re-equip armor:`, e);
                    }
                }
                this._doffedArmor.clear();
            }
        }

        // Apply recovery (HP, HD, exhaustion) immediately at resolution
        const skipRecovery = game.settings.get(MODULE_ID, "restRecoveryDetected");
        await RecoveryHandler.applyAll(this._outcomes, skipRecovery);

        // Create items from outcomes (forage, crafts, etc.)
        try {
            const itemSummary = await ItemOutcomeHandler.processAll(this._outcomes);
            const totalItems = itemSummary.reduce((sum, s) => sum + s.items.length, 0);
            if (totalItems > 0) {
                ui.notifications.info(`Rest complete: ${totalItems} item${totalItems === 1 ? "" : "s"} created.`);
            } else {
                ui.notifications.info("Rest complete.");
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Item processing failed:`, e);
            ui.notifications.info("Rest complete.");
        }

        // Post condition advisory for any unhandled condition/temp_hp effects
        try {
            await ConditionAdvisory.processAll(this._outcomes);
        } catch (e) {
            console.warn(`${MODULE_ID} | Condition advisory failed:`, e);
        }

        // Send private whispered rest summary to each player
        for (const outcome of this._outcomes) {
            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;

            const ownerUser = game.users.find(u =>
                !u.isGM && actor.testUserPermission(u, "OWNER")
            );
            if (!ownerUser) continue;

            const lines = [`<h3>${actor.name}'s Rest</h3>`];
            for (const sub of (outcome.outcomes ?? [])) {
                lines.push(`<p><em>${sub.narrative}</em></p>`);
                if (sub.items?.length) {
                    for (const item of sub.items) {
                        const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
                        lines.push(`<p><i class="fas fa-plus-circle"></i> <strong>${item.name || item.itemRef}${qty}</strong></p>`);
                    }
                }
            }

            const recovery = outcome.recovery;
            if (recovery) {
                const recParts = [];
                if (recovery.hpRestored > 0) recParts.push(`+${recovery.hpRestored} HP`);
                if (recovery.hdRestored > 0) recParts.push(`+${recovery.hdRestored} HD`);
                if (recovery.exhaustionDelta < 0) recParts.push(`${recovery.exhaustionDelta} Exhaustion`);
                else if (recovery.exhaustionDelta > 0) recParts.push(`+${recovery.exhaustionDelta} Exhaustion`);
                if (recParts.length) {
                    lines.push(`<p><i class="fas fa-heartbeat"></i> ${recParts.join(", ")} restored</p>`);
                }
            }

            const reequipped = reequippedArmor.get(outcome.characterId);
            if (reequipped) {
                lines.push(`<p><i class="fas fa-shield-alt"></i> You don your <strong>${reequipped}</strong> as you break camp.</p>`);
            }

            try {
                await ChatMessage.create({
                    content: lines.join("\n"),
                    whisper: [ownerUser.id],
                    speaker: { alias: "Respite" },
                    flags: { [MODULE_ID]: { type: "restSummary" } }
                });
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to whisper rest summary to ${ownerUser.name}:`, e);
            }
        }

        // Record rest date via calendar handler
        await CalendarHandler.recordRestDate();

        // Broadcast phase change to players with outcome data
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: "resolve",
            phaseData: {
                outcomes: this._outcomes.map(o => ({
                    characterId: o.characterId,
                    characterName: o.characterName,
                    outcomes: o.outcomes,
                    recovery: o.recovery
                }))
            }
        });

        // Mark rest as applied so close guard doesn't fire
        this._restApplied = true;
        this.render();
    }

    /**
     * Phase 4: Finalize. Now just closes the window since auto-apply handles everything.
     */
    static async #onFinalize(event, target) {
        // Warn if there are ungranted party discoveries
        if (this._grantedDiscoveries && this._outcomes?.length) {
            const seenEvents = new Set();
            let ungrantedCount = 0;
            for (const o of this._outcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            if (!this._grantedDiscoveries.has(key)) ungrantedCount++;
                        }
                    }
                }
            }
            if (ungrantedCount > 0) {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-gem"></i> Ungranted Discoveries</h3>
                        <p>${ungrantedCount} discovered item${ungrantedCount > 1 ? "s have" : " has"} not been granted to anyone.</p>
                        <p>Close anyway and lose these items?</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-times"></i> Close Anyway</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                    overlay.remove();
                    this.close({ resolved: true });
                });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                    overlay.remove();
                });
                return;
            }
        }
        this.close({ resolved: true });
    }

    // ──────── Instance methods ────────

    /**
     * Receives player-submitted choices from the socket handler.
     */
    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null) {
        const user = game.users.get(userId);
        this._playerSubmissions.set(userId, {
            choices,
            followUps: followUps ?? {},
            userName: user?.name ?? "Unknown",
            timestamp: Date.now()
        });

        // Merge crafting results from the player
        if (craftingResults) {
            for (const [charId, result] of Object.entries(craftingResults)) {
                if (result) this._craftingResults.set(charId, result);
            }
        }

        this._rebuildCharacterChoices();
        this._saveRestState();
        this.render();

        // Broadcast submission status to all players
        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "player" };
        }
        for (const [charId, actId] of this._gmOverrides) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "gm" };
        }
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "submissionUpdate",
            submissions
        });
    }

    _rebuildCharacterChoices() {
        this._characterChoices.clear();

        for (const [userId, submission] of this._playerSubmissions) {
            for (const [charId, actId] of Object.entries(submission.choices)) {
                this._characterChoices.set(charId, actId);
            }
        }

        for (const [charId, actId] of this._gmOverrides) {
            this._characterChoices.set(charId, actId);
        }
    }

    _getPlayerChoiceForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            if (submission.choices[characterId]) {
                return {
                    activityId: submission.choices[characterId],
                    userName: submission.userName
                };
            }
        }
        return null;
    }

    _getFollowUpForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            if (submission.followUps?.[characterId]) {
                return submission.followUps[characterId];
            }
        }
        return null;
    }

    /**
     * Exports a snapshot of the current rest state for late-joining/rejoining players.
     * @returns {Object} Full state snapshot
     */
    getRestSnapshot() {
        // Build submissions map for player display
        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityName: act?.name ?? actId, source: "snapshot" };
        }

        return {
            phase: this._phase,
            submissions,
            triggeredEvents: this._triggeredEvents ?? [],
            activeTreeState: this._activeTreeState ?? null,
            outcomes: (this._outcomes ?? []).map(o => ({
                characterId: o.characterId,
                characterName: o.characterName,
                outcomes: o.outcomes,
                recovery: o.recovery
            })),
            afkCharacters: [...(this._afkCharacters ?? [])],
            doffedArmor: this._doffedArmor ? [...this._doffedArmor] : [],
            eventsRolled: this._eventsRolled ?? false,
            fireLevel: this._fireLevel ?? "campfire",
            campfireSnapshot: this._campfireApp ? {
                lit: this._campfireApp._lit ?? false,
                litBy: this._campfireApp._litBy ?? null,
                heat: this._campfireApp._heat ?? 0,
                strikeCount: this._campfireApp._strikeCount ?? 0,
                kindlingPlaced: this._campfireApp._kindlingPlaced ?? 0,
                peakHeat: this._campfireApp._peakHeat ?? 0,
                lastFireLevel: this._campfireApp._lastFireLevel ?? "unlit"
            } : (this._campfireSnapshot ?? null),
            campStatus: this._campStatus ?? null,
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            selectedTerrain: this._selectedTerrain ?? "forest",
            campRollRequest: this._pendingCampRolls?.some(p => p.requested) ? {
                activities: this._pendingCampRolls.filter(p => p.requested).map(p => ({
                    characterId: p.characterId,
                    activityId: p.activityId,
                    activityName: p.activityName,
                    skill: p.skill,
                    skillName: p.skillName,
                    dc: p.dc,
                    status: p.status,
                    total: p.total
                }))
            } : null,
            mealChoices: this._mealChoices ? Object.fromEntries(this._mealChoices) : null,
            mealSubmitted: this._mealSubmitted ?? false,
            dehydrationResults: (this._pendingDehydrationSaves ?? []).filter(s => s.resolved).map(s => ({
                actorName: s.actorName,
                total: s.total,
                passed: s.passed,
                dc: s.dc,
                reason: s.reason ?? null
            }))
        };
    }

    // ──────── Player-mode socket receivers ────────

    /**
     * Receives a phase change from the GM and re-renders.
     */
    receivePhaseChange(phase, phaseData = {}) {
        this._phase = phase;
        if (phaseData.triggeredEvents) this._triggeredEvents = phaseData.triggeredEvents;
        if (phaseData.activeTreeState) this._activeTreeState = phaseData.activeTreeState;
        if (phaseData.eventsRolled !== undefined) this._eventsRolled = phaseData.eventsRolled;
        if (phaseData.fireLevel) this._fireLevel = phaseData.fireLevel;
        if (phaseData.campStatus) this._campStatus = phaseData.campStatus;
        if (phaseData.outcomes) this._outcomes = phaseData.outcomes;
        if (phaseData.awaitingCombat !== undefined) {
            this._awaitingCombat = phaseData.awaitingCombat;
            // Reset meal processing flag when combat is acknowledged (i.e., moving past meal phase)
            this._mealProcessed = false;
        }

        // Meal phase data from GM
        if (phaseData.daysSinceLastRest != null) this._daysSinceLastRest = phaseData.daysSinceLastRest;
        if (phaseData.selectedTerrain) this._selectedTerrain = phaseData.selectedTerrain;
        if (phase === "meal") {
            // Only reset submission if this is a genuinely new meal phase,
            // not a reconnect/resume where the player already submitted
            if (!this._mealSubmitted) {
                this._mealSubmitted = false;
            }
            this._mealChoices = this._mealChoices ?? new Map();
            // Restore meal choices (including consumedDays) from world setting on reconnect
            try {
                const saved = game.settings.get(MODULE_ID, "activeRest");
                if (saved?.mealChoices) {
                    const savedChoices = new Map(saved.mealChoices);
                    for (const [charId, choice] of savedChoices) {
                        const existing = this._mealChoices.get(charId);
                        // Only restore if client has no data yet (fresh reconnect)
                        if (!existing || !existing.consumedDays?.length) {
                            this._mealChoices.set(charId, choice);
                        }
                    }
                }
                if (saved?.daysSinceLastRest) this._daysSinceLastRest = saved.daysSinceLastRest;
            } catch (e) { /* setting may not exist */ }
        }

        // Camp roll request: merge individual GM requests into pending pool
        if (phaseData.campRollRequest) {
            if (!this._pendingCampRoll) {
                this._pendingCampRoll = { activities: [], rolledCharacters: new Set() };
            }
            for (const act of phaseData.campRollRequest.activities ?? []) {
                if (!this._pendingCampRoll.activities.some(a => a.characterId === act.characterId)) {
                    this._pendingCampRoll.activities.push(act);
                }
            }
        }

        // Camp roll results update: sync pass/fail outcomes from GM
        if (phaseData.campRollsUpdate && this._pendingCampRoll) {
            for (const update of phaseData.campRollsUpdate) {
                const act = this._pendingCampRoll.activities?.find(a => a.characterId === update.characterId);
                if (act) {
                    act.status = update.status;
                    act.total = update.total;
                    act.narrative = update.narrative ?? "";
                    act.effectDescriptions = update.effectDescriptions ?? [];
                    if (update.status !== "pending") {
                        this._pendingCampRoll.rolledCharacters.add(update.characterId);
                    }
                }
            }
        }

        // Campfire panel lifecycle for players
        if (phase === "reflection") {
            this._openCampfire();
        } else {
            this._closeCampfire();
        }

        this.render();
    }

    /**
     * Receives updated submission statuses from the GM.
     */
    receiveSubmissionUpdate(submissions) {
        // Store submission status for display (non-owned characters)
        this._submissionStatus = submissions;

        // Update character choices from the GM's canonical state
        for (const [charId, info] of Object.entries(submissions)) {
            this._playerSubmissions.set(charId, {
                choices: { [charId]: info.activityId },
                userName: info.source === "gm" ? "GM" : "Player",
                timestamp: Date.now()
            });
        }
        this._rebuildCharacterChoices();
        this.render();
    }

    /**
     * Receives a full rest state snapshot and applies it in one shot.
     * Used for visibility resync and rejoin to avoid race conditions.
     */
    receiveRestSnapshot(snapshot) {
        // Apply submissions
        if (snapshot.submissions) {
            for (const [charId, info] of Object.entries(snapshot.submissions)) {
                this._playerSubmissions.set(charId, {
                    choices: { [charId]: info.activityName },
                    userName: info.source === "gm" ? "GM" : "Player",
                    timestamp: Date.now()
                });
            }
            this._rebuildCharacterChoices();
        }

        // Apply AFK
        if (snapshot.afkCharacters) {
            for (const charId of snapshot.afkCharacters) {
                this._afkCharacters.add(charId);
            }
        }

        // Apply phase + phase data
        if (snapshot.phase) {
            this._phase = snapshot.phase;
        }
        if (snapshot.triggeredEvents) this._triggeredEvents = snapshot.triggeredEvents;
        if (snapshot.activeTreeState) this._activeTreeState = snapshot.activeTreeState;
        if (snapshot.outcomes?.length) this._outcomes = snapshot.outcomes;
        if (snapshot.eventsRolled !== undefined) this._eventsRolled = snapshot.eventsRolled;
        if (snapshot.fireLevel) this._fireLevel = snapshot.fireLevel;
        if (snapshot.campfireSnapshot) {
            this._campfireSnapshot = snapshot.campfireSnapshot;
            // Apply immediately if campfire app is already mounted
            if (this._campfireApp) {
                this._campfireApp._lit = snapshot.campfireSnapshot.lit;
                this._campfireApp._litBy = snapshot.campfireSnapshot.litBy;
                this._campfireApp._heat = snapshot.campfireSnapshot.heat;
                this._campfireApp._strikeCount = snapshot.campfireSnapshot.strikeCount;
                this._campfireApp._kindlingPlaced = snapshot.campfireSnapshot.kindlingPlaced;
                this._campfireApp._peakHeat = snapshot.campfireSnapshot.peakHeat;
                this._campfireApp._lastFireLevel = snapshot.campfireSnapshot.lastFireLevel;
                this._campfireApp.render();
            }
        }
        if (snapshot.campStatus) this._campStatus = snapshot.campStatus;

        // Restore camp roll data for pending camp activity checks
        if (snapshot.campRollRequest) {
            this._pendingCampRoll = {
                activities: snapshot.campRollRequest.activities ?? [],
                rolledCharacters: new Set(
                    (snapshot.campRollRequest.activities ?? [])
                        .filter(a => a.status && a.status !== "pending")
                        .map(a => a.characterId)
                )
            };
        }

        // Apply armor state
        if (snapshot.doffedArmor?.length) {
            if (!this._doffedArmor) this._doffedArmor = new Map();
            for (const [actorId, itemId] of snapshot.doffedArmor) {
                this._doffedArmor.set(actorId, itemId);
            }
        }

        // Restore meal state from snapshot
        if (snapshot.mealChoices) {
            this._mealChoices = new Map(Object.entries(snapshot.mealChoices));
        }
        // Only set mealSubmitted to true, never clear it (player's local state takes precedence)
        if (snapshot.mealSubmitted) {
            this._mealSubmitted = true;
        }
        if (snapshot.daysSinceLastRest) {
            this._daysSinceLastRest = snapshot.daysSinceLastRest;
        }
        if (snapshot.selectedTerrain) {
            this._selectedTerrain = snapshot.selectedTerrain;
        }
        if (snapshot.dehydrationResults?.length) {
            this._dehydrationResults = snapshot.dehydrationResults;
        }

        // Campfire panel lifecycle on snapshot restore
        if (this._phase === "reflection") {
            this._openCampfire();
        } else {
            this._closeCampfire();
        }

        // Single render with all state applied
        this.render();
    }

    /**
     * Receives armor doff/don state from another client.
     */
    receiveArmorToggle(actorId, itemId, isDoffed) {
        if (!this._doffedArmor) this._doffedArmor = new Map();
        if (isDoffed) {
            this._doffedArmor.set(actorId, itemId);
        } else {
            this._doffedArmor.delete(actorId);
        }
        this.render();
    }

    /**
     * Receives an AFK update from another client.
     */
    receiveAfkUpdate(characterId, isAfk) {
        if (isAfk) {
            this._afkCharacters.add(characterId);
        } else {
            this._afkCharacters.delete(characterId);
        }
        this.render();
    }



}
