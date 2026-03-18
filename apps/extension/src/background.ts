// background.ts — Service worker: keep-alive, offscreen setup, and message routing.
// Heavy lifting is delegated to modules in background/ and utils/.

import { syncRecipeToCloud, deleteRecipeFromCloud, syncAllFromCloud, getCloudLatestTimestamp } from "./utils/sync";
import { saveRecipeLocally, getRecipe, getAllRecipes } from "./utils/db";
import { refreshSupabaseToken } from "./utils/authUtils";
import {
    normalizeUrl,
    getActiveExtractions,
    setActiveExtractions,
    markCancelled,
} from "./utils/extractionSession";
import { setupOffscreenDocument } from "./background/offscreen";
import { executeExtractionInBackground } from "./background/extractionJob";
import { executeSubstitutionInBackground } from "./background/substitutionJob";

// Temporary in-memory cache for the decrypted BYOK API key (1 hour expiration)
let cachedDecryptedApiKey: { key: string; expiresAt: number } | null = null;

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details: any) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
    }
});

// Re-apply badges if a tab updates or navigates while extraction is still running
chrome.tabs.onUpdated.addListener(async (tabId: number, changeInfo: any, tab: any) => {
    if (changeInfo.status === "complete" && tab.url) {
        const normUrl = normalizeUrl(tab.url);
        const map = await getActiveExtractions();
        const active = map[normUrl];
        if (active) {
            active.tabId = tabId;
            await setActiveExtractions(map);
            chrome.action.setBadgeText({ text: "...", tabId }).catch(() => {});
            chrome.action.setBadgeBackgroundColor({ color: "#F59E0B", tabId }).catch(() => {});
        }
    }
});

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
    // Auth: content script on mypantry.dev/api/auth/callback forwards the session
    if (message.type === "AUTH_SESSION_CAPTURED") {
        (async () => {
            const { accessToken, refreshToken } = message;
            await chrome.storage.local.set({
                supabaseToken: accessToken,
                supabaseRefreshToken: refreshToken ?? null,
            });
            if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id);
            try {
                await chrome.runtime.sendMessage({ type: "AUTH_COMPLETE" });
            } catch {
                // Setup page already closed — not an error
            }
            sendResponse({ success: true });
        })();
        return true;
    }

    if (message.type === "GENERATE_EMBEDDING") {
        (async () => {
            try {
                await setupOffscreenDocument();
                const embeddingResult = await chrome.runtime.sendMessage({
                    ...message,
                    target: "offscreen",
                });
                sendResponse(embeddingResult);
            } catch (error: any) {
                console.error("Error generating embedding in background:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.type === "START_EXTRACTION") {
        const { tabId, url, apiKey, llmModel, llmProvider, authMode } = message;
        const normUrl = normalizeUrl(url);
        (async () => {
            const map = await getActiveExtractions();
            if (!map[normUrl]) {
                executeExtractionInBackground(normUrl, tabId, apiKey, llmModel, llmProvider, authMode);
            }
            sendResponse({ success: true, status: map[normUrl]?.status || "Starting extraction..." });
        })();
        return true;
    }

    if (message.type === "GET_EXTRACTION_STATUS") {
        const normUrl = normalizeUrl(message.url);
        (async () => {
            const map = await getActiveExtractions();
            const active = map[normUrl];
            sendResponse({ isActive: !!active, status: active ? active.status : null });
        })();
        return true;
    }

    if (message.type === "GET_ALL_EXTRACTIONS") {
        (async () => {
            const map = await getActiveExtractions();
            sendResponse({ extractions: map });
        })();
        return true;
    }

    if (message.type === "CANCEL_EXTRACTION") {
        const normUrl = normalizeUrl(message.url);
        (async () => {
            await markCancelled(normUrl);
            const map = await getActiveExtractions();
            delete map[normUrl];
            await setActiveExtractions(map);
            sendResponse({ success: true });
        })();
        return true;
    }

    if (message.type === "ASK_SUBSTITUTION") {
        const { tabId, recipeData, userPrompt, apiKey, llmModel, llmProvider, authMode } = message;
        executeSubstitutionInBackground(tabId, recipeData, userPrompt, apiKey, llmModel, llmProvider, authMode);
        sendResponse({ success: true });
        return true;
    }

    if (message.type === "PUSH_ALL_LOCAL_TO_CLOUD") {
        (async () => {
            try {
                const localRecipes = await getAllRecipes();
                let pushedCount = 0;
                for (const recipe of localRecipes) {
                    try {
                        await syncRecipeToCloud(recipe);
                        pushedCount++;
                    } catch (err) {
                        console.warn(`[Sync] Failed to push recipe '${recipe.id}':`, err);
                    }
                }
                sendResponse({ success: true, pushed: pushedCount, total: localRecipes.length });
            } catch (err: any) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === "GET_CLOUD_LATEST") {
        (async () => {
            try {
                const latest = await getCloudLatestTimestamp();
                sendResponse({ success: true, latest_updated_at: latest });
            } catch (err: any) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === "SYNC_FROM_CLOUD") {
        (async () => {
            try {
                const since = message.since as string | undefined;
                const cloudRecipes = await syncAllFromCloud(since);
                let mergedCount = 0;
                for (const cloudRecipe of cloudRecipes) {
                    const local = await getRecipe(cloudRecipe.id);
                    const cloudTs = cloudRecipe.createdAt ?? 0;
                    const localTs = local?.createdAt ?? 0;
                    if (!local || cloudTs > localTs) {
                        await saveRecipeLocally(cloudRecipe);
                        mergedCount++;
                    }
                }
                const syncedAt = new Date().toISOString();
                await chrome.storage.local.set({ lastSyncAt: syncedAt });
                sendResponse({ success: true, merged: mergedCount, total: cloudRecipes.length, syncedAt });
            } catch (err: any) {
                console.warn("[Sync] Manual sync failed:", err);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.type === "SHARE_RECIPE") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get(["supabaseToken", "llmProvider", "apiUrl"]);
                if (stored.llmProvider !== "google" || !stored.supabaseToken) {
                    sendResponse({ success: false, error: "not_authenticated" });
                    return;
                }
                const freshToken = await refreshSupabaseToken();
                const token = freshToken ?? (stored.supabaseToken as string);
                const apiBase: string = (stored.apiUrl as string | undefined) ?? "http://127.0.0.1:8000";
                const res = await fetch(`${apiBase}/share`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ recipes: message.recipes }),
                });
                if (res.ok) {
                    const data = await res.json();
                    sendResponse({ success: true, url: data.url });
                } else {
                    const text = await res.text().catch(() => res.status.toString());
                    console.warn(`[Share] API error (${res.status}):`, text);
                    sendResponse({ success: false, error: "api_error", status: res.status });
                }
            } catch (err: any) {
                console.warn("[Share] Network error:", err?.message ?? err);
                sendResponse({ success: false, error: "network_error" });
            }
        })();
        return true;
    }

    if (message.type === "IMPORT_SHARED_RECIPE") {
        (async () => {
            try {
                const recipes: any[] = message.recipes ?? (message.recipe ? [message.recipe] : []);
                const now = Date.now();
                await setupOffscreenDocument();

                for (const recipe of recipes) {
                    recipe.createdAt = now;
                    const textToEmbed = [
                        recipe.title,
                        recipe.semantic_summary,
                        ...(recipe.ingredients?.map((i: any) => i.item) || []),
                    ]
                        .filter(Boolean)
                        .join(". ");

                    const embeddingResult: { success: boolean; embedding?: number[]; error?: string } =
                        await chrome.runtime.sendMessage({
                            type: "GENERATE_EMBEDDING",
                            target: "offscreen",
                            text: textToEmbed,
                        });

                    if (embeddingResult?.success && embeddingResult.embedding) {
                        recipe.embedding = embeddingResult.embedding;
                    } else {
                        console.warn("[Import] Embedding failed, saving without vector:", embeddingResult?.error);
                    }

                    await saveRecipeLocally(recipe);
                    await syncRecipeToCloud(recipe);
                }

                chrome.runtime.sendMessage({ type: "RECIPE_SAVED_FROM_SHARE" }).catch(() => {});
                sendResponse({ success: true });
            } catch (err: any) {
                console.warn("[Import] Failed to import shared recipe:", err?.message ?? err);
                sendResponse({ success: false });
            }
        })();
        return true;
    }

    if (message.type === "CACHE_API_KEY") {
        cachedDecryptedApiKey = { key: message.apiKey, expiresAt: Date.now() + 60 * 60 * 1000 };
        sendResponse({ success: true });
        return false;
    }

    if (message.type === "GET_CACHED_API_KEY") {
        if (cachedDecryptedApiKey && Date.now() < cachedDecryptedApiKey.expiresAt) {
            sendResponse({ apiKey: cachedDecryptedApiKey.key });
        } else {
            cachedDecryptedApiKey = null;
            sendResponse({ apiKey: null });
        }
        return false;
    }

    if (message.type === "CLEAR_CACHED_API_KEY") {
        cachedDecryptedApiKey = null;
        sendResponse({ success: true });
        return false;
    }
});
