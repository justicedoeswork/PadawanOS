import { describe, it, expect } from 'vitest';
import { MarketingEventStore, type DeliveryAttemptContext } from '../src/marketing/events.js';
import { classifyStatus, createHttpCommunicationsHandoff, envelopeFor, notConfiguredHandoff } from '../src/marketing/communicationsHandoff.js';
import { ackKeyFor, JUSTICEOS_CONSUMER_ID } from '../src/marketing/eventRelay.js';
import { parseAckOutcome, parseClaim, parseEventListing, parseOutboundEvent, type OutboundMarketingEvent } from '../src/marketing/outboxEvents.js';
import { ackEnvelope, claimEnvelope, eventsEnvelope, LIVE_CLAIM_EXPIRES_AT, outboxEvent } from './helpers/agentEnvelopes.js';
import { normalizeAnswer, parseAgentAnswer } from '../src/marketing/contract.js';

/** The `result` of a valid envelope, so the parsers under test are fed what the bridge really hands them. */
function resultOf(body: Record<string, unknown>): unknown {
  const parsed = parseAgentAnswer(body);
  if (parsed.kind !== 'answer') throw new Error('fixture is not a valid envelope');
  return normalizeAnswer(parsed.envelope).result;
}

function anEvent(overrides: Partial<Record<string, unknown>> = {}): OutboundMarketingEvent {
  const parsed = parseOutboundEvent(outboxEvent(overrides), 'event');
  if (parsed.kind !== 'ok') throw new Error(`fixture is not a valid event: ${parsed.problems.join('; ')}`);
  return parsed.value;
}

function anAttempt(event: OutboundMarketingEvent, claimToken = 'claim-token-1'): DeliveryAttemptContext {
  return {
    outboxId: event.id,
    eventId: event.eventId,
    kind: event.kind,
    claimToken,
    ackKey: ackKeyFor(JUSTICEOS_CONSUMER_ID, event.id, claimToken),
    idempotencyKey: event.idempotencyKey,
    dedupeKey: event.dedupeKey,
    claimExpiresAt: LIVE_CLAIM_EXPIRES_AT,
    startedAt: '2026-09-24T12:00:00.000Z'
  };
}

describe('reading the outbox contract', () => {
  it('reads one event with everything JusticeOS needs to deliver and acknowledge it', () => {
    const listing = parseEventListing(resultOf(eventsEnvelope([outboxEvent()])));
    expect(listing.kind).toBe('ok');
    if (listing.kind !== 'ok') return;

    expect(listing.value.events[0]).toMatchObject({
      id: 'outbox_1',
      eventId: 'evt_1',
      // The public name, with the durable internal type kept beside it.
      kind: 'MARKETING_OPPORTUNITY_FOUND',
      internalType: 'DEMAND_OPPORTUNITY',
      severity: 'HIGH',
      significance: 'ACTION_REQUIRED',
      trade: 'GUTTERS',
      channel: 'GOOGLE_ORGANIC',
      recommendedAction: 'Publish a gutter service page for the uncaptured queries',
      ownerApprovalRequired: true,
      dedupeKey: 'AGENT|MARKETING_OPPORTUNITY_FOUND|gutters',
      idempotencyKey: 'evt_1:1'
    });
    expect(listing.value.events[0]?.delivery.status).toBe('PENDING');
    expect(listing.value.events[0]?.freshness.emittedAt).toBe('2026-09-24T12:00:00.000Z');
    expect(listing.value.counts.PENDING).toBe(1);
  });

  it('passes an unmapped internal type through under its own name rather than renaming it', () => {
    const event = anEvent({ kind: 'GOAL_AT_RISK', internalType: 'GOAL_AT_RISK' });
    expect(event.kind).toBe('GOAL_AT_RISK');
    expect(event.internalType).toBe('GOAL_AT_RISK');
  });

  it('refuses an event with no outbox id, kind, or idempotency key rather than patching one in', () => {
    for (const missing of ['id', 'kind', 'idempotencyKey']) {
      const raw = outboxEvent();
      delete raw[missing];
      const parsed = parseOutboundEvent(raw, 'event');
      expect(parsed.kind, `${missing} must be structurally required`).toBe('invalid');
    }
  });

  it('fails the whole batch rather than silently dropping one unreadable event', () => {
    const raw = outboxEvent({ id: 'outbox_2' });
    delete raw.idempotencyKey;
    const listing = parseEventListing({ events: [outboxEvent(), raw], counts: {}, nextCursor: null });
    // A dropped event is one nobody is ever told about — the single failure
    // this transport exists to make impossible.
    expect(listing.kind).toBe('invalid');
  });

  it('treats an unreadable owner-approval flag as needing Austin, never as go-ahead', () => {
    const raw = outboxEvent();
    delete raw.ownerApprovalRequired;
    expect(anEventFrom(raw).ownerApprovalRequired).toBe(true);
    expect(anEvent({ ownerApprovalRequired: false }).ownerApprovalRequired).toBe(false);
  });

  it('refuses a claim with no token, because nothing it returned could ever be acknowledged', () => {
    const noToken = claimEnvelope([outboxEvent()], { claimToken: '' });
    expect(parseClaim(resultOf(noToken)).kind).toBe('invalid');
  });

  it('reads a claim token, its expiry, and the events it now holds', () => {
    const claim = parseClaim(resultOf(claimEnvelope([outboxEvent()])));
    expect(claim.kind).toBe('ok');
    if (claim.kind !== 'ok') return;
    expect(claim.value.claimToken).toBe('claim-token-1');
    expect(claim.value.expiresAt).toBe(LIVE_CLAIM_EXPIRES_AT);
    expect(claim.value.events).toHaveLength(1);
  });

  it('reads a replayed acknowledgement as a replay, and a fresh one as fresh', () => {
    const replayed = parseAckOutcome(resultOf(ackEnvelope({ replayed: true })));
    const fresh = parseAckOutcome(resultOf(ackEnvelope()));
    expect(replayed.kind === 'ok' && replayed.value.replayed).toBe(true);
    expect(fresh.kind === 'ok' && fresh.value.replayed).toBe(false);
  });

  it('does not upgrade a missing replay flag into a replay', () => {
    // Counting a fresh acknowledgement as a replay would hide a real second
    // attempt, which is the more damaging of the two mistakes.
    const parsed = parseAckOutcome({ outboxId: 'outbox_1', result: 'DELIVERED', status: 'DELIVERED', attempts: 1 });
    expect(parsed.kind === 'ok' && parsed.value.replayed).toBe(false);
  });
});

function anEventFrom(raw: Record<string, unknown>): OutboundMarketingEvent {
  const parsed = parseOutboundEvent(raw, 'event');
  if (parsed.kind !== 'ok') throw new Error(parsed.problems.join('; '));
  return parsed.value;
}

describe('the ack key', () => {
  it('is stable within one claim, so an uncertain acknowledgement can be re-sent verbatim', () => {
    expect(ackKeyFor('c', 'outbox_1', 'token-a')).toBe(ackKeyFor('c', 'outbox_1', 'token-a'));
  });

  it('differs across claims, so a genuine second attempt is counted as one', () => {
    expect(ackKeyFor('c', 'outbox_1', 'token-a')).not.toBe(ackKeyFor('c', 'outbox_1', 'token-b'));
  });

  it('differs per event within one claim', () => {
    expect(ackKeyFor('c', 'outbox_1', 'token-a')).not.toBe(ackKeyFor('c', 'outbox_2', 'token-a'));
  });
});

describe('the retained event store', () => {
  it('records an observed event as NEW — reading is never delivering', () => {
    const store = new MarketingEventStore();
    store.observe([anEvent()]);
    expect(store.list()[0]?.status).toBe('NEW');
    expect(store.list()[0]?.delivery.acknowledged).toBe(false);
  });

  it('keeps the first-seen time and moves only the last-seen time', () => {
    let clock = Date.parse('2026-09-24T12:00:00.000Z');
    const store = new MarketingEventStore(() => new Date(clock));
    store.observe([anEvent()]);
    clock += 60_000;
    store.observe([anEvent()]);
    expect(store.list()[0]?.firstSeenAt).toBe('2026-09-24T12:00:00.000Z');
    expect(store.list()[0]?.lastSeenAt).toBe('2026-09-24T12:01:00.000Z');
  });

  it('counts a delivery attempt when one begins, and carries the whole claim context', () => {
    const store = new MarketingEventStore();
    const event = anEvent();
    const attempt = anAttempt(event);
    const retained = store.beginDelivery(event, attempt);

    expect(retained.status).toBe('DELIVERING');
    expect(retained.delivery.attempts).toBe(1);
    // Every field an acknowledgement needs, persisted with the attempt rather
    // than recomputed when the claim may be all that is left of it.
    expect(retained.attempt).toMatchObject({
      outboxId: 'outbox_1',
      claimToken: 'claim-token-1',
      idempotencyKey: 'evt_1:1',
      dedupeKey: 'AGENT|MARKETING_OPPORTUNITY_FOUND|gutters',
      kind: 'MARKETING_OPPORTUNITY_FOUND',
      claimExpiresAt: LIVE_CLAIM_EXPIRES_AT
    });
    expect(retained.attempt?.ackKey).toBe(attempt.ackKey);
  });

  it('treats a terminally-handled event as already handled, and a retrying one as not', () => {
    const store = new MarketingEventStore();
    const event = anEvent();
    store.beginDelivery(event, anAttempt(event));

    store.settle(event.id, 'RETRY_PENDING', { acknowledgedResult: 'FAILED_RETRYABLE', acknowledged: true });
    expect(store.alreadyHandled(event), 'a retryable failure must stay deliverable').toBeNull();

    store.settle(event.id, 'DELIVERED', { acknowledgedResult: 'DELIVERED', acknowledged: true });
    expect(store.alreadyHandled(event)?.status).toBe('DELIVERED');
  });

  it('recognises a second outbox row for the same occurrence by its idempotency key', () => {
    const store = new MarketingEventStore();
    const first = anEvent();
    store.beginDelivery(first, anAttempt(first));
    store.settle(first.id, 'DELIVERED', { acknowledgedResult: 'DELIVERED', acknowledged: true });

    // A different row, the same (event, occurrence) — the agent's own unique handle.
    const reissued = anEvent({ id: 'outbox_2' });
    expect(store.alreadyHandled(reissued)?.id).toBe('outbox_1');
  });

  it('does not treat a genuine recurrence as already handled, even though the dedupe key matches', () => {
    const store = new MarketingEventStore();
    const first = anEvent();
    store.beginDelivery(first, anAttempt(first));
    store.settle(first.id, 'DELIVERED', { acknowledgedResult: 'DELIVERED', acknowledged: true });

    // Same problem, new occurrence: the agent decided it was worth raising again.
    const recurrence = anEvent({ id: 'outbox_2', eventId: 'evt_1', idempotencyKey: 'evt_1:2', occurrenceCount: 2 });
    expect(store.alreadyHandled(recurrence)).toBeNull();
  });

  it('keeps "delivered" and "Marketing knows it was delivered" as separate facts', () => {
    const store = new MarketingEventStore();
    const event = anEvent();
    store.beginDelivery(event, anAttempt(event));
    store.settle(event.id, 'DELIVERED', { acknowledgedResult: 'DELIVERED', acknowledged: false, detail: 'ack timed out' });

    const retained = store.list()[0]!;
    expect(retained.status).toBe('DELIVERED');
    expect(retained.delivery.acknowledged).toBe(false);
    expect(retained.delivery.acknowledgedResult).toBe('DELIVERED');
  });

  it('retains a dismissed event so the app can still show it', () => {
    const store = new MarketingEventStore();
    store.observe([anEvent()]);
    expect(store.dismiss('outbox_1')?.dismissedAt).not.toBeNull();
    expect(store.list()).toHaveLength(1);
    expect(store.list({ includeDismissed: false })).toHaveLength(0);
    expect(store.get('outbox_1')).not.toBeNull();
  });

  it('does not resurrect a dismissed event when the outbox reports it again', () => {
    const store = new MarketingEventStore();
    store.observe([anEvent()]);
    store.dismiss('outbox_1');
    store.observe([anEvent()]);
    expect(store.list()[0]?.dismissedAt).not.toBeNull();
  });

  it('counts only undismissed events the agent says need Austin', () => {
    const store = new MarketingEventStore();
    store.observe([anEvent({ ownerApprovalRequired: true }), anEvent({ id: 'outbox_2', idempotencyKey: 'evt_2:1', ownerApprovalRequired: false })]);
    expect(store.countAwaitingOwner()).toBe(1);
    store.dismiss('outbox_1');
    expect(store.countAwaitingOwner()).toBe(0);
  });

  it('reports every status the dashboard distinguishes', () => {
    const store = new MarketingEventStore();
    store.observe([anEvent()]);
    expect(store.counts().byStatus).toEqual({ NEW: 1, DELIVERING: 0, DELIVERED: 0, DUPLICATE: 0, RETRY_PENDING: 0, FAILED: 0 });
  });
});

describe('the Communications handoff', () => {
  it('sends what happened and never how to tell anyone about it', () => {
    const sent = envelopeFor(anEvent());
    expect(sent.payload.eventKind).toBe('MARKETING_OPPORTUNITY_FOUND');
    expect(sent.payload.internalType).toBe('DEMAND_OPPORTUNITY');
    expect(sent.payload.ownerApprovalRequired).toBe(true);
    // No channel preference, no recipient, no template, no send time: those
    // are the Communications Agent's decisions.
    const serialized = JSON.stringify(sent).toLowerCase();
    for (const forbidden of ['email', 'sms', 'phone', 'recipient', 'channelpreference', 'sendat', 'template', 'notify']) {
      expect(serialized, `the envelope must not carry "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('carries the agent’s own identifiers rather than inventing one', () => {
    const sent = envelopeFor(anEvent());
    expect(sent.idempotencyKey).toBe('evt_1:1');
    expect(sent.payload.outboxId).toBe('outbox_1');
    expect(sent.payload.dedupeKey).toBe('AGENT|MARKETING_OPPORTUNITY_FOUND|gutters');
    expect(sent.consumer).toBe(JUSTICEOS_CONSUMER_ID);
  });

  it('classifies an answer by what a second identical request would do', () => {
    expect(classifyStatus(202)).toBe('ACCEPTED');
    expect(classifyStatus(409)).toBe('DUPLICATE');
    // The receiver refused THIS message: the same envelope fails forever.
    expect(classifyStatus(400)).toBe('FINAL');
    expect(classifyStatus(422)).toBe('FINAL');
    // The receiver refused US, or could not answer: a human fixes those.
    expect(classifyStatus(401)).toBe('RETRYABLE');
    expect(classifyStatus(429)).toBe('RETRYABLE');
    expect(classifyStatus(503)).toBe('RETRYABLE');
  });

  it('presents the Communications credential and never the Marketing one', async () => {
    const seen: { authorization?: string; idempotencyKey?: string; body?: string } = {};
    const handoff = createHttpCommunicationsHandoff({
      endpoint: 'http://communications.internal/api/v1/marketing-events',
      apiKey: 'communications-only-key',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        seen.authorization = headers.authorization;
        seen.idempotencyKey = headers['idempotency-key'];
        seen.body = String(init?.body);
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 202, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch
    });

    const event = anEvent();
    const receipt = await handoff.deliver(event, anAttempt(event));

    expect(seen.authorization).toBe('Bearer communications-only-key');
    expect(seen.idempotencyKey).toBe('evt_1:1');
    expect(seen.body).not.toContain('marketing-agent-api-key');
    expect(receipt.outcome).toBe('ACCEPTED');
  });

  it('records a 409 from the receiver as a duplicate, not a delivery and not a failure', async () => {
    const handoff = createHttpCommunicationsHandoff({
      endpoint: 'http://communications.internal/api/v1/marketing-events',
      apiKey: 'communications-only-key',
      fetchImpl: (async () => new Response('{}', { status: 409, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    });
    const event = anEvent();
    expect((await handoff.deliver(event, anAttempt(event))).outcome).toBe('DUPLICATE');
  });

  it('treats a receiver that cannot be reached as retryable, and does not retry it here', async () => {
    let calls = 0;
    const handoff = createHttpCommunicationsHandoff({
      endpoint: 'http://communications.internal/api/v1/marketing-events',
      apiKey: 'communications-only-key',
      fetchImpl: (async () => {
        calls += 1;
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch
    });
    const event = anEvent();
    const receipt = await handoff.deliver(event, anAttempt(event));

    // Retrying is the outbox's job, and it does it properly — with a backoff
    // and a ceiling. A second immediate POST would be a retry storm.
    expect(calls).toBe(1);
    expect(receipt.outcome).toBe('RETRYABLE');
  });

  it('reports NOT_CONFIGURED rather than a delivery nobody made', async () => {
    const event = anEvent();
    const receipt = await notConfiguredHandoff.deliver(event, anAttempt(event));
    expect(notConfiguredHandoff.configured).toBe(false);
    expect(receipt.outcome).toBe('NOT_CONFIGURED');
  });
});
