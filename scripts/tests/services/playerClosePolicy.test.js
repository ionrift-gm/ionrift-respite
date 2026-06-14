import { describe, expect, it } from "vitest";
import { resolvePlayerCloseOptions } from "../../services/playerClosePolicy.js";

describe("resolvePlayerCloseOptions", () => {
    it("injects retainPlayerApp for activity x-close path", () => {
        const original = {};

        const resolved = resolvePlayerCloseOptions(original, "activity");

        expect(resolved).toEqual({ retainPlayerApp: true });
        expect(resolved).not.toBe(original);
        expect(original).toEqual({});
    });

    it("keeps explicit system-close flags unchanged", () => {
        const skipRejoin = { skipRejoin: true };
        const resolved = { resolved: true };
        const retain = { retainPlayerApp: true };

        expect(resolvePlayerCloseOptions(skipRejoin, "activity")).toBe(skipRejoin);
        expect(resolvePlayerCloseOptions(resolved, "activity")).toBe(resolved);
        expect(resolvePlayerCloseOptions(retain, "activity")).toBe(retain);
    });

    it("does not inject retain flag outside activity phase", () => {
        const options = {};

        const closeInCamp = resolvePlayerCloseOptions(options, "camp");
        const closeWithoutPhase = resolvePlayerCloseOptions(options, null);

        expect(closeInCamp).toBe(options);
        expect(closeWithoutPhase).toBe(options);
    });
});
