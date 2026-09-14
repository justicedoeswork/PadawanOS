import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkGatewaySession, loginToGateway, logoutOfGateway } from './session';

/** Minimal Response-shaped stub -- avoids depending on the real Fetch API's
 * Response class being fully wired up in the vitest Node environment. */
function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkGatewaySession', () => {
  it('reports authenticated on a 200 with authenticated: true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, { authenticated: true })));
    expect(await checkGatewaySession()).toEqual({ status: 'authenticated' });
  });

  it('reports unauthenticated on a 200 with authenticated: false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, { authenticated: false })));
    expect(await checkGatewaySession()).toEqual({ status: 'unauthenticated' });
  });

  it('reports unavailable on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(503, {})));
    expect(await checkGatewaySession()).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await checkGatewaySession()).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable on a malformed (non-JSON) body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }) as unknown as Response),
    );
    expect(await checkGatewaySession()).toEqual({ status: 'unavailable' });
  });

  it('requests GET /acp/session with same-origin credentials -- never reads document.cookie', async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(200, { authenticated: true }));
    vi.stubGlobal('fetch', fetchSpy);
    await checkGatewaySession();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/acp/session',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });
});

describe('loginToGateway', () => {
  it('resolves ok on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, { authenticated: true })));
    expect(await loginToGateway('correct')).toEqual({ ok: true });
  });

  it('maps 401 to an invalid-credentials outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(401, { error: 'Invalid credentials.' })));
    expect(await loginToGateway('wrong')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('maps 429 to a throttled outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(429, { error: 'Too many attempts.' })));
    expect(await loginToGateway('wrong')).toEqual({ ok: false, reason: 'throttled' });
  });

  it('maps a 503 (or any other non-2xx) to an unavailable outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(503, { error: 'not configured' })));
    expect(await loginToGateway('correct')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('maps a network failure to an unavailable outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await loginToGateway('correct')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('POSTs the password as JSON to /acp/session with same-origin credentials', async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(200, { authenticated: true }));
    vi.stubGlobal('fetch', fetchSpy);
    await loginToGateway('hunter2');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/acp/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ password: 'hunter2' }),
      }),
    );
  });
});

describe('logoutOfGateway', () => {
  it('POSTs to /acp/logout with same-origin credentials', async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(200, { loggedOut: true }));
    vi.stubGlobal('fetch', fetchSpy);
    await logoutOfGateway();
    expect(fetchSpy).toHaveBeenCalledWith('/acp/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  });

  it('never throws even when the network call fails (best-effort, requirement #12)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(logoutOfGateway()).resolves.toBeUndefined();
  });
});

describe('no credential storage (requirements #2, #3)', () => {
  it('never calls localStorage/sessionStorage while checking, logging in, or logging out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, { authenticated: true })));
    const record: string[] = [];
    const guard = (name: string) => ({
      getItem: () => { record.push(`${name}.getItem`); return null; },
      setItem: () => { record.push(`${name}.setItem`); },
      removeItem: () => { record.push(`${name}.removeItem`); },
    });
    vi.stubGlobal('localStorage', guard('localStorage'));
    vi.stubGlobal('sessionStorage', guard('sessionStorage'));

    await checkGatewaySession();
    await loginToGateway('hunter2');
    await logoutOfGateway();

    expect(record).toEqual([]);
  });

  it('never references document.cookie, localStorage, sessionStorage, or indexedDB in source (static guard)', () => {
    const path = fileURLToPath(new URL('./session.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    for (const forbidden of ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
