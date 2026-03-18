/**
 * Shared Playwright fixtures for Chrome extension E2E tests.
 *
 * Usage in test files:
 *   import { test, expect, MOCK_RECIPES } from "./fixtures";
 *
 * Each test gets an isolated browser context with the built extension loaded.
 * Call `setupStorage()` before navigating to prevent the setup-redirect guard.
 * Call `seedRecipes(page, recipes)` then reload to populate IndexedDB.
 */

import {
    test as base,
    chromium,
    expect,
    type BrowserContext,
    type Page,
} from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

export { expect };

// Absolute path to the built extension (must exist before running E2E tests)
const DIST_PATH = path.join(__dirname, "../../../apps/extension/dist");

// ── Types ─────────────────────────────────────────────────────────────────────

export type Ingredient = {
    rawText: string;
    us_amount: number | null;
    us_unit: string | null;
    metric_amount: number | null;
    metric_unit: string | null;
    item: string;
    preparation?: string;
};

export type InstructionStep = {
    stepNumber: number;
    text: string;
};

export type Recipe = {
    id: string;
    url: string;
    title: string;
    servings: number | null;
    ingredients: Ingredient[];
    instructions: InstructionStep[];
    createdAt?: number;
    isFavorite?: boolean;
    tags?: string[];
    description?: string;
    semantic_summary?: string;
    prepTimeMinutes?: number;
    cookTimeMinutes?: number;
    totalTimeMinutes?: number;
    yield?: string;
};

// ── Shared mock data ──────────────────────────────────────────────────────────
// Declared before base.extend so TypeScript can resolve them inside fixture closures.

export const MOCK_RECIPE: Recipe = {
    id: "test-chocolate-cake",
    url: "https://example.com/chocolate-cake",
    title: "Chocolate Cake",
    servings: 8,
    createdAt: Date.now() - 5_000,
    isFavorite: false,
    tags: ["DESSERT"],
    description: "A rich, fudgy chocolate cake.",
    semantic_summary: "Rich moist chocolate layer cake",
    prepTimeMinutes: 20,
    cookTimeMinutes: 35,
    totalTimeMinutes: 55,
    yield: "1 9×13 inch cake",
    ingredients: [
        {
            rawText: "2 cups all-purpose flour",
            us_amount: 2,
            us_unit: "cup",
            metric_amount: 240,
            metric_unit: "g",
            item: "all-purpose flour",
        },
        {
            rawText: "1 cup sugar",
            us_amount: 1,
            us_unit: "cup",
            metric_amount: 200,
            metric_unit: "g",
            item: "sugar",
        },
        {
            rawText: "2 large eggs",
            us_amount: 2,
            us_unit: null,
            metric_amount: 2,
            metric_unit: null,
            item: "eggs",
        },
    ],
    instructions: [
        { stepNumber: 1, text: "Preheat oven to 350°F (175°C)." },
        { stepNumber: 2, text: "Mix dry ingredients in a large bowl." },
        { stepNumber: 3, text: "Add wet ingredients and stir until smooth." },
        { stepNumber: 4, text: "Pour into greased pan and bake 35 minutes." },
    ],
};

export const MOCK_FAVORITE_RECIPE: Recipe = {
    id: "test-banana-bread",
    url: "https://example.com/banana-bread",
    title: "Banana Bread",
    servings: 6,
    createdAt: Date.now(),
    isFavorite: true,
    tags: ["BREAD"],
    ingredients: [
        {
            rawText: "3 ripe bananas",
            us_amount: 3,
            us_unit: null,
            metric_amount: 3,
            metric_unit: null,
            item: "ripe bananas",
        },
        {
            rawText: "1/3 cup melted butter",
            us_amount: 0.33,
            us_unit: "cup",
            metric_amount: 75,
            metric_unit: "g",
            item: "butter",
            preparation: "melted",
        },
    ],
    instructions: [
        { stepNumber: 1, text: "Preheat oven to 350°F." },
        { stepNumber: 2, text: "Mash bananas and mix with butter." },
        {
            stepNumber: 3,
            text: "Fold in remaining ingredients and bake 60 minutes.",
        },
    ],
};

// ── Fixture types ─────────────────────────────────────────────────────────────

type ExtensionFixtures = {
    context: BrowserContext;
    extensionId: string;
    extUrl: (pageName: string, params?: Record<string, string>) => string;
    setupStorage: (opts?: { llmProvider?: string }) => Promise<void>;
    seedRecipes: (page: Page, recipes: Recipe[]) => Promise<void>;
    /** Empty pantry page (no recipes, setup guard bypassed). */
    pantryPage: Page;
    /** Pantry page pre-seeded with MOCK_RECIPE + MOCK_FAVORITE_RECIPE. */
    seededPantryPage: Page;
    /** Recipe detail page with MOCK_RECIPE loaded; article is visible. */
    recipeDetailPage: Page;
    /** recipe-edit.html with no ?id param (new recipe form visible). */
    newRecipeEditPage: Page;
    /** recipe-edit.html?id=MOCK_RECIPE.id with the form pre-populated. */
    existingRecipeEditPage: Page;
    /** popup.html with setup guard bypassed and main view visible. */
    popupPage: Page;
};

// ── Custom test with extension fixtures ───────────────────────────────────────

export const test = base.extend<ExtensionFixtures>({
    /**
     * Isolated Chromium context with the unpacked extension loaded.
     * A fresh user-data directory is created per test and cleaned up after.
     */
    context: async ({}, use) => {
        const userDataDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "pw-mypantry-")
        );
        const context = await chromium.launchPersistentContext(userDataDir, {
            // headless: true blocks extension service workers; use Chrome's new
            // headless mode via args instead — it supports extensions.
            headless: false,
            args: [
                "--headless=new",
                `--disable-extensions-except=${DIST_PATH}`,
                `--load-extension=${DIST_PATH}`,
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        });
        await use(context);
        await context.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    },

    /**
     * The extension's ID, extracted from the background service worker URL.
     */
    extensionId: async ({ context }, use) => {
        let [sw] = context.serviceWorkers();
        if (!sw) sw = await context.waitForEvent("serviceworker");
        // URL shape: chrome-extension://<id>/background.js
        const extensionId = sw.url().split("/")[2];
        await use(extensionId);
    },

    /**
     * Helper that builds a chrome-extension:// URL for a given page name.
     * e.g. extUrl("pantry.html") or extUrl("recipe.html", { id: "abc" })
     */
    extUrl: async ({ extensionId }, use) => {
        await use((pageName: string, params?: Record<string, string>) => {
            const url = new URL(
                `chrome-extension://${extensionId}/${pageName}`
            );
            if (params) {
                for (const [k, v] of Object.entries(params)) {
                    url.searchParams.set(k, v);
                }
            }
            return url.href;
        });
    },

    /**
     * Sets the chrome.storage.local values the extension needs to skip the
     * first-run setup redirect.  Call this before navigating to any extension
     * page in your test.
     */
    setupStorage: async ({ context }, use) => {
        await use(async (opts = {}) => {
            const llmProvider = opts.llmProvider ?? "byok";
            let [sw] = context.serviceWorkers();
            if (!sw) sw = await context.waitForEvent("serviceworker");
            await sw.evaluate(async (provider: string) => {
                // chrome is available in extension service workers
                await (globalThis as any).chrome.storage.local.set({
                    setupComplete: true,
                    llmProvider: provider,
                });
            }, llmProvider);
        });
    },

    /**
     * Seeds IndexedDB (mypantry v2, "recipes" store) with the given recipes
     * from within an extension page context.  After seeding, reload the page
     * so the page controller reads the freshly-populated store.
     */
    seedRecipes: async ({}, use) => {
        await use(async (page: Page, recipes: Recipe[]) => {
            await page.evaluate(async (recipes: Recipe[]) => {
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    const req = indexedDB.open("mypantry", 2);
                    req.onupgradeneeded = (e) => {
                        const db = (e.target as IDBOpenDBRequest).result;
                        if (!db.objectStoreNames.contains("recipes")) {
                            db.createObjectStore("recipes", { keyPath: "id" });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                await new Promise<void>((resolve, reject) => {
                    const tx = db.transaction("recipes", "readwrite");
                    const store = tx.objectStore("recipes");
                    for (const r of recipes) store.put(r);
                    tx.oncomplete = () => {
                        db.close();
                        resolve();
                    };
                    tx.onerror = () => reject(tx.error);
                });
            }, recipes as any);
        });
    },

    /**
     * A pantry page with no recipes (setup guard bypassed).
     * Waits for body.page-ready, which pantryController sets after loadRecipes()
     * completes — guarantees the empty-state and count are in their final state.
     */
    pantryPage: async ({ context, extUrl, setupStorage }, use) => {
        await setupStorage();
        const page = await context.newPage();
        await page.goto(extUrl("pantry.html"));
        await page.waitForSelector("body.page-ready", { timeout: 15_000 });
        await use(page);
        await page.close();
    },

    /**
     * A pantry page pre-seeded with MOCK_RECIPE + MOCK_FAVORITE_RECIPE.
     * Seeds IndexedDB, reloads, then waits for body.page-ready + recipe cards.
     */
    seededPantryPage: async (
        { context, extUrl, setupStorage, seedRecipes },
        use
    ) => {
        await setupStorage();
        const page = await context.newPage();
        await page.goto(extUrl("pantry.html"));
        // Wait for controller init before seeding so IndexedDB is opened on the
        // correct version; then reload so the controller re-reads the store.
        await page.waitForSelector("body.page-ready", { timeout: 15_000 });
        await seedRecipes(page, [MOCK_RECIPE, MOCK_FAVORITE_RECIPE]);
        await page.reload();
        await page.waitForSelector("body.page-ready", { timeout: 15_000 });
        await page.waitForSelector(".recipe-card", { timeout: 15_000 });
        await use(page);
        await page.close();
    },

    /**
     * Recipe detail page with MOCK_RECIPE seeded and the article fully visible.
     * Uses pantry.html as an intermediate page to seed IndexedDB.
     */
    recipeDetailPage: async (
        { context, extUrl, setupStorage, seedRecipes },
        use
    ) => {
        await setupStorage();
        const page = await context.newPage();
        await page.goto(extUrl("pantry.html"));
        await page.waitForSelector("body.page-ready", { timeout: 15_000 });
        await seedRecipes(page, [MOCK_RECIPE]);
        await page.goto(extUrl("recipe.html", { id: MOCK_RECIPE.id }));
        // Wait until the controller has loaded the recipe and removed hidden
        await page.waitForSelector("#recipe-article:not(.hidden)", {
            timeout: 15_000,
        });
        await use(page);
        await page.close();
    },

    /**
     * recipe-edit.html with no ?id param — new recipe mode, form visible.
     */
    newRecipeEditPage: async ({ context, extUrl, setupStorage }, use) => {
        await setupStorage();
        const page = await context.newPage();
        await page.goto(extUrl("recipe-edit.html"));
        await page.waitForSelector("#edit-form:not(.hidden)", {
            timeout: 15_000,
        });
        await use(page);
        await page.close();
    },

    /**
     * recipe-edit.html?id=MOCK_RECIPE.id with the edit form pre-populated.
     */
    existingRecipeEditPage: async (
        { context, extUrl, setupStorage, seedRecipes },
        use
    ) => {
        await setupStorage();
        const page = await context.newPage();
        await page.goto(extUrl("pantry.html"));
        await page.waitForSelector("body.page-ready", { timeout: 15_000 });
        await seedRecipes(page, [MOCK_RECIPE]);
        await page.goto(extUrl("recipe-edit.html", { id: MOCK_RECIPE.id }));
        await page.waitForSelector("#edit-form:not(.hidden)", {
            timeout: 15_000,
        });
        await use(page);
        await page.close();
    },

    /**
     * popup.html with setup guard bypassed and the main view visible.
     */
    popupPage: async ({ context, extUrl, setupStorage }, use) => {
        await setupStorage();
        const page = await context.newPage();
        await page.goto(extUrl("popup.html"));
        await page.waitForSelector("#main-view", { timeout: 15_000 });
        await use(page);
        await page.close();
    },
});

