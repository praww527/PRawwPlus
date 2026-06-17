/**
 * DID Provider Registry
 *
 * Usage:
 *   import { getActiveDidProvider } from "../lib/didProviders";
 *
 *   const provider = getActiveDidProvider();   // throws if none configured
 *   const numbers  = await provider.searchAvailable({ countryCode: "ZA" });
 *
 * To activate BizVoIP:
 *   1. Set BIZVOIP_API_KEY + BIZVOIP_API_URL in .env
 *   2. Uncomment the BizVoipProvider lines below
 */

import type { DidProvider } from "./types";
// import { BizVoipProvider } from "./bizvoip";   // ← uncomment when credentials arrive

export type { DidProvider, AvailableDid, ProvisionedDid, ReleaseResult } from "./types";

let _provider: DidProvider | null = null;

/**
 * Returns the active DID provider, or null if none is configured.
 * Use this to gate provider-dependent code paths gracefully.
 */
export function getDidProvider(): DidProvider | null {
  if (_provider) return _provider;

  // Auto-detect from environment — add each provider here in priority order.
  if (process.env.BIZVOIP_API_KEY && process.env.BIZVOIP_API_URL) {
    // const { BizVoipProvider } = require("./bizvoip");   // dynamic import avoids top-level throw
    // _provider = new BizVoipProvider();
    // return _provider;
  }

  return null;
}

/**
 * Returns the active DID provider, throwing if none is configured.
 * Use in route handlers that require an external DID provider.
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
 * Routes use this to decide between local-pool and provider-based number search.
 */
export function hasDidProvider(): boolean {
  return getDidProvider() !== null;
}
