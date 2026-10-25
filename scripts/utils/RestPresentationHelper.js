import * as RestAfkState from "../services/rest/session/RestAfkState.js";

/**
 * Presentation helper for Rest and Camp UIs (Bivouac, Short Rest, Downtime).
 * Provides consistent monogram badge styling, class subtitles, and party readiness pills.
 */

export class RestPresentationHelper {

    /**
     * Resolves presentation data (initial, theme colors, class subtitle) for an actor.
     * @param {Actor} actor
     * @returns {{
     *   initial: string,
     *   subtext: string,
     *   themeGradient: string,
     *   themeBorder: string
     * }}
     */
    static getActorPresentation(actor) {
        if (!actor) {
            return {
                initial: "?",
                subtext: "",
                themeGradient: "linear-gradient(135deg, #475569, #1e293b)",
                themeBorder: "rgba(255, 255, 255, 0.2)"
            };
        }

        const initial = (actor.name?.trim()?.[0] ?? "A").toUpperCase();

        // Extract class and subclass
        let subtext = "";
        let classKey = "";

        const classes = Object.values(actor.classes ?? {});
        if (classes.length) {
            const primary = classes[0];
            const className = primary.name ?? game.i18n.localize("ionrift-respite.presentation.adventurer");
            const level = primary.system?.levels ?? actor.system?.details?.level ?? 1;
            const subclassName = primary.subclass?.name ?? actor.itemTypes?.subclass?.[0]?.name ?? "";
            subtext = subclassName ? `${className} ${level} · ${subclassName}` : `${className} ${level}`;
            classKey = (primary.system?.identifier ?? primary.name ?? "").toLowerCase();
        } else {
            // Fallback for non-class actors or other systems
            const level = actor.system?.details?.level ?? "";
            subtext = level ? game.i18n.format("ionrift-respite.presentation.levelNumber", { level }) : "";
            classKey = (actor.name ?? "").toLowerCase();
        }

        // Color theme mapping matching the Ionrift Target Mockup
        let themeGradient = "linear-gradient(135deg, #475569, #1e293b)";
        let themeBorder = "rgba(255, 255, 255, 0.2)";

        if (classKey.includes("fight") || classKey.includes("barb")) {
            themeGradient = "linear-gradient(135deg, #991b1b, #451a03)";
            themeBorder = "rgba(239, 68, 68, 0.4)";
        } else if (classKey.includes("rang")) {
            themeGradient = "linear-gradient(135deg, #6b21a8, #3b0764)";
            themeBorder = "rgba(168, 85, 247, 0.4)";
        } else if (classKey.includes("wiz") || classKey.includes("art")) {
            themeGradient = "linear-gradient(135deg, #1e3a8a, #1e1b4b)";
            themeBorder = "rgba(96, 165, 250, 0.4)";
        } else if (classKey.includes("dru")) {
            themeGradient = "linear-gradient(135deg, #064e3b, #042f2e)";
            themeBorder = "rgba(52, 211, 153, 0.4)";
        } else if (classKey.includes("rog") || classKey.includes("monk")) {
            themeGradient = "linear-gradient(135deg, #374151, #111827)";
            themeBorder = "rgba(156, 163, 175, 0.4)";
        } else if (classKey.includes("pala") || classKey.includes("cler")) {
            themeGradient = "linear-gradient(135deg, #92400e, #451a03)";
            themeBorder = "rgba(251, 191, 36, 0.4)";
        } else if (classKey.includes("bard") || classKey.includes("sorc") || classKey.includes("warl")) {
            themeGradient = "linear-gradient(135deg, #581c87, #2e1065)";
            themeBorder = "rgba(192, 132, 252, 0.4)";
        }

        return {
            initial,
            subtext,
            themeGradient,
            themeBorder
        };
    }

    /**
     * Builds standard party roster pill data for the Party Readiness strip.
     * @param {Actor[]} party
     * @param {object} [options]
     * @param {Set<string>} [options.finishedActorIds]
     * @param {string} [options.currentUserId]
     * @returns {Array<object>}
     */
    static getPartyRosterPills(party, { finishedActorIds = new Set(), currentUserId = game.user?.id } = {}) {
        return (party ?? []).map(actor => {
            const pres = this.getActorPresentation(actor);
            const isUser = actor.isOwner;
            const isReady = finishedActorIds.has(actor.id);
            return {
                id: actor.id,
                name: actor.name,
                initial: pres.initial,
                themeGradient: pres.themeGradient,
                isUser,
                isReady
            };
        });
    }

    /**
     * Builds standardized party roster data for the unified {{> rosterStrip}} partial.
     * @param {Actor[]} party
     * @param {object} [options]
     * @param {string} [options.selectedCharacterId]
     * @param {Set<string>} [options.finishedActorIds]
     * @param {Set<string>} [options.finishedUserIds]
     * @param {Map<string, string>} [options.activityLabels]
     * @param {boolean} [options.isGM]
     * @returns {Array<object>}
     */
    static getPartyRoster(party, {
        selectedCharacterId = null,
        finishedActorIds = new Set(),
        finishedUserIds = null,
        activityLabels = new Map(),
        isGM = (typeof game !== "undefined" ? game.user?.isGM : false)
    } = {}) {
        const users = typeof game !== "undefined" ? (game.users?.contents ?? Array.from(game.users ?? [])) : [];
        return (party ?? []).map(actor => {
            const isOwner = isGM || actor.isOwner;
            let isAfk = false;
            try {
                if (typeof RestAfkState !== "undefined") {
                    isAfk = RestAfkState.isAfk(actor.id);
                }
            } catch {
                isAfk = false;
            }

            let isReady = finishedActorIds?.has?.(actor.id) ?? false;
            if (!isReady && finishedUserIds) {
                const ownerUser = users.find(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
                if (ownerUser && finishedUserIds.has(ownerUser.id)) {
                    isReady = true;
                }
            }

            const fullName = actor.name ?? "";
            const name = fullName.split(" ")[0] || fullName;
            const img = actor.img || "icons/svg/mystery-man.svg";
            const isSelected = selectedCharacterId ? actor.id === selectedCharacterId : false;
            const exhaustion = actor.system?.attributes?.exhaustion ?? 0;
            const activityLabel = activityLabels instanceof Map ? activityLabels.get(actor.id) : (activityLabels?.[actor.id] ?? null);

            return {
                id: actor.id,
                name,
                fullName,
                img,
                isOwner,
                isAfk,
                isReady,
                isSelected,
                exhaustion,
                activityLabel,
                source: isOwner ? "player" : "pending"
            };
        });
    }

    /**
     * Resolves presentation data for the unified {{> restHeader}} top bar across all rest interfaces.
     * @param {object} options
     * @param {"bivouac"|"short"|"downtime"|"long"} [options.type="long"]
     * @param {string} [options.terrainTag="forest"]
     * @param {string} [options.terrainLabel]
     * @param {string} [options.phase]
     * @param {string} [options.phaseLabel]
     * @param {Array<{label: string, active?: boolean, complete?: boolean}>} [options.phaseSteps]
     * @param {boolean} [options.pacingActive=false]
     * @param {number} [options.activePacingNight=1]
     * @param {string} [options.abandonAction]
     * @param {boolean} [options.isGM=false]
     * @param {boolean} [options.eventsCommitPending=false]
     * @returns {object}
     */
    static resolveRestHeaderContext({
        type = "long",
        terrainTag = "forest",
        terrainLabel = null,
        phase = null,
        phaseLabel = null,
        phaseSteps = null,
        pacingActive = false,
        activePacingNight = 1,
        totalNights = 7,
        isDawnCheck = false,
        abandonAction = null,
        isGM = (typeof game !== "undefined" ? Boolean(game.user?.isGM) : false),
        eventsCommitPending = false,
        canReturnToPlanning = true
    } = {}) {
        let restHeaderTitle = "";
        let restHeaderTag = "";
        let restHeaderTagClass = "";
        let restHeaderSubtitle = "";
        let resolvedSteps = phaseSteps ? [...phaseSteps] : [];
        let resolvedAbandonAction = abandonAction;

        const formattedTerrain = terrainLabel || (terrainTag ? terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1) : game.i18n.localize("ionrift-respite.presentation.wilderness"));

        switch (type) {
            case "bivouac":
                restHeaderTitle = game.i18n.localize("ionrift-respite.presentation.bivouac.title");
                restHeaderTag = game.i18n.format("ionrift-respite.presentation.bivouac.tag", { terrain: formattedTerrain });
                restHeaderTagClass = "tag-gritty tag-bivouac";
                restHeaderSubtitle = game.i18n.localize("ionrift-respite.presentation.bivouac.subtitle");
                resolvedAbandonAction = resolvedAbandonAction || "abandonBivouac";
                if (!resolvedSteps.length) {
                    resolvedSteps = [
                        { label: game.i18n.localize("ionrift-respite.presentation.bivouac.stepOperationsGear"), active: true, complete: false },
                        { label: game.i18n.localize("ionrift-respite.presentation.bivouac.stepHdRecovery"), active: false, complete: false }
                    ];
                }
                break;

            case "short":
                restHeaderTitle = game.i18n.localize("ionrift-respite.presentation.shortRest.title");
                restHeaderTag = game.i18n.format("ionrift-respite.presentation.shortRest.tag", { terrain: formattedTerrain });
                restHeaderTagClass = "tag-normal tag-short";
                restHeaderSubtitle = game.i18n.localize("ionrift-respite.presentation.shortRest.subtitle");
                resolvedAbandonAction = resolvedAbandonAction || "abandonShortRest";
                break;

            case "downtime":
                restHeaderTitle = pacingActive
                    ? (isDawnCheck ? game.i18n.localize("ionrift-respite.presentation.downtime.dawnCheck") : (totalNights === 1 ? game.i18n.localize("ionrift-respite.presentation.downtime.overnightVigil") : game.i18n.format("ionrift-respite.presentation.downtime.nightCount", { current: activePacingNight, total: totalNights })))
                    : "";
                restHeaderTag = formattedTerrain || game.i18n.localize("ionrift-respite.presentation.wilderness");
                restHeaderTagClass = "tag-gritty tag-downtime";
                restHeaderSubtitle = pacingActive
                    ? (isDawnCheck ? game.i18n.localize("ionrift-respite.presentation.downtime.subtitleDawn") : (totalNights === 1 ? game.i18n.localize("ionrift-respite.presentation.downtime.subtitleVigil") : game.i18n.localize("ionrift-respite.presentation.downtime.subtitlePacing")))
                    : game.i18n.localize("ionrift-respite.presentation.downtime.subtitleManagement");
                resolvedAbandonAction = resolvedAbandonAction || "abandonDowntime";
                break;

            case "long":
            default:
                restHeaderTitle = (phase === "activity" || phase === "meal") ? "" : (phaseLabel || game.i18n.localize("ionrift-respite.presentation.longRest.title"));
                restHeaderTag = formattedTerrain || game.i18n.localize("ionrift-respite.presentation.wilderness");
                restHeaderTagClass = "tag-normal tag-long";
                restHeaderSubtitle = game.i18n.localize("ionrift-respite.presentation.longRest.subtitle");
                resolvedAbandonAction = resolvedAbandonAction || "abandonRest";
                break;
        }

        let uiTheme = "glass";
        try {
            uiTheme = game.settings.get("ionrift-respite", "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        const isGlassTheme = uiTheme === "glass";
        const showDevUiToggle = Boolean(globalThis.DEBUG_RESPITE_UI_THEME_TOGGLE);

        return {
            restHeaderIcon: "fas fa-moon",
            restHeaderTitle,
            restHeaderTag,
            restHeaderTagClass,
            restHeaderSubtitle,
            phaseSteps: resolvedSteps,
            abandonAction: resolvedAbandonAction,
            isGM,
            eventsCommitPending,
            pacingActive,
            activePacingNight,
            canReturnToPlanning,
            isResolvePhase: phase === "resolve",
            isSetupPhase: phase === "setup",
            uiTheme,
            isGlassTheme,
            showDevUiToggle
        };
    }
}
