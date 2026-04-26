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
The *felt* flow for a standard long rest:

```
Scene (2 picks + begin) → Make Camp → Activities → Encounters → Morning
```

---

## Phase 1: SCENE (GM Only)

### Core Decisions

Two things the GM *must* pick — rest type and environment. Neither can be
assumed. But they share a single screen, not a multi-step accordion.

```
┌─────────────────────────────────────────────────┐
│  RESPITE — Set the Scene                        │
│                                                 │
│  Rest Type                                      │
│  [ 🌙 Long Rest ]  [ ☕ Short Rest ]            │
│                                                 │
│  Where are you?                                 │
│  [ Forest              ▾ ]                      │
│  Dense canopy. Ample foraging. Moderate cover.  │
│                                                 │
│  Weather: Clear ☀️                [Change ▾]    │
│                                                 │
│  [ ⚙️ Advanced ]          [ Begin Rest ▶ ]     │
│                                                 │
│  ── Terrain Banner ──────────────────────────   │
│  [atmospheric art for selected terrain]         │
└─────────────────────────────────────────────────┘
```

- **Rest type** is a toggle, not a dropdown. Long Rest is default (highlighted).
  Short Rest changes the downstream flow (skip travel, simplified activities).
- **Environment** is a dropdown — the GM picks the terrain. Can't be guessed.
  The terrain hint below the dropdown explains what it means in plain language.
  Last-used terrain is remembered as the default for convenience.
- **Weather** defaults to Clear. One-click dropdown override. Only shown for
  Long Rest (weather doesn't matter for a 1-hour short rest).
- **Comfort** is NOT shown here. It's derived from player gear in Phase 3.
  The GM doesn't need to think about comfort at this point.
- **"Advanced"** expands: scouting toggle, days-since-rest stepper,
  comfort override, shelter spell toggles.
- **Encounter DC adjustment** is NOT here — it lives at the actual encounter
  roll (Phase 6) where the GM has context from activities, fire, and table talk.
- **No shelter step.** Shelter is inferred from player gear in Phase 3.

### What changes from current
- Environment + Rest Type + Weather on one screen (no accordion)
- Comfort removed from setup — derived from gear later
- Shelter removed from setup — inferred from inventory
- Short Rest path is a toggle, not a separate flow

---

## Phase 2: TRAVEL (If Applicable)

Only appears when terrain has travel options (forage/hunt/scout enabled).
Skipped entirely for inn/tavern/city terrains.

> **Rules references:** Travel Pace (PHB p.182), Foraging (DMG p.111).

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
The rework makes it player-facing and gear-driven, and teaches players
what comfort means through their own inventory.

### Two Comfort Layers

The UI shows **camp comfort** (shared) and **personal comfort** (per-PC):

- **Camp Comfort** — determined by terrain baseline, fire, and shelter spells.
  This is the floor for everyone.
- **Personal Comfort** — camp comfort + individual gear (bedroll, tent).
  Each PC can be different depending on what they carry.

### Wireframe

```
┌─────────────────────────────────────────────────────────┐
│  ⛺ Make Camp — Forest                                  │
│                                                         │
│  ┌────────────────────────────────────────────────┐     │
│  │  🔥 CAMPFIRE                                   │     │
│  │                                                │     │
│  │     [ Light the Fire ]                         │     │
│  │                                                │     │
│  │  Cooking · Warmth · Morale                     │     │
│  │  Consumes 1 firewood. Enables cooking.         │     │
│  │  Improves camp comfort by one tier.            │     │
│  │                                                │     │
│  │  🪵 Randal has 3 firewood                      │     │
│  │  🪵 Mira has 0 firewood                        │     │
│  │                                                │     │
│  │  🔧 Can light: Randal (tinderbox)              │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ── Camp Comfort ──────────────────────────────────     │
│  Base (Forest):     Rough                               │
│  + Fire:            +1                                  │
│  = Camp Comfort:    Comfortable                         │
│                                                         │
│  ── Your Rest ─────────────────────────────────────     │
│                                                         │
│  ┌─────────────────────────┐ ┌─────────────────────────┐│
│  │ 🧔 Randal               │ │ 🧙 Mira                ││
│  │                         │ │                         ││
│  │ ⛺ Tent: ✅   🛏️ ✅     │ │ ⛺ Tent: ❌   🛏️ ✅     ││
│  │ 🍳 Mess Kit: ✅         │ │ 🍳 Mess Kit: ❌         ││
│  │                         │ │                         ││
│  │ Comfort: Sheltered      │ │ Comfort: Comfortable    ││
│  │ ─────────────────────── │ │ ─────────────────────── ││
│  │ ❤️ HP: Full recovery    │ │ ❤️ HP: Full recovery    ││
│  │ 🎲 HD: Recover half     │ │ 🎲 HD: Recover half     ││
│  │    (2 of 4 HD)          │ │    (1 of 3 HD)          ││
│  │ 😴 No exhaustion risk   │ │ 😴 No exhaustion risk   ││
│  └─────────────────────────┘ └─────────────────────────┘│
│                                                         │
│  ── Without fire ──────────────────────────────────     │
│   🔥→❌  Camp drops to Rough                            │
│   ❤️     HP still recovers fully                        │
│   🎲 ⬇️  HD recovery reduced (half level − 2)           │
│   😴 ⚠️  CON save DC 15 or gain exhaustion              │
│                                                         │
│  [ Continue ▶ ]                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Dual comfort display.** Camp comfort is shared (terrain + fire + spells).
   Personal comfort stacks individual gear on top. Each player sees their
   own card with a clear breakdown of what contributes.

2. **Comfort is *explained*, not configured.** Instead of "Comfort: Sheltered"
   as an opaque label, the player sees *why*:
   - Base: Rough (terrain default)
   - +1 Fire lit
   - +1 Bedroll
   - +1 Tent
   - = Sheltered

3. **Leomund's Tiny Hut is a trade-off, not an assumption.** If a caster has
   Tiny Hut prepared, it appears as a toggle:
   ```
   🏠 Leomund's Tiny Hut (Mira)     [ Cast ]
   ⚠️ Replaces campfire. No cooking, no fire bonuses.
      Maximum comfort: Sheltered. Full weather protection.
   ```
   The player decides. Tiny Hut blocks fire/cooking but gives weather
   protection and high base comfort. It's a genuine choice, not auto-applied.

4. **Tent replaces Shelter step.** If a PC has a tent, they get weather
   protection and +1 comfort. No radio buttons, no GM selection — just
   inventory scanning.

5. **Fire lifecycle.** The campfire is **fully expanded** during Make Camp —
   it's the centrepiece of this phase. Once camp is established:
   - **Activities phase:** fire shrinks to a compact sidebar on the right
     (just the fire icon + state label, no controls).
   - **Nightfall phase:** fire visible as ambient element, no interaction.

6. **Simplified fire controls (v2 scope).** For this rework, fire is binary:
   lit or unlit. Drop fire level management, firewood quantity tracking
   beyond "has/doesn't have", whittling, and emotes. These can return
   in a future polish pass once the core flow is clean.

7. **Mess Kit enables cooking.** Visible on the personal comfort card.
   If you have a mess kit and the fire is lit, "Cook a Meal" appears
   in Activities. Without either, you eat raw rations.

### Scouting — Simplified

Scouting is a Travel activity (Phase 2), not a Make Camp feature.
In the current system, scout results feed into a debrief panel that
adjusts comfort. This adds UI complexity to Make Camp for a subtle bonus.

**Rework:** Scouting results feed directly into the encounter DC in Phase 6.
- **Best-of, not stacking.** Multiple scouts don't multiply the bonus —
  the system takes the single best scout roll. More scouts improve the
  odds of a good roll, but the DC adjustment is capped at one scout's
  contribution. (Narratively: they all find the same campsite, the best
  scout picks the spot.)
- Good scout → encounter DC increases (harder for enemies to find you)
- Bad scout / nat 1 → encounter DC decreases or hidden complication
- No debrief panel, no comfort adjustment, no Make Camp UI

The GM sees a chip at the encounter roll: "🔭 Scouted: DC +2".
The payoff is immediate and visible where it matters.

### What changes from current
- Shelter step eliminated from Setup
- Comfort dropdown eliminated — derived from gear
- Comfort shown as dual-layer breakdown (camp vs personal)
- Leomund's Tiny Hut is a player toggle with trade-off, not auto-applied
- Fire moved from Activities sidebar to Make Camp (expanded)
- Fire controls simplified to lit/unlit (drop levels, firewood tracking, emotes)
- Scouting outcome removed from Make Camp — feeds encounter DC only
- Players understand what their gear does through the UI
- GM only intervenes if they want to override (Advanced in Scene)

---

## Phase 4: ACTIVITIES (Players)

Similar to current but simplified. Fire is visible as a collapsed sidebar
on the right (carried forward from Make Camp).

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
┌────────────────────────────────────────────────────────────────┐
│  🎯 Activities (1/2 resolved)                                  │
│                                                                │
│  [ AFK ] [ 🧝 Elandril ] [ 🧔 Randal ✓ ] [GM 🎲]            │
│                                                    ┌─────────┐│
│  Randal · Keep Watch                               │ 🔥 Lit  ││
│                                                    │         ││
│  ┌──────────────┐ ┌──────────────┐ ┌────────────┐  │ Camp    ││
│  │ 👁️ Keep      │ │ 💤 Rest      │ │ 🩹 Tend    │  │ comfort ││
│  │ Watch  [SEL] │ │ Fully        │ │ Wounds     │  │ Comfy   ││
│  │   PASSIVE    │ │   PASSIVE    │ │   SKILL    │  │         ││
│  └──────────────┘ └──────────────┘ └────────────┘  └─────────┘│
│  ┌──────────────┐ ┌──────────────┐                             │
│  │ 🍳 Cook a    │ │ ▼ More...    │                             │
│  │ Meal         │ │              │                             │
│  │   SKILL      │ │              │                             │
│  └──────────────┘ └──────────────┘                             │
│                                                                │
│  ─── Rations ──────────────────────────────────                │
│  🍖 Auto-consume [✓]  4 rations remaining                     │
│  💧 Auto-consume [✓]  Waterskin (full)                         │
│                                                                │
│  [ Proceed to Nightfall ▶ ]                                    │
└────────────────────────────────────────────────────────────────┘
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
- **Encounter DC adjustment lives here**, not in Setup. By this point the GM
  knows: who kept watch, whether defenses were set, fire state, scouting
  results, and anything the players discussed. The +/- buttons sit next
  to the encounter roll, where the GM has full context to adjust.
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
| Scene | 3 (rest type + environment + begin) | 0 |
| Travel | skipped | skipped |
| Make Camp | 0 (auto-scanned) | 1 (light fire) |
| Activities | 0 (pre-selected) | 0-1 (change if desired) |
| Nightfall | 1 (The Night Passes) | 0 |
| Encounters | 1-2 (depends on roll) | 0 |
| Morning | 1 (Apply Results) | 0 |

**Total: ~6 GM clicks, ~1 player click** for a standard rest.
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
