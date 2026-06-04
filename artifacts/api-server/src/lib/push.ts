import { logger } from "./logger";
import { metrics } from "./metrics";

/**
 * sendWebPushToSubscription — sends a web push notification to a browser subscription.
 * Used by both the ESL handler and the admin panel.
 * Returns { sent: true } on success, { sent: false, error } on failure.
 * When error === "expired", the caller should remove the stored subscription.
 */
export async function sendWebPushToSubscription(
  subscription: { endpoint: string; keys: { auth: string; p256dh: string } },
  data: Record<string, string>,
  userId?: string,
): Promise<{ sent: boolean; error?: string }> {
  const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) {
    return { sent: false, error: "VAPID keys not configured" };
  }
  try {
    // web-push is a CommonJS module; under the esbuild CJS bundle `await import()`
    // returns a namespace whose API lives on `.default`. Unwrap it so
    // setVapidDetails/sendNotification are callable (not `undefined`).
    const webpushMod: any = await import("web-push");
    const webpush = webpushMod.default ?? webpushMod;
    if (typeof webpush?.setVapidDetails !== "function") {
      logger.error({ keys: Object.keys(webpushMod ?? {}) }, "[Push] web-push module shape unexpected — setVapidDetails missing");
      metrics.pushWebFailed++;
      return { sent: false, error: "web-push module shape unexpected" };
    }
    const appUrl  = process.env.APP_URL ?? "";
    const subject = appUrl
      ? `mailto:admin@${new URL(appUrl).hostname}`
      : "mailto:admin@praww.co.za";
    webpush.setVapidDetails(subject, vapidPublicKey, vapidPrivateKey);
    await webpush.sendNotification(
      subscription as Parameters<typeof webpush.sendNotification>[0],
      JSON.stringify(data),
      { TTL: 60 },
    );
    logger.info({ endpointPrefix: subscription.endpoint.slice(0, 40), userId }, "[Push] Web push sent OK");
    metrics.pushWebSent++;
    return { sent: true };
  } catch (err: any) {
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      logger.info({ endpointPrefix: subscription.endpoint.slice(0, 40), userId }, "[Push] Web push subscription expired/gone");
      metrics.pushWebFailed++;
      return { sent: false, error: "expired" };
    }
    logger.error({ err, userId }, "[Push] Web push send failed");
    metrics.pushWebFailed++;
    return { sent: false, error: err?.message ?? "Unknown web push error" };
  }
}

/**
 * sendAdminPush — sends a visible push notification from the admin panel.
 *
 * Unlike `sendFcmDataMessage` (data-only / silent), this also includes a
 * FCM `notification` block so Android/iOS displays the banner natively even
 * when the app is in background or terminated.
 *
 * Falls back to the Expo push gateway when only an Expo token is available.
 */
export async function sendAdminPush(
  fcmToken:      string | null | undefined,
  expoPushToken: string | null | undefined,
  title:         string,
  body:          string,
  data:          Record<string, string> = {},
): Promise<{ fcmSent: boolean; expoSent: boolean; error?: string }> {
  let fcmSent  = false;
  let expoSent = false;

  // Fire FCM and Expo in parallel — both are attempted whenever the token
  // exists, rather than using Expo only as a fallback.  This maximises
  // delivery reliability across Android (FCM) and iOS (Expo/APNs).
  const tasks: Promise<void>[] = [];

  if (fcmToken) {
    tasks.push((async () => {
      const projectId    = process.env.FIREBASE_PROJECT_ID;
      const clientEmail  = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey   = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (!projectId || !clientEmail || !privateKey) return;
      try {
        const now     = Math.floor(Date.now() / 1000);
        const payload = {
          iss: clientEmail, sub: clientEmail,
          aud: "https://oauth2.googleapis.com/token",
          iat: now, exp: now + 3600,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
        };
        const { createSign } = await import("node:crypto");
        const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
        const claims  = Buffer.from(JSON.stringify(payload)).toString("base64url");
        const signing = `${header}.${claims}`;
        const signer  = createSign("RSA-SHA256");
        signer.update(signing);
        const jwt = `${signing}.${signer.sign(privateKey, "base64url")}`;

        const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
          signal: AbortSignal.timeout(15_000),
        });
        const tokenData = (await tokenResp.json()) as { access_token?: string };
        const accessToken = tokenData.access_token;

        if (accessToken) {
          const fcmResp = await fetch(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                message: {
                  token: fcmToken,
                  notification: { title, body },
                  data: { ...data, title, body },
                  android: {
                    priority: "HIGH",
                    ttl: "60s",
                    notification: { channel_id: "admin", sound: "default" },
                  },
                  apns: {
                    payload: { aps: { alert: { title, body }, sound: "default" } },
                  },
                },
              }),
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (fcmResp.ok) {
            fcmSent = true;
            metrics.pushFcmSent++;
          } else {
            logger.warn({ err: await fcmResp.text() }, "[FCM] sendAdminPush FCM error");
            metrics.pushFcmFailed++;
          }
        }
      } catch (err) {
        logger.error({ err }, "[FCM] sendAdminPush threw");
      }
    })());
  }

  if (expoPushToken) {
    tasks.push((async () => {
      try {
        await sendExpoPush(expoPushToken, title, body, { ...data, title, body });
        expoSent = true;
        metrics.pushExpoSent++;
      } catch (err) {
        logger.error({ err }, "[Push] sendAdminPush Expo threw");
        metrics.pushExpoFailed++;
      }
    })());
  }

  await Promise.all(tasks);

  return { fcmSent, expoSent };
}

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
  notification?: { title: string; body: string },
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
            ...(notification ? {
              notification: { title: notification.title, body: notification.body },
            } : {}),
            android: {
              priority: "HIGH",
              ttl: "30s",
              ...(notification ? {
                notification: {
                  title: notification.title,
                  body: notification.body,
                  channel_id: "calls",
                  sound: "default",
                },
              } : {}),
            },
            apns: {
              headers: { "apns-priority": "10" },
              payload: {
                aps: {
                  "content-available": 1,
                  ...(notification ? {
                    alert: { title: notification.title, body: notification.body },
                    sound: "default",
                  } : {}),
                },
              },
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (fcmResp.ok) {
      metrics.pushFcmSent++;
    } else {
      logger.warn({ err: await fcmResp.text() }, "[FCM] FCM HTTP v1 API returned error");
      metrics.pushFcmFailed++;
    }
  } catch (err) {
    logger.error({ err }, "[FCM] Failed to send FCM data message");
    metrics.pushFcmFailed++;
  }
}
