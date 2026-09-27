import { Router, type Response } from 'express';
import { createRequireSession } from './requireSession.js';
import { createManagerApiClient, type ManagerApiClient, type ManagerApiResult } from './managerApiClient.js';

const PREFIX = '/api/manager';

export interface ManagerRoutesOptions {
  sessionSecret: string | null;
  baseUrl: string | null;
  serviceKey: string | null;
  userId: string | null;
  timeoutMs?: number;
  client?: ManagerApiClient;
}

function sendResult(res: Response, result: ManagerApiResult): void {
  if (result.kind === 'unavailable') {
    res.status(502).json({
      error: {
        code: 'MANAGER_BACKEND_UNAVAILABLE',
        message: 'Padawan memory is temporarily unavailable. The current chat can continue without persistence.',
        details: { reason: result.reason }
      }
    });
    return;
  }
  res.status(result.status).json(result.body);
}

function notConfigured(res: Response): void {
  res.status(503).json({
    error: {
      code: 'MANAGER_BACKEND_NOT_CONFIGURED',
      message: 'Padawan persistent manager storage is not configured on this gateway.',
      details: {}
    }
  });
}

export function createManagerRouter(options: ManagerRoutesOptions): Router {
  const router = Router();
  const requireSession = createRequireSession(options.sessionSecret);
  const client =
    options.client ??
    (options.baseUrl && options.serviceKey
      ? createManagerApiClient({
          baseUrl: options.baseUrl,
          serviceKey: options.serviceKey,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
        })
      : null);

  router.use(PREFIX, requireSession);

  router.get(`${PREFIX}/status`, async (_req, res) => {
    if (!client) {
      res.status(200).json({ configured: false, reachability: 'NOT_CONFIGURED' });
      return;
    }
    const result = await client.request('GET', '/health');
    res.status(200).json({
      configured: true,
      reachability: result.kind === 'response' && result.status >= 200 && result.status < 300 ? 'REACHABLE' : 'UNREACHABLE'
    });
  });

  router.post(`${PREFIX}/conversations/open`, async (_req, res) => {
    if (!client || !options.userId) {
      notConfigured(res);
      return;
    }
    sendResult(res, await client.request('POST', '/conversations/open', { userId: options.userId, title: 'Padawan' }));
  });

  router.get(`${PREFIX}/conversations/:id/turns`, async (req, res) => {
    if (!client) {
      notConfigured(res);
      return;
    }
    const id = encodeURIComponent(String(req.params.id ?? ''));
    sendResult(res, await client.request('GET', `/conversations/${id}/turns`));
  });

  router.post(`${PREFIX}/conversations/:id/turns`, async (req, res) => {
    if (!client) {
      notConfigured(res);
      return;
    }
    const id = encodeURIComponent(String(req.params.id ?? ''));
    const role = req.body?.role;
    const content = req.body?.content;
    const intent = req.body?.intent;
    const sourceRefs = req.body?.sourceRefs;
    if (!['user', 'manager', 'system'].includes(role) || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid manager turn.', details: {} } });
      return;
    }
    sendResult(
      res,
      await client.request('POST', `/conversations/${id}/turns`, {
        role,
        content,
        intent: intent ?? null,
        sourceRefs: Array.isArray(sourceRefs) ? sourceRefs : []
      })
    );
  });

  router.get(`${PREFIX}/events/pending`, async (_req, res) => {
    if (!client || !options.userId) {
      notConfigured(res);
      return;
    }
    sendResult(res, await client.request('GET', `/events/pending?userId=${encodeURIComponent(options.userId)}`));
  });

  router.post(`${PREFIX}/events/:id/surface`, async (req, res) => {
    if (!client || !options.userId) {
      notConfigured(res);
      return;
    }
    const id = encodeURIComponent(String(req.params.id ?? ''));
    sendResult(res, await client.request('POST', `/events/${id}/surface`, { userId: options.userId }));
  });

  router.use(PREFIX, (_req, res) => {
    res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'No such Padawan manager route.', details: {} } });
  });

  return router;
}
