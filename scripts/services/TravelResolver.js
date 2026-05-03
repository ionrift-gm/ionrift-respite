import { ResourcePoolRoller } from "./ResourcePoolRoller.js";
import { CalendarHandler } from "./CalendarHandler.js";
import { ItemOutcomeHandler } from "./ItemOutcomeHandler.js";

const MODULE_ID = "ionrift-respite";

const FORAGE_DC = 12;
const HUNT_DC = 14;

/**
 * TravelResolver
 * Resolves foraging and hunting rolls during the Travel Resolution phase.
 * Each character declares a travel activity; this service handles the
 * skill checks, pool draws, and nat 20/nat 1 consequence generation.
 */
export class TravelResolver {

    /** @type {ResourcePoolRoller} */
    #poolRoller;

    /** @type {Record<string, Array<{ itemRef: string, _id: string, quantity: number }>>} */
    #basePools = {};

    constructor() {
        this.#poolRoller = new ResourcePoolRoller();
    }

    /**
     * Load resource pool data for terrain draws.
     * @param {Object[]} poolData - Array of resource pool definitions.
     */
    loadPools(poolData) {
        this.#poolRoller.load(poolData);
    }

    /**
     * Build hunt/forage base pools from the respite-items compendium index (flags.ionrift-respite).
     * @param {Iterable<{ _id: string, name?: string, flags?: Record<string, unknown> }>} indexEntries
     */
    loadBaseItems(indexEntries) {
        if (!indexEntries) return;
        for (const entry of indexEntries) {
            const rf = entry.flags?.["ionrift-respite"];
            if (!rf?.category || !rf.terrain) continue;

            const terrains = rf.terrain === "any"
                ? ["forest", "swamp", "desert", "mountain", "arctic", "wilderness"]
                : String(rf.terrain).split(",").map(t => t.trim()).filter(Boolean);

            for (const terrain of terrains) {
                const key = `${terrain}_${rf.category}`;
                this.#basePools[key] ??= [];
                this.#basePools[key].push({
                    itemRef: rf.itemRef ?? String(entry.name ?? "").toLowerCase().replace(/\s+/g, "_"),
                    _id: entry._id,
                    quantity: 1
                });
            }
        }
    }

    /** @returns {string[]} Keys such as forest_forage for {@link ForageActivityValidator}. */
    get basePoolCoverage() {
        return Object.keys(this.#basePools);
    }

    /** @returns {ResourcePoolRoller} Shared roller (for {@link ForageActivityValidator}). */
    get resourcePoolRoller() {
        return this.#poolRoller;
    }

    /**
     * Resolve a foraging attempt for a single character.
     * @param {Actor} actor
     * @param {string} terrainTag
     * @returns {Object} { success, nat20, nat1, total, dc, items, mishap }
     */
    async resolveForage(actor, terrainTag) {
        const roll = await new Roll("1d20 + @mod", {
            mod: this._getSurvivalMod(actor)
        }).evaluate();

        const d20 = roll.dice[0]?.results?.[0]?.result ?? roll.total;
        const nat20 = d20 === 20;
        const nat1 = d20 === 1;
        const total = roll.total;
        const dc = FORAGE_DC;
        const success = nat20 || (!nat1 && total >= dc);
        const exceptional = total >= dc + 5;

        let items = [];
        let mishap = null;
        let warningKey = null;

        if (nat1) {
            mishap = this._rollForageMishap(terrainTag);
        } else if (success) {
            const rolled = await this._rollForageItems(terrainTag, exceptional, nat20);
            items = rolled.items;
            warningKey = rolled.warningKey ?? null;
        }

        return {
            activity: "forage",
            actorId: actor.id,
            actorName: actor.name,
            success,
            nat20,
            nat1,
            exceptional,
            total,
            dc,
            roll,
            items,
            mishap,
            warningKey
        };
    }

    /**
     * Resolve a foraging attempt from a pre-rolled total (player-rolled).
     * @param {Actor} actor
     * @param {string} terrainTag
     * @param {number} total - The player's roll total.
     * @param {number} dc - The DC used for this check.
     * @returns {Object}
     */
    async resolveForageFromTotal(actor, terrainTag, total, dc) {
        const nat20 = total - this._getSurvivalMod(actor) === 20;
        const nat1 = total - this._getSurvivalMod(actor) === 1;
        const success = nat20 || (!nat1 && total >= dc);
        const exceptional = total >= dc + 5;

        let items = [];
        let mishap = null;
        let warningKey = null;

        if (nat1) {
            mishap = this._rollForageMishap(terrainTag);
        } else if (success) {
            const rolled = await this._rollForageItems(terrainTag, exceptional, nat20);
            items = rolled.items;
            warningKey = rolled.warningKey ?? null;
        }

        return {
            activity: "forage", actorId: actor.id, actorName: actor.name,
            success, nat20, nat1, exceptional, total, dc, items, mishap, warningKey
        };
    }

    /**
     * Resolve a hunting attempt from a pre-rolled total (player-rolled).
     * @param {Actor} actor
     * @param {string} terrainTag
     * @param {number} total - The player's roll total.
     * @param {number} dc - The DC used for this check.
     * @returns {Object}
     */
    async resolveHuntFromTotal(actor, terrainTag, total, dc) {
        const nat20 = total - this._getSurvivalMod(actor) === 20;
        const nat1 = total - this._getSurvivalMod(actor) === 1;
        const success = nat20 || (!nat1 && total >= dc);
        const exceptional = total >= dc + 5;

        let items = [];
        let mishap = null;

        if (nat1) {
            mishap = this._rollHuntMishap(terrainTag);
        } else if (success) {
            items.push(...await this._getHuntYield(terrainTag, exceptional));
            if (nat20) {
                const rarePoolId = `resource_pool_${terrainTag}_rare`;
                const rareItems = await this.#poolRoller.roll(rarePoolId, 1);
                items.push(...rareItems);
            }
        }

        return {
            activity: "hunt", actorId: actor.id, actorName: actor.name,
            success, nat20, nat1, exceptional, total, dc, items, mishap
        };
    }

    /**
     * Resolve a hunting attempt for a single character.
     * @param {Actor} actor
     * @param {string} terrainTag
     * @returns {Object} { success, nat20, nat1, total, dc, items, mishap }
     */
    async resolveHunt(actor, terrainTag) {
        const roll = await new Roll("1d20 + @mod", {
            mod: this._getSurvivalMod(actor)
        }).evaluate();

        const d20 = roll.dice[0]?.results?.[0]?.result ?? roll.total;
        const nat20 = d20 === 20;
        const nat1 = d20 === 1;
        const total = roll.total;
        const dc = HUNT_DC;
        const success = nat20 || (!nat1 && total >= dc);
        const exceptional = total >= dc + 5;

        let items = [];
        let mishap = null;

        if (nat1) {
            mishap = this._rollHuntMishap(terrainTag);
        } else if (success) {
            items.push(...await this._getHuntYield(terrainTag, exceptional));

            if (nat20) {
                const rarePoolId = `resource_pool_${terrainTag}_rare`;
                const rareItems = await this.#poolRoller.roll(rarePoolId, 1);
                items.push(...rareItems);
            }
        }

        return {
            activity: "hunt",
            actorId: actor.id,
            actorName: actor.name,
            success,
            nat20,
            nat1,
            exceptional,
            total,
            dc,
            roll,
            items,
            mishap
        };
    }

    /**
     * Grant resolved items to an actor's inventory (stacks only when spoilage cohort matches).
     * @param {Actor} actor
     * @param {Object[]} items - Array of { itemRef, quantity, itemData }
     */
    async grantItems(actor, items) {
        if (!actor || !items?.length) return;

        const harvestedDate = CalendarHandler.getCurrentDate() ?? String(game.time.worldTime);
        for (const entry of items) {
            if (!entry.itemData) continue;
            const data = foundry.utils.deepClone(entry.itemData);
            data.system = data.system ?? {};
            data.system.quantity = entry.quantity ?? 1;

            const respFlags = data.flags?.[MODULE_ID];
            if (respFlags?.spoilsAfter !== null && !respFlags.harvestedDate) {
                data.flags = data.flags ?? {};
                data.flags[MODULE_ID] = { ...respFlags, harvestedDate };
            }

            await ItemOutcomeHandler.grantItemsToActor(actor, [{
                name: data.name,
                type: data.type ?? "loot",
                img: data.img ?? "icons/svg/item-bag.svg",
                quantity: data.system.quantity,
                system: data.system,
                flags: data.flags ?? {}
            }]);
        }
    }

    /**
     * Whisper a travel result to chat for the actor's owner + GM.
     */
    async whisperResult(result) {
        const actor = game.actors.get(result.actorId);
        if (!actor) return;

        const label = result.activity === "forage" ? "Foraging" : "Hunting";
        const icon = result.activity === "forage" ? "fa-seedling" : "fa-crosshairs";
        const dcLabel = `DC ${result.dc}`;

        let outcomeLabel;
        if (result.nat20) outcomeLabel = `<span style="color: #4CAF50; font-weight: bold;">Natural 20!</span>`;
        else if (result.nat1) outcomeLabel = `<span style="color: #f44336; font-weight: bold;">Natural 1!</span>`;
        else if (result.exceptional) outcomeLabel = `<span style="color: #4CAF50;">Exceptional success</span>`;
        else if (result.success) outcomeLabel = `<span style="color: #8BC34A;">Success</span>`;
        else outcomeLabel = `<span style="color: #FF9800;">Failure</span>`;

        let content = `<div style="border-left: 3px solid rgba(155,89,182,0.5); padding: 4px 8px;">`;
        content += `<p><strong><i class="fas ${icon}"></i> ${label}</strong> (${dcLabel})</p>`;
        content += `<p>${outcomeLabel} (rolled <strong>${result.total}</strong>)</p>`;

        if (result.items?.length) {
            content += `<p><strong>Found:</strong></p><ul>`;
            for (const item of result.items) {
                const name = item.itemData?.name ?? item.itemRef;
                content += `<li>${item.quantity}x ${name}</li>`;
            }
            content += `</ul>`;
        } else if (result.warningKey === "FORAGE_POOL_EMPTY" && result.success) {
            content += `<p><em>Nothing found.</em></p>`;
        }

        if (result.mishap) {
            content += `<p style="color: #f44336;"><i class="fas fa-exclamation-triangle"></i> <strong>Mishap:</strong> ${result.mishap.description}</p>`;
        }

        content += `</div>`;

        const whisperTargets = this._getWhisperTargets(actor);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content,
            whisper: whisperTargets,
            flags: { [MODULE_ID]: { travelResult: true } }
        });
    }

    // ── Internal Helpers ──────────────────────────────────────

    /**
     * Pool draws for forage (no synthetic loot). Empty grantable results log a warning.
     * @returns {Promise<{ items: Object[], warningKey?: string }>}
     */
    async _rollForageItems(terrainTag, exceptional, nat20) {
        const poolId = `resource_pool_${terrainTag}`;
        const primaryRoll = await this.#poolRoller.roll(poolId, 1);
        let rareRoll = [];
        if (exceptional || nat20) {
            rareRoll = await this.#poolRoller.roll(`${poolId}_rare`, 1);
        }

        const grantable = (arr) => arr.filter(e => e.itemData);
        let items = [...grantable(primaryRoll), ...grantable(rareRoll)];

        if (!items.length) {
            items = await this._drawFromBasePool(terrainTag, "forage", exceptional ? 2 : 1);
        }

        if (!items.length) {
            console.warn(`${MODULE_ID} | Forage pools produced no grantable items`, {
                terrainTag,
                exceptional,
                nat20,
                warningKey: "FORAGE_POOL_EMPTY"
            });
            return { items: [], warningKey: "FORAGE_POOL_EMPTY" };
        }
        return { items };
    }

    _getSurvivalMod(actor) {
        const sur = actor.system?.skills?.sur;
        const nat = actor.system?.skills?.nat;
        const surMod = sur?.total ?? 0;
        const natMod = nat?.total ?? 0;
        return Math.max(surMod, natMod);
    }

    /**
     * @param {string} terrainTag
     * @param {string} category - "hunt" | "forage"
     * @param {number} count
     * @returns {Promise<Array<{ itemRef: string, quantity: number, itemData: object }>>}
     */
    async _drawFromBasePool(terrainTag, category, count = 1) {
        const key = `${terrainTag}_${category}`;
        const pool = this.#basePools[key] ?? this.#basePools[`wilderness_${category}`] ?? [];
        if (!pool.length) return [];

        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const drawn = shuffled.slice(0, Math.min(count, shuffled.length));

        const pack = game.packs.get("ionrift-respite.respite-items");
        const results = [];
        for (const entry of drawn) {
            const doc = pack ? await pack.getDocument(entry._id) : null;
            if (!doc) continue;
            results.push({
                itemRef: entry.itemRef,
                quantity: entry.quantity,
                itemData: doc.toObject()
            });
        }
        return results;
    }

    /**
     * Hunt yields from compendium-backed base pools (and rare pools on nat 20 elsewhere).
     * @param {string} terrainTag
     * @param {boolean} exceptional
     */
    async _getHuntYield(terrainTag, exceptional) {
        const count = exceptional ? 2 : 1;
        return this._drawFromBasePool(terrainTag, "hunt", count);
    }

    _rollForageMishap(terrainTag) {
        const tables = {
            forest: [
                {
                    type: "condition",
                    description: "Touched something toxic. Poisoned until end of rest (Con save DC 12 to shrug it off early).",
                    effects: [{ type: "condition", condition: "poisoned", duration: "next_rest" }]
                },
                {
                    type: "economy",
                    description: "A waterskin punctured on thorns. Lost 1 waterskin.",
                    effects: [{ type: "consume_resource", resource: "water", amount: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: "Got turned around in the brush. Disadvantage on rest activity check.",
                    effects: [{ type: "travel_penalty", penalty: "activity_disadvantage" }]
                },
                {
                    type: "escalation",
                    description: "Disturbed a nest. Something followed the forager back to camp.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                }
            ],
            swamp: [
                {
                    type: "condition",
                    description: "Waded through something foul. Diseased (persists beyond rest, requires Lesser Restoration).",
                    effects: [{ type: "condition", condition: "diseased", duration: "permanent" }]
                },
                {
                    type: "economy",
                    description: "Rations fell in the muck. Lost 1 rations.",
                    effects: [{ type: "consume_resource", resource: "rations", amount: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: "Sank waist-deep in a bog. Reduced rest recovery for this character.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: "Spent hours finding a way back. No rest activity for this character.",
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ],
            desert: [
                {
                    type: "condition",
                    description: "Heat exhaustion from wandering too far. +1 exhaustion level.",
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "economy",
                    description: "A waterskin cracked in the heat. Lost 1 waterskin.",
                    effects: [{ type: "consume_resource", resource: "water", amount: 1 }]
                },
                {
                    type: "escalation",
                    description: "Stumbled into a sand viper's territory. Something stirs near camp.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "rest_penalty",
                    description: "Sunstroke. Reduced rest recovery for this character.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                }
            ],
            mountain: [
                {
                    type: "rest_penalty",
                    description: "Twisted an ankle on loose scree. Disadvantage on rest activity check.",
                    effects: [{ type: "travel_penalty", penalty: "activity_disadvantage" }]
                },
                {
                    type: "economy",
                    description: "Pack tore on a rock face. Lost 1 random supply item.",
                    effects: [{ type: "supply_loss", amount: 1 }]
                },
                {
                    type: "escalation",
                    description: "Dislodged rocks drew attention. Something watches from above.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "rest_penalty",
                    description: "Altitude sickness. Reduced rest recovery for this character.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                }
            ],
            arctic: [
                {
                    type: "condition",
                    description: "Frostbite setting in. +1 exhaustion level.",
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "economy",
                    description: "Supplies exposed to wind. Lost 1 rations.",
                    effects: [{ type: "consume_resource", resource: "rations", amount: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: "Hypothermia risk. Reduced rest recovery for this character.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: "Whiteout conditions. Returned too late for rest activities.",
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ]
        };

        const pool = tables[terrainTag] ?? tables.forest;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    _rollHuntMishap(terrainTag) {
        const tables = {
            forest: [
                {
                    type: "escalation",
                    description: "The prey escaped and drew attention. Something follows.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "economy",
                    description: "Bowstring snapped. Disadvantage on the next attack roll (repair the weapon in fiction when it fits).",
                    effects: [{
                        type: "condition",
                        condition: "disadvantage_attack",
                        duration: "1_attack",
                        label: "Disadvantage on next attack"
                    }]
                },
                {
                    type: "slot_loss",
                    description: "The chase led too far afield. No rest activity for this character.",
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                },
                {
                    type: "condition",
                    description: "Gored by a cornered animal. Poisoned until end of rest.",
                    effects: [{ type: "condition", condition: "poisoned", duration: "next_rest" }]
                }
            ],
            swamp: [
                {
                    type: "escalation",
                    description: "Disturbed something large in the water. Encounter risk increased.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "condition",
                    description: "Bitten by something venomous. Poisoned until end of rest.",
                    effects: [{ type: "condition", condition: "poisoned", duration: "next_rest" }]
                },
                {
                    type: "rest_penalty",
                    description: "Wading through muck for hours. Reduced rest recovery.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: "Lost in fog. Returned too late for rest activities.",
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ],
            desert: [
                {
                    type: "escalation",
                    description: "The prey's death cry echoed across the dunes. Something heard it.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "condition",
                    description: "Heatstroke from extended pursuit. +1 exhaustion level.",
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "economy",
                    description: "Spear shaft cracked on stone. Disadvantage on the next attack roll (repair the weapon in fiction when it fits).",
                    effects: [{
                        type: "condition",
                        condition: "disadvantage_attack",
                        duration: "1_attack",
                        label: "Disadvantage on next attack"
                    }]
                },
                {
                    type: "rest_penalty",
                    description: "Dehydrated from the chase. Reduced rest recovery.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                }
            ],
            mountain: [
                {
                    type: "escalation",
                    description: "A rockslide drew a predator's attention. Encounter risk increased.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "rest_penalty",
                    description: "Slipped on a ledge. Disadvantage on rest activity check.",
                    effects: [{ type: "travel_penalty", penalty: "activity_disadvantage" }]
                },
                {
                    type: "economy",
                    description: "Equipment lost over a cliff edge. Disadvantage on the next attack roll (replace gear in fiction when it fits).",
                    effects: [{
                        type: "condition",
                        condition: "disadvantage_attack",
                        duration: "1_attack",
                        label: "Disadvantage on next attack"
                    }]
                },
                {
                    type: "slot_loss",
                    description: "The trail led up a dead-end ridge. No rest activity for this character.",
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ],
            arctic: [
                {
                    type: "escalation",
                    description: "Blood on the snow. Predators are circling.",
                    effects: [{ type: "encounter_mod", encounterDCDelta: -2 }]
                },
                {
                    type: "condition",
                    description: "Frostbite from extended exposure. +1 exhaustion level.",
                    effects: [{ type: "exhaustion_delta", levels: 1 }]
                },
                {
                    type: "rest_penalty",
                    description: "Hypothermia risk after falling through thin ice. Reduced rest recovery.",
                    effects: [{ type: "recovery_penalty", hpMultiplier: 0.5 }]
                },
                {
                    type: "slot_loss",
                    description: "Blizzard rolled in. Returned too late for rest activities.",
                    effects: [{ type: "travel_penalty", penalty: "lose_activity" }]
                }
            ]
        };

        const pool = tables[terrainTag] ?? tables.forest;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    _getWhisperTargets(actor) {
        const targets = [];
        const gmUsers = game.users.filter(u => u.isGM);
        targets.push(...gmUsers.map(u => u.id));
        const owners = Object.entries(actor.ownership ?? {})
            .filter(([id, level]) => level >= 3 && id !== "default")
            .map(([id]) => id);
        targets.push(...owners);
        return [...new Set(targets)];
    }
}

TravelResolver.FORAGE_DC = FORAGE_DC;
TravelResolver.HUNT_DC = HUNT_DC;
