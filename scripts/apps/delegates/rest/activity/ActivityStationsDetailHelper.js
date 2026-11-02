import { Logger } from "../../../../utils/Logger.js";
import { CopySpellHandler } from "../../../../services/crafting/outcomes/CopySpellHandler.js";
import { MealPhaseHandler } from "../../../../services/meal/phase/MealPhaseHandler.js";
import { enqueueProvision } from "../../../../services/meal/buffs/MealBuffBeat.js";
import {
    evaluateDayRations,
    rationSkipLines,
    restTerrainMealRules,
    restTerrainTag
} from "../../../../services/meal/phase/RationNeed.js";
import {
    activateStationLayer,
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationDetectMagicGlow,
    refreshStationMealPortraits,
    refreshStationPortraitsFromChoices,
    resetStationOverlaysLocal,
    setStationPlayerState
} from "../../../../services/camp/props/StationInteractionLayer.js";
import {
    refreshOpenStationDialog,
    notifyStationMealChoicesUpdated,
    StationActivityDialog
} from "../../../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import {
    getStationsForTerrain,
    buildPartyState,
    isWorkbenchExamineUiEnabled,
    getStationOfferedActivityIds,
    inferCanvasStationForActivity
} from "../../../../data/RestConstants.js";
import { isGearDeployed } from "../../../../services/camp/props/CompoundCampPlacer.js";
import { isSimpleRestProfile, isSimpleStationsMode } from "../../../../services/rest/flow/RestProfileSettings.js";
import { CraftingPickerApp } from "../../../crafting/CraftingPickerApp.js";
import {
    collectPartyIdentifyEmbedData,
    computeCanShowDetectMagicScanButton,
    computeCanTriggerDetectMagicScan
} from "../../crafting/DetectMagicDelegate.js";
import {
    emitRestSnapshot,
    emitActivityChoice,
    emitCopySpellProposal,
    emitSubmissionUpdate,
    emitSocketMessage
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { _refreshGmRestIndicator, _refreshRejoinBar } from "../../../../module.js";
import { _noteEngineFreePath } from "../../../rest/RestSetupApp.js";
import { MODULE_ID } from "../../../../data/moduleId.js";
import { activityFocusAfterCommit, publishCampProgress } from "../../../../services/rest/session/campProgressState.js";
import { getFletchingTier, getFletchingTierLabel } from "../../../../services/crafting/settings/FletchingSettings.js";

export const ActivityStationsDetailMethods = {
    async attuneWorkbenchItemForActor(actorId, itemId) {
        const app = this._app;

        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) return;
        const item = actor.items.get(itemId);
        if (!item) return;
        const att = item.system?.attunement;
        if ((att !== "required" && att !== 1) || item.system?.attuned) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.activityStations.cannotAttuneHere"));
            return;
        }
        const attuneSlots = actor.system?.attributes?.attunement;
        if (attuneSlots) {
            const current = attuneSlots.value ?? 0;
            const max = attuneSlots.max ?? 3;
            if (current >= max) {
                ui.notifications.warn(game.i18n.format("ionrift-respite.activityStations.alreadyAttunedMax", { actor: actor.name, max }));
                return;
            }
        }
        try {
            await item.update({ "system.attuned": true });
            ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.attunesToItem", { actor: actor.name, item: item.name }));
        } catch (e) {

            console.warn(`${MODULE_ID} | attuneWorkbenchItemForActor:`, e);
            ui.notifications.error(game.i18n.localize("ionrift-respite.activityStations.couldNotAttune"));
            return;
        }
        if (app.rendered) app.render();
    
    },

    async submitActivityMealRationsFromStation(actorId) {
        const app = this._app;

        if (!actorId) return;
        _noteEngineFreePath("submitActivityMealRationsFromStation", app);
        const actor = game.actors.get(actorId);
        if (!actor) return;

        if (app._isGM) {
            if (app._activityMealRationsSubmitted?.has(actorId)) return;
            const choice = app._mealChoices?.get(actorId) ?? {};
            const satiatesLookup = this._buildSatiatesLookup();
            const mealRules = restTerrainMealRules(app);
            const owed = evaluateDayRations(actor, choice, mealRules, satiatesLookup);
            const skippedSlots = rationSkipLines(actor, choice, mealRules, satiatesLookup);
            if (skippedSlots.length > 0) {
                const confirmed = await new Promise(resolve => {
                    const overlay = document.createElement("div");
                    overlay.classList.add("ionrift-armor-modal-overlay");
                    overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> ${game.i18n.localize("ionrift-respite.activityStations.skipMealsTitle")}</h3>
                        <p>${game.i18n.localize("ionrift-respite.activityStations.emptyMealsPrompt")}</p>
                        <ul>${skippedSlots.map(s => `<li>${s}</li>`).join("")}</ul>
                        <p>${game.i18n.localize("ionrift-respite.activityStations.skipConsequences")}</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> ${game.i18n.localize("ionrift-respite.activityStations.skipMealsConfirm")}</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> ${game.i18n.localize("ionrift-respite.activityStations.skipMealsCancel")}</button>
                        </div>
                    </div>`;
                    document.body.appendChild(overlay);
                    overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                        overlay.remove();
                        resolve(true);
                    });
                    overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                        overlay.remove();
                        resolve(false);
                    });
                });
                if (!confirmed) return;
            }

            // Consume items immediately and apply Well Fed buffs
            // (matches inventory consumption path for parity)
            const food = Array.isArray(choice.food) ? [...choice.food] : [];
            const water = Array.isArray(choice.water) ? [...choice.water] : [];
            const essence = Array.isArray(choice.essence) ? [...choice.essence] : [];

            // Snapshot food items before consumption for Well Fed resolution
            const foodSnapshots = new Map();
            for (const itemId of food) {
                if (itemId && itemId !== "skip") {
                    const item = actor.items.get(itemId);
                    if (item) foodSnapshots.set(itemId, item.toObject(false));
                }
            }

            const partyIds = app._mealChoices ? [...app._mealChoices.keys()] : [actorId];
            let foodLeft = owed.foodPerDay;
            for (const itemId of food) {
                if (foodLeft <= 0) break;
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    const snapshot = foodSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        foodLeft--;
                        app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                            actorId, actorName: actor.name, kind: "food", partyIds
                        });
                    }
                }
            }
            const drinkSnapshots = new Map();
            for (const itemId of water) {
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const item = actor.items.get(itemId);
                    if (item) drinkSnapshots.set(itemId, item.toObject(false));
                }
            }
            const waterToConsume = Math.max(0, owed.waterPerDay - owed.bonusWater);
            let waterConsumed = 0;
            for (const itemId of water) {
                if (waterConsumed >= waterToConsume) break;
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    waterConsumed++;
                    const snapshot = drinkSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                            actorId, actorName: actor.name, kind: "drink", partyIds
                        });
                    }
                }
            }
            for (const itemId of essence) {
                if (itemId && itemId !== "skip") {
                    await MealPhaseHandler._consumeItem(actor, itemId, 1);
                }
            }

            // Fold selections into consumedDays so processAndApply won't
            // re-consume them during the meal phase resolution
            const consumedDays = Array.isArray(choice.consumedDays) ? [...choice.consumedDays] : [];
            consumedDays.push({ food, water, essence, bonusWater: owed.bonusWater });
            app._mealChoices.set(actorId, {
                ...choice,
                consumedDays,
                currentDay: consumedDays.length,
                food: [],
                water: [],
                essence: [],
                itemsConsumed: true,
                // Preserve locked slots for UI state
                foodLockedSlots: choice.foodLockedSlots ?? [],
                waterLockedSlots: choice.waterLockedSlots ?? []
            });

            if (!app._activityMealRationsSubmitted) app._activityMealRationsSubmitted = new Set();
            app._activityMealRationsSubmitted.add(actorId);
            app.checkAndAutoMarkCharacterReady?.(actorId);
            await app._saveRestState();
            const snapshot = app.getRestSnapshot();
            if (snapshot) {
                emitRestSnapshot(snapshot);
            }
            notifyStationMealChoicesUpdated();
            if (isStationLayerActive()) {
                refreshStationEmptyNoticeFade(app);
                this._refreshStationOverlayMeals();
            }
            if (app.rendered) app.render();
            _refreshGmRestIndicator(app);
            ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.rationsRecorded", { actor: actor.name }));
            return;
        }

        if (!app._myCharacterIds?.has(actorId)) return;
        await app._meals.onSubmitStationMealChoices(actorId);
        app.checkAndAutoMarkCharacterReady?.(actorId);
        notifyStationMealChoicesUpdated();
        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            this._refreshStationOverlayMeals();
        }
        if (app.rendered) app.render();
        _refreshRejoinBar(app);
    
    },

    async unlockSustenance(actorId) {
        const app = this._app;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!app._isGM && !app._myCharacterIds?.has(actorId)) return;

        // 1. Remove character ready state if set
        if (app._finishedActorIds?.has(actorId)) {
            app._finishedActorIds.delete(actorId);
            publishCampProgress(app, {
                finishedActorId: actorId,
                finished: false
            });
        }

        // 2. Remove from submitted set
        if (app._activityMealRationsSubmitted?.has(actorId)) {
            app._activityMealRationsSubmitted.delete(actorId);
        }
        app._mealBuffQueue = (app._mealBuffQueue ?? []).filter(row => row.applied || row.actorId !== actorId);
        if (!app._isGM && app._mealSubmitted) {
            app._mealSubmitted = false;
        }

        // 3. Restore draft state from consumedDays if present
        const choice = app._mealChoices?.get(actorId);
        if (choice && Array.isArray(choice.consumedDays) && choice.consumedDays.length > 0) {
            const consumedDays = [...choice.consumedDays];
            const lastDay = consumedDays.pop();

            // Refund consumed items back to actor inventory if GM consumed them
            if (app._isGM && choice.itemsConsumed) {
                await MealPhaseHandler._removeWellFedEffects(actor);

                for (const itemId of (lastDay.food ?? [])) {
                    if (!itemId || itemId === "skip" || itemId.startsWith("__")) continue;
                    const item = actor.items.get(itemId);
                    if (item) {
                        const uses = item.system?.uses;
                        const isV5 = uses && ("spent" in uses);
                        if (isV5 && typeof uses.spent === "number" && uses.spent > 0) {
                            await item.update({ "system.uses.spent": Math.max(0, uses.spent - 1) });
                        } else if (uses && typeof uses.value === "number" && uses.max > 0) {
                            await item.update({ "system.uses.value": Math.min(uses.max, uses.value + 1) });
                        } else {
                            await item.update({ "system.quantity": (item.system?.quantity ?? 1) + 1 });
                        }
                    }
                }

                for (const itemId of (lastDay.water ?? [])) {
                    if (!itemId || itemId === "skip" || itemId.startsWith("__")) continue;
                    const item = actor.items.get(itemId);
                    if (item) {
                        const uses = item.system?.uses;
                        const isV5 = uses && ("spent" in uses);
                        if (isV5 && typeof uses.spent === "number" && uses.spent > 0) {
                            await item.update({ "system.uses.spent": Math.max(0, uses.spent - 1) });
                        } else if (uses && typeof uses.value === "number" && uses.max > 0) {
                            await item.update({ "system.uses.value": Math.min(uses.max, uses.value + 1) });
                        } else {
                            await item.update({ "system.quantity": (item.system?.quantity ?? 1) + 1 });
                        }
                    }
                }
            }

            app._mealChoices.set(actorId, {
                ...choice,
                consumedDays,
                currentDay: Math.max(0, consumedDays.length),
                food: lastDay.food ?? [],
                water: lastDay.water ?? [],
                essence: lastDay.essence ?? [],
                itemsConsumed: false,
                foodLockedSlots: choice.foodLockedSlots ?? [],
                waterLockedSlots: choice.waterLockedSlots ?? []
            });
        }

        await app._saveRestState?.();
        const snapshot = app.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
        notifyStationMealChoicesUpdated();
        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            this._refreshStationOverlayMeals();
        }
        if (app.rendered) app.render();
        _refreshGmRestIndicator(app);
        _refreshRejoinBar(app);
        ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.sustenanceUnlocked", { actor: actor.name }));
    },

    _buildActivityDetailContext(selectedCharacter) {
        const app = this._app;

        if (!app._activityDetailId || !selectedCharacter) return null;

        // Find the tile from the selected character's tiles (search both flat and station views)
        const allTiles = [
            ...(selectedCharacter.tileCategories?.flatMap(c => c.tiles) ?? []),
            ...(selectedCharacter.stationCards?.flatMap(s => s.tiles) ?? []),
            ...(selectedCharacter.professionTiles ?? [])
        ];
        const tile = allTiles.find(t => t.id === app._activityDetailId);
        if (!tile) return null;

        const outcomeHints = [];
        if (tile.outcomes?.success?.effects?.length) {
            for (const eff of tile.outcomes.success.effects) {
                outcomeHints.push({ text: eff.description, type: "success" });
            }
        }
        if (tile.outcomes?.exceptional?.effects?.length) {
            for (const eff of tile.outcomes.exceptional.effects) {
                outcomeHints.push({ text: eff.description, type: "exceptional" });
            }
        }
        if (tile.outcomes?.failure?.effects?.length) {
            for (const eff of tile.outcomes.failure.effects) {
                outcomeHints.push({ text: eff.description, type: "failure" });
            }
        }

        let followUpData = null;
        if (tile.followUp) {
            const currentValue = app._getFollowUpForCharacter(selectedCharacter.id)
                ?? app._gmFollowUps?.get(selectedCharacter.id) ?? null;
            followUpData = {
                type: tile.followUp.type,
                label: tile.followUp.label,
                currentValue
            };

            if (tile.followUp.type === "partyMember") {
                const partyActors = getPartyActors().filter(a => a.id !== selectedCharacter.id);
                followUpData.options = partyActors.sort((a, b) => {
                    const aRatio = a.system.attributes?.hp?.value / a.system.attributes?.hp?.max;
                    const bRatio = b.system.attributes?.hp?.value / b.system.attributes?.hp?.max;
                    return aRatio - bRatio;
                }).map(a => {
                    const hp = a.system.attributes?.hp;
                    const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
                    return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
                });
            } else if (tile.followUp.type === "radio" || tile.followUp.type === "select") {
                const selectedVal = currentValue || tile.followUp.default || tile.followUp.options?.[0]?.value;

                // Copy Spell: enrich options with gold awareness
                if (tile.id === "act_scribe") {
                    const actor = game.actors.get(selectedCharacter.id);
                    const currentGold = actor?.system?.currency?.gp ?? 0;
                    followUpData.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;

                    followUpData.options = tile.followUp.options.map(opt => {
                        const cost = parseInt(opt.value, 10) * 50;
                        const canAfford = currentGold >= cost;
                        return {
                            ...opt,
                            label: canAfford ? opt.label : game.i18n.format("ionrift-respite.activityStations.cantAffordOption", { label: opt.label }),
                            isSelected: opt.value === selectedVal,
                            isDisabled: !canAfford
                        };
                    });
                } else {
                    followUpData.options = tile.followUp.options.map(opt => ({
                        ...opt,
                        isSelected: opt.value === selectedVal
                    }));
                }

                // Safety net: if somehow no option is selected, force-select the first
                if (followUpData.options?.length && !followUpData.options.some(o => o.isSelected)) {
                    followUpData.options[0].isSelected = true;
                }
            } else if (tile.followUp.type === "actorItem" && tile.followUp.filter === "attuneable") {
                const actor = game.actors.get(selectedCharacter.id);
                const attuneItems = (actor?.items ?? []).filter(i => {
                    const att = i.system?.attunement;
                    // Requires attunement but NOT currently attuned
                    return (att === "required" || att === 1) && !i.system?.attuned;
                });
                followUpData.options = attuneItems.map(i => ({
                    value: i.id,
                    label: i.name,
                    isSelected: i.id === currentValue
                }));
                // Attunement slot counter
                const attunement = actor?.system?.attributes?.attunement;
                if (attunement) {
                    const current = attunement.value ?? 0;
                    const max = attunement.max ?? 3;
                    followUpData.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
                }
            }
        }

        // Build armor-aware hint (gated by Xanathar's rest rules setting; omitted for safe rest spot)
        let armorHint = null;
        let armorWarning = null;
        if (!app._effectiveSafeRestSpot()) {
            try {
                const armorRuleEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
                if (armorRuleEnabled) {
                    const actorForHint = game.actors.get(selectedCharacter.id);
                    const equippedArmor = actorForHint?.items?.find(i => i.type === "equipment" && i.system?.equipped && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type));
                    if (equippedArmor && tile.armorSleepWaiver) {
                        armorHint = { text: game.i18n.localize("ionrift-respite.activityStations.armorSleepWaiverHint"), type: "positive" };
                    } else if (equippedArmor && !tile.armorSleepWaiver) {
                        armorHint = { text: game.i18n.localize("ionrift-respite.activityStations.armorSleepPenaltyHint"), type: "warning" };
                    }
                }
            } catch (e) { /* setting may not exist yet */ }

            const actor = game.actors.get(selectedCharacter.id);
            armorWarning = app.getArmorWarningForActivityDetail(actor, tile);
        }

        return {
            id: tile.id,
            name: tile.name,
            description: tile.description || game.i18n.localize("ionrift-respite.activityStations.noAdditionalDetails"),
            icon: tile.icon,
            typeTag: tile.typeTag,
            isCrafting: tile.isCrafting,
            profession: tile.profession,
            check: tile.check ? app._formatCheckLabel(tile.check, selectedCharacter) : null,
            outcomeHints,
            combatModifiers: tile.combatModifiers,
            followUpData,
            armorHint,
            armorWarning,
            characterId: selectedCharacter.id
        };
    
    },

    _buildArmorWarningForActor(a) {
        const app = this._app;

        if (!a) return null;
        if (app._effectiveSafeRestSpot()) return null;
        try {
            const armorDoffEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
            if (!armorDoffEnabled) return null;
            if (!app._doffedArmor) app._doffedArmor = new Map();
            const doffedItemId = app._doffedArmor.get(a.id);

            const equippedArmor = a.itemTypes?.equipment?.find(i =>
                i.system?.equipped && i.system?.type?.value === "heavy"
            ) ?? a.itemTypes?.equipment?.find(i =>
                i.system?.equipped && i.system?.type?.value === "medium"
            );

            if (equippedArmor) {
                const armorType = equippedArmor.system?.type?.value;
                const donTime = armorType === "heavy" ? "10 min" : "5 min";
                return {
                    type: armorType,
                    name: equippedArmor.name,
                    itemId: equippedArmor.id,
                    actorId: a.id,
                    isDoffed: false,
                    donTime,
                    hint: game.i18n.format("ionrift-respite.activityStations.armorEquippedHint", { name: equippedArmor.name, type: armorType, donTime })
                };
            }
            if (doffedItemId) {
                const doffedItem = a.items.get(doffedItemId);
                if (doffedItem) {
                    const armorType = doffedItem.system?.type?.value ?? "medium";
                    const donTime = armorType === "heavy" ? "10 min" : "5 min";
                    return {
                        type: armorType,
                        name: doffedItem.name,
                        itemId: doffedItemId,
                        actorId: a.id,
                        isDoffed: true,
                        donTime,
                        hint: game.i18n.format("ionrift-respite.activityStations.armorDoffedHint", { name: doffedItem.name, donTime })
                    };
                }
            }
            const inventoryArmor = a.itemTypes?.equipment?.find(i =>
                !i.system?.equipped && i.system?.type?.value === "heavy"
            ) ?? a.itemTypes?.equipment?.find(i =>
                !i.system?.equipped && i.system?.type?.value === "medium"
            );
            if (inventoryArmor) {
                const armorType = inventoryArmor.system?.type?.value;
                const donTime = armorType === "heavy" ? "10 min" : "5 min";
                return {
                    type: armorType,
                    name: inventoryArmor.name,
                    itemId: inventoryArmor.id,
                    actorId: a.id,
                    isDoffed: true,
                    donTime,
                    hint: game.i18n.format("ionrift-respite.activityStations.armorInventoryHint", { name: inventoryArmor.name, donTime })
                };
            }
        } catch (e) { /* setting may not exist yet */ }
        return null;
    
    },

    getCampGearFlavorPanelForActor(actorId) {
        const app = this._app;

        if (!app.isCampfireStationFlavorOnly()) return null;
        const gearCtx = this.getCampGearContextForActor(actorId);
        if (!gearCtx) return null;
        const g = gearCtx;
        const slot = (def) => ({
            gearType: def.gearType,
            title: def.title,
            icon: def.icon,
            actorId: g.actorId,
            isMissing: !def.owned,
            isPlaced: def.owned && def.deployed,
            canDrag: def.owned && def.canDrag,
            isReadonlyOwned: def.owned && !def.canDrag && !def.deployed,
            flavorLine: def.owned ? def.ownedLine : def.missingLine
        });
        return {
            gearSlots: [
                slot({
                    gearType: "bedroll",
                    title: game.i18n.localize("ionrift-respite.activityStations.gearBedroll"),
                    icon: "fas fa-bed",
                    owned: g.hasBedroll,
                    deployed: g.bedrollDeployed,
                    canDrag: g.canDragBedroll,
                    ownedLine: game.i18n.localize("ionrift-respite.activityStations.gearBedrollOwned"),
                    missingLine: game.i18n.localize("ionrift-respite.activityStations.gearMissing")
                }),
                slot({
                    gearType: "tent",
                    title: game.i18n.localize("ionrift-respite.activityStations.gearTent"),
                    icon: "fas fa-campground",
                    owned: g.hasTent,
                    deployed: g.tentDeployed,
                    canDrag: g.canDragTent,
                    ownedLine: game.i18n.localize("ionrift-respite.activityStations.gearTentOwned"),
                    missingLine: game.i18n.localize("ionrift-respite.activityStations.gearMissing")
                }),
                slot({
                    gearType: "messkit",
                    title: g.messKitSource === "utensils" ? game.i18n.localize("ionrift-respite.activityStations.gearCooksUtensils") : game.i18n.localize("ionrift-respite.activityStations.gearMessKit"),
                    icon: g.messKitSource === "utensils" ? "fas fa-mortar-pestle" : "fas fa-utensils",
                    owned: g.hasMessKit,
                    deployed: g.messKitDeployed,
                    canDrag: g.canDragMessKit,
                    ownedLine: game.i18n.localize("ionrift-respite.activityStations.gearMessKitOwned"),
                    missingLine: game.i18n.localize("ionrift-respite.activityStations.gearMissing")
                })
            ]
        };
    
    },

    getCampGearContextForActor(actorId) {
        const app = this._app;

        if (app._phase !== "activity" || !actorId) return null;
        const a = game.actors.get(actorId);
        if (!a) return null;
        const items = a.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
        const hasBedroll = items.some(n => n.includes("bedroll"));
        const hasTent = items.some(n => /(?:^|[\s,\-])tent\b/i.test(n));
        const hasActualMessKit = items.some(n => n.includes("mess kit"));
        const hasCooksUtensils = items.some(n => n.includes("cook") && n.includes("utensil"));
        const hasMessKit = hasActualMessKit || hasCooksUtensils;
        /** @type {"messkit"|"utensils"|null} */
        const messKitSource = hasActualMessKit ? "messkit" : (hasCooksUtensils ? "utensils" : null);
        const isOwner = !!a.isOwner;
        const canDragUser = app._isGM || isOwner;
        const fireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
        const tentDeployed = isGearDeployed(a.id, "tent");
        const bedrollDeployed = isGearDeployed(a.id, "bedroll");
        const messKitDeployed = isGearDeployed(a.id, "messkit");
        const hasDeployedCampGear = tentDeployed || bedrollDeployed || messKitDeployed;
        const exhaustionRisk = false;
        const canDragBedroll = canDragUser && hasBedroll && !bedrollDeployed;
        const canDragTent = canDragUser && hasTent && !tentDeployed;
        const canDragMessKit = canDragUser && hasMessKit && !messKitDeployed;
        const canDrag = canDragBedroll || canDragTent || canDragMessKit;
        return {
            actorId: a.id,
            actorName: a.name,
            actorImg: a.img || "icons/svg/mystery-man.svg",
            hasBedroll,
            hasTent,
            hasMessKit,
            messKitSource,
            bedrollDeployed,
            tentDeployed,
            messKitDeployed,
            canDrag,
            canDragBedroll,
            canDragTent,
            canDragMessKit,
            isOwner,
            showClearOwnGear: !app._isGM && isOwner && hasDeployedCampGear,
            fireIsLit,
            exhaustionRisk,
            sceneHasDroppables: hasTent || hasBedroll || hasMessKit,
            ["messAdvantage" + "Off"]: hasMessKit && !fireIsLit && exhaustionRisk
        };
    
    },

    onOpenCrafting(event, target) {
        const app = this._app;

        const characterId = target.dataset.characterId || app._selectedCharacterId;
        const profession = target.dataset.profession || app._totmFollowUpExpanded?.profession || "cooking";
        if (!characterId || !profession) return;

        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? null;
        const actor = game.actors.get(characterId);
        if (!actor) return;

        if (app._lockedCharacters?.has(characterId) || app.hasCompletedCrafting(characterId, profession)) {
            const priorResult = app._craftingResults?.get(characterId);
            if (priorResult) {
                const picker = new CraftingPickerApp(
                    actor, profession, app._craftingEngine,
                    () => { if (app.rendered) app.render(); },
                    terrainTag,
                    app._grantLedger,
                    { restApp: app }
                );
                picker._craftingResult = priorResult;
                picker._hasCrafted = true;
                picker.render(true);
                return;
            }
            ui.notifications.warn(game.i18n.localize("ionrift-respite.activityStations.alreadyCraftedRest"));
            return;
        }

        if (!app._craftingInProgress) app._craftingInProgress = new Set();
        app._craftingInProgress.add(characterId);
        app._pendingSelections?.delete(characterId);
        if (app.rendered) app.render();

        // Open the standalone crafting picker window
        const picker = new CraftingPickerApp(
            actor, profession, app._craftingEngine,
            (result) => {
                // Completion callback: commit the crafting result
                app._craftingInProgress?.delete(characterId);
                if (!result) {
                    // Crafting cancelled or no result - re-enable selection
                    if (app.rendered) app.render();
                    return;
                }
                app._craftingResults.set(characterId, result);

                // Find the matching crafting activity to record the choice
                const resolver = app._activityResolver;
                const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                    a => a.crafting?.profession === profession
                ) : null;
                const activityId = craftAct?.id ?? `act_cook`;

                app._lockedCharacters = app._lockedCharacters ?? new Set();
                app._lockedCharacters.add(characterId);
                app._totmFollowUpExpanded = null;
                app._characterChoices.set(characterId, activityId);

                if (app._isGM) {
                    app._gmOverrides.set(characterId, activityId);
                    app._rebuildCharacterChoices?.();
                    const submissions = {};
                    for (const [charId, actId] of app._characterChoices) {
                        const act = resolver?.activities?.get(actId);
                        submissions[charId] = {
                            activityId: actId,
                            activityName: act?.name ?? actId,
                            source: app._gmOverrides.has(charId) ? "gm" : "player"
                        };
                    }
                    emitSocketMessage({ type: "submissionUpdate", submissions });
                } else {
                    emitSocketMessage({
                        type: "activityChoice",
                        userId: game.user.id,
                        choices: Object.fromEntries(app._characterChoices),
                        craftingResults: { [characterId]: result }
                    });
                    ui.notifications.info(game.i18n.format("ionrift-respite.activityStations.activitySubmitted", { actor: actor.name }));
                }
                app._saveRestState?.();
                if (app.rendered) app.render();
            },
            terrainTag,
            app._grantLedger,
            { restApp: app }
        );
        picker.render({ force: true });
    
    },

    _applyAutoOtherWhenSoleActivity() {
        const app = this._app;

        if (app._phase !== "activity" || !app._isGM) return false;

        const forceOtherForAll = isSimpleRestProfile();
        const isTavern = app._isTavernTerrain();
        const partyActors = getPartyActors();
        if (!partyActors.length) return false;

        const restType = app._engine?.restType ?? "long";
        const resolverOpts = app._activityResolverOpts();
        const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
        const safeRestSpot = resolverOpts.safeRestSpot;
        const nonActivityStepIds = new Set(["act_forage", "act_hunt", "act_identify"]);

        let changed = false;
        for (const actor of partyActors) {
            if (app._characterChoices.has(actor.id)) {
                if (app._characterChoices.get(actor.id) === "act_other"
                    && app._lockedCharacters?.has(actor.id)
                    && !app._finishedActorIds?.has(actor.id)) {
                    app.checkAndAutoMarkCharacterReady?.(actor.id);
                }
                continue;
            }
            if (app._gmOverrides.has(actor.id)) continue;
            if (app._getPlayerChoiceForCharacter(actor.id)?.activityId) continue;

            const { available } = app._activityResolver.getAvailableActivitiesWithFaded(
                actor, restType, resolverOpts
            );
            const activityStepAvailable = available.filter(a => !nonActivityStepIds.has(a.id));

            let shouldAssign = false;
            if (forceOtherForAll) {
                shouldAssign = activityStepAvailable.some(a => a.id === "act_other");
            } else if (isTavern || app._isTotM) {
                const offered = getStationOfferedActivityIds(
                    terrainTag,
                    safeRestSpot,
                    new Set(activityStepAvailable.map(a => a.id)),
                    { simpleStations: isSimpleStationsMode() }
                );
                shouldAssign = offered.size === 1 && offered.has("act_other");
            } else {
                shouldAssign = activityStepAvailable.length === 1 && activityStepAvailable[0]?.id === "act_other";
            }

            if (!shouldAssign) continue;

            app._characterChoices.set(actor.id, "act_other");
            app._engine?.registerChoice(actor.id, "act_other", {});
            app._lockedCharacters.add(actor.id);
            if (!app._stationCanvasIdByCharacter) app._stationCanvasIdByCharacter = new Map();
            app._stationCanvasIdByCharacter.set(actor.id, "bedroll");
            app.checkAndAutoMarkCharacterReady?.(actor.id);
            changed = true;
        }

        if (!changed) return false;

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = {
                activityId: actId,
                activityName: act?.name ?? actId,
                source: forceOtherForAll || app._gmOverrides.has(charId) ? "gm" : "player"
            };
        }
        emitSubmissionUpdate(submissions);
        _refreshGmRestIndicator(app);

        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        return true;
    
    },

};
