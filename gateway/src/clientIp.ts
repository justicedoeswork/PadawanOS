import type { Request } from 'express';

/**
 * Resolves the address the login throttle keys on. Deliberately does
 * NOT enable Express's `trust proxy` / read `X-Forwarded-For` --
 * that header is set by whoever makes the request, so trusting it
 * without knowing exactly which hop last touched it lets any client
 * claim to be any IP, defeating the throttle entirely (send one
 * failed login per claimed IP, never get throttled).
 *
 * Fly.io's edge proxy sets `Fly-Client-IP` to the real inbound
 * connection's address and overwrites any client-supplied value of
 * the same name before the request ever reaches this app -- unlike
 * X-Forwarded-For, which can carry a chain of hops an app has to
 * decide how far to trust, Fly-Client-IP is a single value the edge
 * itself is asserting. This is read only when present; verify this
 * against Fly's current documented behavior before an actual
 * production deploy (this gateway has never been deployed to Fly
 * yet, so this is a documented assumption, not something exercised
 * against the real platform).
 *
 * Falls back to the raw socket peer address -- which is what
 * Express's own req.ip returns with trust proxy disabled (the
 * default, left untouched here) -- when Fly-Client-IP isn't present,
 * e.g. in local development.
 */
export function resolveClientIp(req: Request): string {
  const flyClientIp = req.headers['fly-client-ip'];

  if (typeof flyClientIp === 'string' && flyClientIp.trim()) {
    return flyClientIp.trim();
  }

  return req.socket.remoteAddress || 'unknown';
}
