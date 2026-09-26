import { Router, type Request, type Response } from 'express';
import { createRequireSession } from './requireSession.js';
import {
  createCommunicationsAgentClient,
  type CommunicationsAgentClient,
  type CommunicationsAgentRequestResult
} from './communicationsAgentClient.js';

const GATEWAY_PREFIX = '/api/communications';
const UPSTREAM_PREFIX = '/api/v1';

export interface CommunicationsRoutesOptions {
  readonly sessionSecret: string | null;
  readonly baseUrl: string | null;
  readonly readKey: string | null;
  readonly timeoutMs?: number;
  readonly client?: CommunicationsAgentClient;
}

function notConfigured(res: Response): void {
  res.status(503).json({
    error: {
      code: 'COMMUNICATIONS_AGENT_NOT_CONFIGURED',
      message:
        'The Communications Agent read integration is not configured on this gateway (COMMUNICATIONS_AGENT_BASE_URL / COMMUNICATIONS_API_READ_KEY).',
      details: {}
    }
  });
}

function unavailable(res: Response, reason: string): void {
  res.status(502).json({
    error: {
      code: 'COMMUNICATIONS_AGENT_UNAVAILABLE',
      message: 'The Communications Agent did not answer. Nothing was changed.',
      details: { reason }
    }
  });
}

function sendResult(res: Response, result: CommunicationsAgentRequestResult): void {
  if (result.kind === 'unavailable') {
    unavailable(res, result.reason);
    return;
  }
  res.status(result.status).json(result.body);
}

function queryOf(req: Request): string | undefined {
  return typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[1] : undefined;
}

/**
 * Authenticated, read-only JusticeOS bridge to the Communications Agent.
 *
 * There are intentionally no POST/PATCH/DELETE routes here and no write,
 * approval, or send credential exists in this integration. The allowlist
 * exposes only Padawan's structured operational queries.
 */
export function createCommunicationsRouter(options: CommunicationsRoutesOptions): Router {
  const router = Router();
  const requireSession = createRequireSession(options.sessionSecret);
  const client =
    options.client ??
    (options.baseUrl && options.readKey
      ? createCommunicationsAgentClient({
          baseUrl: options.baseUrl,
          readKey: options.readKey,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
        })
      : null);

  router.use(GATEWAY_PREFIX, requireSession);

  router.get(`${GATEWAY_PREFIX}/status`, async (_req, res) => {
    const configured = client !== null;
    const reachability = configured ? await client.probe() : 'NOT_CONFIGURED';
    res.status(200).json({
      gateway: 'ok',
      communications: {
        configured,
        reachability,
        access: 'READ_ONLY',
        checkedAt: new Date().toISOString()
      }
    });
  });

  function read(path: string, upstreamPath: (req: Request) => string): void {
    router.get(path, async (req, res) => {
      if (!client) {
        notConfigured(res);
        return;
      }
      sendResult(res, await client.get(upstreamPath(req), queryOf(req)));
    });
  }

  const view = (req: Request): string => encodeURIComponent(String(req.params.view ?? ''));
  const itemId = (req: Request): string => encodeURIComponent(String(req.params.id ?? ''));

  read(`${GATEWAY_PREFIX}/ledger/views/:view`, (req) => `${UPSTREAM_PREFIX}/ledger/views/${view(req)}`);
  read(`${GATEWAY_PREFIX}/ledger/items`, () => `${UPSTREAM_PREFIX}/ledger/items`);
  read(`${GATEWAY_PREFIX}/ledger/items/:id`, (req) => `${UPSTREAM_PREFIX}/ledger/items/${itemId(req)}`);
  read(`${GATEWAY_PREFIX}/emails/needs-reply`, () => `${UPSTREAM_PREFIX}/emails/needs-reply`);
  read(`${GATEWAY_PREFIX}/approvals/pending`, () => `${UPSTREAM_PREFIX}/approvals/pending`);
  read(`${GATEWAY_PREFIX}/notifications`, () => `${UPSTREAM_PREFIX}/notifications`);
  read(`${GATEWAY_PREFIX}/search`, () => `${UPSTREAM_PREFIX}/search`);

  router.use(GATEWAY_PREFIX, (_req, res) => {
    res.status(404).json({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'No such Communications Agent read endpoint on this gateway.',
        details: {}
      }
    });
  });

  return router;
}
