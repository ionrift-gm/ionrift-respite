import { MODULE_ID } from "../../data/moduleId.js";
import { postRollAndSettle } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { fireEncounterDcNudge } from "../delegates/camp/CampLogisticsDelegate.js";
import { Logger } from "../../utils/Logger.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import {
    keepsRolledActivityDays,
    rebindActivityRolls,
    unresolvedCraftProfessions
} from "../../services/downtime/craftPlanEscape.js";
import { EncounterDraftService, combineNightDc } from "../../services/rest/gritty/EncounterDraftService.js";
import {
    drainPendingRestSessionDeltas,
    emitRestSessionDelta,
    emitRestSessionSync,
    userControlsActor
} from "../../services/rest/session/RestSessionSync.js";
import { DOWNTIME_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import { CraftingEngine } from "../../services/crafting/engine/CraftingEngine.js";
import { STUB_RECIPES } from "../../data/stub-content.js";
import { applyCustomRecipesToEngine } from "../../services/crafting/recipes/RecipeCatalog.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { EventResolver } from "../../services/events/resolve/EventResolver.js";
import { loadAllCatalogEvents } from "../../services/events/catalog/EventCatalogLoader.js";
import { loadInstalledEventsInto } from "../../services/events/catalog/InstalledEventSource.js";
import { WEATHER_TABLE, isWorkbenchIdentifyUiEnabled } from "../../data/RestConstants.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { isComfortEnabled, boostComfort } from "../../services/camp/gear/ComfortCalculator.js";
import { buildCampConditionsBar } from "../../services/camp/gear/CampConditionsBarBuilder.js";
import { bindSustenanceMeters } from "../delegates/meal/SustenanceMeterBinding.js";
import { GATHERING_DAYS, normalizeGatheringSchedule } from "./DowntimeSustenanceBuilder.js";
import { buildCharacterSustenanceData } from "./DowntimeCharacterSustenanceContext.js";
import { buildCharacterRollAndStatusContext } from "./DowntimeCharacterRollAndStatusContext.js";
import { buildDowntimePartyAndNightContext } from "./DowntimePartyAndNightContext.js";
import { DowntimePlanningActions } from "./DowntimePlanningAndSustenanceActions.js";
import { DowntimeActivityAndNightActions } from "./DowntimeActivityAndNightActions.js";
import { DowntimeResolutionActions } from "./DowntimeResolutionAndWorkbenchActions.js";

class DowntimeSyncAndRenderMixin {
    _getCraftingEngine() {
        if (!this._craftingEngine) {
            this._craftingEngine = new CraftingEngine();
            for (const [profId, recipeList] of Object.entries(STUB_RECIPES)) {
                this._craftingEngine.load(profId, recipeList);
            }
            applyCustomRecipesToEngine(this._craftingEngine);
        }
        return this._craftingEngine;
    }

    /** @type {EventResolver|null} */
    _eventResolver = null;

    /**
     * Lazy-initializes and loads the EventResolver with curated catalog events and terrain tables.
     * @returns {Promise<EventResolver>}
     */
    async _getEventResolver() {
        if (!this._eventResolver) {
            this._eventResolver = new EventResolver();
            try {
                await TerrainRegistry.init();
                const allEvents = await loadAllCatalogEvents();
                this._eventResolver.load([], allEvents);

                // Terrain roll table plus installed events and camp disasters.
                // Nothing installed: the resolver stays empty and no disaster rolls fire.
                await loadInstalledEventsInto(this._eventResolver, { terrainTag: this._terrainTag });
            } catch (err) {
                Logger.warn(`${MODULE_ID} | Failed to load EventResolver in DowntimeLedgerApp:`, err);
            }
        }
        return this._eventResolver;
    }
    _getOrCreateGatheringSchedule(actorId) {
        let schedule = this._gatheringSchedule.get(actorId);
        if (!Array.isArray(schedule) || schedule.length !== GATHERING_DAYS) {
            schedule = normalizeGatheringSchedule(schedule, "forage");
            this._gatheringSchedule.set(actorId, schedule);
        }
        return schedule;
    }

    /**
     * Gets or synchronizes the 7-day activity roll entries for an actor based on current segment allocations.
     * @param {string} actorId
     * @returns {Array<{day: number, activityId: string|null, rolled: boolean, rollTotal: number|null, dc: number|null, success: boolean|null, skillUsed: string|null}>}
     */
    _getOrCreateActivityRolls(actorId) {
        const actor = game.actors.get(actorId);
        const viewModel = actor ? this._budgetDelegate.getActorViewModel(actor) : null;
        const segments = viewModel?.segments ?? [];

        let rolls = this._activityRolls.get(actorId);
        if (!Array.isArray(rolls) || rolls.length !== 7) {
            rolls = [1, 2, 3, 4, 5, 6, 7].map(day => ({
                day,
                activityId: null,
                rolled: false,
                rollTotal: null,
                dc: null,
                success: null,
                skillUsed: null
            }));
            this._activityRolls.set(actorId, rolls);
        }

        const planChanged = rolls.some((roll, index) => {
            const seg = segments[index];
            const currentActId = (seg && seg.filled) ? seg.activityId : null;
            return roll.activityId !== currentActId;
        });
        if (!planChanged) return rolls;

        // Results follow the activity when a day is reassigned, so dropping
        // an unmade brew day does not wipe a check that already landed.
        const rebound = rebindActivityRolls(rolls, segments);
        this._activityRolls.set(actorId, rebound);
        return rebound;
    }

    /**
     * Recipe counts for unresolved cook, brew, and craft days.
     * A failed lookup counts as available so a bad read does not unlock the plan.
     * @param {Actor} actor
     * @param {object[]} rolls
     * @returns {Record<string, number>}
     */
    _craftAvailableCounts(actor, rolls) {
        const engine = this._getCraftingEngine();
        // The craft window lists recipes for a single serving. Use that same
        // check so Change plan appears only when that window has nothing to make.
        const counts = {};
        for (const profession of unresolvedCraftProfessions(rolls)) {
            try {
                const status = engine.getRecipeStatus(actor, profession, this._terrainTag ?? null, 1);
                counts[profession] = status?.available?.length ?? 0;
            } catch {
                counts[profession] = 1;
            }
        }
        return counts;
    }

    /**
     * @param {string} actorId
     * @param {string} activityId
     * @param {number} nextCount
     * @returns {boolean}
     */
    _keepsRolledActivityDays(actorId, activityId, nextCount) {
        const rolls = this._getOrCreateActivityRolls(actorId);
        return keepsRolledActivityDays(rolls, activityId, nextCount);
    }

    _resolveDefaultWeather(terrainTag) {
        let lastWeather = "";
        try {
            lastWeather = game.settings.get(MODULE_ID, "lastWeather") ?? "";
        } catch { /* settings not ready */ }
        const valid = TerrainRegistry.getWeather ? TerrainRegistry.getWeather(terrainTag) : [];
        const defaultKey = valid[0] ?? "clear";
        return lastWeather || defaultKey || "clear";
    }

    /**
     * Builds the camp conditions bar data (Terrain, Comfort, Weather, Tent) aligned with vanilla Respite.
     * @param {object|null} [scanResult=null]
     * @param {object} [options={}]
     * @returns {object}
     */
    _buildCampConditionsBar(scanResult = null, options = {}) {
        const haven = this._budgetDelegate?.haven ?? "wilderness";
        const isCivilized = haven === "civilized";
        const safeRestSpot = isCivilized || this._terrainTag === "tavern";
        const isGM = options.isGM ?? this._isGM;
        const playerCharacters = this._partyActors?.filter(a => a.isOwner && !a.isGM) ?? [];
        return buildCampConditionsBar({
            terrainTag: this._terrainTag ?? "forest",
            weatherKey: this._weather ?? "clear",
            fireLevel: this._fireLevel ?? "campfire",
            activeShelters: this._activeShelters ?? [],
            campScanData: scanResult ?? this._campScanData,
            safeRestSpot,
            encountersEnabled: true,
            isGM,
            viewerActorId: options.viewerActorId ?? (isGM ? null : (playerCharacters[0]?.id ?? null)),
            enforceTent: options.enforceTent ?? this._campLogistics._enforceTent
        });
    }
    _getOrCreateExhaustionEntry(actor, personalCard = null, hasStarvationRisk = false, currentFire = "unlit") {
        if (!actor) return null;
        if (!this._exhaustionDraft) this._exhaustionDraft = new Map();
        let entry = this._exhaustionDraft.get(actor.id);
        if (!entry) {
            const haven = this._budgetDelegate?.haven ?? "wilderness";
            const isSafeHaven = haven === "civilized";
            const comfort = personalCard?.personalComfort ?? "rough";
            const exhaustionDC = isSafeHaven ? null : (personalCard?.recovery?.exhaustionDC ?? (comfort === "rough" ? 10 : (comfort === "hostile" ? 15 : null)));
            const starvationDC = hasStarvationRisk ? 15 : null;
            const targetDC = Math.max(exhaustionDC ?? 10, starvationDC ?? 10);
            const hasHazard = !isSafeHaven && (Boolean(exhaustionDC) || hasStarvationRisk || comfort === "rough" || comfort === "hostile");

            const reasons = [];
            if (isSafeHaven) {
                reasons.push("Safe Haven: warm shelter & supplies");
            } else {
                if (hasStarvationRisk) reasons.push("Food/water shortfall");
                if (comfort === "hostile") reasons.push("Hostile wilderness exposure");
                else if (comfort === "rough") reasons.push("Rough camp conditions");
                if (!personalCard?.hasBedroll && !personalCard?.bedrollWaived) reasons.push("Missing bedroll");
            }
            if (!reasons.length) reasons.push("Safe and sheltered sleep");

            const hasMessKit = personalCard?.hasMessKit ?? false;
            const fireLit = currentFire !== "cold_camp" && currentFire !== "unlit";
            const defaultAdvMode = (hasMessKit && fireLit) ? "adv" : "norm";

            entry = {
                actorId: actor.id,
                actorName: actor.name,
                actorImg: (actor.img && actor.img.trim() !== "") ? actor.img : "icons/svg/mystery-man.svg",
                mustRoll: hasHazard,
                waived: !hasHazard,
                advMode: defaultAdvMode,
                dc: targetDC,
                reason: reasons.join(" · "),
                rolled: false,
                rollTotal: null,
                passed: null
            };
            this._exhaustionDraft.set(actor.id, entry);
        }
        return entry;
    }

    /**
     * Evaluates and records a Constitution saving throw for exhaustion against the target DC.
     * @param {string} actorId
     * @returns {Promise<object|null>}
     */
    async _rollActorExhaustion(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;
        const entry = this._getOrCreateExhaustionEntry(actor);
        if (!entry) return null;

        let conMod = 0;
        try {
            const rollData = actor.getRollData?.() ?? {};
            const fromRollData = rollData?.abilities?.con?.save;
            if (typeof fromRollData === "number") {
                conMod = fromRollData;
            } else {
                const mod = actor.system?.abilities?.con?.mod ?? 0;
                const prof = actor.system?.attributes?.prof ?? 0;
                const proficient = actor.system?.abilities?.con?.proficient ?? 0;
                conMod = mod + (proficient > 0 ? prof : 0);
            }
        } catch {
            conMod = actor.system?.abilities?.con?.mod ?? 0;
        }

        const formula = entry.advMode === "adv" ? "2d20kh" : (entry.advMode === "dis" ? "2d20kl" : "1d20");
        const rollString = conMod >= 0 ? `${formula} + ${conMod}` : `${formula} - ${Math.abs(conMod)}`;
        const roll = await new Roll(rollString).evaluate();

        const passed = roll.total >= entry.dc;
        entry.rolled = true;
        entry.rollTotal = roll.total;
        entry.passed = passed;

        const advText = entry.advMode === "adv" ? ` (${game.i18n.localize("ionrift-respite.rollRequest.advantage")})` : (entry.advMode === "dis" ? ` (${game.i18n.localize("ionrift-respite.rollRequest.disadvantage")})` : "");
        const resultText = passed
            ? game.i18n.localize("ionrift-respite.downtimeLedger.conSavePassedHtml")
            : game.i18n.localize("ionrift-respite.downtimeLedger.conSaveFailedHtml");

        await postRollAndSettle(roll, {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: game.i18n.format("ionrift-respite.downtimeLedger.conSaveFlavor", { name: actor.name, dc: entry.dc, adv: advText, result: resultText }),
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });

        return entry;
    }

    /**
     * Inspects party member activity allocations for the specified day/night index (1 to 7).
     * Calculates activity nudges (Fortify -2 DC, Guard -1 DC) and determines active Sentry.
     *
     * @param {number} nightIndex 1 to 7
     * @returns {{
     *   nightIndex: number,
     *   fortifyCount: number,
     *   guardCount: number,
     *   fortifyActors: string[],
     *   guardActors: string[],
     *   activityNudge: number,
     *   sentryActor: Actor|null,
     *   hasActiveGuard: boolean
     * }}
     */
    _getNightActivityModifiers(nightIndex) {
        const party = getPartyActors();
        let fortifyCount = 0;
        let failedFortifyCount = 0;
        let pendingFortifyCount = 0;
        let guardCount = 0;
        const fortifyActors = [];
        const failedFortifyActors = [];
        const pendingFortifyActors = [];
        const guardActors = [];

        for (const actor of party) {
            const viewModel = this._budgetDelegate.getActorViewModel(actor);
            const seg = viewModel?.segments?.[nightIndex - 1];
            if (seg && seg.filled) {
                if (seg.activityId === "fortify") {
                    const rolls = this._getOrCreateActivityRolls(actor.id);
                    const dayRoll = rolls.find(r => r.day === nightIndex);
                    if (dayRoll && dayRoll.rolled) {
                        if (dayRoll.success) {
                            fortifyCount++;
                            fortifyActors.push(actor.name);
                        } else {
                            failedFortifyCount++;
                            failedFortifyActors.push(actor.name);
                        }
                    } else {
                        pendingFortifyCount++;
                        pendingFortifyActors.push(actor.name);
                    }
                } else if (seg.activityId === "guard") {
                    guardCount++;
                    guardActors.push(actor);
                }
            }
        }

        const activityNudge = (fortifyCount === 0 && guardCount === 0)
            ? 0
            : -(fortifyCount * 2) - (guardCount * 1);

        let sentryActor = null;
        if (guardActors.length > 0) {
            sentryActor = guardActors.reduce((best, a) => {
                const pp = a?.system?.skills?.prc?.passive ?? a?.system?.attributes?.passive?.perception ?? 10;
                const bestPp = best?.system?.skills?.prc?.passive ?? best?.system?.attributes?.passive?.perception ?? 10;
                return pp > bestPp ? a : best;
            }, guardActors[0]);
        }

        return {
            nightIndex,
            fortifyCount,
            failedFortifyCount,
            pendingFortifyCount,
            guardCount,
            fortifyActors,
            failedFortifyActors,
            pendingFortifyActors,
            guardActors: guardActors.map(a => a.name),
            activityNudge,
            sentryActor,
            hasActiveGuard: guardActors.length > 0
        };
    }

    /**
     * Synchronizes all drafted nights with the current global dangerDC,
     * dynamic activity nudges (Fortify & Guard), and GM manual offsets.
     */
    _syncDraftDCs() {
        if (!this._encounterDraft || !this._encounterDraft.length) return;
        const haven = this._budgetDelegate?.haven ?? "wilderness";
        if (haven !== "wilderness") return;

        const fireNudge = fireEncounterDcNudge(this._fireLevel);

        for (const entry of this._encounterDraft) {
            const mods = this._getNightActivityModifiers(entry.nightIndex);
            entry.activityNudge = mods.activityNudge;
            entry.fireNudge = fireNudge;
            entry.fortifyCount = mods.fortifyCount;
            entry.guardCount = mods.guardCount;
            entry.fortifyActors = mods.fortifyActors;
            entry.guardActors = mods.guardActors;
            entry.hasActiveGuard = mods.hasActiveGuard;
            if (mods.sentryActor) {
                entry.sentryName = mods.sentryActor.name;
                entry.sentryActorId = mods.sentryActor.id;
            } else {
                entry.sentryName = null;
                entry.sentryActorId = null;
            }

            const manualOffset = entry.manualOffset ?? 0;
            const newDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);
            const isTerminalNight = (entry.nightIndex === this._encounterDraft.length);

            EncounterDraftService.evaluateNightTrigger(entry, newDC, this._terrainTag, isTerminalNight);
        }
    }

    async _initEncounterDraft() {
        const draftGen = (this._encounterDraftGen = (this._encounterDraftGen ?? 0) + 1);
        try {
            const party = getPartyActors();
            const totalNights = Math.max(1, this._totalNights || 7);
            const draft = await EncounterDraftService.batchDowntimeEncounters({
                days: totalNights,
                terrainTag: this._terrainTag,
                partyActors: party,
                safePassage: false,
                baseDC: this._dangerDC ?? 15,
                nightOptions: (nightIndex) => {
                    const mods = this._getNightActivityModifiers(nightIndex);
                    const existingEntry = this._encounterDraft?.find?.(e => e.nightIndex === nightIndex);
                    const manualOffset = existingEntry?.manualOffset ?? 0;
                    const fireNudge = fireEncounterDcNudge(this._fireLevel);
                    return {
                        effectiveDC: combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset),
                        sentryActor: mods.sentryActor,
                        hasActiveGuard: mods.hasActiveGuard
                    };
                }
            });
            if (draftGen !== this._encounterDraftGen) return this._encounterDraft;
            this._encounterDraft = draft;
            for (const entry of this._encounterDraft) {
                const mods = this._getNightActivityModifiers(entry.nightIndex);
                entry.activityNudge = mods.activityNudge;
                entry.fortifyCount = mods.fortifyCount;
                entry.guardCount = mods.guardCount;
                entry.fortifyActors = mods.fortifyActors;
                entry.guardActors = mods.guardActors;
                entry.hasActiveGuard = mods.hasActiveGuard;
                if (entry.isRolled === undefined) {
                    entry.isRolled = false;
                }
            }
        } catch (err) {
            Logger.error(`${MODULE_ID} | Failed to initialize encounter draft:`, err);
            if (draftGen === this._encounterDraftGen) this._encounterDraft = [];
        }
        return this._encounterDraft;
    }

    async _prepareContext(options) {
        drainPendingRestSessionDeltas("downtime");
        const isGM = this._isGM;
        const party = getPartyActors();
        const haven = this._budgetDelegate.haven;

        if (!isGM) {
            const owned = party.find(a => a.isOwner && !a.isGM) ?? party.find(a => a.isOwner);
            if (!this._selectedCharacterId || !party.some(a => a.id === this._selectedCharacterId && (owned ? a.isOwner : true))) {
                this._selectedCharacterId = owned?.id ?? party[0]?.id ?? null;
            }
        } else if (!this._selectedCharacterId || !party.some(a => a.id === this._selectedCharacterId)) {
            this._selectedCharacterId = party[0]?.id ?? null;
        }
        const isCivilized = haven === "civilized";
        const safeRestSpot = isCivilized || this._terrainTag === "tavern";
        const workbenchIdentifyUiEnabled = isWorkbenchIdentifyUiEnabled();

        const fuelStockTotal = party.reduce((sum, a) => sum + CampGearScanner.countActorFirewood(a), 0);
        const hasTinderbox = party.some(a => CampGearScanner.actorHasTinderbox(a));
        const defaultFire = (hasTinderbox && fuelStockTotal >= 2) ? "campfire"
                          : (hasTinderbox && fuelStockTotal >= 1) ? "embers"
                          : "cold_camp";
        const currentFire = this._fireLevel ?? defaultFire;

        const terrain = TerrainRegistry.get(this._terrainTag);
        const terrainLabel = terrain?.label ?? (this._terrainTag.charAt(0).toUpperCase() + this._terrainTag.slice(1));
        const shelterSpell = this._activeShelters.find(s => ["tiny_hut", "magnificent_mansion"].includes(s)) ?? null;

        let baseTerrainComfort = terrain?.comfort ?? "rough";
        const weatherKey = this._weather ?? "clear";
        const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
        const partyHasScannedTent = party.some(a => CampGearScanner.scanActor(a).hasTent);
        const hasTent = !this._campLogistics._enforceTent || (this._activeShelters ?? []).includes("tent") || partyHasScannedTent;
        const hasHut = (this._activeShelters ?? []).some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

        let weatherPenalty = wx.comfortPenalty ?? 0;
        if (hasHut) {
            weatherPenalty = 0;
        } else if (hasTent) {
            if (wx.tentCancels) {
                weatherPenalty = 0;
            } else if (wx.tentReduces) {
                weatherPenalty = Math.max(0, weatherPenalty - 1);
            }
        }
        if (weatherPenalty > 0 && isComfortEnabled()) {
            baseTerrainComfort = boostComfort(baseTerrainComfort, -weatherPenalty);
        }

        const scanResult = CampGearScanner.scan(
            baseTerrainComfort,
            currentFire,
            shelterSpell,
            terrain?.comfortReason ?? "",
            terrainLabel,
            0,
            safeRestSpot,
            {
                enforceBedroll: this._campLogistics._enforceBedroll,
                enforceTent: this._campLogistics._enforceTent,
                enforceMessKit: this._campLogistics._enforceMessKit
            }
        );
        this._campScanData = scanResult;
        this._campComfort = scanResult.campComfort;

        if (isGM && haven === "wilderness" && (!this._encounterDraft || this._encounterDraft.length === 0)) {
            await (this._encounterDraftPromise ?? this._initEncounterDraft());
        }

        let totalNominatedRations = 0;

        const characters = party.map(actor => {
            const sus = buildCharacterSustenanceData(this, actor, {
                isGM,
                haven,
                safeRestSpot,
                terrain,
                scanResult,
                workbenchIdentifyUiEnabled
            });
            totalNominatedRations += sus.totalNominatedRationsDelta;
            return buildCharacterRollAndStatusContext(this, actor, {
                haven,
                isCivilized,
                scanResult,
                workbenchIdentifyUiEnabled
            }, sus);
        });
        return buildDowntimePartyAndNightContext(this, {
            isGM,
            party,
            haven,
            workbenchIdentifyUiEnabled,
            fuelStockTotal,
            hasTinderbox,
            currentFire,
            terrainLabel,
            scanResult,
            characters,
            totalNominatedRations
        });
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        if (!html) return;

        let currentTheme = "glass";
        try {
            currentTheme = game.settings.get(MODULE_ID, "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        html.classList.toggle("hide-terrain-banners", !!context?.hideTerrainBanner);
        html.classList.toggle("theme-ionrift-glass", currentTheme === "glass");
        html.classList.toggle("theme-respite-cockpit", currentTheme === "cockpit");

        if (this.window?.title) {
            this.window.title.textContent = this.title;
        } else {
            const titleEl = html.querySelector(".window-header .window-title");
            if (titleEl) titleEl.textContent = this.title;
        }

        html.classList.toggle("pacing-flow-active", Boolean(this._pacingActive));
        const pacingChanged = this._lastRenderedPacing !== Boolean(this._pacingActive);
        this._lastRenderedPacing = Boolean(this._pacingActive);
        if (pacingChanged) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const el = this.element;
                    if (!el || !this.rendered) return;
                    const h = el.offsetHeight;
                    const w = el.offsetWidth;
                    if (h < 1 || w < 1) return;
                    this.setPosition({
                        top: Math.max(10, Math.round((window.innerHeight - h) / 2)),
                        left: Math.max(10, Math.round((window.innerWidth - w) / 2))
                    });
                });
            });
        }
        if (this._pacingActive) {
            html.style.removeProperty("height");
            const content = html.querySelector(".window-content");
            if (content) content.style.removeProperty("height");
        }

        if (this._isGM && !this._workbenchHookId) {
            this._workbenchHookId = Hooks.on(
                `${MODULE_ID}.workbenchIdentifyStagingTouched`,
                () => this._onWorkbenchStagingTouchedFromHook()
            );
        }

        queueMicrotask(() => {
            if (this._workbench && this.element) {
                this._workbench.bindDragDrop(this.element);
            }
        });

        bindSustenanceMeters(this, html);

        html.querySelectorAll("select.departure-select-compact.departure-meal-select, select.departure-meal-select, select.departure-select-compact:not(.departure-drink-select)").forEach(select => {
            select.addEventListener("change", event => {
                DowntimePlanningActions.onSelectDepartureMeal.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("select.departure-select-compact.departure-drink-select").forEach(select => {
            select.addEventListener("change", event => {
                DowntimePlanningActions.onSelectDepartureDrink.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("select.hearth-tier-select").forEach(select => {
            select.addEventListener("change", event => {
                DowntimeActivityAndNightActions.onSelectFireLevel.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("input.dawn-toggle-must-roll").forEach(input => {
            input.addEventListener("change", event => {
                DowntimeResolutionActions.onToggleMustRollExhaustion.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("input.dawn-dc-input").forEach(input => {
            input.addEventListener("change", event => {
                DowntimeResolutionActions.onChangeExhaustionDCInput.call(this, event, event.currentTarget);
            });
        });
    }

    onReceiveDelta(action, payload, userId) {
        if (!this._isGM) return;

        // Deltas naming an actor are only honoured from a user who owns it.
        if (payload?.actorId && !userControlsActor(userId, payload.actorId)) {
            Logger.warn(`${MODULE_ID} | Rejected Downtime ${action} for unowned actor ${payload.actorId}`);
            return;
        }

        switch (action) {
            case "SET_HAVEN": {
                this._budgetDelegate.setHaven(payload.haven);
                this._syncDraftDCs();
                break;
            }
            case "DUMP_ACTIVITY": {
                if (payload.actorId && payload.activityId) {
                    this._budgetDelegate.dumpDays(payload.actorId, payload.activityId);
                    this._syncDraftDCs();
                }
                break;
            }
            case "STEP_ACTIVITY": {
                if (payload.actorId && payload.activityId && payload.delta) {
                    if (payload.delta < 0) {
                        const current = this._budgetDelegate.getActivityDays(payload.actorId, payload.activityId);
                        if (!this._keepsRolledActivityDays(payload.actorId, payload.activityId, current + payload.delta)) break;
                    }
                    this._budgetDelegate.stepDays(payload.actorId, payload.activityId, payload.delta);
                    this._syncDraftDCs();
                }
                break;
            }
            case "AUTO_REST": {
                if (payload.actorId) {
                    this._budgetDelegate.autoRest(payload.actorId);
                    this._syncDraftDCs();
                }
                break;
            }
            case "CLEAR_ACTIVITY": {
                if (payload.actorId && payload.activityId) {
                    if (!this._keepsRolledActivityDays(payload.actorId, payload.activityId, 0)) break;
                    this._budgetDelegate.clearDays(payload.actorId, payload.activityId);
                    this._syncDraftDCs();
                }
                break;
            }
            case "SET_FOOD_NOMINATION": {
                if (payload.actorId) {
                    if (payload.itemId) {
                        this._foodNominations.set(payload.actorId, {
                            itemId: payload.itemId,
                            quantity: payload.quantity ?? this._campLogistics._foodDaysNeeded
                        });
                    } else {
                        this._foodNominations.delete(payload.actorId);
                    }
                }
                break;
            }
            case "SET_DEPARTURE_MEAL": {
                if (payload.actorId) {
                    if (payload.itemId) {
                        this._departureMeals.set(payload.actorId, payload.itemId);
                    } else {
                        this._departureMeals.delete(payload.actorId);
                    }
                }
                break;
            }
            case "SET_DEPARTURE_DRINK": {
                if (payload.actorId) {
                    if (payload.itemId) {
                        this._departureDrinks.set(payload.actorId, payload.itemId);
                    } else {
                        this._departureDrinks.delete(payload.actorId);
                    }
                }
                break;
            }
            case "TOGGLE_GATHERING_DAY": {
                if (payload.actorId) {
                    const currentSchedule = this._getOrCreateGatheringSchedule(payload.actorId);
                    const dayNum = Number(payload.day);
                    const existingEntry = currentSchedule.find(s => s.day === dayNum);
                    // Security guard: If any active day was already rolled, only the GM can toggle it!
                    const hasRolled = currentSchedule.some(s => s.rolled && s.mode !== "skip");
                    if (hasRolled || existingEntry?.rolled) {
                        break;
                    }
                    if (payload.schedule) {
                        const hadRolledMismatch = currentSchedule.some((s, idx) => s.rolled && payload.schedule[idx]?.mode !== s.mode);
                        if (!hadRolledMismatch) {
                            this._gatheringSchedule.set(payload.actorId, payload.schedule);
                        }
                    } else if (existingEntry) {
                        let nextMode;
                        if (existingEntry.mode === "forage") nextMode = "hunt";
                        else if (existingEntry.mode === "hunt") nextMode = "skip";
                        else nextMode = "forage";
                        existingEntry.mode = payload.mode ?? nextMode;
                        existingEntry.rolled = false;
                        existingEntry.rollTotal = null;
                        existingEntry.dc = null;
                        existingEntry.success = null;
                        existingEntry.yield = 0;
                    }
                }
                break;
            }
            case "ROLL_GATHERING_DAY": {
                // Deprecated: Individual rolls superseded by parallel Roll All
                break;
            }
            case "ROLL_ALL_GATHERING": {
                if (payload.actorId && Array.isArray(payload.schedule)) {
                    const currentSchedule = this._getOrCreateGatheringSchedule(payload.actorId);
                    const merged = currentSchedule.map(day => {
                        if (day.rolled) return day;
                        const incoming = payload.schedule.find(entry => entry.day === day.day);
                        return incoming?.rolled ? incoming : day;
                    });
                    this._gatheringSchedule.set(payload.actorId, merged);
                }
                break;
            }
            case "ROLL_ACTIVITY_DAY": {
                if (payload.actorId && payload.day && payload.rollData) {
                    const rolls = this._getOrCreateActivityRolls(payload.actorId);
                    const entry = rolls.find(r => r.day === Number(payload.day));
                    if (entry) {
                        Object.assign(entry, payload.rollData);
                    }
                    this._syncDraftDCs();
                }
                break;
            }
            case "ROLL_ALL_ACTIVITIES": {
                if (payload.actorId && Array.isArray(payload.rolls)) {
                    this._activityRolls.set(payload.actorId, payload.rolls);
                    this._syncDraftDCs();
                }
                break;
            }
            case "SET_SUSTENANCE_ROLE": {
                if (payload.actorId && payload.roleData) {
                    this._sustenanceRoles.set(payload.actorId, payload.roleData);
                }
                break;
            }
            case "ROLL_SUSTENANCE": {
                if (payload.actorId && payload.roleData) {
                    this._sustenanceRoles.set(payload.actorId, payload.roleData);
                }
                break;
            }
            case "COMMIT_ACTIVITIES": {
                if (payload.actorId) {
                    if (payload.committed) {
                        this._committedActorIds.add(payload.actorId);
                    } else {
                        this._committedActorIds.delete(payload.actorId);
                    }
                }
                break;
            }
            case "LOCK_MEALS": {
                if (payload.actorId) {
                    if (payload.locked) this._mealsLockedActorIds.add(payload.actorId);
                    else this._mealsLockedActorIds.delete(payload.actorId);
                }
                break;
            }
            case "APPLY_SENDOFF": {
                const row = this._sendoffRows().find(entry =>
                    entry.actorId === payload.actorId
                    && entry.kind === payload.kind
                    && entry.itemId === payload.itemId
                );
                void this._applySendoffRow(row);
                return;
            }
            case "SET_SUSTENANCE_PLAN": {
                if (payload.actorId && payload.plan) {
                    this._sustenanceEdits.set(payload.actorId, payload.plan);
                }
                break;
            }
            case "SET_FIRE_LEVEL": {
                if (payload.fireLevel) {
                    this._fireLevel = payload.fireLevel;
                    this._syncDraftDCs();
                }
                break;
            }
            case "WORKBENCH_STAGING": {
                this.applyWorkbenchStagingFromPlayer(payload);
                return;
            }
            case "WORKBENCH_ACK_DISMISS": {
                if (payload.actorId) {
                    this._workbench.dismissAcknowledgement(payload.actorId);
                    this._saveSessionState();
                    this._broadcastSync();
                }
                return;
            }
            default:
                Logger.warn(`${MODULE_ID} | Unrecognised Downtime delta:`, action);
        }

        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    onReceiveSync(state) {
        if (this._isGM) return;
        const priorFireLevel = this._fireLevel;
        DOWNTIME_STATE_SCHEMA.apply(this, state);
        if (this._fireLevel !== priorFireLevel) this._syncDraftDCs();
        if (state.workbenchStaging || state.workbenchAck || state.workbenchFocusCounts) {
            this.applyWorkbenchStateFromHost(state);
        } else {
            this.render();
        }
    }

    _broadcastSync() {
        if (!this._isGM) return;
        emitRestSessionSync("downtime", DOWNTIME_STATE_SCHEMA.serializeForPlayers(this));
    }

    _onWorkbenchStagingTouchedFromHook() {
        if (!this._isGM) return;
        emitRestSessionDelta("downtime", "WORKBENCH_STAGING", {
            staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
        });
    }

    applyWorkbenchStagingFromPlayer(data) {
        if (!data?.staging) return;
        for (const [actorId, st] of data.staging) {
            this._workbench.setStaging(actorId, {
                gearItemId: st.gearItemId,
                gearActorId: st.gearActorId,
                potionItemId: st.potionItemId,
                spellItemId: st.spellItemId,
                spellActorId: st.spellActorId
            });
        }
        this.render();
        this._saveSessionState();
    }

    applyWorkbenchStateFromHost(data) {
        this._workbenchIdentifyStaging = new Map(data.workbenchStaging ?? []);
        this._workbenchIdentifyAcknowledge = new Map(data.workbenchAck ?? []);
        if (data.workbenchFocusCounts) {
            this._workbenchFocusCounts = new Map(data.workbenchFocusCounts);
        }
        this._magicScanResults = data.magicScanResults ?? null;
        this._magicScanComplete = !!data.magicScanComplete;
        this.render();
    }
}

export function applyDowntimeSyncAndRenderHelpers(TargetClass) {
    for (const key of Object.getOwnPropertyNames(DowntimeSyncAndRenderMixin.prototype)) {
        if (key === "constructor") continue;
        Object.defineProperty(
            TargetClass.prototype,
            key,
            Object.getOwnPropertyDescriptor(DowntimeSyncAndRenderMixin.prototype, key)
        );
    }
}
