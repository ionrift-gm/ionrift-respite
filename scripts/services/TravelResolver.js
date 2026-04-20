import { ResourcePoolRoller } from "./ResourcePoolRoller.js";
import { CalendarHandler } from "./CalendarHandler.js";

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

        if (nat1) {
            mishap = this._rollForageMishap(terrainTag);
        } else if (success) {
            const poolId = `resource_pool_${terrainTag}`;
            items = await this.#poolRoller.roll(poolId, 1);

            if (exceptional || nat20) {
                const rarePoolId = `resource_pool_${terrainTag}_rare`;
                const rareItems = await this.#poolRoller.roll(rarePoolId, 1);
                items.push(...rareItems);
            }
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
            mishap
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

        if (nat1) {
            mishap = this._rollForageMishap(terrainTag);
        } else if (success) {
            const poolId = `resource_pool_${terrainTag}`;
            items = await this.#poolRoller.roll(poolId, 1);
            if (exceptional || nat20) {
                const rarePoolId = `resource_pool_${terrainTag}_rare`;
                const rareItems = await this.#poolRoller.roll(rarePoolId, 1);
                items.push(...rareItems);
            }
        }

        return {
            activity: "forage", actorId: actor.id, actorName: actor.name,
            success, nat20, nat1, exceptional, total, dc, items, mishap
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
            items.push(...this._getHuntYield(terrainTag, exceptional));
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
            items.push(...this._getHuntYield(terrainTag, exceptional));

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
     * Grant resolved items to an actor's inventory.
     * @param {Actor} actor
     * @param {Object[]} items - Array of { itemRef, quantity, itemData }
     * @returns {Item[]} Created Foundry Item documents
     */
    async grantItems(actor, items) {
        if (!actor || !items?.length) return [];

        const harvestedDate = CalendarHandler.getCurrentDate() ?? String(game.time.worldTime);
        const created = [];
        for (const entry of items) {
            if (!entry.itemData) continue;
            const data = foundry.utils.deepClone(entry.itemData);
            data.system = data.system ?? {};
            data.system.quantity = entry.quantity ?? 1;

            // Stamp harvestedDate on perishable items
            const respFlags = data.flags?.[MODULE_ID];
            if (respFlags?.spoilsAfter != null && !respFlags.harvestedDate) {
                data.flags[MODULE_ID].harvestedDate = harvestedDate;
            }

            const [item] = await actor.createEmbeddedDocuments("Item", [data]);
            if (item) created.push(item);
        }
        return created;
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

    _getSurvivalMod(actor) {
        const sur = actor.system?.skills?.sur;
        const nat = actor.system?.skills?.nat;
        const surMod = sur?.total ?? 0;
        const natMod = nat?.total ?? 0;
        return Math.max(surMod, natMod);
    }

    /**
     * Terrain-specific hunt yield tables.
     * @param {string} terrainTag
     * @param {boolean} exceptional - Beat DC by 5+
     * @returns {Object[]} Array of item entries
     */
    _getHuntYield(terrainTag, exceptional) {
        const tier = exceptional ? "exceptional" : "standard";
        const yields = TravelResolver.HUNT_YIELDS[terrainTag]?.[tier]
            ?? TravelResolver.HUNT_YIELDS.wilderness[tier];
        return yields.map(entry => {
            if (entry.type === "meat") return this._makeMeat(entry.qty ?? 1, entry.desc);
            if (entry.type === "fish") return this._makeFish(entry.qty ?? 1, entry.desc);
            if (entry.type === "choice_cut") return this._makeChoiceCut(entry.qty ?? 1);
            if (entry.type === "animal_fat") return this._makeAnimalFat(entry.qty ?? 1);
            if (entry.type === "venom_sac") return this._makeVenomSac(entry.qty ?? 1);
            return this._makeMeat(entry.qty ?? 1);
        });
    }

    _makeMeat(quantity, description) {
        return {
            itemRef: "fresh_meat",
            quantity,
            itemData: {
                name: "Fresh Meat",
                type: "consumable",
                img: "icons/consumables/food/meat-raw-red.webp",
                system: {
                    description: { value: description ?? "<p>Game meat from a successful hunt. Needs cooking.</p>" },
                    rarity: "common",
                    type: { value: "food", subtype: "" }
                },
                flags: { "ionrift-respite": { foodTag: "meat", spoilsAfter: 1 } }
            }
        };
    }

    _makeChoiceCut(quantity) {
        return {
            itemRef: "choice_cut",
            quantity,
            itemData: {
                name: "Choice Cut",
                type: "consumable",
                img: "icons/consumables/food/meat-steak-red.webp",
                system: {
                    description: { value: "<p>A premium cut of game meat. Higher quality yields better cooking outcomes.</p>" },
                    rarity: "uncommon",
                    type: { value: "food", subtype: "" }
                },
                flags: { "ionrift-respite": { foodTag: "meat", spoilsAfter: 1 } }
            }
        };
    }

    _makeFish(quantity, description) {
        return {
            itemRef: "fresh_fish",
            quantity,
            itemData: {
                name: "Fresh Fish",
                type: "consumable",
                img: "icons/consumables/food/fish-raw-blue.webp",
                system: {
                    description: { value: description ?? "<p>Freshwater catch. Needs cooking.</p>" },
                    rarity: "common",
                    type: { value: "food", subtype: "" }
                },
                flags: { "ionrift-respite": { foodTag: "meat", spoilsAfter: 1 } }
            }
        };
    }

    _makeAnimalFat(quantity) {
        return {
            itemRef: "animal_fat",
            quantity,
            itemData: {
                name: "Animal Fat",
                type: "loot",
                img: "icons/commodities/biological/organ-heart-red.webp",
                system: {
                    description: { value: "<p>Rendered fat from a large arctic animal. Burns long and hot. Substitute for lamp oil.</p>" },
                    rarity: "common"
                }
            }
        };
    }

    _makeVenomSac(quantity) {
        return {
            itemRef: "venom_sac",
            quantity,
            itemData: {
                name: "Venom Sac",
                type: "loot",
                img: "icons/commodities/biological/organ-sac-green.webp",
                system: {
                    description: { value: "<p>A gland from a venomous desert predator. Useful for antidotes or poisons.</p>" },
                    rarity: "uncommon"
                }
            }
        };
    }

    _rollForageMishap(terrainTag) {
        const tables = {
            forest: [
                { type: "condition", description: "Touched something toxic. Poisoned until end of rest (Con save DC 12 to shrug it off early).", effect: "poisoned" },
                { type: "economy", description: "A waterskin punctured on thorns. Lost 1 waterskin.", effect: "lose_water" },
                { type: "rest_penalty", description: "Got turned around in the brush. Disadvantage on rest activity check.", effect: "activity_disadvantage" },
                { type: "escalation", description: "Disturbed a nest. Something followed the forager back to camp.", effect: "escalate_encounter" }
            ],
            swamp: [
                { type: "condition", description: "Waded through something foul. Diseased (persists beyond rest, requires Lesser Restoration).", effect: "diseased" },
                { type: "economy", description: "Rations fell in the muck. Lost 1 rations.", effect: "lose_food" },
                { type: "rest_penalty", description: "Sank waist-deep in a bog. Reduced rest recovery for this character.", effect: "reduced_recovery" },
                { type: "slot_loss", description: "Spent hours finding a way back. No rest activity for this character.", effect: "lose_activity" }
            ],
            desert: [
                { type: "condition", description: "Heat exhaustion from wandering too far. +1 exhaustion level.", effect: "exhaustion" },
                { type: "economy", description: "A waterskin cracked in the heat. Lost 1 waterskin.", effect: "lose_water" },
                { type: "escalation", description: "Stumbled into a sand viper's territory. Something stirs near camp.", effect: "escalate_encounter" },
                { type: "rest_penalty", description: "Sunstroke. Reduced rest recovery for this character.", effect: "reduced_recovery" }
            ],
            mountain: [
                { type: "condition", description: "Twisted an ankle on loose scree. Disadvantage on rest activity check.", effect: "activity_disadvantage" },
                { type: "economy", description: "Pack tore on a rock face. Lost 1 random supply item.", effect: "lose_supply" },
                { type: "escalation", description: "Dislodged rocks drew attention. Something watches from above.", effect: "escalate_encounter" },
                { type: "rest_penalty", description: "Altitude sickness. Reduced rest recovery for this character.", effect: "reduced_recovery" }
            ],
            arctic: [
                { type: "condition", description: "Frostbite setting in. +1 exhaustion level.", effect: "exhaustion" },
                { type: "economy", description: "Supplies exposed to wind. Lost 1 rations.", effect: "lose_food" },
                { type: "rest_penalty", description: "Hypothermia risk. Reduced rest recovery for this character.", effect: "reduced_recovery" },
                { type: "slot_loss", description: "Whiteout conditions. Returned too late for rest activities.", effect: "lose_activity" }
            ]
        };

        const pool = tables[terrainTag] ?? tables.forest;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    _rollHuntMishap(terrainTag) {
        const tables = {
            forest: [
                { type: "escalation", description: "The prey escaped and drew attention. Something follows.", effect: "escalate_encounter" },
                { type: "economy", description: "Bowstring snapped. Weapon imposes disadvantage until repaired.", effect: "weapon_damaged" },
                { type: "slot_loss", description: "The chase led too far afield. No rest activity for this character.", effect: "lose_activity" },
                { type: "condition", description: "Gored by a cornered animal. Poisoned until end of rest.", effect: "poisoned" }
            ],
            swamp: [
                { type: "escalation", description: "Disturbed something large in the water. Encounter risk increased.", effect: "escalate_encounter" },
                { type: "condition", description: "Bitten by something venomous. Poisoned until end of rest.", effect: "poisoned" },
                { type: "rest_penalty", description: "Wading through muck for hours. Reduced rest recovery.", effect: "reduced_recovery" },
                { type: "slot_loss", description: "Lost in fog. Returned too late for rest activities.", effect: "lose_activity" }
            ],
            desert: [
                { type: "escalation", description: "The prey's death cry echoed across the dunes. Something heard it.", effect: "escalate_encounter" },
                { type: "condition", description: "Heatstroke from extended pursuit. +1 exhaustion level.", effect: "exhaustion" },
                { type: "economy", description: "Spear shaft cracked on stone. Weapon imposes disadvantage until repaired.", effect: "weapon_damaged" },
                { type: "rest_penalty", description: "Dehydrated from the chase. Reduced rest recovery.", effect: "reduced_recovery" }
            ],
            mountain: [
                { type: "escalation", description: "A rockslide drew a predator's attention. Encounter risk increased.", effect: "escalate_encounter" },
                { type: "condition", description: "Slipped on a ledge. Disadvantage on rest activity check.", effect: "activity_disadvantage" },
                { type: "economy", description: "Equipment lost over a cliff edge. Weapon imposes disadvantage until repaired.", effect: "weapon_damaged" },
                { type: "slot_loss", description: "The trail led up a dead-end ridge. No rest activity for this character.", effect: "lose_activity" }
            ],
            arctic: [
                { type: "escalation", description: "Blood on the snow. Predators are circling.", effect: "escalate_encounter" },
                { type: "condition", description: "Frostbite from extended exposure. +1 exhaustion level.", effect: "exhaustion" },
                { type: "rest_penalty", description: "Hypothermia risk after falling through thin ice. Reduced rest recovery.", effect: "reduced_recovery" },
                { type: "slot_loss", description: "Blizzard rolled in. Returned too late for rest activities.", effect: "lose_activity" }
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

/**
 * Per-terrain hunt yield descriptors.
 * Each entry specifies a type (meat, fish, choice_cut, animal_fat, venom_sac)
 * and optional qty/desc. _getHuntYield() maps these to item objects at runtime.
 */
TravelResolver.HUNT_YIELDS = {
    forest: {
        standard: [
            { type: "meat", qty: 1, desc: "<p>Deer or rabbit from the forest. Needs cooking.</p>" }
        ],
        exceptional: [
            { type: "choice_cut", qty: 1 },
            { type: "meat", qty: 1, desc: "<p>Deer or rabbit from the forest. Needs cooking.</p>" }
        ]
    },
    swamp: {
        standard: [
            { type: "fish", qty: 2, desc: "<p>Marsh fish pulled from the shallows. Needs cooking.</p>" }
        ],
        exceptional: [
            { type: "fish", qty: 4, desc: "<p>A good haul of marsh fish. Needs cooking.</p>" }
        ]
    },
    mountain: {
        standard: [
            { type: "meat", qty: 1, desc: "<p>Mountain hare or ptarmigan. Lean but filling.</p>" }
        ],
        exceptional: [
            { type: "choice_cut", qty: 1 }
        ]
    },
    arctic: {
        standard: [
            { type: "meat", qty: 1, desc: "<p>Arctic hare or seal. Rich in fat, essential for warmth.</p>" }
        ],
        exceptional: [
            { type: "choice_cut", qty: 1 },
            { type: "animal_fat", qty: 1 }
        ]
    },
    desert: {
        standard: [
            { type: "meat", qty: 1, desc: "<p>Desert lizard or snake. Tough but edible.</p>" }
        ],
        exceptional: [
            { type: "meat", qty: 1, desc: "<p>Desert lizard or snake. Tough but edible.</p>" },
            { type: "venom_sac", qty: 1 }
        ]
    },
    wilderness: {
        standard: [
            { type: "meat", qty: 1 }
        ],
        exceptional: [
            { type: "choice_cut", qty: 1 },
            { type: "meat", qty: 1 }
        ]
    }
};
