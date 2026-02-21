// background.ts
// Service worker for the extension

let creating: Promise<void> | null;

async function setupOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    // Check if it already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
        return;
    }

    // Create document
    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: [chrome.offscreen.Reason.DOM_PARSER],
            justification: 'Run Transformers.js without service worker timeout limits'
        });
        await creating;
        creating = null;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GENERATE_EMBEDDING') {
        (async () => {
            try {
                await setupOffscreenDocument();

                // Forward message to offscreen document
                const embeddingResult = await chrome.runtime.sendMessage({
                    ...message,
                    target: 'offscreen'
                });

                sendResponse(embeddingResult);
            } catch (error: any) {
                console.error("Error generating embedding in background:", error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // Indicates asynchronous response
    }
});
