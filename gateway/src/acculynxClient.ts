/** Server-only AccuLynx v2 transport. No caller-controlled hosts or write methods. */
const ROOT = 'https://api.acculynx.com/api/v2';
export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;

export class AcculynxError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); }
}
export type Job = Record<string, unknown> & { id: string };
export interface JobPage { items: Job[]; count: number; pageStartIndex: number }
export interface AcculynxClient {
  jobs(offset?: number): Promise<JobPage>;
  payments(jobId: string): Promise<Record<string, unknown>>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function createAcculynxClient(apiKey: string, fetchImpl: typeof fetch = fetch): AcculynxClient {
  async function read(path: string): Promise<Record<string, unknown>> {
    try {
      const response = await fetchImpl(`${ROOT}${path}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }
      });
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 401 || response.status === 403 ? 'ACCULYNX_CREDENTIAL_REJECTED'
          : response.status === 429 ? 'ACCULYNX_RATE_LIMITED' : 'ACCULYNX_UPSTREAM_ERROR';
        throw new AcculynxError(code, response.status === 429 ? 429 : 502);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new AcculynxError('ACCULYNX_INVALID_RESPONSE');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new AcculynxError('ACCULYNX_RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      // Never echo a credential even if an upstream unexpectedly reflects it.
      if (raw.includes(apiKey)) throw new AcculynxError('ACCULYNX_INVALID_RESPONSE');
      const body: unknown = JSON.parse(raw);
      if (!object(body)) throw new AcculynxError('ACCULYNX_INVALID_RESPONSE');
      return body;
    } catch (error) {
      if (error instanceof AcculynxError) throw error;
      // Provider bodies, fetch errors, and request headers must never reach logs or clients.
      throw new AcculynxError('ACCULYNX_UNAVAILABLE');
    }
  }
  return {
    async jobs(offset = 0) {
      if (!Number.isSafeInteger(offset) || offset < 0) throw new AcculynxError('INVALID_OFFSET', 400);
      // No date, milestone, or assignment filter: older/unassigned/closed jobs can have new payments.
      const body = await read(`/jobs?pageSize=25&recordStartIndex=${offset}&sortBy=CreatedDate&sortOrder=Ascending`);
      if (!Number.isSafeInteger(body.count) || Number(body.count) < 0 || body.pageStartIndex !== offset ||
          !Array.isArray(body.items) || body.items.length > 25 ||
          !body.items.every((item: unknown) => object(item) && typeof item.id === 'string' && JOB_ID.test(item.id))) {
        throw new AcculynxError('ACCULYNX_INVALID_RESPONSE');
      }
      return body as unknown as JobPage;
    },
    async payments(jobId) {
      if (!JOB_ID.test(jobId)) throw new AcculynxError('INVALID_JOB_ID', 400);
      const body = await read(`/jobs/${jobId}/payments`);
      for (const group of ['receivedPayments', 'paidPayments', 'additionalExpenses']) {
        const value = body[group];
        if (!object(value) || !Array.isArray(value.payments) ||
            typeof value.total !== 'number' || !Number.isFinite(value.total) ||
            !value.payments.every((payment: unknown) => object(payment) &&
              typeof payment.id === 'string' && JOB_ID.test(payment.id) &&
              typeof payment.amount === 'number' && Number.isFinite(payment.amount))) {
          throw new AcculynxError('ACCULYNX_INVALID_RESPONSE');
        }
      }
      return body;
    }
  };
}

/** Full, non-atomic upstream scan. Fail closed on pagination drift; never publish partial exports. */
export async function collectAcculynxSnapshot(client: AcculynxClient) {
  const startedAt = new Date().toISOString();
  const jobs: Array<{ job: Job; payments: Record<string, unknown>; fetchedAt: string }> = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedCount: number | undefined;
  do {
    const page = await client.jobs(offset);
    expectedCount ??= page.count;
    if (page.count !== expectedCount || (page.items.length === 0 && offset < expectedCount)) {
      throw new AcculynxError('ACCULYNX_JOBS_CHANGED_RETRY');
    }
    for (const job of page.items) {
      const id = job.id.toLowerCase();
      if (seen.has(id)) throw new AcculynxError('ACCULYNX_JOBS_CHANGED_RETRY');
      seen.add(id);
      jobs.push({ job, payments: await client.payments(job.id), fetchedAt: new Date().toISOString() });
    }
    offset += page.items.length;
    if (offset > expectedCount || offset > 100_000) throw new AcculynxError('ACCULYNX_INVALID_RESPONSE');
  } while (offset < expectedCount);
  return { schemaVersion: 1, source: 'AccuLynx', startedAt, completedAt: new Date().toISOString(),
    complete: true, jobCount: jobs.length, jobs };
}
