import {
    isPf2eSystem,
    getPf2eLevelBasedDC,
    evaluatePf2eSaveDegree
} from "../../camp/gear/Pf2eComfortRules.js";

const PF2E_ABILITY_TO_CHECK_MAP = {
    str: "athletics",
    dex: "reflex",
    con: "fortitude",
    int: "society",
    wis: "will",
    cha: "diplomacy"
};

const PF2E_SAVE_KEYS = new Set(["fortitude", "reflex", "will"]);

const PF2E_SAVE_LABELS = {
    fortitude: "Fortitude",
    reflex: "Reflex",
    will: "Will"
};

const PF2E_NATIVE_CONDITIONS = new Set([
    "blinded",
    "clumsy",
    "confused",
    "controlled",
    "dazzled",
    "deafened",
    "doomed",
    "drained",
    "dying",
    "encumbered",
    "enfeebled",
    "fascinated",
    "fatigued",
    "fleeing",
    "frightened",
    "grabbed",
    "immobilized",
    "off-guard",
    "paralyzed",
    "petrified",
    "prone",
    "quickened",
    "restrained",
    "sickened",
    "slowed",
    "stunned",
    "stupefied",
    "unconscious",
    "wounded"
]);

/**
 * Normalizes an event or decision-tree skill/ability key for PF2e.
 * Raw ability keys ("dex", "con", "str", etc.) map to leveled PF2e saves or skills
 * because PF2e Remaster has no leveled raw ability checks.
 *
 * @param {string} key
 * @param {object|null} [adapter]
 * @returns {string}
 */
export function normalizePf2eEventSkillKey(key, adapter = null) {
    if (!key) return "perception";
    const lower = String(key).trim().toLowerCase();
    if (PF2E_SAVE_KEYS.has(lower)) return lower;
    if (PF2E_ABILITY_TO_CHECK_MAP[lower]) return PF2E_ABILITY_TO_CHECK_MAP[lower];
    const sysAdapter = adapter ?? globalThis.game?.ionrift?.respite?.adapter ?? null;
    if (sysAdapter?.normalizeSkillKey) return sysAdapter.normalizeSkillKey(lower);
    return lower;
}

/**
 * Computes a PF2e actor's modifier for an event, camp, or decision-tree check,
 * routing save keys to Fortitude/Reflex/Will and skill keys to totalModifier.
 *
 * @param {Actor} actor
 * @param {string} key
 * @param {object|null} [adapter]
 * @returns {number}
 */
export function getPf2eActorCheckMod(actor, key, adapter = null) {
    if (!actor) return 0;
    const sysAdapter = adapter ?? globalThis.game?.ionrift?.respite?.adapter ?? null;
    const normalized = normalizePf2eEventSkillKey(key, sysAdapter);
    if (PF2E_SAVE_KEYS.has(normalized)) {
        if (sysAdapter?.getSaveBonus) return sysAdapter.getSaveBonus(actor, normalized);
        const stat = actor.saves?.[normalized];
        return stat?.totalModifier ?? stat?.mod ?? 0;
    }
    if (sysAdapter?.getSkillTotal) return sysAdapter.getSkillTotal(actor, normalized);
    return actor.system?.skills?.[normalized]?.totalModifier ?? actor.system?.skills?.[normalized]?.mod ?? 0;
}

/**
 * Resolves a human-readable check/skill label, preferring PF2e save and skill names
 * when running under PF2e.
 *
 * @param {string} skillKey
 * @param {Record<string, string>|null} [fallbackMap]
 * @param {object|null} [adapter]
 * @returns {string}
 */
export function resolveSkillDisplayName(skillKey, fallbackMap = null, adapter = null) {
    if (!skillKey) return "";
    const sysAdapter = adapter ?? globalThis.game?.ionrift?.respite?.adapter ?? null;
    if (isPf2eSystem(sysAdapter)) {
        const normalized = normalizePf2eEventSkillKey(skillKey, sysAdapter);
        if (PF2E_SAVE_LABELS[normalized]) return PF2E_SAVE_LABELS[normalized];
        if (sysAdapter?.getSkillLabel) {
            const label = sysAdapter.getSkillLabel(normalized);
            if (label) return label;
        }
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    return fallbackMap?.[skillKey] ?? skillKey;
}

/**
 * Builds a system-appropriate d20 roll formula.
 * On D&D 5e (and other non-PF2e systems), advantage/disadvantage uses 2d20kh1/2d20kl1.
 * On PF2e, situational advantage/disadvantage applies a +2 / -2 circumstance modifier
 * on a single 1d20 so 5e Fortune dice never leak into PF2e checks or saves.
 *
 * @param {number} baseModifier
 * @param {string} [rollMode="normal"] - "normal"|"norm"|"advantage"|"adv"|"disadvantage"|"dis"
 * @param {object|null} [adapter]
 * @returns {{ formula: string, effectiveModifier: number, circumstanceMod: number, isAdv: boolean, isDis: boolean }}
 */
export function buildSystemRollFormula(baseModifier = 0, rollMode = "normal", adapter = null) {
    const sysAdapter = adapter ?? globalThis.game?.ionrift?.respite?.adapter ?? null;
    const pf2e = isPf2eSystem(sysAdapter);
    const mod = Number(baseModifier) || 0;
    const isAdv = rollMode === "advantage" || rollMode === "adv";
    const isDis = rollMode === "disadvantage" || rollMode === "dis";

    if (pf2e) {
        const circumstanceMod = isAdv ? 2 : (isDis ? -2 : 0);
        const effectiveModifier = mod + circumstanceMod;
        const formula = effectiveModifier >= 0
            ? `1d20 + ${effectiveModifier}`
            : `1d20 - ${Math.abs(effectiveModifier)}`;
        return { formula, effectiveModifier, circumstanceMod, isAdv, isDis };
    }

    const dieExpr = isAdv ? "2d20kh1" : (isDis ? "2d20kl1" : "1d20");
    const formula = mod >= 0
        ? `${dieExpr} + ${mod}`
        : `${dieExpr} - ${Math.abs(mod)}`;
    return { formula, effectiveModifier: mod, circumstanceMod: 0, isAdv, isDis };
}

/**
 * Computes the rounded average character level across an array of actors.
 *
 * @param {Actor[]} actors
 * @param {object|null} [adapter]
 * @returns {number}
 */
export function computeAverageTargetLevel(actors = [], adapter = null) {
    const valid = (actors ?? []).filter(Boolean);
    if (!valid.length) return 1;
    const sysAdapter = adapter ?? globalThis.game?.ionrift?.respite?.adapter ?? null;
    const sum = valid.reduce((acc, actor) => {
        const lvl = sysAdapter?.getLevel
            ? sysAdapter.getLevel(actor)
            : (actor.system?.details?.level?.value ?? actor.system?.details?.level ?? 1);
        return acc + Math.max(1, Number(lvl) || 1);
    }, 0);
    return Math.max(1, Math.round(sum / valid.length));
}

/**
 * Maps an authored 5e event/tree/save DC (10..18+) to PF2e's level-based DC table:
 *   <= 10  Easy       (levelDC - 2)
 *   11..13 Standard   (levelDC)
 *   14..15 Hard       (levelDC + 2)
 *   >= 16  Very Hard  (levelDC + 5)
 *
 * @param {number} authored5eDc
 * @param {number|Actor[]} levelOrActors
 * @param {object|null} [adapter]
 * @returns {number}
 */
export function resolvePf2eEventDC(authored5eDc = 12, levelOrActors = 1, adapter = null) {
    const level = Array.isArray(levelOrActors)
        ? computeAverageTargetLevel(levelOrActors, adapter)
        : Math.max(1, Math.round(Number(levelOrActors) || 1));
    const levelDc = getPf2eLevelBasedDC(level);
    const raw = Number(authored5eDc);
    const base = Number.isFinite(raw) ? raw : 12;
    if (base <= 10) return Math.max(5, levelDc - 2);
    if (base <= 13) return levelDc;
    if (base <= 15) return levelDc + 2;
    return levelDc + 5;
}

/**
 * Evaluates a PF2e group skill check using victory-point degrees of success
 * (critSuccess = +2, success = +1, failure = 0, critFailure = -1) so untrained
 * characters (who add +0 level in PF2e) do not drag down trained specialists via
 * raw arithmetic averaging.
 *
 * @param {Array<{ total: number, natD20?: number|null, d20Value?: number|null }>} rolls
 * @param {number} dc
 * @param {{ hasTriumph?: boolean, hasMixed?: boolean }} [options]
 * @returns {{ resolvedOutcome: "triumph"|"success"|"mixed"|"failure", success: boolean, points: number, threshold: number, groupAverage: number, degrees: string[] }}
 */
export function evaluatePf2eGroupOutcome(rolls = [], dc = 15, { hasTriumph = false, hasMixed = false } = {}) {
    if (!rolls.length) {
        return { resolvedOutcome: "failure", success: false, points: 0, threshold: 1, groupAverage: 0, degrees: [] };
    }
    const degrees = [];
    let points = 0;
    for (const r of rolls) {
        const d20 = Number.isFinite(r.natD20) ? r.natD20 : (Number.isFinite(r.d20Value) ? r.d20Value : null);
        const deg = evaluatePf2eSaveDegree(d20, Number(r.total) || 0, dc);
        degrees.push(deg);
        if (deg === "critSuccess") points += 2;
        else if (deg === "success") points += 1;
        else if (deg === "critFailure") points -= 1;
    }
    const threshold = Math.max(1, Math.ceil(rolls.length / 2));
    const avg = Math.round(rolls.reduce((s, r) => s + (Number(r.total) || 0), 0) / rolls.length);

    let resolvedOutcome;
    if (hasTriumph && points >= rolls.length + 1) {
        resolvedOutcome = "triumph";
    } else if (points >= threshold) {
        resolvedOutcome = "success";
    } else if (hasMixed && points === threshold - 1) {
        resolvedOutcome = "mixed";
    } else {
        resolvedOutcome = "failure";
    }

    return {
        resolvedOutcome,
        success: resolvedOutcome === "triumph" || resolvedOutcome === "success",
        points,
        threshold,
        groupAverage: avg,
        degrees
    };
}

/**
 * Translates an authored 5e condition effect into its PF2e counterpart so night
 * events never stamp inert Midi-QoL flags or non-existent 5e status slugs on PF2e.
 *
 * @param {object} effect
 * @returns {{ type: "pf2e_fatigue_drain", steps: number, label: string } | { type: "pf2e_condition", slug: string, value: number|null, label: string } | null}
 */
export function mapPf2eConditionEffect(effect) {
    if (!effect?.condition) return null;
    const raw = String(effect.condition).trim().toLowerCase();

    const exhMatch = raw.match(/^exhaustion(?:\s*[:_-]?\s*(\d+))?$/);
    if (exhMatch) {
        const steps = Math.max(1, Number(effect.level ?? exhMatch[1] ?? 1) || 1);
        const label = steps > 1 ? `Fatigued + Drained ${steps - 1}` : "Fatigued";
        return { type: "pf2e_fatigue_drain", steps, label };
    }

    if (raw === "poisoned") {
        const val = Math.max(1, Number(effect.value ?? effect.level ?? 1) || 1);
        return { type: "pf2e_condition", slug: "sickened", value: val, label: `Sickened ${val}` };
    }
    if (raw === "diseased") {
        return { type: "pf2e_condition", slug: "sickened", value: 1, label: "Sickened 1 (Disease)" };
    }
    if (raw === "disadvantage_attack") {
        return { type: "pf2e_condition", slug: "enfeebled", value: 1, label: "Enfeebled 1" };
    }
    if (raw === "disadvantage") {
        const checks = (effect.checks ?? []).map(c => String(c).toLowerCase());
        if (checks.some(c => c === "str" || c === "con" || c === "ath")) {
            return { type: "pf2e_condition", slug: "enfeebled", value: 1, label: "Enfeebled 1" };
        }
        if (checks.some(c => c === "dex" || c === "acr" || c === "ste" || c === "sle")) {
            return { type: "pf2e_condition", slug: "clumsy", value: 1, label: "Clumsy 1" };
        }
        return { type: "pf2e_condition", slug: "stupefied", value: 1, label: "Stupefied 1" };
    }
    if (PF2E_NATIVE_CONDITIONS.has(raw)) {
        const valued = ["clumsy", "doomed", "drained", "dying", "enfeebled", "frightened", "sickened", "slowed", "stunned", "stupefied", "wounded"].includes(raw);
        const val = valued ? Math.max(1, Number(effect.value ?? effect.level ?? 1) || 1) : null;
        const cap = raw.charAt(0).toUpperCase() + raw.slice(1);
        return { type: "pf2e_condition", slug: raw, value: val, label: val ? `${cap} ${val}` : cap };
    }
    return null;
}
