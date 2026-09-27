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
        : (safeRestSpot ? "Settlement haven chosen during setup." : "Environment chosen during setup.");

    const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;

    if (safeRestSpot) {
        return {
            safeRestSpot: true,
            terrainLabel,
            terrainIcon,
            terrainTooltip,
            campComfort: "safe",
            campComfortLabel: "Safe",
            campComfortTooltip: "<div class='ledger-tip'><div class='tooltip-title'>Safe rest spot</div><ul><li>Full HP and Hit Dice</li><li>No night encounters</li><li>No exhaustion risk</li></ul></div>",
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
        weatherShieldNote = "Shelter spell cancels weather penalties";
    } else if (hasTent && wx.tentCancels && (wx.comfortPenalty > 0 || wx.encounterDC !== 0)) {
        weatherShieldNote = "Tent cancels these weather effects";
    } else if (hasTent && wx.tentReduces && wx.comfortPenalty > 0) {
        weatherShieldNote = "Tent reduces weather comfort penalty by 1";
        if (wx.comfortPenalty > 1 && isComfortEnabled()) {
            campComfort = boostComfort(campComfort, -(wx.comfortPenalty - 1));
        }
    } else if (wx.comfortPenalty > 0 && isComfortEnabled()) {
        campComfort = boostComfort(campComfort, -wx.comfortPenalty);
    }

    const campComfortLabel = CampGearScanner.getRules(campComfort).label;

    const impactParts = [];
    if (wx.comfortPenalty > 0) impactParts.push(`Comfort -${wx.comfortPenalty}`);
    if (wx.encounterDC > 0) impactParts.push(`Night +${wx.encounterDC}`);
    if (wx.encounterDC < 0) impactParts.push(`Night ${wx.encounterDC}`);

    const baseComfortLabel = CampGearScanner.getRules(terrain?.comfort ?? "rough").label;
    const factorParts = [`Base: ${terrainLabel} (${baseComfortLabel})`];
    if (fireDelta === -1) factorParts.push(effectiveFire === "cold_camp" ? "Cold camp (-1)" : "No fire (-1)");
    else if (fireDelta === 1) factorParts.push("Bonfire (+1)");

    if (hasHut) {
        factorParts.push("Shelter spell (Sheltered)");
    } else if (wx.comfortPenalty > 0) {
        if (hasTent && wx.tentCancels) factorParts.push(`${wx.label} (-${wx.comfortPenalty}, cancelled by tent)`);
        else if (hasTent && wx.tentReduces) factorParts.push(`${wx.label} (-${wx.comfortPenalty}, reduced by tent)`);
        else factorParts.push(`${wx.label} (-${wx.comfortPenalty})`);
    }
    const comfortContext = factorParts.join(" · ");

    // Vertical structure: Title, italic environment, bulleted recovery & factors (no em dash)
    const headerLine = `<strong>Camp Comfort: ${campComfortLabel}</strong>`;
    const envLine = terrain?.comfortReason ? `<em>${terrain.comfortReason}</em>` : null;
    const recoveryLine = `• <strong>Recovery:</strong> ${CampGearScanner.getSummary(campComfort)}`;
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
                lines.push(`• <strong>${shelteredList.length} Sheltered:</strong> ${shelteredList.map(c => c.actorName).join(", ")}`);
            }
            if (roughList.length) {
                lines.push(`• <strong>${roughList.length} Exposed:</strong> ${roughList.map(c => c.actorName).join(", ")}`);
            }
            const gearParts = [];
            gearParts.push(hasTent ? `${tentCount} Tent pitched` : "No Tent (exposed)");
            if (messKitCount > 0) gearParts.push(`${messKitCount} Mess Kit (save advantage)`);
            for (const part of gearParts) lines.push(`• ${part}`);

            campComfortTooltip = lines.join("<br>");
        } else {
            const owned = party.find(a => a.isOwner && !a.isGM) ?? party[0];
            const targetActorId = viewerActorId ?? owned?.id;
            const viewerCard = campScanData.personalCards.find(c => c.actorId === targetActorId) ?? campScanData.personalCards[0];
            if (viewerCard) {
                const bedrollNote = viewerCard.hasBedroll ? " (+1 from Bedroll)" : " (No bedroll)";
                const lines = [
                    headerLine
                ];
                if (envLine) lines.push(envLine);
                lines.push(recoveryLine);
                lines.push(factorsLine);
                lines.push(`<strong>Your Rest: ${viewerCard.personalComfortLabel}</strong>${bedrollNote}`);

                const pComfort = viewerCard.personalComfort;
                if (pComfort === "hostile") {
                    lines.push(`• <strong>HP:</strong> 75% max HP cap`);
                    if (viewerCard.recovery?.isAlreadyFull) {
                        lines.push(`• <strong>Hit Dice:</strong> Already at max (${viewerCard.recovery.totalHd}/${viewerCard.recovery.totalHd})`);
                    } else {
                        lines.push(`• <strong>Hit Dice:</strong> -2 HD recovery penalty`);
                    }
                    lines.push(`• <strong>Exhaustion:</strong> CON DC 15 save`);
                } else if (pComfort === "rough") {
                    lines.push(`• <strong>HP:</strong> Full recovery`);
                    if (viewerCard.recovery?.isAlreadyFull) {
                        lines.push(`• <strong>Hit Dice:</strong> Already at max (${viewerCard.recovery.totalHd}/${viewerCard.recovery.totalHd})`);
                    } else {
                        lines.push(`• <strong>Hit Dice:</strong> -1 HD recovery penalty`);
                    }
                    lines.push(`• <strong>Exhaustion:</strong> CON DC 10 save`);
                } else {
                    lines.push(`• <strong>HP:</strong> Full recovery`);
                    if (viewerCard.recovery?.isAlreadyFull) {
                        lines.push(`• <strong>Hit Dice:</strong> Already at max (${viewerCard.recovery.totalHd}/${viewerCard.recovery.totalHd})`);
                    } else {
                        lines.push(`• <strong>Hit Dice:</strong> Normal recovery`);
                    }
                    lines.push(`• <strong>Exhaustion:</strong> No exhaustion risk`);
                }

                if (viewerCard.hasMessKit && (pComfort === "rough" || pComfort === "hostile")) {
                    lines.push(`• <strong>Mess Kit:</strong> Advantage on exhaustion save`);
                }

                if (!viewerCard.hasBedroll && (pComfort === "rough" || pComfort === "hostile")) {
                    lines.push(`<em>A bedroll would raise your rest to Sheltered.</em>`);
                }

                campComfortTooltip = lines.join("<br>");
            }
        }
    }

    const tentStatus = {
        hasTent,
        label: hasTent ? "Tent" : "No Tent",
        icon: "fas fa-campground",
        chipClass: hasTent ? "shelter-present" : "shelter-absent",
        tooltip: hasTent
            ? (!enforceTent && !partyHasScannedTent && !activeShelters.includes("tent")
                ? "Tent factor waived by GM. Camp weather protection active."
                : (weatherShieldNote ? `Tent: ${weatherShieldNote}. Camp weather protection active.` : "Tent pitched: Shields camp from weather penalties and reduces nocturnal encounter danger."))
            : "No tent pitched. Camp is exposed to weather penalties and easier for nocturnal threats to locate."
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
