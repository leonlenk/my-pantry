/**
 * Recipe page controller — startup and UI interaction wiring.
 *
 * Responsibilities:
 *  - Parse ?id= URL param, load recipe from DB, hand off to renderRecipe()
 *  - Inline title editing (pencil button)
 *  - Delegated click handlers for tag removal and substitution revert
 *  - Delegated keydown handler for tag addition
 *  - Mobile ingredient slide-over panel
 *
 * Rendering logic lives in recipeRenderer.ts and ingredientsRenderer.ts.
 * Substitution modal logic lives in substitutionController.ts.
 */

import { getRecipe, saveRecipeLocally } from "../../utils/db";
import { recipeState } from "./recipeState";
import { renderRecipe, renderTags } from "./recipeRenderer";
import { renderIngredients, getCurrentMultiplier } from "./ingredientsRenderer";

document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const recipeId = urlParams.get("id");

    document.getElementById("back-btn")?.addEventListener("click", () => {
        window.location.href = "pantry.html";
    });

    const editRecipeBtn = document.getElementById("edit-recipe-btn") as HTMLButtonElement;
    if (editRecipeBtn && recipeId) {
        editRecipeBtn.classList.remove("hidden");
        editRecipeBtn.addEventListener("click", () => {
            window.location.href = `recipe-edit.html?id=${recipeId}`;
        });
    }

    if (!recipeId) { showError(); return; }

    try {
        const recipe = await getRecipe(recipeId);
        if (!recipe) { showError(); return; }
        if (recipe.tags) {
            recipe.tags = recipe.tags
                .map((t: string) => t.toUpperCase())
                .sort((a: string, b: string) => a.localeCompare(b));
        }
        recipeState.currentRecipe = recipe;
        renderRecipe(recipe);
    } catch (e) {
        console.error(e);
        showError();
    }

    wireTitleEdit();
    wireDelegatedHandlers();
    wireMobileIngredientPanel();

    requestAnimationFrame(() =>
        requestAnimationFrame(() => document.body.classList.add("page-ready"))
    );
});

// ─── Error state ──────────────────────────────────────────────────────────────

function showError() {
    document.getElementById("loading")?.classList.add("hidden");
    document.getElementById("error-state")?.classList.remove("hidden");
}

// ─── Title inline edit ────────────────────────────────────────────────────────

function wireTitleEdit() {
    const titleHeading = document.getElementById("recipe-title");
    const titleInput = document.getElementById("recipe-title-input") as HTMLInputElement;
    const editTitleBtn = document.getElementById("edit-title-btn");

    function enableTitleEdit() {
        const recipe = recipeState.currentRecipe;
        if (!recipe || !titleHeading || !titleInput || !editTitleBtn) return;
        titleInput.value = recipe.title || "";
        titleHeading.classList.add("hidden");
        editTitleBtn.classList.add("hidden");
        titleInput.classList.remove("hidden");
        titleInput.focus();
        titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
    }

    async function saveTitleEdit() {
        const recipe = recipeState.currentRecipe;
        if (!recipe || !titleHeading || !titleInput || !editTitleBtn) return;
        const newTitle = titleInput.value.trim();
        if (newTitle && newTitle !== recipe.title) {
            recipe.title = newTitle;
            titleHeading.textContent = newTitle;
            await saveRecipeLocally(recipe);
        }
        titleInput.classList.add("hidden");
        titleHeading.classList.remove("hidden");
        editTitleBtn.classList.remove("hidden");
    }

    editTitleBtn?.addEventListener("click", enableTitleEdit);
    titleInput?.addEventListener("blur", saveTitleEdit);
    titleInput?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") titleInput.blur();
        else if (e.key === "Escape") {
            titleInput.value = recipeState.currentRecipe?.title || "";
            titleInput.blur();
        }
    });
}

// ─── Delegated event handlers ─────────────────────────────────────────────────

function wireDelegatedHandlers() {
    // Revert a substitution
    document.addEventListener("click", async (e) => {
        const revertBtn = (e.target as Element).closest(".revert-sub");
        const recipe = recipeState.currentRecipe;
        if (revertBtn && recipe) {
            const indexStr = revertBtn.getAttribute("data-index");
            if (indexStr) {
                const idx = parseInt(indexStr, 10);
                if (!isNaN(idx) && idx >= 0 && idx < recipe.ingredients.length) {
                    delete recipe.ingredients[idx].substituted;
                    await saveRecipeLocally(recipe);
                    renderIngredients(recipe, getCurrentMultiplier());
                }
            }
        }
    });

    // Remove a tag
    document.addEventListener("click", async (e) => {
        const removeBtn = (e.target as Element).closest(".remove-tag");
        const recipe = recipeState.currentRecipe;
        if (removeBtn && recipe) {
            const tagToRemove = removeBtn.getAttribute("data-tag");
            if (tagToRemove) {
                recipe.tags = (recipe.tags || []).filter(
                    (t: string) => t.toUpperCase() !== tagToRemove.toUpperCase()
                );
                await saveRecipeLocally(recipe);
                renderTags();
            }
        }
    });

    // Add a tag on Enter
    document.addEventListener("keydown", async (e) => {
        const target = e.target as Element;
        const recipe = recipeState.currentRecipe;
        if (target?.classList.contains("tag-input") && e.key === "Enter") {
            e.preventDefault();
            const input = target as HTMLInputElement;
            const newTag = input.value.trim().toUpperCase();
            if (newTag && recipe) {
                recipe.tags = recipe.tags || [];
                if (!recipe.tags.includes(newTag)) {
                    recipe.tags.push(newTag);
                    recipe.tags.sort((a: string, b: string) => a.localeCompare(b));
                    await saveRecipeLocally(recipe);
                    renderTags();
                    setTimeout(() => {
                        const newInput = document.querySelector(".tag-input") as HTMLInputElement;
                        if (newInput) newInput.focus();
                    }, 50);
                } else {
                    input.value = "";
                }
            }
        }
    });
}

// ─── Mobile ingredient slide-over panel ──────────────────────────────────────

function wireMobileIngredientPanel() {
    const fab = document.getElementById("ingredients-fab");
    const panel = document.querySelector<HTMLElement>(".ingredients-section");
    const backdrop = document.getElementById("ingredients-backdrop");
    if (!fab || !panel || !backdrop) return;

    const openPanel = () => {
        panel.classList.add("panel-open");
        backdrop.classList.add("open");
        document.body.classList.add("ingredients-open");
        document.body.style.overflow = "hidden";
    };

    const closePanel = () => {
        panel.classList.remove("panel-open");
        backdrop.classList.remove("open");
        document.body.classList.remove("ingredients-open");
        document.body.style.overflow = "";
    };

    fab.addEventListener("click", () => {
        if (document.body.classList.contains("ingredients-open")) closePanel();
        else openPanel();
    });

    backdrop.addEventListener("click", closePanel);
}
