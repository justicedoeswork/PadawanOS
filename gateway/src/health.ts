import { Router } from 'express';

/**
 * Unauthenticated liveness probe for Fly's health checks (production
 * deployment prep). Deliberately reveals nothing: no config booleans,
 * no version string, no upstream/session state -- a caller with no
 * credential learns only "the process is up and answering HTTP,"
 * nothing about whether it's correctly configured or what it's
 * configured to talk to. Registered ahead of every other route so it
 * answers even if session/ACP config is entirely missing.
 */
export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return router;
}
