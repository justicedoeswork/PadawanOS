import http from 'node:http';

/**
 * A stand-in for the Marketing Agent's `/api/marketing/agent/*` surface.
 *
 * Like `mockMarketingAgent.ts`, it enforces the real contract rather than
 * echoing: a request without `Authorization: Bearer <key>` gets the same 401
 * the real service sends, so no test can pass while the gateway forgets the
 * credential. Beyond that it is programmable per route, records every request
 * (including the `X-JusticeOS-*` correlation headers and the idempotency key),
 * and counts calls — which is how the de-duplication tests prove that one
 * intent produced exactly one upstream call.
 */
export interface RecordedAgentRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly conversationId: string | undefined;
  readonly taskId: string | undefined;
  readonly requestingAgent: string | undefined;
  readonly body: unknown;
}

export interface MockAgentReply {
  readonly status: number;
  readonly body: unknown;
  /** Sent as non-JSON, for the "something other than the agent answered" case. */
  readonly rawText?: string;
  readonly delayMs?: number;
}

export interface MockAgentContract {
  readonly url: string;
  readonly requests: RecordedAgentRequest[];
  /** Routes are matched as `GET /agent/brief` — method plus the path after the agent's own /api/marketing prefix. */
  route(key: string, reply: MockAgentReply): void;
  /** Used for every request no route matched. */
  fallback(reply: MockAgentReply): void;
  countOf(key: string): number;
  close(): Promise<void>;
}

const PREFIX = '/api/marketing';

export function startMockAgentContract(options: { expectedApiKey: string }): Promise<MockAgentContract> {
  const requests: RecordedAgentRequest[] = [];
  const routes = new Map<string, MockAgentReply>();
  let fallbackReply: MockAgentReply = {
    status: 404,
    body: { error: { code: 'ROUTE_NOT_FOUND', message: 'No such endpoint on the mock agent.', details: {} } }
  };

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

      const method = req.method ?? 'GET';
      const url = req.url ?? '/';
      requests.push({
        method,
        url,
        authorization: header('authorization'),
        idempotencyKey: header('idempotency-key'),
        conversationId: header('x-justiceos-conversation-id'),
        taskId: header('x-justiceos-task-id'),
        requestingAgent: header('x-justiceos-requesting-agent'),
        body
      });

      const send = (reply: MockAgentReply): void => {
        const write = () => {
          if (reply.rawText !== undefined) {
            res.writeHead(reply.status, { 'content-type': 'text/html' });
            res.end(reply.rawText);
            return;
          }
          res.writeHead(reply.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(reply.body));
        };
        if (reply.delayMs) setTimeout(write, reply.delayMs);
        else write();
      };

      if (header('authorization') !== `Bearer ${options.expectedApiKey}`) {
        send({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'A valid Authorization: Bearer <key> credential is required.', details: {} } } });
        return;
      }

      const path = url.split('?')[0] ?? '/';
      const relative = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
      send(routes.get(`${method} ${relative}`) ?? fallbackReply);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        route(key, reply) {
          routes.set(key, reply);
        },
        fallback(reply) {
          fallbackReply = reply;
        },
        countOf(key) {
          const [method, relative] = key.split(' ');
          return requests.filter((request) => request.method === method && (request.url.split('?')[0] ?? '') === `${PREFIX}${relative}`).length;
        },
        // Idempotent: the "agent went away mid-test" cases close it
        // deliberately, and afterEach closes it again. A second close is a
        // no-op rather than a failure that would mask the real assertion.
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            if (!server.listening) {
              resolveClose();
              return;
            }
            server.closeAllConnections?.();
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          })
      });
    });
  });
}
