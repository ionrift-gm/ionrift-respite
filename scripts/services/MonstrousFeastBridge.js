import { Logger } from "../utils/Logger.js";

const MF_MODULE_ID = "ionrift-monstrous-feast";

/**
 * Bridge to Monstrous Feast cooking.
 *
 * When Monstrous Feast is installed it owns the monster cooking surface, so a
 * rest cooking entry should hand off into its cookbook rather than present
 * Respite's own cooking recipe picker. With the cookbook serving through the
 * shared cooking feed provider, a meal still credits satiation and the shared
 * Well Fed slot, so one acknowledged cooking path replaces two competing ones.
 *
 * Everything here is feature-detected and additive. With Monstrous Feast absent,
 * every method is a no-op and the native Respite cooking path runs unchanged.
 */
export const MonstrousFeastBridge = {
    /**
     * Whether Monstrous Feast is active and exposes the stable cooking entry.
     *
     * Monstrous Feast carries one explicit integration switch. When it reports
     * the integration disabled, Respite must not offer the Monster Cookbook and
     * keeps its native cooking path. Older Monstrous Feast builds that predate
     * the switch have no such method, so the check falls back to plain feature
     * detection and the prior behaviour is preserved.
     * @returns {boolean}
     */
    ownsCooking() {
        if (game.modules.get(MF_MODULE_ID)?.active !== true) return false;
        const mf = game.ionrift?.monstrousFeast;
        if (typeof mf?.openCooking !== "function") return false;
        if (typeof mf.isRespiteIntegrationEnabled === "function") {
            try {
                if (mf.isRespiteIntegrationEnabled() === false) return false;
            } catch {
                /* unreadable switch: fall back to feature detection */
            }
        }
        return true;
    },

    /**
     * Open the Monstrous Feast cookbook as an optional alternative to Respite's
     * native cooking. This does not close or replace the rest surface: the
     * player keeps every normal activity and can cancel the cookbook without
     * spending anything. A completed cook fires `onCooked`, which the caller
     * uses to consume the cook's rest activity.
     * @param {Actor|null} actor - the character doing the cooking
     * @param {{ onCooked?: Function|null }} [opts]
     * @returns {boolean} true when Monstrous Feast opened its cookbook.
     */
    openCooking(actor = null, { onCooked = null } = {}) {
        if (!this.ownsCooking()) return false;
        try {
            const app = game.ionrift.monstrousFeast.openCooking({ actor, onCooked });
            return Boolean(app);
        } catch (err) {
            Logger.warn("Monstrous Feast cooking entry failed; using the native cooking path.", err);
            return false;
        }
    }
};
