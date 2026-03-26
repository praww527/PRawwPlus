/**
 * Canonical application URL helper.
 *
 * Priority:
 *  1. APP_URL env var — explicit production domain (e.g. https://rtc.PRaww.co.za)
 *  2. Empty string — caller must handle the missing-URL case
 *
 * Set APP_URL in your environment to the public-facing domain of the application.
 */
export function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  return "";
}

/**
 * Same as getAppUrl() but also accepts an Express request as a last-resort
 * fallback so auth/payment routes can always produce a valid absolute URL
 * (e.g. for email verification links or PayFast return URLs).
 */
export function getBaseUrl(req: { headers: Record<string, string | string[] | undefined> }): string {
  const appUrl = getAppUrl();
  if (appUrl) return appUrl;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "localhost";
  return `${proto}://${host}`;
}
