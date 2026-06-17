/**
 * BizVoIP (BizPortal) DID Provider Adapter
 *
 * Implements the DidProvider interface for South African virtual numbers
 * sourced from BizVoIP / BizPortal (https://bizportal.co.za).
 *
 * Required env vars:
 *   BIZVOIP_API_KEY      — API key from BizVoIP portal → Settings → API
 *   BIZVOIP_API_URL      — REST base URL (default: https://api.bizvoip.co.za/v1)
 *   BIZVOIP_ACCOUNT_ID   — Your BizVoIP account ID (shown in the portal dashboard)
 *   BIZVOIP_SIP_TRUNK_HOST — FreeSWITCH public hostname/IP for trunk registration
 *
 * API auth: Bearer token in Authorization header.
 * All endpoints use JSON request/response bodies.
 *
 * Note: BizVoIP does not publish a formal OpenAPI spec. The endpoint paths and
 * field names below follow standard REST conventions for South African VoIP
 * providers. Adjust paths if BizVoIP provide updated API documentation.
 */

import { logger } from "../logger";
import type { DidProvider, AvailableDid, ProvisionedDid, ReleaseResult } from "./types";

interface BizVoipConfig {
  apiKey: string;
  apiUrl: string;
  accountId: string;
  sipTrunkHost: string;
}

function getConfig(): BizVoipConfig {
  const apiKey    = process.env.BIZVOIP_API_KEY;
  const apiUrl    = (process.env.BIZVOIP_API_URL ?? "").replace(/\/$/, "");
  const accountId = process.env.BIZVOIP_ACCOUNT_ID;

  if (!apiKey) throw new Error("BIZVOIP_API_KEY is not set");
  if (!apiUrl) throw new Error("BIZVOIP_API_URL is not set");
  if (!accountId) throw new Error("BIZVOIP_ACCOUNT_ID is not set");

  return {
    apiKey,
    apiUrl,
    accountId,
    sipTrunkHost: process.env.BIZVOIP_SIP_TRUNK_HOST ?? "",
  };
}

async function bizvoipRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { apiKey, apiUrl } = getConfig();
  const url = `${apiUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`BizVoIP API ${method} ${path} → ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return {} as T;
}

export class BizVoipProvider implements DidProvider {
  readonly name = "BizVoIP";

  /**
   * Search available DIDs from the BizPortal number inventory.
   * GET /accounts/:accountId/numbers/available
   */
  async searchAvailable(params: {
    countryCode: string;
    numberType?: string;
    contains?: string;
    limit?: number;
  }): Promise<AvailableDid[]> {
    const { accountId } = getConfig();
    logger.info({ params }, "[BizVoIP] searchAvailable");

    const qs = new URLSearchParams({
      country:  params.countryCode,
      per_page: String(params.limit ?? 50),
      ...(params.numberType ? { number_type: params.numberType } : {}),
      ...(params.contains   ? { pattern:     params.contains }   : {}),
    }).toString();

    const raw = await bizvoipRequest<{ data?: unknown[] }>(
      "GET",
      `/accounts/${accountId}/numbers/available?${qs}`,
    );

    return (raw.data ?? []).map((n: any) => ({
      phoneNumber:    n.number ?? n.phone_number ?? n.did,
      numberType:     n.number_type ?? n.type ?? "local",
      region:         n.region ?? n.area_code ?? null,
      monthlyRateZar: n.monthly_rate != null ? Number(n.monthly_rate) : null,
      upfrontCostZar: n.setup_fee    != null ? Number(n.setup_fee)    : null,
      isPremium:      Boolean(n.is_premium ?? n.premium),
      providerRef:    String(n.id ?? n.reference ?? n.number ?? n.did),
    }));
  }

  /**
   * Provision (purchase) a DID from BizPortal and point it at our SIP trunk.
   * POST /accounts/:accountId/numbers
   */
  async provision(params: {
    phoneNumber: string;
    providerRef: string;
    sipTrunkHost: string;
    sipTrunkPort?: number;
  }): Promise<ProvisionedDid> {
    const { accountId } = getConfig();
    logger.info({ phoneNumber: params.phoneNumber, sipTrunkHost: params.sipTrunkHost }, "[BizVoIP] provision");

    const raw = await bizvoipRequest<{ data?: any }>("POST", `/accounts/${accountId}/numbers`, {
      number:       params.phoneNumber,
      reference:    params.providerRef,
      sip_host:     params.sipTrunkHost,
      sip_port:     params.sipTrunkPort ?? 5060,
      trunk_type:   "sip",
    });

    const data = raw.data ?? raw;
    return {
      phoneNumber: (data as any).number ?? params.phoneNumber,
      providerRef: String((data as any).id ?? (data as any).reference ?? params.providerRef),
      sipTrunk:    params.sipTrunkHost,
    };
  }

  /**
   * Update an existing DID's SIP trunk destination (re-point to our server).
   * PUT /accounts/:accountId/numbers/:ref
   */
  async updateTrunk(providerRef: string, sipTrunkHost: string, sipTrunkPort = 5060): Promise<void> {
    const { accountId } = getConfig();
    logger.info({ providerRef, sipTrunkHost }, "[BizVoIP] updateTrunk");

    await bizvoipRequest("PUT", `/accounts/${accountId}/numbers/${encodeURIComponent(providerRef)}`, {
      sip_host: sipTrunkHost,
      sip_port: sipTrunkPort,
    });
  }

  /**
   * Release a DID back to BizPortal (cancel the number).
   * DELETE /accounts/:accountId/numbers/:ref
   */
  async release(params: {
    phoneNumber: string;
    providerRef: string;
  }): Promise<ReleaseResult> {
    const { accountId } = getConfig();
    logger.info({ phoneNumber: params.phoneNumber, providerRef: params.providerRef }, "[BizVoIP] release");

    await bizvoipRequest("DELETE", `/accounts/${accountId}/numbers/${encodeURIComponent(params.providerRef)}`);

    return { released: true, providerRef: params.providerRef };
  }

  /**
   * Health check: verify credentials and account reachability.
   * GET /accounts/:accountId
   */
  async ping(): Promise<boolean> {
    try {
      const { accountId } = getConfig();
      await bizvoipRequest("GET", `/accounts/${accountId}`);
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[BizVoIP] ping failed");
      return false;
    }
  }
}
