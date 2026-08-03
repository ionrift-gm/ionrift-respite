# Dynamic Sustenance Needs & Disease Flags (Respite)

Respite supports dynamic, per-character food and water requirements during the Meal phase of rests. Characters can have their daily ration or water needs modified dynamically via **Actor Flags**, **Active Effects** (e.g., diseases, parasites, curses, or racial traits), module settings, or Foundry hooks.

---

## 1. How It Works

When Respite computes a character's meal requirements for the rest:
1. It calculates baseline needs based on terrain (e.g., Forest = 1 food, 2 water; Desert = 1 food, 4 water).
2. It evaluates character-specific **flags** and **Active Effects**.
3. Multipliers and flat modifiers are applied to baseline terrain rules:
   $$\text{Water Needed} = \min\left( \text{maxWaterCap}, \max\left(1, \text{round}(\text{baseWater} \times \text{waterMultiplier}) + \text{waterModifier} \right) \right)$$
   $$\text{Food Needed} = \min\left( \text{maxFoodCap}, \max\left(1, \text{round}(\text{baseFood} \times \text{foodMultiplier}) + \text{foodModifier} \right) \right)$$
4. Ceiling caps enforce reasonable daily maximums so compounding effects (e.g., Desert terrain + Dysentery) remain playable.

---

## 2. Actor Flags Reference

Set these flags under the `"ionrift-respite"` scope on any Actor document:

| Flag Key | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `waterMultiplier` | `number` | Multiplies daily water requirement | `2` (Double water requirement) |
| `foodMultiplier` | `number` | Multiplies daily food requirement | `2` (Double food requirement) |
| `waterModifier` | `number` | Flat additive/subtractive adjustment to water pints needed | `+1` or `-1` |
| `foodModifier` | `number` | Flat additive/subtractive adjustment to food rations needed | `+1` or `-1` |
| `waterPerDay` | `number` | Hard override for total water pints needed per day | `3` |
| `foodPerDay` | `number` | Hard override for total food rations needed per day | `2` |

---

## 3. Active Effects Integration (Diseases, Curses, Traits)

GMs and module authors can create **Active Effects** on character sheets (e.g., Dysentery, Dehydration Sickness, Voracious Appetite) that automatically modify sustenance needs while active.

### Active Effect Examples

#### **Disease: Dysentery (Double Water Requirement)**
- **Effect Name:** Dysentery
- **Changes / Effects:**
  - **Attribute Key:** `flags.ionrift-respite.waterMultiplier`
  - **Change Mode:** `OVERRIDE` (or `ADD`)
  - **Value:** `2`

#### **Curse: Gluttony (Double Rations Requirement)**
- **Effect Name:** Curse of Gluttony
- **Changes / Effects:**
  - **Attribute Key:** `flags.ionrift-respite.foodMultiplier`
  - **Change Mode:** `OVERRIDE`
  - **Value:** `2`

#### **Trait: Desert Wanderer (Flat -1 Water Pint)**
- **Effect Name:** Arid Adaptation
- **Changes / Effects:**
  - **Attribute Key:** `flags.ionrift-respite.waterModifier`
  - **Change Mode:** `ADD`
  - **Value:** `-1`

---

## 4. Ceiling Caps & World Settings

To prevent excessive requirements when terrain penalties stack with diseases (e.g., drinking 8 pints of water in a desert), Respite enforces world-configurable daily ceilings:

- **`maxWaterPerDayCap`** *(Default: 4 pints)*: Maximum water required per day regardless of multipliers.
- **`maxFoodPerDayCap`** *(Default: 3 rations)*: Maximum food required per day regardless of multipliers.

GMs can adjust these caps in **Module Settings -> Recovery Rules**.

---

## 5. Developer Hook

Respite fires a hook after resolving individual actor needs:

```javascript
Hooks.on("ionrift-respite.getActorMealNeeds", (actor, result, effectiveRules) => {
    // result = { foodPerDay: number, waterPerDay: number }
    if (actor.name === "Gorging Ogre") {
        result.foodPerDay += 1;
    }
});
```

---

## 6. GM Macro: Set / Clear Sustenance Flags

GMs can modify selected tokens using this macro:

```javascript
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) return ui.notifications.warn("Select a token first!");

new Dialog({
    title: `Sustenance Flags: ${actor.name}`,
    content: `
        <form>
            <div class="form-group">
                <label>Water Multiplier (e.g. 2 for double):</label>
                <input type="number" step="0.5" name="waterMultiplier" value="${actor.getFlag("ionrift-respite", "waterMultiplier") ?? 1}"/>
            </div>
            <div class="form-group">
                <label>Food Multiplier (e.g. 2 for double):</label>
                <input type="number" step="0.5" name="foodMultiplier" value="${actor.getFlag("ionrift-respite", "foodMultiplier") ?? 1}"/>
            </div>
        </form>
    `,
    buttons: {
        apply: {
            label: "Save Flags",
            callback: async (html) => {
                const wm = parseFloat(html.find('[name="waterMultiplier"]').val()) || 1;
                const fm = parseFloat(html.find('[name="foodMultiplier"]').val()) || 1;
                await actor.setFlag("ionrift-respite", "waterMultiplier", wm);
                await actor.setFlag("ionrift-respite", "foodMultiplier", fm);
                ui.notifications.info(`Updated sustenance flags for ${actor.name}`);
            }
        },
        reset: {
            label: "Reset to Normal",
            callback: async () => {
                await actor.unsetFlag("ionrift-respite", "waterMultiplier");
                await actor.unsetFlag("ionrift-respite", "foodMultiplier");
                await actor.unsetFlag("ionrift-respite", "waterModifier");
                await actor.unsetFlag("ionrift-respite", "foodModifier");
                ui.notifications.info(`Reset sustenance flags for ${actor.name}`);
            }
        }
    }
}).render(true);
```
