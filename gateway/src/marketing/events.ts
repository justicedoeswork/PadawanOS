/**
 * JusticeOS's retained view of what the Marketing Agent has raised, and the
 * receiver-side idempotency that sits in front of the Communications handoff.
 *
 * The division of labour is the whole point and is not negotiable here:
 * **Marketing decides what matters. Communications decides how Austin hears
 * about it.** The Marketing Agent never emails or texts anyone; it records an
 * event in its durable outbox. JusticeOS claims it, relays it, and reports
 * what happened. The Communications Agent chooses the channel, the timing,
 * and whether to send at all.
 *
 * Where the events come from, precisely: the Marketing Agent's
 * `MarketingCommunicationOutbox`, through its `/agent/events`,
 * `/agent/events/claim` and `/agent/events/:id/ack` endpoints. That table is
 * insert-only and undeletable, its content is frozen by a database trigger,
 * and only its delivery state may move — which is what makes it safe to treat
 * as the source of truth. See `eventRelay.ts` for the lifecycle and
 * `outboxEvents.ts` for the contract.
 *
 * What this is NOT, any more: a reconstruction of events from a brief's
 * `changesSinceLastBrief`. That was the transport while the outbox had no
 * endpoint of its own. It has one now, and the brief is back to being what it
 * always was — user-facing intelligence, not a queue.
 */
import type { OutboundMarketingEvent } from './outboxEvents.js';

/**
 * Where one event stands in JusticeOS.
 *
 * These are JusticeOS's states, not the outbox's: they describe what this
 * gateway has done about an event, which is a different question from what the
 * outbox row says. They line up deliberately, though — `DELIVERED`,
 * `DUPLICATE` and `FAILED` mean the same thing on both sides, so a reader
 * comparing the two is comparing like with like.
 *
 *   NEW            Seen, not yet taken. Either never claimed, or read only.
 *   DELIVERING     Claimed and in flight to Communications right now.
 *   DELIVERED      Communications accepted it.
 *   DUPLICATE      Already handled — ours or the receiver's idempotency said so.
 *   RETRY_PENDING  A transient failure; the outbox will offer it again.
 *   FAILED         Permanently undeliverable, and kept as such.
 */
export type MarketingEventStatus = 'NEW' | 'DELIVERING' | 'DELIVERED' | 'DUPLICATE' | 'RETRY_PENDING' | 'FAILED';

/** A status nothing further will happen to from JusticeOS's side. */
const TERMINAL: ReadonlySet<MarketingEventStatus> = new Set<MarketingEventStatus>(['DELIVERED', 'DUPLICATE', 'FAILED']);

export function isTerminalStatus(status: MarketingEventStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * The claim context one delivery attempt carries.
 *
 * Every field here is persisted with the attempt rather than recomputed at
 * acknowledgement time, because at that point the attempt may be all that is
 * left of it: `claimToken` must go back UNCHANGED (it is the proof of
 * ownership), and `ackKey` must be reused verbatim on an uncertain retry so
 * Marketing's unique `(outboxId, ackKey)` replays the recorded result instead
 * of counting a second attempt.
 */
export interface DeliveryAttemptContext {
  readonly outboxId: string;
  readonly eventId: string | null;
  readonly kind: string;
  readonly claimToken: string;
  readonly ackKey: string;
  readonly idempotencyKey: string;
  readonly dedupeKey: string | null;
  /** When the claim lapses upstream, when the agent supplied it. Null means it did not. */
  readonly claimExpiresAt: string | null;
  readonly startedAt: string;
}

/** What JusticeOS recorded about the last thing that happened to this event. */
export interface DeliveryLedgerEntry {
  readonly status: MarketingEventStatus;
  readonly at: string;
  /** The receiver's own reference for the delivery, when it gave one. */
  readonly ref: string | null;
  readonly detail: string | null;
  /** What JusticeOS reported upstream, once it has. Null before the acknowledgement. */
  readonly acknowledgedResult: string | null;
  /** False when the acknowledgement could not be confirmed. The event is NOT reported as settled upstream. */
  readonly acknowledged: boolean;
  readonly attempts: number;
}

/** One retained event: the agent's own projection, plus what JusticeOS has done about it. */
export interface MarketingEvent {
  /** The outbox row id. Stable, upstream-assigned, and the id an acknowledgement names. */
  readonly id: string;
  readonly event: OutboundMarketingEvent;
  readonly status: MarketingEventStatus;
  /** When JusticeOS first saw it. Never revised — seeing it again updates `lastSeenAt`. */
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly delivery: DeliveryLedgerEntry;
  /** The claim context of the attempt in flight, or of the last one made. Null before any claim. */
  readonly attempt: DeliveryAttemptContext | null;
  /**
   * Set when Austin dismisses the notification. The event itself is kept, here
   * and upstream: dismissing means "stop telling me", not "this never
   * happened". JusticeOS has no way to delete an outbox row and would not use
   * one if it had.
   */
  readonly dismissedAt: string | null;
}

/** What Communications said about one event. JusticeOS classifies the transport; Communications owns the decision. */
export type HandoffOutcome = 'ACCEPTED' | 'DUPLICATE' | 'RETRYABLE' | 'FINAL' | 'NOT_CONFIGURED';

export interface HandoffReceipt {
  readonly outcome: HandoffOutcome;
  readonly ref: string | null;
  readonly detail: string | null;
}

export interface CommunicationsHandoff {
  readonly configured: boolean;
  deliver(event: OutboundMarketingEvent, context: DeliveryAttemptContext): Promise<HandoffReceipt>;
}

export interface EventCounts {
  readonly retained: number;
  readonly awaitingOwner: number;
  readonly byStatus: Readonly<Record<MarketingEventStatus, number>>;
}

/**
 * JusticeOS's retained view, and its receiver-side duplicate protection.
 *
 * In process memory, and said plainly rather than implied otherwise: the
 * gateway holds no database. The durable record is upstream — the outbox row
 * is insert-only and undeletable, and every acknowledgement is appended to an
 * immutable log there — and this store is a projection of it plus JusticeOS's
 * own delivery ledger. A restart loses the projection, not the record.
 *
 * The consequence is written down in
 * docs/marketing-agent-padawan-integration.md rather than left to be
 * discovered: across a gateway restart, JusticeOS's own duplicate protection
 * is gone, and de-duplication falls back to the two layers that survive —
 * Marketing's outbox status (a delivered event is never offered again) and the
 * receiver honouring the idempotency key it is sent.
 */
export class MarketingEventStore {
  private readonly events = new Map<string, MarketingEvent>();
  /** idempotencyKey → outbox id. The receiver-side dedupe index: one entry per (event, occurrence). */
  private readonly handledKeys = new Map<string, string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Records what the outbox says, without taking or delivering anything.
   *
   * Used for the read-only pass — the one that runs when no Communications
   * endpoint is configured, so Austin can still see in the app what the agent
   * has raised. It deliberately cannot advance an event's status: observing an
   * event is not delivering it, on this side of the wire exactly as on the
   * agent's.
   */
  observe(events: readonly OutboundMarketingEvent[]): readonly MarketingEvent[] {
    const at = this.now().toISOString();
    const touched: MarketingEvent[] = [];
    for (const event of events) {
      const existing = this.events.get(event.id);
      const next: MarketingEvent = existing
        ? { ...existing, event, lastSeenAt: at }
        : {
            id: event.id,
            event,
            status: 'NEW',
            firstSeenAt: at,
            lastSeenAt: at,
            delivery: { status: 'NEW', at, ref: null, detail: null, acknowledgedResult: null, acknowledged: false, attempts: 0 },
            attempt: null,
            dismissedAt: null
          };
      this.events.set(event.id, next);
      touched.push(next);
    }
    return touched;
  }

  /**
   * Whether JusticeOS has already handled this event, by its own record.
   *
   * Keyed on the idempotency key rather than the outbox id, because that is
   * the handle the Marketing Agent guarantees is unique per (event,
   * occurrence): two outbox rows for the same occurrence would share it, and
   * re-delivering the second would be a second notification about one thing.
   * The dedupe key is deliberately NOT used — it is stable across
   * recurrences, and a genuine recurrence is a new occurrence that the agent
   * decided was worth raising again.
   */
  alreadyHandled(event: OutboundMarketingEvent): MarketingEvent | null {
    const byKey = this.handledKeys.get(event.idempotencyKey);
    const candidate = byKey ? this.events.get(byKey) : this.events.get(event.id);
    if (!candidate) return null;
    return isTerminalStatus(candidate.status) ? candidate : null;
  }

  /** Takes the event into flight. Records the whole claim context, because acknowledging needs all of it. */
  beginDelivery(event: OutboundMarketingEvent, attempt: DeliveryAttemptContext): MarketingEvent {
    const at = this.now().toISOString();
    const existing = this.events.get(event.id);
    const next: MarketingEvent = {
      id: event.id,
      event,
      status: 'DELIVERING',
      firstSeenAt: existing?.firstSeenAt ?? at,
      lastSeenAt: at,
      delivery: {
        status: 'DELIVERING',
        at,
        ref: null,
        detail: null,
        acknowledgedResult: null,
        acknowledged: false,
        attempts: (existing?.delivery.attempts ?? 0) + 1
      },
      attempt,
      dismissedAt: existing?.dismissedAt ?? null
    };
    this.events.set(event.id, next);
    return next;
  }

  /**
   * Records how one attempt ended.
   *
   * `acknowledged` is separate from the status on purpose. "Communications
   * took it" and "Marketing knows Communications took it" are different facts,
   * and an acknowledgement that timed out leaves the second one false while the
   * first stays true — which is exactly the state the same-`ackKey` retry
   * exists to resolve.
   */
  settle(
    outboxId: string,
    status: MarketingEventStatus,
    detail: { readonly ref?: string | null; readonly detail?: string | null; readonly acknowledgedResult?: string | null; readonly acknowledged?: boolean } = {}
  ): MarketingEvent | null {
    const existing = this.events.get(outboxId);
    if (!existing) return null;
    const at = this.now().toISOString();
    const next: MarketingEvent = {
      ...existing,
      status,
      lastSeenAt: at,
      delivery: {
        status,
        at,
        ref: detail.ref ?? existing.delivery.ref,
        detail: detail.detail ?? null,
        acknowledgedResult: detail.acknowledgedResult ?? null,
        acknowledged: detail.acknowledged === true,
        attempts: existing.delivery.attempts
      }
    };
    this.events.set(outboxId, next);
    // The dedupe index records what was HANDLED, not what was merely seen, so
    // a retryable failure stays deliverable on the next pass.
    if (isTerminalStatus(status)) this.handledKeys.set(existing.event.idempotencyKey, outboxId);
    return next;
  }

  /** Newest first. Dismissed events are included unless asked otherwise — the app can still show them. */
  list(options: { readonly includeDismissed?: boolean } = {}): readonly MarketingEvent[] {
    const all = [...this.events.values()];
    const kept = options.includeDismissed === false ? all.filter((event) => event.dismissedAt === null) : all;
    return kept.sort((a, b) => (b.lastSeenAt < a.lastSeenAt ? -1 : b.lastSeenAt > a.lastSeenAt ? 1 : 0));
  }

  get(id: string): MarketingEvent | null {
    return this.events.get(id) ?? null;
  }

  /**
   * Marks the notification dismissed.
   *
   * Local only, and that is the entire point: there is no upstream call here
   * and no endpoint to make one with. The outbox row is untouched, its
   * delivery record is untouched, and a later recurrence arrives as its own
   * event rather than resurrecting this one.
   */
  dismiss(id: string): MarketingEvent | null {
    const event = this.events.get(id);
    if (!event) return null;
    const next: MarketingEvent = { ...event, dismissedAt: event.dismissedAt ?? this.now().toISOString() };
    this.events.set(id, next);
    return next;
  }

  /** How many events are waiting on Austin — the count the dashboard's attention card shows. */
  countAwaitingOwner(): number {
    return this.list({ includeDismissed: false }).filter((event) => event.event.ownerApprovalRequired).length;
  }

  counts(): EventCounts {
    const byStatus: Record<MarketingEventStatus, number> = { NEW: 0, DELIVERING: 0, DELIVERED: 0, DUPLICATE: 0, RETRY_PENDING: 0, FAILED: 0 };
    for (const event of this.events.values()) byStatus[event.status] += 1;
    return { retained: this.events.size, awaitingOwner: this.countAwaitingOwner(), byStatus };
  }
}
