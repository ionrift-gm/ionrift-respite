export async function registerReadyTokenAndResumeFlow(ctx) {
    const {
        MODULE_ID, MODULE_LABEL, Logger, RespiteLog,
        refreshZzzOverlay, clearAllBeddingPoses, clampCampFloorTokenInPreUpdate,
        setRestSessionAfkEmitter, emitAfkSocket, setAfkUiRefresh,
        getActiveRestSetupApp, getActivePlayerRestApp, getActiveShortRestApp, getActiveAfkPanel,
        getPlayerRestActive, getRespiteFlowActive, setRespiteFlowActive,
        emitRequestRestState, getActiveRestSessionApp, BivouacApp, DowntimeLedgerApp, ShortRestApp,
        registerActiveShortRestApp, showAfkPanel, _maybeShowAmbientAfkPanelAtReady,
        clearCampTokens, resetCampSession, RestSetupApp, registerActiveRestApp, setActiveRestData,
        clearActiveRestApp, emitRestStarted, emitRestSnapshot, emitRestResolved,
        emitRestSessionAbandoned, initAfkBridge
    } = ctx;
    // Zzz overlay on tokens for characters bedded down during reflection.
    Hooks.on("refreshToken", (token) => {
        try {
            refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });
    // Flag-only updates (e.g. beddingDown) do not always trigger a token refresh on
    // all clients; sync the overlay when respite token flags change.
    Hooks.on("updateToken", (tokenDoc, change, _options, _userId) => {
        try {
            if (!change.flags?.[MODULE_ID]) return;
            const token = tokenDoc.object;
            if (!token) return;
            refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });
    Hooks.on("createToken", (token) => {
        try {
            refreshZzzOverlay(token);
        } catch {
            /* ignore */
        }
    });
    Hooks.on("canvasReady", () => {
        try {
            const placeables = canvas.tokens?.placeables;
            if (!placeables?.length) return;
            for (const token of placeables) {
                refreshZzzOverlay(token);
            }
        } catch {
            /* ignore */
        }
    });
    Hooks.on("ionrift.respite.restCleanup", async () => {
        try {
            await clearAllBeddingPoses();
        } catch (err) {
            console.warn(`${MODULE_ID} | restCleanup bedding removal failed:`, err);
        }
    });

    /** Block manual deletion of camp layout tokens during a rest (use Move fire in the rest window). */
    Hooks.on("preDeleteToken", (document, options, userId) => {
        try {
            if (options?.ionriftAllowCampDelete) return;
            const f = document.flags?.[MODULE_ID];
            if (!f?.isCampFurniture || f.isPlayerGear) return;
            const user = game.users.get(userId);
            if (user?.isGM) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campTokens.deleteBlockedGm"));
            } else {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.campTokens.deleteBlockedPlayer"));
            }
            return false;
        } catch {
            /* ignore */
        }
    });

    /** Block non-GM canvas drags for shared station tokens (belt-and-suspenders with TokenDocument#locked). */
    Hooks.on("preUpdateToken", (document, updateData, _options, userId) => {
        try {
            clampCampFloorTokenInPreUpdate(document, updateData);
        } catch {
            /* ignore */
        }
        try {
            const f = document.flags?.[MODULE_ID];
            if (!f?.isSharedStation) return;
            if (!("x" in updateData) && !("y" in updateData)) return;
            const user = game.users.get(userId);
            if (user?.isGM) return;
            return false;
        } catch {
            /* ignore */
        }
    });

    setRestSessionAfkEmitter(emitAfkSocket);
    setAfkUiRefresh(() => {
        void getActiveRestSetupApp()?.render?.();
        void getActivePlayerRestApp()?.render?.({ force: true });
        void getActiveShortRestApp()?.render?.({ force: true });
        void getActiveAfkPanel()?.render?.({ force: true });
    });

    // Player: request current rest state in case a rest is already active (GM may still be resuming after F5)
    if (!game.user.isGM) {
        const requestRestAndShortRestState = (label) => {
            RespiteLog.log(`${MODULE_ID} | Player requesting rest state (${label})...`);
            emitRequestRestState(game.user.id);
            import("../services/rest/session/RestSessionSync.js").then(m => m.emitRestSessionRequestState(game.user.id)).catch(() => {});
        };
        setTimeout(() => requestRestAndShortRestState("initial"), 1000);

        // Opens or refreshes the player-side window for a gritty session.
        // Reuses a live app so a repeated start or snapshot cannot stack
        // duplicate windows on the same client.
        const openOrSyncGrittyApp = (restType, state) => {
            const existing = getActiveRestSessionApp(restType);
            if (existing) {
                existing._rehydrate?.(state);
                void existing.render({ force: true });
                return;
            }
            const app = restType === "bivouac"
                ? new BivouacApp(state ?? {})
                : new DowntimeLedgerApp(state ?? {});
            app._rehydrate?.(state);
            void app.render({ force: true });
        };

        const openOrSyncShortRest = (state) => {
            const existing = getActiveRestSessionApp("shortrest") ?? getActiveShortRestApp();
            if (existing) {
                existing._rehydrate?.(state);
                void existing.render({ force: true });
                return;
            }
            const app = new ShortRestApp();
            app._rehydrate?.(state);
            registerActiveShortRestApp(app);
            void app.render({ force: true });
            void showAfkPanel();
        };

        // Listen for GM-initiated gritty rests (opens player UI)
        Hooks.on("respite:grittyRestStarted", ({ restType, data }) => {
            if (game.user.isGM) return;
            if (restType === "shortrest") {
                openOrSyncShortRest(data ?? {});
                return;
            }
            if (restType !== "bivouac" && restType !== "downtime") return;
            openOrSyncGrittyApp(restType, data ?? {});
        });

        // Listen for gritty snapshots (player F5 reconnect)
        Hooks.on("respite:grittySnapshot", ({ restType, state }) => {
            if (game.user.isGM) return;
            if (restType === "shortrest") {
                openOrSyncShortRest(state ?? {});
                return;
            }
            if (restType !== "bivouac" && restType !== "downtime") return;
            openOrSyncGrittyApp(restType, state ?? {});
        });
        setTimeout(() => {
            if (!getPlayerRestActive() && !getActiveShortRestApp()) {
                requestRestAndShortRestState("retry");
            }
        }, 4500);

        // Auto-resync when player returns from minimize/tab switch (debounced)
        let _lastResyncTime = 0;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                const now = Date.now();
                if (now - _lastResyncTime < 500) return;
                _lastResyncTime = now;
                if (getPlayerRestActive() && getActivePlayerRestApp()) {
                    RespiteLog.log(`${MODULE_ID} | Tab visible, resyncing rest state...`);
                    emitRequestRestState(game.user.id);
                }
                if (getActiveShortRestApp() || getActiveRestSessionApp("shortrest")) {
                    RespiteLog.log(`${MODULE_ID} | Tab visible, resyncing short rest state...`);
                    import("../services/rest/session/RestSessionSync.js")
                        .then(m => m.emitRestSessionRequestState(game.user.id))
                        .catch(() => {});
                }
                if (getActiveRestSessionApp("bivouac") || getActiveRestSessionApp("downtime")) {
                    RespiteLog.log(`${MODULE_ID} | Tab visible, resyncing gritty rest state...`);
                    import("../services/rest/session/RestSessionSync.js")
                        .then(m => m.emitRestSessionRequestState(game.user.id))
                        .catch(() => {});
                }
            }
        });
        _maybeShowAmbientAfkPanelAtReady();
        return;
    }

    // Detect rest-recovery module collision
    const restRecovery = game.modules.get("rest-recovery");
    if (restRecovery?.active) {
        Logger.warn?.(MODULE_LABEL,
            "rest-recovery module detected. Respite will defer HP/HD modification to rest-recovery and only handle events/activities."
        );
        game.settings.set(MODULE_ID, "restRecoveryDetected", true);
    } else {
        // Clear the flag if rest-recovery was previously active but has since been removed
        const wasDetected = game.settings.get(MODULE_ID, "restRecoveryDetected");
        if (wasDetected) {
            Logger.log?.(MODULE_LABEL, "rest-recovery no longer active. Resuming native rest recovery.");
            game.settings.set(MODULE_ID, "restRecoveryDetected", false);
        }
    }

    // Detect Quartermaster for item handoff
    const workshop = game.modules.get("ionrift-quartermaster");
    if (workshop?.active && workshop.api?.items) {
        Logger.log?.(MODULE_LABEL, "Quartermaster detected. Items will be normalized via WorkshopItemFactory.");
    } else {
        Logger.log?.(MODULE_LABEL, "Quartermaster not detected. Items will be created with minimal normalization.");
    }

    // Check for interrupted rest state saved in world settings
    const savedRest = game.settings.get(MODULE_ID, "activeRest");
    if (savedRest?.engine) {
        const age = Date.now() - (savedRest.timestamp ?? 0);
        const ageLabel = age < 3600000
            ? game.i18n.format("ionrift-respite.resume.minutesAgo", { count: Math.round(age / 60000) })
            : age < 86400000
                ? game.i18n.format("ionrift-respite.resume.hoursAgo", { count: Math.round(age / 3600000) })
                : game.i18n.format("ionrift-respite.resume.daysAgo", { count: Math.round(age / 86400000) });

        // Block new rest creation while the resume prompt is open
        setRespiteFlowActive(true);

        const isPastSetup = savedRest.phase && savedRest.phase !== "setup";
        const rewardWarning = isPastSetup
            ? game.i18n.localize("ionrift-respite.resume.rest.rewardWarning")
            : "";

        let resume = false;
        try {
            resume = await game.ionrift.library.confirm({
                title: game.i18n.localize("ionrift-respite.resume.rest.title"),
                content: game.i18n.format("ionrift-respite.resume.rest.content", {
                    age: ageLabel,
                    phase: savedRest.phase ?? game.i18n.localize("ionrift-respite.resume.unknown"),
                    terrain: savedRest.engine.terrainTag ?? game.i18n.localize("ionrift-respite.resume.unknown"),
                    warning: rewardWarning
                }),
                yesLabel: game.i18n.localize("ionrift-respite.resume.rest.yes"),
                noLabel: game.i18n.localize("ionrift-respite.resume.discard"),
                yesIcon: "fas fa-campground",
                noIcon: "fas fa-trash",
                defaultYes: true
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Resume dialog failed, clearing stale state:`, e);
            setRespiteFlowActive(false);
            await game.settings.set(MODULE_ID, "activeRest", {});
            clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on dialog error:`, err));
            resetCampSession();
        }

        if (resume) {
            try {
                const app = new RestSetupApp();
                const restored = await app._loadRestState();
                if (restored) {
                    registerActiveRestApp(app);
                    const restPayload = {
                        restId: savedRest.restId ?? `rest_${savedRest.timestamp ?? Date.now()}`,
                        terrainTag: app._engine?.terrainTag,
                        comfort: app._engine?.comfort,
                        restType: app._engine?.restType,
                        phase: app._phase,
                        fireLevel: app._fireLevel ?? "unlit",
                        coldCampDecided: !!app._coldCampDecided,
                        safeRestSpot: !!app._engine?.safeRestSpot,
                        tavernTotmOverride: !!app._tavernTotmOverride,
                        activities: app._activities ?? [],
                        recipes: app._craftingEngine?.recipes
                            ? Object.fromEntries(app._craftingEngine.recipes)
                            : {}
                    };
                    app._restId = restPayload.restId;
                    setActiveRestData(restPayload);

                    let resumeUiOk = true;
                    try {
                        if (app._phase === "activity") {
                            await app.applyRestoredPhaseUi();
                        } else {
                            await Promise.resolve(app.render({ force: true }));
                        }
                    } catch (e) {
                        clearActiveRestApp();
                        console.error(`${MODULE_ID} | Failed to open restored rest UI:`, e);
                        ui.notifications.warn(
                            game.i18n.localize("ionrift-respite.resume.rest.openFailed")
                        );
                        resumeUiOk = false;
                    }

                    if (resumeUiOk) {
                        ui.notifications.info(game.i18n.localize("ionrift-respite.resume.rest.resumed"));
                        Logger.log?.(MODULE_LABEL, "Restored interrupted rest from world flags.");

                        setTimeout(() => {
                            const snapshot = app.getRestSnapshot?.() ?? null;
                            emitRestStarted(restPayload, snapshot ? { snapshot } : {});
                            if (snapshot) {
                                setTimeout(() => emitRestSnapshot(snapshot), 200);
                            }
                        }, 500);
                    }
                } else {
                    setRespiteFlowActive(false);
                    ui.notifications.warn(game.i18n.localize("ionrift-respite.resume.rest.restoreFailed"));
                    await game.settings.set(MODULE_ID, "activeRest", {});
                    clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on failed restore:`, err));
                    resetCampSession();
                }
            } catch (e) {
                setRespiteFlowActive(false);
                console.error(`${MODULE_ID} | Failed to restore rest state:`, e);
                await game.settings.set(MODULE_ID, "activeRest", {});
                clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on restore error:`, err));
                resetCampSession();
            }
        } else {
            setRespiteFlowActive(false);
            await game.settings.set(MODULE_ID, "activeRest", {});
            emitRestResolved();
            clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup on discard failed:`, err));
            resetCampSession();
            Logger.log?.(MODULE_LABEL, "Discarded interrupted rest.");
        }
    }

    // Check for interrupted gritty rest (Bivouac or Downtime Ledger)
    const isAlreadyRunning = Boolean(getActiveRestSessionApp?.("downtime") || getActiveRestSessionApp?.("bivouac") || document.getElementById("respite-gm-rest-bar"));
    if (!getRespiteFlowActive() && !isAlreadyRunning) {
        try {
            const savedGritty = game.settings.get(MODULE_ID, "activeGrittyRest");
            if (savedGritty?.type) {
                const age = Date.now() - (savedGritty.timestamp ?? 0);
                const ageLabel = age < 3600000
                    ? game.i18n.format("ionrift-respite.resume.minutesAgo", { count: Math.round(age / 60000) })
                    : age < 86400000
                        ? game.i18n.format("ionrift-respite.resume.hoursAgo", { count: Math.round(age / 3600000) })
                        : game.i18n.format("ionrift-respite.resume.daysAgo", { count: Math.round(age / 86400000) });

                const typeLabel = savedGritty.type === "bivouac" ? game.i18n.localize("ionrift-respite.resume.gritty.typeBivouac") : game.i18n.localize("ionrift-respite.resume.gritty.typeDowntime");
                let resume = false;
                try {
                    resume = await game.ionrift.library.confirm({
                        title: game.i18n.localize("ionrift-respite.resume.gritty.title"),
                        content: game.i18n.format("ionrift-respite.resume.gritty.content", {
                            type: typeLabel,
                            age: ageLabel,
                            terrain: savedGritty.terrainTag ?? game.i18n.localize("ionrift-respite.resume.unknown")
                        }),
                        yesLabel: game.i18n.localize("ionrift-respite.resume.gritty.yes"),
                        noLabel: game.i18n.localize("ionrift-respite.resume.discard"),
                        yesIcon: "fas fa-campground",
                        noIcon: "fas fa-trash",
                        defaultYes: true
                    });
                } catch (e) {
                    console.error(`${MODULE_ID} | Gritty resume dialog failed:`, e);
                    await game.settings.set(MODULE_ID, "activeGrittyRest", {});
                }

                if (resume) {
                    if (savedGritty.type === "bivouac") {
                        const app = new BivouacApp(savedGritty);
                        app._rehydrate?.(savedGritty);
                        app.render({ force: true });
                    } else {
                        const app = new DowntimeLedgerApp(savedGritty);
                        app._rehydrate?.(savedGritty);
                        app.render({ force: true });
                    }
                    ui.notifications.info(game.i18n.localize("ionrift-respite.resume.gritty.resumed"));
                } else {
                    await game.settings.set(MODULE_ID, "activeGrittyRest", {});
                }
            }
        } catch (e) {
            // Setting may not be registered yet on first load
            console.warn(`${MODULE_ID} | Gritty rest resume check skipped:`, e.message);
        }
    }

    const savedShortRest = game.settings.get(MODULE_ID, "activeShortRest");
    if (savedShortRest?.timestamp && !getRespiteFlowActive()) {
        const age = Date.now() - (savedShortRest.timestamp ?? 0);
        const ageLabel = age < 3600000
            ? game.i18n.format("ionrift-respite.resume.minutesAgo", { count: Math.round(age / 60000) })
            : age < 86400000
                ? game.i18n.format("ionrift-respite.resume.hoursAgo", { count: Math.round(age / 3600000) })
                : game.i18n.format("ionrift-respite.resume.daysAgo", { count: Math.round(age / 86400000) });

        setRespiteFlowActive(true);

        let resume = false;
        try {
            resume = await game.ionrift.library.confirm({
                title: game.i18n.localize("ionrift-respite.resume.short.title"),
                content: game.i18n.format("ionrift-respite.resume.short.content", {
                    age: ageLabel,
                    shelter: savedShortRest.activeShelter ?? game.i18n.localize("ionrift-respite.resume.none")
                }),
                yesLabel: game.i18n.localize("ionrift-respite.resume.short.yes"),
                noLabel: game.i18n.localize("ionrift-respite.resume.discard"),
                yesIcon: "fas fa-mug-hot",
                noIcon: "fas fa-trash",
                defaultYes: true
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Short rest resume dialog failed:`, e);
            setRespiteFlowActive(false);
            await game.settings.set(MODULE_ID, "activeShortRest", {});
        }

        if (resume) {
            try {
                const app = new ShortRestApp({ initialShelter: savedShortRest.activeShelter ?? "none" });
                const restored = app._loadShortRestState();
                if (restored) {
                    registerActiveShortRestApp(app);
                    app.render({ force: true });
                    ui.notifications.info(game.i18n.localize("ionrift-respite.resume.short.resumed"));
                    Logger.log?.(MODULE_LABEL, "Restored interrupted short rest from world settings.");
                } else {
                    setRespiteFlowActive(false);
                    ui.notifications.warn(game.i18n.localize("ionrift-respite.resume.short.restoreFailedFresh"));
                    await game.settings.set(MODULE_ID, "activeShortRest", {});
                }
            } catch (e) {
                setRespiteFlowActive(false);
                console.error(`${MODULE_ID} | Failed to restore short rest state:`, e);
                await game.settings.set(MODULE_ID, "activeShortRest", {});
            }
        } else {
            setRespiteFlowActive(false);
            await game.settings.set(MODULE_ID, "activeShortRest", {});
            emitRestSessionAbandoned("shortrest");
            Logger.log?.(MODULE_LABEL, "Discarded interrupted short rest.");
        }
    }

    // When combat ends and a rest is awaiting combat resolution, resume the rest flow
    Hooks.on("deleteCombat", (combat, options, userId) => {
        if (getActiveRestSetupApp()?._awaitingCombat) {
            getActiveRestSetupApp()._awaitingCombat = false;
            getActiveRestSetupApp()._combatAcknowledged = true;
            getActiveRestSetupApp()._saveRestState();
            getActiveRestSetupApp().render({ force: true });
            ui.notifications.info(game.i18n.localize("ionrift-respite.combat.resolvedRestProceeds"));
            Logger.log?.(MODULE_LABEL, "Combat ended, rest flow unblocked.");
        }
        const grittyDowntime = getActiveRestSessionApp?.("downtime");
        if (grittyDowntime?._awaitingCombat) {
            grittyDowntime._awaitingCombat = false;
            grittyDowntime._completedCombatNights.add(grittyDowntime._activePacingNight);
            grittyDowntime._saveSessionState();
            grittyDowntime._broadcastSync();
            grittyDowntime.render({ force: true });
            ui.notifications.info(game.i18n.format("ionrift-respite.combat.resolvedNight", { night: grittyDowntime._activePacingNight }));
            Logger.log?.(MODULE_LABEL, `Night ${grittyDowntime._activePacingNight} combat ended, downtime flow resumed.`);
        }
    });

    _maybeShowAmbientAfkPanelAtReady();

    initAfkBridge();

    RespiteLog.log(`${MODULE_ID} | Boot complete.`);
    if (game.user.isGM) {
        RespiteLog.log("  game.ionrift.respite.fillRestParty()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.openPreview()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.debugAnimation()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.watchAnimation()");
        RespiteLog.log("  ,  game.ionrift.respite.rollRequest.forceDcPulseTest()");
    }
}

export function registerDnd5eRestHooks(ctx) {
    const {
        MODULE_ID, MODULE_LABEL, getLogger, getRespiteFlowActive,
        isNativeShortRestUnsuppressed, canStartRest, RestSetupApp, reassertMealExhaustionFloor
    } = ctx;
    /**
     * Block player-initiated rests when interception is enabled.
     * GMs can always rest normally. Players see a notification
     * directing them to the GM-managed Respite flow.
     */
    function _blockPlayerRest(actor, config) {
        if (game.user.isGM) return true;
        if (!game.settings.get(MODULE_ID, "interceptRests")) return true;
    
        ui.notifications.warn(
            game.i18n.localize("ionrift-respite.restStart.playerRestBlocked")
        );
        return false;
    }
    
    Hooks.on("dnd5e.preShortRest", _blockPlayerRest);
    Hooks.on("dnd5e.preLongRest", _blockPlayerRest);
    
    /**
     * Funnel a rest initiated on the primary party group actor into the Respite
     * flow instead of the system's native group rest. From Foundry v14 the party
     * is a native group actor whose sheet exposes Short/Long Rest buttons; those
     * call initiateRest on the group, firing dnd5e.preShortRest / preLongRest.
     * Returning false there cancels the native group rest. Only the designated
     * primary party is intercepted, and only for the GM (players are handled by
     * _blockPlayerRest). Individual actor rests are left to the system.
     * @param {Actor} actor - The actor being rested.
     * @param {"short"|"long"} type - Rest length.
     * @returns {boolean} false to cancel the native rest.
     */
    function _interceptPartyRest(actor, type) {
        if (actor?.type !== "group") return true;
        const party = game.actors?.party;
        if (!party || actor.id !== party.id) return true;
        if (!game.user.isGM) return true;
        if (!game.settings.get(MODULE_ID, "interceptRests")) return true;
    
        // Cancel the native group rest regardless; only launch when one can start.
        if (canStartRest(type)) {
            new RestSetupApp({ restType: type }).render({ force: true });
        }
        return false;
    }
    
    Hooks.on("dnd5e.preShortRest", (actor) => _interceptPartyRest(actor, "short"));
    Hooks.on("dnd5e.preLongRest", (actor) => _interceptPartyRest(actor, "long"));
    
    /**
     * DnD5e rest hook: suppress default HP/HD recovery when Respite is managing it.
     * This fires BEFORE the system applies its own recovery.
     * We zero out HP and HD restoration so the system doesn't double-apply.
     * Spell slots, class features, and other recharges are left untouched.
     */
    Hooks.on("dnd5e.preRestCompleted", (actor, result, config) => {
        if (!getRespiteFlowActive()) return true;
        if (isNativeShortRestUnsuppressed()) return true;
    
        // Suppress HP recovery: system would set hp to max, we zero the delta and strip the payload
        if (result.dhp !== undefined) result.dhp = 0;
        if (result.deltas?.hitPoints !== undefined) result.deltas.hitPoints = 0;
        // Flat dot-notation keys (v3 direct assignment in _getRestHitPointRecovery)
        delete result.updateData?.["system.attributes.hp.value"];
        delete result.updateData?.["system.attributes.hp.temp"];
        delete result.updateData?.["system.attributes.hp.tempmax"];
        // Nested keys: DnD5e v5 mergeObject expands dot-notation into an object tree
        if (result.updateData?.system?.attributes?.hp) {
            delete result.updateData.system.attributes.hp;
        }
    
        // Suppress HD recovery: zero out the array of restored HD
        // v3: "system.hitDiceUsed", v4+: "system.hd.spent"
        if (result.dhd !== undefined) result.dhd = 0;
        if (result.deltas?.hitDice !== undefined) result.deltas.hitDice = 0;
        if (Array.isArray(result.updateItems)) {
            result.updateItems = result.updateItems.filter(u => {
                return !("system.hitDiceUsed" in u) && !("system.hd.spent" in u);
            });
        }
    
        // Suppress exhaustion recovery: Respite handles this via RecoveryHandler.
        // v5+: system reads config.exhaustionDelta to decide reduction.
        if (config.exhaustionDelta) config.exhaustionDelta = 0;
        // v5+ delta reporting (system applies this independently of updateData)
        if (result.deltas?.exhaustion !== undefined) result.deltas.exhaustion = 0;
        // Flat key (v3)
        delete result.updateData?.["system.attributes.exhaustion"];
        // Nested key (v5 mergeObject expansion)
        if (result.updateData?.system?.attributes?.exhaustion !== undefined) {
            delete result.updateData.system.attributes.exhaustion;
        }
    
        getLogger()?.log?.(MODULE_LABEL,
            `Suppressed default HP/HD/exhaustion recovery for ${actor.name} (Respite flow active).`
        );
        return true;
    });
    
    Hooks.on("dnd5e.restCompleted", (actor) => {
        if (!getRespiteFlowActive()) return;
        void reassertMealExhaustionFloor(actor);
    });
    
}
