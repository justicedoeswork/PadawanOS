import { Router, type Request, type Response } from 'express';
import { createRequireSession } from './requireSession.js';
import {
  createMarketingAgentClient,
  type MarketingAgentClient,
  type MarketingAgentResult
} from './marketingAgentClient.js';

/**
 * JusticeOS's authenticated bridge to the Marketing Agent's REST API.
 *
 * The chain is: signed-in browser --(HttpOnly justiceos_session
 * cookie)--> this gateway --(Authorization: Bearer
 * MARKETING_AGENT_API_KEY)--> Marketing Agent. The browser never sees,
 * sends, or needs the Marketing Agent credential; an unauthenticated
 * caller gets 401 here and no upstream request is made at all.
 *
 * Routes are an explicit allowlist, not a wildcard proxy: only the
 * operator-review operations JusticeOS actually needs are reachable,
 * so a future Marketing Agent endpoint is never exposed by accident.
 *
 * Campaign rules live entirely upstream. This module adds exactly
 * three things a proxy must own: the session check, the server-side
 * actor identity, and turning "the upstream did not answer" into a
 * clear gateway error. Upstream answers — including its own
 * REVISION_STALE / APPROVAL_BLOCKED / CONTEXT_CHANGED / MEDIA_CONFLICT
 * / CAMPAIGN_ALREADY_FINAL bodies — pass through untouched.
 */

/** The Marketing Agent mounts its own API under this prefix; the gateway mirrors the path after it. */
const UPSTREAM_PREFIX = '/api/marketing';

export interface MarketingRoutesOptions {
  readonly sessionSecret: string | null;
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  /**
   * Who the Marketing Agent records as the operator for every
   * mutation. JusticeOS's login is single-owner and its session token
   * carries no user identity (see session.ts), so this is configured
   * server-side rather than derived per-request — and a browser-supplied
   * `actor` is always discarded. See docs/marketing-agent-integration.md.
   */
  readonly actor: string | null;
  readonly timeoutMs?: number;
  /** Injectable for tests; production builds the real client from baseUrl/apiKey. */
  readonly client?: MarketingAgentClient;
}

function notConfigured(res: Response): void {
  res.status(503).json({
    error: {
      code: 'MARKETING_AGENT_NOT_CONFIGURED',
      message:
        'The Marketing Agent integration is not configured on this gateway (MARKETING_AGENT_BASE_URL / MARKETING_AGENT_API_KEY).',
      details: {}
    }
  });
}

function actorNotConfigured(res: Response): void {
  res.status(503).json({
    error: {
      code: 'MARKETING_ACTOR_NOT_CONFIGURED',
      message:
        'This gateway has no operator identity configured (MARKETING_AGENT_ACTOR or ACP_ALLOWED_USER_ID), so it cannot record who is acting. Reads are unaffected.',
      details: {}
    }
  });
}

function unavailable(res: Response, reason: string): void {
  res.status(502).json({
    error: {
      code: 'MARKETING_AGENT_UNAVAILABLE',
      message: 'The Marketing Agent did not answer. Nothing was changed.',
      details: { reason }
    }
  });
}

/** Passes the upstream's status and JSON body through unchanged — headers are never forwarded in either direction. */
function sendResult(res: Response, result: MarketingAgentResult): void {
  if (result.kind === 'unavailable') {
    unavailable(res, result.reason);
    return;
  }
  res.status(result.status).json(result.body);
}

function idempotencyKeyOf(req: Request): string | undefined {
  const raw = req.header('idempotency-key');
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The body sent upstream: whatever the browser sent, minus any
 * `actor` it tried to set, plus the actor this gateway knows. An
 * operator's audit identity is the gateway's to assert, never the
 * page's to claim.
 */
function bodyWithServerActor(rawBody: unknown, actor: string): Record<string, unknown> {
  const body = rawBody !== null && typeof rawBody === 'object' && !Array.isArray(rawBody) ? { ...(rawBody as Record<string, unknown>) } : {};
  delete body.actor;
  return { ...body, actor };
}

export function createMarketingRouter(options: MarketingRoutesOptions): Router {
  const router = Router();
  const requireSession = createRequireSession(options.sessionSecret);

  const client =
    options.client ??
    (options.baseUrl && options.apiKey
      ? createMarketingAgentClient({
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
        })
      : null);

  // Authentication first, for every route in this namespace including
  // the status probe: an anonymous caller must learn nothing, not even
  // whether the integration is configured.
  router.use(UPSTREAM_PREFIX, requireSession);

  /**
   * Integration status for an operator/dashboard. Deliberately separate
   * from the unauthenticated /health liveness probe, which stays
   * minimal: this one reports whether the integration is configured and
   * whether the Marketing Agent answers right now, and the gateway
   * stays healthy either way — marketing is an integration dependency,
   * never a prerequisite for ACP chat.
   */
  router.get(`${UPSTREAM_PREFIX}/status`, async (_req, res) => {
    const configured = client !== null;
    const reachability = configured ? await client.probe() : 'NOT_CONFIGURED';
    res.status(200).json({
      gateway: 'ok',
      marketing: {
        configured,
        actorConfigured: Boolean(options.actor),
        reachability,
        checkedAt: new Date().toISOString()
      },
      livePublishing: 'DISABLED'
    });
  });

  function read(path: string, relativeUpstreamPath: (req: Request) => string): void {
    router.get(path, async (req, res) => {
      if (!client) {
        notConfigured(res);
        return;
      }
      const query = typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[1] : undefined;
      sendResult(
        res,
        await client.request({
          method: 'GET',
          path: `${UPSTREAM_PREFIX}${relativeUpstreamPath(req)}`,
          ...(query ? { query } : {})
        })
      );
    });
  }

  function mutate(path: string, relativeUpstreamPath: (req: Request) => string): void {
    router.post(path, async (req, res) => {
      if (!client) {
        notConfigured(res);
        return;
      }
      if (!options.actor) {
        actorNotConfigured(res);
        return;
      }
      const idempotencyKey = idempotencyKeyOf(req);
      sendResult(
        res,
        await client.request({
          method: 'POST',
          path: `${UPSTREAM_PREFIX}${relativeUpstreamPath(req)}`,
          body: bodyWithServerActor(req.body, options.actor),
          ...(idempotencyKey ? { idempotencyKey } : {})
        })
      );
    });
  }

  const campaignId = (req: Request): string => encodeURIComponent(String(req.params.campaignId ?? ''));
  const revisionId = (req: Request): string => encodeURIComponent(String(req.params.revisionId ?? ''));

  // Reads
  read(`${UPSTREAM_PREFIX}/campaigns/review`, () => '/campaigns/review');
  read(`${UPSTREAM_PREFIX}/campaigns/:campaignId/review`, (req) => `/campaigns/${campaignId(req)}/review`);
  read(`${UPSTREAM_PREFIX}/revisions/:revisionId/review`, (req) => `/revisions/${revisionId(req)}/review`);

  // Mutations — each one is an operator action the Marketing Agent
  // audits under the actor this gateway asserts.
  for (const action of ['request-changes', 'edit-channel', 'remove-channel', 'regenerate-channel', 'replace-media', 'approve'] as const) {
    mutate(`${UPSTREAM_PREFIX}/revisions/:revisionId/${action}`, (req) => `/revisions/${revisionId(req)}/${action}`);
  }
  for (const action of ['reject', 'cancel'] as const) {
    mutate(`${UPSTREAM_PREFIX}/campaigns/:campaignId/${action}`, (req) => `/campaigns/${campaignId(req)}/${action}`);
  }

  // Anything else under the prefix is a client mistake, not a
  // client-side route: answer JSON here rather than letting the SPA
  // fallback serve index.html for a broken API call (same reasoning as
  // acpApiFallback.ts).
  router.use(UPSTREAM_PREFIX, (_req, res) => {
    res.status(404).json({
      error: { code: 'ROUTE_NOT_FOUND', message: 'No such Marketing Agent endpoint on this gateway.', details: {} }
    });
  });

  return router;
}
