/**
 * Supabase JWT authentication utilities for the background service worker.
 *
 * - isTokenExpired: checks if a JWT is expired or about to expire
 * - refreshSupabaseToken: silently refreshes the access token via the refresh token
 */

declare const chrome: any;

/**
 * Parses a JWT payload and checks if it is expired or within `bufferMinutes` of expiring.
 */
export function isTokenExpired(token: string, bufferMinutes: number = 5): boolean {
    try {
        const payloadBase64Url = token.split(".")[1];
        if (!payloadBase64Url) return true;

        const payloadBase64 = payloadBase64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            atob(payloadBase64)
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );

        const decoded = JSON.parse(jsonPayload);
        if (!decoded.exp) return true;

        const expiresAt = decoded.exp * 1000;
        const bufferMs = bufferMinutes * 60 * 1000;
        return Date.now() >= expiresAt - bufferMs;
    } catch (e) {
        console.warn("[Auth] Failed to decode JWT to check expiry", e);
        return true;
    }
}

/**
 * Attempts to silently refresh the Supabase access token using the stored refresh token.
 * Persists the new access token to chrome.storage.local on success.
 * Returns the fresh access token, or null if refresh fails.
 */
export async function refreshSupabaseToken(): Promise<string | null> {
    const stored = await chrome.storage.local.get([
        "supabaseRefreshToken",
        "supabaseToken",
        "supabaseUrl",
        "supabaseAnonKey",
    ]);

    const supabaseUrl = stored.supabaseUrl as string;
    const supabaseAnonKey = stored.supabaseAnonKey as string;
    const refreshToken = stored.supabaseRefreshToken as string | undefined;
    const currentToken = stored.supabaseToken as string | undefined;

    if (!refreshToken) {
        console.warn("[Auth] No refresh token stored — user must re-authenticate.");
        return null;
    }

    if (!supabaseUrl || supabaseUrl.includes("your-project-ref")) {
        // BYOK mode — no Supabase configured, skip refresh
        return currentToken ?? null;
    }

    if (currentToken && !isTokenExpired(currentToken)) {
        return currentToken;
    }

    console.log("[Auth] Token is missing or expiring soon. Attempting refresh...");

    if (!supabaseAnonKey) {
        throw new Error("Session expired. Please sign out and sign in again to refresh your credentials.");
    }

    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (!res.ok) {
            console.warn("[Auth] Token refresh failed:", res.status, await res.text());
            return null;
        }

        const data = await res.json();
        const newAccessToken: string = data.access_token;
        const newRefreshToken: string = data.refresh_token;

        if (newAccessToken) {
            await chrome.storage.local.set({
                supabaseToken: newAccessToken,
                supabaseRefreshToken: newRefreshToken ?? refreshToken,
            });
            console.log("[Auth] Token refreshed successfully.");
            return newAccessToken;
        }
    } catch (err) {
        console.warn("[Auth] Token refresh threw:", err);
    }

    return null;
}
