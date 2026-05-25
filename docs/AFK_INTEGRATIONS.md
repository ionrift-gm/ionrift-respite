# AFK cross-module integrations

Respite tracks AFK by **character actor id** (plus a synthetic `gm` row). Other modules use different models. The bridge in `scripts/services/afk/` maps between them and keeps rest flows in sync.

## Control source (world setting)

| Value | Behavior |
|-------|----------|
| `respite` (default) | The Respite AFK panel drives state. Changes sync out to active adapters. External AFK still updates the panel and rest sockets. |
| `integrated` | Token or player-list AFK from other modules drives state. The Respite panel is read-only during rest. Use Fast Flip, Player Status, or similar for toggles. |

## Modules surveyed

### Tier 1 (implemented adapters)

| Module | Package id | Model | Notes |
|--------|------------|-------|-------|
| [Fast Flip! Token Tools](https://foundryvtt.com/packages/fast-flip) | `fast-flip` | Token flag `fast-flip.afk-state` | Shift+K or HUD on player-owned tokens. Best fit for scene/token tables. |
| [Player Status](https://foundryvtt.com/packages/playerStatus) | `playerStatus` | `game.playerListStatus` user flags, key `afk` | Requires library [PlayerListStatus](https://foundryvtt.com/packages/player-list-status). `/afk` and `/back` chat commands. V13 mirrors `idle` on the player list row. |

### Tier 2 (future / limited API)

| Module | Package id | Model | Adapter status |
|--------|------------|-------|----------------|
| [AFK Tavern](https://foundryvtt.com/packages/afk-tavern) | `afk-tavern` | Break session away/back/offline | Break-timer workflow; no stable public hook documented yet. |
| [Away From Keyboard](https://foundryvtt.com/packages/afk) | `afk` | Chat `/afk` | Legacy (Foundry 10). Chat-only. |
| [AFK / Ready check](https://github.com/jeremiahverba/afk-ready-check) | varies | Ready-check prompt | Session poll, not persistent AFK. |
| [Player Status Tracker](https://foundryvtt.com/packages/player-status-tracker) | `player-status-tracker` | Inactivity detection | Automatic idle lines, not manual AFK. |

## ID mapping

- **Actor** (Respite roster row): `Actor.id` from party roster.
- **GM row**: literal id `gm` maps to the first active GM `User`.
- **Fast Flip**: all canvas tokens with `document.actorId` matching the actor; AFK if any linked token has `afk-state` true.
- **Player List Status**: primary owning `User` for the actor (`actor.ownership` with level 3), or assigned player.

## Adding an adapter

1. Add `scripts/services/afk/adapters/YourModuleAfkAdapter.js` implementing:
   - `id`, `label`, `isAvailable()`, `readCharacterAfk(id)`, `writeCharacterAfk(id, boolean)`, `installHooks(onChange)`, `removeHooks()`
2. Register it in `AfkBridgeService.js` `ADAPTERS` array.
3. Document the module in this file.
