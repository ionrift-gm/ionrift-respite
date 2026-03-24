import { SystemAdapter } from "./SystemAdapter.js";

/**
 * DaggerheartAdapter – Stub for Daggerheart by Darrington Press.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  IMPLEMENTATION NOTES (from compatibility analysis)            │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                │
 * │  MECHANIC MAPPING:                                             │
 * │  ─────────────────                                             │
 * │  HP ................. actor.system.hp (value/max)              │
 * │  Recovery Resource .. Hope (party-level pool, not per-actor)   │
 * │                       actor.system.hope? or game-level flag    │
 * │  Fatigue ............ Stress (accumulates, triggers at cap)    │
 * │                       actor.system.stress                      │
 * │  Skills ............. Domain cards + modifier (no skill list)  │
 * │                       Domains: Blade, Bone, Codex, Grace,     │
 * │                       Midnight, Sage, Splendor, Valor         │
 * │  Proficiency ........ Not applicable (domain-based)            │
 * │  Spell Slots ........ None (Fear + Hope economy instead)       │
 * │  Armor Sleep ........ No equivalent                            │
 * │  Rest Hooks ......... TBD – Daggerheart system hooks unknown   │
 * │                                                                │
 * │  INCOMPATIBLE ACTIVITIES (hide these):                         │
 * │  ─────────────────────────────────────                         │
 * │  act_attune ......... No attunement concept in Daggerheart     │
 * │  act_scribe ......... No spellbook concept                     │
 * │  act_identify ....... No Identify/Detect Magic spells          │
 * │                       (identification is domain-based)         │
 * │  act_fletch ......... Daggerheart does not track ammunition    │
 * │                                                                │
 * │  DAGGERHEART-UNIQUE ACTIVITIES (candidates to add):            │
 * │  ──────────────────────────────────────────────────             │
 * │  Share Hope ......... Transfer Hope tokens between PCs         │
 * │                       (party resource management)              │
 * │  Process Stress ..... Reduce accumulated Stress through RP     │
 * │                       (narrative downtime action)              │
 * │  Bond ............... Strengthen connections between PCs       │
 * │                       (closest analog: Tell Tales)             │
 * │                                                                │
 * │  SKILL MAPPING CHALLENGE:                                      │
 * │  ──────────────────────────                                    │
 * │  Daggerheart uses Domains not skills. Activities that gate     │
 * │  on skill proficiency (Forage→Survival, Study→Arcana) need    │
 * │  mapping to domains:                                           │
 * │    Survival → Bone or Sage                                     │
 * │    Arcana   → Codex                                            │
 * │    Religion → Codex or Splendor                                │
 * │    Medicine → Bone                                             │
 * │    Performance → Grace or Splendor                             │
 * │  This mapping is approximate and needs playtesting.            │
 * │                                                                │
 * └─────────────────────────────────────────────────────────────────┘
 */
export class DaggerheartAdapter extends SystemAdapter {

    get id() { return "daggerheart"; }

    // ── Activity Filtering ───────────────────────────────────

    /** IDs that are D&D-specific and have no Daggerheart equivalent */
    static INCOMPATIBLE = ["act_attune", "act_scribe", "act_identify", "act_fletch"];

    filterActivities(activities) {
        return activities.filter(a => !DaggerheartAdapter.INCOMPATIBLE.includes(a.id));
    }

    // All other methods inherit from SystemAdapter and throw
    // "not implemented" until this adapter is fleshed out.
}
