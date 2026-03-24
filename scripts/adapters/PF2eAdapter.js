import { SystemAdapter } from "./SystemAdapter.js";

/**
 * PF2eAdapter – Stub for Pathfinder 2nd Edition.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  IMPLEMENTATION NOTES (from compatibility analysis)            │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                │
 * │  MECHANIC MAPPING:                                             │
 * │  ─────────────────                                             │
 * │  HP ................. actor.system.attributes.hp (same shape)  │
 * │  Recovery Resource .. Focus Points (not Hit Dice)              │
 * │                       actor.system.resources.focus             │
 * │  Fatigue ............ Conditions: "fatigued", "drained"        │
 * │                       (not a numeric 0-6 scale like 5e)        │
 * │  Skills ............. actor.system.skills[key].totalModifier   │
 * │  Proficiency ........ Tiered: untrained/trained/expert/        │
 * │                       master/legendary (rank 0-4)              │
 * │  Spell Slots ........ actor.system.spells (prepared model)     │
 * │  Armor Sleep ........ No Xanathar equivalent in PF2e           │
 * │  Rest Hooks ......... TBD – pf2e system hooks need research    │
 * │                                                                │
 * │  INCOMPATIBLE ACTIVITIES (hide these):                         │
 * │  ─────────────────────────────────────                         │
 * │  act_attune ......... PF2e uses "Invest" instead (daily,       │
 * │                       10 item limit). Could map to a           │
 * │                       PF2e-specific "Invest Items" activity.   │
 * │  act_scribe ......... PF2e uses "Learn a Spell" instead        │
 * │                       (Crafting check + gold, any prepared     │
 * │                       caster, not wizard-only).                │
 * │  act_fletch ......... PF2e tracks ammo, so fletching works,    │
 * │                       but skill/tool prereqs may differ.       │
 * │                                                                │
 * │  PF2e-UNIQUE ACTIVITIES (candidates to add):                   │
 * │  ───────────────────────────────────────────                    │
 * │  Refocus ............ Regain 1-3 focus points (feat-dependent) │
 * │  Treat Wounds ....... Medicine check with scaled DC for more   │
 * │                       healing. Core PF2e rest mechanic.        │
 * │  Repair ............. Shield/equipment repair (Crafting check) │
 * │  Subsist ............ Earn a living / find food                │
 * │                       (Survival or Society check)              │
 * │                                                                │
 * └─────────────────────────────────────────────────────────────────┘
 */
export class PF2eAdapter extends SystemAdapter {

    get id() { return "pf2e"; }

    // ── Activity Filtering ───────────────────────────────────

    /** IDs that are D&D-specific and have no direct PF2e equivalent yet */
    static INCOMPATIBLE = ["act_attune", "act_scribe"];

    filterActivities(activities) {
        return activities.filter(a => !PF2eAdapter.INCOMPATIBLE.includes(a.id));
    }

    // All other methods inherit from SystemAdapter and throw
    // "not implemented" until this adapter is fleshed out.
}
