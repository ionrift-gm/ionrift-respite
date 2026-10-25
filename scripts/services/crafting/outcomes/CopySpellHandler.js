/**
 * CopySpellHandler
 * Manages the Copy Spell transaction flow:
 *   1. GM selects spell level ,  sends proposal to player via socket
 *   2. Player sees approval card ,  approves or declines
 *   3. On approval: gold deducted, Arcana check rolled, receipt sent
 */

import { MODULE_ID } from "../../../data/moduleId.js";
import { postRollAndSettle } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
export class CopySpellHandler {

    /**
     * GM sends a proposal to the player owning the actor.
     * @param {string} actorId - The wizard actor ID
     * @param {number|string} spellLevel - Spell level (1-5)
     */
    static sendProposal(actorId, spellLevel) {
        if (!game.user.isGM) return;

        const level = parseInt(spellLevel, 10) || 1;
        const cost = level * 50;
        const dc = 10 + level;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellProposal",
            actorId,
            actorName: actor.name,
            spellLevel: level,
            cost,
            dc
        });

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.proposalSent", { actor: actor.name, level, cost, dc }));
    }

    /**
     * Player receives a proposal. Shows an approval card.
     * Called from socket handler on the player client.
     * @param {Object} data - { actorId, actorName, spellLevel, cost, dc }
     * @param {Application} playerApp - The player's RestSetupApp instance (to render the card)
     */
    static receiveProposal(data, playerApp) {
        if (game.user.isGM) return;

        // Check if this player owns the actor
        const actor = game.actors.get(data.actorId);
        if (!actor?.testUserPermission(game.user, "OWNER")) return;

        // Store proposal on the app for rendering
        if (playerApp) {
            playerApp._copySpellProposal = data;
            playerApp.render();
        }
    }

    /**
     * GM receives a player-initiated proposal.
     * Stores the proposal on the GM's app for rendering a transaction card.
     * Rejects if GM already has an active proposal (busy guard).
     * @param {Object} data - { actorId, actorName, spellLevel, cost, dc, initiatedBy }
     * @param {Application} gmApp - The GM's RestSetupApp instance
     */
    static receiveProposalAsGM(data, gmApp) {
        if (!game.user.isGM) return;

        // Busy guard: reject if GM already has an active proposal
        if (gmApp?._gmCopySpellProposal) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "copySpellBusy",
                actorId: data.actorId,
                actorName: data.actorName
            });
            ui.notifications.warn(game.i18n.format("ionrift-respite.copySpell.rejectedBusy", { actor: data.actorName }));
            return;
        }

        const actor = game.actors.get(data.actorId);
        const currentGold = actor?.system?.currency?.gp ?? 0;
        const canAfford = currentGold >= data.cost;

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.wantsToCopy", { initiator: data.initiatedBy ?? data.actorName, level: data.spellLevel, cost: data.cost, dc: data.dc }));

        if (gmApp) {
            gmApp._gmCopySpellProposal = {
                ...data,
                currentGold,
                canAfford
            };
            gmApp.render();
        }
    }

    /**
     * GM processes the stored proposal (triggered from the GM card button).
     * Charges gold and transitions card to "charged, awaiting roll" state.
     * @param {Application} gmApp - The GM's RestSetupApp instance
     */
    static async processGmProposal(gmApp) {
        if (!game.user.isGM) return;

        const proposal = gmApp?._gmCopySpellProposal;
        if (!proposal) return;

        // Process the gold charge
        await CopySpellHandler.handleApproval(proposal);

        // Transition card to "charged" state (keeps visible for recovery)
        const actor = game.actors.get(proposal.actorId);
        const remainingGold = (actor?.system?.currency?.gp ?? 0);
        gmApp._gmCopySpellProposal = {
            ...proposal,
            charged: true,
            remainingGold,
            currentGold: remainingGold
        };
        gmApp.render();
    }

    /**
     * GM re-sends the roll prompt if the player missed it (e.g. after a refresh).
     * @param {Application} gmApp - The GM's RestSetupApp instance
     */
    static resendRollPrompt(gmApp) {
        if (!game.user.isGM) return;

        const proposal = gmApp?._gmCopySpellProposal;
        if (!proposal?.charged) return;

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellRollPrompt",
            actorId: proposal.actorId,
            actorName: proposal.actorName,
            spellLevel: proposal.spellLevel,
            cost: proposal.cost,
            dc: proposal.dc,
            remainingGold: proposal.remainingGold
        });

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.resentRollPrompt", { actor: proposal.actorName }));
    }

    /**
     * GM rolls Arcana as a fallback when the player is unavailable.
     * @param {Application} gmApp - The GM's RestSetupApp instance
     */
    static async gmRollFallback(gmApp) {
        if (!game.user.isGM) return;

        const proposal = gmApp?._gmCopySpellProposal;
        if (!proposal?.charged) return;

        const actor = game.actors.get(proposal.actorId);
        if (!actor) return;

        const dc = proposal.dc;
        const cost = proposal.cost;

        // GM rolls Arcana on behalf of the player
        const _adapter = game.ionrift?.respite?.adapter;
        const modifier = _adapter
            ? _adapter.getSkillTotal(actor, "arc")
            : (actor.system?.skills?.arc?.total ?? actor.system?.skills?.arc?.mod ?? 0);
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        const success = total >= dc;

        const tierLabel = success ? game.i18n.localize("ionrift-respite.copySpell.tierSuccess") : game.i18n.localize("ionrift-respite.copySpell.tierFailed");
        const tierColor = success ? "#7eb8da" : "#e88";
        const narrative = success
            ? game.i18n.localize("ionrift-respite.copySpell.narrativeSuccess")
            : game.i18n.localize("ionrift-respite.copySpell.narrativeFailed");

        const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
        await CopySpellHandler.#settleArcanaRoll(actor, roll, dc, ownerIds, true);

        const receiptHtml = `
            <div style="border: 1px solid rgba(120,180,220,0.3); border-radius: 6px; padding: 0.5rem; background: rgba(30,35,50,0.85);">
                <div style="font-weight: 600; color: ${tierColor};">
                    <i class="fas fa-receipt"></i> ${game.i18n.format("ionrift-respite.copySpell.receiptTitle", { tier: tierLabel })}
                </div>
                <div style="font-size: 0.85rem; color: #ccc; margin-top: 0.3rem;">
                    ${game.i18n.format("ionrift-respite.copySpell.receiptSpent", { actor: actor.name, cost, level: proposal.spellLevel })}<br>
                    <span style="color: #888;">${game.i18n.format("ionrift-respite.copySpell.remainingGold", { gold: proposal.remainingGold })}</span>
                </div>
                ${success
                    ? `<div style="font-size: 0.85rem; color: #7eb8da; margin-top: 0.3rem;">
                        <i class="fas fa-check-circle"></i> ${game.i18n.localize("ionrift-respite.copySpell.spellInBook")}
                       </div>`
                    : `<div style="font-size: 0.85rem; color: #e88; margin-top: 0.3rem;">
                        <i class="fas fa-times-circle"></i> ${game.i18n.localize("ionrift-respite.copySpell.attemptFailedMaterialsConsumed")}
                       </div>`
                }
            </div>`;

        await ChatMessage.create({
            content: receiptHtml,
            whisper: ownerIds,
            speaker: { alias: "Respite" },
            flags: { [MODULE_ID]: { type: "copySpellReceipt" } }
        });

        // Clear the GM card
        gmApp._gmCopySpellProposal = null;

        // Broadcast result to player
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellResult",
            actorId: proposal.actorId,
            success,
            narrative,
            cost
        });

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.gmRolledResult", { actor: actor.name, tier: tierLabel }));
        gmApp.render();
    }

    /**
     * GM dismisses the proposal without processing.
     * @param {Application} gmApp - The GM's RestSetupApp instance
     */
    static clearGmProposal(gmApp) {
        if (!gmApp) return;
        gmApp._gmCopySpellProposal = null;
        gmApp.render();
    }

    /**
     * Player approves the proposal. Sends approval back to GM.
     * @param {Object} proposal - The stored proposal data
     */
    static approveProposal(proposal) {
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellApproved",
            actorId: proposal.actorId,
            spellLevel: proposal.spellLevel,
            cost: proposal.cost,
            dc: proposal.dc
        });

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.approvedCost", { cost: proposal.cost, level: proposal.spellLevel }));
    }

    /**
     * Player declines the proposal.
     * @param {Object} proposal - The stored proposal data
     * @param {Application} playerApp - The player's RestSetupApp instance
     */
    static declineProposal(proposal, playerApp) {
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellDeclined",
            actorId: proposal.actorId
        });

        if (playerApp) {
            playerApp._copySpellProposal = null;
            playerApp.render();
        }

        ui.notifications.info(game.i18n.localize("ionrift-respite.copySpell.declined"));
    }

    /**
     * GM receives approval / processes proposal. Deducts gold and prompts player to roll.
     * @param {Object} data - { actorId, spellLevel, cost, dc }
     */
    static async handleApproval(data) {
        if (!game.user.isGM) return;

        const actor = game.actors.get(data.actorId);
        if (!actor) {
            ui.notifications.error(game.i18n.localize("ionrift-respite.copySpell.actorNotFound"));
            return;
        }

        const cost = data.cost;
        const dc = data.dc;
        const currAdapter = game.ionrift?.respite?.adapter;
        const currentGold = currAdapter ? currAdapter.getCurrency(actor) : (actor.system?.currency?.gp ?? 0);

        if (currentGold < cost) {
            ui.notifications.warn(game.i18n.format("ionrift-respite.copySpell.cannotChargeGold", { actor: actor.name, currentGold, cost }));
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "copySpellResult",
                actorId: data.actorId,
                success: false,
                narrative: game.i18n.format("ionrift-respite.copySpell.insufficientGoldNarrative", { actor: actor.name, cost, currentGold }),
                cost: 0
            });
            return;
        }

        if (currAdapter) {
            await currAdapter.deductCurrency(actor, cost);
        } else {
            await actor.update({ "system.currency.gp": currentGold - cost });
        }

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.chargedWaitingRoll", { actor: actor.name, cost }));

        // Send roll prompt to player
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellRollPrompt",
            actorId: data.actorId,
            actorName: actor.name,
            spellLevel: data.spellLevel,
            cost,
            dc,
            remainingGold: currentGold - cost
        });
    }

    /**
     * Player receives the roll prompt after gold has been charged.
     * Stores the prompt data on the player app for rendering a "Roll Arcana" card.
     * @param {Object} data - { actorId, actorName, spellLevel, cost, dc, remainingGold }
     * @param {Application} playerApp - The player's RestSetupApp instance
     */
    static handleRollPrompt(data, playerApp) {
        if (game.user.isGM) return;

        const actor = game.actors.get(data.actorId);
        if (!actor?.testUserPermission(game.user, "OWNER")) return;

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.promptRollArcana", { dc: data.dc }));

        if (playerApp) {
            playerApp._copySpellRollPrompt = data;
            playerApp._earlyResults?.delete(data.actorId); // Clear pending state
            playerApp.render();
        }
    }

    /**
     * Player clicks "Roll Arcana" button. Performs the roll and broadcasts result.
     * @param {Application} playerApp - The player's RestSetupApp instance
     */
    static async executePlayerRoll(playerApp) {
        if (game.user.isGM) return;

        const data = playerApp?._copySpellRollPrompt;
        if (!data) return;

        const actor = game.actors.get(data.actorId);
        if (!actor) return;

        // Clear the roll prompt card
        playerApp._copySpellRollPrompt = null;

        const dc = data.dc;
        const cost = data.cost;

        // Player rolls Arcana
        const _adapter = game.ionrift?.respite?.adapter;
        const modifier = _adapter
            ? _adapter.getSkillTotal(actor, "arc")
            : (actor.system?.skills?.arc?.total ?? actor.system?.skills?.arc?.mod ?? 0);
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        const success = total >= dc;

        const tierLabel = success ? game.i18n.localize("ionrift-respite.copySpell.tierSuccess") : game.i18n.localize("ionrift-respite.copySpell.tierFailed");
        const tierColor = success ? "#7eb8da" : "#e88";
        const narrative = success
            ? game.i18n.localize("ionrift-respite.copySpell.narrativeSuccess")
            : game.i18n.localize("ionrift-respite.copySpell.narrativeFailed");

        // Post the roll as a chat message (whispered to owner + GM)
        const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
        await CopySpellHandler.#settleArcanaRoll(actor, roll, dc, ownerIds, false);

        // Post the receipt
        const receiptHtml = `
            <div style="border: 1px solid rgba(120,180,220,0.3); border-radius: 6px; padding: 0.5rem; background: rgba(30,35,50,0.85);">
                <div style="font-weight: 600; color: ${tierColor};">
                    <i class="fas fa-receipt"></i> ${game.i18n.format("ionrift-respite.copySpell.receiptTitle", { tier: tierLabel })}
                </div>
                <div style="font-size: 0.85rem; color: #ccc; margin-top: 0.3rem;">
                    ${game.i18n.format("ionrift-respite.copySpell.receiptSpent", { actor: actor.name, cost, level: data.spellLevel })}<br>
                    <span style="color: #888;">${game.i18n.format("ionrift-respite.copySpell.remainingGold", { gold: data.remainingGold })}</span>
                </div>
                ${success
                    ? `<div style="font-size: 0.85rem; color: #7eb8da; margin-top: 0.3rem;">
                        <i class="fas fa-check-circle"></i> ${game.i18n.localize("ionrift-respite.copySpell.spellInBook")}
                       </div>`
                    : `<div style="font-size: 0.85rem; color: #e88; margin-top: 0.3rem;">
                        <i class="fas fa-times-circle"></i> ${game.i18n.localize("ionrift-respite.copySpell.attemptFailedMaterialsConsumed")}
                       </div>`
                }
            </div>`;

        await ChatMessage.create({
            content: receiptHtml,
            whisper: ownerIds,
            speaker: { alias: "Respite" },
            flags: { [MODULE_ID]: { type: "copySpellReceipt" } }
        });

        // Update local player app
        playerApp._copySpellProposal = null;
        playerApp._copySpellResult = { actorId: data.actorId, success, narrative, cost };
        playerApp.render();

        // Broadcast result to GM
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "copySpellResult",
            actorId: data.actorId,
            success,
            narrative,
            cost
        });

        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.playerRollResult", { tier: tierLabel, cost }));
    }

    /**
     * GM receives a decline from the player.
     * @param {Object} data - { actorId }
     */
    static handleDecline(data) {
        if (!game.user.isGM) return;
        const actor = game.actors.get(data.actorId);
        ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.playerDeclined", { actor: actor?.name ?? game.i18n.localize("ionrift-respite.common.player") }));
    }

    /**
     * Receives the result on either side. Updates the app UI.
     * @param {Object} data - { actorId, success, narrative, cost }
     * @param {Application} app - The RestSetupApp instance (GM or player)
     */
    static receiveResult(data, app) {
        if (!app) return;

        if (game.user.isGM) {
            // GM: clear the transaction card and show result notification
            app._gmCopySpellProposal = null;
            const tierLabel = data.success ? game.i18n.localize("ionrift-respite.copySpell.tierSuccess") : game.i18n.localize("ionrift-respite.copySpell.tierFailed");
            const actor = game.actors.get(data.actorId);
            ui.notifications.info(game.i18n.format("ionrift-respite.copySpell.gmResultCharged", { actor: actor?.name ?? game.i18n.localize("ionrift-respite.common.player"), tier: tierLabel, cost: data.cost }));
            app.render();
            app._saveRestState?.();
        } else {
            // Player: update app UI
            app._copySpellProposal = null;
            app._copySpellResult = data;
            app.render();
        }
    }

    /**
     * Show the Arcana die and wait for it to settle before the receipt.
     * The verdict stays off this message so it is not visible while the die is in the air.
     * @param {Actor} actor
     * @param {Roll} roll
     * @param {number} dc
     * @param {string[]} whisper
     * @param {boolean} gmRolled
     */
    static async #settleArcanaRoll(actor, roll, dc, whisper, gmRolled) {
        const rolledFor = gmRolled
            ? `<br><span style="font-size:0.75em;color:#888;">${game.i18n.localize("ionrift-respite.copySpell.rolledForPlayer")}</span>`
            : "";
        await postRollAndSettle(roll, {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: game.i18n.format("ionrift-respite.copySpell.rollFlavor", { dc, rolledFor }),
            whisper
        });
    }
}
