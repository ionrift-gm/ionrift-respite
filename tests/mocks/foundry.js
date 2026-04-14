/**
 * Minimal Foundry VTT globals mock for headless Vitest execution.
 * Provides just enough surface to satisfy imports and function calls
 * in service layers that accept injected dependencies or have
 * defensive null-guards around Foundry globals.
 *
 * DO NOT add real Foundry logic here. This is a stub layer only.
 * If a function under test genuinely requires a Foundry call, it
 * is not a pure function and should not be in the headless suite.
 */

global.game = {
    actors:   { get: () => null },
    users:    { filter: () => [] },
    settings: { get: () => false },
    i18n:     { localize: (k) => k, format: (k) => k }
};

global.ui = {
    notifications: { warn: () => {}, error: () => {}, info: () => {} }
};

global.ChatMessage = {
    create:      () => Promise.resolve(null),
    getSpeaker:  () => ({})
};

global.Roll = class Roll {
    constructor(formula) { this.formula = formula; }
    async evaluate() { return { total: 10, toMessage: async () => {} }; }
};

global.CONFIG = {};
global.canvas = {};
global.Hooks  = { on: () => {}, once: () => {}, callAll: () => {} };
