import { getPartyActors } from "./partyActors.js";
import {
    COMFORT_TIERS,
    boostComfort,
    getHdPenalty,
    getHpFraction,
    getExhaustionDC
} from "./ComfortCalculator.js";

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

    static getRules(tier) {
        return {
            hpFraction: getHpFraction(tier),
            hdPenalty: getHdPenalty(tier),
            exhaustionDC: getExhaustionDC(tier),
            label: tier.charAt(0).toUpperCase() + tier.slice(1)
        };
    }

    /** Firewood spent when the party commits this fire level during Make Camp. */
    static FIREWOOD_COST_BY_LEVEL = Object.freeze({
        embers: 0,
        campfire: 1,
        bonfire: 2
    });

    /** Encounter DC modifier from fire size (subtracted from baseDC, so negative = displayed DC rises). */
    static FIRE_ENCOUNTER_MOD_BY_LEVEL = Object.freeze({
        unlit: 0,
        embers: 0,
        campfire: -1,
        bonfire: -2
    });

    /**
     * Canvas flame token: footprint, art scale, and light (bright/dim in scene distance units, usually feet).
     * Merged over template actor light when the fire is lit. Tuned so embers read as a small deep-red glow,
     * campfire as classic warm orange, bonfire as broad yellow-white.
     */
    static FIRE_TOKEN_VISUAL_BY_LEVEL = Object.freeze({
        embers: {
            width: 0.82,
            height: 0.82,
            textureScale: 0.86,
            light: {
                bright: 8,
                dim: 20,
                color: "#6e1418",
                alpha: 0.48,
                luminosity: 0.3,
                saturation: 0.12,
                coloration: 1,
                animation: { type: "torch", speed: 2, intensity: 2, reverse: false }
            }
        },
        campfire: {
            width: 0.95,
            height: 0.95,
            textureScale: 0.96,
            light: {
                bright: 12,
                dim: 26,
                color: "#ff9329",
                alpha: 0.42,
                luminosity: 0.48,
                saturation: 0.02,
                coloration: 1,
                animation: { type: "torch", speed: 3, intensity: 4, reverse: false }
            }
        },
        bonfire: {
            width: 1.12,
            height: 1.12,
            textureScale: 1.06,
            light: {
                bright: 20,
                dim: 30,
                color: "#fff2a6",
                alpha: 0.52,
                luminosity: 0.72,
                saturation: 0.08,
                coloration: 1,
                animation: { type: "torch", speed: 4, intensity: 6, reverse: false }
            }
        }
    });



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
        let campComfort = COMFORT_TIERS.includes(terrainComfort) ? terrainComfort : "rough";

        const campBreakdown = [
            { label: terrainLabel || `Base (terrain)`, value: campComfort, delta: 0 }
        ];

        // Shelter spell overrides to sheltered minimum
        if (shelterSpell) {
            if (campComfort === "hostile" || campComfort === "rough") {
                campBreakdown.push({ label: shelterSpell, value: "sheltered", delta: campComfort === "hostile" ? 2 : 1 });
                campComfort = "sheltered";
            }
        }

        const campComfortPreFire = campComfort;

        // Fire comfort matches resolution engine (FIRE_COMFORT_MOD):
        // unlit: -1 | embers: 0 | campfire: 0 | bonfire: +1
        const FIRE_COMFORT = { unlit: -1, embers: 0, campfire: 0, bonfire: 1 };
        const fireComfortDelta = FIRE_COMFORT[fireLevel] ?? 0;
        const fireIsLit = fireLevel !== "unlit";

        if (fireLevel === "unlit") {
            campBreakdown.push({ label: "No fire", value: "-1 comfort", delta: 0 });
            campComfort = boostComfort(campComfort, -1);
        } else if (fireLevel === "embers") {
            campBreakdown.push({ label: "Embers", value: "fire active", delta: 0 });
        } else if (fireLevel === "campfire") {
            campBreakdown.push({ label: "Campfire", value: "fire active", delta: 0 });
        } else if (fireLevel === "bonfire") {
            campBreakdown.push({ label: "Bonfire", value: "+1", delta: 1 });
            campComfort = boostComfort(campComfort, 1);
        }

        const campComfortLabel = this.getRules(campComfort).label;
        const _tr = this.getRules(campComfort);
        const _tipParts = [];
        _tipParts.push(_tr.hpFraction < 1 ? `${Math.round(_tr.hpFraction * 100)}% HP recovery` : "Full HP recovery");
        if (_tr.hdPenalty > 0) _tipParts.push(`-${_tr.hdPenalty} HD`);
        if (_tr.exhaustionDC) _tipParts.push(`CON save DC ${_tr.exhaustionDC} or gain exhaustion`);
        else _tipParts.push("No exhaustion risk");
        const comfortTooltip = _tipParts.join(", ");

        // ── Per-PC Personal Comfort ────────────────────────────
        const personalCards = members.map(m => {
            let personalComfort = campComfort;
            const breakdown = [];

            if (m.hasBedroll) {
                breakdown.push({ label: "Bedroll", icon: "fas fa-bed", delta: 1 });
                personalComfort = boostComfort(personalComfort, 1);
            }
            // Tent: weather shield and encounter DC bump only. No personal comfort.

            const rules = this.getRules(personalComfort);

            // Recovery preview (approximate — final numbers come from RestFlowEngine)
            const actor = actors.find(a => a.id === m.actorId);
            const totalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
            const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));
            const hdRecovered = Math.max(0, rawHdRecovery - rules.hdPenalty + (m.hasBedroll ? 1 : 0));

            const currentHd = actor?.system?.attributes?.hd?.value ?? totalHd;
            const exitHd = Math.min(totalHd, currentHd + hdRecovered);

            const hpSeverity = rules.hpFraction < 1.0 ? "danger" : "";
            let hdSeverity = "";
            if (hdRecovered === 0) hdSeverity = "danger";
            else if (rules.hdPenalty > 0) hdSeverity = "warning";

            return {
                ...m,
                personalComfort,
                personalComfortLabel: rules.label,
                personalMatchesCamp: personalComfort === campComfort,
                gearBreakdown: breakdown,
                recovery: {
                    hpFull: rules.hpFraction >= 1.0,
                    hpLabel: rules.hpFraction >= 1.0 ? "Regain all HP" : `Regain ${Math.round(rules.hpFraction * 100)}% of max HP`,
                    hpSeverity,
                    hdLabel: (() => {
                        const singPlur = hdRecovered === 1 ? "Hit Die" : "Hit Dice";
                        const pool = `will be ${exitHd}/${totalHd} after rest`;
                        if (rules.hdPenalty > 0) {
                            return `Recover ${hdRecovered} ${singPlur}, ${pool} (comfort −${rules.hdPenalty})`;
                        }
                        return `Recover ${hdRecovered} ${singPlur}, ${pool}`;
                    })(),
                    hdSeverity,
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
            .map(m => ({
                actorId: m.actorId,
                actorName: m.actorName,
                method: "Tinderbox"
            }));

        // ── Firewood availability ──────────────────────────────
        const firewoodHolders = members
            .filter(m => m.firewoodCount > 0)
            .map(m => ({ actorId: m.actorId, name: m.actorName, count: m.firewoodCount }));

        const totalFirewood = firewoodHolders.reduce((sum, h) => sum + h.count, 0);

        const costEmbers = this.FIREWOOD_COST_BY_LEVEL.embers ?? 0;
        const costCampfire = this.FIREWOOD_COST_BY_LEVEL.campfire ?? 1;
        const costBonfire = this.FIREWOOD_COST_BY_LEVEL.bonfire ?? 2;
        const canTinder = fireLighters.length > 0;
        const fireSelection = {
            canPickEmbers: true,  // embers just needs any fire starter; disabled state handled by UI
            canPickCampfire: canTinder && totalFirewood >= costCampfire,
            canPickBonfire: canTinder && totalFirewood >= costBonfire,
            costEmbers,
            costCampfire,
            costBonfire
        };

        // ── "Without fire" preview ─────────────────────────────
        // Undo the current fire delta and apply the unlit penalty (-1)
        const noFireComfort = boostComfort(campComfortPreFire, FIRE_COMFORT.unlit);
        const noFireRules = this.getRules(noFireComfort);

        return {
            campComfort,
            campComfortPreFire,
            campComfortLabel,
            comfortTooltip,
            campBreakdown,
            comfortReason,
            terrainLabel,
            fireEncounterMod,
            hasModifiers: campBreakdown.length > 1,
            personalCards,
            fireLighters,
            firewoodHolders,
            totalFirewood,
            canLightFire: fireLighters.length > 0,
            fireSelection,
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
