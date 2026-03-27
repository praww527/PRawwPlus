/**
 * API client utility.
 *
 * Security:
 *  - Auth token is stored in expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on Android)
 *  - Never stored in AsyncStorage (plain text) or sent in query parameters
 *  - All requests use HTTPS in production
 *
 * Reliability:
 *  - Every request has a 10-second AbortController timeout
 *  - Production builds throw at startup if EXPO_PUBLIC_DOMAIN is not set
 */

import * as SecureStore from "expo-secure-store";

const TOKEN_KEY       = "prawwplus_auth_token";
const REQUEST_TIMEOUT = 10_000; // 10 seconds

export function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;

  if (!domain) {
    // Allow localhost fallback only during development
    if (__DEV__) return "http://localhost:8080";
    // In production, a missing domain means the app was built without environment
    // configuration. Throwing here surfaces the misconfiguration immediately
    // rather than silently failing on every network call.
    throw new Error(
      "EXPO_PUBLIC_DOMAIN is not configured. " +
      "Set this environment variable in your production build."
    );
  }

  return `https://${domain}`;
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function apiRequest(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const baseUrl  = getBaseUrl();
  const token    = await getToken();
  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    return await fetch(`${baseUrl}/api${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err: any) {
    // Re-throw with a more informative message for AbortError (timeout)
    if (err?.name === "AbortError") {
      throw Object.assign(
        new Error(`Request timed out after ${REQUEST_TIMEOUT / 1000}s: ${path}`),
        { name: "TimeoutError", originalError: err },
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
