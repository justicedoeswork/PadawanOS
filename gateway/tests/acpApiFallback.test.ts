import { describe, it, expect, afterEach } from 'vitest';
import { startTestGateway } from './helpers/testGateway.js';

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = null;
});

describe('/acp/* HTTP fallback', () => {
  it('returns a JSON 404 for an unrecognized /acp path, never the SPA HTML', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not found');
  });

  it('returns a JSON 404 for a plain (non-upgrade) GET to /acp/insurance', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/insurance`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('returns a JSON 405 for an unsupported method on /acp/session', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/session`, { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Method not allowed');
  });

  it('returns a JSON 405 for an unsupported method on /acp/logout', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/logout`, { method: 'GET' });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Method not allowed');
  });

  it('leaves the non-/acp static-site fallback unaffected', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    // No dist/ built in tests -- the static-site placeholder response
    // (503 plain text), never the JSON fallback meant only for /acp/*.
    const res = await fetch(`http://127.0.0.1:${port}/some/client/route`);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).not.toContain('application/json');
  });
});
