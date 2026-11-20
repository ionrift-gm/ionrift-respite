import { MODULE_ID } from "../../../data/moduleId.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { MEAL_DEFAULTS } from "../../../services/meal/inventory/MealConstants.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { GatherYieldService } from "../../../services/rest/forage/GatherYieldService.js";
import { activityOfferingsClosed, describeGatherDraft } from "../../../services/rest/session/campProgressState.js";
import { describeItemMealBuff } from "../../../services/meal/buffs/MealBuffPresets.js";

/**
 * Gather sub-panel. Opens once Hunt, Forage, or Skip is chosen and
 * replaces the card list. The Survival check and the findings roll live here.
 * @param {object} app
 * @param {string} workflowStep
 * @returns {object|null}
 */
export function buildGatherPanel(app, workflowStep) {
    if (workflowStep !== "gather") return null;
    const cid = app._selectedCharacterId;
    if (!cid) return null;
    const actor = game.actors.get(cid);
    if (!actor) return null;

    const draft = describeGatherDraft(app, cid, {
        huntDc: app._campLogistics?._huntDC ?? 14,
        forageDc: app._campLogistics?._forageDC ?? 12
    });
    if (!draft) return null;

    const { choice, isHunt, skipped, skipDraft, result, pending } = draft;
    const isSkip = skipped || skipDraft;
    const act = (!isSkip && choice) ? app._activityResolver?.activities?.get(choice) : null;
    const locked = !!result || skipped || pending?.phase === "findings";
    return {
        name: isSkip ? game.i18n.localize("ionrift-respite.restPrepare.gather.skip") : (act?.name ?? (isHunt ? game.i18n.localize("ionrift-respite.restPrepare.gather.hunt") : game.i18n.localize("ionrift-respite.restPrepare.gather.forage"))),
        icon: isSkip ? "fas fa-campground" : (act?.icon ?? (isHunt ? "fas fa-paw" : "fas fa-leaf")),
        actorName: actor.name,
        actorPortrait: actor.img ?? actor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
        locked,
        characterId: cid,
        dc: draft.dc,
        canRollCheck: draft.canRollCheck,
        canConfirmSkip: draft.canConfirmSkip,
        findingsOpen: draft.findingsOpen,
        finds: result
            ? GatherYieldService.presentItems(result.items, {
                rations: result.fromTable ? 0 : (result.rations ?? 0)
            })
            : [],
        detail: result
            ? (result.haul || game.i18n.localize("ionrift-respite.restPrepare.gather.nothingFound"))
            : (skipped ? game.i18n.localize("ionrift-respite.restPrepare.gather.remainAtCamp") : "")
    };
}

/**
 * Locked result for a confirmed activity. Forage and hunt stay on Gather.
 * @param {object} app
 * @param {Array<{tiles?: Array<{id: string, hint?: string}>}>} totmStationCards
 * @returns {{kicker: string, title: string, detail: string}|null}
 */
export function buildActivityCommit(app, totmStationCards, { hideActivitiesStep = false } = {}) {
    const cid = app._selectedCharacterId;
    if (!cid) return null;
    if (!activityOfferingsClosed(app, cid)) return null;
    const actId = app._gmOverrides?.get(cid) ?? app._characterChoices?.get(cid);
    const act = app._activityResolver?.activities?.get(actId);
    const early = app._earlyResults?.get(cid);
    const craft = app._craftingResults?.get(cid);
    let detail = "";
    if (early?.activityId === actId && early.narrative) {
        detail = early.narrative;
    } else if (craft && (craft.activityId === actId || !craft.activityId)) {
        detail = craft.narrative || craft.summary || "";
    }
    if (!detail) {
        for (const station of totmStationCards ?? []) {
            const tile = station.tiles?.find(t => t.id === actId);
            if (tile?.hint) {
                detail = tile.hint;
                break;
            }
        }
    }
    const nonFreeTileExists = (totmStationCards ?? []).some(station =>
        (station.tiles ?? []).some(t => t.id && t.id !== "act_other")
    );
    const soleFreeTime = actId === "act_other" && (hideActivitiesStep || !nonFreeTileExists);
    const cannotChange = !!(early || craft || app.hasCompletedCrafting?.(cid) || soleFreeTime);
    return { kicker: "ACTIVITIES", title: act?.name ?? actId, detail, icon: act?.icon ?? "fas fa-moon", cannotChange };
}

/**
 * True while the open card is showing Next.
 * A party that is already fully ready is released in canGmProceedFromActivity.
 */
export function phaseProceedHeld(
    app, workflowStep, detailPanel, mealOpen, identifyOpen, stationCards,
    { hideActivitiesStep = false, showSustenanceStep = true } = {}
) {
    if (app._phase !== "activity") return false;
    if (detailPanel || mealOpen || identifyOpen) return false;
    const gatherPanel = buildGatherPanel(app, workflowStep);
    if (workflowStep === "gather" && gatherPanel) {
        if (gatherPanel.canConfirmSkip) return false;
        if (hideActivitiesStep && !showSustenanceStep) return false;
        if (gatherPanel.finds?.length) return true;
        if (gatherPanel.detail) return true;
        return false;
    }
    if (!showSustenanceStep) return false;
    return workflowStep !== "gather" && !!buildActivityCommit(app, stationCards, { hideActivitiesStep });
}

/**
 * Locked result once rations are submitted or food/water are consumed.
 * @param {object} app
 * @returns {{kicker: string, title: string, detail: string, isFed: boolean, isHydrated: boolean, waterShortLabel?: string, buff?: string}|null}
 */
export function buildMealCommit(app) {
    const mealActorId = app._selectedCharacterId
        ?? (app._isGM ? getPartyActors()[0]?.id : (app._myCharacterIds?.values().next().value ?? getPartyActors()[0]?.id));
    if (!mealActorId) return null;

    const actor = game.actors.get(mealActorId);
    if (!actor) return null;

    const isSubmitted = Boolean(app._activityMealRationsSubmitted?.has(mealActorId));
    const card = typeof app.getStationMealCardForActor === "function" ? app.getStationMealCardForActor(mealActorId) : null;
    const isPlayerSubmitted = Boolean(card?.playerSubmitted);
    const choice = app._mealChoices?.get(mealActorId);
    const consumedDays = Array.isArray(choice?.consumedDays) ? choice.consumedDays : [];

    const totalDays = app._daysSinceLastRest ?? app._engine?.durationDays ?? 1;
    const allDaysDone = consumedDays.length >= totalDays;
    if (!isSubmitted && !isPlayerSubmitted && !allDaysDone) return null;

    // Collect all consumed items from consumedDays, or fall back to choice.food/water
    const sourceDays = consumedDays.length > 0
        ? consumedDays
        : [{ food: choice?.food ?? [], water: choice?.water ?? [], essence: choice?.essence ?? [] }];

    const foodItemIds = [];
    const waterItemIds = [];
    for (const day of sourceDays) {
        for (const fid of (day.food ?? [])) {
            if (fid && fid !== "skip") foodItemIds.push(fid);
        }
        for (const wid of (day.water ?? [])) {
            if (wid && wid !== "skip") waterItemIds.push(wid);
        }
    }

    const resolveItemName = (id) => {
        if (!id) return "";
        if (id.startsWith?.("__")) {
            return id === "__feast" ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.feast") : id.replace(/^__/, "");
        }
        const item = actor.items.get(id);
        if (item?.name) return item.name;
        const opt = (card?.foodOptions ?? []).find(o => o.value === id)
            ?? (card?.waterOptions ?? []).find(o => o.value === id);
        return opt?.name ?? game.i18n.localize("ionrift-respite.restPrepare.sustenance.ration");
    };

    const defaultFoodImg = "icons/consumables/food/bread-loaf-round-white.webp";
    const defaultWaterImg = "icons/magic/water/water-drop-swirl-blue.webp";
    const resolveItemImg = (id, type) => {
        if (!id) return type === "water" ? defaultWaterImg : defaultFoodImg;
        if (id === "__feast") return "icons/consumables/food/platter-roasted-turkey-garnish-brown.webp";
        const item = actor.items.get(id);
        if (item?.img && !item.img.includes("mystery-man")) return item.img;
        const opt = (card?.foodOptions ?? []).find(o => o.value === id)
            ?? (card?.waterOptions ?? []).find(o => o.value === id);
        if (opt?.icon && !opt.icon.includes("mystery-man")) return opt.icon;
        return type === "water" ? defaultWaterImg : defaultFoodImg;
    };

    const extractItemBuffSummary = (id) => {
        if (!id || id.startsWith?.("__")) return "";
        const item = actor.items.get(id);
        return describeItemMealBuff(item?.flags?.[MODULE_ID]).buffSummary;
    };

    const itemMap = new Map();
    for (const fid of foodItemIds) {
        if (!fid || fid === "skip") continue;
        if (!itemMap.has(fid)) {
            const name = resolveItemName(fid);
            const img = resolveItemImg(fid, "food");
            const buffSummary = extractItemBuffSummary(fid);
            itemMap.set(fid, {
                id: fid,
                name,
                img,
                count: 0,
                type: "food",
                buffSummary,
                hasBuff: Boolean(buffSummary)
            });
        }
        itemMap.get(fid).count++;
    }

    for (const wid of waterItemIds) {
        if (!wid || wid === "skip") continue;
        if (!itemMap.has(wid)) {
            const name = resolveItemName(wid);
            const img = resolveItemImg(wid, "water");
            const buffSummary = extractItemBuffSummary(wid);
            itemMap.set(wid, {
                id: wid,
                name,
                img,
                count: 0,
                type: "water",
                buffSummary,
                hasBuff: Boolean(buffSummary)
            });
        }
        itemMap.get(wid).count++;
    }

    const items = [...itemMap.values()].map(item => ({
        ...item,
        qtyLabel: item.type === "water" ? `${item.count} pt` : (item.count > 1 ? `×${item.count}` : null)
    }));

    const primaryImg = items.find(i => i.type === "food")?.img
        ?? items.find(i => i.type === "water")?.img
        ?? null;

    let sendoffItemName = "";
    let sendoffBuffSummary = "";

    // 1. Check consumed items for explicit buffs
    for (const item of items) {
        if (item.hasBuff && item.buffSummary) {
            sendoffItemName = item.name;
            sendoffBuffSummary = item.buffSummary;
            break;
        }
    }

    // 2. Check actor's active effects for Well Fed
    if (!sendoffBuffSummary) {
        const wellFedEffect = actor.effects?.find(e => e.flags?.[MODULE_ID]?.wellFed === true);
        if (wellFedEffect) {
            sendoffItemName = items.find(i => i.type === "food")?.name ?? "Meal";
            sendoffBuffSummary = wellFedEffect.name || "Well Fed: +5 Temp HP & Advantage on Initiative";
        }
    }

    const sendoff = sendoffBuffSummary
        ? { hasBuff: true, itemName: sendoffItemName, buffSummary: sendoffBuffSummary }
        : { hasBuff: false, text: "Sates only (No buff into the next day)." };

    const countMap = (arr) => {
        const map = new Map();
        for (const id of arr) {
            const name = resolveItemName(id);
            if (!name) continue;
            map.set(name, (map.get(name) ?? 0) + 1);
        }
        return [...map.entries()].map(([name, count]) => count > 1 ? `${name} ×${count}` : name);
    };

    const foodNames = countMap(foodItemIds);
    const waterNames = countMap(waterItemIds);

    const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
    const mealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? { foodPerDay: MEAL_DEFAULTS.foodPerDay, waterPerDay: MEAL_DEFAULTS.waterPerDay };
    const totalFpd = (mealRules.foodPerDay ?? 1) * (consumedDays.length || 1);
    const totalWpd = (mealRules.waterPerDay ?? MEAL_DEFAULTS.waterPerDay) * (consumedDays.length || 1);

    let bonusWater = 0;
    const satiatesLookup = typeof app._stations?._buildSatiatesLookup === "function"
        ? app._stations._buildSatiatesLookup()
        : (typeof app._activityStations?._buildSatiatesLookup === "function" ? app._activityStations._buildSatiatesLookup() : null);
    for (const fid of foodItemIds) {
        if (!fid || fid === "skip" || fid.startsWith?.("__")) continue;
        const fItem = actor.items.get(fid);
        let fSat = fItem?.flags?.[MODULE_ID]?.satiates;
        if (!Array.isArray(fSat) && satiatesLookup && fItem?.name) {
            fSat = satiatesLookup.get(fItem.name.toLowerCase().trim()) ?? null;
        }
        if (Array.isArray(fSat) && fSat.includes("water")) bonusWater++;
    }

    const isFed = foodItemIds.length >= totalFpd;
    const effectiveWater = waterItemIds.length + bonusWater;
    const isHydrated = effectiveWater >= totalWpd;

    let title = totalDays > 1 ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.restRations") : game.i18n.localize("ionrift-respite.restPrepare.sustenance.nightsRations");
    if (!isFed && !isHydrated) {
        title = game.i18n.localize("ionrift-respite.restPrepare.sustenance.fasting");
    } else if (!isFed) {
        title = game.i18n.localize("ionrift-respite.restPrepare.sustenance.waterOnly");
    } else if (!isHydrated) {
        title = game.i18n.localize("ionrift-respite.restPrepare.sustenance.foodOnly");
    }

    const detail = (isFed && isHydrated)
        ? (sendoff.hasBuff ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.satedBuff") : game.i18n.localize("ionrift-respite.restPrepare.sustenance.sated"))
        : (!isFed && !isHydrated)
            ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.starvingDehydrated")
            : !isFed
                ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.fastingSave")
                : game.i18n.localize("ionrift-respite.restPrepare.sustenance.waterDeficit");

    return {
        kicker: game.i18n.localize("ionrift-respite.restPrepare.sustenance.kicker"),
        title,
        detail,
        isFed,
        isHydrated,
        waterShortLabel: game.i18n.format("ionrift-respite.restPrepare.sustenance.shortPints", { count: Math.max(0, totalWpd - effectiveWater) }),
        items,
        primaryImg,
        sendoff,
        buff: sendoff.hasBuff ? sendoff.buffSummary : null
    };
}

