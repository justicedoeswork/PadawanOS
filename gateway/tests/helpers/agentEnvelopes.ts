/**
 * Answer envelopes shaped exactly as the Marketing Agent produces them
 * (its `domain/agent/padawan-response.ts` `answer()` output).
 *
 * Hand-built rather than captured, and every field present: the whole point of
 * the contract tests is that JusticeOS refuses an envelope missing a field, so
 * a fixture that quietly omitted one would make those tests pass for the wrong
 * reason.
 */
export interface EnvelopeOverrides {
  readonly contractVersion?: string;
  readonly status?: 'OK' | 'DEGRADED' | 'UNAVAILABLE';
  readonly headline?: readonly string[];
  readonly confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  readonly evidence?: readonly unknown[];
  readonly dataGaps?: readonly string[];
  readonly freshness?: readonly unknown[];
  readonly nextActions?: readonly unknown[];
  readonly ownerDecisionRequired?: boolean;
  readonly asOf?: string;
}

export function envelope(operation: string, result: unknown, overrides: EnvelopeOverrides = {}): Record<string, unknown> {
  return {
    agent: 'MARKETING_AGENT',
    contractVersion: overrides.contractVersion ?? '1',
    operation,
    asOf: overrides.asOf ?? '2026-09-24T12:00:00.000Z',
    status: overrides.status ?? 'OK',
    headline: overrides.headline ?? [`${operation} answered.`],
    result,
    confidence: overrides.confidence ?? 'HIGH',
    evidence: overrides.evidence ?? [],
    dataGaps: overrides.dataGaps ?? [],
    freshness: overrides.freshness ?? [],
    nextActions: overrides.nextActions ?? [],
    ownerDecisionRequired: overrides.ownerDecisionRequired ?? false,
    dataEnvironment: 'LIVE'
  };
}

/** A healthy agent: database reachable, every job having succeeded, nothing degraded or blocked. */
export function healthEnvelope(overrides: { readonly degraded?: readonly string[]; readonly blocked?: readonly string[]; readonly database?: 'REACHABLE' | 'UNREACHABLE'; readonly lastSuccessAt?: string | null } = {}): Record<string, unknown> {
  const database = overrides.database ?? 'REACHABLE';
  const lastSuccessAt = overrides.lastSuccessAt === undefined ? '2026-09-24T11:00:00.000Z' : overrides.lastSuccessAt;
  const blocked = overrides.blocked ?? (database === 'UNREACHABLE' ? ['Database is unreachable — the agent can answer nothing'] : []);
  return envelope(
    'health',
    {
      service: 'UP',
      database,
      scheduler: { state: 'IDLE', jobsConfigured: 2, jobsFailing: 0 },
      jobs: [
        { key: 'OPPORTUNITY_RECOMPUTE', lastSuccessAt, consecutiveFailures: 0, purpose: 'Rebuild opportunities from stored evidence.' },
        { key: 'MARKETING_BRIEF', lastSuccessAt, consecutiveFailures: 0, purpose: 'Regenerate the current brief.' }
      ],
      lastSuccessfulSyncs: { OPPORTUNITY_RECOMPUTE: lastSuccessAt, MARKETING_BRIEF: lastSuccessAt },
      degraded: overrides.degraded ?? [],
      blocked
    },
    {
      status: database === 'UNREACHABLE' ? 'UNAVAILABLE' : (overrides.degraded?.length ?? 0) + blocked.length > 0 ? 'DEGRADED' : 'OK',
      headline: ['The Marketing Agent is up and its database is reachable.'],
      dataGaps: overrides.degraded ?? []
    }
  );
}

export function dataSourcesEnvelope(providers: readonly Record<string, unknown>[], gaps: readonly string[] = []): Record<string, unknown> {
  return envelope(
    'dataSources',
    {
      providers,
      demand: { configured: true, currentRunId: 'run_1', collectedAt: '2026-09-24T06:00:00.000Z', configHash: 'hash' },
      websiteResearch: { configured: true, eligiblePages: 12, newestObservedAt: '2026-09-22T06:00:00.000Z', detail: 'Stored evidence.' },
      outcomes: { configured: true, checkpoint: '2026-09-24T06:00:00.000Z', stale: false },
      analytics: { configured: true, checkpoint: '2026-09-24T06:00:00.000Z' }
    },
    { status: gaps.length > 0 ? 'DEGRADED' : 'OK', dataGaps: gaps }
  );
}

/** One `changesSinceLastBrief` row, as the brief carries them. */
export function eventRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: 'MARKETING_OPPORTUNITY_FOUND',
    severity: 'INFO',
    significance: 'NOTABLE',
    title: 'Gutter guard demand is rising in Greenville',
    summary: 'Search demand for gutter guards rose 38% against its baseline.',
    detailedReasoning: 'Stored demand evidence across the current collection run.',
    trade: 'GUTTERS',
    channel: null,
    detectedAt: '2026-09-23T09:00:00.000Z',
    lastDetectedAt: '2026-09-24T09:00:00.000Z',
    occurrences: 2,
    ownerAttentionRequired: false,
    ...overrides
  };
}

/**
 * One outbound event, exactly as the Marketing Agent's outbox projection
 * carries it (its `EventOutboxService.project()` output at commit 70e69d7).
 *
 * Every field present, including the ones JusticeOS treats as optional: the
 * contract tests prove that JusticeOS refuses an event missing a structural
 * field, so a fixture that quietly omitted one would make them pass for the
 * wrong reason.
 */
export function outboxEvent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const delivery = { status: 'PENDING', attempts: 0, claimToken: null, claimExpiresAt: null, lastAttemptAt: null, deliveredAt: null, lastError: null };
  return {
    id: 'outbox_1',
    eventId: 'evt_1',
    kind: 'MARKETING_OPPORTUNITY_FOUND',
    internalType: 'DEMAND_OPPORTUNITY',
    severity: 'HIGH',
    significance: 'ACTION_REQUIRED',
    trade: 'GUTTERS',
    channel: 'GOOGLE_ORGANIC',
    title: 'Gutter demand is going uncaptured',
    summary: 'Three high-intent gutter queries have no ranking page.',
    detailedReasoning: 'Derived from stored evidence only; no provider was called.',
    evidence: [{ kind: 'DEMAND_OPPORTUNITY', ref: 'opportunity-1', detail: { score: 71 } }],
    recommendedAction: 'Publish a gutter service page for the uncaptured queries',
    recommendedDeadline: null,
    ownerApprovalRequired: true,
    task: null,
    firstDetectedAt: '2026-09-24T12:00:00.000Z',
    lastDetectedAt: '2026-09-24T12:00:00.000Z',
    occurrenceCount: 1,
    confidence: 0.82,
    dedupeKey: 'AGENT|MARKETING_OPPORTUNITY_FOUND|gutters',
    idempotencyKey: 'evt_1:1',
    correlationId: null,
    schemaVersion: '1',
    dataEnvironment: 'LIVE',
    ...overrides,
    delivery: { ...delivery, ...((overrides.delivery as Record<string, unknown>) ?? {}) },
    freshness: {
      emittedAt: '2026-09-24T12:00:00.000Z',
      enqueuedAt: '2026-09-24T12:00:01.000Z',
      detectedAt: '2026-09-24T12:00:00.000Z',
      ...((overrides.freshness as Record<string, unknown>) ?? {})
    }
  };
}

/** `GET /agent/events` — a read with no side effects. */
export function eventsEnvelope(events: readonly unknown[], options: { readonly counts?: Record<string, number>; readonly nextCursor?: string | null } = {}): Record<string, unknown> {
  return envelope(
    'events',
    {
      events,
      counts: options.counts ?? { PENDING: events.length, CLAIMED: 0, DELIVERED: 0, DUPLICATE: 0, FAILED: 0 },
      nextCursor: options.nextCursor ?? null,
      filters: { status: 'PENDING', kind: 'EVENT', after: null }
    },
    {
      headline: [
        events.length === 0 ? 'Nothing is waiting to be delivered.' : `${events.length} marketing event(s) are waiting to be delivered.`,
        'Reading them changes nothing — claim an event before delivering it.'
      ]
    }
  );
}

/**
 * A claim expiry the relay will still consider live.
 *
 * Relative to now rather than a fixed timestamp, and deliberately so: the
 * relay compares the expiry against the real clock to decide whether it has
 * time to deliver, so a hard-coded date would silently start failing the day
 * the suite ran past it. Ten minutes matches the relay's own TTL.
 */
export const LIVE_CLAIM_EXPIRES_AT = new Date(Date.now() + 10 * 60_000).toISOString();

/** `POST /agent/events/claim` — ownership taken, with the token every acknowledgement must present. */
export function claimEnvelope(
  events: readonly unknown[],
  options: { readonly claimToken?: string; readonly expiresAt?: string | null } = {}
): Record<string, unknown> {
  const claimToken = options.claimToken ?? 'claim-token-1';
  const expiresAt = options.expiresAt === undefined ? LIVE_CLAIM_EXPIRES_AT : options.expiresAt;
  return envelope(
    'claimEvents',
    { claimToken, events, expiresAt },
    {
      headline: [
        events.length === 0 ? 'Nothing was due, so nothing was claimed.' : `Claimed ${events.length} event(s) until ${expiresAt}.`,
        'Acknowledge each one with this claim token. An unacknowledged claim lapses and the events are offered again.'
      ]
    }
  );
}

/** `POST /agent/events/:id/ack` — what the agent recorded about one attempt. */
export function ackEnvelope(
  options: {
    readonly outboxId?: string;
    readonly result?: string;
    readonly status?: string;
    readonly attempts?: number;
    readonly willRetry?: boolean;
    readonly nextAttemptAt?: string | null;
    readonly replayed?: boolean;
    readonly history?: readonly unknown[];
  } = {}
): Record<string, unknown> {
  const result = options.result ?? 'DELIVERED';
  const status = options.status ?? (result === 'FAILED_RETRYABLE' ? 'PENDING' : result === 'FAILED_FINAL' ? 'FAILED' : result);
  const willRetry = options.willRetry ?? status === 'PENDING';
  return envelope(
    'acknowledgeEvent',
    {
      outboxId: options.outboxId ?? 'outbox_1',
      result,
      status,
      attempts: options.attempts ?? 1,
      willRetry,
      nextAttemptAt: options.nextAttemptAt ?? (willRetry ? '2026-09-24T12:01:00.000Z' : null),
      reason: options.replayed === true ? 'This acknowledgement was already recorded; replaying it rather than counting a second attempt.' : 'The consumer delivered it.',
      replayed: options.replayed ?? false,
      history: options.history ?? []
    },
    { headline: ['The acknowledgement was recorded.'] }
  );
}

/** The Marketing Agent's own refusal bodies for the transport, as `src/api/errors.ts` shapes them. */
export function eventErrorBody(code: 'EVENT_CLAIM_INVALID' | 'EVENT_ALREADY_FINAL' | 'EVENT_NOT_FOUND', details: Record<string, unknown> = {}): Record<string, unknown> {
  const messages: Record<string, string> = {
    EVENT_CLAIM_INVALID: 'The claim on this outbox event has expired and it may already be in another consumer’s hands. Claim it again.',
    EVENT_ALREADY_FINAL: 'This outbox event is already settled; a new acknowledgement would overwrite settled evidence.',
    EVENT_NOT_FOUND: 'No outbox event with that id in this dataset.'
  };
  return { error: { code, message: messages[code], details } };
}

export function briefEnvelope(
  options: {
    readonly changes?: readonly unknown[];
    readonly blockers?: readonly string[];
    readonly dataGaps?: readonly string[];
    readonly ownerDecisionRequired?: boolean;
    readonly nextActions?: readonly unknown[];
    readonly headline?: readonly string[];
  } = {}
): Record<string, unknown> {
  return envelope(
    'brief',
    {
      kind: 'DAILY_MARKETING_BRIEF',
      brief: { overallHealth: 'Marketing is steady; gutter demand is the one thing moving.', period: { end: '2026-09-24' }, dataGaps: options.dataGaps ?? [], ownerTasks: [] },
      topOpportunities: [{ id: 'opp_1', primaryQuery: 'gutter guards greenville', opportunityScore: 82, confidence: 0.81, trade: 'GUTTERS' }],
      changesSinceLastBrief: options.changes ?? [],
      evidenceStrength: { collectionRunId: 'run_1', opportunityConfidence: 0.81, businessOutcomes: 'AVAILABLE', websitePerformance: 'AVAILABLE' },
      blockers: options.blockers ?? [],
      actionsRequiringOwnerApproval: [],
      collectionRunId: 'run_1'
    },
    {
      headline: options.headline ?? [
        'Marketing is steady; gutter demand is the one thing moving.',
        'The strongest current opportunity is "gutter guards greenville".',
        '0 recommended action(s) need Austin’s decision.'
      ],
      dataGaps: options.dataGaps ?? [],
      nextActions: options.nextActions ?? [],
      ownerDecisionRequired: options.ownerDecisionRequired ?? false,
      freshness: [{ dataAsOf: '2026-09-24T06:00:00.000Z', source: 'demand', stale: false, staleAfterHours: 48 }]
    }
  );
}

/** A prepared owner-review website package: prepared, unpublished, and waiting on Austin. */
export function websitePackageEnvelope(options: { readonly trade?: string; readonly factsAvailable?: boolean } = {}): Record<string, unknown> {
  const trade = options.trade ?? 'GUTTERS';
  const factsAvailable = options.factsAvailable !== false;
  const gaps = factsAvailable ? [] : ['Verified business facts are not available in this deployment — no claim can be fact-checked'];
  return envelope(
    'prepareWork',
    {
      kind: 'WEBSITE_IMPROVEMENT_PACKAGE',
      trade,
      prepared: true,
      published: false,
      requiresOwnerApproval: true,
      asOf: '2026-09-24T12:00:00.000Z',
      collectionRunId: 'run_1',
      recommendations: [{ trade, title: `Rewrite the ${trade} service page around the demand evidence` }],
      analysis: { trade },
      website: {},
      verifiedFacts: factsAvailable
        ? { usableCount: 4, blockedCount: 1, missingKinds: [], usable: [], blocked: [] }
        : { usableCount: null, blockedCount: null, missingKinds: [], usable: [], blocked: [] },
      publicationGate: 'OWNER_REVIEW_REQUIRED — this agent cannot publish website changes, with or without approval.'
    },
    {
      headline: [
        `An owner-review package for ${trade} was prepared from stored evidence: 1 recommendation(s).`,
        factsAvailable ? '4 verified fact(s) are usable in public copy; 1 are not.' : 'Verified facts were unavailable, so no claim in this package is fact-checked.',
        'Nothing was published and the live website was not touched.'
      ],
      dataGaps: gaps,
      evidence: factsAvailable
        ? [
            { kind: 'COMPETITOR_BENCHMARK', ref: 'hash', detail: { collectionRunId: 'run_1', status: 'OK' } },
            { kind: 'BUSINESS_FACTS', ref: '/data/justice-business-facts.json' }
          ]
        : [{ kind: 'COMPETITOR_BENCHMARK', ref: 'hash', detail: { collectionRunId: 'run_1', status: 'OK' } }],
      nextActions: [
        { action: `Review and approve the ${trade} website package`, reason: 'Public copy changes are Austin’s decision, and this agent cannot make them.', requiresOwnerApproval: true }
      ],
      ownerDecisionRequired: true,
      confidence: factsAvailable ? 'MEDIUM' : 'LOW'
    }
  );
}

export function researchPlanEnvelope(options: { readonly executionAllowed?: boolean; readonly notDue?: readonly string[] } = {}): Record<string, unknown> {
  const executionAllowed = options.executionAllowed === true;
  return envelope(
    'requestResearch',
    {
      kind: 'WEBSITE',
      request: { competitor: 'examplecompetitor.test', trade: null, reason: null },
      executed: false,
      dryRun: true,
      plan: { status: executionAllowed ? 'READY' : 'NOT_DUE', executionAllowed, totals: { targets: 3 }, requestBreakdown: { total: 6 }, skipped: [] }
    },
    {
      headline: [
        executionAllowed ? 'A website research run would make 6 provider request(s) across 3 target(s).' : 'No website research is due: NOT_DUE.',
        'Nothing was fetched and nothing was spent.'
      ],
      dataGaps: (options.notDue ?? []).map((name) => `${name}: cooldown not met`)
    }
  );
}

export function decisionEnvelope(revisionId: string, decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION'): Record<string, unknown> {
  if (decision === 'REQUEST_REVISION') {
    return envelope('decide', { revisionId, decision, applied: false, published: false }, {
      headline: ['Recorded as a revision request. The proposal is still pending and nothing was applied.'],
      ownerDecisionRequired: true
    });
  }
  return envelope(
    'decide',
    {
      revisionId,
      decision,
      approvalState: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      decidedAt: '2026-09-24T12:05:00.000Z',
      applied: decision === 'APPROVE',
      published: false
    },
    {
      headline: [
        decision === 'APPROVE' ? 'The plan revision is approved and is now the effective plan.' : 'The plan revision was rejected; the effective plan is unchanged.',
        'Nothing was published and no campaign was created.'
      ]
    }
  );
}
