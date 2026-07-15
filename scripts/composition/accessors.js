/** Read the live respite bag after boot. Prefer this over new relative service imports from apps. */
export function getRespiteApi() {
    return game.ionrift?.respite ?? null;
}
