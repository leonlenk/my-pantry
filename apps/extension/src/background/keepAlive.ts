/**
 * Keep-alive mechanism to prevent the service worker from going idle
 * during long-running LLM requests (which can exceed the 30s SW idle timeout).
 *
 * Callers must pair every startKeepAlive() with a stopKeepAlive() in a finally block.
 */

declare const chrome: any;

let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
let activeJobsCount = 0;

export function startKeepAlive(): void {
    activeJobsCount++;
    if (activeJobsCount === 1 && !keepAliveInterval) {
        // Ping a Chrome API every 20 seconds to reset the 30s idle timeout
        keepAliveInterval = setInterval(() => {
            if (chrome.runtime?.getPlatformInfo) {
                chrome.runtime.getPlatformInfo();
            }
        }, 20000);
    }
}

export function stopKeepAlive(): void {
    activeJobsCount = Math.max(0, activeJobsCount - 1);
    if (activeJobsCount === 0 && keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}
