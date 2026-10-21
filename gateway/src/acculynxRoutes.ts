import { Router } from 'express';
import { createRequireSession } from './requireSession.js';
import { AcculynxError, createAcculynxClient } from './acculynxClient.js';

export function createAcculynxRouter(options: {
  sessionSecret: string | null; apiKey: string | null; fetchImpl?: typeof fetch;
}) {
  const router = Router();
  const prefix = '/api/acculynx';
  const client = options.apiKey ? createAcculynxClient(options.apiKey, options.fetchImpl) : null;
  router.use(prefix, (_req, res, next) => { res.setHeader('cache-control', 'private, no-store'); next(); });
  router.use(prefix, createRequireSession(options.sessionSecret));
  router.get(`${prefix}/status`, (_req, res) => {
    res.json({ configured: Boolean(client), mode: 'read-only', connectionVerified: false });
  });
  router.get([`${prefix}/jobs`, `${prefix}/jobs/:jobId/payments`], async (req, res) => {
    if (!client) { res.status(503).json({ error: { code: 'ACCULYNX_NOT_CONFIGURED' } }); return; }
    try {
      const allowed = req.params.jobId ? [] : ['recordStartIndex'];
      if (Object.keys(req.query).some(key => !allowed.includes(key))) throw new AcculynxError('INVALID_QUERY', 400);
      const rawOffset = req.query.recordStartIndex ?? '0';
      if (typeof rawOffset !== 'string' || !/^\d+$/.test(rawOffset)) throw new AcculynxError('INVALID_OFFSET', 400);
      res.json(req.params.jobId ? await client.payments(String(req.params.jobId)) : await client.jobs(Number(rawOffset)));
    } catch (error) {
      const safe = error instanceof AcculynxError ? error : new AcculynxError('ACCULYNX_UNAVAILABLE');
      res.status(safe.status).json({ error: { code: safe.code } });
    }
  });
  router.use(prefix, (_req, res) => { res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND' } }); });
  return router;
}
