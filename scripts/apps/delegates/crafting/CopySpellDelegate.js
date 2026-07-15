import { CopySpellHandler } from "../../../services/crafting/outcomes/CopySpellHandler.js";

export class CopySpellDelegate {

    constructor(app) {
        this._app = app;
    }

    onApprove(event, target) {
        const app = this._app;
        if (!app._copySpellProposal) return;
        CopySpellHandler.approveProposal(app._copySpellProposal);
        app._copySpellProposal = null;
        app.render();
    }

    onDecline(event, target) {
        const app = this._app;
        if (!app._copySpellProposal) return;
        CopySpellHandler.declineProposal(app._copySpellProposal, app);
    }

    async onProcessGm(event, target) {
        if (!game.user.isGM) return;
        await CopySpellHandler.processGmProposal(this._app);
        await this._app._saveRestState();
    }

    async onDismiss(event, target) {
        if (!game.user.isGM) return;
        CopySpellHandler.clearGmProposal(this._app);
        await this._app._saveRestState();
    }

    onResendRoll(event, target) {
        if (!game.user.isGM) return;
        CopySpellHandler.resendRollPrompt(this._app);
    }

    async onGmFallback(event, target) {
        if (!game.user.isGM) return;
        await CopySpellHandler.gmRollFallback(this._app);
        await this._app._saveRestState();
    }

    async onRollArcana(event, target) {
        if (game.user.isGM) return;
        await CopySpellHandler.executePlayerRoll(this._app);
    }
}
