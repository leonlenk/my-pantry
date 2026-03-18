/**
 * Offscreen document lifecycle management.
 *
 * The offscreen document runs Transformers.js (WebGPU) for embedding computation
 * and cannot use Chrome APIs directly. It must be created before sending it messages.
 */

declare const chrome: any;

let creating: Promise<void> | null = null;

export async function setupOffscreenDocument(): Promise<void> {
    const offscreenUrl = chrome.runtime.getURL("offscreen.html");

    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [offscreenUrl],
    });

    if (existingContexts.length > 0) return;

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: [chrome.offscreen.Reason.DOM_PARSER],
            justification: "Run Transformers.js without service worker timeout limits",
        });
        await creating;
        creating = null;
    }
}
