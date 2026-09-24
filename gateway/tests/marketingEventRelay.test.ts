import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestGateway, loginForTestCookie, TEST_MARKETING_API_KEY, TEST_MARKETING_ACTOR } from './helpers/testGateway.js';
import { startMockAgentContract, type MockAgentContract } from './helpers/mockAgentContract.js';
import { ackEnvelope, claimEnvelope, envelope, eventErrorBody, eventsEnvelope, LIVE_CLAIM_EXPIRES_AT, outboxEvent } from './helpers/agentEnvelopes.js';
import { RELAY_CLAIM_LIMIT, RELAY_CLAIM_TTL_MS } from '../src/marketing/eventRelay.js';
import type { CommunicationsHandoff, HandoffOutcome, HandoffReceipt } from '../src/marketing/events.js';
import type { OutboundMarketingEvent } from '../src/marketing/outboxEvents.js';

/**
 * Acceptance tests for the durable event transport:
 *
 *   Marketing outbox → JusticeOS claims → Communications → JusticeOS
 *   acknowledges → Marketing records the immutable attempt.
 *
 * Everything here runs against a mocked Marketing Agent that enforces the real
 * credential and a MOCK Communications endpoint, because the real one does not
 * exist yet (see §13 of the integration doc). Nothing reaches a provider and
 * nothing notifies anybody — the last two cases prove it rather than assert it
 * in a comment.
 *
 * The lettered cases are the acceptance criteria this increment was specified
 * against, so a later reader can match each `describe` to the requirement.
 */

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

let agent: MockAgentContract;
let gateway: Awaited<ReturnType<typeof startTestGateway>> | undefined;
let cookie: string;

/** Everything the mock Communications endpoint was asked to deliver, in order. */
let delivered: OutboundMarketingEvent[];
let handoffConfigured: boolean;
/** What the mock Communications endpoint answers next. A queue, so a test can script a failure then a success. */
let handoffOutcomes: HandoffOutcome[];

function mockCommunications(): CommunicationsHandoff {
  return {
    get configured() {
      return handoffConfigured;
    },
    async deliver(event): Promise<HandoffReceipt> {
      delivered.push(event);
      const outcome = handoffOutcomes.shift() ?? 'ACCEPTED';
      return { outcome, ref: outcome === 'ACCEPTED' || outcome === 'DUPLICATE' ? event.idempotencyKey : null, detail: `mock communications: ${outcome}` };
    }
  };
}

async function startWith(overrides: Parameters<typeof startTestGateway>[0] = {}): Promise<void> {
  gateway = await startTestGateway({
    marketingAgentBaseUrl: agent.url,
    marketingAgentApiKey: TEST_MARKETING_API_KEY,
    marketingAgentActor: TEST_MARKETING_ACTOR,
    communicationsHandoff: mockCommunications(),
    ...overrides
  });
  cookie = await loginForTestCookie(gateway.port);
}

/**
 * Test-only loose read of a response body. These tests assert field by field
 * across several shapes; a DTO per route would add types nothing else uses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${gateway!.port}${path}`, {
    ...init,
    headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
}

const relay = (): Promise<Response> => api('/api/marketing/agent/events/relay', { method: 'POST', body: '{}' });

/** The mock's default answers: one pending event, claimable, acknowledgeable. */
function scriptOneDeliverableEvent(over: Partial<Record<string, unknown>> = {}): void {
  agent.route('GET /agent/events', { status: 200, body: eventsEnvelope([outboxEvent(over)]) });
  agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([outboxEvent(over)]) });
  agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope() });
}

function ackBodies(): Record<string, unknown>[] {
  return agent.requests.filter((request) => request.url.includes('/ack')).map((request) => request.body as Record<string, unknown>);
}

beforeEach(async () => {
  delivered = [];
  handoffConfigured = true;
  handoffOutcomes = [];
  agent = await startMockAgentContract({ expectedApiKey: TEST_MARKETING_API_KEY });
});

afterEach(async () => {
  // Reset, not just closed: the two purely structural cases below never start a
  // gateway, and closing a previous test's instance twice fails the wrong test.
  await gateway?.close();
  gateway = undefined;
  await agent.close();
});

// ── A ───────────────────────────────────────────────────────────────────────

describe('A. a pending marketing event is claimed, delivered, and acknowledged DELIVERED', () => {
  it('walks the whole lifecycle and records it at both ends', async () => {
    scriptOneDeliverableEvent();
    await startWith();

    const body = await json(await relay());

    expect(body.transport).toBe('MARKETING_OUTBOX');
    expect(body.relay).toMatchObject({ mode: 'CLAIM_AND_DELIVER', claimed: 1, delivered: 1, duplicate: 0, failed: 0, retryScheduled: 0 });

    // Claimed before delivered, delivered before acknowledged.
    const order = agent.requests.map((request) => `${request.method} ${request.url.split('?')[0]}`);
    expect(order).toEqual(['POST /api/marketing/agent/events/claim', 'POST /api/marketing/agent/events/outbox_1/ack']);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.kind).toBe('MARKETING_OPPORTUNITY_FOUND');

    const ack = ackBodies()[0]!;
    expect(ack).toMatchObject({ result: 'DELIVERED', consumer: 'justiceos-communications-relay', claimToken: 'claim-token-1' });
    expect(String(ack.ackKey)).toMatch(/^justiceos-ack-[0-9a-f]{32}$/);

    // And it is still visible in the app afterwards — a delivered event is
    // settled, not erased.
    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events).toHaveLength(1);
    expect(listed.events[0]).toMatchObject({ id: 'outbox_1', status: 'DELIVERED' });
    expect(listed.events[0].delivery).toMatchObject({ acknowledged: true, acknowledgedResult: 'DELIVERED' });
    expect(listed.byStatus.DELIVERED).toBe(1);
  });

  it('claims with the stable consumer identity, a bounded limit, and a TTL above the worst-case delivery', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();

    const claim = agent.requests.find((request) => request.url.endsWith('/events/claim'))!.body as Record<string, unknown>;
    expect(claim).toEqual({ consumer: 'justiceos-communications-relay', limit: RELAY_CLAIM_LIMIT, ttlMs: RELAY_CLAIM_TTL_MS });
    // The claim has to outlive the whole batch: the relay's own worst case is
    // limit × (one Communications wait + two acknowledgement waits).
    expect(RELAY_CLAIM_TTL_MS).toBeGreaterThan(RELAY_CLAIM_LIMIT * (5_000 + 10_000 * 2));
    // ...and is well inside the band the agent clamps to (30s–30m), so it is a
    // deliberate value rather than a request for the maximum.
    expect(RELAY_CLAIM_TTL_MS).toBeLessThanOrEqual(30 * 60_000);
  });

  it('persists the whole claim context with the attempt', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();

    const event = (await json(await api('/api/marketing/agent/events'))).events[0];
    expect(event.attempt).toMatchObject({
      outboxId: 'outbox_1',
      eventId: 'evt_1',
      kind: 'MARKETING_OPPORTUNITY_FOUND',
      claimToken: 'claim-token-1',
      idempotencyKey: 'evt_1:1',
      dedupeKey: 'AGENT|MARKETING_OPPORTUNITY_FOUND|gutters',
      claimExpiresAt: LIVE_CLAIM_EXPIRES_AT
    });
  });
});

// ── B ───────────────────────────────────────────────────────────────────────

describe('B. fetching alone never marks an event delivered', () => {
  it('reads without claiming or acknowledging when no Communications endpoint is wired', async () => {
    handoffConfigured = false;
    scriptOneDeliverableEvent();
    await startWith();

    const body = await json(await relay());

    expect(body.relay).toMatchObject({ mode: 'READ_ONLY', observed: 1, claimed: 0, delivered: 0 });
    // A read, and only a read: no claim was taken and no result was reported,
    // so the event stays PENDING upstream for whoever eventually wires a
    // receiver — and its retry budget is untouched.
    expect(agent.countOf('POST /agent/events/claim')).toBe(0);
    expect(agent.countOf('POST /agent/events/outbox_1/ack')).toBe(0);
    expect(delivered).toHaveLength(0);

    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events[0]).toMatchObject({ status: 'NEW' });
    expect(listed.events[0].delivery.acknowledged).toBe(false);
    expect(listed.handoffConfigured).toBe(false);
  });

  it('keeps reporting NOT_CONFIGURED honestly in health rather than implying a delivery', async () => {
    handoffConfigured = false;
    scriptOneDeliverableEvent();
    agent.route('GET /agent/health', { status: 200, body: envelope('health', { service: 'UP', database: 'REACHABLE', jobs: [], degraded: [], blocked: [] }) });
    await startWith();
    await relay();

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.events).toMatchObject({ transport: 'MARKETING_OUTBOX', consumer: 'justiceos-communications-relay', handoffConfigured: false });
    expect(report.events.byStatus.NEW).toBe(1);
    expect(report.degraded.join(' ')).toContain('nothing is claimed, and nobody is notified');
  });

  it('retires the old brief-based sync rather than leaving it working', async () => {
    agent.route('GET /agent/brief', { status: 200, body: envelope('brief', { changesSinceLastBrief: [{ kind: 'MARKETING_DATA_STALE', title: 'stale' }] }) });
    await startWith();

    const res = await api('/api/marketing/agent/events/sync', { method: 'POST', body: '{}' });
    const body = await json(res);

    expect(res.status).toBe(410);
    expect(body.error.code).toBe('MARKETING_EVENT_SYNC_RETIRED');
    expect(body.error.details.replacement).toBe('/api/marketing/agent/events/relay');
    // And it did not quietly do the old thing on the way out.
    expect(agent.countOf('GET /agent/brief')).toBe(0);
  });

  it('never reads marketing events out of a brief any more', () => {
    // Structural, not behavioural: the reconstruction helper is gone and no
    // line of CODE names the brief's event array, so no future caller can
    // reach for it. Prose still may — the retired path is documented on
    // purpose — so comment lines are exempt.
    const dir = path.join(REPO_ROOT, 'gateway', 'src', 'marketing');
    const offenders: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      fs.readFileSync(path.join(dir, name), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const code = line.replace(/^\s*(\*|\/\/|\/\*).*$/, '');
          if (/eventsInBriefResult|changesSinceLastBrief/.test(code)) offenders.push(`${name}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

// ── C ───────────────────────────────────────────────────────────────────────

describe('C. an event JusticeOS has already handled is not sent again', () => {
  it('acknowledges DUPLICATE without a second delivery, and does not call it DELIVERED', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();
    expect(delivered).toHaveLength(1);

    // The outbox offers the same event again (a claim that lapsed after an
    // uncertain acknowledgement, say). JusticeOS's own idempotency catches it.
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([outboxEvent()], { claimToken: 'claim-token-2' }) });
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ result: 'DUPLICATE', status: 'DUPLICATE', attempts: 2 }) });

    const body = await json(await relay());

    expect(delivered, 'the event must not reach Communications twice').toHaveLength(1);
    expect(body.relay).toMatchObject({ duplicate: 1, delivered: 0 });
    // "I already handled this" is different evidence from "I delivered this",
    // and collapsing them would throw away the only signal that JusticeOS's
    // dedupe caught something the outbox did not.
    expect(ackBodies().at(-1)).toMatchObject({ result: 'DUPLICATE' });
    expect((await json(await api('/api/marketing/agent/events'))).events[0].status).toBe('DUPLICATE');
  });

  it('relays the receiver’s own duplicate verdict as DUPLICATE too', async () => {
    scriptOneDeliverableEvent();
    handoffOutcomes = ['DUPLICATE'];
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ result: 'DUPLICATE', status: 'DUPLICATE' }) });
    await startWith();

    const body = await json(await relay());
    expect(body.relay).toMatchObject({ duplicate: 1, delivered: 0 });
    expect(ackBodies()[0]).toMatchObject({ result: 'DUPLICATE' });
  });

  it('still delivers a genuine recurrence, which is a new occurrence and not a duplicate', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();

    const recurrence = { id: 'outbox_2', idempotencyKey: 'evt_1:2', occurrenceCount: 2 };
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([outboxEvent(recurrence)], { claimToken: 'claim-token-2' }) });
    agent.route('POST /agent/events/outbox_2/ack', { status: 200, body: ackEnvelope({ outboxId: 'outbox_2' }) });

    const body = await json(await relay());
    // The dedupe key is the same; the occurrence is not. The agent decided
    // this was worth raising again, and JusticeOS does not overrule it.
    expect(delivered).toHaveLength(2);
    expect(body.relay).toMatchObject({ delivered: 1, duplicate: 0 });
  });
});

// ── D ───────────────────────────────────────────────────────────────────────

describe('D. a temporary Communications failure is acknowledged FAILED_RETRYABLE', () => {
  it('reports the transient failure and lets the outbox offer the event again', async () => {
    scriptOneDeliverableEvent();
    handoffOutcomes = ['RETRYABLE'];
    agent.route('POST /agent/events/outbox_1/ack', {
      status: 200,
      body: ackEnvelope({ result: 'FAILED_RETRYABLE', status: 'PENDING', willRetry: true, nextAttemptAt: '2026-09-24T12:01:00.000Z' })
    });
    await startWith();

    const body = await json(await relay());

    expect(ackBodies()[0]).toMatchObject({ result: 'FAILED_RETRYABLE' });
    expect(body.relay).toMatchObject({ retryScheduled: 1, delivered: 0, failed: 0 });
    expect((await json(await api('/api/marketing/agent/events'))).events[0].status).toBe('RETRY_PENDING');
  });

  it('delivers it on the later cycle the outbox’s own backoff policy allows', async () => {
    scriptOneDeliverableEvent();
    handoffOutcomes = ['RETRYABLE'];
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ result: 'FAILED_RETRYABLE', status: 'PENDING', willRetry: true }) });
    await startWith();
    await relay();

    // The backoff has elapsed upstream and the event is offered again — under
    // a NEW claim token, so this counts as a genuine second attempt.
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([outboxEvent()], { claimToken: 'claim-token-2' }) });
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ attempts: 2 }) });

    const body = await json(await relay());

    expect(body.relay).toMatchObject({ delivered: 1 });
    expect(delivered, 'a retryable failure must leave the event deliverable').toHaveLength(2);
    const keys = ackBodies().map((ack) => ack.ackKey);
    expect(keys[0], 'a new attempt must not replay the first attempt’s result').not.toBe(keys[1]);
  });
});

// ── E ───────────────────────────────────────────────────────────────────────

describe('E. a permanent Communications failure is acknowledged FAILED_FINAL', () => {
  it('reports it as final and keeps the event rather than discarding it', async () => {
    scriptOneDeliverableEvent();
    handoffOutcomes = ['FINAL'];
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ result: 'FAILED_FINAL', status: 'FAILED', willRetry: false }) });
    await startWith();

    const body = await json(await relay());

    expect(ackBodies()[0]).toMatchObject({ result: 'FAILED_FINAL' });
    expect(body.relay).toMatchObject({ failed: 1, delivered: 0, retryScheduled: 0 });
    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events[0].status).toBe('FAILED');
    expect(listed.events[0].delivery.detail).toContain('FINAL');
  });
});

// ── F ───────────────────────────────────────────────────────────────────────

describe('F. an uncertain acknowledgement is retried with the SAME ack key', () => {
  it('re-sends the same key rather than generating a new one', async () => {
    scriptOneDeliverableEvent();
    // The acknowledgement's answer never arrives, twice over.
    agent.route('POST /agent/events/outbox_1/ack', { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'transient', details: {} } } });
    await startWith();

    const body = await json(await relay());

    // Two tries in one cycle, one ack key between them. A new key would defeat
    // the whole mechanism: Marketing's unique (outboxId, ackKey) is what makes
    // a re-send a replay instead of a second attempt.
    expect(agent.countOf('POST /agent/events/outbox_1/ack')).toBe(2);
    const keys = ackBodies().map((ack) => ack.ackKey);
    expect(new Set(keys).size).toBe(1);
    expect(body.relay.ackUncertain).toBe(1);
  });

  it('does NOT carry forward an acknowledgement the agent refused deterministically', async () => {
    scriptOneDeliverableEvent();
    // A 4xx that is none of the three transport codes: the agent would refuse
    // an identical retry the same way, so re-sending the key every cycle
    // forever would be pure waste.
    agent.route('POST /agent/events/outbox_1/ack', { status: 400, body: { error: { code: 'INVALID_REQUEST', message: 'malformed', details: {} } } });
    await startWith();

    const first = await json(await relay());
    expect(agent.countOf('POST /agent/events/outbox_1/ack'), 'a deterministic refusal is not retried in-cycle').toBe(1);
    expect(first.relay.ackRefused).toBe(1);
    expect(first.relay.degraded.join(' ')).toContain('would refuse an identical retry');

    // Next cycle: no re-send. The claim lapses and the outbox offers the event
    // again under a fresh one, which is the path that can actually recover.
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([], { claimToken: 'claim-token-2' }) });
    const second = await json(await relay());

    expect(agent.countOf('POST /agent/events/outbox_1/ack')).toBe(1);
    expect(second.relay).toMatchObject({ ackRefused: 0, ackUncertain: 0 });
    expect((await json(await api('/api/marketing/agent/events'))).events[0].status).toBe('RETRY_PENDING');
  });

  it('carries the same ack key into the NEXT cycle, and does not double the attempt count', async () => {
    scriptOneDeliverableEvent();
    agent.route('POST /agent/events/outbox_1/ack', { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'transient', details: {} } } });
    await startWith();
    await relay();
    const keyFromFirstCycle = ackBodies()[0]!.ackKey;

    // The agent recovers. It had in fact recorded the first acknowledgement,
    // so re-sending the same key replays it rather than counting again.
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ replayed: true, attempts: 1 }) });
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([], { claimToken: 'claim-token-2' }) });

    const body = await json(await relay());

    expect(ackBodies().at(-1)!.ackKey).toBe(keyFromFirstCycle);
    expect(body.relay).toMatchObject({ ackReplayed: 1, delivered: 1 });
    // Not sent to Communications a second time, and not counted as a second
    // attempt at either end.
    expect(delivered).toHaveLength(1);
    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events[0].delivery.attempts).toBe(1);
    expect(listed.events[0].delivery.acknowledged).toBe(true);
  });
});

// ── G ───────────────────────────────────────────────────────────────────────

describe('G. a claim that expires before the acknowledgement', () => {
  it('records EVENT_CLAIM_INVALID without faking a success, and re-enters the claim cycle', async () => {
    scriptOneDeliverableEvent();
    agent.route('POST /agent/events/outbox_1/ack', { status: 409, body: eventErrorBody('EVENT_CLAIM_INVALID', { refusal: 'CLAIM_EXPIRED', status: 'CLAIMED' }) });
    await startWith();

    const body = await json(await relay());

    expect(body.relay).toMatchObject({ claimInvalid: 1, delivered: 0, failed: 0 });
    // Not retried, not re-authenticated, and above all not acknowledged as
    // anything else: one call, and the event goes back in the queue.
    expect(agent.countOf('POST /agent/events/outbox_1/ack')).toBe(1);
    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events[0].status).toBe('RETRY_PENDING');
    expect(listed.events[0].delivery.acknowledged).toBe(false);
    expect(listed.events[0].delivery.acknowledgedResult).toBeNull();

    // A later cycle simply claims again.
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([outboxEvent()], { claimToken: 'claim-token-2' }) });
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope({ attempts: 2 }) });
    expect((await json(await relay())).relay).toMatchObject({ delivered: 1 });
  });

  it('does not start work a nearly-expired claim cannot cover, and lets it lapse instead', async () => {
    // The claim expires in a second. Delivering under it would mean an
    // acknowledgement refused for a lapsed claim — a delivery nobody
    // recorded, which is the one outcome worth spending a whole extra cycle
    // to avoid.
    agent.route('POST /agent/events/claim', {
      status: 200,
      body: claimEnvelope([outboxEvent()], { expiresAt: new Date(Date.now() + 1_000).toISOString() })
    });
    await startWith();

    const body = await json(await relay());

    expect(body.relay).toMatchObject({ claimed: 1, abandoned: 1, delivered: 0 });
    expect(delivered, 'nothing may be sent under a claim that cannot be acknowledged').toHaveLength(0);
    expect(agent.requests.filter((request) => request.url.includes('/ack'))).toHaveLength(0);
    expect((await json(await api('/api/marketing/agent/events'))).events[0].status).toBe('RETRY_PENDING');
  });

  it('stops work and reconciles when the agent says the event is already final', async () => {
    scriptOneDeliverableEvent();
    agent.route('POST /agent/events/outbox_1/ack', { status: 409, body: eventErrorBody('EVENT_ALREADY_FINAL', { status: 'DELIVERED' }) });
    await startWith();

    const body = await json(await relay());

    expect(body.relay).toMatchObject({ alreadyFinal: 1 });
    expect(agent.countOf('POST /agent/events/outbox_1/ack')).toBe(1);
    // Local state matched to what the agent says is settled, rather than left
    // disagreeing with it.
    expect((await json(await api('/api/marketing/agent/events'))).events[0].status).toBe('DELIVERED');
  });

  it('records an integration inconsistency for an event the agent has never heard of, and fabricates no success', async () => {
    scriptOneDeliverableEvent();
    agent.route('POST /agent/events/outbox_1/ack', { status: 404, body: eventErrorBody('EVENT_NOT_FOUND', { outboxId: 'outbox_1' }) });
    await startWith();

    const body = await json(await relay());

    expect(body.relay.notFound).toBe(1);
    expect(body.relay.degraded.join(' ')).toContain('no outbox event outbox_1');
    const listed = await json(await api('/api/marketing/agent/events'));
    // Communications did take it; Marketing certainly did not record that.
    // Both facts are kept and neither is upgraded.
    expect(listed.events[0].delivery.acknowledged).toBe(false);
    expect(listed.degraded.join(' ')).toContain('no outbox event outbox_1');
  });
});

// ── H ───────────────────────────────────────────────────────────────────────

describe('H. two relay attempts cannot both deliver the same claimed event', () => {
  it('gives the second pass nothing, because the first holds the claim', async () => {
    // The agent's claim is a conditional UPDATE: the loser's statement matches
    // nothing, so it is simply handed an empty claim. This mock reproduces
    // exactly that — one winner, one empty answer.
    agent.route('POST /agent/events/outbox_1/ack', { status: 200, body: ackEnvelope() });
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([outboxEvent()]) });
    await startWith();

    const first = await json(await relay());
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([], { claimToken: 'claim-token-2' }) });
    const second = await json(await relay());

    expect(agent.countOf('POST /agent/events/claim')).toBe(2);
    expect(first.relay).toMatchObject({ claimed: 1, delivered: 1 });
    expect(second.relay).toMatchObject({ claimed: 0, delivered: 0 });
    expect(delivered, 'one claimed event, one delivery').toHaveLength(1);
    expect(agent.countOf('POST /agent/events/outbox_1/ack')).toBe(1);
  });

  it('refuses to deliver under a claim it does not hold, even if it somehow saw the event', async () => {
    // Two cycles running at once against the same store: only the pass whose
    // claim actually returned the event ever delivers it.
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([], { claimToken: 'loser-token' }) });
    await startWith();

    const body = await json(await relay());
    expect(body.relay).toMatchObject({ claimed: 0, delivered: 0 });
    expect(delivered).toHaveLength(0);
    // A claim that won nothing produces no acknowledgement at all — there is
    // nothing it is entitled to report an outcome for.
    expect(agent.requests.filter((request) => request.url.includes('/ack'))).toHaveLength(0);
  });
});

// ── I ───────────────────────────────────────────────────────────────────────

describe('I. an unsupported contract version fails closed', () => {
  it('claims nothing, delivers nothing, and marks the integration degraded', async () => {
    // A perfectly good claim, from a contract this build was not written for.
    agent.route('POST /agent/events/claim', { status: 200, body: { ...claimEnvelope([outboxEvent()]), contractVersion: '2' } });
    await startWith();

    const res = await relay();
    const body = await json(res);

    expect(res.status).toBe(502);
    expect(body.error.code).toBe('MARKETING_CONTRACT_UNSUPPORTED');
    expect(body.error.details.found).toBe('2');
    expect(delivered, 'nothing may be read from an answer JusticeOS cannot certainly parse').toHaveLength(0);
    expect(agent.requests.filter((request) => request.url.includes('/ack'))).toHaveLength(0);

    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events).toHaveLength(0);
    expect(listed.degraded.join(' ')).toContain('contract version 2');
  });

  it('refuses an envelope whose event is missing a field it would have had to guess at', async () => {
    const incomplete = outboxEvent();
    delete incomplete.idempotencyKey;
    agent.route('POST /agent/events/claim', { status: 200, body: claimEnvelope([incomplete]) });
    await startWith();

    const res = await relay();
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe('MARKETING_CONTRACT_INVALID');
    expect(delivered).toHaveLength(0);
  });

  it('reports a degraded transport in the health report, not an outage', async () => {
    agent.route('POST /agent/events/claim', { status: 200, body: { ...claimEnvelope([outboxEvent()]), contractVersion: '2' } });
    agent.route('GET /agent/health', { status: 200, body: envelope('health', { service: 'UP', database: 'REACHABLE', jobs: [], degraded: [], blocked: [] }) });
    await startWith();
    await relay();

    const report = await json(await api('/api/marketing/agent/health'));
    // The agent still answers every read; what is broken is the path by which
    // Austin would have been told without asking.
    expect(report.state).toBe('DEGRADED');
    expect(report.degraded.join(' ')).toContain('event transport answers contract version 2');
  });
});

// ── J ───────────────────────────────────────────────────────────────────────

describe('J. the Marketing credential stays on the server', () => {
  it('never appears in a relay response, an event listing, or a health report', async () => {
    scriptOneDeliverableEvent();
    await startWith();

    const bodies = [
      await (await relay()).text(),
      await (await api('/api/marketing/agent/events')).text(),
      await (await api('/api/marketing/agent/health')).text()
    ];

    for (const body of bodies) {
      expect(body).not.toContain(TEST_MARKETING_API_KEY);
      expect(body.toLowerCase()).not.toContain('authorization');
      expect(body).not.toContain('MARKETING_AGENT_API_KEY');
    }
    // It did reach the agent, exactly once per call, and nowhere else.
    for (const request of agent.requests) {
      expect(request.authorization).toBe(`Bearer ${TEST_MARKETING_API_KEY}`);
    }
  });

  it('never reaches the Communications endpoint', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();

    const serialized = JSON.stringify(delivered);
    expect(serialized).not.toContain(TEST_MARKETING_API_KEY);
    expect(serialized.toLowerCase()).not.toContain('bearer');
  });

  it('is not referenced by any frontend source file, including the new transport client', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
      });
    const offenders = walk(path.join(REPO_ROOT, 'src')).filter((file) => {
      const content = fs.readFileSync(file, 'utf8');
      return content.includes('MARKETING_AGENT_API_KEY') || content.includes('eventRelay') || content.includes('outboxEvents');
    });
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });
});

// ── K & L ───────────────────────────────────────────────────────────────────

describe('K & L. the relay calls no provider and sends no real notification', () => {
  it('reaches only the Marketing Agent and the mock Communications endpoint', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();

    // Every request the relay made, and where it went.
    const hosts = agent.requests.map((request) => request.url);
    expect(hosts.every((url) => url.startsWith('/api/marketing/agent/events'))).toBe(true);
    // No research, no tick, no brief: the relay moves events the agent has
    // already decided to raise, and drives no work of its own.
    for (const forbidden of ['/research', '/tick', '/prepare-work', '/decisions', '/brief']) {
      expect(hosts.some((url) => url.includes(forbidden))).toBe(false);
    }
  });

  it('sends nothing at all when the Communications endpoint is the unconfigured one', async () => {
    handoffConfigured = false;
    scriptOneDeliverableEvent();
    await startWith({ communicationsHandoff: undefined, communicationsAgentEventUrl: null, communicationsAgentApiKey: null });

    const body = await json(await relay());

    // The real default: no endpoint, so no claim, no delivery, and — stated
    // rather than implied — no fallback to contacting anyone directly.
    expect(body.relay).toMatchObject({ mode: 'READ_ONLY', claimed: 0, delivered: 0 });
    expect(body.relay.degraded.join(' ')).toContain('nobody is notified');
  });

  it('makes no network call of its own beyond those two', async () => {
    scriptOneDeliverableEvent();
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
      seen.push(String(input));
      return realFetch(input as string, init);
    });
    vi.stubGlobal('fetch', spy);
    try {
      await startWith();
      await relay();
    } finally {
      vi.unstubAllGlobals();
    }

    const outbound = seen.filter((url) => !url.includes(String(gateway!.port)));
    expect(outbound.every((url) => url.startsWith(agent.url))).toBe(true);
    for (const url of outbound) {
      for (const provider of ['firecrawl', 'dataforseo', 'googleapis', 'twilio', 'sendgrid', 'mailgun']) {
        expect(url.toLowerCase()).not.toContain(provider);
      }
    }
  });
});

// ── The relay driver ────────────────────────────────────────────────────────

describe('the scheduled relay driver', () => {
  it('lets a cron with the relay key run a cycle without a browser session', async () => {
    scriptOneDeliverableEvent();
    const relayKey = 'r'.repeat(40);
    await startWith({ justiceOsRelayKey: relayKey });

    const res = await fetch(`http://127.0.0.1:${gateway!.port}/api/marketing/agent/events/relay`, {
      method: 'POST',
      headers: { authorization: `Bearer ${relayKey}`, 'content-type': 'application/json' },
      body: '{}'
    });

    expect(res.status).toBe(200);
    expect((await json(res)).relay).toMatchObject({ delivered: 1 });
  });

  it('refuses a wrong relay key, and refuses any key when none is configured', async () => {
    scriptOneDeliverableEvent();
    await startWith({ justiceOsRelayKey: 'r'.repeat(40) });

    const wrong = await fetch(`http://127.0.0.1:${gateway!.port}/api/marketing/agent/events/relay`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'x'.repeat(40)}`, 'content-type': 'application/json' },
      body: '{}'
    });
    expect(wrong.status).toBe(401);
    expect(delivered).toHaveLength(0);

    await gateway!.close();
    await startWith({ justiceOsRelayKey: null });
    const noKey = await fetch(`http://127.0.0.1:${gateway!.port}/api/marketing/agent/events/relay`, {
      method: 'POST',
      headers: { authorization: 'Bearer anything', 'content-type': 'application/json' },
      body: '{}'
    });
    expect(noKey.status, 'with no key configured the second door must not exist').toBe(401);
  });

  it('grants nothing beyond the relay: the key cannot read events, approve, or tick', async () => {
    scriptOneDeliverableEvent();
    const relayKey = 'r'.repeat(40);
    await startWith({ justiceOsRelayKey: relayKey });
    const bearer = { authorization: `Bearer ${relayKey}`, 'content-type': 'application/json' };

    for (const [route, init] of [
      ['/api/marketing/agent/events', { method: 'GET' }],
      ['/api/marketing/agent/decisions', { method: 'POST', body: JSON.stringify({ revisionId: 'r', decision: 'APPROVE', confirmed: true }) }],
      ['/api/marketing/agent/tick', { method: 'POST', body: JSON.stringify({ reason: 'why not' }) }]
    ] as const) {
      const res = await fetch(`http://127.0.0.1:${gateway!.port}${route}`, { ...init, headers: bearer });
      expect(res.status, `${route} must stay session-only`).toBe(401);
    }
  });

  it('refuses an unauthenticated relay call outright', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    const res = await fetch(`http://127.0.0.1:${gateway!.port}/api/marketing/agent/events/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(agent.requests).toHaveLength(0);
  });
});

// ── Dismissal ───────────────────────────────────────────────────────────────

describe('dismissal', () => {
  it('stops the notification without deleting the upstream Marketing event', async () => {
    scriptOneDeliverableEvent();
    await startWith();
    await relay();
    const before = agent.requests.length;

    const dismissed = await json(await api('/api/marketing/agent/events/outbox_1/dismiss', { method: 'POST', body: '{}' }));

    expect(dismissed.event.dismissedAt).not.toBeNull();
    expect(dismissed.retained).toBe(true);
    expect(dismissed.upstreamRetained).toBe(true);
    // No upstream call at all: there is no endpoint that could delete an
    // outbox row, and JusticeOS would not use one if there were.
    expect(agent.requests).toHaveLength(before);
    expect((await json(await api('/api/marketing/agent/events'))).events).toHaveLength(1);
    expect((await json(await api('/api/marketing/agent/events?includeDismissed=false'))).events).toHaveLength(0);
  });
});
