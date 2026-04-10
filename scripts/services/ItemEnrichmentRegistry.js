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
     * Hook handler for renderItemSheet / renderItemSheet5e (ApplicationV2).
     * Injects a Respite mechanical-notes block into the item description pane.
     *
     * AppV1 signature: (app, jQueryHtml, data)
     * AppV2 signature: (app, htmlElement, context, options)
     *
     * @param {Application} app
     * @param {jQuery|HTMLElement} html
     */
    static onRenderItemSheet(app, html, ...rest) {
        const item = app.document ?? app.object ?? app.item;
        if (!item?.name) return;
        // Belt-and-suspenders: only process Item documents
        if (item.documentName && item.documentName !== "Item") return;

        const enrichment = ItemEnrichmentRegistry.get(item.name);
        if (!enrichment) return;

        // Resolve the root HTMLElement.
        // AppV2:  html IS the HTMLElement directly
        // AppV1:  html is jQuery, unwrap with [0]
        // Fallback: try app.element (AppV2 stores rendered DOM here)
        let root;
        if (html instanceof HTMLElement) {
            root = html;
        } else if (typeof jQuery !== "undefined" && html instanceof jQuery) {
            root = html[0];
        } else if (app.element instanceof HTMLElement) {
            root = app.element;
        } else if (app.element?.[0] instanceof HTMLElement) {
            // Legacy jQuery-wrapped app.element
            root = app.element[0];
        } else {
            root = html;
        }
        if (!root?.querySelector) {
            console.warn("Ionrift Respite | Cannot resolve root element for:", item.name);
            return;
        }

        // Guard: don't inject twice on re-renders
        if (root.querySelector(".ionrift-enrichment")) return;

        console.log(`Ionrift Respite | Enriching "${item.name}". Root: <${root.tagName}> classes="${root.className}"`);

        // Selector list ordered from most specific (dnd5e v3) to most general (legacy).
        // dnd5e v3 confirmed DOM: section.description.tab > .card.description.collapsible
        //   > .details.collapsible-content > .editor.editor-content.wrapper
        const selectors = [
            // dnd5e v3: inside the first collapsible description card
            ".card.description .collapsible-content",
            ".card.description .details",
            // dnd5e v3: the description tab section itself
            "section.description.tab",
            "section.tab[data-tab='description']",
            // dnd5e v2 / generic AppV1
            ".tab.description",
            ".tab[data-tab='description']",
            "[data-tab='description']",
            // Broad fallbacks
            ".editor-content",
            ".editor",
            "form"
        ];

        let target = null;
        for (const sel of selectors) {
            const el = root.querySelector(sel);
            if (el) {
                console.log(`Ionrift Respite | Injection target matched: "${sel}"`);
                target = el;
                break;
            }
        }

        if (!target) {
            console.warn("Ionrift Respite | No injection target for:", item.name,
                "Root children:", [...root.children].map(c => `${c.tagName}.${c.className}`));
            return;
        }

        const enrichDiv = document.createElement("div");
        enrichDiv.className = "ionrift-enrichment";
        enrichDiv.style.cssText = [
            "margin: 8px 0 12px",
            "padding: 8px 10px",
            "background: rgba(155, 89, 182, 0.10)",
            "border-left: 3px solid rgba(155, 89, 182, 0.6)",
            "border-radius: 0 4px 4px 0",
            "font-size: 0.9em",
            "line-height: 1.5"
        ].join(";");

        // Inject a little tent icon before the "Respite:" bold prefix
        enrichDiv.innerHTML = enrichment.html.replace(
            "<strong>Respite:</strong>",
            "<i class=\"fa-solid fa-tent\"></i> <strong>Respite:</strong>"
        );

        target.insertBefore(enrichDiv, target.firstChild);
        console.log(`Ionrift Respite | Injected enrichment for "${item.name}"`);
    }
}

