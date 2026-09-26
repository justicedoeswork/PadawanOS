import { afterEach, describe, expect, it } from 'vitest';
import { loginForTestCookie, startTestGateway } from './helpers/testGateway.js';
import { startMockCommunicationsAgent, type MockCommunicationsAgent } from './helpers/mockCommunicationsAgent.js';

const TEST_READ_KEY = 'test-communications-read-key-do-not-use';
let cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

async function startBridge(
  overrides: Parameters<typeof startTestGateway>[0] = {}
): Promise<{ port: number; upstream: MockCommunicationsAgent; cookie: string }> {
  const upstream = await startMockCommunicationsAgent({ expectedReadKey: TEST_READ_KEY });
  cleanups.push(upstream.close);

  const { port, close } = await startTestGateway({
    communicationsAgentBaseUrl: upstream.url,
    communicationsApiReadKey: TEST_READ_KEY,
    ...overrides
  });
  cleanups.push(close);

  return { port, upstream, cookie: await loginForTestCookie(port) };
}

const READ_PATHS = [
  '/api/communications/ledger/views/today',
  '/api/communications/ledger/views/waiting',
  '/api/communications/ledger/items',
  '/api/communications/ledger/items/00000000-0000-4000-8000-000000000001',
  '/api/communications/emails/needs-reply',
  '/api/communications/approvals/pending',
  '/api/communications/notifications',
  '/api/communications/search?q=Ryan',
  '/api/communications/status'
];

describe('Communications read bridge', () => {
  it('requires a JusticeOS session and makes no upstream call when unauthenticated', async () => {
    const { port, upstream } = await startBridge();
    const res = await fetch(`http://127.0.0.1:${port}/api/communications/ledger/views/today`);
    expect(res.status).toBe(401);
    expect(upstream.requests).toEqual([]);
  });

  it('forwards only allowlisted GET reads and preserves query strings', async () => {
    const { port, upstream, cookie } = await startBridge();
    upstream.respondWith({ status: 200, body: { data: [{ id: 'item-1' }] } });

    const res = await fetch(`http://127.0.0.1:${port}/api/communications/ledger/views/waiting?person=Ryan`, {
      headers: { Cookie: cookie }
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: 'item-1' }] });
    expect(upstream.requests.at(-1)?.method).toBe('GET');
    expect(upstream.requests.at(-1)?.url).toBe('/api/v1/ledger/views/waiting?person=Ryan');
  });

  it('attaches the read key upstream and never forwards browser credentials', async () => {
    const { port, upstream, cookie } = await startBridge();

    const res = await fetch(`http://127.0.0.1:${port}/api/communications/notifications`, {
      headers: { Cookie: cookie, Authorization: 'Bearer browser-supplied-key' }
    });
    const raw = await res.text();

    expect(upstream.requests.at(-1)?.authorization).toBe(`Bearer ${TEST_READ_KEY}`);
    expect(upstream.requests.at(-1)?.cookie).toBeUndefined();
    expect(raw).not.toContain(TEST_READ_KEY);
  });

  it('has no mutation surface under the Communications prefix', async () => {
    const { port, upstream, cookie } = await startBridge();

    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const res = await fetch(`http://127.0.0.1:${port}/api/communications/ledger/items`, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(404);
    }

    expect(upstream.requests).toEqual([]);
  });

  it('returns a JSON 404 for an unknown read route instead of the SPA', async () => {
    const { port, cookie } = await startBridge();
    const res = await fetch(`http://127.0.0.1:${port}/api/communications/nope`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('reports configured/reachable status without revealing the key or base URL', async () => {
    const { port, cookie, upstream } = await startBridge();
    const res = await fetch(`http://127.0.0.1:${port}/api/communications/status`, { headers: { Cookie: cookie } });
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(raw)).toMatchObject({
      gateway: 'ok',
      communications: { configured: true, reachability: 'REACHABLE', access: 'READ_ONLY' }
    });
    expect(raw).not.toContain(TEST_READ_KEY);
    expect(raw).not.toContain(upstream.url);
  });

  it('distinguishes not configured and unreachable without affecting gateway health', async () => {
    const { port: unconfiguredPort, close } = await startTestGateway({
      communicationsAgentBaseUrl: null,
      communicationsApiReadKey: null
    });
    cleanups.push(close);
    const unconfiguredCookie = await loginForTestCookie(unconfiguredPort);

    const status = await fetch(`http://127.0.0.1:${unconfiguredPort}/api/communications/status`, {
      headers: { Cookie: unconfiguredCookie }
    });
    expect(await status.json()).toMatchObject({
      communications: { configured: false, reachability: 'NOT_CONFIGURED', access: 'READ_ONLY' }
    });
    expect((await fetch(`http://127.0.0.1:${unconfiguredPort}/health`)).status).toBe(200);

    const bridge = await startBridge();
    bridge.upstream.setHealthy(false);
    const unreachable = await fetch(`http://127.0.0.1:${bridge.port}/api/communications/status`, {
      headers: { Cookie: bridge.cookie }
    });
    expect(await unreachable.json()).toMatchObject({
      communications: { configured: true, reachability: 'UNREACHABLE', access: 'READ_ONLY' }
    });
  });

  it('handles upstream outages and malformed bodies without leaking them', async () => {
    const bridge = await startBridge({ communicationsAgentTimeoutMs: 100 });
    bridge.upstream.respondWith({ status: 200, body: { data: [] }, delayMs: 2_000 });

    const timedOut = await fetch(`http://127.0.0.1:${bridge.port}/api/communications/notifications`, {
      headers: { Cookie: bridge.cookie }
    });
    expect(timedOut.status).toBe(502);

    bridge.upstream.respondWith({ status: 502, rawText: '<html>upstream secret detail</html>' });
    const malformed = await fetch(`http://127.0.0.1:${bridge.port}/api/communications/notifications`, {
      headers: { Cookie: bridge.cookie }
    });
    const raw = await malformed.text();
    expect(malformed.status).toBe(502);
    expect(raw).not.toContain('upstream secret detail');
  });

  it('all declared read paths are protected by the session', async () => {
    const { port, upstream } = await startBridge();
    for (const path of READ_PATHS) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(res.status, path).toBe(401);
    }
    expect(upstream.requests).toEqual([]);
  });
});
