/**
 * The gateway's server-to-server client for the Marketing Agent's REST
 * API. This is the ONLY place MARKETING_AGENT_API_KEY is ever read into
 * a request, exactly as acpProxy.ts is the only place the ACP service
 * key is -- and like that one, it lives in this package, which the Vite
 * frontend build graph never reaches.
 *
 * It is deliberately a transport, not a second implementation of the
 * Marketing Agent's rules: it attaches the credential, bounds the wait,
 * and hands back the upstream's own status and JSON body untouched.
 * Every campaign rule (approval gates, revision staleness, media
 * ownership, redaction of internal-only facts) stays where it already
 * lives -- in the Marketing Agent.
 *
 * The key is never logged, never returned, and never included in an
 * error: log lines carry the redacted URL, the method, the status, and
 * a duration, nothing else.
 */
import { logError, logInfo, redactedUrl } from './log.js';

/** Default ceiling for one upstream call. Matches acpProxy's UPSTREAM_HANDSHAKE_TIMEOUT_MS -- one bounded wait, never an open-ended one. */
export const DEFAULT_MARKETING_TIMEOUT_MS = 10_000;

/** Health/status probes must not hold a page open: they answer fast or count as unreachable. */
export const MARKETING_HEALTH_TIMEOUT_MS = 3_000;

export interface MarketingAgentClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** Injectable purely for tests; production always uses global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface MarketingAgentRequest {
  readonly method: 'GET' | 'POST';
  /** Path under the Marketing Agent's own /api/marketing prefix, already URL-encoded, e.g. "/revisions/abc/approve". */
  readonly path: string;
  /** Raw query string without the leading "?", forwarded as-is. */
  readonly query?: string;
  readonly body?: unknown;
  /** Forwarded verbatim when the caller supplied one. The gateway never invents one — see docs/marketing-agent-integration.md. */
  readonly idempotencyKey?: string;
  /**
   * Extra request headers, for correlation only (the `X-JusticeOS-*` family —
   * see marketing/requestIdentity.ts). Never a credential: `authorization` is
   * set by this module and a caller cannot override it, which is enforced
   * below rather than merely documented.
   */
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/**
 * Either the upstream answered (whatever its status — a 409
 * REVISION_STALE is a perfectly good answer that must reach the
 * browser unchanged), or it did not answer usefully at all, which is
 * the gateway's own problem to report.
 */
export type MarketingAgentResult =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'unavailable'; readonly reason: 'timeout' | 'network' | 'malformed-response' };

export interface MarketingAgentClient {
  request(input: MarketingAgentRequest): Promise<MarketingAgentResult>;
  /** Cheap reachability probe against the Marketing Agent's own liveness endpoint. */
  probe(): Promise<'REACHABLE' | 'UNREACHABLE'>;
}

function joinUrl(baseUrl: string, path: string, query?: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}${query ? `?${query}` : ''}`;
}

export function createMarketingAgentClient(options: MarketingAgentClientOptions): MarketingAgentClient {
  const doFetch = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_MARKETING_TIMEOUT_MS;

  async function call(input: MarketingAgentRequest): Promise<MarketingAgentResult> {
    const url = joinUrl(options.baseUrl, input.path, input.query);
    const startedAt = Date.now();
    const headers: Record<string, string> = {};
    // Correlation headers first, so the credential below cannot be
    // overwritten by one of them however this is ever called.
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      const lower = name.toLowerCase();
      if (lower === 'authorization' || lower === 'cookie') continue;
      headers[lower] = value;
    }
    // The one place the credential is attached. Never logged, never
    // echoed into a response body.
    headers.authorization = `Bearer ${options.apiKey}`;
    headers.accept = 'application/json';
    if (input.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (input.idempotencyKey) {
      headers['idempotency-key'] = input.idempotencyKey;
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(input.timeoutMs ?? defaultTimeoutMs)
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      logError('marketing agent request failed', {
        url: redactedUrl(url),
        method: input.method,
        reason: timedOut ? 'timeout' : 'network',
        durationMs: Date.now() - startedAt
      });
      return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
    }

    let body: unknown;
    try {
      const text = await response.text();
      body = text.length === 0 ? null : JSON.parse(text);
    } catch {
      // A non-JSON answer means something other than the Marketing
      // Agent replied (a proxy error page, a wrong base URL). Passing
      // that through would leak whatever it contains, so it is treated
      // as an outage instead.
      logError('marketing agent returned a non-JSON response', {
        url: redactedUrl(url),
        method: input.method,
        status: response.status
      });
      return { kind: 'unavailable', reason: 'malformed-response' };
    }

    logInfo('marketing agent request', {
      url: redactedUrl(url),
      method: input.method,
      status: response.status,
      durationMs: Date.now() - startedAt
    });

    return { kind: 'response', status: response.status, body };
  }

  return {
    request: call,
    async probe() {
      const result = await call({ method: 'GET', path: '/api/marketing/health', timeoutMs: MARKETING_HEALTH_TIMEOUT_MS });
      return result.kind === 'response' && result.status >= 200 && result.status < 300 ? 'REACHABLE' : 'UNREACHABLE';
    }
  };
}
