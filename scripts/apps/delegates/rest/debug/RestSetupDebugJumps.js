import { Logger } from "../../../../utils/Logger.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { RestFlowEngine } from "../../../../services/rest/flow/RestFlowEngine.js";
import { DecisionTreeResolver } from "../../../../services/events/resolve/DecisionTreeResolver.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { ItemClassifier } from "../../../../services/party/ItemClassifier.js";
import { getActorMealNeeds } from "../../../../services/meal/phase/MealContextBuilder.js";
import { buildWaterOptions } from "../../../../services/meal/phase/MealOptionBuilder.js";
import { TerrainRegistry } from "../../../../services/events/resolve/TerrainRegistry.js";
import { getActiveRestSessionApp, registerRestSessionApp } from "../../../../services/rest/session/RestSessionSync.js";
import { createExhaustionEntry } from "../../../../services/rest/recovery/ExhaustionStage.js";
import { ResourceSink } from "../../../../services/rest/recovery/ResourceSink.js";

/** GM console debug jumps for RestSetupApp (jumpToResolution, etc.). */
export class RestSetupDebugJumps {
    #app;
    #registerActiveRestApp;
    #setActiveRestData;
    #emitRestStarted;
    #emitRestSnapshot;
    #emitPhaseChanged;

    /**
     * @param {object} app RestSetupApp instance
     * @param {{ registerActiveRestApp: Function, setActiveRestData: Function, emitRestStarted: Function, emitRestSnapshot: Function, emitPhaseChanged: Function }} hooks
     */
    constructor(app, hooks) {
        this.#app = app;
        this.#registerActiveRestApp = hooks.registerActiveRestApp;
        this.#setActiveRestData = hooks.setActiveRestData;
        this.#emitRestStarted = hooks.emitRestStarted;
        this.#emitRestSnapshot = hooks.emitRestSnapshot;
        this.#emitPhaseChanged = hooks.emitPhaseChanged;
    }

    async jumpToSingleEvent() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = "forest";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        app._engine = new RestFlowEngine({ restType: "long", terrainTag, comfort: "rough" });
        for (const id of targets) {
            app._engine.registerChoice(id, "act_keep_watch");
            app._characterChoices.set(id, "act_keep_watch");
        }

        app._triggeredEvents = [{
            id: "test_single_event", name: "Wolf Tracks", category: "complication",
            description: "Fresh wolf tracks circle the camp perimeter.",
            narrative: "Fresh wolf tracks circle the camp perimeter.",
            mechanical: {
                type: "skill_check", skill: "sur", dc: 12, targets: "watch",
                onSuccess: { narrative: "The pack moves on.", effects: [] },
                onFailure: { narrative: "The wolves grow bolder.", effects: [] }
            },
            targets, result: "triggered",
            resolvedOutcome: "success",
            resolvedRolls: targets.map(id => ({ id, name: game.actors.get(id)?.name ?? "Unknown", total: 15, passed: true })),
            groupAverage: 15,
            skillName: "Survival",
            effects: []
        }];

        app._eventsRolled = true;
        app._phase = "events";
        app._engine._phase = "events";
        this.#registerActiveRestApp(app);

        app.render(true);
        Logger.log("[Respite:Debug] Single event injected.");
        ui.notifications.info("Single event loaded.");
    }

    async jumpToResolution() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = app._engine?.terrainTag ?? "forest";
        const targets = getPartyActors().map(a => a.id);

        if (!app._engine) {
            app._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        for (const id of targets) {
            app._engine.registerChoice(id, "act_keep_watch");
            app._characterChoices.set(id, "act_keep_watch");
        }

        app._triggeredEvents = [{
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

        app._eventsRolled = true;
        app._outcomes = await app._engine.resolve(app._activityResolver, app._triggeredEvents, new Map());
        app._phase = "resolve";
        app._engine._phase = "resolve";
        app._restApplied = true;
        Hooks.callAll("ionrift.respite.resolutionEntered", {
            restType: app._engine?.restType ?? "long",
            isGritty: false
        });

        this.#registerActiveRestApp(app);

        await app._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || []),
            forageActivityGate: (typeof app._forageActivityGatePayload === "function" ? app._forageActivityGatePayload() : (app._forageResolverOpts?.()?.forageActivityGate ?? null))
        };
        this.#setActiveRestData(restPayload);
        this.#emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = app.getRestSnapshot?.();
            if (snapshot) this.#emitRestSnapshot(snapshot);
            this.#emitPhaseChanged("resolve", { outcomes: app._outcomes });
        }, 200);

        app.render(true);
        Logger.log("[Respite:Debug] Jumped to resolution with Hidden Grove discovery");
    }

    async jumpToEncounter() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = app._engine?.terrainTag ?? "forest";
        const targets = getPartyActors().map(a => a.id);

        if (!app._engine) {
            app._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        const activities = ["act_keep_watch", "act_defenses", "act_keep_watch", "act_keep_watch", "act_keep_watch"];
        for (let i = 0; i < targets.length; i++) {
            const actId = activities[i % activities.length];
            app._engine.registerChoice(targets[i], actId);
            app._characterChoices.set(targets[i], actId);
        }

        app._triggeredEvents = [{
            id: "debug_encounter", name: "Prowling Predators", category: "encounter",
            description: "A pack of creatures stalks the edge of your campfire light.",
            narrative: "A pack of creatures stalks the edge of your campfire light.",
            targets, result: "triggered", resolvedOutcome: null,
            effects: []
        }];
        app._eventsRolled = true;
        app._phase = "events";
        app._engine._phase = "events";

        if (app._activityResolver) {
            app._combatBuffs = app._engine.aggregateCombatBuffs(app._activityResolver);
        }

        this.#registerActiveRestApp(app);

        await app._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || []),
            forageActivityGate: (typeof app._forageActivityGatePayload === "function" ? app._forageActivityGatePayload() : (app._forageResolverOpts?.()?.forageActivityGate ?? null))
        };
        this.#setActiveRestData(restPayload);
        this.#emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = app.getRestSnapshot?.();
            if (snapshot) this.#emitRestSnapshot(snapshot);
            this.#emitPhaseChanged("events", { triggeredEvents: app._triggeredEvents, eventsRolled: true });
        }, 200);

        app.render(true);
        Logger.log("[Respite:Debug] Jumped to events phase with mock encounter and combat readiness report.");
    }

    async jumpToDisaster() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = app._engine?.terrainTag ?? "forest";
        const targets = getPartyActors().map(a => a.id);

        if (!app._engine) {
            app._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        for (const id of targets) {
            app._engine.registerChoice(id, "act_keep_watch");
            app._characterChoices.set(id, "act_keep_watch");
        }

        const resp = await fetch("modules/ionrift-respite/data/core/events/camp_disasters.json");
        const data = await resp.json();
        const flood = data.events.find(e => e.id === "evt_disaster_flash_flood");
        if (!flood) {
            ui.notifications.error("Flash Flood event not found in camp_disasters.json");
            return;
        }

        app._triggeredEvents = [flood];
        app._eventsRolled = true;
        app._activeTreeState = DecisionTreeResolver.createTreeState(flood, targets);
        if (flood.mechanical?.stallPenalty) {
            app._activeTreeState.stallPenalty = flood.mechanical.stallPenalty;
            app._activeTreeState.hasStallPenalty = true;
            app._activeTreeState.stalled = false;
        }
        app._phase = "events";
        app._engine._phase = "events";

        this.#registerActiveRestApp(app);
        await app._saveRestState();

        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || []),
            forageActivityGate: (typeof app._forageActivityGatePayload === "function" ? app._forageActivityGatePayload() : (app._forageResolverOpts?.()?.forageActivityGate ?? null))
        };
        this.#setActiveRestData(restPayload);
        this.#emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = app.getRestSnapshot?.();
            if (snapshot) this.#emitRestSnapshot(snapshot);
            this.#emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true
            });
        }, 200);

        app.render(true);
        Logger.log("[Respite:Debug] Jumped to events phase with Flash Flood decision tree.");
        ui.notifications.info("Flash Flood disaster injected. Decision tree active.");
    }

    async jumpToRecoveryPenalty() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = "swamp";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        for (const id of targets) {
            const actor = game.actors.get(id);
            if (!actor) continue;
            const maxHp = actor.system?.attributes?.hp?.max ?? 0;
            const halfHp = Math.floor(maxHp / 2);
            await actor.update({ "system.attributes.hp.value": halfHp });
        Logger.log(`[Respite:Debug] ${actor.name}: HP set to ${halfHp}/${maxHp}`);
        }

        app._engine = new RestFlowEngine({
            restType: "long", terrainTag, comfort: "rough"
        });

        for (const id of targets) {
            app._engine.registerChoice(id, "act_keep_watch");
            app._characterChoices.set(id, "act_keep_watch");
        }

        app._triggeredEvents = [{
            id: "evt_swamp_bog_rot",
            name: "Bog Rot",
            category: "complication",
            description: "Infected wounds fester. Recovery will be slower.",
            narrative: "Infected wounds fester. Recovery will be slower.",
            targets,
            result: "failure",
            resolvedOutcome: "failure",
            effects: [
                {
                    type: "recovery_penalty",
                    hpMultiplier: 0.5,
                    description: "Infected wounds reduce healing."
                }
            ]
        }];

        app._eventsRolled = true;
        app._outcomes = await app._engine.resolve(app._activityResolver, app._triggeredEvents, new Map());
        app._phase = "resolve";
        app._engine._phase = "resolve";
        app._restApplied = true;

        this.#registerActiveRestApp(app);
        await app._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || [])
        };
        this.#setActiveRestData(restPayload);
        this.#emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = app.getRestSnapshot?.();
            if (snapshot) this.#emitRestSnapshot(snapshot);
            this.#emitPhaseChanged("resolve", { outcomes: app._outcomes });
        }, 200);

        app.render(true);

        for (const o of app._outcomes) {
            const actor = game.actors.get(o.characterId);
            const maxHp = actor?.system?.attributes?.hp?.max ?? 0;
            const curHp = actor?.system?.attributes?.hp?.value ?? 0;
            const gap = maxHp - curHp;
            const expected = Math.floor(gap * 0.5);
        Logger.log(`[Respite:Debug] ${o.characterName}: gap=${gap}, expected recovery=${expected}, actual recovery=${o.recovery?.hpRestored ?? "?"}`);
        }

        Logger.log("[Respite:Debug] Jumped to resolution with Bog Rot 0.5x hpMultiplier penalty.");
        ui.notifications.info("Recovery penalty scenario loaded. Check the resolution screen.");
    }

    async jumpToDamageTest() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = "forest";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        for (const id of targets) {
            const actor = game.actors.get(id);
            if (!actor) continue;
            const maxHp = actor.system?.attributes?.hp?.max ?? 0;
            const startHp = Math.min(5, maxHp);
            await actor.update({ "system.attributes.hp.value": startHp });
        Logger.log(`[Respite:Debug] ${actor.name}: HP set to ${startHp}/${maxHp}`);
        }

        app._engine = new RestFlowEngine({
            restType: "long", terrainTag, comfort: "sheltered"
        });

        for (const id of targets) {
            app._engine.registerChoice(id, "act_rest_fully");
            app._characterChoices.set(id, "act_rest_fully");
        }

        app._triggeredEvents = [{
            id: "evt_test_damage",
            name: "Falling Branch",
            category: "complication",
            description: "A large branch cracks loose and crashes into camp.",
            narrative: "A large branch cracks loose and crashes into camp.",
            targets,
            resolved: true,
            resolvedOutcome: "failure",
            effects: [
                { type: "damage", formula: "10", damageType: "bludgeoning", description: "Struck by falling branch." }
            ]
        }];

        app._eventsRolled = true;
        app._outcomes = await app._engine.resolve(app._activityResolver, app._triggeredEvents, new Map());
        app._phase = "resolve";
        app._engine._phase = "resolve";
        app._restApplied = true;

        for (const o of app._outcomes) {
            // Sum up all damage effects from event outcomes
            let totalDamage = 0;
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event" && !["success", "triumph"].includes(sub.resolvedOutcome)) {
                    for (const eff of (sub.effects ?? [])) {
                        if (eff.type === "damage") {
                            // Parse flat formula or use the number directly
                            const dmg = parseInt(eff.formula ?? eff.roll) || 0;
                            totalDamage += dmg;
                        }
                    }
                }
            }
            if (totalDamage > 0 && o.recovery) {
                o.recovery.eventDamage = totalDamage;
            }
        }

        this.#registerActiveRestApp(app);
        await app._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || [])
        };
        this.#setActiveRestData(restPayload);
        this.#emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = app.getRestSnapshot?.();
            if (snapshot) this.#emitRestSnapshot(snapshot);
            this.#emitPhaseChanged("resolve", { outcomes: app._outcomes });
        }, 200);

        app.render(true);

        for (const o of app._outcomes) {
            const actor = game.actors.get(o.characterId);
            const maxHp = actor?.system?.attributes?.hp?.max ?? 0;
        Logger.log(`[Respite:Debug] ${o.characterName}: maxHp=${maxHp}, recovery=${o.recovery?.hpRestored ?? "?"}, expected final=${maxHp} - 10 = ${maxHp - 10}`);
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event") {

                    Logger.log(`  Event outcome: ${sub.eventName}, resolvedOutcome=${sub.resolvedOutcome}, effects=${JSON.stringify(sub.effects)}`);
                }
            }
        }

        Logger.log("[Respite:Debug] Jumped to resolution with 10 bludgeoning damage event.");
        ui.notifications.info("Damage test scenario loaded. Click 'Apply Results' to apply.");
    }

    async jumpToHostileComfort() {
        const app = this.#app;
        if (!game.user.isGM) return console.warn("GM only");

        const terrainTag = "forest";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        for (const id of targets) {
            const actor = game.actors.get(id);
            if (!actor) continue;
            const maxHp = actor.system?.attributes?.hp?.max ?? 0;
            const halfHp = Math.floor(maxHp / 2);
            await actor.update({ "system.attributes.hp.value": halfHp });
        Logger.log(`[Respite:Debug] ${actor.name}: HP set to ${halfHp}/${maxHp}`);
        }

        app._engine = new RestFlowEngine({
            restType: "long", terrainTag, comfort: "hostile"
        });

        const firstId = targets[0];
        app._engine.registerChoice(firstId, "act_rest_fully");
        app._characterChoices.set(firstId, "act_rest_fully");
        for (const id of targets.slice(1)) {
            app._engine.registerChoice(id, "act_keep_watch");
            app._characterChoices.set(id, "act_keep_watch");
        }

        app._triggeredEvents = [];
        app._eventsRolled = true;
        app._outcomes = await app._engine.resolve(app._activityResolver, app._triggeredEvents, new Map());
        app._phase = "resolve";
        app._engine._phase = "resolve";
        app._restApplied = true;

        this.#registerActiveRestApp(app);
        await app._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || [])
        };
        this.#setActiveRestData(restPayload);
        this.#emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = app.getRestSnapshot?.();
            if (snapshot) this.#emitRestSnapshot(snapshot);
            this.#emitPhaseChanged("resolve", { outcomes: app._outcomes });
        }, 200);

        app.render(true);

        for (const o of app._outcomes) {
            const eff = o.recovery?.comfortLevel ?? "?";
            const camp = o.recovery?.campComfort ?? "?";
        Logger.log(`[Respite:Debug] ${o.characterName}: camp=${camp}, effective=${eff}, exhaustionDC=${o.recovery?.exhaustionDC ?? "none"}`);
        }

        Logger.log("[Respite:Debug] Hostile comfort scenario loaded.");
        ui.notifications.info("Hostile comfort scenario loaded. Check exhaustion advisories.");
    }

    static async addSupplies(qty = 50) {
        if (!game.user.isGM) return console.warn("GM only");

        const actors = getPartyActors();
        for (const actor of actors) {
            const existing = actor.items.find(i =>
                ["supplies", "adventuring supplies", "camp supplies"].includes(i.name.toLowerCase().trim())
            );
            if (existing) {
                await actor.updateEmbeddedDocuments("Item", [
                    { _id: existing.id, "system.quantity": (existing.system?.quantity ?? 0) + qty }
                ]);
        Logger.log(`[Respite:Debug] ${actor.name}: added ${qty} to existing ${existing.name} (now ${(existing.system?.quantity ?? 0) + qty})`);
            } else {
                await actor.createEmbeddedDocuments("Item", [{
                    name: "Supplies",
                    type: "loot",
                    img: "icons/containers/bags/pack-leather-brown.webp",
                    system: { quantity: qty, weight: { value: 0.5 }, price: { value: 1, denomination: "gp" } }
                }]);
        Logger.log(`[Respite:Debug] ${actor.name}: created Supplies x${qty}`);
            }
        }
        ui.notifications.info(`Added ${qty} supplies to ${actors.length} party members.`);
    }

    async toggleRestVariant() {
        if (!game.user.isGM) return console.warn("GM only");
        return this.#app.toggleDevRestVariant?.();
    }

    /**
     * Open DowntimeLedgerApp and jump straight to the pacing (nights) flow.
     * Skips camp / activity / meal so the Nights screen can be reviewed
     * without walking a full gritty rest. GM only.
     */
    async jumpToNights() {
        if (!game.user.isGM) return console.warn("GM only");

        const { DowntimeLedgerApp } = await import("../../../downtime/DowntimeLedgerApp.js");
        const app = new DowntimeLedgerApp({
            haven: "wilderness",
            terrainTag: this.#app._selectedTerrain ?? "forest"
        });
        app._pacingActive = true;
        app._activePacingNight = 1;
        await app.render({ force: true });
        Logger.log("[Respite:Debug] Jumped to Nights (pacing) in DowntimeLedgerApp");
        ui.notifications.info("Opened Nights pacing view (dev jump).");
    }

    /**
     * Open the normal rest on the dawn exhaustion screen.
     * Seeds a rough-camp Constitution save (DC 10) for each party character
     * so the pending roll row is visible. GM only.
     */
    async jumpToExhaustion() {
        if (!game.user.isGM) return console.warn("GM only");
        const app = this.#app;
        const targets = getPartyActors();
        if (!targets.length) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        if (!app._engine) {
            app._engine = new RestFlowEngine({
                restType: "long",
                terrainTag: app._selectedTerrain ?? "forest",
                comfort: "rough"
            });
        }
        app._engine.comfort = "rough";
        app._engine.restType = "long";
        app._engine.safeRestSpot = false;
        app._engine._phase = "dawn";

        for (const actor of targets) {
            app._engine.registerChoice(actor.id, "act_keep_watch");
            app._characterChoices?.set?.(actor.id, "act_keep_watch");
        }

        app._triggeredEvents = [];
        app._eventsRolled = true;
        app._awaitingCombat = false;
        app._activeTreeState = null;
        app._disasterChoice = null;
        app._phase = "dawn";

        const draft = new Map();
        for (const actor of targets) {
            draft.set(actor.id, createExhaustionEntry(actor, {
                exhaustionDC: 10,
                exhaustionAdvantage: false,
                comfortLevel: "rough"
            }));
        }
        app._exhaustionDraft = draft;
        if (!app._expandedExhaustionOverrides) app._expandedExhaustionOverrides = new Set();

        this.#registerActiveRestApp(app);
        app.render(true);
        Logger.log("[Respite:Debug] Jumped to dawn exhaustion.");
        ui.notifications.info("Opened dawn exhaustion. Rough camp, DC 10.");
    }

    /**
     * Open the events phase on a resolved Flash Flood outcome with supplies
     * and gear already locked, so the GM consequence lines can be previewed.
     * Does not remove anything from the sheets. GM only.
     */
    async jumpToLosses() {
        if (!game.user.isGM) return console.warn("GM only");
        const app = this.#app;
        const actors = getPartyActors();
        if (!actors.length) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        if (!app._engine) {
            app._engine = new RestFlowEngine({
                restType: "long",
                terrainTag: app._selectedTerrain ?? "forest",
                comfort: "rough"
            });
        }
        app._engine.restType = "long";
        app._engine._phase = "events";

        for (const actor of actors) {
            app._engine.registerChoice(actor.id, "act_keep_watch");
            app._characterChoices?.set?.(actor.id, "act_keep_watch");
        }

        const resp = await fetch("modules/ionrift-respite/data/core/events/camp_disasters.json");
        const data = await resp.json();
        const flood = data.events.find(e => e.id === "evt_disaster_flash_flood");
        const outcome = flood?.mechanical?.options
            ?.find(o => o.id === "move_high")?.onSuccess;
        if (!outcome?.effects?.length) {
            ui.notifications.error("Flash Flood loss outcome not found.");
            return;
        }

        const effects = foundry.utils.deepClone(outcome.effects);
        const supply = effects.find(e => e.type === "supply_loss");
        const gear = effects.find(e => e.type === "item_at_risk");
        if (supply) {
            // The authored formula uses a multiply the dice roller rejects.
            // A plain pool still reads as a disaster-sized loss.
            supply.formula = "2d20";
            const proposal = await ResourceSink.proposeSupplyLoss(supply, { characters: actors });
            supply._lockedSupply = proposal;
            supply._locked = true;
        }
        if (gear) {
            const proposal = await ResourceSink._resolveItemAtRisk(gear, { characters: actors });
            gear._lockedItems = (proposal.candidates ?? []).map(c => ({
                actorId: c.actor.id,
                actorName: c.actor.name,
                itemId: c.item.id,
                itemName: c.item.name,
                itemImg: c.item.img ?? "icons/svg/item-bag.svg",
                currentQty: c.currentQty,
                lossQty: c.lossQty
            }));
            gear._locked = true;
        }

        const eventId = flood.id;
        app._triggeredEvents = [{
            id: eventId,
            name: flood.name,
            category: "complication",
            description: flood.description ?? "",
            treeOutcome: true,
            result: "triggered",
            resolvedOutcome: "failure",
            targets: actors.map(a => a.id),
            mechanical: {
                type: "decision_tree",
                onFailure: { effects }
            }
        }];
        app._eventsRolled = true;
        app._awaitingCombat = false;
        app._disasterChoice = null;
        app._activeTreeState = {
            eventId,
            eventName: flood.name,
            resolved: true,
            finalNarrative: outcome.narrative,
            finalEffects: effects,
            history: [],
            options: [],
            awaitingRolls: false,
            pendingRolls: [],
            resolvedRolls: []
        };
        app._phase = "events";

        this.#registerActiveRestApp(app);
        app.render(true);
        Logger.log("[Respite:Debug] Jumped to locked pack losses.");
        ui.notifications.info("Opened pack losses. Supplies destroyed, gear to be taken.");
    }

    /**
     * Fill the open gritty week for every party character.
     * Drops Other, puts leftover days on Rest, sets gathering to camp,
     * and stocks rations and water for the days still needed. GM only.
     */
    /**
     * The open Camp Planning window. The session registry can drop it when
     * another rest app closes, so fall back to the live Foundry instance.
     * @returns {object|null}
     */
    static #findGrittyApp() {
        const registered = getActiveRestSessionApp("downtime");
        if (registered?._budgetDelegate && registered.rendered !== false) return registered;

        const instances = foundry.applications?.instances;
        const live = instances?.get?.("ionrift-downtime-ledger");
        if (live?._budgetDelegate) {
            registerRestSessionApp("downtime", live);
            return live;
        }

        if (instances) {
            for (const app of instances.values()) {
                if (!app?._budgetDelegate || app.rendered === false) continue;
                if (app.constructor?.name !== "DowntimeLedgerApp") continue;
                registerRestSessionApp("downtime", app);
                return app;
            }
        }

        return registered?._budgetDelegate ? registered : null;
    }

    static async fillRestParty() {
        if (!game.user.isGM) return console.warn("GM only");

        const app = RestSetupDebugJumps.#findGrittyApp();
        if (!app?._budgetDelegate) {
            ui.notifications.warn("Open the gritty rest first.");
            return;
        }

        const actors = getPartyActors();
        if (!actors.length) {
            ui.notifications.warn("No party characters found.");
            return;
        }

        const days = Math.max(0, app._campLogistics?._foodDaysNeeded ?? 7);
        const terrainTag = app._terrainTag ?? "forest";
        const mealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules
            ?? { foodPerDay: 1, waterPerDay: 2 };

        for (const actor of actors) {
            app._budgetDelegate.clearDays(actor.id, "other");
            if (app._budgetDelegate.getUnallocatedDays(actor.id) > 0) {
                app._budgetDelegate.dumpDays(actor.id, "rest");
            }
            app._committedActorIds?.add(actor.id);

            const schedule = app._getOrCreateGatheringSchedule?.(actor.id);
            if (Array.isArray(schedule)) {
                for (const day of schedule) {
                    if (day.rolled && day.mode !== "skip") continue;
                    day.mode = "skip";
                    day.rolled = false;
                    day.rollTotal = null;
                    day.dc = null;
                    day.success = null;
                    day.yield = 0;
                }
                app._gatheringSchedule?.set(actor.id, schedule);
            }

            const needs = getActorMealNeeds(actor, mealRules);
            const foodNeed = days * Math.max(1, needs?.foodPerDay ?? 1);
            const waterNeed = days * Math.max(0, needs?.waterPerDay ?? 2);
            await RestSetupDebugJumps.#topUpProvision(actor, {
                name: "Rations",
                needed: foodNeed,
                have: RestSetupDebugJumps.#foodOnHand(actor),
                resourceType: "food",
                consumableType: "food",
                img: "icons/consumables/food/bowl-stew-brown.webp"
            });
            await RestSetupDebugJumps.#topUpWater(actor, waterNeed, mealRules);
            const waterPlan = app._sustenanceEdits?.get(actor.id);
            if (waterPlan?.water) waterPlan.water = {};

            app._mealsLockedActorIds?.add(actor.id);
        }

        app._broadcastSync?.();
        await app.render?.({ force: true });
        await app._saveSessionState?.();
        ui.notifications.info(`Filled ${actors.length} characters. Other left off. Food and water stocked.`);
        Logger.log(`[Respite:Debug] fillRestParty: ${actors.map(a => a.name).join(", ")}`);
    }

    static #foodOnHand(actor) {
        let total = 0;
        for (const item of actor.items ?? []) {
            if (!ItemClassifier.isFood(item, actor)) continue;
            total += Number(item.system?.quantity ?? 0);
        }
        return total;
    }

    static #waterOnHand(actor, mealRules) {
        return buildWaterOptions(actor, mealRules)
            .reduce((sum, option) => sum + (Number(option.totalPints) || 0), 0);
    }

    /**
     * Bring countable pints up to the week need. Charge skins fill first.
     * Any gap left is a plain Water stack, one pint per quantity, which is
     * what the sustenance vessel actually pours.
     */
    static async #topUpWater(actor, needed, mealRules) {
        const chargeUpdates = [];
        for (const item of actor.items ?? []) {
            if (!ItemClassifier.isWater(item, actor)) continue;
            const uses = item.system?.uses;
            const rawMax = Number(uses?.max) || 0;
            if (rawMax <= 1) continue;
            const isV5 = Object.prototype.hasOwnProperty.call(uses, "spent");
            const remaining = isV5 ? rawMax - (Number(uses.spent) || 0) : Number(uses.value) || 0;
            if (remaining >= rawMax) continue;
            chargeUpdates.push(isV5
                ? { _id: item.id, "system.uses.spent": 0 }
                : { _id: item.id, "system.uses.value": rawMax });
        }
        if (chargeUpdates.length) {
            await actor.updateEmbeddedDocuments("Item", chargeUpdates);
        }

        const have = RestSetupDebugJumps.#waterOnHand(actor, mealRules);
        const shortfall = Math.max(0, needed - have);
        if (shortfall <= 0) return;

        await RestSetupDebugJumps.#topUpProvision(actor, {
            name: "Water",
            needed: shortfall,
            have: 0,
            resourceType: "water",
            consumableType: "drink",
            img: "icons/consumables/drinks/pitcher-stoneware-white.webp"
        });
    }

    static async #topUpProvision(actor, spec) {
        const shortfall = Math.max(0, spec.needed - spec.have);
        if (shortfall <= 0) return;

        const existing = [...(actor.items ?? [])].find(item =>
            (item.name ?? "").toLowerCase() === spec.name.toLowerCase()
        );
        if (existing) {
            const qty = (Number(existing.system?.quantity) || 0) + shortfall;
            await actor.updateEmbeddedDocuments("Item", [
                { _id: existing.id, "system.quantity": qty }
            ]);
            return;
        }

        await actor.createEmbeddedDocuments("Item", [{
            name: spec.name,
            type: "consumable",
            img: spec.img,
            system: {
                quantity: shortfall,
                type: { value: spec.consumableType }
            },
            flags: {
                [MODULE_ID]: { resourceType: spec.resourceType }
            }
        }]);
    }

}
