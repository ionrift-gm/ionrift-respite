import { Logger } from "../../../utils/Logger.js";
import { RestFlowEngine } from "../../../services/rest/flow/RestFlowEngine.js";
import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import { getPartyActors } from "../../../services/party/partyActors.js";

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

        this.#registerActiveRestApp(app);

        await app._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: app._engine.terrainTag, comfort: app._engine.comfort,
            restType: app._engine.restType, activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine?.recipes || []),
            forageActivityGate: app._forageActivityGatePayload()
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

        const activities = ["act_keep_watch", "act_set_defenses", "act_keep_watch", "act_keep_watch", "act_keep_watch"];
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
            forageActivityGate: app._forageActivityGatePayload()
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
            forageActivityGate: app._forageActivityGatePayload()
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
            // Check if damage effects came through
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

}
