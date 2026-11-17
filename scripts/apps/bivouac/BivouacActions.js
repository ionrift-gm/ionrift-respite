import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../utils/Logger.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { HitDieModifiers } from "../../services/rest/recovery/HitDieModifiers.js";
import { SustenanceEngine } from "../../services/rest/gritty/SustenanceEngine.js";
import { ItemClassifier } from "../../services/party/ItemClassifier.js";
import { EncounterDraftService } from "../../services/rest/gritty/EncounterDraftService.js";
import { CalendarHandler } from "../../services/rest/session/CalendarHandler.js";
import { setNativeShortRestUnsuppressed } from "../../services/rest/flow/NativeRestPass.js";
import {
    emitRestSessionDelta,
    emitRestSessionResolved,
    emitRestSessionAbandoned
} from "../../services/rest/session/RestSessionSync.js";
import { countActorFirewood, findConsumableFirewoodItem } from "../../services/camp/gear/CampGearScanner.js";
import { consumeItem } from "../../services/meal/inventory/MealItemConsumer.js";
import { confirmAbandonRest } from "../rest/confirmAbandonRest.js";
import {
    spawnDetectMagicCastRipple,
    purgeDetectMagicRestArtifacts
} from "../delegates/crafting/DetectMagicDelegate.js";
import { isWorkbenchIdentifyUiEnabled } from "../../data/RestConstants.js";

/**
 * Bivouac HUD Application.
 * Single-screen overnight management for Gritty Realism 8-hour short rests.
 */
export const BivouacActionMethods = {
    async onAbandonBivouac(_event, _target) {
        if (!this._isGM) return;

        const confirmed = await confirmAbandonRest({
            title: game.i18n.localize("ionrift-respite.bivouac.abandon.title"),
            message: game.i18n.localize("ionrift-respite.bivouac.abandon.message")
        });
        if (!confirmed) return;

        emitRestSessionAbandoned("bivouac");
        ui.notifications?.info?.(game.i18n.localize("ionrift-respite.bivouac.abandon.done"));
        this.close({ abandoned: true });
    },

    onToggleStance(event, target) {
        const stance = target.dataset.stance;
        const userId = game.user.id;
        const isGM = this._isGM;

        if (isGM) {
            this._campStanceManager.setStance(stance, userId, true);
            this._broadcastSync();
            this.render();
        } else {
            const { allowed } = this._campStanceManager.canToggle(userId, false);
            if (!allowed) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.bivouac.stanceCooldown"));
                return;
            }
            // Start the local cooldown too. Without this the player can spam
            // toggles that the GM then rejects, and the UI flips and reverts.
            this._campStanceManager.noteToggle(userId);
            emitRestSessionDelta("bivouac", "CAMP_STANCE", { stance });
        }
        this._saveSessionState();
    },

    onVolunteerChef(event, target) {
        if (!this._campStanceManager.cookingAllowed) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.bivouac.cookingDisabledColdDark"));
            return;
        }

        const actorId = target?.dataset?.actorId;
        const party = getPartyActors();
        const chefStatus = SustenanceEngine.getChefStatus(party, this._campStanceManager.stance);
        const chef = (actorId ? chefStatus.chefs?.find(c => c.actorId === actorId) : null) ?? chefStatus.leadChef;
        if (chef) {
            this._chefVolunteer = { ...chef };
        }

        if (this._isGM) {
            this._chefVolunteered = true;
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "VOLUNTEER_CHEF", {
                actorId: this._chefVolunteer?.actorId ?? actorId
            });
        }
        this._saveSessionState();
    },

    onOptOutChef(_event, _target) {
        if (this._isGM) {
            this._chefVolunteered = false;
            this._chefMealBonusByActor.clear();
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "OPTOUT_CHEF", {});
        }
        this._saveSessionState();
    },

    async onVolunteerSong(event, target) {
        const actorId = target?.dataset?.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (this._songVolunteer?.actorId === actorId) {
            this._songVolunteer = null;
        } else if (!this._songVolunteer) {
            const partyActors = getPartyActors();
            const bards = HitDieModifiers.scanAllEligibleBards(partyActors);
            const bardInfo = bards.find(b => b.actorId === actorId);
            if (!bardInfo) return;
            this._songVolunteer = { ...bardInfo };
        } else {
            return;
        }

        if (this._isGM) {
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "VOLUNTEER_SONG", {
                actorId: this._songVolunteer?.actorId ?? null
            });
        }
        this._saveSessionState();
    },

    async onClaimChefTreat(event, target) {
        const actorId = target?.dataset?.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (!this._chefVolunteered || !this._chefVolunteer) return;
        if (!this._campStanceManager.cookingAllowed) {
            ui.notifications?.warn?.(game.i18n.localize("ionrift-respite.bivouac.cookingNotPermittedCold"));
            return;
        }

        const claimedActorIds = new Set([
            ...this._chefMealBonusByActor.keys(),
            ...Array.from(this._plateChoices.entries()).filter(([_, choice]) => choice === "chef").map(([id]) => id)
        ]);

        if (claimedActorIds.has(actorId)) return;

        const capacity = this._chefVolunteer.mealCapacity ?? 4;
        if (claimedActorIds.size >= capacity) {
            ui.notifications?.warn?.(game.i18n.localize("ionrift-respite.bivouac.noChefServings"));
            return;
        }

        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (treatsProvideSustenance) {
            this._plateChoices.set(actorId, "chef");
        }

        const rolls = this._rolls.get(actorId) ?? [];
        const hasSpentHd = rolls.length > 0;

        const chefBonusRecord = {
            claimed: true,
            applied: false,
            chefName: this._chefVolunteer.chefName,
            total: 0,
            formula: "1d8",
        };

        if (hasSpentHd) {
            const appliedChefBonus = await HitDiceService.applyChefBonus(actor, this._chefVolunteer);
            if (appliedChefBonus) {
                chefBonusRecord.applied = true;
                chefBonusRecord.total = appliedChefBonus.total;
                chefBonusRecord.formula = appliedChefBonus.formula;
            }
        }

        this._chefMealBonusByActor.set(actorId, chefBonusRecord);

        if (this._isGM) {
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "CLAIM_CHEF_TREAT", {
                actorId,
                plateChoice: treatsProvideSustenance ? "chef" : null,
                chefBonus: chefBonusRecord
            });
        }
        this._saveSessionState();
    },

    async onClaimChefMealFromBadge(event, _target) {
        if (event?.target?.closest?.(".btn-chef-optout")) return;
        if (!this._chefVolunteered || !this._chefVolunteer) return;

        const party = getPartyActors();
        const candidate = party.find(a => (this._isGM ? true : a.isOwner) && !this._chefMealBonusByActor.has(a.id) && this._plateChoices.get(a.id) !== "chef");
        if (!candidate) {
            ui.notifications?.info?.(game.i18n.localize("ionrift-respite.bivouac.allHaveChefTreat"));
            return;
        }

        return BivouacActionMethods.onClaimChefTreat.call(this, event, { dataset: { actorId: candidate.id } });
    },

    async onSpendHitDie(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const spendResult = await HitDiceService.spendHitDie(actor);
        if (!spendResult) return;

        // Record roll locally
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        this._rolls.get(actorId).push({
            total: spendResult.adjustedTotal,
            die: spendResult.die,
            conMod: spendResult.conMod,
            annotations: spendResult.annotations
        });

        // Apply Song of Rest bonus if volunteered and not yet applied to this actor
        let appliedSongBonus = null;
        if (this._songVolunteer?.songDie && !this._songBonusByActor.has(actorId)) {
            appliedSongBonus = await HitDiceService.applySongBonus(actor, this._songVolunteer);
            if (appliedSongBonus) {
                this._songBonusByActor.set(actorId, appliedSongBonus);
            }
        }

        // Apply Chef bonus if volunteered and treat claimed (or chef fed), and not yet applied
        const existingChef = this._chefMealBonusByActor.get(actorId);
        const party = getPartyActors();
        const hasClaimedChef = (existingChef && !existingChef.applied) || (!existingChef && this._isActorChefFed(actorId, party));
        let appliedChefBonus = null;
        if (this._chefVolunteered && this._chefVolunteer && hasClaimedChef) {
            appliedChefBonus = await HitDiceService.applyChefBonus(actor, this._chefVolunteer);
            if (appliedChefBonus) {
                const record = {
                    claimed: true,
                    applied: true,
                    chefName: this._chefVolunteer.chefName,
                    total: appliedChefBonus.total,
                    formula: appliedChefBonus.formula
                };
                this._chefMealBonusByActor.set(actorId, record);
            }
        }

        // Apply Warm Camp bonus if enabled and stance is warm
        const fireWarmthSetting = game.settings.get(MODULE_ID, "shortRestFireWarmth") ?? "none";
        let appliedWarmthBonus = null;
        if (fireWarmthSetting !== "none" && this._campStanceManager?.isWarm) {
            appliedWarmthBonus = await HitDiceService.applyWarmthBonus(actor, fireWarmthSetting);
            if (appliedWarmthBonus) {
                spendResult.adjustedTotal += appliedWarmthBonus.total;
                spendResult.annotations = spendResult.annotations || [];
                spendResult.annotations.push(`+${appliedWarmthBonus.total} Warmth`);
            }
        }

        // Sync roll to GM if player-side
        if (!this._isGM) {
            emitRestSessionDelta("bivouac", "SPEND_HIT_DIE", {
                actorId,
                roll: {
                    total: spendResult.adjustedTotal,
                    die: spendResult.die,
                    conMod: spendResult.conMod,
                    annotations: spendResult.annotations
                },
                chefBonus: appliedChefBonus,
                songBonus: appliedSongBonus
            });
        }

        this._broadcastSync();
        this.render();
        this._saveSessionState();
    },

    async onSwapPlateFood(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const party = getPartyActors();
        const outlanderStatus = SustenanceEngine.scanOutlander(party, this._terrainTag);
        const options = [];

        // 1. Chef meal option (if Chef volunteered and treats provide sustenance)
        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (this._chefVolunteered && this._chefVolunteer && treatsProvideSustenance) {
            options.push({
                id: "chef",
                label: game.i18n.format("ionrift-respite.bivouac.plate.chefMeal", { chef: this._chefVolunteer.chefName })
            });
        }

        // 2. Outlander Wild Forage option (if Outlander eligible)
        if (outlanderStatus.isEligible) {
            options.push({
                id: "forage",
                label: game.i18n.format("ionrift-respite.bivouac.plate.wildForage", { name: outlanderStatus.outlanderActor?.name ?? game.i18n.localize("ionrift-respite.bivouac.plate.outlanderFallback") })
            });
        }

        // 3. Personal edible food items
        const personalEdible = (actor.items ?? []).filter(i => {
            if (!ItemClassifier.isFood(i, actor)) return false;
            if (ItemClassifier.isSpoiled(i)) return false;
            const flags = i.flags?.[MODULE_ID] ?? {};
            if (flags.chefTreat || flags.buff || flags.wellFedBuff || flags.magicFood) return false;
            return (i.system?.quantity ?? 1) > 0;
        });
        for (const item of personalEdible) {
            const qty = item.system?.quantity ?? 1;
            options.push({
                id: item.id,
                label: qty > 1 ? game.i18n.format("ionrift-respite.bivouac.plate.itemQuantity", { name: item.name, count: qty }) : `${item.name}`
            });
        }

        // 4. Fasting / Starve option
        options.push({
            id: "starve",
            label: game.i18n.localize("ionrift-respite.bivouac.plate.fast")
        });

        if (!options.length) return;

        // Current selection
        const currentChoice = this._plateChoices.get(actorId) ?? (
            this._isActorChefFed(actorId, party) ? "chef" :
            (outlanderStatus.isEligible ? "forage" :
            (personalEdible[0]?.id ?? "starve"))
        );

        let currentIndex = options.findIndex(o => o.id === currentChoice);
        if (currentIndex === -1) currentIndex = 0;

        const nextOption = options[(currentIndex + 1) % options.length];

        if (this._isGM) {
            this._plateChoices.set(actorId, nextOption.id);
            this._broadcastSync();
            this.render();
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        } else {
            emitRestSessionDelta("bivouac", "SWAP_PLATE", { actorId, itemId: nextOption.id });
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        }
        this._saveSessionState();
    },

    async onSwapPlateWater(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const options = [];

        // 1. Personal water items
        const personalWaters = (actor.items ?? []).filter(i => {
            if (!ItemClassifier.isWater(i, actor)) return false;
            if (ItemClassifier.isSpoiled(i)) return false;
            const qty = i.system?.quantity ?? 1;
            const uses = i.system?.uses?.value ?? (i.system?.uses?.max ? i.system?.uses.max - (i.system?.uses.spent ?? 0) : 1);
            return qty > 0 && uses > 0;
        });
        for (const item of personalWaters) {
            const qty = item.system?.quantity ?? 1;
            options.push({
                id: item.id,
                label: qty > 1 ? game.i18n.format("ionrift-respite.bivouac.plate.itemQuantity", { name: item.name, count: qty }) : `${item.name}`
            });
        }

        // 2. Dehydrated / Go Thirsty option
        options.push({
            id: "thirsty",
            label: game.i18n.localize("ionrift-respite.bivouac.plate.thirsty")
        });

        if (!options.length) return;

        // Current selection
        const currentChoice = this._waterChoices.get(actorId) ?? (
            personalWaters[0]?.id ?? "thirsty"
        );

        let currentIndex = options.findIndex(o => o.id === currentChoice);
        if (currentIndex === -1) currentIndex = 0;

        const nextOption = options[(currentIndex + 1) % options.length];

        if (this._isGM) {
            this._waterChoices.set(actorId, nextOption.id);
            this._broadcastSync();
            this.render();
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        } else {
            emitRestSessionDelta("bivouac", "SWAP_WATER", { actorId, itemId: nextOption.id });
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        }
        this._saveSessionState();
    },

    onAdjustBivouacDC(event, target) {
        if (!this._isGM) return;
        const delta = Number(target.dataset.delta) || 0;
        this._dangerDC = Math.max(1, Math.min(30, (this._dangerDC ?? 15) + delta));
        this._broadcastSync();
        this.render();
        this._saveSessionState();
    },

    async onPassTheNight(_event, _target) {
        if (!this._isGM) return;

        const party = getPartyActors();

        // Guard: warn GM if any players haven't marked themselves finished
        const unfinishedPlayers = game.users
            .filter(u => !u.isGM && u.active && !this._finishedUsers.has(u.id))
            .filter(u => party.some(a => a.testUserPermission(u, "OWNER")));
        if (unfinishedPlayers.length > 0) {
            const names = unfinishedPlayers.map(u => u.name);
            const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
            const proceed = await confirmFn({
                title: game.i18n.localize("ionrift-respite.bivouac.unfinished.title"),
                content: game.i18n.format("ionrift-respite.bivouac.unfinished.content", { list: names.map(n => `<li><strong>${n}</strong></li>`).join("") }),
                yesLabel: game.i18n.localize("ionrift-respite.bivouac.completeRest"),
                noLabel: game.i18n.localize("ionrift-respite.bivouac.wait"),
                yesIcon: "fas fa-moon",
                noIcon: "fas fa-hourglass-half",
                defaultYes: false,
            });
            if (!proceed) return;
        }

        // 1. Run Encounter check
        const encounterCheck = await EncounterDraftService.checkBivouacEncounter({
            terrainTag: this._terrainTag,
            partyActors: party,
            campStanceManager: this._campStanceManager,
            safePassage: this._safePassage,
            baseDC: this._dangerDC ?? 15
        });

        if (encounterCheck.triggered) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.bivouac.ambushInterrupted"));
            return;
        }

        if (encounterCheck.state === "amber") {
            ui.notifications.info(game.i18n.localize("ionrift-respite.bivouac.restlessNight"));
        }

        // 2. Safe night: resolve Sustenance for all party members
        const outlanderStatus = SustenanceEngine.scanOutlander(party, this._terrainTag);
        const sustenanceLines = [];

        for (const actor of party) {
            const choice = this._plateChoices.get(actor.id);
            const isActorChefFed = this._isActorChefFed(actor.id, party);

            let selectedItemId = null;
            if (choice && choice !== "chef" && choice !== "forage" && choice !== "starve") {
                selectedItemId = choice;
            }

            const result = await SustenanceEngine.resolveBivouacActorMeal(actor, {
                isChefFed: isActorChefFed,
                isOutlanderShielded: !isActorChefFed && outlanderStatus.isEligible,
                selectedItemId: (choice === "starve") ? null : selectedItemId
            });

            if (result.ate) {
                sustenanceLines.push(game.i18n.format("ionrift-respite.bivouac.summary.ate", { actor: actor.name, item: result.itemName, source: result.source }));
            } else {
                sustenanceLines.push(game.i18n.format("ionrift-respite.bivouac.summary.starved", { actor: actor.name, count: result.restsSinceFood }));
            }

            // Resolve Water
            const wChoice = this._waterChoices.get(actor.id);
            let selectedWaterItemId = null;
            if (wChoice && wChoice !== "thirsty") {
                selectedWaterItemId = wChoice;
            }

            const waterResult = await SustenanceEngine.resolveBivouacActorWater(actor, {
                isOutlanderShielded: outlanderStatus.isEligible,
                selectedItemId: (wChoice === "thirsty") ? null : selectedWaterItemId,
                terrainTag: this._terrainTag
            });

            if (waterResult.dehydrationAutoFail) {
                const adapter = game.ionrift?.respite?.adapter;
                if (adapter?.applyExhaustionDelta) {
                    await adapter.applyExhaustionDelta(actor, 1);
                } else {
                    const current = actor.system?.attributes?.exhaustion ?? 0;
                    if (current < 6 && actor.update) {
                        await actor.update({ "system.attributes.exhaustion": current + 1 });
                    }
                }
                sustenanceLines.push(game.i18n.format("ionrift-respite.bivouac.summary.waterAutoFail", { actor: actor.name }));
            } else if (waterResult.dehydrationSaveDC > 0) {
                sustenanceLines.push(game.i18n.format("ionrift-respite.bivouac.summary.waterHalf", { actor: actor.name, pints: waterResult.unitsDeducted, dc: waterResult.dehydrationSaveDC }));
            } else if (waterResult.drank) {
                sustenanceLines.push(game.i18n.format("ionrift-respite.bivouac.summary.drank", { actor: actor.name, item: waterResult.itemName, source: waterResult.source }));
            } else if (waterResult.dehydrated) {
                sustenanceLines.push(game.i18n.format("ionrift-respite.bivouac.summary.dehydrated", { actor: actor.name, count: waterResult.restsSinceWater }));
            }
        }

        // 2B. Fuel consumption for Warm Camp (only if campfire setting is active)
        let firewoodLine = "";
        const fireWarmthSetting = game.settings.get(MODULE_ID, "shortRestFireWarmth") ?? "none";
        if (fireWarmthSetting !== "none") {
            if (this._campStanceManager.isWarm) {
                const woodHolders = party.filter(a => countActorFirewood(a) > 0);
                if (woodHolders.length > 0) {
                    const contributor = woodHolders[Math.floor(Math.random() * woodHolders.length)];
                    const woodItem = findConsumableFirewoodItem(contributor);
                    if (woodItem) {
                        await consumeItem(contributor, woodItem.id, 1);
                        firewoodLine = game.i18n.format("ionrift-respite.bivouac.summary.fuelProvided", { actor: contributor.name, item: woodItem.name });
                    }
                } else {
                    firewoodLine = game.i18n.localize("ionrift-respite.bivouac.summary.noFuel");
                }
            } else {
                firewoodLine = game.i18n.localize("ionrift-respite.bivouac.summary.coldStance");
            }
        }

        // 3. Advance world time (8 hours = 480 minutes)
        await CalendarHandler.advanceRestTime("short");

        // 4. Trigger native short rest feature recharge on actors
        setNativeShortRestUnsuppressed(true);
        try {
            const shortAdapter = game.ionrift?.respite?.adapter;
            for (const actor of party) {
                try {
                    if (shortAdapter) {
                        await shortAdapter.triggerNativeRest(actor, "short");
                    } else if (game.system.id === "dnd5e") {
                        await actor.shortRest({ dialog: false, chat: false });
                    }
                } catch (e) {
                    Logger.warn(`Failed short rest for ${actor.name}:`, e);
                }
            }
        } finally {
            setNativeShortRestUnsuppressed(false);
        }

        if (this._detectMagic) {
            await purgeDetectMagicRestArtifacts(party);
            this._detectMagic.clearScanSession({ skipSave: true });
        }

        // 5. Post dawn summary chat card
        const stanceLabel = this._campStanceManager.isWarm ? game.i18n.localize("ionrift-respite.bivouac.stance.warm") : game.i18n.localize("ionrift-respite.bivouac.stance.coldDark");
        await ChatMessage.create({
            content: `<div class="respite-chat-parchment ionrift-window">` +
                game.i18n.localize("ionrift-respite.bivouac.dawn.heading") +
                game.i18n.format("ionrift-respite.bivouac.dawn.body", { stance: stanceLabel }) +
                `<ul>${firewoodLine}${sustenanceLines.join("")}</ul>` +
                `</div>`,
            speaker: { alias: game.i18n.localize("ionrift-respite.bivouac.dawn.speaker") }
        });

        ui.notifications.info(game.i18n.localize("ionrift-respite.bivouac.restComplete"));
        emitRestSessionResolved("bivouac", {});
        this.close({ resolved: true });
    },

    onToggleBivouacFinished(event, _target) {
        event.preventDefault?.();
        const uid = game.user.id;
        const next = !this._finishedUsers.has(uid);
        if (next) this._finishedUsers.add(uid);
        else this._finishedUsers.delete(uid);

        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("bivouac", "PLAYER_FINISHED", { userId: uid, finished: next });
        }
        this.render();
    },

    onSwitchTab(event, target) {
        const tab = target?.dataset?.tab;
        if (tab !== "camp" && tab !== "workbench") return;
        if (tab === "workbench" && !isWorkbenchIdentifyUiEnabled()) return;
        this._activeTab = tab;
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("bivouac", "WORKBENCH_STAGING", {
                userId: game.user.id,
                staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
            });
        }
        this.render();
    },

    onSelectRosterCharacter(event, target) {
        const chip = target?.closest?.(".roster-chip, .rest-companion-card, [data-actor-id]");
        if (!chip) return;
        const id = chip.dataset.actorId || chip.dataset.rosterId;
        if (!id || id === this._selectedCharacterId) return;
        const party = getPartyActors();
        const targetActor = party.find((a) => a.id === id);
        if (!targetActor) return;
        if (!this._isGM && !targetActor.isOwner) return;
        this._selectedCharacterId = id;
        if (this._isGM && this._activeTab === "workbench") {
            this._workbenchFocusActorId = id;
            void this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    },

    onSelectWorkbenchRosterActor(event, target) {
        if (!this._isGM || this._activeTab !== "workbench") return;
        const chip = target?.closest?.("[data-roster-id]");
        const id = chip?.dataset?.rosterId;
        if (!id) return;
        const party = getPartyActors();
        if (!party.some((a) => a.id === id)) return;
        this._workbenchFocusActorId = id;
        void this._saveSessionState();
        this._broadcastSync();
        this.render();
    },

    async onStationDetectMagicScan(event) {
        if (!this._detectMagic) return;
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._magicScanComplete) {
            this._detectMagic.clearScanSession();
        } else {
            await this._detectMagic.runScan(getPartyActors);
            if (this._isGM) {
                void this._saveSessionState();
                this._broadcastSync();
            }
        }
    },

    async onStationIdentifyScannedItem(event, target) {
        const actorId = target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId) return;
        await this._detectMagic.identifyScannedItem(actorId, itemId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    },

    async onSubmitWorkbenchIdentify() {
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    },

    onWorkbenchIdentifyRemovePotion(_event, _target) {
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        this._workbench.removePotionFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    },

    async onDismissWorkbenchIdentifyAck() {
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        const ack = this._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._workbench.dismissAcknowledgement(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("bivouac", "WORKBENCH_ACK_DISMISS", { actorId });
        }
    }
};
