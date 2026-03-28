/** Safe page/limit for Mongo skip/limit (avoids NaN from bad query strings). */
export function parsePageLimit(query: {
  page?: unknown;
  limit?: unknown;
}, defaults: { page: number; limit: number } = { page: 1, limit: 20 }): {
  page: number;
  limit: number;
  skip: number;
} {
  const p = parseInt(String(query.page ?? defaults.page), 10);
  const l = parseInt(String(query.limit ?? defaults.limit), 10);
  const page = Number.isFinite(p) && p >= 1 ? p : defaults.page;
  const rawLimit = Number.isFinite(l) && l >= 1 ? l : defaults.limit;
  const limit = Math.min(100, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}
