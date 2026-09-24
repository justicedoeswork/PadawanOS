/**
 * Who may drive the marketing event relay.
 *
 * The relay endpoint has two legitimate callers and they authenticate
 * differently, which is why this is not just `requireSession`:
 *
 *   - **Austin's browser**, signed in, holding the HttpOnly session cookie.
 *     Running a cycle by hand from the app is an ordinary operator action.
 *   - **The scheduled driver** — a platform cron with no browser and no
 *     session, presenting `JUSTICEOS_RELAY_KEY` as a bearer token. It is a
 *     machine identity for exactly one route, deliberately not the gateway
 *     password and deliberately not the Marketing Agent's credential: a leaked
 *     relay key can cause one claim→deliver→ack cycle to run early, and
 *     nothing else. It cannot log in, cannot approve anything, cannot reach
 *     the Marketing Agent directly, and cannot make this gateway spend money.
 *
 * With no relay key configured, the second door does not exist — the route
 * stays session-only rather than falling open.
 */
import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { SESSION_COOKIE_NAME, parseCookies } from '../cookies.js';
import { verifySessionToken } from '../session.js';

/** Constant-time, and length-safe: `timingSafeEqual` throws on a length mismatch, which would itself leak the length. */
export function relayKeyMatches(presented: string | null, configured: string | null): boolean {
  if (!configured || !presented) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The bearer token on the request, if it carries one. The relay key is the only credential this route accepts here. */
export function bearerTokenOf(header: string | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function createRelayAuth(sessionSecret: string | null, relayKey: string | null): RequestHandler {
  return (req, res, next) => {
    if (relayKeyMatches(bearerTokenOf(req.header('authorization')), relayKey)) {
      next();
      return;
    }

    if (!sessionSecret) {
      res.status(503).json({
        error: { code: 'GATEWAY_SESSION_NOT_CONFIGURED', message: 'This gateway has no session secret configured, so it cannot authenticate anyone.', details: {} }
      });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    if (verifySessionToken(cookies[SESSION_COOKIE_NAME], sessionSecret)) {
      next();
      return;
    }

    // One message for both doors: saying which credential was missing would
    // tell an unauthenticated caller that the other one exists.
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Sign in to JusticeOS, or present the configured relay credential.', details: {} }
    });
  };
}
