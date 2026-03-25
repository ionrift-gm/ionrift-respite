# Ionrift Respite — Backlog

## Bugs

### Late-Loading Player CON Save Soft Lock
**Severity:** High.
GM processes rations while a player's Respite app hasn't rendered yet (late join or slow load). The dehydration CON save request arrives via socket before the player's app is listening, so the save dialog never appears. GM is stuck on "Waiting for CON save(s)..." with no way to proceed.
Needs either a retry/resend mechanism or a GM override to resolve pending saves.

### Single Event Collapsed by Default
**Severity:** Medium.
When only one event fires, the accordion renders collapsed. The GM sees the event name and result tag but the narrative body is hidden behind the chevron. Fix: auto-expand when there's exactly one event.

---

## Validated Gaps

### Immunity Advantage on Event Checks
**Status:** Data authored, no resolver code.
Three events have `immunities` arrays. `EventResolver._buildResult()` never checks `actor.system.traits.dr`. Characters with matching resistances should get advantage.

### GM Event Outcome Override
**Status:** Not implemented.
No mechanism for the GM to manually override an event outcome tier (e.g. failure to mixed) after a check resolves. The existing `gmOverride` system only covers activity selection.

---

## Feature Backlog

### Respite Core
- [ ] Terrain Event Coverage Audit (minimum diversity per terrain)
- [ ] Event Item Rewards as Party Discoveries (display once, not per-watcher)

### Integrations
- [ ] Resonance SFX Pass (ambient and event sounds during rests)
- [ ] Testharness Cross-Trigger (wire `runAll` to Respite's internal suite)

### Professions and Crafting (Descoped from v1)
- [ ] Profession System, Cut-Down Cooking, Foraging (Travel Resolution phase)

### Disaster Mechanics (v2)
- [ ] Confiscation UI, Spell/Grade Override, Severity 3 item_at_risk

### Tier-Specific Content
- [ ] `levelRange` filtering, Tier 3-4 expansion packs
