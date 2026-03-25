/**
 * EventResolver
 * Pool-based event selection during the Events phase.
 * Events are selected by terrain tag, tier, and sentiment using weighted random.
 * Tables provide rollFormula and noEventThreshold for DC calculation only.
 */
export class EventResolver {

    constructor() {
        /** @type {Map<string, Object>} Event tables keyed by terrain tag (for DC/threshold). */
        this.tables = new Map();
        /** @type {Map<string, Object>} Individual events keyed by ID. */
        this.events = new Map();
    }

    /**
     * Loads event table and event definitions from JSON data.
     * Filters by enabled packs if available.
     * @param {Object[]} tableData - Array of event table schemas.
     * @param {Object[]} eventData - Array of event schemas.
     */
    load(tableData, eventData) {
        for (const table of tableData) {
            this.tables.set(table.terrainTag, table);
        }

        // Check enabled packs (if setting exists)
        let enabledPacks = null;
        try {
            enabledPacks = game.settings.get("ionrift-respite", "enabledPacks");
        } catch (e) { /* setting may not exist yet */ }

        for (const event of eventData) {
            // Filter by pack if pack registry is active
            if (enabledPacks && event.pack && enabledPacks[event.pack] === false) {
                continue;
            }
            this.events.set(event.id, event);
        }
    }

    /**
     * Rolls for events during a rest.
     * @param {string} terrainTag
     * @param {Object[]} watchRoster - Characters on watch.
     * @param {number} effectiveDC - Final encounter DC (all modifiers baked in).
     * @param {string} [scoutTier] - Scouting result tier (nat1, nat20, etc.)
     * @returns {Object[]} Array of triggered event results.
     */
    async roll(terrainTag, watchRoster = [], effectiveDC = 15, scoutTier = "none") {
        const table = this.tables.get(terrainTag);
        if (!table) {
            // No table for this terrain — check if we have any events at all
            const hasEvents = [...this.events.values()].some(e => e.terrainTags?.includes(terrainTag));
            if (!hasEvents) return [];
        }

        const results = [];
        const hasWatch = watchRoster.length > 0;

        // ── Nat 1 scouting: inject a guaranteed negative event ──
        if (scoutTier === "nat1") {
            const bonus = this._pickFromPool(terrainTag, {
                tier: "normal",
                sentiment: "negative",
                hasWatch
            });
            if (bonus) {
                results.push(this._buildResult(bonus, watchRoster, {
                    rollTotal: null,
                    result: "scouting_hazard",
                    narrativePrefix: "Poor campsite. "
                }));
            }
        }

        // ── Nat 20 scouting: inject a guaranteed positive event ──
        if (scoutTier === "nat20") {
            const bonus = this._pickFromPool(terrainTag, {
                tier: "normal",
                sentiment: "positive",
                hasWatch
            });
            if (bonus) {
                results.push(this._buildResult(bonus, watchRoster, {
                    rollTotal: null,
                    result: "scouting_bonus",
                    narrativePrefix: "Perfect campsite. "
                }));
            }
        }

        // ── Roll a clean d20, compare against effective DC ──
        const rollFormula = table?.rollFormula ?? "1d20";
        const roll = await new Roll(rollFormula).evaluate();
        const rawDie = roll.total;

        console.log(`[Respite:EventResolver] roll — terrain=${terrainTag}, rawDie=${rawDie}, effectiveDC=${effectiveDC}, passesThreshold=${rawDie >= effectiveDC}`);

        // ── Nat 1: Disaster roll (only actual nat 1 on the die) ──
        if (rawDie === 1) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Event Roll</strong> (${terrainTag}) DC ${effectiveDC}<br><em style="color:#e74c3c;">Natural 1 - Disaster!</em>`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            if (game.modules.get("dice-so-nice")?.active) {
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 5000);
                    Hooks.once("diceSoNiceRollComplete", () => { clearTimeout(timeout); resolve(); });
                });
            }

            // Exclude events already picked by scouting
            const existingIds = results.map(r => r.id).filter(Boolean);

            const buildOption = (evt) => {
                if (!evt) return null;
                return this._buildResult(evt, watchRoster, {
                    rollTotal: rawDie,
                    result: "triggered"
                });
            };

            // 1. Primary: Decision tree disaster event
            const treeEvent = this._pickFromPool(terrainTag, {
                tier: "disaster",
                hasWatch,
                excludeIds: existingIds
            });

            // 2. Fallback A: Combat encounter (normal tier, negative sentiment)
            const encounterEvent = this._pickFromPool(terrainTag, {
                tier: "normal",
                category: "encounter",
                hasWatch,
                excludeIds: [...existingIds, treeEvent?.id].filter(Boolean)
            });

            // 3. Fallback B: Two normal negative/positive events (no decision trees)
            const allExclude = [...existingIds, treeEvent?.id, encounterEvent?.id].filter(Boolean);
            const normal1 = this._pickFromPool(terrainTag, {
                tier: "normal",
                sentiment: "negative",
                skipDecisionTrees: true,
                hasWatch,
                excludeIds: allExclude
            });
            const allExclude2 = [...allExclude, normal1?.id].filter(Boolean);
            const normal2 = this._pickFromPool(terrainTag, {
                tier: "normal",
                sentiment: "positive",
                skipDecisionTrees: true,
                hasWatch,
                excludeIds: allExclude2
            }) ?? this._pickFromPool(terrainTag, {
                tier: "normal",
                sentiment: "negative",
                skipDecisionTrees: true,
                hasWatch,
                excludeIds: allExclude2
            });

            // Return disaster choice for the GM to resolve
            results.disasterChoice = {
                tree: treeEvent ? buildOption(treeEvent) : null,
                encounter: encounterEvent ? buildOption(encounterEvent) : null,
                normals: [normal1, normal2].filter(Boolean).map(buildOption)
            };
            return results;
        }

        // ── Roll meets or beats DC: quiet rest ──
        if (rawDie >= effectiveDC) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Event Roll</strong> (${terrainTag}) DC ${effectiveDC}<br>The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            if (game.modules.get("dice-so-nice")?.active) {
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 5000);
                    Hooks.once("diceSoNiceRollComplete", () => { clearTimeout(timeout); resolve(); });
                });
            }
            return results;
        }

        // ── Roll below DC: pick a normal-tier event from the pool ──
        const existingIds = results.map(r => r.id).filter(Boolean);
        const event = this._pickFromPool(terrainTag, {
            tier: "normal",
            hasWatch,
            excludeIds: existingIds
        });

        if (!event) return results;

        // Post event roll to chat (GM only)
        await roll.toMessage({
            speaker: { alias: "Night Watch" },
            flavor: `<strong>Event Roll</strong> (${terrainTag}) DC ${effectiveDC}<br><em>${event.name}</em> triggered!`,
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });
        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                Hooks.once("diceSoNiceRollComplete", () => { clearTimeout(timeout); resolve(); });
            });
        }

        results.push(this._buildResult(event, watchRoster, {
            rollTotal: rawDie,
            result: "triggered"
        }));

        return results;
    }

    // ── Pool Selection ──────────────────────────────────────────────────

    /**
     * Picks a random event from the pool matching the given criteria.
     * Uses weighted random selection based on each event's weight field.
     *
     * Recency tracking:
     * - disasterHistory: array of previously picked disaster event IDs.
     *   Events in this list are excluded. If ALL matching disasters are in
     *   the history (full cycle), the filter resets and any may be picked.
     *   Cap: 20 entries (oldest are dropped).
     * - eventHistory: array of previously picked standard event IDs.
     *   Events in the most recent 4 entries are excluded. If ALL matching
     *   events are in the window, the filter resets.
     *
     * @param {string} terrainTag
     * @param {Object} filters
     * @param {string} [filters.tier] - Required tier (normal, disaster).
     * @param {string} [filters.sentiment] - Required sentiment (negative, positive, neutral).
     * @param {string} [filters.category] - Required category (encounter, complication, etc.).
     * @param {boolean} [filters.hasWatch=true] - Whether watch roster has members.
     * @param {boolean} [filters.skipDecisionTrees=false] - Exclude decision_tree events.
     * @param {string[]} [filters.excludeIds=[]] - Event IDs to exclude.
     * @param {string[]} [filters.disasterHistory=[]] - Previously picked disaster IDs.
     * @param {string[]} [filters.eventHistory=[]] - Previously picked standard event IDs.
     * @returns {Object|null}
     */
    _pickFromPool(terrainTag, filters = {}) {
        const {
            tier, sentiment, category,
            hasWatch = true,
            skipDecisionTrees = false,
            excludeIds = [],
            disasterHistory = [],
            eventHistory = []
        } = filters;

        // Build base candidate pool
        const candidates = [];
        for (const event of this.events.values()) {
            if (!event.terrainTags?.includes(terrainTag)) continue;
            if (tier && event.tier !== tier) continue;
            if (sentiment && event.sentiment !== sentiment) continue;
            if (category && event.category !== category) continue;
            if (excludeIds.includes(event.id)) continue;
            if (event.watchTarget === "watch" && !hasWatch) continue;
            if (skipDecisionTrees && event.mechanical?.type === "decision_tree") continue;
            candidates.push(event);
        }

        if (candidates.length === 0) return null;

        // Apply recency filter based on tier
        let filtered = candidates;

        if (tier === "disaster" && disasterHistory.length > 0) {
            // Disaster recency: exclude all IDs in history (capped at 20)
            const history = disasterHistory.slice(-20);
            const historySet = new Set(history);
            filtered = candidates.filter(e => !historySet.has(e.id));
            // Full-cycle reset: if every candidate was seen, allow all
            if (filtered.length === 0) filtered = candidates;
        } else if (tier !== "disaster" && eventHistory.length > 0) {
            // Standard event recency: exclude IDs in last 4 entries
            const recentWindow = eventHistory.slice(-4);
            const recentSet = new Set(recentWindow);
            filtered = candidates.filter(e => !recentSet.has(e.id));
            // Full-cycle reset: if every candidate was in the window, allow all
            if (filtered.length === 0) filtered = candidates;
        }

        return this._weightedRandom(filtered);
    }

    /**
     * Selects a random event weighted by each event's weight field.
     * @param {Object[]} candidates - Array of event objects.
     * @returns {Object} Selected event.
     */
    _weightedRandom(candidates) {
        const totalWeight = candidates.reduce((sum, e) => sum + (e.weight ?? 1), 0);
        let roll = Math.random() * totalWeight;
        for (const event of candidates) {
            roll -= (event.weight ?? 1);
            if (roll <= 0) return event;
        }
        return candidates[candidates.length - 1];
    }

    // ── Result Builder ──────────────────────────────────────────────────

    /**
     * Builds a standard event result object.
     * @param {Object} event
     * @param {Object[]} watchRoster
     * @param {Object} options
     * @returns {Object}
     */
    _buildResult(event, watchRoster, options = {}) {
        const targets = this._resolveTargets(event, watchRoster);
        return {
            id: event.id,
            name: event.name,
            category: event.category,
            description: event.description,
            mechanical: event.mechanical,
            isDecisionTree: event.mechanical?.type === "decision_tree",
            targets,
            rollTotal: options.rollTotal ?? null,
            result: options.result ?? "triggered",
            narrative: (options.narrativePrefix ?? "") + event.description,
            items: event.mechanical?.onSuccess?.items ?? [],
            effects: event.mechanical?.onFailure?.effects ?? []
        };
    }

    // ── Legacy Compatibility ────────────────────────────────────────────

    /**
     * @deprecated Use _pickFromPool() instead.
     * Kept for any external callers during migration.
     */
    _pickDisasterEvent(terrainTag, excludeIds = [], watchRoster = []) {
        return this._pickFromPool(terrainTag, {
            tier: "disaster",
            hasWatch: watchRoster.length > 0,
            excludeIds
        });
    }

    /**
     * @deprecated Use _pickFromPool() instead.
     * Kept for any external callers during migration.
     */
    _pickBonusEvent(terrainTag, category, excludeIds = [], watchRoster = [], options = {}) {
        return this._pickFromPool(terrainTag, {
            tier: "normal",
            category,
            hasWatch: watchRoster.length > 0,
            skipDecisionTrees: options.skipDecisionTrees ?? false,
            excludeIds
        });
    }

    // ── Target Resolution ───────────────────────────────────────────────

    /**
     * Determines which characters are targeted by an event.
     * @param {Object} event
     * @param {Object[]} watchRoster
     * @returns {string[]} Array of character IDs.
     */
    _resolveTargets(event, watchRoster) {
        if (event.mechanical?.targets === "watch") {
            return watchRoster.map(w => w.characterId);
        }
        if (event.mechanical?.targets === "all") {
            return game.actors.filter(a => a.hasPlayerOwner).map(a => a.id);
        }
        // Default: target watchers if present, otherwise random party member
        if (watchRoster.length > 0) {
            return watchRoster.map(w => w.characterId);
        }
        const partyActors = game.actors.filter(a => a.hasPlayerOwner);
        if (partyActors.length === 0) return [];
        const randomIndex = Math.floor(Math.random() * partyActors.length);
        return [partyActors[randomIndex].id];
    }
}
