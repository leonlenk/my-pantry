/**
 * Shared mutable state for the recipe page.
 *
 * Using an object reference rather than a bare `let` export so that all
 * recipe sub-modules always read the same live values regardless of
 * ES-module import ordering.
 */
export const UNIT_PREFERENCE_KEY = "preferredUnitSystem";

export const recipeState = {
    currentRecipe: null as any,
    originalBatchSize: 1,
    currentUnitSystem: "us" as "us" | "metric",
};
