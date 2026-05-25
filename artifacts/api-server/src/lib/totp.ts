/**
 * TOTP (Time-based One-Time Password) — Phase 4
 *
 * Provides 2FA using RFC 6238 TOTP compatible with Google Authenticator,
 * Authy, and any TOTP-compliant app.
 *
 * Uses a pure implementation to avoid runtime package dependencies in
 * environments where otplib may not be installed.
 */

import crypto from "crypto";

const APP_NAME = process.env.APP_NAME ?? "PRaww+";
const TOTP_PERIOD  = 30;
const TOTP_DIGITS  = 6;
const TOTP_WINDOW  = 1; // ±1 period tolerance

/** Generate a cryptographically secure random Base32 secret. */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/** Generate a otpauth:// URL for QR code display. */
export function generateOtpAuthUrl(secret: string, email: string): string {
  const label    = encodeURIComponent(`${APP_NAME}:${email}`);
  const issuer   = encodeURIComponent(APP_NAME);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

/** Verify a TOTP token against the secret, allowing ±WINDOW periods. */
export function verifyTotp(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  const cleaned = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;

  const counter = Math.floor(Date.now() / 1000 / TOTP_PERIOD);

  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const expected = generateHotp(secret, counter + delta);
    if (timingSafeEqual(cleaned, expected)) return true;
  }

  return false;
}

/** Generate a TOTP token for a given timestamp (defaults to now). */
export function generateTotp(secret: string, atMs?: number): string {
  const counter = Math.floor((atMs ?? Date.now()) / 1000 / TOTP_PERIOD);
  return generateHotp(secret, counter);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function generateHotp(secret: string, counter: number): string {
  const key     = base32Decode(secret);
  const msg     = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c >>= 8;
  }

  const hmac  = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[19] & 0x0f;
  const code   = ((hmac[offset] & 0x7f) << 24) |
                 ((hmac[offset + 1] & 0xff) << 16) |
                 ((hmac[offset + 2] & 0xff) << 8)  |
                 (hmac[offset + 3] & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

const B32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_CHARS[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = B32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return crypto.timingSafeEqual(ba, bb);
}
