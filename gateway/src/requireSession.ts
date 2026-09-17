import type { RequestHandler } from 'express';
import { SESSION_COOKIE_NAME, parseCookies } from './cookies.js';
import { verifySessionToken } from './session.js';

/**
 * Express middleware form of the same check the ACP WebSocket upgrade
 * already performs by hand (see acpProxy.ts): the request must carry a
 * valid, unexpired justiceos_session cookie. It exists so an HTTP API
 * route can be protected by exactly the login the browser already
 * went through — the browser never holds an upstream credential, it
 * holds this HttpOnly cookie, and the gateway is what turns that into
 * an authenticated upstream call.
 *
 * Errors use the structured shape the /api/marketing namespace uses
 * throughout (see marketingRoutes.ts), and say nothing about why the
 * credential failed.
 */
export function createRequireSession(sessionSecret: string | null): RequestHandler {
  return (req, res, next) => {
    if (!sessionSecret) {
      res.status(503).json({
        error: {
          code: 'GATEWAY_SESSION_NOT_CONFIGURED',
          message: 'This gateway has no session secret configured, so it cannot authenticate anyone.',
          details: {}
        }
      });
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    if (!verifySessionToken(cookies[SESSION_COOKIE_NAME], sessionSecret)) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Sign in to JusticeOS first.', details: {} }
      });
      return;
    }

    next();
  };
}
