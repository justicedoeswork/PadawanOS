import { describe, it, expect } from 'vitest';
import {
  aggregateMarketingHealth,
  observeBusinessFacts,
  UNKNOWN_BUSINESS_FACTS,
  type MarketingHealthInputs
} from '../src/marketing/health.js';
import { normalizeAnswer, parseAgentAnswer } from '../src/marketing/contract.js';
import type { OperationOutcome } from '../src/marketing/operations.js';
import { dataSourcesEnvelope, envelope, healthEnvelope, websitePackageEnvelope } from './helpers/agentEnvelopes.js';

function answerOutcome(body: unknown): OperationOutcome {
  const parsed = parseAgentAnswer(body);
  if (parsed.kind !== 'answer') throw new Error('fixture is not a valid envelope');
  return { kind: 'answer', answer: normalizeAnswer(parsed.envelope), deduped: false, originalTaskId: null };
}

function inputs(overrides: Partial<MarketingHealthInputs> = {}): MarketingHealthInputs {
  return {
    configured: true,
    actorConfigured: true,
    reachability: 'REACHABLE',
    health: answerOutcome(healthEnvelope()),
    dataSources: answerOutcome(dataSourcesEnvelope([{ id: 'ga4', displayName: 'GA4', state: 'CONNECTED', freshness: 'FRESH', latestDataThrough: '2026-09-24', detail: '' }])),
    schedulerOwner: 'MARKETING_INTERNAL_LOOP',
    researchExecution: 'EXECUTE_ALLOWED',
    businessFacts: { state: 'AVAILABLE', observedAt: '2026-09-24T12:00:00.000Z', detail: null },
    events: { retained: 0, awaitingOwner: 0, handoffConfigured: true, lastSyncAt: null },
    checkedAt: '2026-09-24T12:00:00.000Z',
    ...overrides
  };
}

describe('a healthy deployment', () => {
  it('reports HEALTHY with nothing degraded or blocked', () => {
    const report = aggregateMarketingHealth(inputs());
    expect(report.state).toBe('HEALTHY');
    expect(report.degraded).toEqual([]);
    expect(report.blocked).toEqual([]);
  });

  it('reports the last successful monitoring cycle', () => {
    expect(aggregateMarketingHealth(inputs()).agent.lastSuccessfulCycleAt).toBe('2026-09-24T11:00:00.000Z');
  });

  it('says so when monitoring has never completed a cycle', () => {
    const report = aggregateMarketingHealth(inputs({ health: answerOutcome(healthEnvelope({ lastSuccessAt: null })) }));
    expect(report.agent.lastSuccessfulCycleAt).toBeNull();
  });
});

/**
 * The rule that makes this report worth reading: a missing or failing
 * integration means the agent knows less, not that it is down.
 */
describe('a degraded integration is not an outage', () => {
  it('keeps a provider authentication failure out of blocked', () => {
    const report = aggregateMarketingHealth(
      inputs({
        health: answerOutcome(healthEnvelope({ blocked: ['DataForSEO: authentication failed'] })),
        dataSources: answerOutcome(
          dataSourcesEnvelope([{ id: 'dataforseo', displayName: 'DataForSEO', state: 'AUTH_ERROR', freshness: 'STALE', latestDataThrough: null, detail: '' }])
        )
      })
    );
    expect(report.state).toBe('DEGRADED');
    expect(report.blocked).toEqual([]);
    expect(report.providerAuthFailures).toEqual(['DataForSEO: authentication failed']);
  });

  it('lists stale sources without blocking', () => {
    const report = aggregateMarketingHealth(
      inputs({
        dataSources: answerOutcome(
          dataSourcesEnvelope([{ id: 'ga4', displayName: 'GA4', state: 'CONNECTED', freshness: 'STALE', latestDataThrough: '2026-08-01', detail: '' }])
        )
      })
    );
    expect(report.state).toBe('DEGRADED');
    expect(report.staleSources).toContain('GA4 (latest 2026-08-01)');
    expect(report.blocked).toEqual([]);
  });

  it('reports a data-sources refusal as degraded while the agent itself is fine', () => {
    const report = aggregateMarketingHealth(
      inputs({ dataSources: { kind: 'agent-error', status: 503, body: { error: { code: 'DEMAND_NOT_CONFIGURED', message: '', details: {} } } } })
    );
    expect(report.state).toBe('DEGRADED');
    expect(report.degraded.some((line) => line.includes('DEMAND_NOT_CONFIGURED'))).toBe(true);
    expect(report.blocked).toEqual([]);
  });
});

describe('what genuinely blocks', () => {
  it('blocks when the agent cannot reach its own database', () => {
    const report = aggregateMarketingHealth(inputs({ health: answerOutcome(healthEnvelope({ database: 'UNREACHABLE' })) }));
    expect(report.state).toBe('BLOCKED');
    expect(report.blocked.some((line) => line.includes('database'))).toBe(true);
  });

  it('blocks, and names the versions, on an unsupported contract', () => {
    const report = aggregateMarketingHealth(inputs({ health: { kind: 'unsupported-contract', found: '2', operation: 'health' } }));
    expect(report.state).toBe('BLOCKED');
    expect(report.contract).toMatchObject({ expected: '1', upstream: '2', compatible: false });
    expect(report.blocked[0]).toContain('contract version 2');
  });

  it('blocks when the agent did not answer the health probe', () => {
    const report = aggregateMarketingHealth(inputs({ health: { kind: 'unavailable', reason: 'timeout' }, reachability: 'UNREACHABLE' }));
    expect(report.state).toBe('BLOCKED');
    expect(report.blocked.some((line) => line.includes('timeout'))).toBe(true);
  });

  it('is NOT_CONFIGURED, not blocked, when the integration was never set up here', () => {
    const report = aggregateMarketingHealth(inputs({ configured: false, reachability: 'NOT_CONFIGURED', health: null, dataSources: null }));
    expect(report.state).toBe('NOT_CONFIGURED');
  });
});

describe('what only JusticeOS knows', () => {
  it('names the scheduler owner and says JusticeOS does not drive ticks', () => {
    const report = aggregateMarketingHealth(inputs());
    expect(report.scheduler).toEqual({ owner: 'MARKETING_INTERNAL_LOOP', justiceOsDrivesTicks: false, disabled: false });
  });

  it('degrades when nothing is ticking the agent at all', () => {
    const report = aggregateMarketingHealth(inputs({ schedulerOwner: 'NONE' }));
    expect(report.state).toBe('DEGRADED');
    expect(report.scheduler.disabled).toBe(true);
  });

  it('reports the plan-only research posture, and that JusticeOS can never trigger paid research', () => {
    const report = aggregateMarketingHealth(inputs({ researchExecution: 'PLAN_ONLY' }));
    expect(report.research).toEqual({ posture: 'PLAN_ONLY', justiceOsMayTriggerPaidResearch: false });
    expect(report.degraded.some((line) => line.includes('paid research'))).toBe(true);
  });

  it('reports a missing facts artifact as degraded drafting, never as an outage', () => {
    const report = aggregateMarketingHealth(
      inputs({ businessFacts: { state: 'UNAVAILABLE', observedAt: '2026-09-24T12:00:00.000Z', detail: 'Verified business facts are not available in this deployment' } })
    );
    expect(report.state).toBe('DEGRADED');
    expect(report.blocked).toEqual([]);
    expect(report.businessFacts.state).toBe('UNAVAILABLE');
  });

  it('admits it does not know the facts state rather than guessing', () => {
    const report = aggregateMarketingHealth(inputs({ businessFacts: UNKNOWN_BUSINESS_FACTS }));
    expect(report.businessFacts.state).toBe('UNKNOWN');
    // Unknown is not a finding: probing it would mean preparing work nobody
    // asked for.
    expect(report.state).toBe('HEALTHY');
  });

  it('degrades when no Communications endpoint is wired, since nobody is being notified', () => {
    const report = aggregateMarketingHealth(inputs({ events: { retained: 3, awaitingOwner: 1, handoffConfigured: false, lastSyncAt: '2026-09-24T12:00:00.000Z' } }));
    expect(report.state).toBe('DEGRADED');
    expect(report.degraded.some((line) => line.includes('Communications Agent'))).toBe(true);
    expect(report.events.retained).toBe(3);
  });
});

describe('observing the verified-facts gate', () => {
  it('reads AVAILABLE off a prepared package that cites the facts file', () => {
    const parsed = parseAgentAnswer(websitePackageEnvelope());
    if (parsed.kind !== 'answer') throw new Error('bad fixture');
    expect(observeBusinessFacts(normalizeAnswer(parsed.envelope), 'now')).toMatchObject({ state: 'AVAILABLE' });
  });

  it('reads UNAVAILABLE off a package whose facts could not be read', () => {
    const parsed = parseAgentAnswer(websitePackageEnvelope({ factsAvailable: false }));
    if (parsed.kind !== 'answer') throw new Error('bad fixture');
    expect(observeBusinessFacts(normalizeAnswer(parsed.envelope), 'now')).toMatchObject({ state: 'UNAVAILABLE' });
  });

  it('learns nothing from an operation that does not touch the gate', () => {
    const parsed = parseAgentAnswer(envelope('brief', {}));
    if (parsed.kind !== 'answer') throw new Error('bad fixture');
    expect(observeBusinessFacts(normalizeAnswer(parsed.envelope), 'now')).toBeNull();
  });
});
