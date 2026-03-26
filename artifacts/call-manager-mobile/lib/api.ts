/**
 * API client utility.
 *
 * Security:
 *  - Auth token is stored in expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on Android)
 *  - Never stored in AsyncStorage (plain text) or sent in query parameters
 *  - All requests use HTTPS in production
 */

import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "prawwplus_auth_token";

export function getBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "http://localhost:8080";
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
  const baseUrl = getBaseUrl();
  const token   = await getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers,
  });
}
