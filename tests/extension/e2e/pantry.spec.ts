/**
 * Pantry page integration tests.
 *
 * Run just this suite:
 *   pnpm exec playwright test --project=pantry
 *
 * Requires a built extension in apps/extension/dist/.
 * Run `pnpm run ext:build` first.
 */

import { test, expect, MOCK_RECIPE, MOCK_FAVORITE_RECIPE } from "./fixtures";

test("recipes from IndexedDB render with the correct count and titles", async ({
    seededPantryPage,
}) => {
    await expect(seededPantryPage.locator("#recipe-count")).toHaveText(
        "2 recipes"
    );
    const titles = await seededPantryPage
        .locator(".recipe-card .card-header h3")
        .allTextContents();
    expect(titles).toContain(MOCK_RECIPE.title);
    expect(titles).toContain(MOCK_FAVORITE_RECIPE.title);
});

test("favorites filter shows only favorited recipes; switching back to All restores both", async ({
    seededPantryPage,
}) => {
    await seededPantryPage
        .locator(".filter-btn[data-filter='favorites']")
        .click();
    await expect(seededPantryPage.locator(".recipe-card")).toHaveCount(1);
    await expect(
        seededPantryPage.locator(".recipe-card .card-header h3").first()
    ).toHaveText(MOCK_FAVORITE_RECIPE.title);

    await seededPantryPage.locator(".filter-btn[data-filter='all']").click();
    await expect(seededPantryPage.locator(".recipe-card")).toHaveCount(2);
});

test("typing in the search box filters visible cards by title", async ({
    seededPantryPage,
}) => {
    // The search only executes on Enter (the input event only shows suggestions)
    await seededPantryPage.locator("#semantic-search").fill("chocolate");
    await seededPantryPage.locator("#semantic-search").press("Enter");
    await expect(seededPantryPage.locator(".recipe-card")).toHaveCount(1);
    await expect(
        seededPantryPage.locator(".recipe-card .card-header h3").first()
    ).toHaveText(MOCK_RECIPE.title);
});
