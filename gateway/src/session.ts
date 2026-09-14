/**
 * Signs and verifies the opaque value carried inside the
 * justiceos_session cookie. Same shape as the Insurance Agent's own
 * admin-session token (HMAC-SHA256 over `expiresAt.nonce`) -- a
 * proven, simple pattern, deliberately re-derived here rather than
 * shared as code across the two repositories, and signed with its own
 * distinct secret (JUSTICEOS_SESSION_SECRET) so revoking it never
 * touches anything on the Insurance Agent side.
 */
import crypto from 'node:crypto';
import { SESSION_MAX_AGE_MS } from './cookies.js';

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function createSessionToken(secret: string): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${expiresAt}.${nonce}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [expiresAtRaw, nonce, signature] = parts;
  if (!expiresAtRaw || !nonce || !signature) return false;

  const payload = `${expiresAtRaw}.${nonce}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (!safeEqual(signature, expected)) return false;

  const expiresAt = Number(expiresAtRaw);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}
