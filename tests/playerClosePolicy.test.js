import { describe, it, expect } from "vitest";
import { resolvePlayerCloseOptions } from "../scripts/services/playerClosePolicy.js";

describe("resolvePlayerCloseOptions", () => {

    it("injects retainPlayerApp when phase is 'activity' and options are empty", () => {
        const result = resolvePlayerCloseOptions({}, "activity");
        expect(result).toEqual({ retainPlayerApp: true });
    });

    it("preserves existing options when injecting retainPlayerApp", () => {
        const result = resolvePlayerCloseOptions({ foo: "bar" }, "activity");
        expect(result).toEqual({ foo: "bar", retainPlayerApp: true });
    });

    it("does not inject when skipRejoin is set", () => {
        const opts = { skipRejoin: true };
        const result = resolvePlayerCloseOptions(opts, "activity");
        expect(result).toBe(opts);
    });

    it("does not inject when resolved is set", () => {
        const opts = { resolved: true };
        const result = resolvePlayerCloseOptions(opts, "activity");
        expect(result).toBe(opts);
    });

    it("does not inject when retainPlayerApp is already set", () => {
        const opts = { retainPlayerApp: true };
        const result = resolvePlayerCloseOptions(opts, "activity");
        expect(result).toBe(opts);
    });

    it("returns original options for non-activity phase", () => {
        const opts = {};
        expect(resolvePlayerCloseOptions(opts, "meal")).toBe(opts);
        expect(resolvePlayerCloseOptions(opts, "recovery")).toBe(opts);
        expect(resolvePlayerCloseOptions(opts, null)).toBe(opts);
    });

    it("returns original options when phase is undefined", () => {
        const opts = {};
        expect(resolvePlayerCloseOptions(opts, undefined)).toBe(opts);
    });
});
