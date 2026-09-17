/**
 * The browser's only channel to the Marketing Agent: same-origin calls to
 * the JusticeOS gateway's `/api/marketing/*` bridge, following
 * `src/gateway/session.ts`'s conventions exactly — a thin module, a
 * discriminated-union result, and never a thrown error for an ordinary
 * failure.
 *
 * What this module does NOT have, deliberately: the Marketing Agent's API
 * key, its base URL, or any knowledge of how the gateway authenticates to
 * it. The browser holds the HttpOnly JusticeOS session cookie and nothing
 * else; `credentials: 'same-origin'` is what carries it (the page can't
 * read it either way). Everything server-to-server stays inside the
 * gateway package, which this bundle never imports.
 */
import type {
  MarketingApproveResult,
  MarketingCampaignReview,
  MarketingIntegrationStatus,
  MarketingQueue,
  MarketingRevisionActionResult,
} from './types';

const BASE_PATH = '/api/marketing';

/**
 * The gateway and the Marketing Agent share one error shape
 * (`{ error: { code, message, details } }`). Codes the UI reacts to
 * specifically are listed here; anything else is handled generically, so a
 * new upstream code degrades to "something went wrong", never to a crash.
 */
export type MarketingErrorCode =
  | 'UNAUTHORIZED'
  | 'REVISION_STALE'
  | 'APPROVAL_BLOCKED'
  | 'CONTEXT_CHANGED'
  | 'MEDIA_CONFLICT'
  | 'CAMPAIGN_ALREADY_FINAL'
  | 'INVALID_EDIT'
  | 'INVALID_ACTION'
  | 'INVALID_REQUEST'
  | 'CAMPAIGN_NOT_FOUND'
  | 'REVISION_NOT_FOUND'
  | 'MARKETING_AGENT_UNAVAILABLE'
  | 'MARKETING_AGENT_NOT_CONFIGURED'
  | 'MARKETING_ACTOR_NOT_CONFIGURED'
  | 'GATEWAY_SESSION_NOT_CONFIGURED'
  | 'ROUTE_NOT_FOUND'
  | 'INTERNAL_ERROR'
  /** The gateway itself could not be reached, or answered with something unparseable. */
  | 'GATEWAY_UNREACHABLE';

export interface MarketingApiError {
  readonly code: MarketingErrorCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type MarketingResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: MarketingApiError };

/** A request the caller abandoned (route change, newer request) — never surfaced as an error state. */
export class MarketingRequestAborted extends Error {
  constructor() {
    super('aborted');
    this.name = 'MarketingRequestAborted';
  }
}

function unreachable(message: string): MarketingApiError {
  return { code: 'GATEWAY_UNREACHABLE', message, details: {} };
}

/** Reads the structured error the gateway/upstream sent, falling back to a generic one for any other shape. */
function parseError(status: number, body: unknown): MarketingApiError {
  const candidate = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (candidate && typeof candidate.code === 'string') {
    return {
      code: candidate.code as MarketingErrorCode,
      message: typeof candidate.message === 'string' ? candidate.message : '',
      details: (candidate.details ?? {}) as Record<string, unknown>,
    };
  }
  // No structured body at all: the answer did not come from the bridge.
  // A 404 means the gateway has no such route (an older gateway, a
  // misrouted deploy, or a dev server with no gateway behind it), and a 5xx
  // means it could not answer — both read to an operator as "the Marketing
  // Agent isn't reachable from here", never as a campaign-level problem.
  if (status === 401) return { code: 'UNAUTHORIZED', message: '', details: { status } };
  if (status === 404 || status >= 500) return { code: 'GATEWAY_UNREACHABLE', message: '', details: { status } };
  return { code: 'INTERNAL_ERROR', message: '', details: { status } };
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string; signal?: AbortSignal },
): Promise<MarketingResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  // Forwarded by the gateway verbatim; the Marketing Agent uses it to
  // replay a retried action instead of applying it twice.
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${BASE_PATH}${path}`, {
      method: init.method,
      credentials: 'same-origin',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  } catch (error) {
    if (init.signal?.aborted) throw new MarketingRequestAborted();
    return { ok: false, error: unreachable(error instanceof Error ? error.message : 'network error') };
  }

  let body: unknown = null;
  try {
    const text = await res.text();
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    return { ok: false, error: unreachable('unparseable response') };
  }

  if (!res.ok) return { ok: false, error: parseError(res.status, body) };
  return { ok: true, data: body as T };
}

export function getMarketingStatus(signal?: AbortSignal): Promise<MarketingResult<MarketingIntegrationStatus>> {
  return call('/status', { method: 'GET', ...(signal ? { signal } : {}) });
}

export function getReviewQueue(signal?: AbortSignal): Promise<MarketingResult<MarketingQueue>> {
  return call('/campaigns/review', { method: 'GET', ...(signal ? { signal } : {}) });
}

export function getCampaignReview(campaignId: string, signal?: AbortSignal): Promise<MarketingResult<MarketingCampaignReview>> {
  return call(`/campaigns/${encodeURIComponent(campaignId)}/review`, { method: 'GET', ...(signal ? { signal } : {}) });
}

export function getRevisionReview(revisionId: string, signal?: AbortSignal): Promise<MarketingResult<MarketingCampaignReview>> {
  return call(`/revisions/${encodeURIComponent(revisionId)}/review`, { method: 'GET', ...(signal ? { signal } : {}) });
}

/**
 * Mutations. None of them carries an `actor`: the gateway derives the
 * operator identity server-side and discards anything the page sends, so
 * inventing one here would be both pointless and misleading.
 */
export function requestChanges(
  revisionId: string,
  input: { instruction: string; category?: string; platforms?: readonly string[] },
  idempotencyKey: string,
): Promise<MarketingResult<{ changeRequestId: string; campaignStatus: string }>> {
  return call(`/revisions/${encodeURIComponent(revisionId)}/request-changes`, { method: 'POST', body: input, idempotencyKey });
}

export function editChannel(
  revisionId: string,
  input: { platform: string; slot?: string; changes: Record<string, string>; reason?: string },
  idempotencyKey: string,
): Promise<MarketingResult<MarketingRevisionActionResult>> {
  return call(`/revisions/${encodeURIComponent(revisionId)}/edit-channel`, { method: 'POST', body: input, idempotencyKey });
}

export function removeChannel(
  revisionId: string,
  input: { platform: string; slot?: string; reason?: string },
  idempotencyKey: string,
): Promise<MarketingResult<MarketingRevisionActionResult>> {
  return call(`/revisions/${encodeURIComponent(revisionId)}/remove-channel`, { method: 'POST', body: input, idempotencyKey });
}

export function regenerateChannel(
  revisionId: string,
  input: { platform: string; slot?: string; reason?: string },
  idempotencyKey: string,
): Promise<MarketingResult<MarketingRevisionActionResult>> {
  return call(`/revisions/${encodeURIComponent(revisionId)}/regenerate-channel`, { method: 'POST', body: input, idempotencyKey });
}

export function approveRevision(
  revisionId: string,
  input: { notes?: string },
  idempotencyKey: string,
): Promise<MarketingResult<MarketingApproveResult>> {
  return call(`/revisions/${encodeURIComponent(revisionId)}/approve`, { method: 'POST', body: input, idempotencyKey });
}

export function rejectCampaign(
  campaignId: string,
  input: { reason: string; revisionId?: string },
  idempotencyKey: string,
): Promise<MarketingResult<{ campaignStatus: string; releasedMediaAssetIds: readonly string[] }>> {
  return call(`/campaigns/${encodeURIComponent(campaignId)}/reject`, { method: 'POST', body: input, idempotencyKey });
}

export function cancelCampaign(
  campaignId: string,
  input: { reason: string; revisionId?: string },
  idempotencyKey: string,
): Promise<MarketingResult<{ campaignStatus: string; releasedMediaAssetIds: readonly string[] }>> {
  return call(`/campaigns/${encodeURIComponent(campaignId)}/cancel`, { method: 'POST', body: input, idempotencyKey });
}
