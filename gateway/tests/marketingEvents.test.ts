import { describe, it, expect, vi } from 'vitest';
import { eventsInBriefResult, identityOf, MarketingEventStore, type CommunicationsHandoff, type MarketingEvent } from '../src/marketing/events.js';
import { createHttpCommunicationsHandoff, envelopeFor, notConfiguredHandoff } from '../src/marketing/communicationsHandoff.js';
import { briefEnvelope, eventRow } from './helpers/agentEnvelopes.js';
import { parseAgentAnswer, normalizeAnswer } from '../src/marketing/contract.js';

function recordingHandoff(): CommunicationsHandoff & { readonly delivered: MarketingEvent[] } {
  const delivered: MarketingEvent[] = [];
  return {
    configured: true,
    delivered,
    async deliver(event) {
      delivered.push(event);
      return { state: 'DELIVERED', ref: event.id, detail: null };
    }
  };
}

function briefResult(changes: readonly unknown[]): unknown {
  const parsed = parseAgentAnswer(briefEnvelope({ changes }));
  if (parsed.kind !== 'answer') throw new Error('fixture is not a valid envelope');
  return normalizeAnswer(parsed.envelope).result;
}

describe('reading events out of a brief', () => {
  it('finds the rows the brief carries', () => {
    const rows = eventsInBriefResult(briefResult([eventRow()]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'MARKETING_OPPORTUNITY_FOUND', trade: 'GUTTERS', occurrences: 2 });
  });

  it('yields nothing rather than inventing an event when the brief carries none', () => {
    expect(eventsInBriefResult(briefResult([]))).toEqual([]);
    expect(eventsInBriefResult({})).toEqual([]);
    expect(eventsInBriefResult(null)).toEqual([]);
    expect(eventsInBriefResult({ changesSinceLastBrief: 'nonsense' })).toEqual([]);
  });

  it('skips a row with no kind or no title rather than filing a nameless event', () => {
    const rows = eventsInBriefResult({ changesSinceLastBrief: [{ kind: 'MARKETING_DATA_STALE' }, { title: 'no kind' }, eventRow()] });
    expect(rows).toHaveLength(1);
  });
});

describe('event identity', () => {
  it('ignores the occurrence count and the last-detected time', () => {
    const first = eventRow({ occurrences: 1, lastDetectedAt: '2026-09-23T09:00:00.000Z' });
    const later = eventRow({ occurrences: 9, lastDetectedAt: '2026-09-30T09:00:00.000Z' });
    const [a] = eventsInBriefResult({ changesSinceLastBrief: [first] });
    const [b] = eventsInBriefResult({ changesSinceLastBrief: [later] });
    expect(identityOf(a!)).toBe(identityOf(b!));
  });

  it('separates the same kind of event about different trades', () => {
    const [a] = eventsInBriefResult({ changesSinceLastBrief: [eventRow({ trade: 'GUTTERS' })] });
    const [b] = eventsInBriefResult({ changesSinceLastBrief: [eventRow({ trade: 'ROOFING' })] });
    expect(identityOf(a!)).not.toBe(identityOf(b!));
  });
});

describe('the retained event store', () => {
  it('hands a new event to Communications exactly once, however many times it is seen again', async () => {
    const handoff = recordingHandoff();
    const store = new MarketingEventStore(handoff);
    const rows = eventsInBriefResult({ changesSinceLastBrief: [eventRow()] });

    const first = await store.ingest(rows);
    expect(first).toMatchObject({ received: 1, created: 1, updated: 0, handedOff: 1 });

    const second = await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow({ occurrences: 5 })] }));
    expect(second).toMatchObject({ received: 1, created: 0, updated: 1, handedOff: 0 });

    // One problem, one notification — the agent already decided a recurrence
    // is the same problem, and JusticeOS must not turn that into a message
    // every time it polls.
    expect(handoff.delivered).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.occurrences).toBe(5);
  });

  it('keeps the first-seen time and moves only the last-seen time', async () => {
    let clock = Date.parse('2026-09-24T12:00:00.000Z');
    const store = new MarketingEventStore(recordingHandoff(), () => new Date(clock));
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));
    clock += 60_000;
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));
    const event = store.list()[0]!;
    expect(event.firstSeenAt).toBe('2026-09-24T12:00:00.000Z');
    expect(event.lastSeenAt).toBe('2026-09-24T12:01:00.000Z');
  });

  it('retains a dismissed event so the app can still show it', async () => {
    const store = new MarketingEventStore(recordingHandoff());
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));
    const id = store.list()[0]!.id;

    expect(store.dismiss(id)?.dismissedAt).not.toBeNull();
    expect(store.list()).toHaveLength(1);
    expect(store.list({ includeDismissed: false })).toHaveLength(0);
    expect(store.get(id)).not.toBeNull();
  });

  it('does not resurrect a dismissed event when the same problem recurs', async () => {
    const store = new MarketingEventStore(recordingHandoff());
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));
    store.dismiss(store.list()[0]!.id);
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow({ occurrences: 7 })] }));
    expect(store.list()[0]?.dismissedAt).not.toBeNull();
  });

  it('counts only undismissed events that the agent says need Austin', async () => {
    const store = new MarketingEventStore(recordingHandoff());
    await store.ingest(
      eventsInBriefResult({
        changesSinceLastBrief: [
          eventRow({ ownerAttentionRequired: true, title: 'Needs Austin' }),
          eventRow({ ownerAttentionRequired: false, title: 'Just news' })
        ]
      })
    );
    expect(store.countAwaitingOwner()).toBe(1);
    store.dismiss(store.list().find((event) => event.title === 'Needs Austin')!.id);
    expect(store.countAwaitingOwner()).toBe(0);
  });
});

describe('the Communications handoff', () => {
  it('records NOT_CONFIGURED rather than reporting a delivery nobody made', async () => {
    const store = new MarketingEventStore(notConfiguredHandoff);
    const summary = await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));
    expect(summary.handedOff).toBe(0);
    expect(store.list()[0]?.handoff.state).toBe('NOT_CONFIGURED');
    // Still retained: dismissing a notification that was never sent is not
    // the same as the event not having happened.
    expect(store.list()).toHaveLength(1);
  });

  it('sends what happened and never how to tell anyone about it', () => {
    const [row] = eventsInBriefResult({ changesSinceLastBrief: [eventRow()] });
    const event: MarketingEvent = {
      id: identityOf(row!),
      ...row!,
      firstSeenAt: '2026-09-24T12:00:00.000Z',
      lastSeenAt: '2026-09-24T12:00:00.000Z',
      handoff: { state: 'PENDING', ref: null, at: null, detail: null },
      dismissedAt: null
    };
    const sent = envelopeFor(event);
    expect(sent.payload.eventKind).toBe('MARKETING_OPPORTUNITY_FOUND');
    expect(sent.payload.ownerAttentionRequired).toBe(false);
    // No channel, no recipient, no template, no send time: those are the
    // Communications Agent's decisions.
    const serialized = JSON.stringify(sent);
    for (const forbidden of ['email', 'sms', 'phone', 'recipient', 'channelPreference', 'sendAt', 'template', 'notify']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('presents the Communications credential and never the Marketing one', async () => {
    const seen: { authorization?: string; body?: string } = {};
    const handoff = createHttpCommunicationsHandoff({
      endpoint: 'http://communications.internal/api/v1/marketing-events',
      apiKey: 'communications-only-key',
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        seen.authorization = (init?.headers as Record<string, string>).authorization;
        seen.body = String(init?.body);
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 202, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch
    });

    const store = new MarketingEventStore(handoff);
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));

    expect(seen.authorization).toBe('Bearer communications-only-key');
    expect(seen.body).not.toContain('marketing-agent-api-key');
    expect(store.list()[0]?.handoff.state).toBe('DELIVERED');
  });

  it('records a 409 from the receiver as a duplicate, not a failure', async () => {
    const handoff = createHttpCommunicationsHandoff({
      endpoint: 'http://communications.internal/api/v1/marketing-events',
      apiKey: 'communications-only-key',
      fetchImpl: (async () => new Response(JSON.stringify({}), { status: 409, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    });
    const store = new MarketingEventStore(handoff);
    const summary = await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));
    expect(summary.handedOff).toBe(1);
    expect(store.list()[0]?.handoff.state).toBe('DUPLICATE');
  });

  it('does not retry a receiver that is down, and keeps the event anyway', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const handoff = createHttpCommunicationsHandoff({
      endpoint: 'http://communications.internal/api/v1/marketing-events',
      apiKey: 'communications-only-key',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const store = new MarketingEventStore(handoff);
    await store.ingest(eventsInBriefResult({ changesSinceLastBrief: [eventRow()] }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.list()[0]?.handoff.state).toBe('FAILED');
    expect(store.list()).toHaveLength(1);
  });

  it('sends the event identity as the idempotency key, so the receiver can dedupe across a gateway restart', () => {
    const [row] = eventsInBriefResult({ changesSinceLastBrief: [eventRow()] });
    const id = identityOf(row!);
    const sent = envelopeFor({
      id,
      ...row!,
      firstSeenAt: '2026-09-24T12:00:00.000Z',
      lastSeenAt: '2026-09-24T12:00:00.000Z',
      handoff: { state: 'PENDING', ref: null, at: null, detail: null },
      dismissedAt: null
    });
    expect(sent.idempotencyKey).toBe(id);
  });
});
