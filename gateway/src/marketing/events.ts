/**
 * Marketing events, from the agent that raised them to the app Austin looks
 * at — and, separately, to whoever decides he should be told.
 *
 * The division of labour is the whole point and is not negotiable here:
 * **Marketing decides what matters. Communications decides how Austin hears
 * about it.** The Marketing Agent never emails or texts anyone; it records an
 * event and hands an envelope to its outbox. JusticeOS relays. The
 * Communications Agent chooses the channel, the timing, and whether to send
 * at all.
 *
 * Where the events come from, precisely: the Marketing Agent's
 * `GET /agent/brief` carries `result.changesSinceLastBrief`, which is its open
 * intelligence events already narrowed to the seven JusticeOS-facing kinds
 * and already collapsed by its own dedupe lifecycle (one row per problem,
 * with an occurrence count). That read is free — stored evidence, no provider
 * call — which is what makes polling it an acceptable transport.
 *
 * What this is NOT: a drain of the Marketing Agent's
 * `marketing_communication_outbox` table. That table is the durable handoff
 * ledger and its own header comment names "the JusticeOS shared backend /
 * event queue" as the eventual reader — but the agent contract exposes no
 * endpoint over it and JusticeOS has no shared backend to read it with. The
 * brief is the transport the contract actually offers today; the outbox
 * remains the more faithful path and is recorded as a blocker rather than
 * quietly worked around.
 */

/** The seven kinds the Marketing Agent speaks to JusticeOS in. Anything else is retained but not classified. */
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

export type HandoffState = 'PENDING' | 'DELIVERED' | 'DUPLICATE' | 'NOT_CONFIGURED' | 'FAILED';

export interface MarketingEvent {
  /** Stable across re-ingestion of the same underlying event. See `identityOf`. */
  readonly id: string;
  readonly kind: string;
  readonly severity: string | null;
  readonly significance: string | null;
  readonly title: string;
  readonly summary: string;
  readonly trade: string | null;
  readonly channel: string | null;
  /** When the Marketing Agent first detected it. Stable — this is the agent's own first-detection time, not ours. */
  readonly detectedAt: string | null;
  readonly lastDetectedAt: string | null;
  readonly occurrences: number;
  readonly ownerAttentionRequired: boolean;
  /** When JusticeOS first saw it. Never revised — a re-ingest updates `lastSeenAt` instead. */
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly handoff: { readonly state: HandoffState; readonly ref: string | null; readonly at: string | null; readonly detail: string | null };
  /**
   * Set when Austin dismisses the notification. The event itself is kept:
   * dismissing a notification means "stop telling me", not "this never
   * happened", and the app must still be able to show it.
   */
  readonly dismissedAt: string | null;
}

/**
 * The identity of one event.
 *
 * The contract's `changesSinceLastBrief` rows do not carry the agent's
 * internal dedupe key, so this reconstructs an equivalent from the fields
 * that are stable across occurrences: what kind of thing it is, what it is
 * about, and when it was first detected. The occurrence count and
 * `lastDetectedAt` deliberately do NOT participate — a recurring problem
 * must stay one event, which is exactly what the agent's own dedupe already
 * decided.
 */
export function identityOf(row: { kind: string; title: string; trade: string | null; channel: string | null; detectedAt: string | null }): string {
  return [row.kind, row.trade ?? '-', row.channel ?? '-', row.detectedAt ?? '-', row.title].join('|');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** One `changesSinceLastBrief` row, read defensively. */
export interface IngestedEvent {
  readonly kind: string;
  readonly severity: string | null;
  readonly significance: string | null;
  readonly title: string;
  readonly summary: string;
  readonly trade: string | null;
  readonly channel: string | null;
  readonly detectedAt: string | null;
  readonly lastDetectedAt: string | null;
  readonly occurrences: number;
  readonly ownerAttentionRequired: boolean;
}

/**
 * Pulls the event rows out of a brief answer's `result`. A brief that carries
 * none (or carries something unrecognizable) yields none — never a fabricated
 * event, and never a thrown error that would take the brief down with it.
 */
export function eventsInBriefResult(result: unknown): readonly IngestedEvent[] {
  if (!isRecord(result) || !Array.isArray(result.changesSinceLastBrief)) return [];
  const rows: IngestedEvent[] = [];
  for (const raw of result.changesSinceLastBrief) {
    if (!isRecord(raw)) continue;
    const kind = stringOrNull(raw.kind);
    const title = stringOrNull(raw.title);
    if (!kind || !title) continue;
    rows.push({
      kind,
      severity: stringOrNull(raw.severity),
      significance: stringOrNull(raw.significance),
      title,
      summary: stringOrNull(raw.summary) ?? '',
      trade: stringOrNull(raw.trade),
      channel: stringOrNull(raw.channel),
      detectedAt: stringOrNull(raw.detectedAt),
      lastDetectedAt: stringOrNull(raw.lastDetectedAt),
      occurrences: typeof raw.occurrences === 'number' && Number.isFinite(raw.occurrences) ? raw.occurrences : 1,
      ownerAttentionRequired: raw.ownerAttentionRequired === true
    });
  }
  return rows;
}

export interface IngestSummary {
  readonly received: number;
  readonly created: number;
  readonly updated: number;
  /** Events handed to Communications on this pass. Only ever newly-created ones. */
  readonly handedOff: number;
  readonly events: readonly MarketingEvent[];
}

export interface CommunicationsHandoff {
  readonly configured: boolean;
  deliver(event: MarketingEvent): Promise<{ readonly state: HandoffState; readonly ref: string | null; readonly detail: string | null }>;
}

/**
 * JusticeOS's retained view of what the Marketing Agent has raised.
 *
 * In process memory, and said plainly rather than implied otherwise: the
 * gateway holds no database. The durable record is upstream — the Marketing
 * Agent's own event rows and its outbox table — and this store is a
 * projection of it plus JusticeOS's handoff ledger, rebuilt by the next sync
 * after a restart. The consequence is written down in
 * docs/marketing-agent-padawan-integration.md rather than left to be
 * discovered: across a gateway restart, delivery de-duplication depends on
 * the RECEIVER honouring the idempotency key it is sent.
 */
export class MarketingEventStore {
  private readonly events = new Map<string, MarketingEvent>();

  constructor(
    private readonly handoff: CommunicationsHandoff,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Records what the agent reported, and hands NEW events to Communications.
   *
   * An event seen again is updated (occurrence count, last detection) and
   * deliberately not re-delivered: the Marketing Agent already decided that a
   * recurrence is the same problem, and JusticeOS re-notifying on every poll
   * would turn that one decision into a notification every few minutes.
   */
  async ingest(rows: readonly IngestedEvent[]): Promise<IngestSummary> {
    const at = this.now().toISOString();
    let created = 0;
    let updated = 0;
    let handedOff = 0;
    const touched: MarketingEvent[] = [];

    for (const row of rows) {
      const id = identityOf(row);
      const existing = this.events.get(id);

      if (existing) {
        const next: MarketingEvent = {
          ...existing,
          severity: row.severity,
          significance: row.significance,
          summary: row.summary,
          lastDetectedAt: row.lastDetectedAt,
          occurrences: row.occurrences,
          ownerAttentionRequired: row.ownerAttentionRequired,
          lastSeenAt: at
        };
        this.events.set(id, next);
        touched.push(next);
        updated += 1;
        continue;
      }

      const receipt = await this.handoff.deliver({
        id,
        ...row,
        firstSeenAt: at,
        lastSeenAt: at,
        handoff: { state: 'PENDING', ref: null, at: null, detail: null },
        dismissedAt: null
      });

      const event: MarketingEvent = {
        id,
        ...row,
        firstSeenAt: at,
        lastSeenAt: at,
        handoff: { state: receipt.state, ref: receipt.ref, at, detail: receipt.detail },
        dismissedAt: null
      };
      this.events.set(id, event);
      touched.push(event);
      created += 1;
      if (receipt.state === 'DELIVERED' || receipt.state === 'DUPLICATE') handedOff += 1;
    }

    return { received: rows.length, created, updated, handedOff, events: touched };
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

  /** Marks the notification dismissed. The event is kept, and a later recurrence updates it in place rather than resurrecting it. */
  dismiss(id: string): MarketingEvent | null {
    const event = this.events.get(id);
    if (!event) return null;
    const next: MarketingEvent = { ...event, dismissedAt: event.dismissedAt ?? this.now().toISOString() };
    this.events.set(id, next);
    return next;
  }

  /** How many events are waiting on Austin — the count the dashboard's attention card shows. */
  countAwaitingOwner(): number {
    return this.list({ includeDismissed: false }).filter((event) => event.ownerAttentionRequired).length;
  }
}
