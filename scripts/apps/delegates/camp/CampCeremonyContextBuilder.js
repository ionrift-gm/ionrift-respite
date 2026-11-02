import { Logger } from "../../../utils/Logger.js";
import {
    CampGearScanner,
    actorHasTinderbox,
    countActorFirewood,
    findConsumableFirewoodItem,
    isActorFirewoodItem,
    isFireCantripItem
} from "../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import { logCampfireReconnect } from "../../../services/camp/fire/CampfireReconnectLog.js";
import { ItemOutcomeHandler } from "../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import {
    emitPhaseChanged,
    emitCampLightFire,
    emitActivityFireLevelRequest,
    emitSocketMessage
} from "../../../services/socket/SocketController.js";
import { isComfortEnabled, COMFORT_TIERS } from "../../../services/camp/gear/ComfortCalculator.js";
import { buildCampCeremonyPhasePayload } from "../../../services/camp/gear/campCeremonySync.js";
import { isCampfireMinigameEnabled, isSimpleStationsMode, requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { hasCampfirePlaced } from "../../../services/camp/props/CompoundCampPlacer.js";
import { WEATHER_TABLE, SHELTER_SPELLS } from "../../../data/RestConstants.js";
import { CampfireEmbed } from "../../camp/CampfireEmbed.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { registerCampfireEmbed, clearCampfireEmbed } from "../../../module.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const FIRE_LEVELS = Object.freeze(["unlit", "embers", "campfire", "bonfire"]);

import { CampCeremonyDelegate } from "./CampCeremonyDelegate.js";
export const CampCeremonyContextMethods = {
    async onSetFireLevel(event, target) {
        const app = this._app;

        const level = target.dataset.fireLevel;
        if (!level) return;
        app._fireLevel = level;

        if (game.user.isGM && ["embers", "campfire", "bonfire"].includes(level)) {
            void CampfireTokenLinker.setLightState(true, level);
        }

        // Sync to players
        emitPhaseChanged("reflection", { fireLevel: level });

        app.render();
    
    },

    buildCampfireDrawerContextForMapDialog() {
        const app = this._app;

        if (app._phase !== "camp") return null;

        let campScanData = null;
        let campFireEncounterHint = "";
        let campFirePickerLevels = [];
        let campColdCampDecided = false;
        if (app._phase === "camp") {
            const terrainTagCamp = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            const fireCommitted = (app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided;
            campColdCampDecided = !!app._coldCampDecided;
            // When fire hasn't been committed, preview defaults to "embers" (the
            // default highlighted tab), NOT "unlit" which applies a no-fire penalty.
            const effectiveScanLevel = (campfirePlacedGate && fireCommitted)
                ? (app._coldCampDecided ? "cold_camp" : (app._fireLevel ?? "unlit"))
                : (app._campFirePreviewLevel ?? (app._fireLevel !== "unlit" ? app._fireLevel : "embers"));
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.coldCamp");
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.chooseLevel");
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.embers");
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.campfire");
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.bonfire");
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
                if (!hasTinder) return game.i18n.localize("ionrift-respite.campCeremony.needTinderbox");
                return game.i18n.format("ionrift-respite.campCeremony.needFirewood", { count: cost });
            };
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: game.i18n.localize("ionrift-respite.fireLevel.embers"),
                    costLabel: CampGearScanner.firewoodCostLabel("embers"),
                    disabled: !fs.canPickEmbers,
                    disabledReason: tierDisabledReason(fs.canPickEmbers, fs.costEmbers ?? 1),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "embers" : preview === "embers")
                },
                {
                    id: "campfire",
                    label: game.i18n.localize("ionrift-respite.fireLevel.campfire"),
                    costLabel: CampGearScanner.firewoodCostLabel("campfire"),
                    disabled: !fs.canPickCampfire,
                    disabledReason: tierDisabledReason(fs.canPickCampfire, fs.costCampfire ?? 2),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "campfire" : preview === "campfire")
                },
                {
                    id: "bonfire",
                    label: game.i18n.localize("ionrift-respite.fireLevel.bonfire"),
                    costLabel: CampGearScanner.firewoodCostLabel("bonfire"),
                    disabled: !fs.canPickBonfire,
                    disabledReason: tierDisabledReason(fs.canPickBonfire, fs.costBonfire ?? 3),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "bonfire" : preview === "bonfire")
                }
            ];
        }

        let campFireIsLit = false;
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
        if (app._phase === "camp" && campScanData) {
            campFireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
            campFireLitBy = app._fireLitBy ?? null;
            campFireTotalPledged = Array.from(app._firewoodPledges.values()).reduce((s, p) => s + p.count, 0);

            const rawLighters = campScanData.fireLighters ?? [];
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips?.() ?? [];
            const cantripLighters = [];
            for (const actor of getPartyActors()) {
                if (rawLighters.some(l => l.actorId === actor.id)) continue;
                const cantrip = fireCantrips.length > 0
                    ? actor.items.find(i => isFireCantripItem(i, fireCantrips))
                    : null;
                if (cantrip) cantripLighters.push({ actorId: actor.id, actorName: actor.name, method: cantrip.name });
            }
            const rawLightersTagged = rawLighters.map(l => ({ ...l, methodType: "item", methodIcon: "fas fa-box" }));
            const cantripLightersTagged = cantripLighters.map(l => ({ ...l, methodType: "spell", methodIcon: "fas fa-magic" }));
            const allLighters = [...rawLightersTagged, ...cantripLightersTagged];

            campFireLighters = allLighters.map(l => ({
                ...l,
                isViewerActor: (game.actors.get(l.actorId)?.ownership?.[game.user.id] ?? 0) >= OWNER
            }));
            campViewerCanLight = campFireLighters.some(l => l.isViewerActor);
            if (app._campPitBlocksFireLighting()) campViewerCanLight = false;
            campFireLighterNames = campFireLighters.map(l => l.actorName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            campFireOtherLighterCount = campFireLighters.filter(l => !l.isViewerActor).length;

            campFirewoodPledgeList = Array.from(app._firewoodPledges.values())
                .filter(p => p.count > 0)
                .map(p => ({ actorName: p.actorName, count: p.count }));

            campMyPledge = app._firewoodPledges.get(game.user.id) ?? null;

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

            const TIER_BODIES = {
                embers: game.i18n.localize("ionrift-respite.campCeremony.tierBody.embers"),
                campfire: game.i18n.localize("ionrift-respite.campCeremony.tierBody.campfire"),
                bonfire: game.i18n.localize("ionrift-respite.campCeremony.tierBody.bonfire")
            };
            const TIER_LABELS = Object.fromEntries(
                COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
            );
            const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
            const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
            const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
            // Highlight the chosen tier: committed level once lit, otherwise the live
            // preview. Cold camp suppresses any fire-tier highlight.
            const curLevel = app._fireLevel ?? "unlit";
            const previewLevel = app._campFirePreviewLevel ?? "embers";
            const coldActive = !!app._coldCampDecided || previewLevel === "cold_camp";
            campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
                const delta = COMFORT_DELTA[id] ?? 0;
                const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
                const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
                const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
                const comfortHint = delta !== 0
                    ? game.i18n.format("ionrift-respite.campCeremony.comfortChange", { from: TIER_LABELS[baseComfort] ?? baseComfort, to: resultLabel })
                    : resultLabel;
                return {
                    id,
                    label: CampGearScanner.fireLevelLabel(id),
                    costLabel: CampGearScanner.firewoodCostLabel(id),
                    body: TIER_BODIES[id],
                    comfortHint,
                    comfortChanged: delta !== 0,
                    active: !coldActive && (curLevel !== "unlit" ? curLevel === id : previewLevel === id)
                };
            });
        }

        const mapComfortLabel = campScanData?.campComfortLabel ?? "";
        const mapComfortLine = campScanData
            ? (campScanData.comfortReason
                ? `${campScanData.terrainLabel ? `${campScanData.terrainLabel}: ` : ""}${campScanData.comfortReason}`
                : (campScanData.terrainLabel
                    ? `${campScanData.terrainLabel} (${mapComfortLabel})`
                    : game.i18n.format("ionrift-respite.campCeremony.campComfortLine", { comfort: mapComfortLabel })))
            : "";
        const mapComfortTierClass = campScanData?.campComfort
            ? `comfort-${campScanData.campComfort}`
            : "comfort-rough";

        // Personal rest outcome (HP / Hit Dice / exhaustion) for the viewer, scanned at the
        // previewed fire level so the risk/reward of each tier is tangible before lighting.
        let mapRestCard = null;
        let mapRestActorName = "";
        if (campScanData?.personalCards?.length) {
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            let chosen = null;
            if (game.user.isGM) {
                chosen = app._selectedCharacterId
                    ? campScanData.personalCards.find(p => p.actorId === app._selectedCharacterId)
                    : null;
            } else {
                chosen = campScanData.personalCards.find(p => {
                    const a = game.actors.get(p.actorId);
                    return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER;
                });
            }
            mapRestCard = chosen ?? campScanData.personalCards[0] ?? null;
            if (mapRestCard) {
                mapRestActorName = game.actors.get(mapRestCard.actorId)?.name ?? mapRestCard.actorName ?? "";
            }
        }

        return {
            campFireEncounterHint,
            campFireIsLit,
            campCurrentFireLevel: app._fireLevel ?? "unlit",
            mapRestCard,
            mapRestActorName,
            campFireLitBy,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campFireTierCards,
            campFireTotalPledged,
            campColdCampDecided,
            campScanData,
            campFirePickerLevels,
            campFirePreviewLevel: app._campFirePreviewLevel ?? "embers",
            campPreviewIsColdCamp: app._isCampColdCampPreview(),
            campViewerCanLight,
            campPitBlocksFireLighting: app._campPitBlocksFireLighting(),
            campFireOtherLighterCount,
            campFireLighterNames,
            mapComfortLabel,
            mapComfortLine,
            mapComfortTierClass
        };
    
    },

    getFireTabContextForStationDialog() {
        const app = this._app;

        if (app.isCampfireStationFlavorOnly()) return null;
        const campScanData = app._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;

        if (app._stationsFireMinigameEnabled()) {
            const coldCamp = !!app._coldCampDecided;
            const curLevel = app._fireLevel ?? "unlit";
            const effectiveScanLevel = coldCamp ? "cold_camp" : curLevel;
            let campFireEncounterHint = "";
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.coldCamp");
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.useCampfire");
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.embers");
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.campfire");
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.bonfire");
            }
            return {
                useFireMinigame: true,
                campFireEncounterHint,
                campFireIsLit: curLevel !== "unlit",
                campFireTabColdCamp: coldCamp
            };
        }

        const coldCamp = !!app._coldCampDecided;
        const curLevel = app._fireLevel ?? "unlit";
        // Local preview wins for the hint and header so the impact is visible before commit.
        const previewLevel = (["embers", "campfire", "bonfire"].includes(app._stationFirePreviewLevel)
            && app._stationFirePreviewLevel !== curLevel)
            ? app._stationFirePreviewLevel
            : null;
        const effectiveScanLevel = previewLevel ?? (coldCamp ? "cold_camp" : curLevel);

        let campFireEncounterHint = "";
        if (effectiveScanLevel === "cold_camp") {
            campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.coldCamp");
        } else if (effectiveScanLevel === "unlit") {
            campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.noFireLit");
        } else if (effectiveScanLevel === "embers") {
            campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.embers");
        } else if (effectiveScanLevel === "campfire") {
            campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.campfire");
        } else if (effectiveScanLevel === "bonfire") {
            campFireEncounterHint = game.i18n.localize("ionrift-respite.campCeremony.encounterHint.bonfire");
        }
        if (previewLevel) {
            campFireEncounterHint = game.i18n.format("ionrift-respite.campCeremony.encounterHint.previewing", { level: previewLevel, hint: campFireEncounterHint });
        }

        const TIER_LABELS = Object.fromEntries(
            COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
        );
        const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
        const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
        const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
        const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const costCur = coldCamp || curLevel === "unlit" ? 0 : (F[curLevel] ?? 0);
        const actors = getPartyActors();
        const hasTinderbox = actors.some(a => actorHasTinderbox(a));
        const totalPartyFirewood = actors.reduce((sum, a) => sum + countActorFirewood(a), 0);

        const campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
            const delta = COMFORT_DELTA[id] ?? 0;
            const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
            const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
            const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
            const comfortHint = delta !== 0
                ? game.i18n.format("ionrift-respite.campCeremony.comfortChange", { from: TIER_LABELS[baseComfort] ?? baseComfort, to: resultLabel })
                : resultLabel;
            const isActive = !coldCamp && curLevel === id;
            const costNew = F[id] ?? 0;
            const isGm = !!game.user?.isGM;
            let tierChangeBlocked = true;
            let tierDisabledReason = "";
            if (!isActive) {
                if (costNew < costCur) {
                    tierChangeBlocked = false;
                } else {
                    const need = costNew - costCur;
                    if (costCur === 0 && !hasTinderbox) {
                        tierChangeBlocked = true;
                        tierDisabledReason = game.i18n.localize("ionrift-respite.campCeremony.needTinderbox");
                    } else if (need > 0 && totalPartyFirewood < need) {
                        tierChangeBlocked = true;
                        tierDisabledReason = game.i18n.format("ionrift-respite.campCeremony.needFirewood", { count: need });
                    } else {
                        tierChangeBlocked = false;
                    }
                }
            }
            return {
                id,
                label: CampGearScanner.fireLevelLabel(id),
                costLabel: CampGearScanner.firewoodCostLabel(id),
                comfortHint,
                comfortChanged: delta !== 0,
                active: isActive,
                previewActive: previewLevel === id,
                actionBlocked: isActive ? false : tierChangeBlocked,
                setDisabled: isActive ? false : (isGm ? tierChangeBlocked : true),
                requestDisabled: tierChangeBlocked,
                disabledReason: tierDisabledReason
            };
        });

        const campFireColdCampCard = {
            active: coldCamp,
            setDisabled: coldCamp,
            requestDisabled: coldCamp
        };

        const campFirewoodPledgeList = Array.from(app._firewoodPledges.values())
            .filter(p => p.count > 0)
            .map(p => ({ actorName: p.actorName, count: p.count }));

        return {
            campFireTierCards,
            campFireColdCampCard,
            campFireEncounterHint,
            campFirewoodPledgeList,
            campFireIsLit: (app._fireLevel ?? "unlit") !== "unlit",
            campFireTabColdCamp: coldCamp,
            campFireTabGm: !!game.user?.isGM,
            campFirePreviewLevel: previewLevel,
            campFirePreviewLabel: previewLevel ? CampGearScanner.fireLevelLabel(previewLevel) : null
        };
    
    },

    getCampPersonalCardForActor(actorId) {
        const app = this._app;

        if (app.isCampfireStationFlavorOnly()) return null;
        if (app._phase !== "activity" || !actorId) return null;
        const gearCtx = app.getCampGearContextForActor(actorId);
        if (!gearCtx) return null;
        const campScanData = app._getCampScanDataForActivityStationDialog();
        if (!campScanData?.personalCards?.length) return null;
        const card = campScanData.personalCards.find(p => p.actorId === actorId);
        if (!card) return null;

        const g = gearCtx;
        const slot = (def) => {
            const owned = def.owned;
            const deployed = def.deployed;
            const canDrag = def.canDrag;
            return {
                gearType: def.gearType,
                title: def.title,
                icon: def.icon,
                actorId: g.actorId,
                isMissing: !owned,
                isPlaced: owned && deployed,
                canDrag: owned && canDrag,
                isReadonlyOwned: owned && !canDrag && !deployed,
                benefitLine: def.benefitLine,
                missingLine: def.missingLine
            };
        };
        const gearSlots = [
            slot({
                gearType: "bedroll",
                title: game.i18n.localize("ionrift-respite.campCeremony.gear.bedroll.title"),
                icon: "fas fa-bed",
                owned: g.hasBedroll,
                deployed: g.bedrollDeployed,
                canDrag: g.canDragBedroll,
                benefitLine: game.i18n.localize("ionrift-respite.campCeremony.gear.bedroll.benefit"),
                missingLine: game.i18n.localize("ionrift-respite.campCeremony.gear.bedroll.missing")
            }),
            slot({
                gearType: "tent",
                title: game.i18n.localize("ionrift-respite.campCeremony.gear.tent.title"),
                icon: "fas fa-campground",
                owned: g.hasTent,
                deployed: g.tentDeployed,
                canDrag: g.canDragTent,
                benefitLine: game.i18n.localize("ionrift-respite.campCeremony.gear.tent.benefit"),
                missingLine: game.i18n.localize("ionrift-respite.campCeremony.gear.tent.missing")
            }),
            slot({
                gearType: "messkit",
                title: g.messKitSource === "utensils" ? game.i18n.localize("ionrift-respite.campCeremony.gear.messKit.utensilsTitle") : game.i18n.localize("ionrift-respite.campCeremony.gear.messKit.title"),
                icon: g.messKitSource === "utensils" ? "fas fa-mortar-pestle" : "fas fa-utensils",
                owned: g.hasMessKit,
                deployed: g.messKitDeployed,
                canDrag: g.canDragMessKit,
                benefitLine: g.messKitSource === "utensils"
                    ? game.i18n.localize("ionrift-respite.campCeremony.gear.messKit.utensilsBenefit")
                    : game.i18n.localize("ionrift-respite.campCeremony.gear.messKit.benefit"),
                missingLine: game.i18n.localize("ionrift-respite.campCeremony.gear.messKit.missing")
            })
        ];

        const rec = card.recovery ?? {};
        const hpSev = rec.hpSeverity ?? "";
        const hdSev = rec.hdSeverity ?? "";
        const exSev = rec.exhaustionSeverity ?? null;
        const hasSuboptimalLine =
            hpSev === "danger" || hpSev === "warning" ||
            hdSev === "danger" || hdSev === "warning" ||
            exSev === "danger" || exSev === "warning";

        const mitigationHints = [];
        if (hasSuboptimalLine) {
            if (!g.hasBedroll) {
                mitigationHints.push(game.i18n.localize("ionrift-respite.campCeremony.mitigation.carryBedroll"));
            } else {
                mitigationHints.push(game.i18n.localize("ionrift-respite.campCeremony.mitigation.bedrollApplied"));
            }
            if (!campScanData.fireIsLit) {
                mitigationHints.push(game.i18n.localize("ionrift-respite.campCeremony.mitigation.lightFire"));
            } else {
                const fl = campScanData.fireLevel;
                if (fl && fl !== "unlit" && fl !== "bonfire") {
                    mitigationHints.push(game.i18n.localize("ionrift-respite.campCeremony.mitigation.bonfire"));
                }
            }
            mitigationHints.push(game.i18n.localize("ionrift-respite.campCeremony.mitigation.restFully"));
        }

        const fireLevelRaw = campScanData.fireLevel ?? "embers";
        const fireTierLabels = {
            unlit: game.i18n.localize("ionrift-respite.campCeremony.fireFactor.noFire"),
            embers: game.i18n.localize("ionrift-respite.fireLevel.embers"),
            campfire: game.i18n.localize("ionrift-respite.fireLevel.campfire"),
            bonfire: game.i18n.localize("ionrift-respite.fireLevel.bonfire")
        };
        const fireStatusLines = {
            unlit: game.i18n.localize("ionrift-respite.campCeremony.fireFactor.status.unlit"),
            embers: game.i18n.localize("ionrift-respite.campCeremony.fireFactor.status.embers"),
            campfire: game.i18n.localize("ionrift-respite.campCeremony.fireFactor.status.campfire"),
            bonfire: game.i18n.localize("ionrift-respite.campCeremony.fireFactor.status.bonfire")
        };
        const fireFactorRow = {
            tierLabel: fireTierLabels[fireLevelRaw] ?? fireLevelRaw,
            statusLine: fireStatusLines[fireLevelRaw] ?? ""
        };

        return {
            personalComfort: card.personalComfort,
            personalComfortLabel: card.personalComfortLabel,
            personalMatchesCamp: !!card.personalMatchesCamp,
            fireFactorRow,
            gearBreakdown: card.gearBreakdown ?? [],
            recovery: {
                hpLabel: rec.hpLabel ?? "",
                hpSeverity: hpSev,
                hdLabel: rec.hdLabel ?? "",
                hdSeverity: hdSev,
                exhaustionDC: rec.exhaustionDC ?? null,
                exhaustionLabel: rec.exhaustionLabel ?? "",
                exhaustionSeverity: exSev
            },
            mitigationHints,
            hasMitigationHints: mitigationHints.length > 0,
            hasBedroll: !!card.hasBedroll,
            hasTent: !!card.hasTent,
            hasMessKit: !!card.hasMessKit,
            actorId: g.actorId,
            gearSlots
        };
    
    },

    _buildEncounterPlayerFactors(params) {
        const app = this._app;

        const {
            terrainLabel,
            weather,
            weatherName,
            shelter,
            fire,
            fireLevel,
            totalDefenses,
            defensesPending,
            defensesFailed
        } = params;

        const factors = [{
            label: game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.terrain"),
            tone: "neutral",
            icon: "fas fa-mountain",
            tooltip: game.i18n.format("ionrift-respite.campCeremony.encounterFactor.terrainTooltip", { terrain: terrainLabel })
        }];

        const wx = WEATHER_TABLE[weatherName ?? ""] ?? null;
        if (weather !== 0 || (wx && (wx.encounterDC !== 0 || wx.comfortPenalty > 0))) {
            factors.push({
                label: wx?.label ?? game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.weather"),
                tone: (wx?.encounterDC ?? 0) > 0 ? "risk" : "neutral",
                icon: wx?.icon ?? "fas fa-cloud-sun-rain",
                tooltip: wx?.hint ?? game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.weatherTooltip")
            });
        }

        if (shelter !== 0) {
            factors.push({
                label: game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.shelter"),
                tone: "help",
                icon: "fas fa-campground",
                tooltip: game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.shelterTooltip")
            });
        }

        if (fire !== 0) {
            const fireLabels = {
                embers: game.i18n.localize("ionrift-respite.fireLevel.embers"),
                campfire: game.i18n.localize("ionrift-respite.fireLevel.campfire"),
                bonfire: game.i18n.localize("ionrift-respite.fireLevel.bonfire"),
                cold_camp: game.i18n.localize("ionrift-respite.fireLevel.coldCamp"),
                unlit: game.i18n.localize("ionrift-respite.fireLevel.unlit")
            };
            factors.push({
                label: fireLabels[fireLevel] ?? game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.fire"),
                tone: fire < 0 ? "risk" : "help",
                icon: "fas fa-fire",
                tooltip: fire < 0
                    ? game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.fireRiskTooltip")
                    : game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.fireHelpTooltip")
            });
        }

        if (totalDefenses !== 0) {
            factors.push({
                label: game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.defenses"),
                tone: "help",
                icon: "fas fa-shield-alt",
                tooltip: game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.defensesHolding")
            });
        } else if (defensesPending) {
            factors.push({
                label: game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.defenses"),
                tone: defensesFailed ? "risk" : "pending",
                icon: "fas fa-shield-alt",
                tooltip: defensesFailed
                    ? game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.defensesFailed")
                    : game.i18n.localize("ionrift-respite.campCeremony.encounterFactor.defensesPending")
            });
        }

        return factors;
    
    },


};
