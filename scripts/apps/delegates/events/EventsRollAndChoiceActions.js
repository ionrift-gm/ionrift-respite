import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { countPoolEventsForTerrain, listPoolEventsForTerrain } from "../../../services/events/catalog/EventCatalogLoader.js";
import { resolveNightWatchMode } from "./nightWatchMode.js";
import { pickPoolEvent } from "../../events/AdHocEventDialogs.js";
import {
    emitPhaseChanged,
    emitTreeRollRequest,
    emitEventRollResult,
    emitCampRollResult,
    emitSubmissionUpdate,
    emitActivityChoice,
    emitRestSnapshot
} from "../../../services/socket/SocketController.js";
import {
    executePlayerRoll,
    rollForPlayer,
    pickBestSkill,
    SKILL_DISPLAY_NAMES,
    waitForDiceSoNice,
    disableRollButton
} from "../../../services/ui/rollRequest/RollRequestManager.js";
import { GrantLedger } from "../../../services/crafting/outcomes/GrantLedger.js";
import { ItemOutcomeHandler } from "../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import {
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationPortraitsFromChoices,
    resetStationOverlaysLocal
} from "../../../services/camp/props/StationInteractionLayer.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { lockSubmittedActivities } from "../../../services/rest/session/campProgressState.js";
import { _refreshGmRestIndicator } from "../../../module.js";

export const eventsRollAndChoiceActions = {
    async receiveCampRollResult(data) {
        const app = this._app;

        if (!app._pendingCampRolls) return;

        const entry = app._pendingCampRolls.find(
            p => p.characterId === data.characterId && p.activityId === data.activityId
        );
        if (!entry) return;

        entry.total = data.total;
        entry.status = data.total >= entry.dc ? "pass" : "fail";

        const actor = game.actors.get(data.characterId);
        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? "forest";
        const comfort = app._engine?.comfort ?? app._restData?.comfort ?? "rough";
        const safeRestSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot);
        const followUpValue = app._gmFollowUps?.get(data.characterId) ?? app._getFollowUpForCharacter?.(data.characterId);

        let resolvedResult = null;
        if (app._activityResolver && actor) {
            resolvedResult = await app._activityResolver.resolve(
                data.activityId,
                actor,
                terrainTag,
                comfort,
                {
                    rollTotal: data.total,
                    preEvaluated: true,
                    followUpValue,
                    safeRestSpot
                }
            );
        }

        // Look up the activity for narrative/effect data
        const activity = app._activities?.find(a => a.id === data.activityId);
        const outcomeKey = entry.status === "pass" ? "success" : "failure";
        const outcome = activity?.outcomes?.[outcomeKey];

        entry.narrative = resolvedResult?.narrative ?? outcome?.narrative ?? "";
        entry.effectDescriptions = (resolvedResult?.effects ?? outcome?.effects ?? []).map(e => e.description).filter(Boolean);

        // Consume encounter_reduction effect for Set Up Defenses success
        if (entry.status === "pass" && entry.activityId === "act_defenses") {
            const defenseMod = 2; // encounter_reduction value from activity data
            if (app._engine?._encounterBreakdown) {
                app._engine._encounterBreakdown.defenses = (app._engine._encounterBreakdown.defenses ?? 0) + defenseMod;
            }
        }

        app._earlyResults.set(data.characterId, resolvedResult ?? {
            source: "activity",
            activityId: data.activityId,
            result: entry.status === "pass" ? "success" : "failure",
            total: data.total,
            effects: outcome?.effects ?? [],
            narrative: entry.narrative
        });

        const allDone = app._pendingCampRolls.every(p => p.status !== "pending");

        emitPhaseChanged("events", {
                eventsRolled: app._eventsRolled ?? false,
                fireLevel: app._fireLevel,
                campStatus: app._campStatus,
                campRollsUpdate: app._pendingCampRolls.map(p => ({
                    characterId: p.characterId,
                    activityName: p.activityName,
                    status: p.status,
                    total: p.total,
                    narrative: p.narrative ?? "",
                    effectDescriptions: p.effectDescriptions ?? []
                }))
            });

        app.render();
    
    },

    formatGmGuidance(text) {
        return text.split(/\n\n+/).map((raw, i) => {
            const p = raw.trim();
            if (i > 0) {
                const labelMatch = p.match(/^([A-Z][^:]{2,30}):\s*/);
                if (labelMatch) {
                    const label = labelMatch[1];
                    const rest = p.slice(labelMatch[0].length);
                    return `<p><strong>${label}</strong>${rest}</p>`;
                }
            }
            return `<p>${p}</p>`;
        }).join("");
    },

    openGmGuidanceFlyout(triggerEl, guidanceHtml) {
        const app = this._app;

        const FLYOUT_ID = "ionrift-gm-guidance-flyout";
        let flyout = document.getElementById(FLYOUT_ID);

        if (!flyout) {
            flyout = document.createElement("div");
            flyout.id = FLYOUT_ID;
            flyout.className = "tree-gm-sidebar";
            flyout.innerHTML = `
                <div class="tree-gm-sidebar-header">
                    <span><i class="fas fa-book-reader"></i> ${game.i18n.localize("ionrift-respite.eventsPhase.gmGuidance")}</span>
                    <button type="button" class="tree-gm-sidebar-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="tree-gm-sidebar-body"></div>
            `;
            document.body.appendChild(flyout);
            flyout.querySelector(".tree-gm-sidebar-close").addEventListener("click", () => {
                flyout.classList.remove("open");
                // Clear active state on whichever button opened it
                document.querySelectorAll(".tree-gm-notes-btn.active").forEach(b => b.classList.remove("active"));
            });
        }

        flyout.querySelector(".tree-gm-sidebar-body").innerHTML = guidanceHtml;

        // Anchor flyout: right of window (X), level with the button (Y)
        const windowEl = triggerEl.closest(".ionrift-window");
        const windowRect = windowEl?.getBoundingClientRect() ?? triggerEl.getBoundingClientRect();
        const btnRect = triggerEl.getBoundingClientRect();

        const applyPosition = (wRect, bTopOffset) => {
            flyout.style.left = `${wRect.right + 4}px`;
            flyout.style.top  = `${Math.max(8, Math.min(wRect.top + bTopOffset, window.innerHeight - 400))}px`;
        };

        const btnTopOffset = btnRect.top - windowRect.top;
        applyPosition(windowRect, btnTopOffset);

        // Track window drag ,  reposition flyout whenever the window moves
        if (flyout._dragObserver) flyout._dragObserver.disconnect();
        if (windowEl) {
            flyout._dragObserver = new MutationObserver(() => {
                if (!flyout.classList.contains("open")) return;
                applyPosition(windowEl.getBoundingClientRect(), btnTopOffset);
            });
            flyout._dragObserver.observe(windowEl, { attributes: true, attributeFilter: ["style"] });
        }

        // Disconnect observer when flyout is closed
        flyout.querySelector(".tree-gm-sidebar-close").addEventListener("click", () => {
            flyout._dragObserver?.disconnect();
        }, { once: true });

        flyout.classList.add("open");
    
    },

    async onRollEventCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = app._pendingEventRoll;
        if (!pending || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        // Verify this player owns this actor
        if (!actor.isOwner) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.eventsPhase.warnDoNotOwnCharacter"));
            return;
        }

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        const rollMode = pending.rollModes?.[characterId] ?? "normal";
        const modeLabel = rollMode === "advantage" ? " [Advantage]" : rollMode === "disadvantage" ? " [Disadvantage]" : "";
        const flavor = game.i18n.format("ionrift-respite.eventsPhase.rollFlavorAttempt", {
            actor: actor.name,
            skill: pending.skillName,
            dc: pending.dc,
            mode: modeLabel
        });

        const { total } = await executePlayerRoll(
            actor,
            pending.skill,
            pending.dc,
            flavor,
            target,
            rollMode
        );

        // Mark as rolled locally and store the result so the player's own DC badge can
        // acknowledge pass/fail immediately, before the GM's resolved snapshot syncs back.
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);
        if (!pending.rolledResults) pending.rolledResults = new Map();
        pending.rolledResults.set(characterId, { total, passed: total >= pending.dc });

        // Send result to GM
        emitEventRollResult({
                    eventIndex: pending.eventIndex,
                    characterId,
                    characterName: actor.name,
                    total
                });

        ui.notifications.info(game.i18n.format("ionrift-respite.eventsPhase.infoRolledForSkill", {
            actor: actor.name,
            total,
            skill: pending.skillName
        }));
        app.render();
    
    },

    onCycleEventRollMode(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const characterId = target.dataset.characterId;
        const triggeredEvent = app._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.mechanical || !characterId || triggeredEvent.awaitingRolls || triggeredEvent.resolvedOutcome) return;

        if (!triggeredEvent.rollModes) triggeredEvent.rollModes = {};
        const CYCLE = { normal: "advantage", advantage: "disadvantage", disadvantage: "normal" };
        const current = triggeredEvent.rollModes[characterId] ?? "normal";
        const next = CYCLE[current] ?? "advantage";
        triggeredEvent.rollModes[characterId] = next;

        // Update the portrait in place. A full re-render would reset the scroll
        // position; this is a local toggle only consumed when rolls are requested.
        const button = target.closest(".check-avatar") ?? target;
        button.classList.toggle("adv", next === "advantage");
        button.classList.toggle("dis", next === "disadvantage");
        const name = button.getAttribute("data-tooltip")?.split(" \u00b7 ")[0] ?? "";
        const modeLabel = next === "advantage"
            ? game.i18n.localize("ionrift-respite.eventsPhase.modeAdvantage")
            : next === "disadvantage"
                ? game.i18n.localize("ionrift-respite.eventsPhase.modeDisadvantage")
                : game.i18n.localize("ionrift-respite.eventsPhase.modeNormal");
        button.setAttribute("data-tooltip", game.i18n.format("ionrift-respite.eventsPhase.avatarModeTooltip", { name, mode: modeLabel }));
        button.querySelector(".check-avatar-mode")?.remove();
        if (next !== "normal") {
            const badge = document.createElement("span");
            badge.className = `check-avatar-mode ${next === "advantage" ? "adv" : "dis"}`;
            badge.innerHTML = `<i class="fas fa-angle-${next === "advantage" ? "up" : "down"}"></i>`;
            button.appendChild(badge);
        }
    
    },

    onRequestCampRoll(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = app._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        entry.requested = true;

        emitPhaseChanged("events", {
                eventsRolled: app._eventsRolled ?? false,
                fireLevel: app._fireLevel,
                campStatus: app._campStatus,
                campRollRequest: {
                    activities: [{
                        characterId: entry.characterId,
                        activityId: entry.activityId,
                        activityName: entry.activityName,
                        skill: entry.skill,
                        skillName: entry.skillName,
                        dc: entry.dc,
                        status: entry.status,
                        total: entry.total
                    }]
                }
            });

        ui.notifications.info(game.i18n.format("ionrift-respite.eventsPhase.infoRollRequestSent", {
            character: entry.characterName,
            activity: entry.activityName
        }));
        app.render();
    
    },

    async onGrantDiscoveryItem(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;

        const grantKey = target.dataset.grantKey;
        const itemRef = target.dataset.itemRef;
        const quantity = target.dataset.quantity;

        // Find the sibling select element for actor selection
        const row = target.closest(".party-discovery-item");
        const select = row?.querySelector(".discovery-actor-select");
        const actorId = select?.value;

        if (!actorId || !itemRef) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.eventsPhase.warnSelectCharacter"));
            return;
        }

        try {
            const colon = grantKey.indexOf(":");
            const eventId = colon >= 0 ? grantKey.slice(0, colon) : grantKey;
            const ref = colon >= 0 ? grantKey.slice(colon + 1) : itemRef;
            const result = await ItemOutcomeHandler.grantToActor(actorId, itemRef, quantity, {
                ledger: app._grantLedger,
                slotKey: GrantLedger.discoverySlotKey(eventId, ref)
            });
            ui.notifications.info(game.i18n.format("ionrift-respite.eventsPhase.infoGrantedItem", {
            rolled: result.rolled,
            item: result.itemName,
            actor: result.actorName
        }));
            app.render();
        } catch (e) {

            console.error(`[Respite] Failed to grant item:`, e);
            ui.notifications.error(game.i18n.format("ionrift-respite.eventsPhase.errorFailedToGrant", {
            item: itemRef,
            error: e.message
        }));
        }
    
    },

    onGmOverride(event, target) {
        const app = this._app;

        const characterId = target.dataset.characterId;
        const activityId = target.value;

        if (activityId) {
            app._gmOverrides.set(characterId, activityId);
        } else {
            app._gmOverrides.delete(characterId);
        }

        app._rebuildCharacterChoices();
        app._saveRestState();
        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        app.render();

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: app._gmOverrides.has(charId) ? "gm" : "player" };
        }
        emitSubmissionUpdate(submissions);
    
    },

    onToggleGmGuidance(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const FLYOUT_ID = "ionrift-gm-guidance-flyout";
        const flyout = document.getElementById(FLYOUT_ID);

        // If already open, close it and clear button state
        if (flyout?.classList.contains("open")) {
            flyout.classList.remove("open");
            document.querySelectorAll(".tree-gm-notes-btn.active").forEach(b => b.classList.remove("active"));
            return;
        }

        // Get guidance text from the hidden data holder in the tree
        const tree = target.closest(".respite-decision-tree");
        if (!tree) return;
        const raw = tree.querySelector(".tree-gm-sidebar-body")?.textContent?.trim();
        if (!raw) return;

        target.classList.add("active");
        this.openGmGuidanceFlyout(target, this.formatGmGuidance(raw));
    
    },

    async onIonriftRoll(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const flow = target.dataset.flow ?? "event";
        switch (flow) {
            case "event":
                return this.onRollEventCheck(event, target);
            case "tree":
                return this._app._flowActions.onRollTreeCheck(event, target);
            case "camp":
                return this.onRollCampCheck(event, target);
            case "copySpell":
                return this._app._copySpell.onRollArcana(event, target);
            default:
                return undefined;
        }
    
    },

    rehydrateItemLossProposal(eff) {
        const app = this._app;

        const candidates = [];
        for (const li of (eff._lockedItems ?? [])) {
            const actor = game.actors.get(li.actorId);
            const item = actor?.items?.get(li.itemId);
            if (!actor || !item) continue;
            candidates.push({
                actor,
                item,
                currentQty: item.system?.quantity ?? li.currentQty ?? 1,
                lossQty: li.lossQty
            });
        }
        return {
            type: "item_at_risk",
            candidates,
            narrative: eff.narrative ?? "Some items were lost.",
            severity: eff.severity ?? 1
        };
    
    },

    async onFinalize(event, target) {
        const app = this._app;

        // Warn if there are ungranted party discoveries
        if (app._grantLedger && app._outcomes?.length) {
            const seenEvents = new Set();
            let ungrantedCount = 0;
            for (const o of app._outcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            if (!app._hasDiscoveryGrant(key)) ungrantedCount++;
                        }
                    }
                }
            }
            if (ungrantedCount > 0) {
                const ungrantedText = ungrantedCount > 1
                    ? game.i18n.format("ionrift-respite.eventsPhase.ungrantedPlural", { count: ungrantedCount })
                    : game.i18n.format("ionrift-respite.eventsPhase.ungrantedSingle", { count: ungrantedCount });
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-gem"></i> ${game.i18n.localize("ionrift-respite.eventsPhase.ungrantedDiscoveriesTitle")}</h3>
                        <p>${ungrantedText}</p>
                        <p>${game.i18n.localize("ionrift-respite.eventsPhase.ungrantedPrompt")}</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-times"></i> ${game.i18n.localize("ionrift-respite.eventsPhase.btnCloseAnyway")}</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> ${game.i18n.localize("ionrift-respite.eventsPhase.btnGoBack")}</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", async () => {
                    overlay.remove();
                    await app._resolve?.postMasterRestCard?.();
                    app.close({ resolved: true });
                });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                    overlay.remove();
                });
                return;
            }
        }
        await app._resolve?.postMasterRestCard?.();
        app.close({ resolved: true });
    
    },

    async onRollCampForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = app._pendingCampRolls?.find(
            p => p.characterId === characterId && p.status === "pending" && p.requested
        );
        if (!entry) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const context = `${entry.activityName} (${entry.skillName})`;
        const result = await rollForPlayer(actor, [entry.skill], entry.dc, context);

        // Feed through the normal collection path
        await this.receiveCampRollResult({
            characterId,
            characterName: actor.name,
            activityId: entry.activityId,
            total: result.total
        });
    
    },

    async onRollCampCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = app._pendingCampRoll;
        if (!pending || !characterId) return;

        const activityEntry = pending.activities?.find(a => a.characterId === characterId);
        if (!activityEntry) return;

        const actor = game.actors.get(characterId);
        if (!actor || !actor.isOwner) return;

        if (pending.rolledCharacters?.has(characterId)) return;

        const flavor = game.i18n.format("ionrift-respite.eventsPhase.rollFlavorCamp", {
            actor: actor.name,
            activity: activityEntry.activityName,
            skill: activityEntry.skillName,
            dc: activityEntry.dc
        });
        const { total } = await executePlayerRoll(
            actor,
            activityEntry.skill,
            activityEntry.dc,
            flavor,
            target
        );

        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

        emitCampRollResult({
                    characterId,
                    characterName: actor.name,
                    activityId: activityEntry.activityId,
                    total
                });

        ui.notifications.info(game.i18n.format("ionrift-respite.eventsPhase.infoRolledForActivity", {
            actor: actor.name,
            total,
            activity: activityEntry.activityName
        }));
        app.render();
    
    },

    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null, earlyResults = null) {
        const app = this._app;

        const user = game.users.get(userId);
        app._playerSubmissions.set(userId, {
            choices,
            followUps: followUps ?? {},
            userName: user?.name ?? "Unknown",
            timestamp: Date.now()
        });

        // Merge crafting results from the player
        if (craftingResults) {
            for (const [charId, result] of Object.entries(craftingResults)) {
                if (!result) continue;
                app._craftingResults.set(charId, result);
                app._lockedCharacters.add(charId);
            }
        }

        // Merge early results from the player (resolved camp rolls, crafting outcomes, etc.)
        // so the GM doesn't re-prompt rolls the player already completed.
        if (earlyResults) {
            if (!app._earlyResults) app._earlyResults = new Map();
            for (const [charId, result] of Object.entries(earlyResults)) {
                if (result && result.result !== "pending_approval") {
                    app._earlyResults.set(charId, result);
                }
            }
        }

        app._rebuildCharacterChoices();
        lockSubmittedActivities(app, choices);
        app._pruneEarlyResultsWithoutChoice();
        app._saveRestState();

        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        app.render();
        // Refresh the GM footer bar in-place (it bakes the count at creation time).
        _refreshGmRestIndicator(app);

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "player" };
        }
        for (const [charId, actId] of app._gmOverrides) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "gm" };
        }
        emitSubmissionUpdate(submissions);

        const snapshot = app.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
    
    },

    _revertStationActivityChoice(characterId) {
        const app = this._app;

        if (!characterId || app._isGM) return;

        app._characterChoices.delete(characterId);
        app._lockedCharacters.delete(characterId);
        app._earlyResults.delete(characterId);
        app._trainingStates?.delete(characterId);
        app._stationCanvasIdByCharacter?.delete(characterId);

        const mySub = app._playerSubmissions.get(game.user.id);
        if (mySub?.choices) {
            delete mySub.choices[characterId];
            app._playerSubmissions.set(game.user.id, mySub);
        }

        app._rebuildCharacterChoices();
        app._pruneEarlyResultsWithoutChoice();

        emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(app._characterChoices),
                    null,
                    null,
                    app._earlyResults?.size ? Object.fromEntries(app._earlyResults) : null
                );

        resetStationOverlaysLocal();
        if (isStationLayerActive()) {
            if (!app._isGM) app._refreshStationOverlayForFocusChange();
            else {
                refreshStationEmptyNoticeFade(this);
                app._refreshStationOverlayMeals();
            }
        }
        app._updateRestBarProgress();
    
    }
};
