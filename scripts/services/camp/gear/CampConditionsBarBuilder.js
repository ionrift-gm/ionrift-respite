import { TerrainRegistry } from "../../events/resolve/TerrainRegistry.js";
import { WEATHER_TABLE, getComfortTip } from "../../../data/RestConstants.js";
import { CampGearScanner } from "./CampGearScanner.js";
import { isComfortEnabled, boostComfort, fireComfortDelta } from "./ComfortCalculator.js";
import { getPartyActors } from "../../party/partyActors.js";

/**
 * Builds the unified camp conditions bar model used by both standard rest
 * (RestSetupApp) and gritty downtime (DowntimeLedgerApp).
 *
 * Single source of truth: eliminates split-brain drift between camp-wide
 * ribbon chips and character personal comfort cards.
 *
 * @param {object} params
 * @param {string} [params.terrainTag="forest"]
 * @param {string} [params.weatherKey="clear"]
 * @param {string} [params.fireLevel="campfire"]
 * @param {string[]} [params.activeShelters=[]]
 * @param {object|null} [params.campScanData=null]
 * @param {boolean} [params.safeRestSpot=false]
 * @param {boolean} [params.encountersEnabled=true]
 * @param {boolean} [params.isGM=false]
 * @param {string|null} [params.viewerActorId=null]
 * @returns {object|null}
 */
export function buildCampConditionsBar({
    terrainTag = "forest",
    weatherKey = "clear",
    fireLevel = "campfire",
    activeShelters = [],
    campScanData = null,
    safeRestSpot = false,
    encountersEnabled = true,
    isGM = false,
    viewerActorId = null,
    enforceTent = true
} = {}) {
    const terrain = TerrainRegistry.get(terrainTag);
    const terrainLabel = terrain?.label ?? (terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1));
    const terrainIcon = terrain?.icon ?? "fas fa-mountain";
    const terrainTooltip = terrain?.comfortReason
        ? `${terrainLabel}: ${terrain.comfortReason}`
        : (safeRestSpot ? game.i18n.localize("ionrift-respite.campConditions.havenChosen") : game.i18n.localize("ionrift-respite.campConditions.environmentChosen"));

    const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;

    if (safeRestSpot) {
        return {
            safeRestSpot: true,
            terrainLabel,
            terrainIcon,
            terrainTooltip,
            campComfort: "safe",
            campComfortLabel: game.i18n.localize("ionrift-respite.campConditions.safeLabel"),
            campComfortTooltip: game.i18n.localize("ionrift-respite.campConditions.safeTooltip"),
            weatherLabel: wx.label,
            weatherKey,
            weatherIcon: "fas fa-sun",
            weatherTooltip: wx.hint,
            weatherImpact: null,
            weatherIsNeutral: true,
            weatherShieldNote: null,
            tentStatus: null,
            showEncounterHint: false
        };
    }

    if (!isComfortEnabled()) return null;

    let campComfort = campScanData?.campComfortPreFire ?? campScanData?.campComfort ?? terrain?.comfort ?? "rough";
    const party = getPartyActors();
    const partyHasScannedTent = campScanData?.personalCards?.some(c => c.hasTent)
        ?? party.some(a => CampGearScanner.scanActor(a).hasTent);
    const hasTent = !enforceTent || activeShelters.includes("tent") || partyHasScannedTent;
    const hasHut = activeShelters.some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

    if (hasHut) {
        if (campComfort === "hostile" || campComfort === "rough") {
            campComfort = "sheltered";
        }
    }

    const effectiveFire = fireLevel ?? campScanData?.fireLevel ?? "campfire";
    const fireDelta = fireComfortDelta(effectiveFire);
    if (fireDelta !== 0 && isComfortEnabled()) {
        campComfort = boostComfort(campComfort, fireDelta);
    }

    let weatherShieldNote = null;
    if (hasHut) {
        weatherShieldNote = game.i18n.localize("ionrift-respite.campConditions.weatherShield.shelterSpell");
    } else if (hasTent && wx.tentCancels && (wx.comfortPenalty > 0 || wx.encounterDC !== 0)) {
        weatherShieldNote = game.i18n.localize("ionrift-respite.campConditions.weatherShield.tentCancels");
    } else if (hasTent && wx.tentReduces && wx.comfortPenalty > 0) {
        weatherShieldNote = game.i18n.localize("ionrift-respite.campConditions.weatherShield.tentReduces");
        if (wx.comfortPenalty > 1 && isComfortEnabled()) {
            campComfort = boostComfort(campComfort, -(wx.comfortPenalty - 1));
        }
    } else if (wx.comfortPenalty > 0 && isComfortEnabled()) {
        campComfort = boostComfort(campComfort, -wx.comfortPenalty);
    }

    const campComfortLabel = CampGearScanner.getRules(campComfort).label;

    const impactParts = [];
    if (wx.comfortPenalty > 0) impactParts.push(game.i18n.format("ionrift-respite.campConditions.impact.comfort", { penalty: wx.comfortPenalty }));
    if (wx.encounterDC > 0) impactParts.push(game.i18n.format("ionrift-respite.campConditions.impact.nightPlus", { dc: wx.encounterDC }));
    if (wx.encounterDC < 0) impactParts.push(game.i18n.format("ionrift-respite.campConditions.impact.night", { dc: wx.encounterDC }));

    const baseComfortLabel = CampGearScanner.getRules(terrain?.comfort ?? "rough").label;
    const factorParts = [game.i18n.format("ionrift-respite.campConditions.factor.base", { terrain: terrainLabel, comfort: baseComfortLabel })];
    if (fireDelta === -1) factorParts.push(effectiveFire === "cold_camp" ? game.i18n.localize("ionrift-respite.campConditions.factor.coldCamp") : game.i18n.localize("ionrift-respite.campConditions.factor.noFire"));
    else if (fireDelta === 1) factorParts.push(game.i18n.localize("ionrift-respite.campConditions.factor.bonfire"));

    if (hasHut) {
        factorParts.push(game.i18n.localize("ionrift-respite.campConditions.factor.shelterSpell"));
    } else if (wx.comfortPenalty > 0) {
        if (hasTent && wx.tentCancels) factorParts.push(game.i18n.format("ionrift-respite.campConditions.factor.weatherCancelled", { weather: wx.label, penalty: wx.comfortPenalty }));
        else if (hasTent && wx.tentReduces) factorParts.push(game.i18n.format("ionrift-respite.campConditions.factor.weatherReduced", { weather: wx.label, penalty: wx.comfortPenalty }));
        else factorParts.push(game.i18n.format("ionrift-respite.campConditions.factor.weather", { weather: wx.label, penalty: wx.comfortPenalty }));
    }
    const comfortContext = factorParts.join(" · ");

    // Vertical structure: Title, italic environment, bulleted recovery & factors (no em dash)
    const headerLine = game.i18n.format("ionrift-respite.campConditions.tooltip.header", { comfort: campComfortLabel });
    const envLine = terrain?.comfortReason ? `<em>${terrain.comfortReason}</em>` : null;
    const recoveryLine = game.i18n.format("ionrift-respite.campConditions.tooltip.recovery", { summary: CampGearScanner.getSummary(campComfort) });
    const factorsLine = factorParts.map(part => `• ${part}`).join("<br>");

    let campComfortTooltip = [headerLine, envLine, recoveryLine, factorsLine].filter(Boolean).join("<br>");
    if (campScanData?.personalCards?.length) {
        if (isGM) {
            const shelteredList = campScanData.personalCards.filter(c => c.personalComfort === "sheltered" || c.personalComfort === "safe");
            const roughList = campScanData.personalCards.filter(c => c.personalComfort === "rough" || c.personalComfort === "hostile");
            const messKitCount = campScanData.personalCards.filter(c => c.hasMessKit).length;
            const tentCount = campScanData.personalCards.filter(c => c.hasTent).length;

            const lines = [headerLine];
            if (envLine) lines.push(envLine);
            lines.push(recoveryLine);
            lines.push(factorsLine);
            if (shelteredList.length) {
                lines.push(game.i18n.format("ionrift-respite.campConditions.tooltip.sheltered", { count: shelteredList.length, names: shelteredList.map(c => c.actorName).join(", ") }));
            }
            if (roughList.length) {
                lines.push(game.i18n.format("ionrift-respite.campConditions.tooltip.exposed", { count: roughList.length, names: roughList.map(c => c.actorName).join(", ") }));
            }
            const gearParts = [];
            gearParts.push(hasTent ? game.i18n.format("ionrift-respite.campConditions.tooltip.tentsPitched", { count: tentCount }) : game.i18n.localize("ionrift-respite.campConditions.tooltip.noTentExposed"));
            if (messKitCount > 0) gearParts.push(game.i18n.format("ionrift-respite.campConditions.tooltip.messKits", { count: messKitCount }));
            for (const part of gearParts) lines.push(`• ${part}`);

            campComfortTooltip = lines.join("<br>");
        } else {
            const owned = party.find(a => a.isOwner && !a.isGM) ?? party[0];
            const targetActorId = viewerActorId ?? owned?.id;
            const viewerCard = campScanData.personalCards.find(c => c.actorId === targetActorId) ?? campScanData.personalCards[0];
            if (viewerCard) {
                const lines = [
                    headerLine
                ];
                if (envLine) lines.push(envLine);
                lines.push(recoveryLine);
                lines.push(factorsLine);
                lines.push(viewerCard.hasBedroll
                    ? game.i18n.format("ionrift-respite.campConditions.tooltip.yourRestBedroll", { comfort: viewerCard.personalComfortLabel })
                    : game.i18n.format("ionrift-respite.campConditions.tooltip.yourRestNoBedroll", { comfort: viewerCard.personalComfortLabel }));

                const pComfort = viewerCard.personalComfort;
                if (pComfort === "hostile") {
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.hpCap75"));
                    if (viewerCard.recovery?.isAlreadyFull) {
                        lines.push(game.i18n.format("ionrift-respite.campConditions.tooltip.hdAtMax", { total: viewerCard.recovery.totalHd }));
                    } else {
                        lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.hdPenalty2"));
                    }
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.exhaustionDc15"));
                } else if (pComfort === "rough") {
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.hpFull"));
                    if (viewerCard.recovery?.isAlreadyFull) {
                        lines.push(game.i18n.format("ionrift-respite.campConditions.tooltip.hdAtMax", { total: viewerCard.recovery.totalHd }));
                    } else {
                        lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.hdPenalty1"));
                    }
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.exhaustionDc10"));
                } else {
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.hpFull"));
                    if (viewerCard.recovery?.isAlreadyFull) {
                        lines.push(game.i18n.format("ionrift-respite.campConditions.tooltip.hdAtMax", { total: viewerCard.recovery.totalHd }));
                    } else {
                        lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.hdNormal"));
                    }
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.noExhaustion"));
                }

                if (viewerCard.hasMessKit && (pComfort === "rough" || pComfort === "hostile")) {
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.messKitAdvantage"));
                }

                if (!viewerCard.hasBedroll && (pComfort === "rough" || pComfort === "hostile")) {
                    lines.push(game.i18n.localize("ionrift-respite.campConditions.tooltip.bedrollWouldRaise"));
                }

                campComfortTooltip = lines.join("<br>");
            }
        }
    }

    const tentStatus = {
        hasTent,
        label: hasTent ? game.i18n.localize("ionrift-respite.campConditions.tent.label") : game.i18n.localize("ionrift-respite.campConditions.tent.none"),
        icon: "fas fa-campground",
        chipClass: hasTent ? "shelter-present" : "shelter-absent",
        tooltip: hasTent
            ? (!enforceTent && !partyHasScannedTent && !activeShelters.includes("tent")
                ? game.i18n.localize("ionrift-respite.campConditions.tent.waived")
                : (weatherShieldNote ? game.i18n.format("ionrift-respite.campConditions.tent.withNote", { note: weatherShieldNote }) : game.i18n.localize("ionrift-respite.campConditions.tent.pitched")))
            : game.i18n.localize("ionrift-respite.campConditions.tent.absent")
    };

    return {
        safeRestSpot: false,
        terrainLabel,
        terrainIcon,
        terrainTooltip,
        campComfort,
        campComfortLabel,
        campComfortTooltip,
        comfortContext,
        weatherLabel: wx.label,
        weatherKey,
        weatherIcon: wx.icon ?? "fas fa-sun",
        weatherTooltip: wx.hint,
        weatherImpact: impactParts.length ? impactParts.join(" · ") : null,
        weatherIsNeutral: impactParts.length === 0,
        weatherShieldNote,
        tentStatus,
        showEncounterHint: encountersEnabled
    };
}
