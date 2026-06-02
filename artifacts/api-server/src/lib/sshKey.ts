/**
 * Normalize an SSH private key read from an env var / secret panel into valid PEM.
 *
 * Secret stores mangle multi-line keys in several ways. This handles all of them:
 *  - literal "\n" escape sequences (single-line secret panels)
 *  - a single line where the real newlines were replaced by spaces
 *  - leading indentation on each line
 *
 * The body is always re-folded at 64 chars (standard PEM). Simply replacing
 * spaces with newlines produces ragged line lengths that some ssh2 parser
 * versions reject with "Unsupported key format".
 */
export function cleanPrivateKey(raw: string): string {
  let s = raw.trim();

  if (s.includes("\\n")) {
    s = s.replace(/\\n/g, "\n");
  }

  if (!s.includes("\n") && s.includes("-----BEGIN") && s.includes("-----END")) {
    const headerMatch = s.match(/(-----BEGIN [^-]+-----)/);
    const footerMatch = s.match(/(-----END [^-]+-----)/);
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      const contentStart = s.indexOf(header) + header.length;
      const contentEnd = s.indexOf(footer);
      const rawBody = s.slice(contentStart, contentEnd).replace(/\s+/g, "");
      const body = rawBody.match(/.{1,64}/g)?.join("\n") ?? rawBody;
      s = `${header}\n${body}\n${footer}`;
    }
  }

  return s
    .split("\n")
    .map((l) => l.trimStart())
    .join("\n")
    .trim();
}
