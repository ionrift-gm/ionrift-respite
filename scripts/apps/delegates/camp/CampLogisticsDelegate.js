import { MODULE_ID } from "../../../data/moduleId.js";
import { CampGearScanner } from "../../../services/camp/gear/CampGearScanner.js";
import { ItemOutcomeHandler } from "../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { Logger } from "../../../utils/Logger.js";

/**
 * Signed change to the night check from the fire.
 * Same magnitudes as CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL, opposite sign,
 * because the week adds this number and a one-night rest subtracts the scanner value.
 * A cold camp lowers the check. A campfire raises it by 1. A bonfire raises it by 2.
 * @param {string|null|undefined} fireLevel
 * @returns {number}
 */
export function fireEncounterDcNudge(fireLevel) {
    if (!fireLevel) return 0;
    const stored = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[fireLevel];
    return typeof stored === "number" ? -stored : 0;
}

/**
 * Shared delegate for camp logistics drawer actions.
 * Used by both RestSetupApp and DowntimeLedgerApp.
 *
 * Encapsulates: forage/hunt DC steppers, food days stepper,
 * firewood granting, and gear factor toggles.
 */
export class CampLogisticsDelegate {

    /** @param {ApplicationV2} app — the host application instance */
    constructor(app) {
        this._app = app;
    }

    /* ── State ── */
    _drawerOpen = false;
    _forageDC = 12;
    _huntDC = 14;
    _foodDaysNeeded = 7;
    _enforceTent = true;
    _enforceBedroll = true;
    _enforceMessKit = true;

    /* ── Context injection ── */

    /** Merge logistics context properties into the template data object. */
    mergeContext(ctx) {
        ctx.logisticsDrawerOpen = this._drawerOpen;
        ctx.forageDC = this._forageDC;
        ctx.huntDC = this._huntDC;
        ctx.foodDaysNeeded = this._foodDaysNeeded;
        ctx.enforceTent = this._enforceTent;
        ctx.enforceBedroll = this._enforceBedroll;
        ctx.enforceMessKit = this._enforceMessKit;
    }

    /* ── Serialization ── */

    serialize() {
        return {
            drawerOpen: this._drawerOpen,
            forageDC: this._forageDC,
            huntDC: this._huntDC,
            foodDaysNeeded: this._foodDaysNeeded,
            enforceTent: this._enforceTent,
            enforceBedroll: this._enforceBedroll,
            enforceMessKit: this._enforceMessKit
        };
    }

    restore(data) {
        if (!data) return;
        if (data.drawerOpen != null) this._drawerOpen = data.drawerOpen;
        if (data.forageDC != null) this._forageDC = data.forageDC;
        if (data.huntDC != null) this._huntDC = data.huntDC;
        if (data.foodDaysNeeded != null) this._foodDaysNeeded = data.foodDaysNeeded;
        if (data.enforceTent != null) this._enforceTent = data.enforceTent;
        if (data.enforceBedroll != null) this._enforceBedroll = data.enforceBedroll;
        if (data.enforceMessKit != null) this._enforceMessKit = data.enforceMessKit;
    }

    /* ── Action handlers ── */

    toggleDrawer() {
        this._drawerOpen = !this._drawerOpen;
        this._app.render();
    }

    adjustSustenanceDC(activity, delta) {
        const d = Number(delta) || 0;
        if (activity === "forage") {
            this._forageDC = Math.max(5, Math.min(30, this._forageDC + d));
        } else if (activity === "hunt") {
            this._huntDC = Math.max(5, Math.min(30, this._huntDC + d));
        }
        this._app.render();
    }

    stepFoodDays(delta) {
        const d = Number(delta) || 0;
        this._foodDaysNeeded = Math.max(1, Math.min(30, this._foodDaysNeeded + d));
        this._app.render();
    }

    async giftWood(qty = 2) {
        const party = getPartyActors();
        if (!party.length) {
            ui.notifications?.warn("No party members found to receive firewood.");
            return;
        }

        const recipient = party.find(a => CampGearScanner.countActorFirewood(a) > 0) ?? party[0];

        try {
            await ItemOutcomeHandler.grantItemsToActor(recipient, [{
                name: "Kindling",
                type: "loot",
                img: "icons/commodities/wood/wood-pile-brown.webp",
                quantity: qty,
                system: {
                    quantity: qty,
                    description: { value: "Dry kindling and firewood gathered or salvaged for camp fuel." }
                },
                flags: {
                    [MODULE_ID]: { firewoodType: "kindling" }
                }
            }]);

            ui.notifications?.info?.(`Added ${qty} firewood to ${recipient.name}'s inventory.`);
            this._app.render();
        } catch (err) {
            Logger.error(`${MODULE_ID} | Failed to gift firewood:`, err);
            ui.notifications?.error?.("Failed to add firewood to party inventory.");
        }
    }

    toggleGearFactor(factor) {
        if (factor === "bedroll") {
            this._enforceBedroll = !this._enforceBedroll;
        } else if (factor === "tent") {
            this._enforceTent = !this._enforceTent;
        } else if (factor === "messKit") {
            this._enforceMessKit = !this._enforceMessKit;
        } else {
            return;
        }
        this._app.render();
    }
}
