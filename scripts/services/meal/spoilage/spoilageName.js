/**
 * Strip perishable cohort suffixes from item display names.
 * Local copy of library CookingClassifier.stripSpoilageCohortSuffix
 * (Forge cannot resolve static cross-module imports).
 * e.g. "Bird Eggs (3d)" / "Fish (<1h)" → base name.
 */
export const SPOILAGE_COHORT_SUFFIX_RE = /\s+\((\d+d|<\d+h|\d+h)\)$/i;

export function stripSpoilageCohortSuffix(name) {
    if (!name) return "";
    return String(name).replace(SPOILAGE_COHORT_SUFFIX_RE, "").trim();
}
