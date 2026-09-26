/**
 * Read-only server-to-server client for the Communications Agent.
 *
 * The Communications read credential lives only in the gateway process.
 * Browser callers authenticate to JusticeOS with their session cookie;
 * this client attaches COMMUNICATIONS_API_READ_KEY upstream and never
 * forwards a browser Authorization header or cookie.
 */
import { logError, logInfo, redactedUrl } from './log.js';

export const DEFAULT_COMMUNICATIONS_TIMEOUT_MS = 10_000;
export const COMMUNICATIONS_HEALTH_TIMEOUT_MS = 3_000;

export interface CommunicationsAgentClientOptions {
  readonly baseUrl: string;
  readonly readKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface CommunicationsAgentResult {
  readonly kind: 'response';
  readonly status: number;
  readonly body: unknown;
}

export type CommunicationsAgentRequestResult =
  | CommunicationsAgentResult
  | { readonly kind: 'unavailable'; readonly reason: 'timeout' | 'network' | 'malformed-response' };

export interface CommunicationsAgentClient {
  get(path: string, query?: string): Promise<CommunicationsAgentRequestResult>;
  probe(): Promise<'REACHABLE' | 'UNREACHABLE'>;
}

function joinUrl(baseUrl: string, path: string, query?: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}${query ? `?${query}` : ''}`;
}

export function createCommunicationsAgentClient(options: CommunicationsAgentClientOptions): CommunicationsAgentClient {
  const doFetch = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_COMMUNICATIONS_TIMEOUT_MS;

  async function get(path: string, query?: string, timeoutMs = defaultTimeoutMs): Promise<CommunicationsAgentRequestResult> {
    const url = joinUrl(options.baseUrl, path, query);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${options.readKey}`,
          accept: 'application/json'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      logError('communications agent request failed', {
        url: redactedUrl(url),
        method: 'GET',
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
      logError('communications agent returned a non-JSON response', {
        url: redactedUrl(url),
        method: 'GET',
        status: response.status
      });
      return { kind: 'unavailable', reason: 'malformed-response' };
    }

    logInfo('communications agent request', {
      url: redactedUrl(url),
      method: 'GET',
      status: response.status,
      durationMs: Date.now() - startedAt
    });

    return { kind: 'response', status: response.status, body };
  }

  return {
    get,
    async probe() {
      const result = await get('/readyz', undefined, COMMUNICATIONS_HEALTH_TIMEOUT_MS);
      return result.kind === 'response' && result.status >= 200 && result.status < 300 ? 'REACHABLE' : 'UNREACHABLE';
    }
  };
}
