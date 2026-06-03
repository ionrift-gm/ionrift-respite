/**
 * Vitest global setup — stub Foundry VTT globals that production code references.
 *
 * Tests supply per-case overrides via `globalThis.game = { ... }`.
 * This file only establishes the bare-minimum shape so module-level
 * const bindings don't throw at import time.
 */

globalThis.game = {
    system: { id: "dnd5e" },
    settings: { get: () => "" },
    modules: { get: () => null },
    actors: { get: () => null },
    users: [],
    user: { isGM: true },
    ionrift: {},
    time: { worldTime: 0 },
    canvas: { scene: null },
    playerListStatus: null
};

globalThis.Hooks = {
    on: () => 0,
    off: () => {}
};

globalThis.CONST = {
    CHAT_MESSAGE_TYPES: { WHISPER: 4 },
    ACTIVE_EFFECT_MODES: {
        ADD: 2,
        OVERRIDE: 5
    }
};

globalThis.ChatMessage = {
    create: async () => ({}),
    getSpeaker: () => ({})
};

globalThis.Roll = class Roll {
    constructor(formula) { this.formula = formula; this.total = 0; }
    async evaluate() { return this; }
};

globalThis.foundry = {
    utils: {
        deepClone: (obj) => JSON.parse(JSON.stringify(obj)),
        duplicate: (obj) => JSON.parse(JSON.stringify(obj)),
        mergeObject: (target, source) => Object.assign(target, source),
        getProperty: (obj, key) => {
            return key.split(".").reduce((o, k) => o?.[k], obj);
        }
    }
};

globalThis.console = globalThis.console ?? {};
