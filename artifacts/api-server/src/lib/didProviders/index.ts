/**
 * DID Provider Registry
 *
 * Usage:
 *   import { getActiveDidProvider } from "../lib/didProviders";
 *
 *   const provider = getActiveDidProvider();   // throws if none configured
 *   const numbers  = await provider.searchAvailable({ countryCode: "ZA" });
 *
 * BizVoIP is auto-activated when BIZVOIP_API_KEY + BIZVOIP_API_URL are set.
 */

import type { DidProvider } from "./types";
import { BizVoipProvider } from "./bizvoip";

export type { DidProvider, AvailableDid, ProvisionedDid, ReleaseResult } from "./types";

let _provider: DidProvider | null = null;

/**
 * Returns the active DID provider, or null if none is configured.
 */
export function getDidProvider(): DidProvider | null {
  if (_provider) return _provider;

  if (process.env.BIZVOIP_API_KEY && process.env.BIZVOIP_API_URL) {
    _provider = new BizVoipProvider();
    return _provider;
  }

  return null;
}

/**
 * Returns the active DID provider, throwing if none is configured.
 */
export function getActiveDidProvider(): DidProvider {
  const p = getDidProvider();
  if (!p) {
    throw new Error(
      "No DID provider configured. Set BIZVOIP_API_KEY + BIZVOIP_API_URL to enable external number provisioning.",
    );
  }
  return p;
}

/**
 * Checks whether an external DID provider is configured and active.
 */
export function hasDidProvider(): boolean {
  return getDidProvider() !== null;
}
