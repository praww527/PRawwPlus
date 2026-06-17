/**
 * BizVoIP DID Provider Adapter
 *
 * Scaffold — ready to wire in once BizVoIP credentials and API docs are received.
 *
 * To activate:
 *   1. Add the following to your .env:
 *        BIZVOIP_API_KEY=<your_api_key>
 *        BIZVOIP_API_URL=https://api.bizvoip.co.za          (confirm with BizVoIP)
 *        BIZVOIP_SIP_TRUNK_HOST=sip.bizvoip.co.za           (confirm with BizVoIP)
 *   2. Fill in the API call bodies below — method names and field names match
 *      the BizVoIP API once you have the docs. Every method has a clear TODO.
 *   3. Call `registerProvider(new BizVoipProvider())` in didProviders/index.ts.
 */

import { logger } from "../logger";
import type { DidProvider, AvailableDid, ProvisionedDid, ReleaseResult } from "./types";

function getConfig() {
  const apiKey = process.env.BIZVOIP_API_KEY;
  const apiUrl = (process.env.BIZVOIP_API_URL ?? "").replace(/\/$/, "");
  const sipTrunkHost = process.env.BIZVOIP_SIP_TRUNK_HOST ?? "";

  if (!apiKey || !apiUrl) {
    throw new Error(
      "BizVoIP not configured. Set BIZVOIP_API_KEY and BIZVOIP_API_URL in your environment.",
    );
  }
  return { apiKey, apiUrl, sipTrunkHost };
}

async function bizvoipRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { apiKey, apiUrl } = getConfig();

  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`BizVoIP API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

export class BizVoipProvider implements DidProvider {
  readonly name = "BizVoIP";

  async searchAvailable(params: {
    countryCode: string;
    numberType?: string;
    contains?: string;
    limit?: number;
  }): Promise<AvailableDid[]> {
    logger.info({ params }, "[BizVoIP] searchAvailable");

    // TODO: Replace path and query params with actual BizVoIP API spec.
    // Example (adjust to real API):
    //   GET /numbers/available?country=ZA&type=local&contains=082&limit=20
    const qs = new URLSearchParams({
      country: params.countryCode,
      ...(params.numberType ? { type: params.numberType } : {}),
      ...(params.contains ? { contains: params.contains } : {}),
      limit: String(params.limit ?? 50),
    }).toString();

    const raw = await bizvoipRequest<{ numbers?: unknown[] }>("GET", `/numbers/available?${qs}`);

    // TODO: Map BizVoIP response fields to AvailableDid.
    // Replace the mapping below once you have sample API response:
    return (raw.numbers ?? []).map((n: any) => ({
      phoneNumber:     n.number ?? n.phoneNumber ?? n.did,
      numberType:      n.type ?? "local",
      region:          n.region ?? n.area ?? null,
      monthlyRateZar:  n.monthly_cost != null ? Number(n.monthly_cost) : null,
      upfrontCostZar:  n.setup_cost != null ? Number(n.setup_cost) : null,
      isPremium:       Boolean(n.premium),
      providerRef:     String(n.id ?? n.number ?? n.did),
    }));
  }

  async provision(params: {
    phoneNumber: string;
    providerRef: string;
    sipTrunkHost: string;
    sipTrunkPort?: number;
  }): Promise<ProvisionedDid> {
    logger.info({ params }, "[BizVoIP] provision");

    // TODO: Replace path and body with actual BizVoIP API spec.
    // Example (adjust to real API):
    //   POST /numbers/provision
    //   { "number": "+27...", "sip_host": "sip.praww.co.za", "sip_port": 5060 }
    const raw = await bizvoipRequest<{ number?: string; id?: string }>("POST", "/numbers/provision", {
      number:   params.phoneNumber,
      sip_host: params.sipTrunkHost,
      sip_port: params.sipTrunkPort ?? 5060,
    });

    return {
      phoneNumber: raw.number ?? params.phoneNumber,
      providerRef: String(raw.id ?? params.providerRef),
      sipTrunk:    params.sipTrunkHost,
    };
  }

  async release(params: {
    phoneNumber: string;
    providerRef: string;
  }): Promise<ReleaseResult> {
    logger.info({ params }, "[BizVoIP] release");

    // TODO: Replace path with actual BizVoIP API spec.
    // Example (adjust to real API):
    //   DELETE /numbers/:ref
    await bizvoipRequest<unknown>("DELETE", `/numbers/${encodeURIComponent(params.providerRef)}`);

    return { released: true, providerRef: params.providerRef };
  }

  async ping(): Promise<boolean> {
    try {
      // TODO: Replace with a lightweight BizVoIP health/account endpoint.
      // Example: GET /account/me or GET /ping
      await bizvoipRequest<unknown>("GET", "/account/me");
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[BizVoIP] ping failed");
      return false;
    }
  }
}
