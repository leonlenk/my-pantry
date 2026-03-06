/**
 * Shared mutable state for the recipe page.
 *
 * Using an object reference rather than a bare `let` export so that both
 * recipeController and substitutionController always read the same live value
 * regardless of ES-module import ordering.
 */
export const recipeState = {
    currentRecipe: null as any,
    originalBatchSize: 1,
};
