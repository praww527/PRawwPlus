// Shared caller-identity formatting so raw internal extensions (4-digit codes
// like 1001, "Ext 1001", "ext-1001") are NEVER shown to end users.
// Display rule: name → phone → generic "Unknown caller".

export function isExtension(value?: string | null): boolean {
  if (!value) return false;
  // Strip common extension prefixes ("Ext", "Ext-", "Extension ") then check
  // for a bare 4-digit internal extension code (1000–9999).
  const stripped = String(value).trim().replace(/^ext(?:ension)?[-.\s]*/i, "");
  return /^[1-9]\d{3}$/.test(stripped);
}

export function displayCaller(value?: string | null): string {
  if (!value) return "Unknown caller";
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return "Unknown caller";
  if (isExtension(trimmed)) return "Unknown caller";
  return trimmed;
}
