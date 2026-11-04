import { MODULE_ID } from "../../../../data/moduleId.js";
import { SHELTER_SPELLS } from "../../../../data/RestConstants.js";
import { TerrainRegistry } from "../../../../services/events/resolve/TerrainRegistry.js";
import { CampGearScanner } from "../../../../services/camp/gear/CampGearScanner.js";
import { emitCampLightFire, emitTrainingStateUpdate } from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import {
    beddingStatusImage,
    buildBeddingShowUpdates,
    createBeddingScheduler,
    clearAllBeddingPoses
} from "../../../../services/rest/session/BeddingPose.js";

export const RestSessionBeddingMethods = {
    _beddingScheduler() {
        if (this._bedding) return this._bedding;
        this._bedding = createBeddingScheduler({
            show: () => this._showBeddingPose(),
            hide: () => this._hideBeddingPose()
        });
        return this._bedding;
    },

    _sleepingTokenDocs() {
        const app = this._app;
        const scene = canvas?.scene ?? game.scenes?.active;
        if (!scene?.tokens) return [];
        const keepWatchIds = app._nightWatchActorIds();
        const docs = [];
        for (const actor of getPartyActors()) {
            if (keepWatchIds.has(actor.id)) continue;
            for (const tokenDoc of scene.tokens.filter(t => t.actor?.id === actor.id)) {
                docs.push(tokenDoc);
            }
        }
        return docs;
    },

    async _showBeddingPose() {
        const scene = canvas?.scene ?? game.scenes?.active;
        if (!scene?.updateEmbeddedDocuments) return;
        const [primaryId, postureId] = this._app._beddingStatusIds();
        const updates = buildBeddingShowUpdates(this._sleepingTokenDocs(), {
            overlayImg: beddingStatusImage(primaryId),
            postureId: postureId ?? ""
        });
        if (!updates.length) return;
        await scene.updateEmbeddedDocuments("Token", updates);
    },

    async _hideBeddingPose() {
        await clearAllBeddingPoses();
    },

    async _applyBeddingDown() {
        const app = this._app;

        if (!game.user?.isGM) return;
        // Safe rest resolves in this same turn, so the pose would be applied
        // and cleared before paint. Simple mode still dwells on the night
        // screen; wake before that paint cancels the pose instead.
        this._beddingScheduler().requestShow({
            safeRestSpot: !!app._engine?.safeRestSpot
        });

        Hooks.callAll("ionrift.respite.sleepStarted", {
            restType: app._engine?.restType ?? "long",
            isGritty: false
        });
    },

    async _removeBeddingDown() {
        if (!game.user?.isGM) return;
        await this._beddingScheduler().requestHide();
        await clearAllBeddingPoses();
    },

    _formatCheckLabel(check, character) {
        const app = this._app;

        let abilityLabel = check.ability?.toUpperCase() ?? "";

        if (check.ability === "best" && character?.id) {
            const actor = game.actors.get(character.id);
            if (actor) {
                const fmtAdapter = game.ionrift?.respite?.adapter;
                const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
                let bestKey = null;
                let bestVal = -1;
                for (const key of abilityKeys) {
                    const mod = fmtAdapter ? fmtAdapter.getAbilityMod(actor, key) : (actor.system?.abilities?.[key]?.mod ?? 0);
                    if (mod > bestVal) { bestVal = mod; bestKey = key; }
                }
                if (bestKey) abilityLabel = `${bestKey.toUpperCase()} (${bestVal})`;
            }
        }

        const skillPart = check.skill ? ` (${check.skill})` : "";
        return `${abilityLabel}${skillPart} DC ${check.dc ?? "?"}`;
    
    },

    _getCampScanDataForActivityStationDialog() {
        const app = this._app;

        if (app._phase !== "activity") return null;
        const restType = app._engine?.restType
            ?? app._selectedRestType
            ?? app._restData?.restType
            ?? "long";
        const isGrittyShort = restType === "short"
            && (app._restVariant ?? "normal") === "gritty";
        if (restType === "short" && !isGrittyShort) return null;
        const terrainTagCamp = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
        const terrainCamp = TerrainRegistry.get(terrainTagCamp);
        const shelterKey = (app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none");
        const shelterSpellCamp = shelterKey
            ? (SHELTER_SPELLS[shelterKey]?.label ?? null)
            : null;
        // Local preview (player or GM hovering a tier) overrides the committed level so the
        // comfort header moves before Set/Request, matching the TotM Make Camp picker.
        const previewLevel = ["embers", "campfire", "bonfire"].includes(app._stationFirePreviewLevel)
            ? app._stationFirePreviewLevel
            : null;
        const effectiveScanLevel = previewLevel ?? app._fireLevel ?? "unlit";
        const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
        const baseTerrainComfort = app._engine?.comfort
            ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
            ?? "rough";
        return CampGearScanner.scan(
            baseTerrainComfort,
            effectiveScanLevel,
            shelterSpellCamp,
            terrainCamp?.comfortReason ?? "",
            terrainCamp?.label ?? terrainTagCamp,
            encMod,
            !!app._engine?.safeRestSpot
        ) ?? null;
    
    },

    _findIncompleteTrainingCharacterId() {
        const app = this._app;

        const seen = new Set();
        const candidates = [];

        for (const charId of app._trainingStates?.keys() ?? []) {
            if (seen.has(charId)) continue;
            seen.add(charId);
            if (app._earlyResults?.has(charId)) continue;
            if (app._characterChoices?.get(charId) !== "act_train") continue;
            candidates.push(charId);
        }
        for (const charId of app._lockedCharacters ?? []) {
            if (seen.has(charId)) continue;
            if (app._characterChoices?.get(charId) !== "act_train") continue;
            if (app._earlyResults?.has(charId)) continue;
            candidates.push(charId);
        }

        if (!candidates.length) return null;

        if (!app._isGM) {
            return candidates.find(id => game.actors.get(id)?.isOwner) ?? null;
        }
        if (app._selectedCharacterId && candidates.includes(app._selectedCharacterId)) {
            return app._selectedCharacterId;
        }
        return candidates[0];
    
    },

    _initTrainingState(characterId, activityId, actor) {
        const app = this._app;

        const activity = app._activityResolver?.activities?.get(activityId)
            ?? app._activities?.find(a => a.id === activityId);
        if (!activity || !actor) return;

        const comfort = app._engine?.comfort ?? "rough";
        const safeRestSpot = !!app._engine?.safeRestSpot;
        const context = app._activityResolver.getTrainingContext(activity, actor, comfort, safeRestSpot);

        app._trainingStates = app._trainingStates ?? new Map();
        const state = {
            activityId,
            context,
            rolls: [],
            rolling: false
        };
        app._trainingStates.set(characterId, state);

        if (!game.user.isGM) {
            emitTrainingStateUpdate(characterId, state);
        } else {
            void app._saveRestState();
        }
    
    },

    async onCampLightFire(event, target) {
        const app = this._app;

        if (app._campPitBlocksFireLighting()) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.restSession.placeCampfireBeforeLighting"));
            return;
        }
        const root = target?.closest?.("[data-action=\"campLightFire\"]") ?? target;
        let actorId = root?.dataset?.actorId;
        const method = root?.dataset?.method ?? "Tinderbox";
        // GM override: no party member had a tinderbox/cantrip, use first party actor
        if (actorId === "__gm__" && game.user.isGM) {
            const partyActors = getPartyActors();
            actorId = partyActors[0]?.id ?? null;
        }
        if (!actorId) return;
        // The selected tier (or default embers) is committed at light time so the picker
        // is the ceremony: no need to re-engage to set the level afterward.
        const chosenLevel = ["embers", "campfire", "bonfire"].includes(app._campFirePreviewLevel)
            ? app._campFirePreviewLevel
            : "embers";
        if (!game.user.isGM) {
            emitCampLightFire(game.user.id, actorId, method, chosenLevel);
            return;
        }
        await app._campCeremony.lightFire(game.user.id, actorId, method, chosenLevel);
    
    },

    async _spendPartyFirewoodForMakeCamp(cost, requestingUserId = null) {
        const app = this._app;

        const spendNames = [];
        if (cost <= 0) return { ok: true, spendNames };

        const actors = getPartyActors();
        const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        const sortedActors = requestingUserId
            ? [...actors].sort((a, b) => {
                const aOwn = (a.ownership?.[requestingUserId] ?? 0) >= OWNER ? 1 : 0;
                const bOwn = (b.ownership?.[requestingUserId] ?? 0) >= OWNER ? 1 : 0;
                return bOwn - aOwn;
            })
            : actors;

        let remaining = cost;
        while (remaining > 0) {
            let spentOne = false;
            for (const actor of sortedActors) {
                const firewoodItem = actor.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                if (!firewoodItem || (firewoodItem.system?.quantity ?? 0) <= 0) continue;
                const qty = firewoodItem.system?.quantity ?? 1;
                if (qty <= 1) await firewoodItem.delete();
                else await firewoodItem.update({ "system.quantity": qty - 1 });
                spendNames.push(actor.name);
                remaining--;
                spentOne = true;
                break;
            }
            if (!spentOne) {
                return { ok: false, spendNames, error: "Could not spend firewood (inventory changed)." };
            }
        }
        return { ok: true, spendNames };
    
    },

    async _applyTrainingXP(outcomes) {
        const app = this._app;

        if (!Array.isArray(outcomes) || !outcomes.length) return;

        for (const outcome of outcomes) {
            const award = (outcome.outcomes ?? [])
                .filter(sub => sub.source === "activity")
                .flatMap(sub => sub.effects ?? [])
                .filter(eff => eff.type === "training_xp")
                .reduce((sum, eff) => sum + (eff.value ?? 0), 0);
            if (award <= 0) continue;

            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;

            const current = actor.system?.details?.xp?.value ?? 0;
            try {
                await actor.update({ "system.details.xp.value": current + award });
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to apply ${award} training XP to ${actor.name}:`, e);
            }
        }
    
    },


};
