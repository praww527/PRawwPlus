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
 *
 * Development:
 *  - If EXPO_PUBLIC_DOMAIN is unset, uses Metro’s LAN host (expo-constants) so a physical
 *    device can reach the API on your PC. Override with EXPO_PUBLIC_DEV_API_HOST / PORT.
 */

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY       = "prawwplus_auth_token";
const REQUEST_TIMEOUT = 10_000; // 10 seconds

function devApiBaseUrl(): string {
  const port = process.env.EXPO_PUBLIC_DEV_API_PORT?.trim() || "8080";
  const explicit = process.env.EXPO_PUBLIC_DEV_API_HOST?.trim();
  if (explicit) {
    return `http://${explicit}:${port}`;
  }
  const hostUri =
    Constants.expoConfig?.hostUri
    ?? (Constants.manifest2 as { extra?: { expoClient?: { hostUri?: string } } })?.extra
      ?.expoClient?.hostUri;
  if (hostUri && typeof hostUri === "string") {
    const host = hostUri.split(":")[0] ?? "";
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:${port}`;
    }
  }
  return `http://localhost:${port}`;
}

export function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();

  if (domain) {
    return `https://${domain}`;
  }

  if (__DEV__) {
    return devApiBaseUrl();
  }

  throw new Error(
    "EXPO_PUBLIC_DOMAIN is not configured. " +
      "Set this environment variable in your production build.",
  );
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
