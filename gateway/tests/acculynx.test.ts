import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcculynxError, collectAcculynxSnapshot, createAcculynxClient } from '../src/acculynxClient.js';
import { loginForTestCookie, startTestGateway } from './helpers/testGateway.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const payments = {
  receivedPayments: { total: 100, payments: [{ id: id(101), amount: 100, isParent: true },
    { id: id(102), parentId: id(101), amount: 100, paymentDate: '2026-10-01T00:00:00Z' }] },
  paidPayments: { total: 20, payments: [{ id: id(103), amount: 20, isPaid: false }] },
  additionalExpenses: { total: 0, payments: [] }
};
const key = 'synthetic-acculynx-key';
const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of close.splice(0)) await stop(); });

describe('AccuLynx read-only bridge', () => {
  it('accepts the observed payments envelope, including explicitly empty groups, without rewriting records or totals', async () => {
    const client = createAcculynxClient(key, async () => Response.json(payments));
    expect(await client.payments(id(1))).toEqual(payments);
    // The parent and child remain separate source records; their amounts are not summed.
    expect((await client.payments(id(1))).receivedPayments).toEqual(payments.receivedPayments);
  });

  it('fails closed for every missing or malformed financial group and record', async () => {
    for (const group of ['receivedPayments', 'paidPayments', 'additionalExpenses']) {
      for (const invalid of [undefined, null, [], {}, { total: 0 },
        { total: 0, [group]: [] }, { payments: [], total: '0' },
        { payments: [], total: null }, { payments: null, total: 0 },
        { payments: [null], total: 0 }, { payments: [{ id: id(1) }], total: 0 },
        { payments: [{ id: id(1), amount: '0' }], total: 0 },
        { payments: [{ amount: 0 }], total: 0 }]) {
        const client = createAcculynxClient(key, async () => Response.json({ ...payments, [group]: invalid }));
        await expect(client.payments(id(1))).rejects.toThrow('ACCULYNX_INVALID_RESPONSE');
        client.jobs = async () => ({ count: 1, pageStartIndex: 0, items: [{ id: id(1) }] });
        await expect(collectAcculynxSnapshot(client)).rejects.toThrow('ACCULYNX_INVALID_RESPONSE');
      }
    }
    // JSON permits numeric literals that overflow to Infinity on parsing.
    const raw = JSON.stringify(payments).replace('"total":100', '"total":1e400');
    await expect(createAcculynxClient(key, async () => new Response(raw)).payments(id(1)))
      .rejects.toThrow('ACCULYNX_INVALID_RESPONSE');
  });

  it('authenticates before calls, keeps credentials server-side, and rejects writes and extra queries', async () => {
    const upstream = vi.fn(async () => Response.json(payments));
    const gateway = await startTestGateway({ acculynxApiKey: key, acculynxFetch: upstream });
    close.push(gateway.close);
    const root = `http://127.0.0.1:${gateway.port}/api/acculynx`;
    expect((await fetch(`${root}/jobs`)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    const headers = { cookie: await loginForTestCookie(gateway.port) };
    const response = await fetch(`${root}/jobs/${id(1)}/payments`, { headers });
    expect(await response.json()).toEqual(payments);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(upstream).toHaveBeenCalledWith(`https://api.acculynx.com/api/v2/jobs/${id(1)}/payments`, expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${key}`, accept: 'application/json' }
    }));
    upstream.mockClear();
    for (const suffix of ['/jobs?startDate=2026-10-01', '/jobs?recordStartIndex=-1', '/jobs?recordStartIndex=1&recordStartIndex=2', '/jobs/not-a-uuid/payments']) {
      expect((await fetch(root + suffix, { headers })).status).toBe(400);
    }
    expect((await fetch(`${root}/jobs`, { method: 'POST', headers })).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reports missing configuration without breaking the gateway', async () => {
    const gateway = await startTestGateway({ acculynxApiKey: null }); close.push(gateway.close);
    const root = `http://127.0.0.1:${gateway.port}/api/acculynx`;
    const headers = { cookie: await loginForTestCookie(gateway.port) };
    expect(await (await fetch(`${root}/status`, { headers })).json()).toEqual({ configured: false, mode: 'read-only', connectionVerified: false });
    expect((await fetch(`${root}/jobs`, { headers })).status).toBe(503);
  });

  it('paginates all jobs without date filters and preserves parent/child and unpaid source records', async () => {
    const upstream = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/payments')) return Response.json(payments);
      expect(url.searchParams.has('startDate')).toBe(false);
      expect(url.searchParams.has('assignment')).toBe(false);
      expect(url.searchParams.has('recordStartIndex')).toBe(false);
      expect(url.searchParams.has('pageStartIndex')).toBe(true);
      const offset = Number(url.searchParams.get('pageStartIndex'));
      return Response.json({ count: 26, pageStartIndex: offset,
        items: Array.from({ length: offset === 0 ? 25 : 1 }, (_, i) => ({ id: id(offset + i + 1), createdDate: '2020-01-01T00:00:00Z' })) });
    });
    const snapshot = await collectAcculynxSnapshot(createAcculynxClient(key, upstream));
    expect(snapshot.complete).toBe(true);
    expect(snapshot.jobCount).toBe(26);
    expect(snapshot.jobs[0]?.payments).toEqual(payments);
    expect(upstream).toHaveBeenCalledTimes(28);
  });

  it('rejects an upstream that ignores the requested offset instead of repeating its first page', async () => {
    const upstream = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/payments')
      ? Response.json(payments)
      : Response.json({ count: 26, pageStartIndex: 0,
        items: Array.from({ length: 25 }, (_, i) => ({ id: id(i + 1) })) }));
    await expect(collectAcculynxSnapshot(createAcculynxClient(key, upstream)))
      .rejects.toThrow('ACCULYNX_INVALID_RESPONSE');
    expect(upstream).toHaveBeenCalledTimes(27);
  });

  it('fails the whole scan on drift, duplicates, or a missing page', async () => {
    for (const second of [
      { count: 2, pageStartIndex: 1, items: [{ id: id(1) }] },
      { count: 3, pageStartIndex: 1, items: [{ id: id(2) }] },
      { count: 2, pageStartIndex: 1, items: [] }
    ]) {
      const client = { jobs: vi.fn().mockResolvedValueOnce({ count: 2, pageStartIndex: 0, items: [{ id: id(1) }] }).mockResolvedValueOnce(second),
        payments: vi.fn().mockResolvedValue(payments) };
      await expect(collectAcculynxSnapshot(client)).rejects.toThrow('ACCULYNX_JOBS_CHANGED_RETRY');
    }
  });

  it('sanitizes upstream errors, reflected credentials, malformed JSON, and excessive bodies', async () => {
    for (const response of [
      new Response(key, { status: 401 }), new Response(key, { status: 500 }),
      new Response(key, { status: 429 }), new Response('not JSON'),
      Response.json({ secret: key }), new Response('x'.repeat(8 * 1024 * 1024 + 1)), Response.json({})
    ]) {
      try { await createAcculynxClient(key, async () => response).jobs(); throw new Error('should fail'); }
      catch (error) { expect(error).toBeInstanceOf(AcculynxError); expect(String(error)).not.toContain(key); }
    }
    const failing = createAcculynxClient(key, async () => { throw new Error(key); });
    await expect(failing.jobs()).rejects.toThrow('ACCULYNX_UNAVAILABLE');
  });
});
