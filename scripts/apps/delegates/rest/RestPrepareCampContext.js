import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { CampGearScanner, isFireCantripItem } from "../../../services/camp/gear/CampGearScanner.js";
import { hasCampfirePlaced } from "../../../services/camp/props/CompoundCampPlacer.js";
import { WEATHER_TABLE, SHELTER_SPELLS, getComfortTip } from "../../../data/RestConstants.js";
import { isComfortEnabled, COMFORT_TIERS, boostComfort, pendingFireComfortDelta } from "../../../services/camp/gear/ComfortCalculator.js";
import { requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import { getPartyActors } from "../../../services/party/partyActors.js";

export function buildMakeCampContext(app, safeRestSpot) {
        let campScanData = null;
        let campMakeCampStep = 1;
        let campFireEncounterHint = "";
        let campFirePickerLevels = [];
        let campFireGatePit = false;
        let campFireGateLevel = false;
        let campColdCampDecided = false;
        let campComfortIsHostile = false;
        const _needsFireData = app._phase === "camp" || app._phase === "activity" || app._phase === "meal";
        if (_needsFireData) {
            const terrainTagCamp = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            // Gate: fire is lit, OR table decided cold camp (no fire)
            const fireCommitted = (app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided;
            campColdCampDecided = !!app._coldCampDecided;
            campMakeCampStep = 1;
            campFireGatePit = app._isTotM || !!app._engine?.safeRestSpot || campfirePlacedGate;
            campFireGateLevel = fireCommitted;
            // When fire hasn't been committed, preview defaults to "embers" (the
            // default highlighted tab), NOT "unlit" which applies a no-fire penalty.
            const effectiveScanLevel = (fireCommitted && (campfirePlacedGate || app._isTotM))
                ? (app._coldCampDecided ? "cold_camp" : (app._fireLevel ?? "unlit"))
                : (app._campFirePreviewLevel ?? (app._fireLevel !== "unlit" ? app._fireLevel : "embers"));
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            // RestFlowEngine: effectiveDC = baseDC - campMods. Negative fireRollModifier
            // subtracts a negative, RAISING effectiveDC (harder to avoid encounters).
            // "Fire is a beacon"; see CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL.
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "No fire is lit yet. The tier row shows what each level would do.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter chance.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
            } else {
                campFireEncounterHint = "";
            }
            const baseTerrainComfort = app._engine?.comfort
                ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
                ?? "rough";
            campScanData = CampGearScanner.scan(
                baseTerrainComfort,
                effectiveScanLevel,
                shelterSpellCamp,
                terrainCamp?.comfortReason ?? "",
                terrainCamp?.label ?? terrainTagCamp,
                encMod,
                !!app._engine?.safeRestSpot
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = app._fireLevel ?? "unlit";
            const preview = app._campFirePreviewLevel ?? "embers";
            const coldSelected = !!app._coldCampDecided || (preview === "cold_camp");
            const hasTinder = campScanData?.canLightFire ?? false;
            const tierDisabledReason = (canPick, cost) => {
                if (canPick) return "";
                if (!hasTinder) return game.i18n.localize("ionrift-respite.restPrepare.fire.needTinder");
                return game.i18n.format("ionrift-respite.restPrepare.fire.needFirewood", { cost });
            };
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: game.i18n.localize("ionrift-respite.restPrepare.fire.embers"),
                    costLabel: CampGearScanner.firewoodCostLabel("embers"),
                    disabled: !fs.canPickEmbers,
                    disabledReason: tierDisabledReason(fs.canPickEmbers, fs.costEmbers ?? 1),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "embers" : preview === "embers")
                },
                {
                    id: "campfire",
                    label: game.i18n.localize("ionrift-respite.restPrepare.fire.campfire"),
                    costLabel: CampGearScanner.firewoodCostLabel("campfire"),
                    disabled: !fs.canPickCampfire,
                    disabledReason: tierDisabledReason(fs.canPickCampfire, fs.costCampfire ?? 2),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "campfire" : preview === "campfire")
                },
                {
                    id: "bonfire",
                    label: game.i18n.localize("ionrift-respite.restPrepare.fire.bonfire"),
                    costLabel: CampGearScanner.firewoodCostLabel("bonfire"),
                    disabled: !fs.canPickBonfire,
                    disabledReason: tierDisabledReason(fs.canPickBonfire, fs.costBonfire ?? 3),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "bonfire" : preview === "bonfire")
                }
            ];
        }

        let campFireIsLit = false;

        const _fireBillLevel = (app._fireLevel ?? "unlit") !== "unlit"
            ? app._fireLevel
            : (app._campFirePreviewLevel ?? "embers");
        const _COST_MAP = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const campSelectedFirewoodCost = _COST_MAP[_fireBillLevel] ?? 0;
        const campPartyFirewood = campScanData?.totalFirewood ?? 0;
        const campHasEnoughFirewood = campPartyFirewood >= campSelectedFirewoodCost;
        const campCanLight = campScanData?.canLightFire ?? false;
        let campFireLitBy = null;
        let campFireLighters = [];
        let campFirewoodPledgeList = [];
        let campMyPledge = null;
        let campCanAddFirewood = false;
        let campMyFirewoodActorId = null;
        let campFireTierCards = [];
        let campFireTotalPledged = 0;
        let campViewerCanLight = false;
        let campFireOtherLighterCount = 0;
        let campFireLighterNames = "";
        if (_needsFireData && campScanData) {
            campFireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
            campFireLitBy = app._fireLitBy ?? null;
            campFireTotalPledged = Array.from(app._firewoodPledges.values()).reduce((s, p) => s + p.count, 0);

            // Enrich fireLighters with cantrip-capable actors (from adapter)
            const rawLighters = campScanData.fireLighters ?? [];
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips?.() ?? [];
            const cantripLighters = [];
            for (const actor of getPartyActors()) {
                if (rawLighters.some(l => l.actorId === actor.id)) continue; // already in tinderbox list
                const cantrip = fireCantrips.length > 0
                    ? actor.items.find(i => isFireCantripItem(i, fireCantrips))
                    : null;
                if (cantrip) cantripLighters.push({ actorId: actor.id, actorName: actor.name, method: cantrip.name });
            }
            const rawLightersTagged = rawLighters.map(l => ({ ...l, methodType: "item", methodIcon: "fas fa-box" }));
            const cantripLightersTagged = cantripLighters.map(l => ({ ...l, methodType: "spell", methodIcon: "fas fa-magic" }));
            const allLighters = [...rawLightersTagged, ...cantripLightersTagged];

            // Resolve which lighters the current user can act on (owns the actor)
            campFireLighters = allLighters.map(l => ({
                ...l,
                isViewerActor: (game.actors.get(l.actorId)?.ownership?.[game.user.id] ?? 0) >= OWNER
            }));
            campViewerCanLight = campFireLighters.some(l => l.isViewerActor);
            if (app._campPitBlocksFireLighting()) campViewerCanLight = false;
            campFireLighterNames = campFireLighters.map(l => l.actorName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            campFireOtherLighterCount = campFireLighters.filter(l => !l.isViewerActor).length;

            // Firewood pledge list for summary display
            campFirewoodPledgeList = Array.from(app._firewoodPledges.values())
                .filter(p => p.count > 0)
                .map(p => ({ actorName: p.actorName, count: p.count }));

            // Current viewer's pledge
            campMyPledge = app._firewoodPledges.get(game.user.id) ?? null;

            // Can this user add firewood? Fire lit + under bonfire.
            // GM has infinite firewood; players need a party actor with enough wood.
            if (campFireIsLit && campFireTotalPledged < 2) {
                if (game.user.isGM) {
                    campCanAddFirewood = true;
                    campMyFirewoodActorId = "__gm__";
                } else {
                    const firewoodHolders = campScanData.firewoodHolders ?? [];
                    const myPledgeCount = campMyPledge?.count ?? 0;
                    const ownedWithWood = firewoodHolders.find(h => {
                        const a = game.actors.get(h.actorId);
                        return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER && h.count > myPledgeCount;
                    });
                    if (ownedWithWood) {
                        campCanAddFirewood = true;
                        campMyFirewoodActorId = ownedWithWood.actorId;
                    }
                }
            }

            // Tier cards for map campfire dialog and camp context
            if (app._phase === "camp") {
                const TIER_BODIES = {
                    embers: "No cooking. No comfort change.",
                    campfire: "Cooking and warmth. Easier for enemies to spot.",
                    bonfire: "+1 camp comfort. Visible from far off."
                };
                const TIER_LABELS = Object.fromEntries(
                    COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
                );
                const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
                const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
                // Bonfire shifts comfort +1 tier; embers/campfire leave it unchanged
                const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
                // Before the fire is committed, the selected tier is the live preview so the
                // clicked card highlights; once lit, it tracks the committed level.
                const selectedTier = (app._fireLevel ?? "unlit") !== "unlit"
                    ? app._fireLevel
                    : (app._coldCampDecided ? null : app._campFirePreviewLevel);
                campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
                    const delta = COMFORT_DELTA[id] ?? 0;
                    const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
                    const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
                    const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
                    const comfortHint = delta !== 0
                        ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                        : resultLabel;
                    return {
                        id,
                        label: id.charAt(0).toUpperCase() + id.slice(1),
                        costLabel: CampGearScanner.firewoodCostLabel(id),
                        body: TIER_BODIES[id],
                        comfortHint,
                        comfortChanged: delta !== 0,
                        active: selectedTier === id
                    };
                });
            }
        }
        if (campScanData) {
            campComfortIsHostile = (campScanData.campComfort ?? "rough") === "hostile";
        }
        if (!app._selectedCharacterId && campScanData?.personalCards?.length) {
            const viewerActor = getPartyActors().find(a => a.isOwner && !game.user?.isGM);
            app._selectedCharacterId = viewerActor?.id ?? campScanData.personalCards[0].actorId;
        }

        const campPersonalSelected = campScanData && app._selectedCharacterId
            ? (campScanData.personalCards.find(p => p.actorId === app._selectedCharacterId) ?? null)
            : null;
        if (campPersonalSelected) {
            const bulletTip = (title, lines) => {
                const filtered = lines.filter(Boolean);
                if (!filtered.length) return title;
                return `<strong>${title}</strong><ul style='margin:4px 0 0 16px;padding:0;'>${filtered.map(l => `<li>${l}</li>`).join("")}</ul>`;
            };
            campPersonalSelected.bedrollTooltip = campPersonalSelected.hasBedroll
                ? bulletTip(campPersonalSelected.bedrollWaived ? game.i18n.localize("ionrift-respite.restPrepare.bedrollWaived") : game.i18n.localize("ionrift-respite.restPrepare.bedroll"), [game.i18n.localize("ionrift-respite.restPrepare.plusOneComfort"), game.i18n.localize("ionrift-respite.restPrepare.protectsHd"), campPersonalSelected.bedrollWaived ? game.i18n.localize("ionrift-respite.restPrepare.waivedByGm") : game.i18n.localize("ionrift-respite.restPrepare.clearsSave")])
                : bulletTip(game.i18n.localize("ionrift-respite.restPrepare.noBedroll"), [game.i18n.localize("ionrift-respite.restPrepare.restingAtCampComfort")]);
            campPersonalSelected.tentTooltip = campPersonalSelected.hasTent
                ? bulletTip(campPersonalSelected.tentWaived ? game.i18n.localize("ionrift-respite.restPrepare.tentWaived") : game.i18n.localize("ionrift-respite.restPrepare.tent"), [game.i18n.localize("ionrift-respite.restPrepare.shieldsWeather"), game.i18n.localize("ionrift-respite.restPrepare.lowersEncounterRisk"), ...(campPersonalSelected.tentWaived ? [game.i18n.localize("ionrift-respite.restPrepare.waivedByGm")] : [])])
                : bulletTip(game.i18n.localize("ionrift-respite.restPrepare.noTent"), [game.i18n.localize("ionrift-respite.restPrepare.exposedWeather")]);
            campPersonalSelected.messKitTooltip = campPersonalSelected.hasMessKit
                ? bulletTip(campPersonalSelected.messKitWaived ? game.i18n.localize("ionrift-respite.restPrepare.messKitWaived") : game.i18n.localize("ionrift-respite.restPrepare.messKit"), [game.i18n.localize("ionrift-respite.restPrepare.advantageSaves"), ...(campPersonalSelected.messKitWaived ? [game.i18n.localize("ionrift-respite.restPrepare.waivedByGm")] : [])])
                : game.i18n.localize("ionrift-respite.restPrepare.noMessKit");
            campPersonalSelected.recoveryTooltip = bulletTip(game.i18n.localize("ionrift-respite.restPrepare.recoveryTitle"), [
                campPersonalSelected.recovery?.hdLabel,
                campPersonalSelected.recovery?.exhaustionDC
                    ? game.i18n.format("ionrift-respite.restPrepare.conSaveDc", { dc: campPersonalSelected.recovery.exhaustionDC })
                    : game.i18n.localize("ionrift-respite.restPrepare.noExhaustionRisk")
            ]);
        }
        const campfirePlaced = ["camp", "activity", "meal"].includes(app._phase) && hasCampfirePlaced();

        const campfireDragCard = (() => {
            if (!["camp", "activity", "meal"].includes(app._phase) || safeRestSpot || !app._isGM) return { show: false };
            const placed = campfirePlaced;
            if (app._isTotM) {
                const hint = placed
                    ? game.i18n.localize("ionrift-respite.restPrepare.fire.totmOnMap")
                    : game.i18n.localize("ionrift-respite.restPrepare.fire.totmOptionalDrag");
                const shortLabel = placed
                    ? (app._isGM ? game.i18n.localize("ionrift-respite.restPrepare.fire.removeFire") : game.i18n.localize("ionrift-respite.restPrepare.fire.onMap"))
                    : game.i18n.localize("ionrift-respite.restPrepare.fire.placeOnMap");
                const tooltip = placed && app._isGM
                    ? game.i18n.localize("ionrift-respite.restPrepare.fire.clickTakeOff")
                    : game.i18n.localize("ionrift-respite.restPrepare.fire.dragOntoMap");
                const ariaLabel = placed && app._isGM
                    ? game.i18n.localize("ionrift-respite.restPrepare.fire.removeCampfire")
                    : game.i18n.localize("ionrift-respite.restPrepare.fire.dragCampfire");
                return {
                    show: true,
                    placed,
                    required: false,
                    canDrag: app._isGM && !placed,
                    canReclaim: app._isGM && placed,
                    hint,
                    shortLabel,
                    tooltip,
                    ariaLabel
                };
            }
            if (!isComfortEnabled()) return { show: false };
            const fireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
            if (fireIsLit) return { show: false };
            const hint = placed
                ? game.i18n.localize("ionrift-respite.restPrepare.fire.markersMove")
                : game.i18n.localize("ionrift-respite.restPrepare.fire.clickCrosshair");
            const shortLabel = placed
                ? (app._isGM ? game.i18n.localize("ionrift-respite.restPrepare.fire.moveFire") : game.i18n.localize("ionrift-respite.restPrepare.fire.onMap"))
                : game.i18n.localize("ionrift-respite.restPrepare.fire.placeFire");
            const tooltip = placed && app._isGM
                ? game.i18n.localize("ionrift-respite.restPrepare.fire.clickNewSpot")
                : hint;
            const ariaLabel = placed && app._isGM
                ? game.i18n.localize("ionrift-respite.restPrepare.fire.pickupCampfire")
                : (app._isGM ? game.i18n.localize("ionrift-respite.restPrepare.fire.placeCampfireMap") : game.i18n.localize("ionrift-respite.restPrepare.fire.campfire"));
            return {
                show: true,
                placed,
                required: true,
                canDrag: app._isGM && !placed,
                canReclaim: app._isGM && placed,
                placementClick: app._isGM && !placed,
                hint,
                shortLabel,
                tooltip,
                ariaLabel
            };
        })();

        const campfireCanMove = (app._phase === "camp" || app._phase === "activity")
            && app._usesStationsMinimalCampShell()
            && app._isGM
            && campfirePlaced;

        const canProceedFromMakeCamp = (() => {
            if (app._phase !== "camp") return false;
            const comfortOn = isComfortEnabled();
            const mapCampFire = requiresMapCampFire();
            const coldCampPreview = !!app._coldCampPreview;
            const pitOk = app._isTotM || safeRestSpot
                || (!(comfortOn || mapCampFire) ? true : campfirePlaced);
            const fireOk = safeRestSpot
                || !(comfortOn || mapCampFire)
                || (app._fireLevel ?? "unlit") !== "unlit"
                || !!app._coldCampDecided
                || coldCampPreview;
            return fireOk && pitOk;
        })();

        const proceedBlockedHint = (() => {
            if (app._phase !== "camp") return "Light the fire or choose cold camp";
            const comfortOn = isComfortEnabled();
            const mapCampFire = requiresMapCampFire();
            if ((comfortOn || mapCampFire) && !app._isTotM && !safeRestSpot && !campfirePlaced) {
                return "Place the campfire on the map first";
            }
            if (comfortOn || mapCampFire) {
                return "Light the fire or choose cold camp";
            }
            return "Place the campfire on the map first";
        })();

    return {
        campScanData, campMakeCampStep, campFireEncounterHint, campFirePickerLevels,
        campFireGatePit, campFireGateLevel, campColdCampDecided, campComfortIsHostile,
        campFireIsLit, campSelectedFirewoodCost, campPartyFirewood, campHasEnoughFirewood,
        campCanLight, campFireLitBy, campFireLighters, campFirewoodPledgeList, campMyPledge,
        campCanAddFirewood, campMyFirewoodActorId, campFireTierCards, campFireTotalPledged,
        campViewerCanLight, campFireOtherLighterCount, campFireLighterNames,
        campPersonalSelected, campfirePlaced, campfireDragCard, campfireCanMove,
        canProceedFromMakeCamp, proceedBlockedHint
    };
}

export function buildCampStatusAndEncounterBar(app, encountersEnabled) {
    return {
            campStatus: app._engine ? (() => {
                const rawComfort = app._engine.comfort;
                // Fire comfort is written onto the rest when the night starts.
                // Before that, preview the same table dawn will use. Do not add it twice.
                const fireBaked = app._phase === "events" || app._phase === "resolve";
                const fireSteps = fireBaked ? 0 : pendingFireComfortDelta(app._fireLevel, app._coldCampDecided);
                const comfort = boostComfort(rawComfort, fireSteps);

                const weatherKey = app._engine.weather ?? "clear";
                const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
                const weatherParts = [];
                if (wx.comfortPenalty > 0) weatherParts.push(`Comfort -${wx.comfortPenalty} step`);
                if (wx.encounterDC > 0) weatherParts.push(`Night check mod +${wx.encounterDC}`);
                if (wx.tentCancels) weatherParts.push("Tent cancels");
                else if (wx.tentReduces) weatherParts.push("Tent reduces by 1");
                const SHELTER_TOOLTIPS = {
                    tent: "Tent: encounter threshold -2, cancels or reduces weather",
                    tiny_hut: "Tiny Hut: comfort floor sheltered, encounter threshold -5",
                    rope_trick: "Rope Trick: extradimensional shelter, hidden from the outside",
                    magnificent_mansion: "Mansion: comfort floor safe, no encounters"
                };
                const FIRE_TIPS = {
                    unlit: "Unlit: -1 comfort step at resolution",
                    embers: "Embers: no change to encounter chance.",
                    campfire: "Campfire: +1 encounter DC (light draws attention).",
                    bonfire: "+1 camp comfort. +2 encounter DC (beacon in the dark)."
                };
                return app._campStatus = {
                    comfort,
                    comfortTooltip: getComfortTip(comfort),
                    weather: weatherKey !== "clear" ? weatherKey : null,
                    weatherLabel: wx.label,
                    weatherIcon: wx.icon ?? "fas fa-sun",
                    weatherTooltip: weatherParts.length ? `${wx.label}: ${weatherParts.join(", ")}` : wx.label,
                    fireLevel: app._fireLevel ?? "unlit",
                    fireTooltip: FIRE_TIPS[app._fireLevel ?? "unlit"] ?? "Fire",
                    hasTent: (app._engine.activeShelters ?? []).includes("tent"),
                    activeShelters: (app._engine.activeShelters ?? []).map(id => {
                        const SHELTER_LABELS = { tent: "Tent", tiny_hut: "Tiny Hut", rope_trick: "Rope Trick", magnificent_mansion: "Mansion", none: "Open Air" };
                        const SHELTER_ICONS = { tent: "fas fa-campground", tiny_hut: "fas fa-igloo", rope_trick: "fas fa-hat-wizard", magnificent_mansion: "fas fa-chess-rook", none: "fas fa-cloud-moon" };
                        return { id, name: SHELTER_LABELS[id] ?? id, icon: SHELTER_ICONS[id] ?? "fas fa-shield-alt", tooltip: SHELTER_TOOLTIPS[id] ?? SHELTER_LABELS[id] ?? id };
                    })
                };
            })() : app._campStatus ?? null,
        encounterBar: (app._engine && !app._eventsRolled && !app._engine.safeRestSpot && encountersEnabled) ? (() => {
                const bd = app._engine._encounterBreakdown ?? {};
                const shelter = bd.shelter ?? 0;
                const weather = bd.weather ?? 0;
                const fireUncommitted = (app._fireLevel ?? "unlit") === "unlit" && !app._coldCampDecided;
                const fire = ((app._phase === "camp" || app._phase === "activity") && fireUncommitted)
                    ? (CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[app._campFirePreviewLevel ?? "embers"] ?? 0)
                    : (app._engine.fireRollModifier ?? 0);
                const gmAdj = app._engine.gmEncounterAdj ?? 0;
                const travelMishap = bd.travelMishap ?? 0;
                // One formula for the badge and the roll. Do not recompute here.
                const totalDefenses = app._engine.defenseContribution(app._earlyResults);
                const total = shelter + weather + fire;
                const baseDC = app._engine._baseDC ?? 15;
                const effectiveDC = app._engine.getEffectiveEncounterDC({
                    fireModifier: fire,
                    earlyResults: app._earlyResults
                });
                Logger.log(`[Respite:UI] encounterBar: baseDC=${baseDC}, shelter=${shelter}, weather=${weather}, fire=${fire}, total=${total}, defenses=${totalDefenses}, travelMishap=${travelMishap}, gmAdj=${gmAdj}, effectiveDC=${effectiveDC}`);
                const fmt = (v) => v > 0 ? `+${v}` : `${v}`;
                const terrainObj = TerrainRegistry.get(app._engine.terrainTag);
                const terrainLabel = terrainObj?.label ?? app._engine.terrainTag ?? "Terrain";
                const chips = [];
                if (weather !== 0) chips.push({ label: bd.weatherName ?? game.i18n.localize("ionrift-respite.restPrepare.encounter.weather"), value: fmt(weather), icon: WEATHER_TABLE[bd.weatherName]?.icon ?? "fas fa-cloud-sun-rain", tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.weatherTooltip") });
                if (shelter !== 0) chips.push({ label: game.i18n.localize("ionrift-respite.restPrepare.encounter.shelter"), value: fmt(-shelter), icon: "fas fa-campground", tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.shelterTooltip") });
                if (fire !== 0) chips.push({ label: app._fireLevel ?? game.i18n.localize("ionrift-respite.restPrepare.encounter.fire"), value: fmt(-fire), icon: "fas fa-fire", tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.fireTooltip") });
                if (travelMishap !== 0) chips.push({ label: game.i18n.localize("ionrift-respite.restPrepare.encounter.travel"), value: fmt(-travelMishap), icon: "fas fa-route", tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.travelTooltip") });
                const defensesAttempted = app._pendingCampRolls?.some(p => p.activityId === "act_defenses");
                const defensesChosen = [...(app._characterChoices?.values() ?? [])].includes("act_defenses");
                let defensesFailed = false;
                let defensesPending = false;
                if (totalDefenses !== 0) {
                    chips.push({ label: game.i18n.localize("ionrift-respite.restPrepare.encounter.defenses"), value: `-${totalDefenses}`, icon: "fas fa-shield-alt", tooltip: game.i18n.format("ionrift-respite.restPrepare.encounter.defensesPassedTooltip", { count: totalDefenses / 2 }) });
                } else if (defensesAttempted || defensesChosen) {
                    let earlyDefenseCount = 0;
                    for (const [, er] of (app._earlyResults ?? [])) {
                        if (er.activityId === "act_defenses") earlyDefenseCount++;
                    }
                    defensesPending = true;
                    defensesFailed = earlyDefenseCount > 0 || defensesAttempted;
                    if (defensesFailed) {
                        chips.push({ label: game.i18n.localize("ionrift-respite.restPrepare.encounter.defenses"), value: "0", icon: "fas fa-shield-alt", warn: true, tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.defensesFailedTooltip") });
                    } else {
                        chips.push({ label: game.i18n.localize("ionrift-respite.restPrepare.encounter.defenses"), value: "pending", icon: "fas fa-shield-alt", tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.defensesPendingTooltip") });
                    }
                }
                if (gmAdj !== 0) chips.push({ label: "GM", value: fmt(gmAdj), icon: "fas fa-gavel", tooltip: game.i18n.localize("ionrift-respite.restPrepare.encounter.gmAdjTooltip") });

                const playerFactors = app._buildEncounterPlayerFactors({
                    terrainLabel,
                    weather,
                    weatherName: bd.weatherName,
                    shelter,
                    fire,
                    fireLevel: app._fireLevel ?? "unlit",
                    totalDefenses,
                    defensesPending,
                    defensesFailed
                });

                return {
                    total,
                    baseDC,
                    effectiveDC,
                    terrainLabel,
                    totalLabel: `Encounter DC ${effectiveDC}`,
                    chips,
                    playerFactors,
                    isGM: game.user.isGM,
                    gmAdj
                };
            })() : null,
    };
}
