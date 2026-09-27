/**
 * Service for single-check Bivouac overnight danger checks and 7-day Downtime batch encounter drafts.
 */
import { postRollAndSettle } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";

/**
 * One night's check for the week ledger.
 * Positive nudges raise the DC.
 * @param {number} dangerDC
 * @param {number} [activityNudge]
 * @param {number} [fireNudge]
 * @param {number} [manualOffset]
 * @returns {number}
 */
export function combineNightDc(dangerDC, activityNudge = 0, fireNudge = 0, manualOffset = 0) {
    return Math.max(1, Math.min(30,
        (dangerDC ?? 15) + (activityNudge ?? 0) + (fireNudge ?? 0) + (manualOffset ?? 0)
    ));
}

export class EncounterDraftService {

    /**
     * Executes a single encounter check for a Bivouac overnight rest.
     *
     * @param {object} params
     * @param {string} [params.terrainTag="forest"]
     * @param {Actor|null} [params.sentryActor=null]
     * @param {object} [params.campStanceManager=null]
     * @param {boolean} [params.safePassage=false] - GM fudge toggle
     * @param {number} [params.baseDC=15]
     * @returns {Promise<{
     *   triggered: boolean,
     *   forcedSafe: boolean,
     *   rollTotal: number,
     *   effectiveDC: number,
     *   event: object|null,
     *   sentryName: string,
     *   sentrySurprised: boolean
     * }>}
     */
    static async checkBivouacEncounter({
        terrainTag = "forest",
        sentryActor = null,
        partyActors = [],
        campStanceManager = null,
        safePassage = false,
        baseDC = 15,
        isTerminalNight = false,
        hasActiveGuard = false,
        silent = false
    } = {}) {
        const dcMod = campStanceManager?.encounterDcModifier ?? 0;
        const effectiveDC = Math.max(5, baseDC + dcMod);

        const sentryName = sentryActor?.name ?? null;
        let pp = 10;
        if (sentryActor) {
            pp = sentryActor.system?.skills?.prc?.passive ?? sentryActor.system?.attributes?.passive?.perception ?? 10;
        } else if (Array.isArray(partyActors) && partyActors.length) {
            pp = partyActors.reduce((max, a) => {
                const p = a?.system?.skills?.prc?.passive ?? a?.system?.attributes?.passive?.perception ?? 10;
                return Math.max(max, p);
            }, 10);
        }

        if (safePassage) {
            return {
                triggered: false,
                forcedSafe: true,
                rollTotal: 20,
                effectiveDC,
                state: "green",
                category: "ambient",
                isDisaster: false,
                event: null,
                sentryName,
                sentrySurprised: false,
                hasActiveGuard
            };
        }

        const roll = await new Roll("1d20").evaluate();
        const rollTotal = roll.total;
        const isNat1 = rollTotal === 1;
        const isRed = isNat1 || (rollTotal < effectiveDC - 4);
        const isAmber = !isRed && (rollTotal < effectiveDC);
        const isGreen = rollTotal >= effectiveDC;

        const triggered = !isGreen;

        let state = "green";
        let category = "ambient";
        let isDisaster = false;
        let event = null;
        let sentrySurprised = false;

        const terrainDisplay = terrainTag ? (terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1)) : "Wilderness";
        let flavor = `<strong>Night Watch Check</strong> (${terrainDisplay}) · DC ${effectiveDC}<br>`;
        if (isGreen) {
            state = "green";
            flavor += `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Safe dawn (${rollTotal} ≥ DC ${effectiveDC}).</span>`;
        } else if (isAmber) {
            state = "amber";
            category = "non-combat";
            flavor += `<span style="color:#f59e0b;"><i class="fas fa-eye"></i> Nocturnal stir (${rollTotal} vs DC ${effectiveDC}). Ambient discovery.</span>`;
            event = {
                title: "Nocturnal Encounter",
                description: `Strange lights, curious wildlife, or wandering travelers moved through the ${terrainTag}.`,
                category: "discovery",
                isDisaster: false,
                terrainTag,
                sentryName: sentryName ?? "Camp Watch",
                sentrySurprised: false
            };
        } else {
            state = "red";
            category = "combat";
            isDisaster = isNat1;
            const stealthDC = 12;
            sentrySurprised = hasActiveGuard ? false : pp < stealthDC;
            flavor += `<span style="color:#ef4444;"><i class="fas fa-skull-crossbones"></i> Ambush! (${rollTotal} vs DC ${effectiveDC}).</span>`;
            event = {
                title: "Hostile Ambush",
                description: `Prowlers circle the perimeter in the ${terrainTag}.`,
                category: "encounter",
                isDisaster: isNat1,
                terrainTag,
                sentryName: sentryName ?? "Camp Watch",
                sentrySurprised
            };
        }

        if (!silent) {
            try {
                await postRollAndSettle(roll, {
                    speaker: { alias: "Night Watch" },
                    flavor
                });
            } catch (e) {
                console.warn("Failed to post night watch roll:", e);
            }

            if (isAmber && event) {
                await ChatMessage.create({
                    content: `<div class="respite-chat-parchment ionrift-window">` +
                        `<h3><i class="fas fa-eye" style="color:#f59e0b;"></i> Nocturnal Sighting (${terrainDisplay})</h3>` +
                        `<p>${event.description}</p>` +
                        `<p style="color:#94a3b8; font-size:0.85rem;"><i class="fas fa-shield-halved"></i> The camp remained secure and completed their rest safely.</p>` +
                        `</div>`,
                    speaker: { alias: "Night Watch" }
                });
            } else if (isRed && event) {
                const surpriseText = sentrySurprised
                    ? `<strong>Surprise Attack!</strong> The camp was caught off-guard.`
                    : `The sentry (${sentryName ?? "Camp Watch"}) spotted the threat in time.`;

                await ChatMessage.create({
                    content: `<div class="respite-chat-parchment ionrift-window">` +
                        `<h3><i class="fas fa-skull-crossbones" style="color:#ef4444;"></i> Hostile Ambush! (${terrainDisplay})</h3>` +
                        `<p>${surpriseText}</p>` +
                        `<p style="color:#ef4444;"><strong>Rest interrupted!</strong> Prepare for combat.</p>` +
                        `</div>`,
                    speaker: { alias: "Night Watch" }
                });
            }
        }

        return {
            triggered,
            forcedSafe: false,
            rollTotal,
            effectiveDC,
            state,
            category,
            isDisaster,
            event,
            sentryName,
            sentrySurprised,
            hasActiveGuard
        };
    }

    /**
     * Re-evaluates the triggered state, severity, and event classification of an
     * existing night check against a new effective DC without rerolling the d20.
     *
     * @param {object} entry
     * @param {number} effectiveDC
     * @param {string} [terrainTag="forest"]
     * @param {boolean} [isTerminalNight=false]
     * @returns {object}
     */
    static evaluateNightTrigger(entry, effectiveDC, terrainTag = "forest", isTerminalNight = false) {
        if (!entry) return entry;
        entry.effectiveDC = effectiveDC;

        if (entry.forcedSafe) {
            entry.state = "green";
            entry.triggered = false;
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.event = null;
            return entry;
        }

        if (entry.rollTotal == null) return entry;

        const triggered = entry.rollTotal < effectiveDC;
        entry.triggered = triggered;

        if (!triggered) {
            entry.state = "green";
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.event = null;
            return entry;
        }

        const rollTotal = entry.rollTotal;
        const sentryName = entry.sentryName ?? "Camp Watch";
        const sentrySurprised = entry.hasActiveGuard ? false : (entry.sentrySurprised ?? false);

        if (rollTotal < effectiveDC - 4) {
            entry.state = "red";
            entry.category = "combat";
            entry.isDisaster = false;
            entry.event = {
                title: "Hostile Ambush",
                description: `Prowlers circle the perimeter in the ${terrainTag}.`,
                category: "encounter",
                isDisaster: false,
                terrainTag,
                sentryName,
                sentrySurprised
            };
        } else {
            entry.state = "amber";
            entry.category = "non-combat";
            entry.isDisaster = false;
            entry.event = {
                title: "Nocturnal Encounter",
                description: `Strange lights, curious wildlife, or a wandering traveler approaches in the ${terrainTag}.`,
                category: "discovery",
                isDisaster: false,
                terrainTag,
                sentryName,
                sentrySurprised: false
            };
        }

        return entry;
    }

    /**
     * Batch-rolls encounter checks for all nights in a Downtime rest (Wilderness Haven).
     *
     * @param {object} params
     * @param {number} [params.days=7]
     * @param {string} [params.terrainTag="forest"]
     * @param {Actor[]} [params.partyActors=[]]
     * @param {boolean} [params.safePassage=false]
     * @param {number} [params.baseDC=15]
     * @param {Array<object>|Function} [params.nightOptions=null]
     * @returns {Promise<Array<{
     *   nightIndex: number,
     *   state: "green"|"amber"|"red",
     *   category: string,
     *   isDisaster: boolean,
     *   triggered: boolean,
     *   forcedSafe: boolean,
     *   rollTotal: number,
     *   effectiveDC: number,
     *   event: object|null,
     *   sentryName: string
     * }>>}
     */
    static async batchDowntimeEncounters({
        days = 7,
        terrainTag = "forest",
        partyActors = [],
        safePassage = false,
        baseDC = 15,
        nightOptions = null,
        silent = true
    } = {}) {
        const results = [];

        for (let i = 0; i < days; i++) {
            const isTerminalNight = (i === days - 1);
            let nightDC = baseDC;
            let sentry = null;
            let hasActiveGuard = false;

            if (Array.isArray(nightOptions) && nightOptions[i]) {
                const opt = nightOptions[i];
                if (typeof opt.effectiveDC === "number") nightDC = opt.effectiveDC;
                else if (typeof opt.baseDC === "number") nightDC = opt.baseDC;
                if (opt.sentryActor !== undefined) sentry = opt.sentryActor;
                if (opt.hasActiveGuard !== undefined) hasActiveGuard = Boolean(opt.hasActiveGuard);
            } else if (typeof nightOptions === "function") {
                const opt = nightOptions(i + 1);
                if (opt) {
                    if (typeof opt.effectiveDC === "number") nightDC = opt.effectiveDC;
                    else if (typeof opt.baseDC === "number") nightDC = opt.baseDC;
                    if (opt.sentryActor !== undefined) sentry = opt.sentryActor;
                    if (opt.hasActiveGuard !== undefined) hasActiveGuard = Boolean(opt.hasActiveGuard);
                }
            }

            const check = await this.checkBivouacEncounter({
                terrainTag,
                sentryActor: sentry,
                partyActors,
                safePassage,
                baseDC: nightDC,
                isTerminalNight,
                hasActiveGuard,
                silent
            });

            results.push({
                nightIndex: i + 1,
                state: check.state,
                category: check.category,
                isDisaster: check.isDisaster,
                triggered: check.triggered,
                forcedSafe: check.forcedSafe,
                rollTotal: check.rollTotal,
                effectiveDC: check.effectiveDC,
                event: check.event,
                sentryName: check.sentryName,
                sentrySurprised: check.sentrySurprised,
                hasActiveGuard
            });
        }

        return results;
    }

    /**
     * Cycles the encounter state of a drafted night:
     * Green (Safe) -> Amber (Event) -> Red (Ambush) -> Green (Safe)
     *
     * @param {object} entry
     * @param {boolean} [isTerminalNight=false]
     * @param {string} [terrainTag="forest"]
     * @returns {object}
     */
    static cycleNight(entry, isTerminalNight = false, terrainTag = "forest") {
        if (!entry) return entry;

        if (entry.state === "green" || !entry.triggered) {
            entry.state = "amber";
            entry.triggered = true;
            entry.forcedSafe = false;
            entry.category = "non-combat";
            entry.isDisaster = false;
            entry.event = {
                title: "Nocturnal Encounter",
                description: `Non-combat encounter, discovery, or social dilemma in the ${terrainTag}.`,
                category: "discovery",
                isDisaster: false,
                sentryName: entry.sentryName ?? "Camp Watch"
            };
        } else if (entry.state === "amber") {
            entry.state = "red";
            entry.triggered = true;
            entry.forcedSafe = false;
            entry.category = "combat";
            entry.isDisaster = false;
            entry.event = {
                title: "Hostile Ambush",
                description: `Hostile combat encounter in the ${terrainTag}.`,
                category: "encounter",
                isDisaster: false,
                sentryName: entry.sentryName ?? "Camp Watch"
            };
        } else {
            // Return to Green (Peaceful/Safe)
            entry.state = "green";
            entry.triggered = false;
            entry.forcedSafe = true;
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.event = null;
        }

        return entry;
    }
}
