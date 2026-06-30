/**
 * MealPhaseHandler
 * Manages food and water consumption during the Meal phase of a long rest.
 *
 * Responsibilities:
 * - Track rests since last meal/drink per character (actor flags)
 * - Build meal options for each character (rations, waterskins, foraged, skip)
 * - Consume selected items from inventory (multi-day aware, handles partial supply)
 * - Generate advisories about starvation/dehydration consequences
 * - Apply exhaustion at resolution when thresholds are exceeded
 *
 * This class is the public entry point and orchestrator. The implementation is
 * split across cohesive modules (spoilage, context building, option building,
 * meal application, Well Fed serving, buff resolution, the cooking bridge, and
 * communal serving); the static methods below delegate to them so every
 * existing consumer keeps working unchanged.
 */

import { resolveSpoilage, resolveCalendarSpoilage } from "./MealSpoilageService.js";
import {
    buildFoodOptions,
    buildWaterOptions,
    buildAdvisories,
    buildEssenceOptions
} from "./MealOptionBuilder.js";
import { buildMealContext } from "./MealContextBuilder.js";
import {
    applyMealChoices,
    processAndApply,
    accumulateMealSatiation
} from "./MealApplicationService.js";
import { consumeItem } from "./MealItemConsumer.js";
import {
    mealSnapshotAsSingleLeftover,
    dispatchWellFedMealServing,
    applyWellFedEffect,
    removeWellFedEffects,
    cleanupWellFedEffects,
    stampWellFedDuration
} from "./WellFedService.js";
import {
    resolveBuff,
    buffSummaryLabel,
    buffToActiveEffectPartsAsync,
    wellFedDnd5eDurationFlags,
    isKnownStubBuffType
} from "./MealBuffResolution.js";
import { rollBuffFormula, rollForChat, restoreHitDice } from "./MealBuffResolveHelpers.js";
import {
    cookingAeChanges,
    localAeChanges,
    isCookingSlotEffect,
    stampCookingSlotFlag
} from "./CookingBuffBridge.js";
import {
    getContainerParentId,
    collectWaterSourceContainerIds,
    iterInventoryItems
} from "./MealInventoryHelpers.js";
import { buildServeSnapshot, creditCommunalSatiation } from "./CommunalServeHelpers.js";

export class MealPhaseHandler {

    // ── Spoilage ─────────────────────────────────────────────────

    static async resolveSpoilage(characterIds, daysSinceLastRest = 1) {
        return resolveSpoilage(characterIds, daysSinceLastRest);
    }

    static async resolveCalendarSpoilage(actors) {
        return resolveCalendarSpoilage(actors);
    }

    // ── Meal context + options ───────────────────────────────────

    static buildMealContext(characterIds, terrainTag, terrainMealRules = {}, daysSinceLastRest = 1, mealChoices = new Map(), satiatesLookup = null) {
        return buildMealContext(characterIds, terrainTag, terrainMealRules, daysSinceLastRest, mealChoices, satiatesLookup);
    }

    static _buildFoodOptions(actor) {
        return buildFoodOptions(actor);
    }

    static _buildWaterOptions(actor, rules) {
        return buildWaterOptions(actor, rules);
    }

    static _buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient = false, foodFilledCount = 0, waterSufficient = false, waterFilledCount = 0, partialSustenance = true) {
        return buildAdvisories(restsSinceFood, restsSinceWater, foodGrace, rules, terrainTag, foodSufficient, foodFilledCount, waterSufficient, waterFilledCount, partialSustenance);
    }

    static _buildEssenceOptions(actor) {
        return buildEssenceOptions(actor);
    }

    // ── Meal application ─────────────────────────────────────────

    static async applyMealChoices(mealChoices, daysSinceLastRest = 1, terrainMealRules = {}) {
        return applyMealChoices(mealChoices, daysSinceLastRest, terrainMealRules);
    }

    static async processAndApply(mealChoices, totalDays = 1, terrainMealRules = {}) {
        return processAndApply(mealChoices, totalDays, terrainMealRules);
    }

    static _accumulateMealSatiation(snapshot, amount, consumerCharId, partyIds, extraWaterByChar, extraFoodByChar) {
        return accumulateMealSatiation(snapshot, amount, consumerCharId, partyIds, extraWaterByChar, extraFoodByChar);
    }

    static async _consumeItem(actor, itemId, amount = 1, opts = {}) {
        return consumeItem(actor, itemId, amount, opts);
    }

    // ── Well Fed serving + lifecycle ─────────────────────────────

    static _mealSnapshotAsSingleLeftover(itemSnapshot) {
        return mealSnapshotAsSingleLeftover(itemSnapshot);
    }

    static async _dispatchWellFedMealServing(args) {
        return dispatchWellFedMealServing(args);
    }

    static async _applyWellFedEffect(actor, item) {
        return applyWellFedEffect(actor, item);
    }

    static async _removeWellFedEffects(actor) {
        return removeWellFedEffects(actor);
    }

    static async cleanupWellFedEffects(actors) {
        return cleanupWellFedEffects(actors);
    }

    static async stampWellFedDuration(actors) {
        return stampWellFedDuration(actors);
    }

    // ── Buff resolution ──────────────────────────────────────────

    static async _resolveBuff(actor, buff, opts = {}) {
        return resolveBuff(actor, buff, opts);
    }

    /** @private */
    static _isKnownStubBuffType(type) {
        return isKnownStubBuffType(type);
    }

    /** Include roll on chat only when the formula contains dice (Dice So Nice, inline breakdown). */
    static _rollForChat(roll) {
        return rollForChat(roll);
    }

    static async _rollBuffFormula(actor, formula) {
        return rollBuffFormula(actor, formula);
    }

    static async _restoreHitDice(actor, amount) {
        return restoreHitDice(actor, amount);
    }

    static _buffSummaryLabel(buff) {
        return buffSummaryLabel(buff);
    }

    static _wellFedDnd5eDurationFlags(durationTag) {
        return wellFedDnd5eDurationFlags(durationTag);
    }

    static async _buffToActiveEffectPartsAsync(actor, buff) {
        return buffToActiveEffectPartsAsync(actor, buff);
    }

    // ── Cooking abstraction bridge (ionrift-library) ─────────────

    static _cookingAeChanges(buff, actor) {
        return cookingAeChanges(buff, actor);
    }

    static _localAeChanges(buffType, params) {
        return localAeChanges(buffType, params);
    }

    static _isCookingSlotEffect(effect) {
        return isCookingSlotEffect(effect);
    }

    static _stampCookingSlotFlag(flags, slot) {
        return stampCookingSlotFlag(flags, slot);
    }

    // ── Feed provider + communal serve ───────────────────────────

    /**
     * Register Respite's Well Fed serve as a provider with the shared cooking
     * abstraction so that `cooking.feed.serveDish` routes communal feeding,
     * satiation, and the single shared slot through Respite. Additive and
     * idempotent; returns false when the kernel has no cooking namespace.
     * @returns {boolean}
     */
    static registerFeedProvider() {
        const feed = game.ionrift?.library?.cooking?.feed;
        if (!feed?.registerProvider) return false;
        feed.registerProvider({
            id: "ionrift-respite:wellfed",
            // Respite owns the rest cycle and clears the Well Fed marker on rest,
            // so the kernel can safely enforce its block/no-replace gate while
            // Respite is present. Without this flag the kernel replaces instead.
            tracksRest: true,
            canHandle: (item) => {
                try {
                    const found = feed.buffsForDish?.(item);
                    return Array.isArray(found) && found.length > 0;
                } catch {
                    return false;
                }
            },
            serve: (ctx) => MealPhaseHandler.serveCommunalDish(ctx)
        });
        return true;
    }

    /**
     * Serve a dish communally, folding the supplied buffs into Respite's Well
     * Fed serve so the single shared slot and satiation crediting stay owned by
     * Respite. Entry point for `cooking.feed.serveDish`.
     * @param {{ cookActor?: Actor, item?: object, recipients?: Actor[], buffs?: object[], opts?: object }} ctx
     * @returns {Promise<{ served: number, buffs: object[] }>}
     */
    static async serveCommunalDish({ cookActor = null, item = null, recipients = [], buffs = [], opts = {} } = {}) {
        const list = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
        const partyIds = list.map(a => a.id).filter(Boolean);
        const snapshot = buildServeSnapshot(item, buffs, opts?.title);
        const consumer = cookActor ?? list[0] ?? null;
        if (consumer && partyIds.length) {
            await MealPhaseHandler._dispatchWellFedMealServing({
                consumerActor: consumer,
                itemSnapshot: snapshot,
                partyIds
            });
        }
        await creditCommunalSatiation(snapshot, partyIds);
        return { served: partyIds.length, buffs };
    }

    // ── Internal Helpers ─────────────────────────────────────────

    /** Known food item names (lowercase). Used as fallback when type/flag detection misses. */
    static FOOD_NAMES = new Set([
        "rations", "rations (1 day)", "trail rations", "iron rations"
    ]);

    /** Known water item names (lowercase). Used as fallback when flag detection misses. */
    static WATER_NAMES = new Set([
        "waterskin", "water flask", "canteen",
        "water (pint)", "water, fresh (pint)"
    ]);

    /** @see getContainerParentId */
    static getContainerParentId(item) {
        return getContainerParentId(item);
    }

    /** @see collectWaterSourceContainerIds */
    static collectWaterSourceContainerIds(items, actor) {
        return collectWaterSourceContainerIds(items, actor);
    }

    /** @see iterInventoryItems */
    static iterInventoryItems(actor) {
        return iterInventoryItems(actor);
    }
}
