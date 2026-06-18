import { ResourcePoolRoller } from "./ResourcePoolRoller.js";
import { CalendarHandler } from "./CalendarHandler.js";
import { ItemOutcomeHandler } from "./ItemOutcomeHandler.js";
import { resolvePoolFromFolderPath } from "./CompendiumFolderIndex.js";
import { STUB_HUNT_YIELDS } from "../data/stub-content.js";
import { isHomebrewProvisionOnly, getCampFuelFindChance } from "./TravelSettings.js";

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

    /** @type {Record<string, { standard?: Object[], exceptional?: Object[] }> | null} */
    #huntYields = null;

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
     * Load hunt yield tables keyed by terrain (from content packs).
     * @param {Record<string, { standard?: Object[], exceptional?: Object[] }>} yieldData
     */
    loadHuntYields(yieldData) {
        if (!yieldData || typeof yieldData !== "object") return;
        this.#huntYields = this.#huntYields ?? {};
        for (const [terrain, tiers] of Object.entries(yieldData)) {
            const prev = this.#huntYields[terrain] ?? { standard: [], exceptional: [] };
            this.#huntYields[terrain] = {
                standard: tiers.standard ?? prev.standard,
                exceptional: tiers.exceptional ?? prev.exceptional
            };
        }
    }

    /** @returns {boolean} */
    get hasHuntYields() {
        return this.#huntYields !== null && Object.keys(this.#huntYields).length > 0;
    }

    /**
     * Build hunt/forage base pools from compendium index (folder path or flags fallback).
     * @param {Iterable<{ _id: string, name?: string, folder?: string, flags?: Record<string, unknown> }>} indexEntries
     * @param {{ pathFor?: (folderId: string) => string } | null} [folderPathMap]
     * @param {{ overrideRefs?: boolean }} [options]
     */
    loadBaseItems(indexEntries, folderPathMap = null, { overrideRefs = false, packId = null } = {}) {
        if (!indexEntries) return;
        const defaultPackId = packId ?? "ionrift-respite.respite-items";
        for (const entry of indexEntries) {
            const rf = entry.flags?.["ionrift-respite"];
            let category = null;
            let terrains = null;

            if (entry.folder && folderPathMap?.pathFor) {
                const folderPath = folderPathMap.pathFor(entry.folder);
                const fromFolder = resolvePoolFromFolderPath(folderPath);
                if (fromFolder) {
                    category = fromFolder.category;
                    terrains = fromFolder.terrains;
                }
            }

            if (!category && rf?.category) {
                category = rf.category;
            }
            if (!category || !["forage", "hunt"].includes(category)) continue;

            if (!terrains?.length) {
                if (!rf?.terrain) continue;
                terrains = rf.terrain === "any"
                    ? ["forest", "swamp", "desert", "mountain", "arctic", "wilderness"]
                    : String(rf.terrain).split(",").map(t => t.trim()).filter(Boolean);
            }

            const itemRef = rf?.itemRef
                ?? String(entry.name ?? "").toLowerCase().replace(/\s+/g, "_");
            const docId = entry._id ?? entry.id;

            for (const terrain of terrains) {
                const key = `${terrain}_${category}`;
                this.#basePools[key] ??= [];
                if (overrideRefs) {
                    this.#basePools[key] = this.#basePools[key].filter(pool => pool.itemRef !== itemRef);
                }
                if (!docId) continue;
                this.#basePools[key].push({
                    itemRef,
                    _id: docId,
                    quantity: 1,
                    packId: defaultPackId
                });
            }
        }
    }

    /** Clear folder-derived base pools before a full re-index. */
    clearBasePools() {
        this.#basePools = {};
    }

    /** @returns {string[]} Keys such as forest_forage for {@link ForageActivityValidator}. */
    get basePoolCoverage() {
        return Object.keys(this.#basePools);
    }

    /**
     * @param {string} poolKey - e.g. forest_forage
     * @returns {Array<{ itemRef: string, _id: string, quantity: number }>}
     */
    getBasePoolEntries(poolKey) {
        return [...(this.#basePools[poolKey] ?? [])];
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
            items.push(...await this._getHuntYieldWithFallback(terrainTag, exceptional));
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
            items.push(...await this._getHuntYieldWithFallback(terrainTag, exceptional));

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
     * @param {Object} [opts]
     * @param {import("./GrantLedger.js").GrantLedger} [opts.ledger]
     * @param {string} [opts.slotKey]
     */
    async grantItems(actor, items, { ledger, slotKey } = {}) {
        if (!actor || !items?.length) return;

        const performGrant = async () => {
            const harvestedDate = CalendarHandler.getCurrentDate() ?? String(game.time.worldTime);
            for (const entry of items) {
                if (!entry.itemData) continue;
                const data = foundry.utils.deepClone(entry.itemData);
                data.system = data.system ?? {};
                data.system.quantity = entry.quantity ?? 1;

                const respFlags = data.flags?.[MODULE_ID];
                const spoilsAfter = respFlags?.spoilsAfter;
                if (typeof spoilsAfter === "number" && spoilsAfter > 0 && !respFlags?.harvestedDate) {
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
        };

        if (ledger && slotKey) {
            await ledger.grantOnce(slotKey, performGrant);
            return;
        }

        await performGrant();
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
        const draws = (exceptional || nat20) ? 2 : 1;
        const { ForageTableSync } = await import("./ForageTableSync.js");
        let items = await ForageTableSync.drawForageResults(terrainTag, draws);

        if (!items.length) {
            const poolId = `resource_pool_${terrainTag}`;
            const primaryRoll = await this.#poolRoller.roll(poolId, 1);
            let rareRoll = [];
            if (exceptional || nat20) {
                rareRoll = await this.#poolRoller.roll(`${poolId}_rare`, 1);
            }

            const { resolveProvisionPoolEntry } = await import("./TravelProvisionIndex.js");
            const enrichRoll = async (arr) => {
                const out = [];
                for (const row of arr) {
                    if (row.itemData) {
                        out.push(row);
                        continue;
                    }
                    if (!row.itemRef) continue;
                    const itemData = await resolveProvisionPoolEntry({
                        itemRef: row.itemRef,
                        packId: row.packId
                    });
                    if (itemData) out.push({ ...row, itemData });
                }
                return out;
            };

            items = await enrichRoll([...primaryRoll, ...rareRoll]);
        }

        if (!items.length) {
            items = await this._drawFromBasePool(terrainTag, "forage", exceptional ? 2 : 1);
        }

        // Flat side-chance; item comes from the camp fuel roll table when present.
        const campFuel = await this._rollCampFuelBonus();
        if (campFuel) {
            const existing = items.find(row => row.itemRef === campFuel.itemRef);
            if (existing) existing.quantity += campFuel.quantity;
            else items.push(campFuel);
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

    /**
     * Roll the flat camp-fuel side-chance; table is d100 with kindling on 1-30, empty 31-100.
     * @returns {Promise<{ itemRef: string, quantity: number, itemData: object }|null>}
     */
    async _rollCampFuelBonus() {
        if (Math.random() >= getCampFuelFindChance()) return null;
        const { CampFuelTableSync } = await import("./CampFuelTableSync.js");
        const draws = await CampFuelTableSync.drawCampFuelResults(1);
        return draws[0] ?? null;
    }

    /**
     * @param {number} [quantity]
     * @returns {{ itemRef: string, quantity: number, itemData: object }}
     */
    _makeKindling(quantity = 1) {
        return {
            itemRef: "kindling",
            quantity,
            itemData: {
                name: "Kindling",
                type: "loot",
                img: "icons/commodities/wood/kindling-sticks-brown.webp",
                system: {
                    description: { value: "<p>Dry twigs and bark strips.</p>" },
                    rarity: "common"
                },
                flags: { [MODULE_ID]: { itemRef: "kindling", firewoodType: "kindling" } }
            }
        };
    }

    _getSurvivalMod(actor) {
        const adapter = game.ionrift?.respite?.adapter;
        if (adapter) {
            const surMod = adapter.getSkillTotal(actor, adapter.normalizeSkillKey("sur"));
            const natMod = adapter.getSkillTotal(actor, adapter.normalizeSkillKey("nat"));
            return Math.max(surMod, natMod);
        }
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

        const { resolveProvisionPoolEntry } = await import("./TravelProvisionIndex.js");
        const results = [];
        for (const entry of drawn) {
            const itemData = await resolveProvisionPoolEntry(entry);
            if (!itemData) continue;
            results.push({
                itemRef: entry.itemRef,
                quantity: entry.quantity,
                itemData
            });
        }
        return results;
    }

    /**
     * Hunt yields from loaded tables, compendium pools, or built-in defaults.
     * @param {string} terrainTag
     * @param {boolean} exceptional
     * @returns {Object[]}
     */
    _getHuntYield(terrainTag, exceptional) {
        const builtIn = isHomebrewProvisionOnly() ? {} : TravelResolver.HUNT_YIELDS;
        const yields = { ...builtIn, ...(this.#huntYields ?? {}) };
        const terrain = yields[terrainTag] ?? yields.wilderness;
        if (terrain) {
            const tier = exceptional ? terrain.exceptional : terrain.standard;
            return (tier ?? []).map(entry => this._yieldEntryToItem(entry));
        }
        return [];
    }

    /**
     * @param {Object} entry - { type, qty?, desc? }
     * @returns {{ itemRef: string, quantity: number, itemData: object }}
     */
    _yieldEntryToItem(entry) {
        const qty = entry.qty ?? 1;
        switch (entry.type) {
            case "meat":
                return this._makeMeat(qty, entry.desc);
            case "fish":
                return this._makeFish(qty, entry.desc);
            case "choice_cut":
                return this._makeChoiceCut(qty);
            case "animal_fat":
                return this._makeAnimalFat(qty);
            case "venom_sac":
                return this._makeVenomSac(qty);
            default:
                return this._makeMeat(qty, entry.desc);
        }
    }

    _makeMeat(quantity = 1, desc) {
        return {
            itemRef: "fresh_meat",
            quantity,
            itemData: {
                name: "Fresh Meat",
                type: "consumable",
                img: "icons/consumables/meat/steak-raw-red-pink.webp",
                system: {
                    description: { value: desc ?? "<p>Game meat. Needs cooking.</p>" },
                    rarity: "common",
                    type: { value: "food", subtype: "" }
                },
                flags: { [MODULE_ID]: { foodTag: "meat", spoilsAfter: 1 } }
            }
        };
    }

    _makeFish(quantity = 1, desc) {
        return {
            itemRef: "fresh_fish",
            quantity,
            itemData: {
                name: "Fresh Fish",
                type: "consumable",
                img: "icons/consumables/meat/fish-whole-blue.webp",
                system: {
                    description: { value: desc ?? "<p>Freshwater catch. Needs cooking.</p>" },
                    rarity: "common",
                    type: { value: "food", subtype: "" }
                },
                flags: { [MODULE_ID]: { foodTag: "meat", spoilsAfter: 1 } }
            }
        };
    }

    _makeChoiceCut(quantity = 1) {
        return {
            itemRef: "choice_cut",
            quantity,
            itemData: {
                name: "Choice Cut",
                type: "consumable",
                img: "icons/consumables/meat/steak-marbled.webp",
                system: {
                    description: { value: "<p>A premium cut of game meat.</p>" },
                    rarity: "uncommon",
                    type: { value: "food", subtype: "" }
                },
                flags: { [MODULE_ID]: { foodTag: "meat", spoilsAfter: 1 } }
            }
        };
    }

    _makeAnimalFat(quantity = 1) {
        return {
            itemRef: "animal_fat",
            quantity,
            itemData: {
                name: "Animal Fat",
                type: "loot",
                img: "icons/commodities/biological/shell-tan.webp",
                system: {
                    description: { value: "<p>Rendered fat. Burns long and hot.</p>" },
                    rarity: "common"
                }
            }
        };
    }

    _makeVenomSac(quantity = 1) {
        return {
            itemRef: "venom_sac",
            quantity,
            itemData: {
                name: "Venom Sac",
                type: "loot",
                img: "icons/consumables/potions/bottle-round-corked-red.webp",
                system: {
                    description: { value: "<p>A gland from a venomous predator.</p>" },
                    rarity: "uncommon"
                }
            }
        };
    }

    /**
     * Hunt yields with compendium fallback when tables are empty.
     * @param {string} terrainTag
     * @param {boolean} exceptional
     */
    async _getHuntYieldWithFallback(terrainTag, exceptional) {
        let items = this._getHuntYield(terrainTag, exceptional);
        if (!items.length) {
            items = await this._drawFromBasePool(terrainTag, "hunt", exceptional ? 2 : 1);
        }
        return items;
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
TravelResolver.HUNT_YIELDS = STUB_HUNT_YIELDS;
