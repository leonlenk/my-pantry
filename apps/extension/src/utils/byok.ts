import { getLocal, setLocal } from "./storage";

declare const chrome: any;

// ─── BYOK key encryption (AES-GCM, key derived from extension ID via PBKDF2) ──

const _BYOK_SALT = "mypantry-byok-salt-v1";
const _BYOK_ITERATIONS = 100_000;

async function _deriveByokCryptoKey(): Promise<CryptoKey> {
    const password =
        typeof chrome !== "undefined" && chrome.runtime?.id
            ? chrome.runtime.id
            : "mypantry-extension-fallback";
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: new TextEncoder().encode(_BYOK_SALT),
            iterations: _BYOK_ITERATIONS,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

/** Encrypts a plaintext API key; returns a base64-encoded IV+ciphertext blob. */
export async function encryptApiKey(plaintext: string): Promise<string> {
    const key = await _deriveByokCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(plaintext),
    );
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), 12);
    return btoa(String.fromCharCode(...combined));
}

/** Decrypts a base64-encoded blob produced by encryptApiKey; returns null on failure. */
export async function decryptApiKey(ciphertext: string): Promise<string | null> {
    try {
        const key = await _deriveByokCryptoKey();
        const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        return new TextDecoder().decode(decrypted);
    } catch {
        return null;
    }
}

/**
 * Returns the BYOK API key, preferring the encrypted form.
 * Migrates plaintext keys to encrypted storage on first access.
 * Returns null if no key is configured.
 */
export async function getByokApiKey(): Promise<string | null> {
    const data = await getLocal(["encryptedApiKey", "plaintextApiKey"]);

    if (data.encryptedApiKey) {
        return decryptApiKey(data.encryptedApiKey);
    }

    // Migration path: re-save as encrypted and clear plaintext
    const plain = data.plaintextApiKey;
    if (plain && typeof plain === "string" && plain.length > 0 && plain.length <= 300) {
        try {
            const encrypted = await encryptApiKey(plain);
            await setLocal({ encryptedApiKey: encrypted, plaintextApiKey: null });
        } catch (err) {
            console.warn("[BYOK] Encryption of plaintext API key failed; clearing stored key:", err);
            // Remove the plaintext key from storage rather than leaving it in the clear.
            // The user will be prompted to re-enter their key on next use.
            await setLocal({ plaintextApiKey: null });
            return null;
        }
        return plain;
    }

    return null;
}

const hardcodedPricing: Record<string, string> = {
    // Google
    "models/gemini-2.5-flash": "Cheaper",
    "models/gemini-2.0-flash": "Fast",
    "models/gemini-2.5-pro": "Powerful, More Expensive",
    "models/gemini-2.0-pro-exp": "Experimental",
    // OpenAI
    "gpt-4o-mini": "$0.15/1M in",
    "o3-mini": "$1.10/1M in",
    "gpt-4o": "$2.50/1M in",
};

const hardcodedPricingSort: Record<string, number> = {
    // Google
    "models/gemini-2.5-flash": 1,
    "models/gemini-2.0-flash": 2,
    "models/gemini-2.5-pro": 3,
    "models/gemini-2.0-pro-exp": 4,
    // OpenAI
    "gpt-4o-mini": 0.15,
    "o3-mini": 1.10,
    "gpt-4o": 2.50,
};

// Anthropic models are hardcoded to avoid CORS issues with the /v1/models endpoint from browser contexts.
// The messages endpoint supports direct browser access but the models listing endpoint does not.
const hardcodedClaudeModels = [
    { id: "claude-3-haiku-20240307",      name: "Claude 3 Haiku",      price: "$0.25/1M in" },
    { id: "claude-3-5-haiku-20241022",    name: "Claude 3.5 Haiku",    price: "$0.80/1M in" },
    { id: "claude-haiku-4-5-20251001",    name: "Claude Haiku 4.5",    price: "$0.80/1M in" },
    { id: "claude-3-5-sonnet-20241022",   name: "Claude 3.5 Sonnet",   price: "$3.00/1M in" },
    { id: "claude-3-7-sonnet-20250219",   name: "Claude 3.7 Sonnet",   price: "$3.00/1M in" },
    { id: "claude-sonnet-4-6",            name: "Claude Sonnet 4.6",   price: "$3.00/1M in" },
    { id: "claude-opus-4-6",              name: "Claude Opus 4.6",     price: "$15.00/1M in" },
];

export async function fetchModels(
    selectProvider: HTMLSelectElement,
    selectModel: HTMLSelectElement,
    apiKey: string,
    preselectModelId?: string
) {
    const provider = selectProvider.value;

    // OpenRouter and Claude use hardcoded/public models lists that don't require a key
    if (provider !== "openrouter" && provider !== "claude" && !apiKey) {
        selectModel.innerHTML = `<option value="">Enter API Key to load models...</option>`;
        selectModel.disabled = true;
        return;
    }

    selectModel.innerHTML = `<option value="">Loading models...</option>`;
    selectModel.disabled = true;

    try {
        let optionsHtml = "";

        if (provider === "openrouter") {
            const res = await fetch("https://openrouter.ai/api/v1/models");
            if (!res.ok) throw new Error("Failed to load models");
            const data = await res.json();

            // OpenRouter provides pricing! Sort by prompt price.
            optionsHtml = data.data.sort((a: any, b: any) =>
                parseFloat(a.pricing?.prompt || "999") - parseFloat(b.pricing?.prompt || "999")
            ).map((m: any) => {
                const promptPrice = (parseFloat(m.pricing?.prompt || "0") * 1000000).toFixed(2);
                const compPrice = (parseFloat(m.pricing?.completion || "0") * 1000000).toFixed(2);
                const priceLabel = promptPrice === "0.00" && compPrice === "0.00"
                    ? "Free"
                    : `$${promptPrice} in / $${compPrice} out`;
                return `<option value="${m.id}">${m.name} (${priceLabel})</option>`;
            }).join("");

        } else if (provider === "google") {
            const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
                headers: { "x-goog-api-key": apiKey },
            });
            if (!res.ok) throw new Error("Invalid API Key or network error");
            const data = await res.json();

            const validModels = data.models.filter((m: any) =>
                m.supportedGenerationMethods?.includes("generateContent")
            ).sort((a: any, b: any) =>
                (hardcodedPricingSort[a.name] ?? 999) - (hardcodedPricingSort[b.name] ?? 999)
            );

            optionsHtml = validModels.map((m: any) => {
                const val = m.name.replace("models/", "");
                const priceLabel = hardcodedPricing[m.name] ? ` (${hardcodedPricing[m.name]})` : "";
                return `<option value="${val}">${m.displayName || val}${priceLabel}</option>`;
            }).join("");

        } else if (provider === "openai") {
            const res = await fetch("https://api.openai.com/v1/models", {
                headers: { "Authorization": `Bearer ${apiKey}` }
            });
            if (!res.ok) throw new Error("Invalid API Key or network error");
            const data = await res.json();

            const validModels = data.data.filter((m: any) =>
                m.id.startsWith("gpt-") || m.id.startsWith("o1") || m.id.startsWith("o3")
            ).sort((a: any, b: any) =>
                (hardcodedPricingSort[a.id] ?? 999) - (hardcodedPricingSort[b.id] ?? 999)
            );

            optionsHtml = validModels.map((m: any) => {
                const priceLabel = hardcodedPricing[m.id] ? ` (${hardcodedPricing[m.id]})` : "";
                return `<option value="${m.id}">${m.id}${priceLabel}</option>`;
            }).join("");

        } else if (provider === "claude") {
            optionsHtml = hardcodedClaudeModels.map(m =>
                `<option value="${m.id}">${m.name} (${m.price})</option>`
            ).join("");
        }

        if (optionsHtml) {
            const prevValue = selectModel.value;
            selectModel.innerHTML = optionsHtml;
            selectModel.disabled = false;

            const idToSelect = preselectModelId ?? prevValue;
            if (idToSelect && Array.from(selectModel.options).some(opt => opt.value === idToSelect)) {
                selectModel.value = idToSelect;
            }
        } else {
            selectModel.innerHTML = `<option value="">No valid models found</option>`;
            selectModel.disabled = false;
        }

    } catch (err) {
        selectModel.innerHTML = `<option value="">Error loading models. Check API Key.</option>`;
        selectModel.disabled = false;
    }
}

export async function loadByokSettings(idPrefix: string, apiKey?: string) {
    const selectProvider = document.getElementById(`${idPrefix}select-provider`) as HTMLSelectElement | null;
    const selectModel = document.getElementById(`${idPrefix}select-model`) as HTMLSelectElement | null;
    const inputApiKey = document.getElementById(`${idPrefix}input-api-key`) as HTMLInputElement | null;

    if (!selectProvider || !selectModel) return;

    // Resolve the key: use the passed value, or fall back to decrypting from storage
    const resolvedKey = apiKey ?? await getByokApiKey() ?? "";

    // Stash the stored key so provider-change handlers can use it when the input is left blank
    if (inputApiKey && resolvedKey) inputApiKey.dataset.storedKey = resolvedKey;

    const storageResult = await getLocal(["llmProvider", "llmModel"]);
    let currentModel = "";

    if (storageResult.llmProvider) selectProvider.value = storageResult.llmProvider;
    if (storageResult.llmModel) currentModel = storageResult.llmModel;

    await fetchModels(selectProvider, selectModel, resolvedKey, currentModel);
}

export interface ByokFormOptions {
    idPrefix: string;
    onSaveSuccess: (provider: string, model: string, isNewKey: boolean) => void | Promise<void>;
    isSettingsMode?: boolean;
}

export async function initializeByokForm(options: ByokFormOptions) {
    const { idPrefix, onSaveSuccess, isSettingsMode = false } = options;

    const selectProvider = document.getElementById(`${idPrefix}select-provider`) as HTMLSelectElement | null;
    const selectModel = document.getElementById(`${idPrefix}select-model`) as HTMLSelectElement | null;
    const inputApiKey = document.getElementById(`${idPrefix}input-api-key`) as HTMLInputElement | null;
    const btnSubmit = document.getElementById(`${idPrefix}btn-submit`) as HTMLButtonElement | null;
    const btnRevoke = document.getElementById(`${idPrefix}btn-revoke`) as HTMLButtonElement | null;
    const statusMsg = document.getElementById(`${idPrefix}status-message`);
    const apiKeyHelp = document.getElementById(`${idPrefix}api-key-help`);

    if (!selectProvider || !selectModel || !inputApiKey || !btnSubmit) {
        console.warn("BYOK Form core elements not found for prefix:", idPrefix);
        return;
    }

    // Show the revoke button only when a key is already stored
    if (btnRevoke && isSettingsMode) {
        const existingKey = await getByokApiKey();
        if (existingKey) btnRevoke.classList.remove("hidden");

        btnRevoke.addEventListener("click", async () => {
            btnRevoke.disabled = true;
            await setLocal({ encryptedApiKey: null, plaintextApiKey: null, apiMode: "byok" });
            inputApiKey.value = "";
            delete inputApiKey.dataset.storedKey;
            btnRevoke.classList.add("hidden");
            selectModel.innerHTML = `<option value="">Enter API Key to load models...</option>`;
            selectModel.disabled = true;
            if (statusMsg) {
                statusMsg.textContent = "API key removed.";
                statusMsg.style.color = "var(--color-text-muted)";
                statusMsg.classList.remove("hidden");
            }
        });
    }

    if (isSettingsMode) {
        if (apiKeyHelp) apiKeyHelp.classList.remove("hidden");
    } else {
        setTimeout(() => {
            fetchModels(selectProvider, selectModel, inputApiKey.value);
        }, 100);
    }

    selectProvider.addEventListener("change", () => {
        const key = inputApiKey.value.trim() || inputApiKey.dataset.storedKey || "";
        fetchModels(selectProvider, selectModel, key);
    });

    inputApiKey.addEventListener("blur", () => {
        if (inputApiKey.value.trim().length > 0) {
            inputApiKey.dataset.storedKey = inputApiKey.value.trim();
            fetchModels(selectProvider, selectModel, inputApiKey.value);
        }
    });

    btnSubmit.addEventListener("click", async () => {
        const key = inputApiKey.value.trim();
        const provider = selectProvider.value;
        const model = selectModel.value;

        if (!isSettingsMode && !key) {
            if (statusMsg) {
                statusMsg.textContent = "API Key is required.";
                statusMsg.style.color = "#ef4444";
                statusMsg.classList.remove("hidden");
            }
            return;
        }

        btnSubmit.disabled = true;
        const origText = btnSubmit.textContent;
        btnSubmit.textContent = "Saving...";

        try {
            const storagePayload: Parameters<typeof setLocal>[0] = {
                llmProvider: provider as any,
                llmModel: model,
            };

            let isNewKey = false;

            if (key.length > 0) {
                isNewKey = true;
                storagePayload.apiMode = "byok";
                storagePayload.encryptedApiKey = await encryptApiKey(key);
                storagePayload.plaintextApiKey = null;
            }

            if (!isSettingsMode) {
                storagePayload.setupComplete = true;
                storagePayload.apiUrl = import.meta.env.PUBLIC_API_URL ?? "http://127.0.0.1:8000";
            }

            await setLocal(storagePayload);

            if (statusMsg) {
                statusMsg.textContent = "Settings saved!";
                statusMsg.style.color = "var(--color-accent)";
                statusMsg.classList.remove("hidden");
            }

            await onSaveSuccess(provider, model, isNewKey);

        } catch (e: any) {
            console.error("BYOK Save Error:", e);
            if (statusMsg) {
                statusMsg.textContent = "Failed to save: " + e.message;
                statusMsg.style.color = "#ef4444";
                statusMsg.classList.remove("hidden");
            }
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = origText || "Save Key";
        }
    });
}
