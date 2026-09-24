/**
 * The Marketing Agent's durable event outbox, as JusticeOS reads it.
 *
 * This is the AUTHORITATIVE event transport. The Marketing Agent's
 * `MarketingCommunicationOutbox` is an insert-only, undeletable table whose
 * content is frozen by a database trigger and whose delivery state is the only
 * thing that may move; its `/agent/events*` endpoints expose exactly that. A
 * brief is a view; the outbox is a record, and a consumer reads the record.
 *
 * What this module does, and deliberately nothing more:
 *
 *   1. It reads the three transport results out of the agent's answer
 *      envelope — the listing, the claim, and the acknowledgement — and
 *      FAILS CLOSED. An event without an outbox id, a kind, or an
 *      idempotency key is not an event JusticeOS can deliver or acknowledge,
 *      so it is refused by name rather than patched up with a default.
 *   2. It reproduces no marketing semantics. `kind`, `severity`,
 *      `significance`, `ownerApprovalRequired` and `recommendedAction` are
 *      the Marketing Agent's own judgements, relayed. JusticeOS re-derives
 *      none of them, which is the whole reason the temporary path that
 *      reconstructed events from `changesSinceLastBrief` was retired.
 *
 * `kind` is the public `MARKETING_*` name where the agent has one;
 * `internalType` is always its durable internal type. An internal type with
 * no public equivalent arrives under its own name, and JusticeOS passes it
 * through unchanged rather than inventing a public name for it.
 */

/** The event-transport contract version JusticeOS was built against. Distinct value, same envelope as every other operation. */
export const EXPECTED_EVENT_CONTRACT_VERSION = '1';

/**
 * The one JusticeOS consumer identity, for the whole deployment and every
 * deploy of it.
 *
 * It is a constant rather than a generated or configured value, and that is
 * the point. The Marketing Agent stamps `claimedBy` and every delivery-log row
 * with this name, so it is how an operator answers "who took that event, and
 * who said it was delivered" months later. A per-process or per-event name
 * would make that question unanswerable and would make the audit log unreadable
 * after the first restart. It names a ROLE — the relay that carries marketing
 * events to Communications — never a person, a machine, or a credential.
 */
export const JUSTICEOS_CONSUMER_ID = 'justiceos-communications-relay';

/** The public kinds the Marketing Agent maps its internal types onto. Informational: an unmapped kind is relayed, not dropped. */
export const MARKETING_EVENT_KINDS = [
  'MARKETING_OPPORTUNITY_FOUND',
  'MARKETING_PERFORMANCE_DROP',
  'MARKETING_PERFORMANCE_GAIN',
  'MARKETING_DATA_STALE',
  'MARKETING_RESEARCH_COMPLETED',
  'MARKETING_APPROVAL_REQUIRED',
  'MARKETING_PROVIDER_BLOCKED'
] as const;

export type MarketingEventKind = (typeof MARKETING_EVENT_KINDS)[number];

/** Where an event stands upstream. JusticeOS reads these; it never asserts them. */
export type OutboxStatus = 'PENDING' | 'CLAIMED' | 'DELIVERED' | 'DUPLICATE' | 'FAILED';

/** What a consumer may report back. The four are distinct on purpose — see `eventRelay.ts`. */
export const DELIVERY_RESULTS = ['DELIVERED', 'DUPLICATE', 'FAILED_RETRYABLE', 'FAILED_FINAL'] as const;
export type DeliveryResult = (typeof DELIVERY_RESULTS)[number];

/** One outbound marketing event, exactly as the agent's projection carries it. */
export interface OutboundMarketingEvent {
  /** The outbox row id. This is the id an acknowledgement names, and the id JusticeOS keys its retained copy on. */
  readonly id: string;
  /** The intelligence event behind it; stable across recurrences. Null when the agent did not carry one. */
  readonly eventId: string | null;
  /** The public `MARKETING_*` name where one exists, else the durable internal type unchanged. */
  readonly kind: string;
  /** Always the durable internal type, so a public rename upstream can never lose it. */
  readonly internalType: string;
  readonly severity: string | null;
  readonly significance: string | null;
  readonly trade: string | null;
  readonly channel: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly detailedReasoning: string | null;
  readonly evidence: unknown;
  readonly recommendedAction: string | null;
  readonly recommendedDeadline: string | null;
  /** The agent's judgement that this is waiting on Austin. Never an instruction to contact him. */
  readonly ownerApprovalRequired: boolean;
  readonly task: unknown;
  readonly firstDetectedAt: string | null;
  readonly lastDetectedAt: string | null;
  readonly occurrenceCount: number | null;
  readonly confidence: number | null;
  /** Stable identity of the underlying problem. Two rows about the same problem share it. */
  readonly dedupeKey: string | null;
  /** Unique per (event, occurrence). The receiver's dedupe handle, and JusticeOS's own. */
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
  readonly schemaVersion: string | null;
  readonly dataEnvironment: string | null;
  readonly delivery: {
    readonly status: string;
    readonly attempts: number;
    readonly claimToken: string | null;
    readonly claimExpiresAt: string | null;
    readonly lastAttemptAt: string | null;
    readonly deliveredAt: string | null;
    readonly lastError: string | null;
  };
  readonly freshness: {
    readonly emittedAt: string | null;
    readonly enqueuedAt: string | null;
    readonly detectedAt: string | null;
  };
}

/** What a claim came back with. `claimToken` is the proof of ownership and is passed back UNCHANGED when acknowledging. */
export interface EventClaim {
  readonly claimToken: string;
  readonly expiresAt: string | null;
  readonly events: readonly OutboundMarketingEvent[];
}

/** What an acknowledgement came back with. `replayed` is how Marketing says "I already had this exact ack". */
export interface AckOutcome {
  readonly outboxId: string;
  readonly result: string;
  readonly status: string;
  readonly attempts: number;
  readonly willRetry: boolean;
  readonly nextAttemptAt: string | null;
  readonly reason: string;
  readonly replayed: boolean;
}

export interface EventListing {
  readonly events: readonly OutboundMarketingEvent[];
  readonly counts: Readonly<Record<string, number>>;
  readonly nextCursor: string | null;
}

export type Parsed<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'invalid'; readonly problems: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One event out of a listing or a claim.
 *
 * Three fields are structurally required and the rest are not, and the line is
 * drawn by what JusticeOS would be unable to do without them rather than by
 * what looks important: without `id` it cannot acknowledge, without
 * `idempotencyKey` it cannot dedupe, and without `kind` it is relaying an
 * unnamed thing. Everything else — a title, a summary, a trade — is marketing
 * content that the agent is entitled to leave null.
 */
export function parseOutboundEvent(raw: unknown, at: string): Parsed<OutboundMarketingEvent> {
  if (!isRecord(raw)) return { kind: 'invalid', problems: [`${at} is not an object`] };

  const problems: string[] = [];
  const id = str(raw.id);
  const kind = str(raw.kind);
  const idempotencyKey = str(raw.idempotencyKey);
  if (!id) problems.push(`${at}.id is missing — without the outbox id this event could never be acknowledged`);
  if (!kind) problems.push(`${at}.kind is missing`);
  if (!idempotencyKey) problems.push(`${at}.idempotencyKey is missing — without it JusticeOS cannot tell a repeat from a new event`);
  if (problems.length > 0) return { kind: 'invalid', problems };

  const delivery = isRecord(raw.delivery) ? raw.delivery : {};
  const freshness = isRecord(raw.freshness) ? raw.freshness : {};

  return {
    kind: 'ok',
    value: {
      id: id as string,
      eventId: str(raw.eventId),
      kind: kind as string,
      // Never renamed and never inferred: the internal type is the durable one,
      // and falling back to `kind` keeps them consistent rather than blank.
      internalType: str(raw.internalType) ?? (kind as string),
      severity: str(raw.severity),
      significance: str(raw.significance),
      trade: str(raw.trade),
      channel: str(raw.channel),
      title: str(raw.title),
      summary: str(raw.summary),
      detailedReasoning: str(raw.detailedReasoning),
      evidence: raw.evidence ?? [],
      recommendedAction: str(raw.recommendedAction),
      recommendedDeadline: str(raw.recommendedDeadline),
      // Absent is treated as "needs Austin", never as "go ahead": an unreadable
      // flag on an owner gate must fail toward the gate.
      ownerApprovalRequired: raw.ownerApprovalRequired !== false,
      task: raw.task ?? null,
      firstDetectedAt: str(raw.firstDetectedAt),
      lastDetectedAt: str(raw.lastDetectedAt),
      occurrenceCount: num(raw.occurrenceCount),
      confidence: num(raw.confidence),
      dedupeKey: str(raw.dedupeKey),
      idempotencyKey: idempotencyKey as string,
      correlationId: str(raw.correlationId),
      schemaVersion: str(raw.schemaVersion),
      dataEnvironment: str(raw.dataEnvironment),
      delivery: {
        status: str(delivery.status) ?? 'PENDING',
        attempts: num(delivery.attempts) ?? 0,
        claimToken: str(delivery.claimToken),
        claimExpiresAt: str(delivery.claimExpiresAt),
        lastAttemptAt: str(delivery.lastAttemptAt),
        deliveredAt: str(delivery.deliveredAt),
        lastError: str(delivery.lastError)
      },
      freshness: {
        emittedAt: str(freshness.emittedAt),
        enqueuedAt: str(freshness.enqueuedAt),
        detectedAt: str(freshness.detectedAt)
      }
    }
  };
}

function parseEventArray(raw: unknown, at: string): Parsed<readonly OutboundMarketingEvent[]> {
  if (!Array.isArray(raw)) return { kind: 'invalid', problems: [`${at} is missing or is not an array`] };
  const events: OutboundMarketingEvent[] = [];
  const problems: string[] = [];
  raw.forEach((entry, index) => {
    const parsed = parseOutboundEvent(entry, `${at}[${index}]`);
    if (parsed.kind === 'ok') events.push(parsed.value);
    else problems.push(...parsed.problems);
  });
  // One unreadable event fails the whole batch rather than being skipped: a
  // silently dropped event is one nobody is ever told about, which is the
  // single failure this transport exists to make impossible.
  return problems.length > 0 ? { kind: 'invalid', problems } : { kind: 'ok', value: events };
}

/** `GET /agent/events` — a read with no side effects. Fetching is deliberately not delivering. */
export function parseEventListing(result: unknown): Parsed<EventListing> {
  if (!isRecord(result)) return { kind: 'invalid', problems: ['the events result is not an object'] };
  const events = parseEventArray(result.events, 'result.events');
  if (events.kind === 'invalid') return events;
  const counts: Record<string, number> = {};
  if (isRecord(result.counts)) {
    for (const [status, value] of Object.entries(result.counts)) {
      if (typeof value === 'number' && Number.isFinite(value)) counts[status] = value;
    }
  }
  return { kind: 'ok', value: { events: events.value, counts, nextCursor: str(result.nextCursor) } };
}

/** `POST /agent/events/claim` — ownership taken. No token means no claim, whatever else the body says. */
export function parseClaim(result: unknown): Parsed<EventClaim> {
  if (!isRecord(result)) return { kind: 'invalid', problems: ['the claim result is not an object'] };
  const claimToken = str(result.claimToken);
  if (!claimToken) {
    return { kind: 'invalid', problems: ['result.claimToken is missing — without it JusticeOS could never acknowledge what it just took'] };
  }
  const events = parseEventArray(result.events, 'result.events');
  if (events.kind === 'invalid') return events;
  return { kind: 'ok', value: { claimToken, expiresAt: str(result.expiresAt), events: events.value } };
}

/** `POST /agent/events/:id/ack` — what the agent recorded. */
export function parseAckOutcome(result: unknown): Parsed<AckOutcome> {
  if (!isRecord(result)) return { kind: 'invalid', problems: ['the acknowledgement result is not an object'] };
  const outboxId = str(result.outboxId);
  const status = str(result.status);
  if (!outboxId) return { kind: 'invalid', problems: ['result.outboxId is missing'] };
  if (!status) return { kind: 'invalid', problems: ['result.status is missing'] };
  return {
    kind: 'ok',
    value: {
      outboxId,
      result: str(result.result) ?? '',
      status,
      attempts: num(result.attempts) ?? 0,
      willRetry: result.willRetry === true,
      nextAttemptAt: str(result.nextAttemptAt),
      reason: str(result.reason) ?? '',
      // Absent is treated as "not a replay": counting a fresh ack as a replay
      // would hide a real second attempt, which is the more damaging mistake.
      replayed: result.replayed === true
    }
  };
}
