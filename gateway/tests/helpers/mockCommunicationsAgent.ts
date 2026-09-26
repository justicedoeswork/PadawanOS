import http from 'node:http';

export interface MockCommunicationsRequest {
  method: string;
  url: string;
  authorization?: string;
  cookie?: string;
}

export interface MockCommunicationsAgent {
  url: string;
  requests: MockCommunicationsRequest[];
  respondWith(response: { status: number; body?: unknown; rawText?: string; delayMs?: number }): void;
  setHealthy(healthy: boolean): void;
  close(): Promise<void>;
}

export async function startMockCommunicationsAgent(options: { expectedReadKey: string }): Promise<MockCommunicationsAgent> {
  const requests: MockCommunicationsRequest[] = [];
  let next = { status: 200, body: { data: [] } as unknown, rawText: undefined as string | undefined, delayMs: 0 };
  let healthy = true;

  const server = http.createServer(async (req, res) => {
    requests.push({
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      authorization: req.headers.authorization,
      cookie: req.headers.cookie
    });

    if (req.headers.authorization !== `Bearer ${options.expectedReadKey}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }));
      return;
    }

    if (req.url === '/readyz') {
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }));
      return;
    }

    if (next.delayMs) await new Promise((resolve) => setTimeout(resolve, next.delayMs));
    res.writeHead(next.status, { 'content-type': next.rawText !== undefined ? 'text/html' : 'application/json' });
    res.end(next.rawText !== undefined ? next.rawText : JSON.stringify(next.body ?? null));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock communications agent did not bind');

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    respondWith(response) {
      next = {
        status: response.status,
        body: response.body ?? null,
        rawText: response.rawText,
        delayMs: response.delayMs ?? 0
      };
    },
    setHealthy(value) {
      healthy = value;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
