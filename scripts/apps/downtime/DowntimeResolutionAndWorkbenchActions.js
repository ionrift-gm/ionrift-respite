import { getPartyActors } from "../../services/party/partyActors.js";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { DowntimeBatchEngine } from "../../services/downtime/DowntimeBatchEngine.js";
import { CalendarHandler } from "../../services/rest/session/CalendarHandler.js";
import {
    emitRestSessionDelta,
    emitRestSessionResolved
} from "../../services/rest/session/RestSessionSync.js";
import {
    applySendoffServing,
    collectSendoffRows,
    holdsForSendoff
} from "../../services/rest/gritty/SendoffBuffBeat.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { pickPoolEvent } from "../events/AdHocEventDialogs.js";
import { listPoolEventsForTerrain, loadAllCatalogEvents } from "../../services/events/catalog/EventCatalogLoader.js";
import { _showGmRestIndicator } from "../../module.js";
import { purgeDetectMagicRestArtifacts } from "../delegates/crafting/DetectMagicDelegate.js";

class DowntimeResolutionMixin {
    _sendoffRows() {
        return collectSendoffRows({
            actors: getPartyActors(),
            meals: this._departureMeals,
            drinks: this._departureDrinks,
            applied: this._sendoffApplied ?? []
        });
    }

    _sendoffPending() {
        return this._sendoffRows().filter(row => !row.applied).length;
    }

    _sendoffRoster() {
        return this._sendoffRows().map(row => ({
            ...row,
            canApply: !row.applied && this._canEditMeals(row.actorId)
        }));
    }

    _rememberSendoff(record) {
        const applied = [...(this._sendoffApplied ?? [])];
        const id = `${record.actorId}:${record.kind}:${record.itemId}`;
        const next = applied.filter(row => `${row.actorId}:${row.kind}:${row.itemId}` !== id);
        next.push(record);
        this._sendoffApplied = next;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    async _applySendoffRow(row) {
        if (!row || row.applied) return;
        if (!this._canEditMeals(row.actorId)) return;
        if (!this._isGM) {
            emitRestSessionDelta("downtime", "APPLY_SENDOFF", {
                actorId: row.actorId,
                kind: row.kind,
                itemId: row.itemId
            });
            return;
        }
        const actor = typeof game.actors?.get === "function" ? game.actors.get(row.actorId) : null;
        const partyIds = getPartyActors().map(member => member.id);
        const outcome = await applySendoffServing({
            actor,
            itemId: row.itemId,
            kind: row.kind,
            partyIds
        });
        if (!outcome.ok) {
            ui.notifications?.warn?.(outcome.resultLine || "Could not serve that.");
            return;
        }
        this._rememberSendoff(outcome.record);
    }
}

export class DowntimeResolutionActions {
    static async onPickPoolNightEvent(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const resolver = await this._getEventResolver();
        let poolEvents = listPoolEventsForTerrain(resolver, this._terrainTag);
        if (!poolEvents.length) {
            try {
                const all = await loadAllCatalogEvents();
                resolver.load([], all);
                poolEvents = listPoolEventsForTerrain(resolver, this._terrainTag);
            } catch {}
        }

        if (!poolEvents.length) {
            ui.notifications?.warn("No events in the curated pool for this terrain. Curate the pool in settings first.");
            return;
        }

        const terrain = TerrainRegistry.get(this._terrainTag);
        const terrainLabel = terrain?.label ?? this._terrainTag;
        const eventId = await pickPoolEvent(poolEvents, terrainLabel, this._terrainTag);
        if (!eventId) return;

        const catalogEvent = resolver.events.get(eventId) ?? poolEvents.find(e => e.id === eventId);
        if (!catalogEvent) return;

        const isCombat = catalogEvent.category === "encounter" || catalogEvent.category === "combat" || catalogEvent.tier === "disaster";
        entry.isRolled = true;
        entry.triggered = true;
        entry.forcedSafe = false;
        entry.state = isCombat ? "red" : "amber";
        entry.isDisaster = catalogEvent.tier === "disaster";
        entry.category = catalogEvent.category ?? "discovery";
        entry.event = {
            title: catalogEvent.name,
            description: catalogEvent.description,
            category: catalogEvent.category,
            isDisaster: entry.isDisaster,
            mechanical: catalogEvent.mechanical,
            id: catalogEvent.id,
            terrainTag: this._terrainTag,
            sentryName: entry.sentryName ?? "Camp Watch",
            sentrySurprised: false
        };

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onSetNightQuiet(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        entry.isRolled = true;
        entry.forcedSafe = true;
        entry.triggered = false;
        entry.state = "green";
        entry.isDisaster = false;
        entry.category = "ambient";
        entry.event = null;

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }


    static onSetNightSeverity(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night) || this._activePacingNight || 1;
        const state = target.dataset.state;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry || !state) return;

        entry.isRolled = true;
        entry.forcedSafe = (state === "green");
        entry.state = state;
        entry.isDisaster = false;
        entry.triggered = (state !== "green");

        if (state === "green") {
            entry.category = "ambient";
            entry.event = null;
        } else if (state === "amber") {
            entry.category = "discovery";
            entry.event = {
                title: game.i18n.localize("ionrift-respite.downtimeLedger.nocturnalEncounter"),
                description: game.i18n.format("ionrift-respite.downtimeLedger.strangeSoundsApproach", { terrain: this._terrainTag }),
                category: "discovery",
                isDisaster: false,
                terrainTag: this._terrainTag,
                sentryName: entry.sentryName ?? "Camp Watch",
                sentrySurprised: false
            };
        } else if (state === "red") {
            entry.category = "combat";
            entry.event = {
                title: game.i18n.localize("ionrift-respite.downtimeLedger.hostileAmbush"),
                description: game.i18n.format("ionrift-respite.downtimeLedger.hostileFoesAssault", { terrain: this._terrainTag }),
                category: "encounter",
                isDisaster: false,
                terrainTag: this._terrainTag,
                sentryName: entry.sentryName ?? "Camp Watch",
                sentrySurprised: entry.sentrySurprised ?? false
            };
        }

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async onToggleNightsVariant(_event, _target) {
        if (!this._isGM) return;
        this._totalNights = this._totalNights === 1 ? 7 : 1;
        this._activePacingNight = 1;
        await this._initEncounterDraft();
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }
    static onSetPacingNight(event, target) {
        const night = Number(target.dataset.night) || 1;
        const total = this._totalNights || (this._isGrittyLongRest ? 7 : 1);
        const maxStep = total + 1;
        if (!this._isGM) {
            const entry = this._encounterDraft?.find?.(e => e.nightIndex === night);
            const isVeiled = night > (this._activePacingNight || 1) && !entry?.isRolled;
            if (isVeiled) return;
        }
        if (this._isGM && total > 1 && night > total - 1 && this._sendoffPending() > 0) {
            this._sendoffOpen = true;
            this._activePacingNight = total - 1;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        if (night <= total - 1) this._sendoffOpen = false;
        this._activePacingNight = Math.max(1, Math.min(maxStep, night));
        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    }

    static onNextPacingNight(_event, _target) {
        if (!this._isGM) return;
        const total = this._totalNights || (this._isGrittyLongRest ? 7 : 1);
        const maxStep = total + 1;
        if (this._sendoffOpen) {
            if (this._sendoffPending() > 0) {
                ui.notifications?.warn?.("Apply each meal and drink before the last watch.");
                return;
            }
            this._sendoffOpen = false;
            this._activePacingNight = total;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        if (holdsForSendoff({
            totalNights: total,
            activeNight: this._activePacingNight,
            pending: this._sendoffPending()
        })) {
            this._sendoffOpen = true;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        this._activePacingNight = Math.min(maxStep, this._activePacingNight + 1);
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onPreviousPacingNight(_event, _target) {
        if (!this._isGM) return;
        if (this._sendoffOpen) {
            this._sendoffOpen = false;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        this._activePacingNight = Math.max(1, this._activePacingNight - 1);
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async onApplyOneSendoffBuff(event, target) {
        const rowId = target?.dataset?.rowId;
        if (!rowId) return;
        const row = this._sendoffRows().find(entry => entry.id === rowId);
        await this._applySendoffRow(row);
    }

    static async onApplySendoffBuffs() {
        if (!this._isGM) return;
        for (const row of this._sendoffRows()) {
            if (!row.applied) await this._applySendoffRow(row);
        }
    }

    static async onMinimizeForCombat(_event, _target) {
        if (!this._isGM) return;
        this._awaitingCombat = true;
        this._saveSessionState();
        this._broadcastSync();
        _showGmRestIndicator(this);
        ui.notifications?.info?.(`Night ${this._activePacingNight} combat active. Respite minimized. Click 'Resume' in the status bar or complete combat on canvas.`);
        this.close({ retainGmRestApp: true });
    }

    static onCompleteCombatForNight(_event, _target) {
        if (!this._isGM) return;
        this._completedCombatNights.add(this._activePacingNight);
        this._awaitingCombat = false;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
        ui.notifications?.info?.(`Night ${this._activePacingNight} combat marked resolved.`);
    }

    static onToggleMustRollExhaustion(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.mustRoll = Boolean(target.checked);
        entry.waived = !entry.mustRoll;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onSetExhaustionAdvMode(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        const mode = target.dataset.mode;
        if (!actorId || !mode) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.advMode = mode;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async onRollActorExhaustionSave(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        await this._rollActorExhaustion(actorId);
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async onRollAllExhaustionSaves(_event, _target) {
        if (!this._isGM) return;
        const party = getPartyActors();
        for (const actor of party) {
            const entry = this._getOrCreateExhaustionEntry(actor);
            if (entry && entry.mustRoll && !entry.rolled) {
                await this._rollActorExhaustion(actor.id);
            }
        }
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onWaiveAllExhaustionSaves(_event, _target) {
        if (!this._isGM) return;
        const party = getPartyActors();
        for (const actor of party) {
            const entry = this._getOrCreateExhaustionEntry(actor);
            if (entry) {
                entry.mustRoll = false;
                entry.waived = true;
            }
        }
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onAdjustExhaustionDC(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        const delta = parseInt(target.dataset.delta, 10);
        if (!actorId || Number.isNaN(delta)) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.dc = Math.max(5, Math.min(30, (entry.dc ?? 10) + delta));
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onChangeExhaustionDCInput(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        const val = parseInt(target.value, 10);
        if (!actorId || Number.isNaN(val)) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.dc = Math.max(5, Math.min(30, val));
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onToggleExhaustionOverride(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId || target.closest("[data-actor-id]")?.dataset?.actorId;
        if (!actorId) return;
        if (!this._expandedExhaustionOverrides) this._expandedExhaustionOverrides = new Set();
        if (this._expandedExhaustionOverrides.has(actorId)) {
            this._expandedExhaustionOverrides.delete(actorId);
        } else {
            this._expandedExhaustionOverrides.add(actorId);
        }
        this.render();
    }

    static async onResolveDowntime(_event, _target) {
        if (!this._isGM) return;

        const party = getPartyActors();
        const pendingExhaustion = party.filter(actor => {
            const entry = this._exhaustionDraft?.get(actor.id);
            return entry?.mustRoll && !entry.rolled;
        });
        if (pendingExhaustion.length > 0) {
            ui.notifications?.warn(`Roll or waive the remaining exhaustion saves before completing the rest (${pendingExhaustion.length} still open).`);
            return;
        }

        if (this._sendoffPending() > 0) {
            ui.notifications?.warn?.("Apply each meal and drink before completing the rest.");
            const total = this._totalNights || 7;
            if (total > 1) this._activePacingNight = total - 1;
            this._sendoffOpen = true;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }

        const unready = this._unreadyParty();

        if (unready.length > 0) {
            ui.notifications?.warn(`Cannot resolve downtime: Party is not ready: ${unready.join(", ")}.`);
            return;
        }

        const conditions = this._buildCampConditionsBar();
        const effectiveCampComfort = conditions?.safeRestSpot ? "safe" : (conditions?.campComfort ?? "rough");

        // 1. Resolve 2-phase sequence, supply commissary, and full recovery
        const result = await DowntimeBatchEngine.resolveDowntime({
            partyActors: party,
            budgetDelegate: this._budgetDelegate,
            haven: this._budgetDelegate.haven,
            fireLevel: this._fireLevel,
            campComfort: effectiveCampComfort,
            terrainTag: this._terrainTag,
            foodDaysNeeded: this._campLogistics._foodDaysNeeded,
            patronSuppliedDays: this._patronSuppliedDays,
            foodNominations: this._foodNominations,
            departureMeals: this._departureMeals,
            sendoffApplied: this._sendoffApplied ?? [],
            gatheringSchedule: this._gatheringSchedule,
            sustenanceRoles: this._gatheringSchedule,
            forageDC: this._campLogistics._forageDC,
            huntDC: this._campLogistics._huntDC,
            activityRolls: this._activityRolls,
            encounterResults: this._encounterDraft,
            enforceBedroll: this._campLogistics._enforceBedroll,
            enforceTent: this._campLogistics._enforceTent,
            enforceMessKit: this._campLogistics._enforceMessKit,
            exhaustionResults: Array.from((this._exhaustionDraft ?? new Map()).entries()).map(([actorId, entry]) => ({
                actorId,
                mustRoll: entry.mustRoll,
                waived: entry.waived,
                rolled: entry.rolled,
                passed: entry.passed,
                gainLevel: (entry.mustRoll && entry.rolled && !entry.passed) ? 1 : 0
            }))
        });

        // 2. Advance calendar (7 days = 10,080 minutes)
        await CalendarHandler.advanceRestTime("long");
        await CalendarHandler.recordRestDate({ announce: false });

        // 3. Render and post Master Chat Card
        const templateData = DowntimeResolutionActions._curateMasterCardData(
            result,
            this._budgetDelegate.haven,
            this._terrainTag,
            this._fireLevel,
            effectiveCampComfort
        );
        const cardHtml = await renderTemplate("modules/ionrift-respite/templates/downtime/master-card.hbs", templateData);

        await ChatMessage.create({
            content: cardHtml,
            speaker: { alias: this._budgetDelegate?.haven === "civilized" ? game.i18n.localize("ionrift-respite.downtimeLedger.respiteSevenDaySafeRest") : game.i18n.localize("ionrift-respite.downtimeLedger.respiteSevenDayCamp") }
        });

        ui.notifications.info(game.i18n.format("ionrift-respite.downtimeLedger.infoSevenDayRestResolved", { type: this._budgetDelegate?.haven === "civilized" ? game.i18n.localize("ionrift-respite.downtimeLedger.sevenDaySafeRest") : game.i18n.localize("ionrift-respite.downtimeLedger.sevenDayCamp") }));
        if (this._detectMagic) {
            await purgeDetectMagicRestArtifacts(party);
        }
        emitRestSessionResolved("downtime", result);
        this.close({ resolved: true });
    }

    static _curateMasterCardData(result, haven, terrainTag, fireLevel, campComfort) {
        const bannerContext = ImageResolver.resolveRestBannerContext(terrainTag, "resolve");
        const bannerFireClass = ImageResolver.bannerFireClass(fireLevel);
        const showBanner = !bannerContext.hideTerrainBanner && !!bannerContext.terrainBanner;

        const isCivilized = haven === "civilized";
        const terrainEntry = terrainTag ? TerrainRegistry.get(terrainTag) : null;
        const terrainLabel = terrainEntry?.label ?? (terrainTag ? (terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1)) : (isCivilized ? game.i18n.localize("ionrift-respite.downtimeLedger.civilizedHaven") : game.i18n.localize("ionrift-respite.downtimeLedger.wilderness")));
        const comfortLabels = {
            get safe() { return game.i18n.localize("ionrift-respite.downtimeLedger.safeSpot"); },
            get rough() { return game.i18n.localize("ionrift-respite.downtimeLedger.roughCamp"); },
            get hostile() { return game.i18n.localize("ionrift-respite.downtimeLedger.hostileGround"); }
        };
        const comfortLabel = comfortLabels[campComfort] ?? game.i18n.localize("ionrift-respite.downtimeLedger.campFallback");
        const subtitle = isCivilized
            ? game.i18n.localize("ionrift-respite.downtimeLedger.civilizedMasterSubtitle")
            : game.i18n.format("ionrift-respite.downtimeLedger.wildernessMasterSubtitle", { terrain: terrainLabel, comfort: comfortLabel });

        const anySetback = result.characters.some(c =>
            c.notes?.some(n =>
                n.toLowerCase().includes("failed") ||
                n.toLowerCase().includes("starvation") ||
                n.toLowerCase().includes("dehydration")
            )
        );

        const partyStatus = anySetback
            ? { label: game.i18n.localize("ionrift-respite.downtimeLedger.setbacksIncurred"), icon: "fas fa-triangle-exclamation", class: "setback" }
            : { label: game.i18n.localize("ionrift-respite.downtimeLedger.sevenDayRestComplete"), icon: "fas fa-sparkles", class: "positive" };

        const characters = result.characters.map(char => {
            let roleLabel = "Rest";
            let roleIcon = "fas fa-bed";
            const sumStr = (char.activitiesSummary || []).join(" ").toLowerCase();
            if (sumStr.includes("gathering") || sumStr.includes("forage") || sumStr.includes("hunt")) {
                roleLabel = "Gather";
                roleIcon = "fas fa-seedling";
            } else if (sumStr.includes("cook")) {
                roleLabel = "Cook";
                roleIcon = "fas fa-utensils";
            } else if (sumStr.includes("tend")) {
                roleLabel = "Heal";
                roleIcon = "fas fa-heart-pulse";
            } else if (sumStr.includes("fortify")) {
                roleLabel = "Fortify";
                roleIcon = "fas fa-shield";
            } else if (sumStr.includes("fletch")) {
                roleLabel = "Fletch";
                roleIcon = "fas fa-feather";
            } else if (sumStr.includes("brew")) {
                roleLabel = "Brew";
                roleIcon = "fas fa-flask";
            } else if (sumStr.includes("train")) {
                roleLabel = "Train";
                roleIcon = "fas fa-dumbbell";
            } else if (sumStr.includes("craft")) {
                roleLabel = "Craft";
                roleIcon = "fas fa-hammer";
            }

            const hasSetback = char.notes?.some(n =>
                n.toLowerCase().includes("failed") ||
                n.toLowerCase().includes("starvation") ||
                n.toLowerCase().includes("dehydration")
            );
            const statusPill = hasSetback
                ? { label: game.i18n.localize("ionrift-respite.downtimeLedger.setback"), icon: "fas fa-triangle-exclamation", class: "setback" }
                : { label: game.i18n.localize("ionrift-respite.downtimeLedger.fullRecovery"), icon: "fas fa-sparkles", class: "positive" };

            const rollGroupsMap = new Map();
            for (const r of (char.rolls || [])) {
                const act = r.activity || "Check";
                if (!rollGroupsMap.has(act)) {
                    rollGroupsMap.set(act, { activity: act, checks: [] });
                }
                const group = rollGroupsMap.get(act);
                for (const c of (r.checks || [])) {
                    group.checks.push({
                        day: r.day,
                        total: c.total,
                        yield: c.yield,
                        success: c.success,
                        detail: c.detail
                    });
                }
            }
            const groupedRolls = Array.from(rollGroupsMap.values());
            const totalRollCount = groupedRolls.reduce((sum, g) => sum + g.checks.length, 0);

            const notes = (char.notes || []).map(note => {
                let icon = "fas fa-circle-info";
                let color = "#94a3b8";
                const lower = note.toLowerCase();
                if (lower.includes("starvation")) {
                    icon = "fas fa-drumstick-bite";
                    color = "#f87171";
                } else if (lower.includes("dehydration")) {
                    icon = "fas fa-tint-slash";
                    color = "#f87171";
                } else if (lower.includes("failed")) {
                    icon = "fas fa-triangle-exclamation";
                    color = "#f87171";
                } else if (lower.includes("passed") || lower.includes("resisted") || lower.includes("recovered")) {
                    icon = "fas fa-shield";
                    color = "#34d399";
                }
                return { text: note, icon, color };
            });

            return {
                id: char.actor?.id,
                name: char.name,
                img: char.img,
                rolePill: { label: roleLabel, icon: roleIcon },
                statusPill,
                activitiesSummary: char.activitiesSummary || [],
                groupedRolls,
                totalRollCount,
                hasRolls: totalRollCount > 0,
                notes
            };
        });

        const encounters = (result.encounters || []).map(enc => {
            const isRewarding = enc.state === "amber" || enc.category === "ambient" || enc.event?.isRewarding;
            const isDanger = enc.state === "red" || enc.isDisaster;
            let itemClass = "ambient";
            let icon = "fas fa-compass";
            if (isDanger) {
                itemClass = "danger";
                icon = "fas fa-shield-halved";
            } else if (isRewarding) {
                itemClass = "rewarding";
                icon = "fas fa-sparkles";
            }
            return {
                nightIndex: enc.nightIndex,
                title: enc.event?.title ?? "Encounter",
                description: enc.event?.description ?? "",
                itemClass,
                icon,
                isRewarding
            };
        });

        const hasThreats = encounters.some(e => e.itemClass === "danger");
        const incidentsMeta = hasThreats
            ? { badgeIcon: "fas fa-shield-halved", badgeLabel: game.i18n.format("ionrift-respite.downtimeLedger.incidentsResolved", { count: encounters.length }), containerClass: "hostile" }
            : { badgeIcon: "fas fa-sparkles", badgeLabel: game.i18n.format("ionrift-respite.downtimeLedger.discoveriesLogged", { count: encounters.length }), containerClass: "ambient" };

        return {
            title: game.i18n.localize("ionrift-respite.downtimeLedger.sevenDayDowntimeComplete"),
            subtitle,
            terrainBanner: bannerContext.terrainBanner,
            terrainBannerFallback: bannerContext.terrainBannerFallback,
            terrainBannerPos: bannerContext.terrainBannerPos ?? "center",
            bannerFireClass,
            showBanner,
            partyStatus,
            incidentsMeta,
            encounters,
            characters,
            freshForageNote: result.summary?.freshForageNote ?? ""
        };
    }

    static onToggleIdentifyDrawer(event, target) {
        const actorId = target?.dataset?.actorId || target?.closest?.("[data-actor-id]")?.dataset?.actorId;
        if (!actorId) return;

        if (!this._expandedTiers.has(actorId)) {
            this._expandedTiers.set(actorId, new Set());
        }
        const expanded = this._expandedTiers.get(actorId);
        if (expanded.has("identify")) {
            expanded.delete("identify");
        } else {
            expanded.add("identify");
        }
        this.render();
    }

    static async onStationDetectMagicScan(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        await this._detectMagic.castDetectMagic(actorId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async onStationIdentifyScannedItem(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId) return;
        await this._detectMagic.identifyScannedItem(actorId, itemId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async onSubmitWorkbenchIdentify(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static onWorkbenchIdentifyRemovePotion(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        this._workbench.removePotionFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async onDismissWorkbenchIdentifyAck(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        const ack = this._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._workbench.dismissAcknowledgement(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("downtime", "WORKBENCH_ACK_DISMISS", { actorId });
        }
    }
}

export function applyDowntimeResolutionHelpers(TargetClass) {
    for (const key of Object.getOwnPropertyNames(DowntimeResolutionMixin.prototype)) {
        if (key === "constructor") continue;
        Object.defineProperty(
            TargetClass.prototype,
            key,
            Object.getOwnPropertyDescriptor(DowntimeResolutionMixin.prototype, key)
        );
    }
    TargetClass._curateMasterCardData = DowntimeResolutionActions._curateMasterCardData;
}
