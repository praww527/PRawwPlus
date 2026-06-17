/**
 * BizVoIP (BizPortal) DID Provider Adapter
 *
 * Implements the DidProvider interface for South African virtual numbers
 * sourced from BizVoIP / BizPortal (https://bizportal.co.za).
 *
 * Required env vars:
 *   BIZVOIP_API_KEY        — API key from BizVoIP portal → Settings → API
 *   BIZVOIP_API_URL        — REST base URL (default: https://api.bizvoip.co.za/v1)
 *
 * Optional env vars (auto-discovered if absent):
 *   BIZVOIP_ACCOUNT_ID     — Your BizVoIP account ID. If not set, the provider
 *                            calls the API at startup to discover it automatically.
 *   BIZVOIP_SIP_TRUNK_HOST — FreeSWITCH public hostname/IP for trunk registration
 */

import { logger } from "../logger";
import type { DidProvider, AvailableDid, ProvisionedDid, ReleaseResult } from "./types";

// ── Module-level account ID cache ─────────────────────────────────────────────
// Populated from BIZVOIP_ACCOUNT_ID env var or auto-discovered on first use.
let _cachedAccountId: string | null = null;
let _discoveryInFlight: Promise<string> | null = null;

function getBaseConfig(): { apiKey: string; apiUrl: string } {
  const apiKey = process.env.BIZVOIP_API_KEY;
  const apiUrl = (process.env.BIZVOIP_API_URL ?? "").replace(/\/$/, "");

  if (!apiKey) throw new Error("BIZVOIP_API_KEY is not set");
  if (!apiUrl) throw new Error("BIZVOIP_API_URL is not set");

  return { apiKey, apiUrl };
}

/**
 * Raw fetch helper — does NOT require account ID so it can be used during discovery.
 */
async function bizvoipFetch<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { apiKey } = getBaseConfig();

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
    throw new Error(`BizVoIP API ${method} ${url} → ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return {} as T;
}

/** Extract a usable ID string from a parsed payload, trying common field names. */
function extractId(payload: any): string | null {
  const idFields = ["account_id", "accountId", "id", "_id", "uuid", "account", "customer_id", "customerId"];
  for (const field of idFields) {
    const val = payload?.[field];
    if (val != null && (typeof val === "string" || typeof val === "number") && String(val).trim() !== "") {
      return String(val).trim();
    }
  }
  return null;
}

/**
 * Attempt to discover the account ID by probing common BizVoIP API endpoints.
 *
 * Strategy:
 *   1. Single-resource endpoints (/me, /account, /user, /profile, /customer) —
 *      parse the response directly.
 *   2. List endpoints (/accounts, /customers) — use the first item in the list.
 *   3. Other utility endpoints (/balance, /numbers) — some return account context.
 */
async function runDiscovery(): Promise<string> {
  const { apiUrl } = getBaseConfig();

  // ── Single-resource candidates ─────────────────────────────────────────────
  const singlePaths = [
    "/me",
    "/account",
    "/accounts/me",
    "/user",
    "/profile",
    "/customer",
    "/customers/me",
    "/whoami",
  ];

  for (const path of singlePaths) {
    try {
      const raw = await bizvoipFetch<any>("GET", `${apiUrl}${path}`);
      const payload = raw?.data ?? raw;
      const id = extractId(payload);
      if (id) {
        logger.info({ path, accountId: id }, "[BizVoIP] Auto-discovered account ID");
        return id;
      }
      logger.debug({ path }, "[BizVoIP] Discovery probe returned no usable ID field");
    } catch (err: any) {
      logger.debug({ path, err: err?.message }, "[BizVoIP] Discovery probe failed — trying next");
    }
  }

  // ── List-resource candidates ───────────────────────────────────────────────
  // Some providers return an array; the first element is the authenticated user's account.
  const listPaths = ["/accounts", "/customers"];

  for (const path of listPaths) {
    try {
      const raw = await bizvoipFetch<any>("GET", `${apiUrl}${path}`);
      const list: any[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.data)  ? raw.data
        : Array.isArray(raw?.items) ? raw.items
        : [];

      if (list.length > 0) {
        const id = extractId(list[0]);
        if (id) {
          logger.info({ path, accountId: id }, "[BizVoIP] Auto-discovered account ID from list");
          return id;
        }
      }
      logger.debug({ path }, "[BizVoIP] List probe returned no usable ID");
    } catch (err: any) {
      logger.debug({ path, err: err?.message }, "[BizVoIP] List probe failed — trying next");
    }
  }

  throw new Error(
    "BizVoIP account ID could not be auto-discovered. " +
    "Set BIZVOIP_ACCOUNT_ID in your environment secrets (visible in BizPortal dashboard).",
  );
}

/**
 * Returns the account ID — from env var, module cache, or auto-discovery.
 * Only one discovery call is in-flight at a time (promise deduplication).
 */
async function resolveAccountId(): Promise<string> {
  // 1. Env var takes precedence (explicit always wins)
  const envId = (process.env.BIZVOIP_ACCOUNT_ID ?? "").trim();
  if (envId) {
    _cachedAccountId = envId;
    return envId;
  }

  // 2. Already discovered this session
  if (_cachedAccountId) return _cachedAccountId;

  // 3. Discovery already in-flight — wait for it
  if (_discoveryInFlight) return _discoveryInFlight;

  // 4. Start discovery
  logger.info("[BizVoIP] BIZVOIP_ACCOUNT_ID not set — auto-discovering from API…");
  _discoveryInFlight = runDiscovery().then((id) => {
    _cachedAccountId = id;
    _discoveryInFlight = null;
    return id;
  }).catch((err) => {
    _discoveryInFlight = null;
    throw err;
  });

  return _discoveryInFlight;
}

/**
 * Standard request helper — resolves account ID first, then dispatches the request.
 */
async function bizvoipRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  pathTemplate: (accountId: string) => string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { apiUrl } = getBaseConfig();
  const accountId = await resolveAccountId();
  const url = `${apiUrl}${pathTemplate(accountId)}`;
  return bizvoipFetch<T>(method, url, body);
}

export class BizVoipProvider implements DidProvider {
  readonly name = "BizVoIP";

  /**
   * Eagerly discover and cache the account ID.
   * Call this at server startup so the first real API call isn't slowed down.
   */
  async discoverAccountId(): Promise<string> {
    return resolveAccountId();
  }

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
    logger.info({ params }, "[BizVoIP] searchAvailable");

    const qs = new URLSearchParams({
      country:  params.countryCode,
      per_page: String(params.limit ?? 50),
      ...(params.numberType ? { number_type: params.numberType } : {}),
      ...(params.contains   ? { pattern:     params.contains }   : {}),
    }).toString();

    const raw = await bizvoipRequest<{ data?: unknown[] }>(
      "GET",
      (id) => `/accounts/${id}/numbers/available?${qs}`,
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
    logger.info({ phoneNumber: params.phoneNumber, sipTrunkHost: params.sipTrunkHost }, "[BizVoIP] provision");

    const raw = await bizvoipRequest<{ data?: any }>(
      "POST",
      (id) => `/accounts/${id}/numbers`,
      {
        number:     params.phoneNumber,
        reference:  params.providerRef,
        sip_host:   params.sipTrunkHost,
        sip_port:   params.sipTrunkPort ?? 5060,
        trunk_type: "sip",
      },
    );

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
    logger.info({ providerRef, sipTrunkHost }, "[BizVoIP] updateTrunk");

    await bizvoipRequest(
      "PUT",
      (id) => `/accounts/${id}/numbers/${encodeURIComponent(providerRef)}`,
      { sip_host: sipTrunkHost, sip_port: sipTrunkPort },
    );
  }

  /**
   * Release a DID back to BizPortal (cancel the number).
   * DELETE /accounts/:accountId/numbers/:ref
   */
  async release(params: {
    phoneNumber: string;
    providerRef: string;
  }): Promise<ReleaseResult> {
    logger.info({ phoneNumber: params.phoneNumber, providerRef: params.providerRef }, "[BizVoIP] release");

    await bizvoipRequest(
      "DELETE",
      (id) => `/accounts/${id}/numbers/${encodeURIComponent(params.providerRef)}`,
    );

    return { released: true, providerRef: params.providerRef };
  }

  /**
   * Health check: verify credentials and account reachability.
   * Also triggers account ID discovery as a side-effect.
   */
  async ping(): Promise<boolean> {
    try {
      await bizvoipRequest("GET", (id) => `/accounts/${id}`);
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[BizVoIP] ping failed");
      return false;
    }
  }
}
