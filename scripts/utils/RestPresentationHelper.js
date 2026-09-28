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
            const className = primary.name ?? "Adventurer";
            const level = primary.system?.levels ?? actor.system?.details?.level ?? 1;
            const subclassName = primary.subclass?.name ?? actor.itemTypes?.subclass?.[0]?.name ?? "";
            subtext = subclassName ? `${className} ${level} · ${subclassName}` : `${className} ${level}`;
            classKey = (primary.system?.identifier ?? primary.name ?? "").toLowerCase();
        } else {
            // Fallback for non-class actors or other systems
            const level = actor.system?.details?.level ?? "";
            subtext = level ? `Level ${level}` : "";
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

        const formattedTerrain = terrainLabel || (terrainTag ? terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1) : "Wilderness");

        switch (type) {
            case "bivouac":
                restHeaderTitle = "Overnight Rest";
                restHeaderTag = `${formattedTerrain} · Gritty Overnight (8 Hours)`;
                restHeaderTagClass = "tag-gritty tag-bivouac";
                restHeaderSubtitle = "Hit Dice recovery, equipment tune-up & quick rations";
                resolvedAbandonAction = resolvedAbandonAction || "abandonBivouac";
                if (!resolvedSteps.length) {
                    resolvedSteps = [
                        { label: "Operations & Gear", active: true, complete: false },
                        { label: "Hit Dice Recovery", active: false, complete: false }
                    ];
                }
                break;

            case "short":
                restHeaderTitle = "Short Rest";
                restHeaderTag = `${formattedTerrain} · 1 Hour`;
                restHeaderTagClass = "tag-normal tag-short";
                restHeaderSubtitle = "Hit Dice recovery, equipment tune-up & quick rations";
                resolvedAbandonAction = resolvedAbandonAction || "abandonShortRest";
                break;

            case "downtime":
                restHeaderTitle = pacingActive
                    ? (isDawnCheck ? "Dawn · Final Check" : (totalNights === 1 ? "Overnight Vigil" : `Night ${activePacingNight} of ${totalNights}`))
                    : "";
                restHeaderTag = formattedTerrain || "Wilderness";
                restHeaderTagClass = "tag-gritty tag-downtime";
                restHeaderSubtitle = pacingActive
                    ? (isDawnCheck ? "Party exhaustion saves, exposure review & morning transition" : (totalNights === 1 ? "8-hour rest vigilance & dawn transition" : "Nightly encounters, camp events & pacing progress"))
                    : "Weekly activities, resource foraging & campsite management";
                resolvedAbandonAction = resolvedAbandonAction || "abandonDowntime";
                break;

            case "long":
            default:
                restHeaderTitle = (phase === "activity" || phase === "meal") ? "" : (phaseLabel || "Long Rest");
                restHeaderTag = formattedTerrain || "Wilderness";
                restHeaderTagClass = "tag-normal tag-long";
                restHeaderSubtitle = "Camp preparation, overnight activities & sustenance";
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
