import http from 'node:http';

/**
 * A minimal stand-in for the Marketing Agent's REST API. Like
 * mockAcpAgent.ts, it enforces the real upstream contract rather than
 * echoing blindly: a request without `Authorization: Bearer <key>` is
 * rejected 401 exactly as the real service does, so a gateway test that
 * "passes" while forgetting the credential is impossible.
 *
 * It records every request it receives (method, path, headers that
 * matter, parsed body) so a test can assert on what the gateway
 * actually sent upstream, not merely on what came back.
 */
export interface RecordedMarketingRequest {
  readonly method: string;
  /** Full request target, including query string. */
  readonly url: string;
  readonly authorization: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly cookie: string | undefined;
  readonly body: unknown;
}

export interface MockMarketingAgentResponse {
  readonly status: number;
  readonly body: unknown;
  /** Sent as a non-JSON payload, for the "upstream answered with something that isn't the Marketing Agent" case. */
  readonly rawText?: string;
  /** Delays the reply, for timeout tests. */
  readonly delayMs?: number;
}

export interface MockMarketingAgent {
  readonly url: string;
  readonly requests: RecordedMarketingRequest[];
  /** Replies with this to every non-health request until changed. */
  respondWith(response: MockMarketingAgentResponse): void;
  /** Makes the liveness probe fail without taking the whole server down. */
  setHealthy(healthy: boolean): void;
  close(): Promise<void>;
}

export function startMockMarketingAgent(options: { expectedApiKey: string }): Promise<MockMarketingAgent> {
  const requests: RecordedMarketingRequest[] = [];
  let response: MockMarketingAgentResponse = { status: 200, body: { ok: true } };
  let healthy = true;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }

      const header = (name: string): string | undefined => {
        const value = req.headers[name];
        return Array.isArray(value) ? value.join(',') : value;
      };

      requests.push({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        authorization: header('authorization'),
        idempotencyKey: header('idempotency-key'),
        cookie: header('cookie'),
        body
      });

      const send = (status: number, payload: unknown, rawText?: string): void => {
        if (rawText !== undefined) {
          res.writeHead(status, { 'content-type': 'text/html' });
          res.end(rawText);
          return;
        }
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (header('authorization') !== `Bearer ${options.expectedApiKey}`) {
        send(401, { error: { code: 'UNAUTHORIZED', message: 'A valid Authorization: Bearer <key> credential is required.', details: {} } });
        return;
      }

      if ((req.url ?? '').startsWith('/api/marketing/health')) {
        if (!healthy) {
          send(503, { status: 'down' });
          return;
        }
        send(200, { status: 'ok', service: 'marketing-agent-api' });
        return;
      }

      const reply = () => send(response.status, response.body, response.rawText);
      if (response.delayMs) {
        setTimeout(reply, response.delayMs);
      } else {
        reply();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        respondWith(next) {
          response = next;
        },
        setHealthy(next) {
          healthy = next;
        },
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.closeAllConnections?.();
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          })
      });
    });
  });
}
