import { afterEach, describe, expect, it, vi } from 'vitest';
import { approveRevision, editChannel, getCampaignReview, getReviewQueue, requestChanges } from './client';

/**
 * The browser's half of the bridge contract. The gateway's own tests prove
 * what happens server-side; these prove what the page sends: same-origin
 * paths under /api/marketing, the session cookie, one Idempotency-Key per
 * action — and never a credential, because the browser has none.
 */

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit & { headers?: Record<string, string> };
}

function stubFetch(response: { status?: number; body?: unknown } = {}): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init: init as RecordedCall['init'] });
      return {
        ok: (response.status ?? 200) < 400,
        status: response.status ?? 200,
        text: async () => JSON.stringify(response.body ?? { ok: true }),
      } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('every call goes to the JusticeOS gateway, with the session cookie and no credential', () => {
  it('reads from the same-origin /api/marketing bridge', async () => {
    const calls = stubFetch({ body: { items: [], totalAwaitingReview: 0, generatedAt: 'now' } });

    await getReviewQueue();
    await getCampaignReview('campaign 1/with slash');

    expect(calls[0]?.url).toBe('/api/marketing/campaigns/review');
    expect(calls[0]?.init.credentials).toBe('same-origin');
    // Path segments are encoded, so an id can never escape its route.
    expect(calls[1]?.url).toBe('/api/marketing/campaigns/campaign%201%2Fwith%20slash/review');
  });

  it('never sends an Authorization header or anything credential-shaped', async () => {
    const calls = stubFetch();

    await getReviewQueue();
    await approveRevision('revision-1', {}, 'key-1');

    for (const call of calls) {
      const headerNames = Object.keys(call.init.headers ?? {}).map((name) => name.toLowerCase());
      expect(headerNames).not.toContain('authorization');
      expect(JSON.stringify(call.init)).not.toMatch(/bearer|api[_-]?key|secret/i);
    }
  });

  it('sends one Idempotency-Key per action, and no actor (the gateway asserts that server-side)', async () => {
    const calls = stubFetch({ body: { status: 'APPROVED_READY_FOR_PUBLICATION_DISPATCH' } });

    await approveRevision('revision-1', { notes: 'Looks right.' }, 'click-abc');
    await requestChanges('revision-1', { instruction: 'Shorter, please.' }, 'click-def');

    expect(calls[0]?.init.headers?.['Idempotency-Key']).toBe('click-abc');
    expect(calls[1]?.init.headers?.['Idempotency-Key']).toBe('click-def');
    for (const call of calls) {
      expect(JSON.parse(String(call.init.body))).not.toHaveProperty('actor');
    }
  });

  it('sends an edit as structured fields, never as raw JSON text', async () => {
    const calls = stubFetch({ body: { revisionNumber: 3 } });

    await editChannel('revision-2', { platform: 'FACEBOOK', slot: 'primary', changes: { headline: 'Tighter' } }, 'click-1');

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      platform: 'FACEBOOK',
      slot: 'primary',
      changes: { headline: 'Tighter' },
    });
  });
});

describe('errors are structured results, never thrown', () => {
  it('passes a gateway/upstream error code through unchanged', async () => {
    stubFetch({ status: 409, body: { error: { code: 'REVISION_STALE', message: 'newer revision', details: {} } } });

    const result = await approveRevision('revision-1', {}, 'key-1');

    expect(result).toEqual({ ok: false, error: { code: 'REVISION_STALE', message: 'newer revision', details: {} } });
  });

  it('reports an unreachable gateway as a result, so the rest of the app keeps working', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await getReviewQueue();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GATEWAY_UNREACHABLE');
  });

  it('does not mistake a non-JSON answer for data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>nginx</html>' }) as Response),
    );

    const result = await getReviewQueue();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GATEWAY_UNREACHABLE');
  });
});
