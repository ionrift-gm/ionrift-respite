/**
 * Rest Dock Context builder.
 *
 * Produces the `restDock` context consumed by `templates/partials/rest-dock.hbs`.
 * One caller (DowntimeLedgerApp): the gritty long rest's identity card and
 * switcher. See REST_UI_REUNIFICATION_PLAN.md, Phase 1b.
 *
 * Not tied to any Foundry app class. Callers pass in:
 *   - `party`:     array of Foundry Actor documents
 *   - `selectedId`: the currently focused character (string id)
 *   - `personalScan`: the per-character comfort / kit summary (the object
 *                    RestPrepareContext exposes as `campPersonalSelected`).
 *                    Shape is duck-typed here so DowntimeLedgerApp can pass
 *                    its own equivalent without a compat shim.
 *   - `finishedActorIds`: Set<string> of actor ids marked Ready. Optional.
 *   - `characterState`: Map<string, {hasStarvationRisk?, hasDehydrationRisk?,
 *                       statusLabel?}>. Optional per-actor status for the
 *                       switcher's warning glyphs and tooltips.
     *   - `isGM`: caller's GM flag. Optional; defaults to game.user.isGM.
     *   - `comfortFlashing`: true when this actor's personal comfort just changed.
     */

const KIT_ITEMS = [
    { key: "bedroll",  icon: "fas fa-bed",        label: "Bedroll",  labelMissing: "No Bedroll",  shortLabel: "Bedroll" },
    { key: "tent",     icon: "fas fa-campground", label: "Tent",     labelMissing: "No Tent",     shortLabel: "Tent" },
    { key: "messKit",  icon: "fas fa-utensils",   label: "Mess Kit", labelMissing: "No Mess Kit", shortLabel: "Mess" }
];

const COMFORT_FALLBACK_BENEFIT = {
    safe:      "Full HP · Max HD",
    sheltered: "Full HP · Max HD",
    rough:     "Full HP · −1 HD Pen · DC 10 Save",
    exposed:   "75% HP · −2 HD Pen · DC 15 Save"
};

export class RestDockContext {

    /**
     * Build the `restDock` context.
     *
     * @param {object}          options
     * @param {Actor[]}         options.party
     * @param {string|null}     options.selectedId
     * @param {object|null}     [options.personalScan]
     * @param {Set<string>}     [options.finishedActorIds]
     * @param {boolean}         [options.isGM]
     * @param {boolean}         [options.comfortFlashing]
     * @returns {{ selected: object|null, companions: object[] }}
     */
    static buildDockContext({
        party = [],
        selectedId = null,
        personalScan = null,
        finishedActorIds = new Set(),
        characterState = new Map(),
        isGM = (typeof game !== "undefined" ? Boolean(game.user?.isGM) : false),
        comfortFlashing = false
    } = {}) {
        if (!party.length) return { selected: null, companions: [] };

        const selectedActor = selectedId
            ? party.find(a => a.id === selectedId) ?? party[0]
            : party[0];

        const selected = this.#buildSelected(selectedActor, personalScan, isGM, comfortFlashing);
        const companions = party
            .filter(a => a && a.id !== selectedActor.id)
            .map(a => this.#buildCompanion(a, selectedId, finishedActorIds, characterState, isGM));

        return { selected, companions };
    }

    /**
     * True only when the same actor's personal comfort changed since the last call.
     * The first sighting of an actor does not flash, and switching actors does not flash.
     * @param {Map<string, string|null>} memory
     * @param {string|null|undefined} actorId
     * @param {string|null|undefined} comfort
     * @returns {boolean}
     */
    static noteComfortFlash(memory, actorId, comfort) {
        if (!(memory instanceof Map) || !actorId) return false;
        const next = comfort ?? null;
        const had = memory.has(actorId);
        const prev = memory.get(actorId);
        memory.set(actorId, next);
        return had && prev !== next;
    }

    static #buildSelected(actor, personalScan, isGM, comfortFlashing = false) {
        if (!actor) return null;

        const kit = KIT_ITEMS.map(item => {
            const present = Boolean(personalScan?.[`has${cap(item.key)}`]);
            const waived  = Boolean(personalScan?.[`${item.key}Waived`]);
            const tooltip = personalScan?.[`${item.key}Tooltip`] ?? "";
            return {
                key: item.key,
                icon: item.icon,
                label: present ? item.label : item.labelMissing,
                shortLabel: item.shortLabel,
                present,
                waived,
                tooltip
            };
        });

        const comfortTier   = personalScan?.personalComfort ?? null;
        const comfortLabel  = personalScan?.personalComfortLabel
            ?? (comfortTier ? `${cap(comfortTier)} Rest` : "");
        const recoveryBenefit = personalScan?.recovery?.benefitSummary
            ?? COMFORT_FALLBACK_BENEFIT[comfortTier]
            ?? "";
        const recoveryTooltip = personalScan?.recoveryTooltip ?? "";

        // Decouple positive recovery perks from the exhaustion hazard
        const hpFraction = personalScan?.recovery?.hpFraction ?? 1.0;
        const hpText = hpFraction < 1.0 ? `${Math.round(hpFraction * 100)}% HP` : "Full HP";
        const isAlreadyFull = personalScan?.recovery?.isAlreadyFull ?? false;
        const hdRecovered = personalScan?.recovery?.hdRecovered;
        let hdText = "Max HD";
        if (!isAlreadyFull) {
            if (comfortTier === "rough") hdText = "−1 HD Pen";
            else if (comfortTier === "hostile" || comfortTier === "exposed") hdText = "−2 HD Pen";
            else if (hdRecovered !== undefined) hdText = `+${hdRecovered} HD`;
            else hdText = "Normal HD";
        }
        const recoveryBenefitText = `${hpText} · ${hdText}`;

        // Explicit mechanical hazard if exhaustion save is required
        const exhaustionDC = personalScan?.recovery?.exhaustionDC ?? (
            comfortTier === "rough" ? 10 : (comfortTier === "hostile" || comfortTier === "exposed" ? 15 : null)
        );

        let recoveryHazard = null;
        if (exhaustionDC) {
            const hasAdvantage = Boolean(
                personalScan?.recovery?.exhaustionAdvantage
                ?? personalScan?.hasMessKit
            );
            const severity = (comfortTier === "hostile" || comfortTier === "exposed" || exhaustionDC >= 15) ? "danger" : "warning";
            const icon = severity === "danger" ? "fa-skull" : "fa-dice-d20";
            const label = `CON DC ${exhaustionDC} ➔ Exhaustion`;

            const tipLines = [
                `Constitution saving throw DC ${exhaustionDC}`,
                "Failure inflicts 1 level of Exhaustion",
                hasAdvantage ? "Advantage on save (Mess Kit)" : "Straight roll (no Mess Kit)",
                "Click to roll Constitution save"
            ];
            const hazardTooltip = `<strong>Exhaustion Hazard (DC ${exhaustionDC})</strong><ul style='margin:4px 0 0 16px;padding:0;'>${tipLines.map(l => `<li>${l}</li>`).join("")}</ul>`;

            recoveryHazard = {
                dc: exhaustionDC,
                label,
                severity,
                icon,
                hasAdvantage,
                tooltip: hazardTooltip
            };
        }

        // Dedicated Personal Comfort tooltip informing user of their personal comfort level and factors
        const comfortTipLines = [
            `Personal comfort level: ${comfortLabel}`
        ];
        const hasBedroll = Boolean(personalScan?.hasBedroll);
        const bedrollWaived = Boolean(personalScan?.bedrollWaived);
        if (hasBedroll) {
            comfortTipLines.push(bedrollWaived ? "Bedroll: +1 comfort tier (waived by GM)" : "Bedroll: +1 comfort tier");
        } else {
            comfortTipLines.push("No Bedroll (resting at camp comfort)");
        }
        const hasTent = Boolean(personalScan?.hasTent);
        if (hasTent) {
            comfortTipLines.push("Tent: weather & encounter shelter");
        }
        if (comfortTier === "sheltered" || comfortTier === "safe") {
            comfortTipLines.push("Sheltered sleep protects Hit Dice and prevents exhaustion");
        }
        const comfortTooltip = personalScan?.comfortTooltip ?? bulletTip(`${actor.name}: ${comfortLabel}`, comfortTipLines);

        const isSelfCard = !isGM && Boolean(actor.isOwner);

        return {
            id: actor.id,
            name: actor.name,
            img: actor.img || "icons/svg/mystery-man.svg",
            kit,
            comfortTier,
            comfortLabel,
            comfortTooltip,
            comfortFlashing: Boolean(comfortFlashing),
            recoveryBenefit,
            recoveryBenefitText,
            recoveryHazard,
            recoveryTooltip,
            isSelfCard
        };
    }

    static #buildCompanion(actor, selectedId, finishedActorIds, characterState, isGM) {
        const state = characterState?.get?.(actor.id) ?? {};
        const warnings = [];
        if (state.hasExhaustionRisk) warnings.push(`DC ${state.exhaustionDC || 10} Exhaustion save`);
        if (state.hasStarvationRisk) warnings.push("Starvation risk");
        if (state.hasDehydrationRisk) warnings.push("Dehydration risk");
        const tooltipLines = [actor.name];
        if (state.statusLabel) tooltipLines.push(state.statusLabel);
        if (warnings.length) tooltipLines.push(...warnings);
        return {
            id: actor.id,
            name: (actor.name ?? "").split(" ")[0] || actor.name,
            img: actor.img || "icons/svg/mystery-man.svg",
            isSelected: selectedId ? actor.id === selectedId : false,
            isReady: finishedActorIds?.has?.(actor.id) ?? false,
            hasExhaustionRisk: Boolean(state.hasExhaustionRisk),
            exhaustionDC: state.exhaustionDC ?? null,
            hasStarvationRisk: Boolean(state.hasStarvationRisk),
            hasDehydrationRisk: Boolean(state.hasDehydrationRisk),
            statusLabel: state.statusLabel ?? "",
            tooltip: tooltipLines.join(" · "),
            canSelect: Boolean(isGM) || Boolean(actor.isOwner)
        };
    }
}

function cap(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function bulletTip(title, lines) {
    const filtered = lines.filter(Boolean);
    if (!filtered.length) return title;
    return `<strong>${title}</strong><ul style='margin:4px 0 0 16px;padding:0;'>${filtered.map(l => `<li>${l}</li>`).join("")}</ul>`;
}
