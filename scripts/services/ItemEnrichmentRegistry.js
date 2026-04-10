/**
 * ItemEnrichmentRegistry
 *
 * Maps SRD item names to enriched descriptions that explain their mechanical
 * significance within the Respite rest system. Workshop calls into this at
 * cache generation time to patch item descriptions before they reach the player.
 *
 * The registry is intentionally name-based (case-insensitive) rather than
 * UUID-based so it works regardless of which compendium the item originated from.
 */
export class ItemEnrichmentRegistry {

    /**
     * The enrichment map. Keys are lowercase item names.
     * Each entry contains:
     *   html   - HTML fragment appended to the item's description
     *   tags   - Short mechanical tags for UI badges (optional)
     */
    static ENRICHMENTS = {

        // ── Bedroll ──────────────────────────────────────────────────
        "bedroll": {
            html: `<hr><p><strong>Respite:</strong> A character carrying a bedroll recovers <strong>+1 Hit Die</strong> during a long rest, regardless of camp comfort level. This bonus stacks with normal HD recovery.</p>`,
            tags: ["+1 HD Recovery"]
        },

        // ── Tents ────────────────────────────────────────────────────
        "two-person tent": {
            html: `<hr><p><strong>Respite:</strong> Provides <strong>Shelter</strong> for up to 2 characters during rest. Shelter reduces the encounter DC and can negate minor weather effects. Place in a character's inventory to count toward the camp's shelter total.</p>`,
            tags: ["Shelter (2 persons)", "Weather Protection"]
        },

        "tent, two-person": {
            html: `<hr><p><strong>Respite:</strong> Provides <strong>Shelter</strong> for up to 2 characters during rest. Shelter reduces the encounter DC and can negate minor weather effects. Place in a character's inventory to count toward the camp's shelter total.</p>`,
            tags: ["Shelter (2 persons)", "Weather Protection"]
        },

        "pavilion": {
            html: `<hr><p><strong>Respite:</strong> A large pavilion tent provides <strong>Shelter</strong> for up to 10 characters during rest. Provides full weather protection and significantly reduces the encounter DC. Ideal for large parties or extended camps.</p>`,
            tags: ["Shelter (10 persons)", "Full Weather Protection"]
        },

        "tent": {
            html: `<hr><p><strong>Respite:</strong> Provides <strong>Shelter</strong> during rest. Shelter reduces the encounter DC and can negate minor weather effects. The number of characters sheltered depends on the tent's size.</p>`,
            tags: ["Shelter", "Weather Protection"]
        },

        // ── Mess Kit ─────────────────────────────────────────────────
        "mess kit": {
            html: `<hr><p><strong>Respite:</strong> A character carrying a mess kit gains <strong>advantage on the exhaustion save</strong> during rest, but only when the campfire is lit. Without a fire, the mess kit provides no mechanical benefit. Functions identically to Cook's Utensils for this purpose.</p>`,
            tags: ["Exhaustion Advantage (with fire)"]
        },

        // ── Cook's Utensils ──────────────────────────────────────────
        "cook's utensils": {
            html: `<hr><p><strong>Respite:</strong> A character carrying Cook's Utensils gains <strong>advantage on the exhaustion save</strong> during rest when the campfire is lit. Also qualifies for the <strong>Cooking</strong> crafting profession, allowing the character to prepare meals that grant temporary buffs.</p>`,
            tags: ["Exhaustion Advantage (with fire)", "Cooking Profession"]
        },

        // ── Rations ──────────────────────────────────────────────────
        "rations": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 ration per day (some terrains require 2). Characters who go without food risk exhaustion after their grace period expires. Rations are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)"]
        },

        "rations (1 day)": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 ration per day (some terrains require 2). Characters who go without food risk exhaustion after their grace period expires. Rations are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)"]
        },

        // ── Waterskin ────────────────────────────────────────────────
        "waterskin": {
            html: `<hr><p><strong>Respite:</strong> Consumed during the <strong>Meal Phase</strong> of a long rest. Each character requires 1 waterskin per day (desert and arid terrains require 2). Dehydration is tracked separately from hunger and triggers a CON save. Waterskins are automatically decremented during the rest flow.</p>`,
            tags: ["Meal Phase (1/day)", "Dehydration Tracking"]
        },

        // ── Herbalism Kit ────────────────────────────────────────────
        "herbalism kit": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Herbalism</strong> crafting profession during rest. Characters proficient with this kit can gather and prepare herbal remedies, antidotes, and poultices during the Activity phase.</p>`,
            tags: ["Herbalism Profession"]
        },

        // ── Healer's Kit ─────────────────────────────────────────────
        "healer's kit": {
            html: `<hr><p><strong>Respite:</strong> Used during the <strong>Tend Wounds</strong> activity. A character with a Healer's Kit can spend charges to provide additional HP recovery to injured party members beyond the standard rest recovery.</p>`,
            tags: ["Tend Wounds Activity"]
        },

        // ── Alchemist's Supplies ─────────────────────────────────────
        "alchemist's supplies": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Alchemy</strong> crafting profession during rest. Characters proficient with these supplies can brew potions and concoctions during the Activity phase.</p>`,
            tags: ["Alchemy Profession"]
        },

        // ── Tinker's Tools ───────────────────────────────────────────
        "tinker's tools": {
            html: `<hr><p><strong>Respite:</strong> Qualifies for the <strong>Tinkering</strong> crafting profession during rest. Characters proficient with these tools can repair gear or craft small mechanical devices during the Activity phase.</p>`,
            tags: ["Tinkering Profession"]
        },
    };

    /**
     * Look up enrichment for a given item name.
     * @param {string} itemName - The item's display name.
     * @returns {Object|null} { html, tags } or null if no enrichment exists.
     */
    static get(itemName) {
        if (!itemName) return null;
        return this.ENRICHMENTS[itemName.toLowerCase()] ?? null;
    }

    /**
     * Returns all enrichment keys (for debugging/inspection).
     * @returns {string[]}
     */
    static getRegisteredNames() {
        return Object.keys(this.ENRICHMENTS);
    }

    /**
     * Hook handler for renderItemSheet. Appends enrichment HTML to the
     * description tab when viewing an SRD item that has a Respite enrichment.
     * @param {Application} app - The ItemSheet application.
     * @param {jQuery|HTMLElement} html - The rendered HTML.
     * @param {Object} data - Sheet data.
     */
    static onRenderItemSheet(app, html, data) {
        const item = app.document ?? app.object;
        if (!item?.name) return;

        const enrichment = ItemEnrichmentRegistry.get(item.name);
        if (!enrichment) return;

        // Guard: don't inject twice (re-renders)
        const jHtml = html instanceof jQuery ? html : $(html);
        if (jHtml.find(".ionrift-enrichment").length) return;

        // Find the description tab content pane. Avoid a nav element that might also have data-tab=description.
        let target = jHtml.find(".tab[data-tab='description']");
        
        // V1 fallback
        if (!target.length) target = jHtml.find(".editor").first();
        if (!target.length) target = jHtml.find(".editor-content").first();

        // Blind fallback
        if (!target.length) target = jHtml.find("form");

        if (!target.length) {
            console.warn("ItemEnrichmentRegistry | Could not find description DOM to inject enrichment.");
            return;
        }

        const enrichBlock = $(`<div class="ionrift-enrichment" style="
            margin-bottom: 12px;
            padding: 8px 10px;
            background: rgba(155, 89, 182, 0.08); /* faint purple */
            border-left: 3px solid rgba(155, 89, 182, 0.5);
            border-radius: 0 4px 4px 0;
            font-size: 0.9em;
            line-height: 1.4;
        ">${enrichment.html}</div>`);

        target.prepend(enrichBlock);
    }
}
