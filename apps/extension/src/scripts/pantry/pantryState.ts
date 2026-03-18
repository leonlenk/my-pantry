/**
 * Shared mutable state and constants for the pantry page.
 * All pantry modules import from here to avoid duplicating state.
 */

export const VIEW_MODE_KEY = "pantryViewMode";
export const UNIT_PREFERENCE_KEY = "preferredUnitSystem";

function loadTagFilters(): string[] {
    try {
        const stored = localStorage.getItem("pantryTagFilters");
        if (stored) return JSON.parse(stored);
        const oldSingle = localStorage.getItem("pantryTagFilter");
        if (oldSingle) return [oldSingle.toUpperCase()];
    } catch { /* ignore */ }
    return [];
}

export const pantryState = {
    currentFilter: localStorage.getItem("pantryFilter") || "all",
    currentViewMode: localStorage.getItem(VIEW_MODE_KEY) || "large",
    skipNextViewTransition: false,
    currentTagFilters: loadTagFilters(),
    allKnownTags: new Set<string>(),
    activeExtractions: {} as Record<string, { status: string; title: string }>,
    isSelectionMode: false,
    selectedRecipeIds: new Set<string>(),
    visibleRecipeOrder: [] as string[],
    lastSelectedRecipeId: null as string | null,
    isBulkTagEditorOpen: false,
    bulkPendingTags: [] as string[],
    bulkTagSuggestions: [] as string[],
    bulkTagSuggestionIndex: -1,
    currentSuggestions: [] as string[],
    selectedSuggestionIndex: -1,
};

export function normalizeTagInput(value: string): string {
    return value.trim().toUpperCase();
}
