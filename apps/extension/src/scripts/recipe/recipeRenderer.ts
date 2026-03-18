/**
 * Recipe page rendering — top-level renderRecipe() and its sub-renderers.
 *
 * renderRecipe() is called by recipeController after loading from DB.
 * It orchestrates the unit system, batch size, and all section renders.
 */

import feather from "feather-icons";
import { formatTime, escapeHtml } from "../../utils/conversions";
import { recipeState, UNIT_PREFERENCE_KEY } from "./recipeState";
import { renderIngredients, parseBatchSize } from "./ingredientsRenderer";

// ─── Unit system initialisation ───────────────────────────────────────────────

export function initUnitSystem(recipe: any) {
    const unitLabel = document.getElementById("unit-system-select-label");

    const updateActiveDropdownItem = (val: string) => {
        const menu = document.getElementById("unit-system-select-menu");
        if (menu) {
            menu.querySelectorAll(".dropdown-item").forEach((i) => {
                i.classList.toggle("active", i.getAttribute("data-value") === val);
            });
        }
    };

    const applyUnitSystem = (unit: "us" | "metric") => {
        recipeState.currentUnitSystem = unit;
        if (unitLabel) unitLabel.textContent = unit === "metric" ? "Metric (Grams)" : "US (Volume)";
        updateActiveDropdownItem(unit);
    };

    const preferredUnit = localStorage.getItem(UNIT_PREFERENCE_KEY);
    if (preferredUnit === "us" || preferredUnit === "metric") {
        applyUnitSystem(preferredUnit);
        return;
    }

    let metricCount = 0;
    let usCount = 0;
    if (recipe.ingredients) {
        recipe.ingredients.forEach((ing: any) => {
            const u = (ing.unit || "").toLowerCase();
            if (["g", "gram", "grams", "ml", "milliliter", "milliliters"].includes(u)) metricCount++;
            else if (["cup", "cups", "tbsp", "tsp", "ounce", "oz", "fl oz"].includes(u)) usCount++;
        });
    }
    applyUnitSystem(metricCount > usCount ? "metric" : "us");
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export function renderTags() {
    const metaEl = document.getElementById("recipe-meta");
    const recipe = recipeState.currentRecipe;
    if (!metaEl || !recipe) return;

    const safeIcon = (name: string, opts: Record<string, any> = { width: 14, height: 14 }) =>
        (feather.icons[name] as any)?.toSvg(opts) || "";

    const displayTime =
        recipe.totalTimeMinutes ||
        (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0) ||
        null;

    const metaItems = [
        displayTime ? `<span class="meta-item">${safeIcon("clock")} ${formatTime(displayTime)}</span>` : null,
        recipe.servings ? `<span class="meta-item">${safeIcon("users")} ${recipe.servings} servings</span>` : null,
        recipe.yield ? `<span class="meta-item">${safeIcon("package")} ${recipe.yield}</span>` : null,
    ].filter(Boolean);

    let domain = "";
    if (recipe.url) {
        try { domain = new URL(recipe.url).hostname.replace(/^www\./, "").toUpperCase(); } catch { /* ignore */ }
    }

    const tagsHtml: string[] = [];
    if (domain) {
        tagsHtml.push(
            `<span class="tag domain-tag" title="Domain source">${safeIcon("link", { width: 10, height: 10, style: "margin-right: 4px; vertical-align: -1px;" })}${escapeHtml(domain)}</span>`
        );
    }
    (recipe.tags || []).forEach((t: string) => {
        if (t !== domain) {
            tagsHtml.push(
                `<span class="tag">${escapeHtml(t)} <button class="remove-tag" data-tag="${escapeHtml(t)}" title="Remove tag">&times;</button></span>`
            );
        }
    });
    tagsHtml.push(`<input type="text" class="tag-input" placeholder="+ Add tag" />`);

    metaEl.innerHTML = `
        <div class="meta-info">${metaItems.join(" &nbsp;·&nbsp; ")}</div>
        <div class="tags">${tagsHtml.join("")}</div>
    `;
}

// ─── Instructions ─────────────────────────────────────────────────────────────

export function renderInstructions(recipe: any) {
    const instructionsList = document.getElementById("instructions-list");
    if (!instructionsList || !recipe.instructions) return;

    let currentInstGroup = "";
    recipe.instructions.forEach((inst: any) => {
        const actualGroup = inst.group ? inst.group.trim() : "";
        if (actualGroup !== currentInstGroup && actualGroup !== "") {
            const groupHeader = document.createElement("h3");
            groupHeader.className = "instruction-group-header";
            groupHeader.textContent = actualGroup;
            instructionsList.appendChild(groupHeader);
            currentInstGroup = actualGroup;
        }

        const div = document.createElement("div");
        div.className = "instruction-step";
        div.innerHTML = `
            <span class="step-num">${inst.stepNumber}</span>
            <p>${inst.text}</p>
        `;
        instructionsList.appendChild(div);
    });
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export function renderNotes(recipe: any) {
    const notesSection = document.getElementById("recipe-notes-section");
    const notesList = document.getElementById("recipe-notes-list");
    if (!notesSection || !notesList) return;

    notesList.innerHTML = "";
    if (recipe.notes?.length > 0) {
        recipe.notes.forEach((noteText: string, idx: number) => {
            const li = document.createElement("li");
            li.id = `recipe-note-${idx + 1}`;
            li.textContent = noteText;
            li.style.marginBottom = "8px";
            notesList.appendChild(li);
        });
        notesSection.style.display = "block";
    } else {
        notesSection.style.display = "none";
    }
}

// ─── Top-level recipe render ──────────────────────────────────────────────────

let isFirstRender = true;

export function renderRecipe(recipe: any) {
    document.getElementById("loading")?.classList.add("hidden");
    const article = document.getElementById("recipe-article");
    if (!article) return;

    article.classList.remove("hidden");

    const titleEl = document.getElementById("recipe-title");
    if (titleEl) titleEl.textContent = recipe.title;

    const descEl = document.getElementById("recipe-desc");
    if (descEl && recipe.semantic_summary) descEl.textContent = recipe.semantic_summary;

    const sourceLink = document.getElementById("source-link") as HTMLAnchorElement;
    if (sourceLink && recipe.url) {
        sourceLink.href = recipe.url;
        sourceLink.classList.remove("hidden");
    }

    renderTags();

    if (isFirstRender) {
        initUnitSystem(recipe);
        isFirstRender = false;
    }

    // Batch size control
    const batchInput = document.getElementById("batch-input") as HTMLInputElement;
    if (batchInput) {
        recipeState.originalBatchSize = parseBatchSize(recipe.yield);
        batchInput.value = recipeState.originalBatchSize.toString();

        if (!batchInput.dataset.listenerAttached) {
            batchInput.addEventListener("input", (e) => {
                const newBatch = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(newBatch) && newBatch > 0) {
                    const mult = newBatch / recipeState.originalBatchSize;
                    renderIngredients(recipeState.currentRecipe, mult);
                }
            });
            batchInput.addEventListener("blur", (e) => {
                const val = parseInt((e.target as HTMLInputElement).value, 10);
                if (isNaN(val) || val < 1) {
                    batchInput.value = recipeState.originalBatchSize.toString();
                    renderIngredients(recipeState.currentRecipe, 1);
                }
            });
            batchInput.dataset.listenerAttached = "true";
        }
    }

    // Unit system dropdown
    const unitDropdown = document.getElementById("unit-system-select");
    if (unitDropdown && !unitDropdown.dataset.listenerAttached) {
        unitDropdown.addEventListener("change", (e: any) => {
            recipeState.currentUnitSystem = e.detail.value === "metric" ? "metric" : "us";
            localStorage.setItem(UNIT_PREFERENCE_KEY, recipeState.currentUnitSystem);
            const batchInput = document.getElementById("batch-input") as HTMLInputElement;
            const mult = batchInput ? parseFloat(batchInput.value) / recipeState.originalBatchSize : 1;
            renderIngredients(recipeState.currentRecipe, isNaN(mult) ? 1 : mult);
        });
        unitDropdown.dataset.listenerAttached = "true";
    }

    renderIngredients(recipe, 1);
    renderInstructions(recipe);
    renderNotes(recipe);
}
