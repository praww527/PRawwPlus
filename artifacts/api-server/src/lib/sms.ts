import { logger } from "./logger";

const BASE_URL = "https://rest.smsportal.com/v1";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getToken(): Promise<string> {
  const clientId = process.env.SMSPORTAL_Client_ID;
  const apiSecret = process.env.SMSPORTAL_API_Secret;

  if (!clientId || !apiSecret) {
    throw new Error("SMSPORTAL_Client_ID or SMSPORTAL_API_Secret is not set");
  }

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${clientId}:${apiSecret}`).toString("base64");

  const res = await fetch(`${BASE_URL}/authentication`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SMS Portal auth failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { token: string; expiresInMinutes?: number };
  cachedToken = data.token;
  const ttlMinutes = data.expiresInMinutes ?? 1440;
  tokenExpiresAt = Date.now() + (ttlMinutes - 60) * 60 * 1000;

  return cachedToken;
}

function toSmsPortalNumber(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

function isSmsPortalConfigured(): boolean {
  return !!(process.env.SMSPORTAL_Client_ID && process.env.SMSPORTAL_API_Secret);
}

export async function sendSmsOtp(phone: string, otp: string): Promise<void> {
  if (!isSmsPortalConfigured()) {
    logger.warn(
      { phone },
      "SMS Portal not configured (SMSPORTAL_Client_ID / SMSPORTAL_API_Secret missing) — OTP logged for dev only",
    );
    logger.info({ phone, otp }, "DEV OTP (no SMS sent)");
    return;
  }

  const token = await getToken();
  const destination = toSmsPortalNumber(phone);

  const body = {
    Messages: [
      {
        Content: `PRaww+ verification code: ${otp}\n\nDo not share this code. Expires in 10 minutes.`,
        Destination: destination,
      },
    ],
  };

  const res = await fetch(`${BASE_URL}/bulkmessages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`SMS Portal send failed (${res.status}): ${errBody}`);
  }

  const result = (await res.json()) as { Messages: number; Cost: number; RemainingBalance: number };
  logger.info(
    { phone: destination, messages: result.Messages, cost: result.Cost, balance: result.RemainingBalance },
    "SMS OTP sent via SMS Portal",
  );
}

export { isSmsPortalConfigured };
