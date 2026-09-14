import { Router } from 'express';

/**
 * Registered after createAuthRouter() and before the static-site
 * router: anything under /acp/ that the auth routes didn't already
 * handle -- a wrong method on a known path, or an unrecognized path
 * -- gets an API-shaped JSON error here instead of falling through to
 * the SPA fallback (which would otherwise serve index.html, or the
 * "not built yet" placeholder, for what is very obviously a broken
 * API call rather than a client-side route).
 */
export function createAcpApiFallbackRouter(): Router {
  const router = Router();

  // A request to a path this router knows about, but with a method
  // none of the real handlers registered (e.g. DELETE /acp/session):
  // reaches here specifically because Express only advances past a
  // matched path+method pair, so anything else on these two exact
  // paths is a method problem, not a routing problem.
  router.all('/acp/session', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed' });
  });

  router.all('/acp/logout', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed' });
  });

  // Everything else under /acp/ (including a plain, non-upgrade HTTP
  // request to /acp/insurance, and any unrecognized path) is a 404 --
  // JSON, never HTML.
  router.use('/acp', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return router;
}
