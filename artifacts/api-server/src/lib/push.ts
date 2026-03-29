import { logger } from "./logger";

export async function sendExpoPush(
  pushToken: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> {
  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: pushToken, title, body, data, sound: "default", priority: "high" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "[Push] Expo gateway HTTP error");
      return;
    }
    const result = (await resp.json()) as { data?: { status: string; message?: string } };
    if (result?.data?.status === "error") {
      logger.warn({ result }, "[Push] Expo gateway returned error");
    }
  } catch (err) {
    logger.error({ err }, "[Push] Failed to send Expo push notification");
  }
}

export async function sendFcmDataMessage(
  fcmToken: string,
  data: Record<string, string>,
): Promise<void> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail,
      sub: clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    };

    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signing = `${header}.${claims}`;

    const { createSign } = await import("node:crypto");
    const signer = createSign("RSA-SHA256");
    signer.update(signing);
    const sig = signer.sign(privateKey, "base64url");
    const jwt = `${signing}.${sig}`;

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!tokenResp.ok) return;
    const tokenData = (await tokenResp.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) return;

    const fcmResp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            data,
            android: { priority: "HIGH", ttl: "30s" },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!fcmResp.ok) {
      logger.warn({ err: await fcmResp.text() }, "[FCM] FCM HTTP v1 API returned error");
    }
  } catch (err) {
    logger.error({ err }, "[FCM] Failed to send FCM data message");
  }
}
