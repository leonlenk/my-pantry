/**
 * Tests for src/utils/llmClient.ts — shared BYOK LLM client utilities.
 *
 * Covers: extractTextFromResult empty-response handling across providers,
 * error field propagation, and extractJsonObject parse-error details.
 */

import { describe, it, expect } from "vitest";
import { extractTextFromResult, extractJsonObject } from "../../apps/extension/src/utils/llmClient";

// ---------------------------------------------------------------------------
// extractTextFromResult — happy paths
// ---------------------------------------------------------------------------

describe("extractTextFromResult — happy paths", () => {
    it("returns text for openai provider", () => {
        const result = { choices: [{ message: { content: "hello" }, finish_reason: "stop" }] };
        expect(extractTextFromResult(result, "openai")).toBe("hello");
    });

    it("returns text for openrouter provider", () => {
        const result = { choices: [{ message: { content: "world" }, finish_reason: "stop" }] };
        expect(extractTextFromResult(result, "openrouter")).toBe("world");
    });

    it("returns text for google provider", () => {
        const result = { candidates: [{ content: { parts: [{ text: "gemini response" }] }, finishReason: "STOP" }] };
        expect(extractTextFromResult(result, "google")).toBe("gemini response");
    });

    it("returns text for anthropic provider (default)", () => {
        const result = { content: [{ text: "claude response" }], stop_reason: "end_turn" };
        expect(extractTextFromResult(result, "anthropic")).toBe("claude response");
    });
});

// ---------------------------------------------------------------------------
// extractTextFromResult — result.error field
// ---------------------------------------------------------------------------

describe("extractTextFromResult — result.error propagation", () => {
    it("throws with message when result.error has a message field", () => {
        const result = { error: { message: "Invalid API key", code: 401 } };
        expect(() => extractTextFromResult(result, "openai")).toThrow("Invalid API key");
    });

    it("throws with JSON when result.error has no message field", () => {
        const result = { error: { code: 500 } };
        expect(() => extractTextFromResult(result, "openai")).toThrow("LLM API Error:");
    });
});

// ---------------------------------------------------------------------------
// extractTextFromResult — empty response (safety blocks / finish_reason)
// ---------------------------------------------------------------------------

describe("extractTextFromResult — empty response throws", () => {
    it("throws for openai with finish_reason in message", () => {
        const result = { choices: [{ message: { content: null }, finish_reason: "content_filter" }] };
        expect(() => extractTextFromResult(result, "openai"))
            .toThrow("finish_reason: content_filter");
    });

    it("throws for openrouter with finish_reason in message", () => {
        const result = { choices: [{ message: { content: "" }, finish_reason: "length" }] };
        expect(() => extractTextFromResult(result, "openrouter"))
            .toThrow("finish_reason: length");
    });

    it("throws for openai without finish_reason (graceful fallback)", () => {
        const result = { choices: [{ message: { content: undefined } }] };
        expect(() => extractTextFromResult(result, "openai"))
            .toThrow("LLM returned an empty response");
    });

    it("throws for google with finishReason in message (safety block)", () => {
        const result = { candidates: [{ content: null, finishReason: "SAFETY" }] };
        expect(() => extractTextFromResult(result, "google"))
            .toThrow("finish_reason: SAFETY");
    });

    it("throws for google mentioning safety filters when no finishReason", () => {
        const result = { candidates: [{ content: { parts: [{ text: "" }] } }] };
        expect(() => extractTextFromResult(result, "google"))
            .toThrow("safety filters");
    });

    it("throws for google when candidates is empty", () => {
        const result = { candidates: [] };
        expect(() => extractTextFromResult(result, "google"))
            .toThrow("LLM returned an empty response");
    });

    it("throws for anthropic with stop_reason in message", () => {
        const result = { content: [{ text: "" }], stop_reason: "max_tokens" };
        expect(() => extractTextFromResult(result, "anthropic"))
            .toThrow("stop_reason: max_tokens");
    });

    it("throws for anthropic when content array is empty", () => {
        const result = { content: [], stop_reason: "end_turn" };
        expect(() => extractTextFromResult(result, "anthropic"))
            .toThrow("LLM returned an empty response");
    });
});

// ---------------------------------------------------------------------------
// extractJsonObject — parse error detail preservation
// ---------------------------------------------------------------------------

describe("extractJsonObject — error detail", () => {
    it("throws with length info when JSON is syntactically invalid", () => {
        const badJson = '{"key": "value", broken}';
        expect(() => extractJsonObject(badJson)).toThrow(/length \d+/);
    });

    it("throws 'No JSON object found' when input has no braces", () => {
        expect(() => extractJsonObject("plain text")).toThrow("No JSON object found");
    });

    it("returns parsed object for valid JSON", () => {
        const result = extractJsonObject('prefix {"title": "Pancakes"} suffix');
        expect(result).toEqual({ title: "Pancakes" });
    });

    it("includes the parse error message in the thrown error", () => {
        const badJson = '{"a": undefined}'; // undefined is not valid JSON
        expect(() => extractJsonObject(badJson)).toThrow("Error:");
    });
});
