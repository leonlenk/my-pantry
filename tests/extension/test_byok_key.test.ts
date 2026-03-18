/**
 * Tests for BYOK API key validation and the key-passing pipeline.
 *
 * Replicates the pure functions from popupController.ts and byok.ts
 * to verify that keys are stored, validated, and forwarded exactly as
 * the user entered them — with no corruption, truncation, or silent
 * fall-through to an old encrypted value.
 */

import { describe, it, expect } from "vitest";

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
