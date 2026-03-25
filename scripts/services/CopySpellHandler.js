/**
 * CopySpellHandler
 * Manages the Copy Spell transaction flow:
 *   1. GM selects spell level → sends proposal to player via socket
 *   2. Player sees approval card → approves or declines
 *   3. On approval: gold deducted, Arcana check rolled, receipt sent
 */

const MODULE_ID = "ionrift-respite";

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

        ui.notifications.info(`Sent Copy Spell proposal to ${actor.name}'s player: Level ${level} (${cost}gp, DC ${dc}).`);
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
            ui.notifications.warn(`Rejected Copy Spell from ${data.actorName}: another transaction is in progress.`);
            return;
        }

        const actor = game.actors.get(data.actorId);
        const currentGold = actor?.system?.currency?.gp ?? 0;
        const canAfford = currentGold >= data.cost;

        ui.notifications.info(`${data.initiatedBy ?? data.actorName} wants to copy a Level ${data.spellLevel} spell (${data.cost}gp, DC ${data.dc}).`);

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

        ui.notifications.info(`Re-sent roll prompt for ${proposal.actorName}.`);
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
        const arcana = actor.system?.skills?.arc;
        const modifier = arcana?.total ?? arcana?.mod ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        const success = total >= dc;

        const tierLabel = success ? "Success" : "Failed";
        const tierColor = success ? "#7eb8da" : "#e88";
        const narrative = success
            ? "You study the unfamiliar notation, deciphering its meaning. The spell takes shape in your book, written in your own hand."
            : "The notation resists your understanding. The inks and materials are consumed, but the spell eludes you.";

        const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>Copy Spell</strong> (ARC) - DC ${dc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${narrative}<br><span style="font-size:0.75em;color:#888;">(Rolled by GM on behalf of player)</span>`,
            whisper: ownerIds
        });

        const receiptHtml = `
            <div style="border: 1px solid rgba(120,180,220,0.3); border-radius: 6px; padding: 0.5rem; background: rgba(30,35,50,0.85);">
                <div style="font-weight: 600; color: ${tierColor};">
                    <i class="fas fa-receipt"></i> Spell Transcription Receipt - ${tierLabel}
                </div>
                <div style="font-size: 0.85rem; color: #ccc; margin-top: 0.3rem;">
                    <strong>${actor.name}</strong> spent <strong>${cost}gp</strong> on inks to copy a level ${proposal.spellLevel} spell.<br>
                    <span style="color: #888;">Remaining gold: ${proposal.remainingGold}gp</span>
                </div>
                ${success
                    ? `<div style="font-size: 0.85rem; color: #7eb8da; margin-top: 0.3rem;">
                        <i class="fas fa-check-circle"></i> The spell is now in your spellbook.
                       </div>`
                    : `<div style="font-size: 0.85rem; color: #e88; margin-top: 0.3rem;">
                        <i class="fas fa-times-circle"></i> The attempt failed. Materials consumed. If copying from a scroll, remove it.
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

        ui.notifications.info(`${actor.name}: Copy Spell - ${tierLabel}. (GM rolled on behalf of player)`);
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

        ui.notifications.info(`Approved: ${proposal.cost}gp for Level ${proposal.spellLevel} spell.`);
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

        ui.notifications.info("Copy Spell declined.");
    }

    /**
     * GM receives approval / processes proposal. Deducts gold and prompts player to roll.
     * @param {Object} data - { actorId, spellLevel, cost, dc }
     */
    static async handleApproval(data) {
        if (!game.user.isGM) return;

        const actor = game.actors.get(data.actorId);
        if (!actor) {
            ui.notifications.error("Actor not found.");
            return;
        }

        const cost = data.cost;
        const dc = data.dc;
        const currentGold = actor.system?.currency?.gp ?? 0;

        if (currentGold < cost) {
            ui.notifications.warn(`${actor.name} only has ${currentGold}gp. Cannot charge ${cost}gp.`);
            // Notify player
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "copySpellResult",
                actorId: data.actorId,
                success: false,
                narrative: `Insufficient gold. ${actor.name} needs ${cost}gp but only has ${currentGold}gp.`,
                cost: 0
            });
            return;
        }

        // Deduct gold
        await actor.update({ "system.currency.gp": currentGold - cost });

        ui.notifications.info(`${actor.name}: Charged ${cost}gp. Waiting for Arcana roll...`);

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

        ui.notifications.info(`Gold charged. Roll Arcana DC ${data.dc} for your Copy Spell.`);

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
        const arcana = actor.system?.skills?.arc;
        const modifier = arcana?.total ?? arcana?.mod ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        const success = total >= dc;

        const tierLabel = success ? "Success" : "Failed";
        const tierColor = success ? "#7eb8da" : "#e88";
        const narrative = success
            ? "You study the unfamiliar notation, deciphering its meaning. The spell takes shape in your book, written in your own hand."
            : "The notation resists your understanding. The inks and materials are consumed, but the spell eludes you.";

        // Post the roll as a chat message (whispered to owner + GM)
        const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>Copy Spell</strong> (ARC) - DC ${dc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${narrative}`,
            whisper: ownerIds
        });

        // Post the receipt
        const receiptHtml = `
            <div style="border: 1px solid rgba(120,180,220,0.3); border-radius: 6px; padding: 0.5rem; background: rgba(30,35,50,0.85);">
                <div style="font-weight: 600; color: ${tierColor};">
                    <i class="fas fa-receipt"></i> Spell Transcription Receipt - ${tierLabel}
                </div>
                <div style="font-size: 0.85rem; color: #ccc; margin-top: 0.3rem;">
                    <strong>${actor.name}</strong> spent <strong>${cost}gp</strong> on inks to copy a level ${data.spellLevel} spell.<br>
                    <span style="color: #888;">Remaining gold: ${data.remainingGold}gp</span>
                </div>
                ${success
                    ? `<div style="font-size: 0.85rem; color: #7eb8da; margin-top: 0.3rem;">
                        <i class="fas fa-check-circle"></i> The spell is now in your spellbook.
                       </div>`
                    : `<div style="font-size: 0.85rem; color: #e88; margin-top: 0.3rem;">
                        <i class="fas fa-times-circle"></i> The attempt failed. Materials consumed. If copying from a scroll, remove it.
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

        ui.notifications.info(`Copy Spell: ${tierLabel}. ${cost}gp spent.`);
    }

    /**
     * GM receives a decline from the player.
     * @param {Object} data - { actorId }
     */
    static handleDecline(data) {
        if (!game.user.isGM) return;
        const actor = game.actors.get(data.actorId);
        ui.notifications.info(`${actor?.name ?? "Player"} declined the Copy Spell transaction.`);
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
            const tierLabel = data.success ? "Success" : "Failed";
            const actor = game.actors.get(data.actorId);
            ui.notifications.info(`${actor?.name ?? "Player"}: Copy Spell - ${tierLabel}. ${data.cost}gp charged.`);
            app.render();
            app._saveRestState?.();
        } else {
            // Player: update app UI
            app._copySpellProposal = null;
            app._copySpellResult = data;
            app.render();
        }
    }
}
