# Changelog

## [1.0.0] - 2026-03-24

Initial public release.

### Core
- Four-phase rest flow: Setup, Activities, Events, Resolution
- Terrain-driven event system with weighted random selection
- Camp activity selection (Guard, Scout, Rest, Fortify, Campfire, Training)
- Comfort-tier recovery model (Safe, Sheltered, Rough, Hostile)
- Structured meal phase with multi-day tracking and starvation/dehydration consequences
- Short rest support with per-die HD rolling

### Events
- Pool-based event resolution with terrain tags, tiers, and sentiment
- Disaster events with decision tree mechanics and GM choice
- GM event outcome override
- Immunity-based advantage (damage resistance grants advantage on event saves)
- Disaster history tracking (prevents repeat events)
- Scouting modifiers (nat 1 / nat 20 bonus events)

### Camp Systems
- Encounter DC calculated from shelter, weather, fire, scouting, and defenses
- Campfire roll with terrain-specific difficulty
- Resource loss effects (consume_resource, supply_loss, consume_gold, item_at_risk)
- Personal gear bonuses (bedroll, mess kit, cook's utensils)
- Armor sleep penalty (Xanathar's variant)

### Infrastructure
- Pack Registry for enabling/disabling content packs
- Compendium builder with folder organisation
- Simple Calendar integration for date tracking
- Socket-based multiplayer synchronisation
- Centralized Logger gated on debug setting
- DnD5e system adapter with PF2e and Daggerheart stubs
