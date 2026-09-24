/**
 * The browser's channel to the Justice Manager's marketing bridge: same-origin calls to
 * the JusticeOS gateway, carrying the HttpOnly session cookie and nothing
 * else. Same contract and conventions as `src/marketing/client.ts` — a
 * discriminated-union result rather than a thrown error for an ordinary
 * failure.
 *
 * The one thing worth pointing at: `decide()` always sends
 * `confirmed: true`, and it is only ever called from a deliberate
 * approve/reject/revise control. The gateway refuses a decision without that
 * flag, so a page that navigated, re-rendered, or asked a follow-up question
 * cannot record one.
 */
import type {
  MarketingEventsResponse,
  MarketingHealthView,
  ManagerAskResponse,
  ManagerDecisionResponse,
  RegisteredAgentView
} from './types';

const BASE_PATH = '/api/marketing/agent';

/**
 * Codes the panel reacts to specifically. The two contract codes are the
 * reason this list exists at all: they mean "JusticeOS and the Marketing
 * Agent disagree about the contract", which is an integration problem to
 * report rather than anything about marketing.
 */
export type ManagerBridgeErrorCode =
  | 'UNAUTHORIZED'
  | 'MARKETING_CONTRACT_UNSUPPORTED'
  | 'MARKETING_CONTRACT_INVALID'
  | 'MARKETING_AGENT_UNAVAILABLE'
  | 'MARKETING_AGENT_NOT_CONFIGURED'
  | 'MARKETING_ACTOR_NOT_CONFIGURED'
  | 'MARKETING_DECISION_NOT_CONFIRMED'
  | 'MARKETING_EVENT_NOT_FOUND'
  | 'AUTONOMY_REFUSED'
  | 'AGENT_NOT_CONFIGURED'
  | 'DEMAND_NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'ROUTE_NOT_FOUND'
  | 'INTERNAL_ERROR'
  | 'GATEWAY_UNREACHABLE';

export interface ManagerBridgeError {
  readonly code: ManagerBridgeErrorCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type ManagerBridgeResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ManagerBridgeError };

function unreachable(message: string): ManagerBridgeError {
  return { code: 'GATEWAY_UNREACHABLE', message, details: {} };
}

function parseError(status: number, body: unknown): ManagerBridgeError {
  const candidate = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (candidate && typeof candidate.code === 'string') {
    return {
      code: candidate.code as ManagerBridgeErrorCode,
      message: typeof candidate.message === 'string' ? candidate.message : '',
      details: (candidate.details ?? {}) as Record<string, unknown>
    };
  }
  if (status === 401) return { code: 'UNAUTHORIZED', message: '', details: { status } };
  if (status === 404 || status >= 500) return { code: 'GATEWAY_UNREACHABLE', message: '', details: { status } };
  return { code: 'INTERNAL_ERROR', message: '', details: { status } };
}

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<ManagerBridgeResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE_PATH}${path}`, {
      method: init.method,
      credentials: 'same-origin',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {})
    });
  } catch (error) {
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

/** One natural-language request. the gateway bridge decides which marketing operation it is; this page does not. */
export function ask(request: string, context: { conversationId?: string; taskId?: string } = {}, signal?: AbortSignal): Promise<ManagerBridgeResult<ManagerAskResponse>> {
  return call('/ask', { method: 'POST', body: { request, ...context }, ...(signal ? { signal } : {}) });
}

/**
 * Records Austin's decision. Only called from an explicit control, and always
 * with `confirmed: true` — the gateway rejects a decision without it, which is
 * what makes "approval is an action" true rather than merely intended.
 */
export function decide(
  input: { revisionId: string; decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION'; reason?: string; conversationId?: string },
  signal?: AbortSignal
): Promise<ManagerBridgeResult<ManagerDecisionResponse>> {
  return call('/decisions', { method: 'POST', body: { ...input, confirmed: true }, ...(signal ? { signal } : {}) });
}

export function getEvents(signal?: AbortSignal): Promise<ManagerBridgeResult<MarketingEventsResponse>> {
  return call('/events', { method: 'GET', ...(signal ? { signal } : {}) });
}

export function syncEvents(signal?: AbortSignal): Promise<ManagerBridgeResult<{ created: number; updated: number; handedOff: number; handoffConfigured: boolean }>> {
  return call('/events/sync', { method: 'POST', body: {}, ...(signal ? { signal } : {}) });
}

export function dismissEvent(eventId: string, signal?: AbortSignal): Promise<ManagerBridgeResult<{ retained: boolean }>> {
  return call(`/events/${encodeURIComponent(eventId)}/dismiss`, { method: 'POST', body: {}, ...(signal ? { signal } : {}) });
}

export function getMarketingHealth(signal?: AbortSignal): Promise<ManagerBridgeResult<MarketingHealthView>> {
  return call('/health', { method: 'GET', ...(signal ? { signal } : {}) });
}

/** The agent registry lives beside the bridge rather than under it. */
export async function getAgents(signal?: AbortSignal): Promise<ManagerBridgeResult<{ agents: readonly RegisteredAgentView[] }>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let res: Response;
  try {
    res = await fetch('/api/agents', { method: 'GET', credentials: 'same-origin', headers, ...(signal ? { signal } : {}) });
  } catch (error) {
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
  return { ok: true, data: body as { agents: readonly RegisteredAgentView[] } };
}
