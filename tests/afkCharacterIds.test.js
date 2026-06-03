import { describe, it, expect, beforeEach } from "vitest";
import {
    resolveUserIdForCharacter,
    getTokenDocumentsForActor,
    resolveCharacterIdFromTokenDoc
} from "../scripts/services/afk/afkCharacterIds.js";

/**
 * afkCharacterIds regression tests.
 *
 * Covers the helper functions that map between Respite character ids
 * (actor id or "gm"), users, and token documents. These are called
 * by the AFK bridge adapters introduced in ba58980.
 */

beforeEach(() => {
    globalThis.game = {
        users: [],
        actors: { get: () => null },
        canvas: { scene: null }
    };
});

describe("resolveUserIdForCharacter", () => {
    it("returns null for falsy characterId", () => {
        expect(resolveUserIdForCharacter(null)).toBeNull();
        expect(resolveUserIdForCharacter("")).toBeNull();
        expect(resolveUserIdForCharacter(undefined)).toBeNull();
    });

    it("returns active GM user id for 'gm' character", () => {
        globalThis.game.users = [
            { id: "u1", isGM: false, active: true },
            { id: "u2", isGM: true, active: true },
            { id: "u3", isGM: true, active: false }
        ];
        globalThis.game.users.find = Array.prototype.find;
        expect(resolveUserIdForCharacter("gm")).toBe("u2");
    });

    it("falls back to inactive GM if no active GM", () => {
        globalThis.game.users = [
            { id: "u1", isGM: false, active: true },
            { id: "u2", isGM: true, active: false }
        ];
        globalThis.game.users.find = Array.prototype.find;
        expect(resolveUserIdForCharacter("gm")).toBe("u2");
    });

    it("returns null when no GM user exists", () => {
        globalThis.game.users = [
            { id: "u1", isGM: false, active: true }
        ];
        globalThis.game.users.find = Array.prototype.find;
        expect(resolveUserIdForCharacter("gm")).toBeNull();
    });

    it("returns owner player id for actor character", () => {
        const actor = {
            testUserPermission: (user, perm) => user.id === "p1" && perm === "OWNER"
        };
        globalThis.game.actors = { get: (id) => id === "char-1" ? actor : null };
        globalThis.game.users = [
            { id: "gm-1", isGM: true },
            { id: "p1", isGM: false }
        ];
        globalThis.game.users.filter = Array.prototype.filter;
        globalThis.game.users.find = Array.prototype.find;
        expect(resolveUserIdForCharacter("char-1")).toBe("p1");
    });

    it("returns null when actor is not found", () => {
        globalThis.game.actors = { get: () => null };
        expect(resolveUserIdForCharacter("unknown-actor")).toBeNull();
    });
});

describe("getTokenDocumentsForActor", () => {
    it("returns empty array for falsy actorId", () => {
        expect(getTokenDocumentsForActor(null)).toEqual([]);
        expect(getTokenDocumentsForActor("")).toEqual([]);
    });

    it("returns empty array for 'gm'", () => {
        expect(getTokenDocumentsForActor("gm")).toEqual([]);
    });

    it("returns matching token documents from scene", () => {
        const tok1 = { actorId: "char-1", id: "t1" };
        const tok2 = { actorId: "char-2", id: "t2" };
        const tok3 = { actorId: "char-1", id: "t3" };
        globalThis.game.canvas = {
            scene: { tokens: [tok1, tok2, tok3] }
        };

        const result = getTokenDocumentsForActor("char-1");
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("t1");
        expect(result[1].id).toBe("t3");
    });

    it("returns empty array when no scene is active", () => {
        globalThis.game.canvas = { scene: null };
        expect(getTokenDocumentsForActor("char-1")).toEqual([]);
    });
});

describe("resolveCharacterIdFromTokenDoc", () => {
    it("returns actorId from token document", () => {
        expect(resolveCharacterIdFromTokenDoc({ actorId: "char-1" })).toBe("char-1");
    });

    it("returns null when tokenDoc has no actorId", () => {
        expect(resolveCharacterIdFromTokenDoc({})).toBeNull();
        expect(resolveCharacterIdFromTokenDoc(null)).toBeNull();
        expect(resolveCharacterIdFromTokenDoc(undefined)).toBeNull();
    });
});
