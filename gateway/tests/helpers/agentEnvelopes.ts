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
