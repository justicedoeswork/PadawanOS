import express, { type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves the Vite build output same-origin with the gateway's own API
 * routes -- this is the whole point of the gateway existing (see
 * package.json's description). Falls back to a plain message rather
 * than crashing when `dist/` doesn't exist yet (e.g. `pnpm dev` before
 * a production build has ever been run) -- there's nothing wrong with
 * that state during development, only in an actual deployment.
 *
 * Uses a path-less `router.use` fallback rather than a `'*'` route
 * pattern: Express 5's stricter path-to-regexp rejects a bare `'*'`,
 * and a plain middleware function is exactly what a catch-all needs
 * anyway -- it only ever runs when nothing registered before it
 * (the auth routes, the ACP upgrade) already matched.
 */
export function createStaticSiteRouter(distDir: string): Router {
  const router = express.Router();
  const indexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    router.use((req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }

      res.status(503).send(
        'PadawanOS has not been built yet (dist/ is missing). Run `pnpm build` at the repo root, or use `pnpm dev` for local development.'
      );
    });

    return router;
  }

  router.use(express.static(distDir));

  // SPA fallback: any GET that isn't a static asset or an API/ACP route
  // (those are registered before this router, so they've already been
  // handled) resolves to index.html for the client-side router.
  router.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    res.sendFile(indexPath);
  });

  return router;
}
