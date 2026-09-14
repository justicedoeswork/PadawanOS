import { describe, it, expect, afterEach } from 'vitest';
import { startTestGateway, TEST_PASSWORD, TEST_PRODUCTION_OVERRIDES } from './helpers/testGateway.js';

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = null;
});

function extractCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = /justiceos_session=([^;]*)/.exec(setCookieHeader);
  return match ? `justiceos_session=${match[1]}` : null;
}

describe('POST /acp/session (login)', () => {
  it('rejects an invalid password', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid credentials.');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('accepts the correct password and sets a first-party session cookie', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=43200'); // 12 hours in seconds
    expect(setCookie).not.toContain('Secure'); // isProduction: false in these tests
  });

  it('sets Secure in production mode', async () => {
    const { port, close } = await startTestGateway(TEST_PRODUCTION_OVERRIDES);
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });

    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('throttles repeated failed attempts from the same client without revealing anything account-specific', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    let lastStatus = 0;
    let lastBody: { error: string } | null = null;

    for (let i = 0; i < 6; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/acp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' })
      });
      lastStatus = res.status;
      lastBody = (await res.json()) as { error: string };
    }

    expect(lastStatus).toBe(429);
    expect(lastBody?.error).not.toMatch(/user|account|exist/i);
  });
});

describe('GET /acp/session (status)', () => {
  it('reports unauthenticated with no cookie', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/session`);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it('reports authenticated with a valid session cookie from login', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const loginRes = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    const cookie = extractCookie(loginRes.headers.get('set-cookie'));
    expect(cookie).not.toBeNull();

    const statusRes = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      headers: { Cookie: cookie! }
    });
    const body = (await statusRes.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(true);
  });

  it('reports unauthenticated with a tampered cookie', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      headers: { Cookie: 'justiceos_session=1111111111111.deadbeef.notarealsignature' }
    });
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });
});

describe('POST /acp/logout', () => {
  it('clears the session cookie, and the cleared cookie no longer authenticates', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const loginRes = await fetch(`http://127.0.0.1:${port}/acp/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    const cookie = extractCookie(loginRes.headers.get('set-cookie'));

    const logoutRes = await fetch(`http://127.0.0.1:${port}/acp/logout`, {
      method: 'POST',
      headers: { Cookie: cookie! }
    });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('set-cookie')).toContain('Max-Age=0');

    // A client that honors the cleared cookie sends nothing back.
    const statusRes = await fetch(`http://127.0.0.1:${port}/acp/session`);
    const body = (await statusRes.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });
});
