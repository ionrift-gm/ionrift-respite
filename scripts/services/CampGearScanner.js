import { getPartyActors } from "../module.js";

/**
 * CampGearScanner
 *
 * Scans party inventory for camp-relevant gear (bedroll, tent, mess kit,
 * firewood, tinderbox) and computes dual-layer comfort:
 *   - Camp Comfort (shared): terrain base + fire level + shelter spells
 *   - Personal Comfort (per-PC): camp comfort + bedroll only (tent is weather / encounter elsewhere)
 *
 * Also provides recovery previews (HP/HD/exhaustion) so the Make Camp
 * phase can show players the mechanical impact of their gear and fire state.
 */
export class CampGearScanner {

    /** Comfort tier names in ascending order. */
    static COMFORT_TIERS = ["hostile", "rough", "comfortable", "sheltered", "safe"];

    /** Aliases for legacy tier names used elsewhere in the codebase. */
    static #TIER_ALIAS = { sheltered: "sheltered", comfortable: "sheltered" };

    /** Recovery rules per comfort tier. */
    static TIER_RULES = {
        safe:        { hpFraction: 1.0, hdPenalty: 0, exhaustionDC: null,  label: "Safe" },
        sheltered:   { hpFraction: 1.0, hdPenalty: 0, exhaustionDC: null,  label: "Sheltered" },
        comfortable: { hpFraction: 1.0, hdPenalty: 0, exhaustionDC: null,  label: "Comfortable" },
        rough:       { hpFraction: 1.0, hdPenalty: 1, exhaustionDC: 10,    label: "Rough" },
        hostile:     { hpFraction: 0.75, hdPenalty: 2, exhaustionDC: 15,   label: "Hostile" }
    };

    /**
     * Scans a single actor's inventory for camp gear.
     * @param {Actor} actor
     * @returns {Object} Gear presence flags and item details.
     */
    static scanActor(actor) {
        const items = actor.items?.map(i => ({
            name: i.name?.toLowerCase() ?? "",
            quantity: i.system?.quantity ?? 1,
            originalName: i.name
        })) ?? [];

        const hasBedroll = items.some(i => i.name.includes("bedroll"));
        const hasTent = items.some(i => i.name.includes("tent"));
        const hasMessKit = items.some(i =>
            i.name.includes("mess kit") ||
            (i.name.includes("cook") && i.name.includes("utensil"))
        );
        const hasTinderbox = items.some(i =>
            i.name.includes("tinderbox") ||
            i.name.includes("flint and steel") ||
            i.name.includes("flint & steel")
        );

        const firewoodItem = items.find(i =>
            i.name.includes("firewood") || i.name === "kindling"
        );
        const firewoodCount = firewoodItem?.quantity ?? 0;

        return {
            actorId: actor.id,
            actorName: actor.name,
            actorImg: actor.img || "icons/svg/mystery-man.svg",
            hasBedroll,
            hasTent,
            hasMessKit,
            hasTinderbox,
            firewoodCount
        };
    }

    /**
     * Scans all party members and computes camp + personal comfort.
     * @param {string} terrainComfort - Base comfort from terrain (e.g. "rough").
     * @param {string} fireLevel - Fire level: "unlit", "embers", "campfire", or "bonfire".
     * @param {string|null} shelterSpell - Active shelter spell name, or null.
     * @param {string} comfortReason - Optional description of terrain comfort source.
     * @param {string} terrainLabel - Display name of the terrain.
     * @param {number} fireEncounterMod - Encounter DC modifier from having a fire.
     * @returns {Object} Full camp scan results with comfort breakdown.
     */
    static scan(terrainComfort, fireLevel = "unlit", shelterSpell = null, comfortReason = "", terrainLabel = "", fireEncounterMod = 1) {
        const actors = getPartyActors();
        const members = actors.map(a => this.scanActor(a));

        // ── Camp Comfort (shared) ──────────────────────────────
        const tiers = this.COMFORT_TIERS;
        let campTierIndex = tiers.indexOf(terrainComfort);
        if (campTierIndex < 0) campTierIndex = 1; // default to rough

        const campBreakdown = [
            { label: terrainLabel || `Base (terrain)`, value: tiers[campTierIndex], delta: 0 }
        ];

        // Shelter spell overrides to sheltered minimum
        if (shelterSpell) {
            const shelterIdx = tiers.indexOf("sheltered");
            if (campTierIndex < shelterIdx) {
                campBreakdown.push({ label: shelterSpell, value: "sheltered", delta: shelterIdx - campTierIndex });
                campTierIndex = shelterIdx;
            }
        }

        // Fire comfort matches resolution engine (FIRE_COMFORT_MOD):
        // unlit: -1 | embers: 0 | campfire: 0 | bonfire: +1
        const FIRE_COMFORT = { unlit: -1, embers: 0, campfire: 0, bonfire: 1 };
        const fireComfortDelta = FIRE_COMFORT[fireLevel] ?? 0;
        const fireIsLit = fireLevel !== "unlit";

        if (fireLevel === "unlit") {
            campBreakdown.push({ label: "No fire", value: "-1 step", delta: 0 });
            campTierIndex = Math.max(0, campTierIndex - 1);
        } else if (fireLevel === "embers") {
            campBreakdown.push({ label: "Embers", value: "fire active", delta: 0 });
        } else if (fireLevel === "campfire") {
            campBreakdown.push({ label: "Campfire", value: "aids watchkeeping", delta: 0 });
        } else if (fireLevel === "bonfire") {
            campBreakdown.push({ label: "Bonfire", value: "+1", delta: 1 });
            campTierIndex = Math.min(campTierIndex + 1, tiers.length - 1);
        }

        const campComfort = tiers[campTierIndex];
        const campComfortLabel = this.TIER_RULES[campComfort]?.label ?? campComfort;

        // ── Per-PC Personal Comfort ────────────────────────────
        const personalCards = members.map(m => {
            let personalIndex = campTierIndex;
            const breakdown = [];

            if (m.hasBedroll) {
                breakdown.push({ label: "Bedroll", icon: "fas fa-bed", delta: 1 });
                personalIndex = Math.min(personalIndex + 1, tiers.length - 1);
            }
            // Tent: weather shield and encounter DC bump only. No personal comfort.

            const personalComfort = tiers[personalIndex];
            const rules = this.TIER_RULES[personalComfort] ?? this.TIER_RULES.rough;

            // Recovery preview (approximate — final numbers come from RestFlowEngine)
            const actor = actors.find(a => a.id === m.actorId);
            const totalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
            const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));
            const hdRecovered = Math.max(0, rawHdRecovery - rules.hdPenalty + (m.hasBedroll ? 1 : 0));

            const currentHd = actor?.system?.attributes?.hd?.value ?? totalHd;
            const exitHd = Math.min(totalHd, currentHd + hdRecovered);

            return {
                ...m,
                personalComfort,
                personalComfortLabel: rules.label,
                gearBreakdown: breakdown,
                recovery: {
                    hpFull: rules.hpFraction >= 1.0,
                    hpLabel: rules.hpFraction >= 1.0 ? "Regain all HP" : `Regain ${Math.round(rules.hpFraction * 100)}% of max HP`,
                    hdLabel: rules.hdPenalty > 0
                        ? `Hit Dice recovery −${rules.hdPenalty} (${exitHd}/${totalHd})`
                        : `Recover ${hdRecovered} Hit Dice (${exitHd}/${totalHd})`,
                    hdRecovered,
                    totalHd,
                    exhaustionDC: rules.exhaustionDC,
                    exhaustionSeverity: rules.exhaustionDC ? (personalComfort === "hostile" ? "danger" : "warning") : null,
                    exhaustionLabel: (() => {
                        if (!rules.exhaustionDC) return "No exhaustion risk";
                        const reasons = [];
                        if (!fireIsLit) reasons.push("no campfire");
                        if (!m.hasBedroll) reasons.push("no bedroll");
                        let context = reasons.length > 0 ? reasons.join(", ") : "harsh terrain";
                        context = context.charAt(0).toUpperCase() + context.slice(1);
                        return `${context}. CON save DC ${rules.exhaustionDC} or gain exhaustion`;
                    })()
                }
            };
        });

        // ── Who can light the fire ─────────────────────────────
        const fireLighters = members
            .filter(m => m.hasTinderbox)
            .map(m => m.actorName);

        // ── Firewood availability ──────────────────────────────
        const firewoodHolders = members
            .filter(m => m.firewoodCount > 0)
            .map(m => ({ name: m.actorName, count: m.firewoodCount }));

        const totalFirewood = firewoodHolders.reduce((sum, h) => sum + h.count, 0);

        // ── "Without fire" preview ─────────────────────────────
        // Undo the current fire delta and apply the unlit penalty (-1)
        const noFireTierIndex = Math.max(0, campTierIndex - fireComfortDelta + FIRE_COMFORT.unlit);
        const noFireComfort = tiers[noFireTierIndex];
        const noFireRules = this.TIER_RULES[noFireComfort] ?? this.TIER_RULES.rough;

        return {
            campComfort,
            campComfortLabel,
            campBreakdown,
            comfortReason,
            terrainLabel,
            fireEncounterMod,
            hasModifiers: campBreakdown.length > 1,
            personalCards,
            fireLighters,
            firewoodHolders,
            totalFirewood,
            canLightFire: fireLighters.length > 0 && totalFirewood > 0,
            fireIsLit,
            fireLevel,
            shelterSpell,

            // "Without fire" comparison data (only relevant if fire IS lit)
            noFirePreview: fireIsLit ? {
                comfort: noFireComfort,
                comfortLabel: noFireRules.label,
                hpLabel: noFireRules.hpFraction >= 1.0 ? "HP still recovers fully" : `HP: ${Math.round(noFireRules.hpFraction * 100)}% recovery`,
                hdLabel: noFireRules.hdPenalty > 0
                    ? `HD recovery reduced (half level − ${noFireRules.hdPenalty})`
                    : "HD recovery unchanged",
                exhaustionDC: noFireRules.exhaustionDC,
                exhaustionLabel: noFireRules.exhaustionDC
                    ? `CON save DC ${noFireRules.exhaustionDC} or gain exhaustion`
                    : "No exhaustion risk"
            } : null
        };
    }
}
