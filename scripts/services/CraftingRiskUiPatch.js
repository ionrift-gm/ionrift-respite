/**
 * Patch crafting UI when risk tier changes without a full app re-render.
 */

const COMMIT_PANEL_PARTIAL = "craftCommitPanel";

/**
 * @param {HTMLElement} row
 * @param {Object} dcBreakdown
 * @param {number} dcDisplay
 */
function patchRecipeHeroDcRow(row, dcBreakdown, dcDisplay) {
    if (!row) return;
    let html = `<span class="recipe-hero-dc"><i class="fas fa-dice-d20"></i> DC ${dcDisplay}</span>`;
    if (dcBreakdown?.hasModifiers) {
        html += `<span class="dc-base-hint">${dcBreakdown.base} base</span>`;
        for (const factor of dcBreakdown.factors ?? []) {
            html += `<span class="dc-factor-pill dc-factor-${factor.sign}">${factor.label}</span>`;
        }
    }
    row.innerHTML = html;
}

/**
 * @param {HTMLElement} root - `.totm-crafting-embed` or `.station-crafting-panel`
 * @param {Object} options
 * @param {string} options.risk
 * @param {boolean} options.isAmbitiousSelected
 * @param {Object|null} options.commitSummary
 * @param {Object} [options.dcBreakdown]
 * @param {number} [options.dcDisplay]
 * @returns {Promise<boolean>}
 */
export async function patchCraftingRiskUi(root, {
    risk,
    isAmbitiousSelected,
    commitSummary,
    dcBreakdown,
    dcDisplay
}) {
    if (!root) return false;

    for (const btn of root.querySelectorAll(".btn-risk[data-risk]")) {
        btn.classList.toggle("selected", btn.dataset.risk === risk);
    }

    const amb = root.querySelector(".recipe-hero-ambitious");
    if (amb) {
        amb.classList.toggle("recipe-hero-ambitious--reserved", !isAmbitiousSelected);
    }

    if (dcBreakdown && dcDisplay != null) {
        patchRecipeHeroDcRow(root.querySelector(".recipe-hero-dc-row"), dcBreakdown, dcDisplay);
    }

    const panel = root.querySelector(".craft-commit-panel");
    if (!panel) return false;

    const partial = Handlebars.partials[COMMIT_PANEL_PARTIAL];
    if (!partial) return false;

    const html = partial({ commitSummary });
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    const next = wrapper.firstElementChild;
    if (!next) return false;

    panel.replaceWith(next);
    return true;
}
