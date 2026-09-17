import { describe, it, expect, afterEach } from 'vitest';
import {
  TEST_MARKETING_ACTOR,
  TEST_MARKETING_API_KEY,
  loginForTestCookie,
  startTestGateway
} from './helpers/testGateway.js';
import { startMockMarketingAgent, type MockMarketingAgent } from './helpers/mockMarketingAgent.js';

/**
 * The JusticeOS -> Marketing Agent bridge. The property every test here
 * exists to protect: the browser authenticates to JusticeOS with its
 * session cookie and never holds the Marketing Agent credential, while
 * the gateway holds that credential and never lets it back out.
 */

let cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

async function startBridge(
  overrides: Parameters<typeof startTestGateway>[0] = {}
): Promise<{ port: number; upstream: MockMarketingAgent; cookie: string }> {
  const upstream = await startMockMarketingAgent({ expectedApiKey: TEST_MARKETING_API_KEY });
  cleanups.push(upstream.close);

  const { port, close } = await startTestGateway({
    marketingAgentBaseUrl: upstream.url,
    marketingAgentApiKey: TEST_MARKETING_API_KEY,
    marketingAgentActor: TEST_MARKETING_ACTOR,
    ...overrides
  });
  cleanups.push(close);

  return { port, upstream, cookie: await loginForTestCookie(port) };
}

const READ_PATHS = [
  '/api/marketing/campaigns/review',
  '/api/marketing/campaigns/campaign-1/review',
  '/api/marketing/revisions/revision-1/review',
  '/api/marketing/status'
];

const MUTATION_PATHS = [
  '/api/marketing/revisions/revision-1/request-changes',
  '/api/marketing/revisions/revision-1/edit-channel',
  '/api/marketing/revisions/revision-1/remove-channel',
  '/api/marketing/revisions/revision-1/regenerate-channel',
  '/api/marketing/revisions/revision-1/replace-media',
  '/api/marketing/revisions/revision-1/approve',
  '/api/marketing/campaigns/campaign-1/reject',
  '/api/marketing/campaigns/campaign-1/cancel'
];

describe('/api/marketing requires a JusticeOS session', () => {
  it('rejects every route without a session cookie, and calls the Marketing Agent zero times', async () => {
    const { port, upstream } = await startBridge();

    for (const path of [...READ_PATHS, ...MUTATION_PATHS]) {
      const isMutation = MUTATION_PATHS.includes(path);
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: isMutation ? 'POST' : 'GET',
        ...(isMutation ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) } : {})
      });

      expect(res.status, path).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, path).toBe('UNAUTHORIZED');
    }

    expect(upstream.requests).toEqual([]);
  });

  it('rejects a tampered session cookie', async () => {
    const { port, upstream, cookie } = await startBridge();
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: tampered } });

    expect(res.status).toBe(401);
    expect(upstream.requests).toEqual([]);
  });

  it('accepts a real login cookie on the read routes', async () => {
    const { port, upstream, cookie } = await startBridge();
    upstream.respondWith({ status: 200, body: { items: [{ campaignId: 'c1', title: 'Otis St — Project Highlights' }], totalAwaitingReview: 1 } });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review?limit=5&status=DRAFT`, {
      headers: { Cookie: cookie }
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ campaignId: 'c1', title: 'Otis St — Project Highlights' }], totalAwaitingReview: 1 });
    // Path and query are forwarded onto the Marketing Agent's own prefix.
    expect(upstream.requests[0]?.url).toBe('/api/marketing/campaigns/review?limit=5&status=DRAFT');
  });
});

describe('the Marketing Agent credential stays on the server', () => {
  it('attaches the API key upstream and never sends it back to the browser', async () => {
    const { port, upstream, cookie } = await startBridge();
    upstream.respondWith({ status: 200, body: { ok: true } });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });
    const rawBody = await res.text();

    expect(upstream.requests[0]?.authorization).toBe(`Bearer ${TEST_MARKETING_API_KEY}`);
    expect(rawBody).not.toContain(TEST_MARKETING_API_KEY);
    for (const [, value] of res.headers.entries()) {
      expect(value).not.toContain(TEST_MARKETING_API_KEY);
    }
  });

  it('never forwards the browser session cookie upstream', async () => {
    const { port, upstream, cookie } = await startBridge();

    await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });

    expect(upstream.requests[0]?.cookie).toBeUndefined();
  });

  it('ignores a browser-supplied Authorization header — the gateway decides the upstream credential', async () => {
    const { port, upstream, cookie } = await startBridge();

    await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, {
      headers: { Cookie: cookie, Authorization: 'Bearer attacker-supplied-key' }
    });

    expect(upstream.requests[0]?.authorization).toBe(`Bearer ${TEST_MARKETING_API_KEY}`);
  });

  it('keeps the integration error free of the credential when the upstream rejects it', async () => {
    const { port, cookie, upstream } = await startBridge({ marketingAgentApiKey: 'a-wrong-key-configured-on-this-gateway' });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });
    const rawBody = await res.text();

    // The upstream's own 401 passes through, carrying no key material.
    expect(res.status).toBe(401);
    expect(rawBody).not.toContain('a-wrong-key-configured-on-this-gateway');
    expect(upstream.requests[0]?.authorization).toBe('Bearer a-wrong-key-configured-on-this-gateway');
  });
});

describe('mutations: server-side actor, forwarded body, forwarded idempotency key', () => {
  it('forwards the body and replaces any browser-supplied actor with the gateway\'s own', async () => {
    const { port, upstream, cookie } = await startBridge();
    upstream.respondWith({ status: 200, body: { action: 'REQUEST_CHANGES', changeRequestId: 'cr-1' } });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/request-changes`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'someone-else', instruction: 'Make the Facebook copy shorter.', category: 'COPY_LENGTH' })
    });

    expect(res.status).toBe(200);
    expect(upstream.requests[0]?.url).toBe('/api/marketing/revisions/revision-1/request-changes');
    expect(upstream.requests[0]?.body).toEqual({
      instruction: 'Make the Facebook copy shorter.',
      category: 'COPY_LENGTH',
      actor: TEST_MARKETING_ACTOR
    });
  });

  it('forwards a structured edit body unchanged apart from the actor', async () => {
    const { port, upstream, cookie } = await startBridge();

    await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/edit-channel`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'FACEBOOK', changes: { postCopy: 'Tighter copy.' }, reason: 'too long' })
    });

    expect(upstream.requests[0]?.body).toEqual({
      platform: 'FACEBOOK',
      changes: { postCopy: 'Tighter copy.' },
      reason: 'too long',
      actor: TEST_MARKETING_ACTOR
    });
  });

  it('forwards Idempotency-Key verbatim, and sends none when the browser sent none', async () => {
    const { port, upstream, cookie } = await startBridge();

    await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/approve`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'ui-click-9f3a' },
      body: JSON.stringify({})
    });
    await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/approve`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(upstream.requests[0]?.idempotencyKey).toBe('ui-click-9f3a');
    expect(upstream.requests[1]?.idempotencyKey).toBeUndefined();
  });

  it('refuses mutations when no operator identity is configured, without calling upstream', async () => {
    const { port, upstream, cookie } = await startBridge({ marketingAgentActor: null, allowedUserId: null });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/approve`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('MARKETING_ACTOR_NOT_CONFIGURED');
    expect(upstream.requests).toEqual([]);
  });

  it('approval is one upstream call and nothing else — this gateway publishes nothing', async () => {
    const { port, upstream, cookie } = await startBridge();
    upstream.respondWith({
      status: 200,
      body: {
        status: 'APPROVED_READY_FOR_PUBLICATION_DISPATCH',
        revisionId: 'revision-1',
        livePublishing: { enabled: false, publicationJobsCreated: 0 }
      }
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/approve`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Looks right.' })
    });

    expect(await res.json()).toMatchObject({
      status: 'APPROVED_READY_FOR_PUBLICATION_DISPATCH',
      livePublishing: { enabled: false, publicationJobsCreated: 0 }
    });
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.method).toBe('POST');
    expect(upstream.requests[0]?.url).toBe('/api/marketing/revisions/revision-1/approve');
  });
});

describe('error contract', () => {
  it('passes the Marketing Agent\'s own structured errors through unchanged', async () => {
    const { port, upstream, cookie } = await startBridge();

    for (const [status, code] of [
      [409, 'REVISION_STALE'],
      [409, 'APPROVAL_BLOCKED'],
      [409, 'CONTEXT_CHANGED'],
      [409, 'MEDIA_CONFLICT'],
      [409, 'CAMPAIGN_ALREADY_FINAL'],
      [422, 'INVALID_EDIT']
    ] as const) {
      upstream.respondWith({ status, body: { error: { code, message: 'Upstream said so.', details: { blockers: ['a blocker'] } } } });

      const res = await fetch(`http://127.0.0.1:${port}/api/marketing/revisions/revision-1/approve`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(res.status, code).toBe(status);
      expect(await res.json()).toEqual({ error: { code, message: 'Upstream said so.', details: { blockers: ['a blocker'] } } });
    }
  });

  it('reports MARKETING_AGENT_UNAVAILABLE when the Marketing Agent cannot be reached', async () => {
    const upstream = await startMockMarketingAgent({ expectedApiKey: TEST_MARKETING_API_KEY });
    const deadUrl = upstream.url;
    await upstream.close();

    const { port, close } = await startTestGateway({
      marketingAgentBaseUrl: deadUrl,
      marketingAgentApiKey: TEST_MARKETING_API_KEY,
      marketingAgentActor: TEST_MARKETING_ACTOR
    });
    cleanups.push(close);
    const cookie = await loginForTestCookie(port);

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string; details: { reason: string } } };
    expect(body.error.code).toBe('MARKETING_AGENT_UNAVAILABLE');
    expect(body.error.message).toContain('Nothing was changed.');
    expect(body.error.details.reason).toBe('network');
  });

  it('treats a slow Marketing Agent as unavailable rather than hanging', async () => {
    const { port, upstream, cookie } = await startBridge({ marketingAgentTimeoutMs: 120 });
    upstream.respondWith({ status: 200, body: { ok: true }, delayMs: 2_000 });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('timeout');
  });

  it('never passes a non-JSON upstream body through to the browser', async () => {
    const { port, upstream, cookie } = await startBridge();
    upstream.respondWith({ status: 502, body: null, rawText: '<html><body>nginx: upstream secret-looking detail</body></html>' });

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });
    const rawBody = await res.text();

    expect(res.status).toBe(502);
    expect(rawBody).not.toContain('nginx');
    expect(JSON.parse(rawBody)).toMatchObject({ error: { code: 'MARKETING_AGENT_UNAVAILABLE', details: { reason: 'malformed-response' } } });
  });

  it('answers a JSON 404 for an unknown path under the prefix, never the SPA shell', async () => {
    const { port, cookie } = await startBridge();

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/nope`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('the integration is optional — the rest of the gateway never depends on it', () => {
  it('answers MARKETING_AGENT_NOT_CONFIGURED when no upstream is configured', async () => {
    const { port, close } = await startTestGateway({ marketingAgentBaseUrl: null, marketingAgentApiKey: null });
    cleanups.push(close);
    const cookie = await loginForTestCookie(port);

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/campaigns/review`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('MARKETING_AGENT_NOT_CONFIGURED');
    expect(body.error.message).not.toContain('Bearer');
  });

  it('still serves login and liveness with the Marketing Agent unconfigured', async () => {
    const { port, close } = await startTestGateway({ marketingAgentBaseUrl: null, marketingAgentApiKey: null });
    cleanups.push(close);

    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    await expect(loginForTestCookie(port)).resolves.toContain('justiceos_session=');
  });

  it('keeps /health minimal — the integration status lives behind the session', async () => {
    const { port } = await startBridge();

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(['status']);
  });
});

describe('integration status', () => {
  it('reports configured and reachable when the Marketing Agent answers', async () => {
    const { port, cookie } = await startBridge();

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/status`, { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      gateway: 'ok',
      marketing: { configured: true, actorConfigured: true, reachability: 'REACHABLE' },
      livePublishing: 'DISABLED'
    });
  });

  it('distinguishes unreachable from not configured', async () => {
    const bridge = await startBridge();
    bridge.upstream.setHealthy(false);

    const unreachable = await fetch(`http://127.0.0.1:${bridge.port}/api/marketing/status`, { headers: { Cookie: bridge.cookie } });
    expect(await unreachable.json()).toMatchObject({ gateway: 'ok', marketing: { configured: true, reachability: 'UNREACHABLE' } });

    const { port, close } = await startTestGateway({ marketingAgentBaseUrl: null, marketingAgentApiKey: null });
    cleanups.push(close);
    const cookie = await loginForTestCookie(port);

    const notConfigured = await fetch(`http://127.0.0.1:${port}/api/marketing/status`, { headers: { Cookie: cookie } });
    expect(await notConfigured.json()).toMatchObject({ gateway: 'ok', marketing: { configured: false, reachability: 'NOT_CONFIGURED' } });
  });

  it('never reveals the base URL or the credential', async () => {
    const { port, cookie, upstream } = await startBridge();

    const res = await fetch(`http://127.0.0.1:${port}/api/marketing/status`, { headers: { Cookie: cookie } });
    const rawBody = await res.text();

    expect(rawBody).not.toContain(TEST_MARKETING_API_KEY);
    expect(rawBody).not.toContain(upstream.url);
  });
});
