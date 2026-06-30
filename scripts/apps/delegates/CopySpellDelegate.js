/**
 * CopySpellDelegate.js
 * Handles Copy Spell transaction UI within RestSetupApp.
 * All handlers are thin forwarders to CopySpellHandler service.
 * Extracted from RestSetupApp to reduce God Class complexity.
 */

import { CopySpellHandler } from "../../services/CopySpellHandler.js";

export class CopySpellDelegate {

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    /**
     * Player approves a Copy Spell transaction.
     */
    onApprove(event, target) {
        const app = this._app;
        if (!app._copySpellProposal) return;
        CopySpellHandler.approveProposal(app._copySpellProposal);
        app._copySpellProposal = null;
        app.render();
    }

    /**
     * Player declines a Copy Spell transaction.
     */
    onDecline(event, target) {
        const app = this._app;
        if (!app._copySpellProposal) return;
        CopySpellHandler.declineProposal(app._copySpellProposal, app);
    }

    /**
     * GM processes a Copy Spell transaction from the GM card.
     */
    async onProcessGm(event, target) {
        if (!game.user.isGM) return;
        await CopySpellHandler.processGmProposal(this._app);
        await this._app._saveRestState();
    }

    /**
     * GM dismisses a Copy Spell transaction card.
     */
    async onDismiss(event, target) {
        if (!game.user.isGM) return;
        CopySpellHandler.clearGmProposal(this._app);
        await this._app._saveRestState();
    }

    /**
     * GM re-sends the Copy Spell roll prompt to the player.
     */
    onResendRoll(event, target) {
        if (!game.user.isGM) return;
        CopySpellHandler.resendRollPrompt(this._app);
    }

    /**
     * GM rolls Arcana as a fallback when the player can't roll.
     */
    async onGmFallback(event, target) {
        if (!game.user.isGM) return;
        await CopySpellHandler.gmRollFallback(this._app);
        await this._app._saveRestState();
    }

    /**
     * Player clicks "Roll Arcana" button for Copy Spell.
     */
    async onRollArcana(event, target) {
        if (game.user.isGM) return;
        await CopySpellHandler.executePlayerRoll(this._app);
    }
}
