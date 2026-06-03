import { describe, it, expect } from "vitest";
import { validateEventFile, validateAllEventFiles } from "../tools/validate-event-schema.mjs";
import path from "path";

/**
 * Event schema validation regression tests.
 *
 * Covers the event JSON validator that gates CI. Tests the validation
 * rules for effect types, damage scopes, randomTarget requirements,
 * stung ordering, condition registry lookups, and watchTarget parity.
 *
 * Also validates the module's shipped event files pass schema checks.
 */

const registryIndex = {
    keys: new Set(["poisoned", "frightened", "exhaustion:1", "disadvantage:perception"]),
    durations: new Set(["short", "long", "untilCured"])
};

describe("validateEventFile", () => {

    it("passes a valid minimal event file", () => {
        const data = {
            events: [{
                id: "test-event",
                mechanical: {
                    effects: [{
                        type: "damage",
                        formula: "2d6",
                        scope: "all"
                    }]
                }
            }]
        };
        const { errors, warnings } = validateEventFile(data, "test.json", registryIndex);
        expect(errors).toHaveLength(0);
    });

    it("errors on missing events array", () => {
        const { errors } = validateEventFile({}, "bad.json", registryIndex);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("missing or invalid");
    });

    it("errors on unknown effect type", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: { effects: [{ type: "explode" }] }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("unknown effect type"))).toBe(true);
    });

    it("errors on damage with invalid scope", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{ type: "damage", formula: "1d6", scope: "none" }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("scope \"none\""))).toBe(true);
    });

    it("errors on randomTarget scope missing randomTarget object", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{ type: "damage", formula: "1d6", scope: "randomTarget" }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("requires a randomTarget"))).toBe(true);
    });

    it("passes valid randomTarget damage", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{
                        type: "damage",
                        formula: "3d6",
                        scope: "randomTarget",
                        randomTarget: { pool: "sleeping", count: 1 }
                    }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors).toHaveLength(0);
    });

    it("errors on invalid randomTarget pool", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{
                        type: "damage",
                        formula: "2d6",
                        scope: "random",
                        randomTarget: { pool: "dead", count: 1 }
                    }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("pool \"dead\""))).toBe(true);
    });

    it("errors on stung condition without preceding random damage", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{ type: "condition", scope: "stung", condition: "poisoned" }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("must follow a damage effect"))).toBe(true);
    });

    it("passes stung condition following random damage", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [
                        { type: "damage", formula: "1d4", scope: "randomTarget", randomTarget: { pool: "all", count: 1 } },
                        { type: "condition", scope: "stung", condition: "poisoned" }
                    ]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors).toHaveLength(0);
    });

    it("errors on damage with scope 'stung'", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{ type: "damage", formula: "1d6", scope: "stung" }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("cannot use scope \"stung\""))).toBe(true);
    });

    it("errors on disadvantage condition without checks array", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{ type: "condition", condition: "disadvantage" }]
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("requires a checks array"))).toBe(true);
    });

    it("warns on unregistered condition", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    effects: [{ type: "condition", condition: "totally_new" }]
                }
            }]
        };
        const { warnings } = validateEventFile(data, "test.json", registryIndex);
        expect(warnings.some(w => w.includes("not in condition_registry"))).toBe(true);
    });

    it("warns on watchTarget mismatch with mechanical.targets", () => {
        const data = {
            events: [{
                id: "e1",
                watchTarget: "party",
                mechanical: { type: "skill_check", targets: "volunteers" }
            }]
        };
        const { warnings } = validateEventFile(data, "test.json", registryIndex);
        expect(warnings.some(w => w.includes("watchTarget"))).toBe(true);
    });

    it("warns on 'failed' scope without volunteerPolicy 'each'", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    type: "skill_check",
                    targets: "party",
                    effects: [{ type: "damage", formula: "1d6", scope: "failed" }]
                }
            }]
        };
        const { warnings } = validateEventFile(data, "test.json", registryIndex);
        expect(warnings.some(w => w.includes("volunteerPolicy"))).toBe(true);
    });

    it("validates outcome branches (onSuccess, onFailure)", () => {
        const data = {
            events: [{
                id: "e1",
                mechanical: {
                    onSuccess: {
                        effects: [{ type: "loot" }]
                    },
                    onFailure: {
                        effects: [{ type: "explode" }]
                    }
                }
            }]
        };
        const { errors } = validateEventFile(data, "test.json", registryIndex);
        expect(errors.some(e => e.includes("unknown effect type \"explode\""))).toBe(true);
    });
});

describe("validateAllEventFiles (integration)", () => {
    it("module-shipped event files pass schema validation", () => {
        const moduleRoot = path.resolve(import.meta.dirname, "..");
        const { errors, warnings, filesChecked } = validateAllEventFiles(moduleRoot);
        expect(filesChecked).toBeGreaterThan(0);
        expect(errors).toHaveLength(0);
    });
});
