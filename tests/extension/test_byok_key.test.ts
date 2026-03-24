/**
 * Tests for BYOK API key validation and the key-passing pipeline.
 *
 * Replicates the pure functions from popupController.ts and byok.ts
 * to verify that keys are stored, validated, and forwarded exactly as
 * the user entered them — with no corruption, truncation, or silent
 * fall-through to an old encrypted value.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Replicated from popupController.ts
// ---------------------------------------------------------------------------

function getValidStoredKey(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    if (value.length === 0 || value.length > 300) return undefined;
    return value;
}

// ---------------------------------------------------------------------------
// Replicated from byok.ts (save handler)
// ---------------------------------------------------------------------------

function buildStoragePayload(
    key: string,
    provider: string,
    model: string,
    isSettingsMode: boolean
): Record<string, unknown> {
    const payload: Record<string, unknown> = { llmProvider: provider, llmModel: model };

    if (key.length > 0) {
        payload.apiMode = "byok";
        payload.plaintextApiKey = key.trim();
    }

    if (!isSettingsMode) {
        payload.setupComplete = true;
    }

    return payload;
}

// ---------------------------------------------------------------------------
// Replicated from byok.ts (extraction dispatch — popup extract button)
// ---------------------------------------------------------------------------

function resolveActiveKey(
    plaintextApiKey: unknown,
    supabaseToken: string | undefined,
    apiMode: string | undefined
): { key: string | undefined; authMode: "cloud" | "byok" } {
    const resolvedMode: "cloud" | "byok" =
        (apiMode as "cloud" | "byok") ?? (supabaseToken ? "cloud" : "byok");

    if (resolvedMode === "cloud" && supabaseToken) {
        return { key: supabaseToken, authMode: "cloud" };
    }

    const storedKey = getValidStoredKey(plaintextApiKey);
    return { key: storedKey, authMode: "byok" };
}

// ---------------------------------------------------------------------------
// Tests: getValidStoredKey
// ---------------------------------------------------------------------------

describe("getValidStoredKey", () => {
    it("accepts a valid Anthropic key", () => {
        const key = "sk-ant-api03-" + "x".repeat(93);     // ~106 chars total
        expect(getValidStoredKey(key)).toBe(key);
    });

    it("accepts a valid OpenAI key", () => {
        const key = "sk-proj-" + "x".repeat(48);
        expect(getValidStoredKey(key)).toBe(key);
    });

    it("accepts a valid Google key", () => {
        const key = "AIzaSy" + "x".repeat(33);
        expect(getValidStoredKey(key)).toBe(key);
    });

    it("accepts a valid OpenRouter key", () => {
        const key = "sk-or-v1-" + "x".repeat(64);
        expect(getValidStoredKey(key)).toBe(key);
    });

    it("rejects an encrypted-object value (old crypto.ts format)", () => {
        const encryptedObject = { iv: [1, 2, 3], data: [4, 5, 6] };
        expect(getValidStoredKey(encryptedObject)).toBeUndefined();
    });

    it("rejects an ArrayBuffer (old crypto.ts Web Crypto output)", () => {
        expect(getValidStoredKey(new ArrayBuffer(128))).toBeUndefined();
    });

    it("rejects null", () => {
        expect(getValidStoredKey(null)).toBeUndefined();
    });

    it("rejects undefined", () => {
        expect(getValidStoredKey(undefined)).toBeUndefined();
    });

    it("rejects an empty string", () => {
        expect(getValidStoredKey("")).toBeUndefined();
    });

    it("rejects a base64-encoded ciphertext blob (>300 chars)", () => {
        // AES-GCM output for a typical API key, base64-encoded, is ~184–250 chars.
        // Use 301 to catch any such blob that slips past the 300-char guard.
        const blob = "A".repeat(301);
        expect(getValidStoredKey(blob)).toBeUndefined();
    });

    it("accepts a key that is exactly 300 chars", () => {
        const key = "x".repeat(300);
        expect(getValidStoredKey(key)).toBe(key);
    });

    it("rejects a key that is 301 chars", () => {
        expect(getValidStoredKey("x".repeat(301))).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Tests: key survives the save → storage → read → dispatch pipeline intact
// ---------------------------------------------------------------------------

describe("key pipeline integrity", () => {
    const anthropicKey = "sk-ant-api03-" + "A".repeat(93);

    it("stores the key exactly as typed (no modification)", () => {
        const payload = buildStoragePayload(anthropicKey, "claude", "claude-3-5-haiku-20241022", false);
        expect(payload.plaintextApiKey).toBe(anthropicKey);
    });

    it("trims surrounding whitespace from the saved key", () => {
        const paddedKey = `  ${anthropicKey}  `;
        const payload = buildStoragePayload(paddedKey, "claude", "claude-3-5-haiku-20241022", false);
        expect(payload.plaintextApiKey).toBe(anthropicKey);
    });

    it("does not save the key when the input is blank (settings mode)", () => {
        const payload = buildStoragePayload("", "claude", "claude-3-5-haiku-20241022", true);
        expect(payload.plaintextApiKey).toBeUndefined();
    });

    it("resolves to the plaintext key in byok mode", () => {
        const { key, authMode } = resolveActiveKey(anthropicKey, undefined, "byok");
        expect(key).toBe(anthropicKey);
        expect(authMode).toBe("byok");
    });

    it("resolves to the supabase token in cloud mode (ignores plaintextApiKey)", () => {
        const supabaseToken = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
        const { key, authMode } = resolveActiveKey(anthropicKey, supabaseToken, "cloud");
        expect(key).toBe(supabaseToken);
        expect(authMode).toBe("cloud");
    });

    it("returns undefined key when the stored value is an encrypted object", () => {
        const encryptedObject = { iv: [1, 2, 3], data: [4, 5, 6] };
        const { key } = resolveActiveKey(encryptedObject, undefined, "byok");
        expect(key).toBeUndefined();
    });

    it("returns undefined key when plaintextApiKey is a long base64 blob", () => {
        const blob = "A".repeat(301);
        const { key } = resolveActiveKey(blob, undefined, "byok");
        expect(key).toBeUndefined();
    });

    it("key value is preserved through JSON serialisation (Chrome message passing)", () => {
        // Chrome runtime messages are JSON-serialised. Verify the key survives a
        // JSON round-trip without modification.
        const message = { type: "START_EXTRACTION", apiKey: anthropicKey };
        const roundTripped = JSON.parse(JSON.stringify(message));
        expect(roundTripped.apiKey).toBe(anthropicKey);
        expect(roundTripped.apiKey.length).toBe(anthropicKey.length);
    });
});

// ---------------------------------------------------------------------------
// Replicated crypto helpers from byok.ts (using the fallback extension ID)
// ---------------------------------------------------------------------------

const _BYOK_SALT = "mypantry-byok-salt-v1";
const _BYOK_ITERATIONS = 100_000;

async function _deriveTestCryptoKey(): Promise<CryptoKey> {
    // Uses the same fallback as byok.ts when chrome.runtime.id is unavailable
    const password = "mypantry-extension-fallback";
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: new TextEncoder().encode(_BYOK_SALT), iterations: _BYOK_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    );
}

async function testEncryptApiKey(plaintext: string): Promise<string> {
    const key = await _deriveTestCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), 12);
    return btoa(String.fromCharCode(...combined));
}

async function testDecryptApiKey(ciphertext: string): Promise<string | null> {
    try {
        const key = await _deriveTestCryptoKey();
        const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
        return new TextDecoder().decode(decrypted);
    } catch {
        return null;
    }
}

/**
 * Replicates getByokApiKey() from byok.ts with injected storage dependencies
 * so the migration path can be tested without chrome.storage.
 */
async function simulateGetByokApiKey(
    storage: { encryptedApiKey?: string | null; plaintextApiKey?: unknown },
    storageSetter: (v: Record<string, unknown>) => void,
    encryptFn: (s: string) => Promise<string> = testEncryptApiKey,
): Promise<string | null> {
    if (storage.encryptedApiKey) {
        return testDecryptApiKey(storage.encryptedApiKey);
    }
    const plain = storage.plaintextApiKey;
    if (plain && typeof plain === "string" && plain.length > 0 && plain.length <= 300) {
        try {
            const encrypted = await encryptFn(plain);
            storageSetter({ encryptedApiKey: encrypted, plaintextApiKey: null });
        } catch {
            storageSetter({ plaintextApiKey: null });
            return null;
        }
        return plain;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Tests: plaintext → encrypted migration path (getByokApiKey)
// ---------------------------------------------------------------------------

describe("getByokApiKey migration path", () => {
    const testKey = "sk-ant-api03-" + "A".repeat(93);

    it("returns the plaintext key and migrates to encrypted storage", async () => {
        const saved: Record<string, unknown> = {};
        const result = await simulateGetByokApiKey(
            { encryptedApiKey: null, plaintextApiKey: testKey },
            (v) => Object.assign(saved, v),
        );
        expect(result).toBe(testKey);
        expect(typeof saved.encryptedApiKey).toBe("string");
        expect((saved.encryptedApiKey as string).length).toBeGreaterThan(0);
        expect(saved.plaintextApiKey).toBeNull();
    });

    it("encrypted blob round-trips back to the original key", async () => {
        const saved: Record<string, unknown> = {};
        await simulateGetByokApiKey(
            { encryptedApiKey: null, plaintextApiKey: testKey },
            (v) => Object.assign(saved, v),
        );
        const decrypted = await testDecryptApiKey(saved.encryptedApiKey as string);
        expect(decrypted).toBe(testKey);
    });

    it("uses the encrypted key on second access (no re-migration)", async () => {
        const saved: Record<string, unknown> = {};
        await simulateGetByokApiKey(
            { encryptedApiKey: null, plaintextApiKey: testKey },
            (v) => Object.assign(saved, v),
        );
        // Second call: storage now has encryptedApiKey
        const setterSpy = vi.fn();
        const result2 = await simulateGetByokApiKey(
            { encryptedApiKey: saved.encryptedApiKey as string, plaintextApiKey: null },
            setterSpy,
        );
        expect(result2).toBe(testKey);
        expect(setterSpy).not.toHaveBeenCalled();
    });

    it("returns null and clears storage when encryption fails", async () => {
        const saved: Record<string, unknown> = {};
        const failingEncrypt = async (_: string): Promise<string> => { throw new Error("crypto failure"); };
        const result = await simulateGetByokApiKey(
            { encryptedApiKey: null, plaintextApiKey: testKey },
            (v) => Object.assign(saved, v),
            failingEncrypt,
        );
        expect(result).toBeNull();
        expect(saved.plaintextApiKey).toBeNull();
        expect(saved.encryptedApiKey).toBeUndefined();
    });

    it("returns null when plaintextApiKey exceeds 300 chars", async () => {
        const setter = vi.fn();
        const result = await simulateGetByokApiKey(
            { encryptedApiKey: null, plaintextApiKey: "x".repeat(301) },
            setter,
        );
        expect(result).toBeNull();
        expect(setter).not.toHaveBeenCalled();
    });

    it("returns null when no key is stored", async () => {
        const setter = vi.fn();
        const result = await simulateGetByokApiKey(
            { encryptedApiKey: null, plaintextApiKey: null },
            setter,
        );
        expect(result).toBeNull();
        expect(setter).not.toHaveBeenCalled();
    });
});
