/**
 * SustenanceAlertBuilder
 * Evaluates terrain meal rules and actor-specific traits/conditions to build
 * concise, unambiguous status pills and explanatory tooltips.
 */

export class SustenanceAlertBuilder {
    /**
     * Build climate/trait label and rich tooltip for sustenance display.
     * @param {object} params
     * @param {string} [params.terrainLabel] - Human-readable terrain name (e.g. "Forest")
     * @param {object} [params.terrainMealRules] - Raw terrain rules ({ waterPerDay, foodPerDay, note })
     * @param {object} params.effectiveRules - Merged baseline rules
     * @param {object} params.mealNeeds - Resolved actor meal needs
     * @returns {{ label: string|null, tooltip: string|null, isTraitPill: boolean }}
     */
    static build({ terrainLabel = "Standard", terrainMealRules = {}, effectiveRules = {}, mealNeeds = null }) {
        const baseWater = effectiveRules.waterPerDay ?? 2;
        const baseFood = effectiveRules.foodPerDay ?? 1;
        const isNonStandardTerrain = baseWater > 2 || baseFood > 1;

        const fpd = Math.max(0, mealNeeds?.foodPerDay ?? baseFood);
        const wpd = Math.max(0, mealNeeds?.waterPerDay ?? baseWater);

        let label = null;
        let tooltip = null;
        let isTraitPill = false;

        if (baseWater >= 4) {
            const wMult = (baseWater / 2).toFixed(1).replace(/\.0$/, "");
            label = `☀️ Arid (${wMult}× Water)`;
            tooltip = terrainMealRules.note ?? `Arid climate: consumes ${baseWater} water units per day.`;
        } else if (baseFood >= 2) {
            label = `❄️ Frigid (${baseFood}× Food)`;
            tooltip = terrainMealRules.note ?? `Frigid environment: consumes ${baseFood} food rations per day.`;
        } else if (terrainMealRules.note && isNonStandardTerrain) {
            label = `⚠ Harsh Environment`;
            tooltip = terrainMealRules.note;
        } else if (mealNeeds?.isModified) {
            isTraitPill = true;
            const traitParts = [];
            const bulletLines = [];

            if (fpd !== baseFood) {
                const fRatio = baseFood > 0 ? (fpd / baseFood) : fpd;
                if (Number.isInteger(fRatio) && fRatio > 0) {
                    traitParts.push(`${fRatio}× Food`);
                    bulletLines.push(`• Food: ${fpd} ration${fpd === 1 ? "" : "s"}/day (${fRatio}× baseline of ${baseFood})`);
                } else if (fpd === 0) {
                    traitParts.push(`0 Food`);
                    bulletLines.push(`• Food: 0 rations/day (none required)`);
                } else {
                    const diff = fpd - baseFood;
                    const sign = diff > 0 ? "+" : "";
                    traitParts.push(`${sign}${diff} Food`);
                    bulletLines.push(`• Food: ${fpd} ration${fpd === 1 ? "" : "s"}/day (${sign}${diff} from baseline of ${baseFood})`);
                }
            }

            if (wpd !== baseWater) {
                const wRatio = baseWater > 0 ? (wpd / baseWater) : wpd;
                if (Number.isInteger(wRatio) && wRatio > 0) {
                    traitParts.push(`${wRatio}× Water`);
                    bulletLines.push(`• Water: ${wpd} unit${wpd === 1 ? "" : "s"}/day (${wRatio}× baseline of ${baseWater})`);
                } else if (wpd === 0) {
                    traitParts.push(`0 Water`);
                    bulletLines.push(`• Water: 0 units/day (none required)`);
                } else {
                    const diff = wpd - baseWater;
                    const sign = diff > 0 ? "+" : "";
                    traitParts.push(`${sign}${diff} Water`);
                    bulletLines.push(`• Water: ${wpd} unit${wpd === 1 ? "" : "s"}/day (${sign}${diff} from baseline of ${baseWater})`);
                }
            }

            if (traitParts.length > 0) {
                label = `👤 Trait (${traitParts.join(" · ")})`;
                tooltip = [
                    "Character trait modifies daily sustenance.",
                    `${terrainLabel} baseline: ${baseFood} food ration${baseFood === 1 ? "" : "s"} · ${baseWater} water unit${baseWater === 1 ? "" : "s"}/day.`,
                    ...bulletLines
                ].join("\n");
            }
        }

        return { label, tooltip, isTraitPill };
    }
}
