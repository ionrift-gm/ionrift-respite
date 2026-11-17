import { CopySpellHandler } from "../../../services/crafting/outcomes/CopySpellHandler.js";

export class CopySpellDelegate {

    constructor(app) {
        this._app = app;
    }

    onApprove(_event, _target) {
        const app = this._app;
        if (!app._copySpellProposal) return;
        CopySpellHandler.approveProposal(app._copySpellProposal);
        app._copySpellProposal = null;
        app.render();
    }

    onDecline(_event, _target) {
        const app = this._app;
        if (!app._copySpellProposal) return;
        CopySpellHandler.declineProposal(app._copySpellProposal, app);
    }

    async onProcessGm(_event, _target) {
        if (!game.user.isGM) return;
        await CopySpellHandler.processGmProposal(this._app);
        await this._app._saveRestState();
    }

    async onDismiss(_event, _target) {
        if (!game.user.isGM) return;
        CopySpellHandler.clearGmProposal(this._app);
        await this._app._saveRestState();
    }

    onResendRoll(_event, _target) {
        if (!game.user.isGM) return;
        CopySpellHandler.resendRollPrompt(this._app);
    }

    async onGmFallback(_event, _target) {
        if (!game.user.isGM) return;
        await CopySpellHandler.gmRollFallback(this._app);
        await this._app._saveRestState();
    }

    async onRollArcana(_event, _target) {
        if (game.user.isGM) return;
        await CopySpellHandler.executePlayerRoll(this._app);
    }
}
