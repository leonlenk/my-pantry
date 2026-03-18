/**
 * Recipe detail page integration tests.
 *
 * Run just this suite:
 *   pnpm exec playwright test --project=recipe
 *
 * Requires a built extension in apps/extension/dist/.
 * Run `pnpm run ext:build` first.
 */

import { test, expect, MOCK_RECIPE } from "./fixtures";

test("clicking a recipe card opens the detail page with the correct data loaded from IndexedDB", async ({
    seededPantryPage,
}) => {
    // Click the Chocolate Cake card (not the favorite, so it's predictable)
    const card = seededPantryPage
        .locator(".recipe-card")
        .filter({ hasText: MOCK_RECIPE.title });
    await card.click();

    await seededPantryPage.waitForURL(/recipe\.html\?id=/, { timeout: 10_000 });
    await seededPantryPage.waitForSelector("#recipe-article:not(.hidden)", {
        timeout: 15_000,
    });

    await expect(seededPantryPage.locator("#recipe-title")).toHaveText(
        MOCK_RECIPE.title
    );
    await expect(seededPantryPage.locator("#ingredients-list li")).toHaveCount(
        MOCK_RECIPE.ingredients.length
    );
    await expect(
        seededPantryPage.locator("#instructions-list .instruction-step")
    ).toHaveCount(MOCK_RECIPE.instructions.length);
});
