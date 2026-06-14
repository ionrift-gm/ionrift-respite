import { beforeEach, describe, expect, it } from "vitest";
import {
    REST_STATE_REQUEST_COOLDOWN_MS,
    applyRestDataToExistingPlayerApp,
    clearRestStateRequestCooldown,
    shouldRequestRestStateForExistingApp
} from "../../services/restStartedPlayerSync.js";

describe("applyRestDataToExistingPlayerApp", () => {
    it("applies phase/terrain/fire/safe spot fields to app and engine", () => {
        const app = {
            _phase: null,
            _restId: null,
            _selectedTerrain: null,
            _fireLevel: null,
            _restData: {},
            _engine: { terrainTag: null, fireLevel: null, comfort: null, safeRestSpot: false }
        };

        const changed = applyRestDataToExistingPlayerApp(app, {
            phase: "camp",
            restId: "rest-123",
            terrainTag: "forest",
            fireLevel: "campfire",
            comfort: "safe",
            safeRestSpot: 1,
            travelGather: { forage: true }
        });

        expect(changed).toBe(true);
        expect(app._phase).toBe("camp");
        expect(app._restId).toBe("rest-123");
        expect(app._selectedTerrain).toBe("forest");
        expect(app._fireLevel).toBe("campfire");
        expect(app._restData).toEqual({ terrainTag: "forest", safeRestSpot: true });
        expect(app._engine).toEqual({
            terrainTag: "forest",
            fireLevel: "campfire",
            comfort: "safe",
            safeRestSpot: true
        });
        expect(app._syncedTravelGather).toEqual({ forage: true });
    });

    it("returns false when app or payload is missing", () => {
        expect(applyRestDataToExistingPlayerApp(null, {})).toBe(false);
        expect(applyRestDataToExistingPlayerApp({}, null)).toBe(false);
    });
});

describe("shouldRequestRestStateForExistingApp", () => {
    beforeEach(() => {
        clearRestStateRequestCooldown();
    });

    it("returns false when phase already known from restData or app", () => {
        expect(shouldRequestRestStateForExistingApp({
            restId: "r1",
            app: {},
            restData: { phase: "camp" },
            now: 100
        })).toBe(false);

        expect(shouldRequestRestStateForExistingApp({
            restId: "r1",
            app: { _phase: "events" },
            restData: {},
            now: 100
        })).toBe(false);
    });

    it("enforces cooldown for same rest id and can be cleared", () => {
        const params = {
            restId: "rest-abc",
            app: { _restId: "rest-abc" },
            restData: {},
            now: 10_000
        };

        expect(shouldRequestRestStateForExistingApp(params)).toBe(true);
        expect(shouldRequestRestStateForExistingApp({ ...params, now: 10_000 + REST_STATE_REQUEST_COOLDOWN_MS - 1 })).toBe(false);
        expect(shouldRequestRestStateForExistingApp({ ...params, now: 10_000 + REST_STATE_REQUEST_COOLDOWN_MS })).toBe(true);

        clearRestStateRequestCooldown("rest-abc");
        expect(shouldRequestRestStateForExistingApp({ ...params, now: 20_000 })).toBe(true);
    });

    it("requests immediately when no rest id is available", () => {
        expect(shouldRequestRestStateForExistingApp({
            restId: null,
            app: {},
            restData: {},
            now: 10
        })).toBe(true);
    });
});
