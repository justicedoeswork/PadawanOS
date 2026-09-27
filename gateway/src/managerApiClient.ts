import { logError, logInfo, redactedUrl } from './log.js';

export const DEFAULT_MANAGER_TIMEOUT_MS = 10_000;

export type ManagerApiResult =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'unavailable'; readonly reason: 'timeout' | 'network' | 'malformed-response' };

export interface ManagerApiClient {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ManagerApiResult>;
}

export function createManagerApiClient(options: {
  baseUrl: string;
  serviceKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ManagerApiClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MANAGER_TIMEOUT_MS;

  return {
    async request(method, path, body) {
      const base = options.baseUrl.replace(/\/+$/, '');
      const suffix = path.startsWith('/') ? path : `/${path}`;
      const url = `${base}${suffix}`;
      const startedAt = Date.now();

      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers: {
            authorization: `Bearer ${options.serviceKey}`,
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        logError('manager api request failed', {
          url: redactedUrl(url),
          method,
          reason: timedOut ? 'timeout' : 'network',
          durationMs: Date.now() - startedAt
        });
        return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
      }

      let parsed: unknown;
      try {
        const text = await response.text();
        parsed = text.length ? JSON.parse(text) : null;
      } catch {
        logError('manager api returned non-JSON', {
          url: redactedUrl(url),
          method,
          status: response.status
        });
        return { kind: 'unavailable', reason: 'malformed-response' };
      }

      logInfo('manager api request', {
        url: redactedUrl(url),
        method,
        status: response.status,
        durationMs: Date.now() - startedAt
      });

      return { kind: 'response', status: response.status, body: parsed };
    }
  };
}
