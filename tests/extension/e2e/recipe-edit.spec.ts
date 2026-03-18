/**
 * Recipe edit page integration tests.
 *
 * Run just this suite:
 *   pnpm exec playwright test --project=recipe-edit
 *
 * Requires a built extension in apps/extension/dist/.
 * Run `pnpm run ext:build` first.
 */

import { test, expect, MOCK_RECIPE } from "./fixtures";

test("editing a recipe title and saving reflects the change on the detail page", async ({
    existingRecipeEditPage,
}) => {
    await existingRecipeEditPage.locator("#edit-title").fill("Updated Cake");
    await existingRecipeEditPage.locator("#save-edit-btn").click();

    // Controller navigates to recipe.html after saving
    await existingRecipeEditPage.waitForURL(/recipe\.html\?id=/, {
        timeout: 15_000,
    });
    await existingRecipeEditPage.waitForSelector("#recipe-article:not(.hidden)", {
        timeout: 15_000,
    });

    await expect(existingRecipeEditPage.locator("#recipe-title")).toHaveText(
        "Updated Cake"
    );
});

test("creating a new recipe navigates to its detail page", async ({
    newRecipeEditPage,
}) => {
    await newRecipeEditPage.locator("#edit-title").fill("My Integration Recipe");
    await newRecipeEditPage.locator("#save-edit-btn").click();

    await newRecipeEditPage.waitForURL(/recipe\.html\?id=/, {
        timeout: 15_000,
    });
    await newRecipeEditPage.waitForSelector("#recipe-article:not(.hidden)", {
        timeout: 15_000,
    });

    await expect(newRecipeEditPage.locator("#recipe-title")).toHaveText(
        "My Integration Recipe"
    );
});
