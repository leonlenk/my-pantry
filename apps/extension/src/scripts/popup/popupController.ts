/**
 * Popup action panel controller.
 *
 * Handles all popup UI interactions:
 *   - Auth state detection and profile badge setup
 *   - Extraction triggering and live status display
 *   - Settings / BYOK panel with encrypted-key unlock flow
 *   - Logout, switch account, cloud logout
 */

import { decryptData } from "../../utils/crypto";
import { initializeByokForm, loadByokSettings } from "../../utils/byok";

declare const chrome: any;

// ─── DOM handles ─────────────────────────────────────────────────────────────

const mainView = document.getElementById("main-view");
const logoutBtn = document.getElementById("logout-btn");
const profileBadgeBtn = document.getElementById("profile-badge-btn");
const profileDropdownMenu = document.getElementById("profile-dropdown-menu");
const switchAccountBtn = document.getElementById("switch-account-btn");
const cloudLogoutBtn = document.getElementById("cloud-logout-btn");
const openPantryBtn = document.getElementById("open-pantry-btn");
const visitHomepageBtn = document.getElementById("visit-homepage-btn");
const extractBtn = document.getElementById("extract-btn");
const passwordContainer = document.getElementById("password-container");
const confirmExtractBtn = document.getElementById("confirm-extract-btn");
const passwordInput = document.getElementById("popup-password") as HTMLInputElement;
const statusViewport = document.getElementById("status-viewport");
const statusBadge = document.getElementById("status-badge");
const safeToCloseMsg = document.getElementById("safe-to-close-msg");
const errorContainer = document.getElementById("error-container");
const errorDetails = document.getElementById("error-details");
const settingsBtn = document.getElementById("settings-btn");
const btnBackSettings = document.getElementById("btn-back-settings");
const actionCard = document.querySelector(".action-card");
const settingsPanel = document.getElementById("settings-panel");
const settingsAuthPanel = document.getElementById("settings-auth-panel");
const btnBackSettingsAuth = document.getElementById("btn-back-settings-auth");
const inputSettingsAuthPassword = document.getElementById(
    "input-settings-auth-password"
) as HTMLInputElement | null;
const btnSubmitSettingsAuth = document.getElementById("btn-submit-settings-auth") as HTMLButtonElement | null;
const settingsAuthStatus = document.getElementById("settings-auth-status");

let currentSettingsPassword = "";

// ─── JWT helpers ─────────────────────────────────────────────────────────────

function parseJwt(token: string) {
    try {
        const base64Url = token.split(".")[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.warn("Failed to parse JWT", e);
        return null;
    }
}

// ─── Status messages ─────────────────────────────────────────────────────────

function addStatusMessage(text: string, isError: boolean = false, isComplete: boolean = false) {
    if (!statusViewport || !statusBadge) return;

    statusViewport.classList.remove("hidden");
    statusBadge.textContent = isError ? "Extraction failed" : text;
    statusBadge.classList.remove("error", "done");
    if (isError) statusBadge.classList.add("error");
    else if (isComplete) statusBadge.classList.add("done");

    if (safeToCloseMsg) {
        if (!isError && !isComplete && (text.includes("Asking") || text.includes("tokens"))) {
            safeToCloseMsg.classList.remove("hidden");
        } else if (isError || isComplete) {
            safeToCloseMsg.classList.add("hidden");
        } else if (text.includes("Starting") || text.includes("Initializing")) {
            safeToCloseMsg.classList.add("hidden");
        }
    }

    if (isError && errorContainer && errorDetails) {
        errorContainer.classList.remove("hidden");
        errorDetails.textContent = text;
    } else if (!isError && errorContainer) {
        errorContainer.classList.add("hidden");
    }
}

// ─── Extraction ───────────────────────────────────────────────────────────────

async function executeExtraction(apiKey: string, llmModel: string, llmProvider: string, authMode: "cloud" | "byok") {
    addStatusMessage("Initializing background extraction...");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        addStatusMessage("Could not find active tab.", true);
        return;
    }

    console.log(`[MyPantry] Triggering background extraction for tab: ${tab.url}`);
    chrome.runtime.sendMessage({
        type: "START_EXTRACTION",
        tabId: tab.id,
        url: tab.url,
        apiKey,
        llmModel,
        llmProvider,
        authMode,
    });
}

// ─── Clearance helper ─────────────────────────────────────────────────────────

const AUTH_KEYS = [
    "setupComplete",
    "plaintextApiKey",
    "encryptedApiKey",
    "supabaseToken",
    "supabaseRefreshToken",
    "llmProvider",
    "llmModel",
];

async function clearAuthAndClose() {
    await chrome.storage.local.remove(AUTH_KEYS);
    chrome.runtime.sendMessage({ type: "CLEAR_CACHED_API_KEY" });
    window.close();
}

// ─── Init: auth state detection ───────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    try {
        if (typeof chrome !== "undefined" && chrome.storage) {
            const data = await chrome.storage.local.get([
                "setupComplete",
                "plaintextApiKey",
                "encryptedApiKey",
                "supabaseToken",
            ]);

            if (!data.setupComplete && !data.plaintextApiKey && !data.encryptedApiKey && !data.supabaseToken) {
                chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
            } else {
                mainView?.classList.remove("hidden");

                const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
                const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
                if (supabaseUrl && supabaseAnonKey) {
                    chrome.storage.local.set({ supabaseUrl, supabaseAnonKey });
                }

                if (!data.supabaseToken) {
                    // BYOK user
                    document.getElementById("settings-btn")?.classList.remove("hidden");
                    document.getElementById("logout-btn")?.classList.remove("hidden");
                } else {
                    // Cloud user — show profile badge
                    const payload = parseJwt(data.supabaseToken);
                    if (payload?.email) {
                        const profileBadge = document.getElementById("profile-badge-btn");
                        const emailDisplay = document.getElementById("profile-email-display");
                        const avatar = document.getElementById("profile-avatar") as HTMLImageElement;
                        if (profileBadge && emailDisplay && avatar) {
                            profileBadge.classList.remove("hidden");
                            emailDisplay.textContent = payload.email;
                            if (payload.user_metadata?.avatar_url) {
                                avatar.src = payload.user_metadata.avatar_url;
                                avatar.style.display = "block";
                            }
                        }
                    } else {
                        document.getElementById("logout-btn")?.classList.remove("hidden");
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Storage check failed on load", e);
    }
});

// ─── Init: active extraction / already saved check ───────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    try {
        if (typeof chrome !== "undefined" && chrome.tabs) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const response = await chrome.runtime.sendMessage({
                    type: "GET_EXTRACTION_STATUS",
                    url: tab.url,
                });
                if (response?.isActive) {
                    extractBtn?.classList.add("hidden");
                    passwordContainer?.classList.remove("hidden");
                    if (passwordInput) passwordInput.classList.add("hidden");
                    if (confirmExtractBtn) confirmExtractBtn.classList.add("hidden");
                    addStatusMessage(response.status || "Extracting in background...");
                }
            }
        }
    } catch (e) {
        console.warn("Could not check extraction status", e);
    }

    try {
        if (typeof chrome !== "undefined" && chrome.tabs && chrome.storage?.local) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.url) {
                const data = await chrome.storage.local.get("savedUrls");
                const urls: string[] = Array.isArray(data.savedUrls) ? data.savedUrls : [];
                const normTabUrl = tab.url.replace(/\/$/, "");
                if (urls.some((u) => u.replace(/\/$/, "") === normTabUrl)) {
                    if (extractBtn) {
                        extractBtn.textContent = "✓ Already Saved inside Pantry";
                        extractBtn.classList.remove("primary");
                        extractBtn.classList.add("outline");
                        (extractBtn as HTMLButtonElement).disabled = true;
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Could not check saved status", e);
    }
});

// ─── BYOK settings form ───────────────────────────────────────────────────────

initializeByokForm({
    idPrefix: "popup-byok-",
    onSaveSuccess: () => {
        setTimeout(() => {
            if (actionCard && settingsPanel) {
                settingsPanel.classList.add("hidden");
                actionCard.classList.remove("hidden");
            }
        }, 600);
    },
    isSettingsMode: true,
    getPassword: () => currentSettingsPassword,
});

// ─── Navigation buttons ───────────────────────────────────────────────────────

openPantryBtn?.addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: chrome.runtime.getURL("pantry.html") });
    } else {
        window.open("/pantry", "_blank");
    }
});

visitHomepageBtn?.addEventListener("click", () => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: "https://mypantry.dev" });
    } else {
        window.open("https://mypantry.dev", "_blank");
    }
});

// ─── Auth buttons ─────────────────────────────────────────────────────────────

logoutBtn?.addEventListener("click", clearAuthAndClose);
cloudLogoutBtn?.addEventListener("click", clearAuthAndClose);

switchAccountBtn?.addEventListener("click", async () => {
    if (typeof chrome !== "undefined" && chrome.storage) {
        await chrome.storage.local.remove(AUTH_KEYS);
        chrome.runtime.sendMessage({ type: "CLEAR_CACHED_API_KEY" });
        const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
        if (supabaseUrl && chrome.tabs) {
            const redirectTo = "https://mypantry.dev/api/auth/callback";
            const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}&prompt=consent`;
            chrome.tabs.create({ url: authUrl });
        }
        window.close();
    }
});

// ─── Profile dropdown ─────────────────────────────────────────────────────────

profileBadgeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    profileDropdownMenu?.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
    if (profileDropdownMenu?.classList.contains("hidden")) return;
    const rect = profileDropdownMenu!.getBoundingClientRect();
    const badgeRect = profileBadgeBtn?.getBoundingClientRect();
    const inside =
        e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    const onBadge = badgeRect
        ? e.clientX >= badgeRect.left &&
          e.clientX <= badgeRect.right &&
          e.clientY >= badgeRect.top &&
          e.clientY <= badgeRect.bottom
        : false;
    if (!inside && !onBadge) profileDropdownMenu!.classList.add("hidden");
});

// ─── Settings panel ───────────────────────────────────────────────────────────

settingsBtn?.addEventListener("click", async () => {
    if (actionCard?.classList.contains("hidden")) {
        // Already open — close it
        settingsPanel?.classList.add("hidden");
        settingsAuthPanel?.classList.add("hidden");
        actionCard?.classList.remove("hidden");
        return;
    }

    if (!actionCard || (!settingsPanel && !settingsAuthPanel)) return;

    const storageResult = (await chrome.storage.local.get(["encryptedApiKey", "plaintextApiKey"])) as {
        encryptedApiKey?: any;
        plaintextApiKey?: string;
    };

    actionCard.classList.add("hidden");

    if (storageResult.encryptedApiKey) {
        settingsAuthPanel?.classList.remove("hidden");
        if (inputSettingsAuthPassword) {
            inputSettingsAuthPassword.value = "";
            inputSettingsAuthPassword.focus();
        }
        if (settingsAuthStatus) settingsAuthStatus.classList.add("hidden");
    } else {
        settingsPanel?.classList.remove("hidden");
        await loadByokSettings("popup-byok-", storageResult.plaintextApiKey || "");
    }
});

btnBackSettings?.addEventListener("click", () => {
    if (actionCard && settingsPanel) {
        settingsPanel.classList.add("hidden");
        actionCard.classList.remove("hidden");
    }
});

btnBackSettingsAuth?.addEventListener("click", () => {
    if (actionCard && settingsAuthPanel) {
        settingsAuthPanel.classList.add("hidden");
        actionCard.classList.remove("hidden");
    }
});

btnSubmitSettingsAuth?.addEventListener("click", async () => {
    const password = inputSettingsAuthPassword?.value || "";
    if (!password) {
        if (settingsAuthStatus) {
            settingsAuthStatus.textContent = "Password required.";
            settingsAuthStatus.classList.remove("hidden");
        }
        return;
    }

    if (btnSubmitSettingsAuth) {
        btnSubmitSettingsAuth.disabled = true;
        btnSubmitSettingsAuth.textContent = "Unlocking...";
    }

    try {
        const storageResult = (await chrome.storage.local.get(["encryptedApiKey"])) as { encryptedApiKey?: any };
        if (!storageResult.encryptedApiKey) throw new Error("No encrypted key found.");

        const decryptedKey = await decryptData(
            {
                ciphertext: storageResult.encryptedApiKey.ciphertext,
                iv: storageResult.encryptedApiKey.iv,
                salt: storageResult.encryptedApiKey.salt,
            },
            password
        );

        currentSettingsPassword = password;
        settingsAuthPanel?.classList.add("hidden");
        settingsPanel?.classList.remove("hidden");
        await loadByokSettings("popup-byok-", decryptedKey);
    } catch (e) {
        console.error("Settings Unlock Error", e);
        if (settingsAuthStatus) {
            settingsAuthStatus.textContent = "Incorrect password.";
            settingsAuthStatus.classList.remove("hidden");
        }
    } finally {
        if (btnSubmitSettingsAuth) {
            btnSubmitSettingsAuth.disabled = false;
            btnSubmitSettingsAuth.textContent = "Unlock Settings";
        }
    }
});

// ─── Extract button ───────────────────────────────────────────────────────────

extractBtn?.addEventListener("click", async () => {
    if (extractBtn) {
        (extractBtn as HTMLButtonElement).disabled = true;
        extractBtn.textContent = "Loading...";
    }

    try {
        const storageResult: Record<string, any> = await chrome.storage.local.get([
            "plaintextApiKey",
            "supabaseToken",
            "llmModel",
            "llmProvider",
            "encryptedApiKey",
        ]);

        const hasCloudAuth = !!storageResult.supabaseToken;
        const hasPlaintextKey = !!storageResult.plaintextApiKey;
        const hasEncryptedKey = !!storageResult.encryptedApiKey;
        const llmModel = storageResult.llmModel || "gemini-2.5-flash";
        const llmProvider = storageResult.llmProvider || (hasCloudAuth ? "google" : "anthropic");

        if (hasCloudAuth || hasPlaintextKey) {
            extractBtn?.classList.add("hidden");
            passwordContainer?.classList.remove("hidden");
            if (passwordInput) passwordInput.classList.add("hidden");
            if (confirmExtractBtn) confirmExtractBtn.classList.add("hidden");
            addStatusMessage("Starting extraction...");

            try {
                const activeKey = storageResult.supabaseToken || storageResult.plaintextApiKey;
                const authMode = hasCloudAuth ? "cloud" : "byok";
                await executeExtraction(activeKey, llmModel, llmProvider, authMode);
            } catch (err: any) {
                let msg = err.message || "Unknown error occurred";
                if (msg.length > 80) msg = msg.substring(0, 80) + "...";
                addStatusMessage(`Error: ${msg}`, true);
            }
            return;
        }

        if (hasEncryptedKey) {
            const cacheResponse = await chrome.runtime.sendMessage({ type: "GET_CACHED_API_KEY" });
            if (cacheResponse?.apiKey) {
                extractBtn?.classList.add("hidden");
                passwordContainer?.classList.remove("hidden");
                if (passwordInput) passwordInput.classList.add("hidden");
                if (confirmExtractBtn) confirmExtractBtn.classList.add("hidden");
                addStatusMessage("Starting extraction (using cached key)...");

                try {
                    await executeExtraction(cacheResponse.apiKey, llmModel, llmProvider, "byok");
                } catch (err: any) {
                    let msg = err.message || "Unknown error occurred";
                    if (msg.length > 80) msg = msg.substring(0, 80) + "...";
                    addStatusMessage(`Error: ${msg}`, true);
                }
                return;
            }
        }
    } catch (e: any) {
        console.error("Storage error", e);
    }

    extractBtn?.classList.add("hidden");
    passwordContainer?.classList.remove("hidden");
    passwordInput?.focus();
});

confirmExtractBtn?.addEventListener("click", async () => {
    const password = passwordInput?.value;
    if (!password) {
        addStatusMessage("Please enter your password.", true);
        return;
    }

    if (confirmExtractBtn) {
        (confirmExtractBtn as HTMLButtonElement).disabled = true;
        confirmExtractBtn.textContent = "Loading...";
    }

    addStatusMessage("Decrypting keys...");

    try {
        const storageResult: Record<string, any> = await chrome.storage.local.get([
            "encryptedApiKey",
            "llmModel",
            "llmProvider",
        ]);
        const encryptedApiKey = storageResult.encryptedApiKey;
        const llmModel = storageResult.llmModel || "claude-3-5-sonnet-20241022";
        const llmProvider = storageResult.llmProvider || "anthropic";

        if (!encryptedApiKey) {
            addStatusMessage("No API key found. Please run setup again.", true);
            if (confirmExtractBtn) {
                (confirmExtractBtn as HTMLButtonElement).disabled = false;
                confirmExtractBtn.textContent = "Confirm Extraction";
            }
            return;
        }

        const apiKey = await decryptData(encryptedApiKey, password);
        if (passwordInput) passwordInput.classList.add("hidden");
        if (confirmExtractBtn) confirmExtractBtn.classList.add("hidden");

        chrome.runtime.sendMessage({ type: "CACHE_API_KEY", apiKey });
        await executeExtraction(apiKey, llmModel, llmProvider, "byok");
    } catch (error: any) {
        let msg = error.message || "Unknown error";
        if (msg.length > 80) msg = msg.substring(0, 80) + "...";
        addStatusMessage(`Error: ${msg}`, true);
    } finally {
        if (confirmExtractBtn && errorContainer && !errorContainer.classList.contains("hidden")) {
            (confirmExtractBtn as HTMLButtonElement).disabled = false;
            confirmExtractBtn.textContent = "Confirm Extraction";
            confirmExtractBtn.classList.remove("hidden");
            if (passwordInput) passwordInput.classList.remove("hidden");
        }
    }
});

// ─── Background status listener ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: any) => {
    if (message.type !== "EXTRACTION_STATUS_UPDATE") return;
    const { status, isError, isComplete } = message;
    addStatusMessage(status, isError, isComplete);

    if (isError && confirmExtractBtn) {
        (confirmExtractBtn as HTMLButtonElement).disabled = false;
        confirmExtractBtn.textContent = "Confirm Extraction";
    }
    if (isComplete || isError) {
        if (extractBtn) {
            (extractBtn as HTMLButtonElement).disabled = false;
            extractBtn.textContent = "Extract & Add to Pantry";
        }
    }
});
