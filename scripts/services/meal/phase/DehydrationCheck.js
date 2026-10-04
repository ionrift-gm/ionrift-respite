/**
 * 2014 dehydration for the water owed by one rest.
 * A full amount is no check. At least half is a Constitution save.
 * Less than half is exhaustion, with no save.
 *
 * @param {number} consumed Pints drunk against this rest's need
 * @param {number} needed Pints owed (already multiplied by days)
 * @param {number} [dc]
 * @returns {{ dehydrationSaveDC: number, dehydrationAutoFail: boolean }}
 */
export function dehydrationOutcome(consumed, needed, dc = 15) {
    const drunk = Math.max(0, Number(consumed) || 0);
    const owed = Math.max(0, Number(needed) || 0);
    const saveDC = Number(dc) > 0 ? Number(dc) : 15;
    if (owed <= 0 || drunk >= owed) {
        return { dehydrationSaveDC: 0, dehydrationAutoFail: false };
    }
    if (drunk * 2 >= owed) {
        return { dehydrationSaveDC: saveDC, dehydrationAutoFail: false };
    }
    return { dehydrationSaveDC: 0, dehydrationAutoFail: true };
}
