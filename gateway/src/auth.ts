import { Router } from 'express';
import type { Request, Response } from 'express';
import { createSessionToken, verifySessionToken } from './session.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieHeader,
  clearedSessionCookieHeader,
  parseCookies
} from './cookies.js';
import { verifyPassword } from './password.js';
import { isThrottled, recordFailedAttempt, recordSuccessfulLogin } from './loginThrottle.js';
import { logInfo, logWarn } from './log.js';

export interface AuthRouterOptions {
  sessionSecret: string | null;
  gatewayPassword: string | null;
  gatewayPasswordHash: string | null;
  isProduction: boolean;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();

  function requireSessionSecret(res: Response): string | null {
    if (!options.sessionSecret) {
      res.status(503).json({ error: 'Gateway is not configured (missing session secret).' });
      return null;
    }

    return options.sessionSecret;
  }

  router.post('/acp/session', async (req: Request, res: Response) => {
    const secret = requireSessionSecret(res);
    if (!secret) return;

    const ip = clientIp(req);

    if (isThrottled(ip)) {
      logWarn('login throttled', { ip });
      res.status(429).json({ error: 'Too many attempts. Try again later.' });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const ok = await verifyPassword(password, {
      plainPassword: options.gatewayPassword,
      passwordHash: options.gatewayPasswordHash
    });

    if (!ok) {
      recordFailedAttempt(ip);
      logWarn('login rejected', { ip });
      // Deliberately identical to every other rejection this route can
      // produce -- there is only one credential, so there is nothing to
      // enumerate, but the message itself still gives no hint about
      // *why* it failed (wrong password vs. no password sent).
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    recordSuccessfulLogin(ip);

    const token = createSessionToken(secret);
    res.setHeader('Set-Cookie', sessionCookieHeader(token, { secure: options.isProduction }));
    logInfo('login succeeded', { ip });
    res.json({ authenticated: true });
  });

  router.get('/acp/session', (req: Request, res: Response) => {
    const secret = requireSessionSecret(res);
    if (!secret) return;

    const cookies = parseCookies(req.headers.cookie);
    const authenticated = verifySessionToken(cookies[SESSION_COOKIE_NAME], secret);

    res.json({ authenticated });
  });

  router.post('/acp/logout', (_req: Request, res: Response) => {
    res.setHeader('Set-Cookie', clearedSessionCookieHeader({ secure: options.isProduction }));
    res.json({ loggedOut: true });
  });

  return router;
}
