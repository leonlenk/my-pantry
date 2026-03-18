/**
 * Bulk tag editor — lets users add tags to all selected recipes at once.
 *
 * Manages the tag chip list, autocomplete suggestions, and open/close state.
 * Wires all keyboard/input handlers on the bulk tag input element.
 * The actual "apply tags" action lives in selectionManager to avoid a
 * circular dependency (applyBulkTags needs resetSelection + loadRecipes).
 */

import feather from "feather-icons";
import { pantryState, normalizeTagInput } from "./pantryState";

// ─── DOM handles ─────────────────────────────────────────────────────────────

const bulkTagEditor = document.getElementById("bulk-tag-editor");
const bulkTagInput = document.getElementById("bulk-tag-input") as HTMLInputElement | null;
const bulkTagChips = document.getElementById("bulk-tag-chips");
const bulkTagSuggestionsEl = document.getElementById("bulk-tag-suggestions");
const bulkTagApplyBtn = document.getElementById("bulk-tag-apply") as HTMLButtonElement | null;
const bulkActionBar = document.getElementById("bulk-action-bar");

// ─── Chip rendering ───────────────────────────────────────────────────────────

export function renderBulkTagChips() {
    if (!bulkTagChips) return;
    bulkTagChips.innerHTML = "";

    // MAX_VISIBLE_TAGS = 0 means all tags go into the "+N" overflow badge
    const MAX_VISIBLE_TAGS = 0;
    const MAX_TAG_LENGTH = window.innerWidth <= 600 ? 5 : 12;
    const visibleTags = pantryState.bulkPendingTags.slice(0, MAX_VISIBLE_TAGS);
    const hiddenTags = pantryState.bulkPendingTags.slice(MAX_VISIBLE_TAGS);

    visibleTags.forEach((tag, index) => {
        const chip = document.createElement("div");
        chip.className = "bulk-tag-chip search-badge";
        const displayTag = tag.length > MAX_TAG_LENGTH ? `${tag.substring(0, MAX_TAG_LENGTH)}...` : tag;
        chip.innerHTML = `
            <span title="${tag}">${displayTag}</span>
            <button data-index="${index}" title="Remove tag">
                ${feather.icons["x"]?.toSvg({ width: 12, height: 12 }) || "x"}
            </button>
        `;
        chip.querySelector("button")?.addEventListener("click", () => {
            pantryState.bulkPendingTags.splice(index, 1);
            renderBulkTagChips();
            refreshBulkTagSuggestions();
            if (bulkTagApplyBtn) bulkTagApplyBtn.disabled = pantryState.bulkPendingTags.length === 0;
        });
        bulkTagChips.appendChild(chip);
    });

    if (hiddenTags.length > 0) {
        const moreBadge = document.createElement("div");
        moreBadge.className = "more-badge";
        moreBadge.innerHTML = `+${hiddenTags.length}`;
        moreBadge.title = "Click to see more tags";

        const popover = document.createElement("div");
        popover.className = "more-tags-popover hidden";

        hiddenTags.forEach((tag, hiddenIdx) => {
            const realIdx = MAX_VISIBLE_TAGS + hiddenIdx;
            const item = document.createElement("div");
            item.className = "more-tag-item";
            item.innerHTML = `
                <span title="${tag}">${tag}</span>
                <button title="Remove tag">
                    ${feather.icons["x"]?.toSvg({ width: 12, height: 12 }) || "x"}
                </button>
            `;
            item.querySelector("button")?.addEventListener("click", (event) => {
                event.stopPropagation();
                pantryState.bulkPendingTags.splice(realIdx, 1);
                renderBulkTagChips();
                refreshBulkTagSuggestions();
                if (bulkTagApplyBtn) bulkTagApplyBtn.disabled = pantryState.bulkPendingTags.length === 0;
            });
            popover.appendChild(item);
        });

        moreBadge.addEventListener("click", (event) => {
            event.stopPropagation();
            popover.classList.toggle("hidden");
        });
        moreBadge.appendChild(popover);
        bulkTagChips.appendChild(moreBadge);
    }
}

// ─── Suggestion rendering ─────────────────────────────────────────────────────

export function renderBulkTagSuggestions() {
    if (!bulkTagSuggestionsEl) return;

    if (pantryState.bulkTagSuggestions.length === 0) {
        bulkTagSuggestionsEl.classList.add("hidden");
        return;
    }

    bulkTagSuggestionsEl.innerHTML = "";
    const closeRow = document.createElement("div");
    closeRow.className = "suggestion-close-row";
    const closeBtn = document.createElement("button");
    closeBtn.className = "suggestion-close-btn";
    closeBtn.setAttribute("aria-label", "Close suggestions");
    closeBtn.innerHTML = feather.icons["x"]?.toSvg({ width: 14, height: 14 }) || "x";
    closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        hideBulkTagSuggestions();
        bulkTagInput?.blur();
    });
    closeRow.appendChild(closeBtn);
    bulkTagSuggestionsEl.appendChild(closeRow);

    const typed = normalizeTagInput(bulkTagInput?.value || "");
    pantryState.bulkTagSuggestions.forEach((tag, index) => {
        const option = document.createElement("div");
        option.className =
            "bulk-tag-suggestion suggestion-item" +
            (index === pantryState.bulkTagSuggestionIndex ? " selected" : "");
        if (typed && tag.startsWith(typed)) {
            const prefix = tag.slice(0, typed.length);
            const suffix = tag.slice(typed.length);
            option.innerHTML = `<span class="suggest-tag-match">${prefix}</span>${suffix}`;
        } else {
            option.textContent = tag;
        }
        option.addEventListener("click", () => addBulkPendingTag(tag));
        bulkTagSuggestionsEl.appendChild(option);
    });

    bulkTagSuggestionsEl.classList.remove("hidden");
}

export function hideBulkTagSuggestions() {
    pantryState.bulkTagSuggestions = [];
    pantryState.bulkTagSuggestionIndex = -1;
    bulkTagSuggestionsEl?.classList.add("hidden");
}

export function refreshBulkTagSuggestions() {
    const typed = normalizeTagInput(bulkTagInput?.value || "");
    pantryState.bulkTagSuggestions = Array.from(pantryState.allKnownTags)
        .filter((tag) => !pantryState.bulkPendingTags.includes(tag) && tag.startsWith(typed))
        .sort((a, b) => a.localeCompare(b));
    pantryState.bulkTagSuggestionIndex = pantryState.bulkTagSuggestions.length > 0 ? 0 : -1;
    renderBulkTagSuggestions();
}

export function addBulkPendingTag(tagValue: string) {
    const tag = normalizeTagInput(tagValue);
    if (!tag || pantryState.bulkPendingTags.includes(tag)) {
        if (bulkTagInput) bulkTagInput.value = "";
        refreshBulkTagSuggestions();
        return;
    }

    pantryState.bulkPendingTags.push(tag);
    pantryState.bulkPendingTags.sort((a, b) => a.localeCompare(b));
    if (bulkTagInput) bulkTagInput.value = "";
    renderBulkTagChips();
    refreshBulkTagSuggestions();
    if (bulkTagApplyBtn) bulkTagApplyBtn.disabled = pantryState.bulkPendingTags.length === 0;
}

// ─── Open / close ─────────────────────────────────────────────────────────────

export function openBulkTagEditor() {
    pantryState.isBulkTagEditorOpen = true;
    bulkTagEditor?.classList.remove("hidden");
    bulkActionBar?.classList.add("tag-editor-open");
    pantryState.bulkPendingTags = [];
    renderBulkTagChips();
    refreshBulkTagSuggestions();
    if (bulkTagApplyBtn) bulkTagApplyBtn.disabled = true;
    bulkTagInput?.focus();
}

export function closeBulkTagEditor() {
    pantryState.isBulkTagEditorOpen = false;
    bulkTagEditor?.classList.add("hidden");
    bulkActionBar?.classList.remove("tag-editor-open");
    pantryState.bulkPendingTags = [];
    if (bulkTagInput) bulkTagInput.value = "";
    renderBulkTagChips();
    hideBulkTagSuggestions();
    if (bulkTagApplyBtn) bulkTagApplyBtn.disabled = true;
}

// ─── Input event wiring ───────────────────────────────────────────────────────

/** Call once during page init to wire up all bulkTagInput event handlers. */
export function wireBulkTagInputHandlers(onApplyTags: () => Promise<void>) {
    bulkTagInput?.addEventListener("input", () => {
        const text = bulkTagInput.value;
        const delimiterMatch = text.match(/[, ]$/);
        const term = normalizeTagInput(text);
        if (delimiterMatch && term) {
            addBulkPendingTag(term);
            return;
        }
        refreshBulkTagSuggestions();
    });

    bulkTagInput?.addEventListener("focus", refreshBulkTagSuggestions);
    bulkTagInput?.addEventListener("click", refreshBulkTagSuggestions);

    bulkTagInput?.addEventListener("keydown", async (event: KeyboardEvent) => {
        if (event.key === "Tab") {
            if (pantryState.bulkTagSuggestions.length > 0) {
                event.preventDefault();
                const index = pantryState.bulkTagSuggestionIndex >= 0 ? pantryState.bulkTagSuggestionIndex : 0;
                addBulkPendingTag(pantryState.bulkTagSuggestions[index]);
            }
            return;
        }

        if (event.key === "ArrowDown" && pantryState.bulkTagSuggestions.length > 0) {
            event.preventDefault();
            pantryState.bulkTagSuggestionIndex = (pantryState.bulkTagSuggestionIndex + 1) % pantryState.bulkTagSuggestions.length;
            renderBulkTagSuggestions();
            return;
        }

        if (event.key === "ArrowUp" && pantryState.bulkTagSuggestions.length > 0) {
            event.preventDefault();
            pantryState.bulkTagSuggestionIndex =
                pantryState.bulkTagSuggestionIndex <= 0
                    ? pantryState.bulkTagSuggestions.length - 1
                    : pantryState.bulkTagSuggestionIndex - 1;
            renderBulkTagSuggestions();
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            if (pantryState.bulkTagSuggestions.length > 0 && pantryState.bulkTagSuggestionIndex >= 0) {
                addBulkPendingTag(pantryState.bulkTagSuggestions[pantryState.bulkTagSuggestionIndex]);
                return;
            }
            const raw = bulkTagInput?.value || "";
            if (raw.trim().length > 0) {
                addBulkPendingTag(raw);
                return;
            }
            if (pantryState.bulkPendingTags.length > 0) await onApplyTags();
            return;
        }

        if (event.key === "Backspace" && (bulkTagInput?.value || "") === "" && pantryState.bulkPendingTags.length > 0) {
            pantryState.bulkPendingTags.pop();
            renderBulkTagChips();
            refreshBulkTagSuggestions();
            if (bulkTagApplyBtn) bulkTagApplyBtn.disabled = pantryState.bulkPendingTags.length === 0;
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            if (!bulkTagSuggestionsEl?.classList.contains("hidden")) {
                hideBulkTagSuggestions();
            } else {
                closeBulkTagEditor();
            }
        }
    });
}

export { bulkTagEditor, bulkTagInput, bulkTagSuggestionsEl };
