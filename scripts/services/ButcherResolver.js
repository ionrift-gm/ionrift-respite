/**
 * ButcherResolver
 *
 * Handles graduated monster butchering after combat. The registry data
 * (creature-to-ingredient mappings) is loaded from a content pack at runtime.
 * If no registry is available, all methods are safe no-ops.
 *
 * Graduated outcome model:
 *   - Below DC:       basic yield (rough cuts, generic meat)
 *   - Meet DC:        standard yield (signature ingredients + secondary loot)
 *   - Beat DC by 5+:  exceptional yield (premium ingredients + full loot)
 *   - Natural 20:     exceptional + narrative flourish
 *   - Natural 1:      basic yield + mishap (damage or condition)
 */

const MODULE_ID = "ionrift-respite";

export class ButcherResolver {

    /** @type {Object|null} Loaded butcher registry keyed by classifyCreature ID. */
    static _registry = null;

    /**
     * Loads the butcher registry from a JSON object.
     * Called during pack initialization when the content pack is available.
     * @param {Object} registryData - Parsed butcher_registry.json content.
     */
    static load(registryData) {
        if (!registryData || typeof registryData !== "object") return;
        const cleaned = { ...registryData };
        delete cleaned._meta;
        ButcherResolver._registry = cleaned;
    }

    /** @returns {boolean} true if a registry has been loaded. */
    static get hasRegistry() {
        return ButcherResolver._registry !== null
            && Object.keys(ButcherResolver._registry).length > 0;
    }

    /**
     * Looks up a creature in the butcher registry.
     * Checks exact classifyCreature().id first, then falls back to the parent type.
     * @param {string} classifierId - e.g. "beast_ursine" or "dragon"
     * @param {number} cr - Creature's challenge rating.
     * @returns {Object|null} Registry entry or null if not cookable.
     */
    static lookup(classifierId, cr) {
        if (!ButcherResolver._registry) return null;
        const reg = ButcherResolver._registry;

        const entry = reg[classifierId]
            ?? reg[classifierId?.split("_")[0]]
            ?? null;

        if (!entry) return null;
        if (cr < (entry.minCR ?? 0)) return null;

        return entry;
    }

    /**
     * Checks whether any living party member has the Dungeon Gourmand's Handbook.
     * @param {Actor[]} partyActors - Array of party actor documents.
     * @returns {Actor[]} Actors who have the cookbook item.
     */
    static findCookbookHolders(partyActors) {
        return partyActors.filter(actor => {
            if (!actor || actor.system?.attributes?.hp?.value <= 0) return false;
            return actor.items.some(item =>
                item.getFlag?.(MODULE_ID, "isButcherCookbook") === true
            );
        });
    }

    /**
     * Scans defeated combatants for butcherable creatures.
     * @param {Combat} combat - The Foundry combat document being deleted.
     * @returns {Object[]} Array of { combatant, actor, classifierResult, registryEntry, cr }
     */
    static findButcherTargets(combat) {
        if (!ButcherResolver.hasRegistry) return [];

        const classifyCreature = game.ionrift?.library?.classifyCreature;
        if (!classifyCreature) return [];

        const targets = [];

        for (const combatant of combat.combatants ?? []) {
            const actor = combatant.actor;
            if (!actor) continue;
            if (actor.hasPlayerOwner) continue;

            const hp = actor.system?.attributes?.hp?.value ?? 1;
            if (hp > 0) continue;

            const cr = actor.system?.details?.cr ?? 0;
            const result = classifyCreature(actor);
            if (!result?.id || result.id === "unknown") continue;

            const entry = ButcherResolver.lookup(result.id, cr);
            if (!entry) continue;

            targets.push({
                combatant,
                actor,
                actorName: actor.name ?? combatant.name ?? "Unknown Creature",
                actorImg: actor.img ?? combatant.img ?? "icons/svg/mystery-man.svg",
                classifierResult: result,
                registryEntry: entry,
                cr
            });
        }

        // Sort by CR descending, take the most notable
        targets.sort((a, b) => b.cr - a.cr);
        return targets;
    }

    /**
     * Calculates the butchering DC for a creature.
     * @param {number} cr - Creature's challenge rating.
     * @returns {number} The Survival DC.
     */
    static calculateDC(cr) {
        return 10 + Math.floor(cr / 2);
    }

    /**
     * Determines the yield tier based on the roll result.
     * @param {number} rollTotal - Total of the Survival roll.
     * @param {number} dc - The target DC.
     * @param {number} naturalRoll - The d20 natural result.
     * @returns {string} "exceptional", "standard", "basic", "nat20", or "nat1"
     */
    static determineOutcome(rollTotal, dc, naturalRoll) {
        if (naturalRoll === 1) return "nat1";
        if (naturalRoll === 20) return "nat20";
        if (rollTotal >= dc + 5) return "exceptional";
        if (rollTotal >= dc) return "standard";
        return "basic";
    }

    /**
     * Resolves a butchering attempt. Creates items on the actor and returns
     * a result summary for the chat card.
     *
     * @param {Actor} actor - The character performing the butchering.
     * @param {Object} target - A target object from findButcherTargets().
     * @returns {Object} { outcome, yields, mishap, narrative, roll, dc }
     */
    static async resolve(actor, target) {
        const { registryEntry, cr, actorName } = target;
        const dc = ButcherResolver.calculateDC(cr);

        const skillData = actor.system?.skills?.sur;
        const modifier = skillData?.total ?? skillData?.mod ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Butchering ${actorName} (Survival) DC ${dc}`
        });

        const naturalRoll = roll.dice[0]?.results?.[0]?.result ?? roll.total;
        const outcome = ButcherResolver.determineOutcome(roll.total, dc, naturalRoll);

        let yieldTier;
        let mishap = null;
        let narrative = registryEntry.flavour ?? "";

        switch (outcome) {
            case "nat20":
                yieldTier = "exceptional";
                narrative += " A masterful display of field dressing.";
                break;
            case "nat1":
                yieldTier = "basic";
                mishap = registryEntry.mishap ?? null;
                break;
            case "exceptional":
                yieldTier = "exceptional";
                break;
            case "standard":
                yieldTier = "standard";
                break;
            default:
                yieldTier = "basic";
                break;
        }

        const yields = registryEntry[yieldTier] ?? registryEntry.basic ?? [];
        const grantedItems = [];

        const { ItemOutcomeHandler } = await import("./ItemOutcomeHandler.js");

        for (const y of yields) {
            const itemData = {
                name: y.name,
                type: y.type === "loot" ? "loot" : "consumable",
                img: ButcherResolver._resolveIcon(y),
                quantity: y.qty ?? 1,
                system: {
                    description: { value: `<p>Butchered from ${actorName}.</p>` },
                    rarity: ButcherResolver._tierToRarity(registryEntry.tier),
                    ...(y.type !== "loot" ? { type: { value: "food", subtype: "" } } : {})
                }
            };

            const flags = {};
            if (y.foodTag) flags.foodTag = y.foodTag;
            if (y.spoilsAfter) flags.spoilsAfter = y.spoilsAfter;
            flags.monsterIngredient = true;

            const granted = await ItemOutcomeHandler.grantItemsToActor(actor, [{
                ...itemData,
                flags: { [MODULE_ID]: flags }
            }]);

            grantedItems.push(...(granted ?? []));
        }

        return {
            outcome,
            yieldTier,
            yields,
            grantedItems,
            mishap,
            narrative,
            roll: roll.total,
            naturalRoll,
            dc,
            creatureName: actorName,
            creatureImg: target.actorImg,
            tier: registryEntry.tier ?? "common",
            label: registryEntry.label ?? actorName
        };
    }

    /**
     * Resolves an icon path for a butchered yield item.
     * @param {Object} yield - { name, type, foodTag }
     * @returns {string} Icon path.
     */
    static _resolveIcon(y) {
        if (y.type === "loot") return "icons/commodities/bones/teeth-sharp-gray.webp";
        if (y.foodTag === "essence") return "icons/commodities/gems/gem-rough-oval-purple.webp";
        if (y.foodTag === "plant") return "icons/consumables/food/mushroom-brown.webp";
        return "icons/consumables/food/meat-raw-red.webp";
    }

    /**
     * Maps tier label to Foundry rarity.
     * @param {string} tier
     * @returns {string}
     */
    static _tierToRarity(tier) {
        const map = { common: "common", uncommon: "uncommon", rare: "rare", legendary: "legendary" };
        return map[tier] ?? "common";
    }

    /**
     * Builds the HTML content for a butcher prompt chat card.
     * @param {Object} target - A target from findButcherTargets().
     * @param {Actor[]} holders - Actors who have the cookbook.
     * @returns {string} HTML string for the ChatMessage content.
     */
    static buildPromptCard(target, holders) {
        const dc = ButcherResolver.calculateDC(target.cr);
        const holderNames = holders.map(a => a.name).join(", ");

        return `<div class="respite-butcher-card">
            <div class="butcher-card-header">
                <img src="${target.actorImg}" alt="${target.actorName}" class="butcher-creature-img" />
                <div class="butcher-card-title">
                    <h3>${target.actorName}</h3>
                    <span class="butcher-tier tier-${target.registryEntry.tier ?? "common"}">${target.registryEntry.tier ?? "common"}</span>
                </div>
            </div>
            <p class="butcher-flavour">${target.registryEntry.flavour ?? ""}</p>
            <div class="butcher-card-info">
                <span><strong>Survival DC:</strong> ${dc}</span>
                <span><strong>CR:</strong> ${target.cr}</span>
            </div>
            <p class="butcher-holders"><i class="fas fa-book"></i> ${holderNames} can butcher this creature.</p>
            <div class="butcher-card-actions">
                <button type="button" class="btn-butcher" data-creature-id="${target.combatant.id}" data-actor-id="${target.actor.id}">
                    <i class="fas fa-drumstick-bite"></i> Butcher
                </button>
                <button type="button" class="btn-butcher-pass" data-creature-id="${target.combatant.id}">
                    <i class="fas fa-times"></i> Pass
                </button>
            </div>
        </div>`;
    }

    /**
     * Builds the HTML content for a butcher result chat card.
     * @param {Object} result - Result from resolve().
     * @param {string} butcherName - Name of the character who butchered.
     * @returns {string} HTML string.
     */
    static buildResultCard(result, butcherName) {
        const tierClass = `tier-${result.tier}`;
        const yieldLines = result.yields.map(y =>
            `<li>${y.qty}x ${y.name}${y.type === "loot" ? " <span class='loot-tag'>loot</span>" : ""}</li>`
        ).join("");

        const outcomeLabel = {
            nat20: "Natural 20",
            nat1: "Natural 1",
            exceptional: "Exceptional",
            standard: "Standard",
            basic: "Basic"
        }[result.outcome] ?? result.outcome;

        let mishapHtml = "";
        if (result.mishap) {
            mishapHtml = `<div class="butcher-mishap">
                <i class="fas fa-skull"></i>
                <span>${result.mishap.desc}</span>
                ${result.mishap.damage ? `<span class="mishap-damage">${result.mishap.damage} ${result.mishap.damageType ?? ""} damage</span>` : ""}
            </div>`;
        }

        return `<div class="respite-butcher-card result">
            <div class="butcher-card-header">
                <img src="${result.creatureImg}" alt="${result.creatureName}" class="butcher-creature-img" />
                <div class="butcher-card-title">
                    <h3>${result.creatureName}</h3>
                    <span class="butcher-tier ${tierClass}">${result.tier}</span>
                </div>
            </div>
            <div class="butcher-result-summary">
                <span class="butcher-who"><i class="fas fa-user"></i> ${butcherName}</span>
                <span class="butcher-roll">Roll: <strong>${result.roll}</strong> vs DC <strong>${result.dc}</strong></span>
                <span class="butcher-outcome outcome-${result.outcome}">${outcomeLabel}</span>
            </div>
            <p class="butcher-flavour">${result.narrative}</p>
            <ul class="butcher-yields">${yieldLines}</ul>
            ${mishapHtml}
        </div>`;
    }

    /**
     * Builds the HTML content for the monster cooking splash card.
     * Fired when a monster recipe succeeds during rest.
     * @param {Object} craftResult - Result from CraftingEngine.resolve().
     * @param {string} cookName - Name of the character who cooked.
     * @returns {string} HTML string.
     */
    static buildCookingSplash(craftResult, cookName) {
        const output = craftResult.output ?? {};
        const rarity = output.rarity ?? "common";

        const ingredientLines = (craftResult.ingredients ?? []).map(i =>
            `<span class="splash-ingredient">${i.name}</span>`
        ).join("");

        return `<div class="respite-monster-cooking-splash">
            <div class="splash-banner">
                <img src="${output.img ?? "icons/consumables/food/feast-turkey-grey.webp"}" alt="${output.name}" class="splash-dish-img" />
            </div>
            <h2 class="splash-title rarity-${rarity}">${output.name ?? craftResult.recipeName}</h2>
            <p class="splash-cook"><i class="fas fa-hat-chef"></i> Prepared by <strong>${cookName}</strong></p>
            <div class="splash-ingredients">${ingredientLines}</div>
            <p class="splash-description">${output.description ?? ""}</p>
            <p class="splash-narrative">${craftResult.narrative ?? ""}</p>
        </div>`;
    }
}
