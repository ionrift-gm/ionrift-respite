# Respite UI Rework v2 — Design Sketch

> Branch: `ui-rework-v2` (from `cooking-wip`)
> Goal: Break the current 7-phase wizard into a flow that feels natural, teaches
> players the system through their gear, and only asks the GM for decisions that matter.

---

## Philosophy

The current flow is GM-centric: the GM configures everything up front, players
wait, then players pick an activity. The rework flips this:

- **The GM sets the scene** (terrain + weather — one screen, smart defaults).
- **The players set up camp** (tent, fire, gear — this is where comfort comes from).
- **The system explains itself through gear** ("You have a bedroll → +1 comfort").
- **Advanced options exist but don't block the flow.**

---

## Revised Phase Sequence

```
1. Scene        (GM — quick or advanced)
2. Travel       (GM + Players — if applicable)
3. Make Camp    (Players — tent, fire, gear → comfort)
4. Activities   (Players — what do you do tonight?)
5. Nightfall    (Reflection + Sleep — merged, campfire-first)
6. Encounters   (GM — event roll, complications, combat)
7. Morning      (Resolution — recovery, outcomes)
```

### Phase Count: Still 7, but feels like 4

Phases 1-3 can auto-collapse when defaults are fine.
Phase 5 is atmospheric, not a blocker.
The *felt* flow for a standard rest:

```
Scene (1 click) → Activities → Encounters → Morning
```

---

## Phase 1: SCENE (GM Only)

### Default Mode
One screen. Pre-filled from terrain.

```
┌─────────────────────────────────────────────┐
│  🏔️ Mountain Pass · Long Rest              │
│                                             │
│  Weather: Clear ☀️          [Change ▾]      │
│  Comfort: Rough (terrain default)           │
│                                             │
│  [ ⚙️ Advanced ]        [ Begin Rest ▶ ]   │
└─────────────────────────────────────────────┘
```

- Terrain auto-detected from scene or last-used. One dropdown if needed.
- Weather defaults to Clear. One-click override.
- Comfort is *derived*, not configured. Shown as a label, not a dropdown.
  The GM sees what the terrain gives them. Player gear adjusts it later.
- **"Advanced"** expands: scouting toggle, encounter DC adjustment,
  days-since-rest stepper, comfort override.
- **No shelter step.** Shelter is inferred from player gear in Phase 3.

### What changes from current
- Weather + Comfort + Shelter collapsed into one screen with smart defaults
- No 3-step accordion — single view with optional Advanced drawer
- Shelter concept removed from setup entirely

---

## Phase 2: TRAVEL (If Applicable)

Only appears when terrain has travel options (forage/hunt/scout enabled).
Skipped entirely for inn/tavern/city terrains.

### Simple Mode (default)
```
┌─────────────────────────────────────────────┐
│  🥾 Travel — Forest (1 day)                │
│                                             │
│  What did you do while travelling?          │
│                                             │
│  🧝 Elandril    [ Forage ▾ ] [✓]           │
│  🧔 Randal      [ Hunt   ▾ ] [✓]           │
│  🧙 Mira        [ Scout  ▾ ] [✓]           │
│  ⚔️ Korrin      [ —      ▾ ] [✓]           │
│                                             │
│  [ Roll All ▶ ]                             │
└─────────────────────────────────────────────┘
```

- Players can pick from their own client (socket-driven).
- GM sees all choices, can override, clicks "Roll All" when ready.
- Results appear inline — no separate resolve step per day.
- **Advanced** expands: per-day tabs, DC adjustments, custom "Other" rolls.

### What changes from current
- No per-day resolve loop for simple cases (1-day travel)
- Player lock-in becomes the default flow, not an extra step
- Multi-day tabs only appear in Advanced mode

---

## Phase 3: MAKE CAMP (Players)

**This is the new phase.** Currently shelter/comfort is a GM dropdown.
The rework makes it player-facing and gear-driven.

```
┌─────────────────────────────────────────────────────┐
│  ⛺ Make Camp                                       │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  🔥 CAMPFIRE                                │    │
│  │                                             │    │
│  │  [Light the Fire]                           │    │
│  │                                             │    │
│  │  Why: Cooking, warmth, morale.              │    │
│  │  Fire improves comfort and enables cooking. │    │
│  │  Requires firewood (1 log per night).       │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────┐  ┌─────────────────┐           │
│  │  ⛺ TENT        │  │  🛏️ BEDROLL     │           │
│  │                 │  │                 │           │
│  │  Randal: ✅ Has │  │  Randal: ✅ Has │           │
│  │  Mira:   ❌ No  │  │  Mira:   ✅ Has │           │
│  │                 │  │                 │           │
│  │  Blocks weather │  │  +1 comfort     │           │
│  │  penalties      │  │  for that PC    │           │
│  └─────────────────┘  └─────────────────┘           │
│                                                     │
│  ┌─────────────────┐                                │
│  │  🍳 MESS KIT    │                                │
│  │                 │                                │
│  │  Randal: ✅ Has │                                │
│  │  Mira:   ✅ Has │                                │
│  │                 │                                │
│  │  Enables cooked │                                │
│  │  meals (better  │                                │
│  │  food bonuses)  │                                │
│  └─────────────────┘                                │
│                                                     │
│  Camp Comfort: Rough → Comfortable (bedrolls + fire)│
│                                                     │
│  [ Continue ▶ ]                                     │
└─────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Gear-driven comfort.** The system scans each character's inventory for
   tent, bedroll, mess kit, firewood. No GM dropdown needed.

2. **Comfort is *explained*, not configured.** Instead of "Comfort: Sheltered"
   as an opaque label, the player sees *why*:
   - Base: Rough (terrain default)
   - +1 Bedroll
   - +1 Fire lit
   - = Comfortable

3. **Tent replaces Shelter step.** If someone has a tent, they block weather.
   If nobody does, weather penalties apply. No radio buttons needed.
   If the party has Leomund's Tiny Hut or similar, the system detects it
   from spell prep (already implemented) and auto-applies.

4. **Fire is a player interaction.** Currently fire lives in a drawer during
   Activities. Moving it to Make Camp makes it a visible, meaningful choice:
   "Do you burn a firewood log for warmth and cooking?"

5. **Mess Kit enables cooking.** This ties into the cooking branch work —
   if you have a mess kit and a fire, you can cook during Activities.
   Without them, you eat raw rations.

### What changes from current
- Shelter step eliminated from Setup
- Comfort dropdown eliminated — derived from gear
- Fire moved from Activities sidebar to Make Camp
- Players understand what their gear does through the UI
- GM only intervenes if they want to override (Advanced in Scene)

---

## Phase 4: ACTIVITIES (Players)

Similar to current but simplified:

### Changes from current

1. **Default activity: Rest Fully.** Every character starts with Rest Fully
   pre-selected. Changing is optional, not required.

2. **No confirm step.** Clicking a tile selects it. Clicking again deselects.
   Detail panel is available via an info icon, not a mandatory confirmation flow.

3. **Tile hierarchy.** Common activities (Keep Watch, Rest Fully) are prominent.
   Exotic ones (Fletch Arrows, Study) are in a "More" section.

4. **Cooking appears here** (if fire lit + mess kit). "Cook a Meal" tile,
   powered by the cooking branch recipes.

5. **Rations fold in.** At the bottom of Activities, a simple rations bar:
   ```
   🍖 Rations: [Auto-consume ✓]  Randal: 4 remaining  |  Mira: 2 remaining
   💧 Water:   [Auto-consume ✓]  Randal: Waterskin     |  Mira: Waterskin
   ```
   Auto-consume is on by default. Click to override (drag-drop for edge cases).

```
┌────────────────────────────────────────────────────────┐
│  🎯 Activities (1/2 resolved)                          │
│                                                        │
│  [ AFK ] [ 🧝 Elandril ] [ 🧔 Randal ✓ ] [GM 🎲]    │
│                                                        │
│  Randal · Keep Watch                                   │
│                                                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ 👁️ Keep      │ │ 💤 Rest      │ │ 🩹 Tend      │   │
│  │ Watch  [SEL] │ │ Fully        │ │ Wounds       │   │
│  │   PASSIVE    │ │   PASSIVE    │ │   SKILL      │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ┌──────────────┐ ┌──────────────┐                     │
│  │ 🍳 Cook a    │ │ ▼ More...    │                     │
│  │ Meal         │ │              │                     │
│  │   SKILL      │ │              │                     │
│  └──────────────┘ └──────────────┘                     │
│                                                        │
│  ─── Rations ──────────────────────────────────        │
│  🍖 Auto-consume [✓]  4 rations remaining             │
│  💧 Auto-consume [✓]  Waterskin (full)                 │
│                                                        │
│  [ Proceed to Nightfall ▶ ]                            │
└────────────────────────────────────────────────────────┘
```

---

## Phase 5: NIGHTFALL (Reflection + Sleep — merged)

Replaces the current separate Campfire and transition-to-events phases.

```
┌────────────────────────────────────────────────────┐
│  🌙 Nightfall                                      │
│                                                    │
│  The fire crackles. The stars emerge.              │
│                                                    │
│  ┌──────────────┐ ┌──────────────┐                 │
│  │ 📖 Reflect   │ │ 📜 Quests    │                 │
│  │ on the Day   │ │              │                 │
│  └──────────────┘ └──────────────┘                 │
│  ┌──────────────┐ ┌──────────────┐                 │
│  │ 💬 Share a   │ │ 🧭 Plan for  │                 │
│  │ Story        │ │ Tomorrow     │                 │
│  └──────────────┘ └──────────────┘                 │
│                                                    │
│  These are conversation starters.                  │
│  No rolls, no mechanics. Take as long as you like. │
│                                                    │
│  [ The Night Passes ▶ ]                            │
└────────────────────────────────────────────────────┘
```

- Feels like a natural pause, not a wizard step.
- Reduced to 4 tiles (from 6). "Mend & Prepare" and "Study Lore" are activities, not reflections.
- The phase indicator shows this as a transition dot, not a major phase.
- **Auto-advance option in settings:** "Skip Nightfall phase" for groups that don't RP rests.

---

## Phase 6: ENCOUNTERS (GM)

Mostly unchanged — this is the strongest phase in the current flow.
Minor tweaks:

- Rename from "Events" to "Encounters" — clearer for new GMs.
- If the encounter roll produces nothing, show a brief "Peaceful night" message
  and auto-advance after 3 seconds (with a "Wait" button to pause).

---

## Phase 7: MORNING (Resolution)

Mostly unchanged. Rename from "Resolution" to "Morning" for flavour.

---

## Flow Summary

### Minimum-Click Path (standard rest, no travel, defaults)

| Phase | GM Clicks | Player Clicks |
|---|---|---|
| Scene | 1 (Begin Rest) | 0 |
| Travel | skipped | skipped |
| Make Camp | 0 (auto-scanned) | 1 (light fire) |
| Activities | 0 (pre-selected) | 0-1 (change if desired) |
| Nightfall | 1 (The Night Passes) | 0 |
| Encounters | 1-2 (depends on roll) | 0 |
| Morning | 1 (Apply Results) | 0 |

**Total: ~4 GM clicks, ~1 player click** for a standard rest.
Current flow: ~12+ GM clicks, ~4+ player clicks.

### Maximum-Control Path (advanced travel, custom comfort, cooking)

All current functionality still accessible via Advanced drawers.
Power users lose nothing.

---

## Migration Notes

### What can be reused from current code
- `RestFlowEngine` — core resolution logic, untouched
- `EventResolver`, `DecisionTreeResolver` — encounters phase, untouched
- `ActivityResolver` — activity definitions, mostly reused
- `MealPhaseHandler` — rations auto-consume logic exists, just needs a toggle
- `CampfireTokenLinker` — fire state management, reused in Make Camp
- `RecoveryHandler` — resolution, untouched

### What needs significant rework
- `RestSetupApp._prepareContext()` — the context builder for templates
- `rest-setup.hbs` — template is 3000 lines and phase-monolithic
- Phase state machine (`this._phase` transitions)
- Socket sync payloads (phase names change)

### What's new
- `MakeCampPhase` — gear scanning, comfort derivation, fire interaction
- Rations auto-consume toggle (simple toggle, not drag-drop default)
- Activity pre-selection logic
- Phase auto-skip logic

---

## Open Questions

1. **Shelter spells (Tiny Hut, Rope Trick).** Currently handled in Setup step 3.
   In the rework, do these auto-apply in Make Camp (detected from spell prep)?
   Or does the GM still toggle them?

2. **Comfort override.** If the GM disagrees with gear-derived comfort,
   where does the override live? Advanced drawer in Scene, or a GM badge
   in Make Camp?

3. **Cooking integration.** The cooking branch has recipes, mess kits, and
   ingredient scanning. How much of that surfaces in Make Camp vs Activities?
   Proposal: Make Camp shows "you can cook" (has fire + mess kit).
   Activities shows the actual Cook a Meal tile with recipe selection.

4. **Armor doff/don.** Currently in Activities. Should it move to Make Camp
   (you're setting up camp, take off your armour)?

5. **Player-owned camp setup.** If Make Camp is player-facing, does each
   player set up their own gear? Or does the GM see everyone's gear?
   Proposal: Each player sees their own card. GM sees all cards.
