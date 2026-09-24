import { describe, expect, it } from 'vitest';
import { approvalBadgeKey, decisionControlsFor, decisionLabelKey, panelViewFor, problemView, staleSourcesOf } from './viewModel';
import type { MarketingAnswer, ManagerAskResponse } from './types';

function answer(overrides: Partial<MarketingAnswer> = {}): MarketingAnswer {
  return {
    agent: 'MARKETING_AGENT',
    contractVersion: '1',
    operation: 'brief',
    asOf: '2026-09-24T12:00:00.000Z',
    status: 'OK',
    summary: ['Marketing is steady; gutter demand is the one thing moving.'],
    result: {},
    confidence: 'HIGH',
    evidence: [{ kind: 'DEMAND_OPPORTUNITY', ref: 'opp_1' }],
    recommendation: [],
    approvalRequirement: 'INFORMATIONAL',
    sourceFreshness: [],
    blockers: [],
    followUpActions: [],
    constraint: { kind: 'NONE', reason: '' },
    identifiers: { conversationId: null, taskId: 'task_1', idempotencyKey: null, collectionRunId: 'run_1', revisionId: null },
    dataEnvironment: 'LIVE',
    ...overrides,
  };
}

function askResponse(overrides: Partial<ManagerAskResponse> = {}): ManagerAskResponse {
  return {
    agent: 'marketing',
    contractVersion: '1',
    operation: 'brief',
    routing: { kind: 'execute', operation: 'brief', rationale: 'Read the current marketing brief.' },
    answer: answer(),
    approvalRequirement: 'INFORMATIONAL',
    pendingAction: null,
    task: { conversationId: null, taskId: 'task_1' },
    ...overrides,
  };
}

describe('an ordinary answer', () => {
  it('relays the agent own sentences without rewriting them', () => {
    const view = panelViewFor(askResponse());
    expect(view.kind).toBe('answer');
    if (view.kind !== 'answer') return;
    expect(view.summary).toEqual(['Marketing is steady; gutter demand is the one thing moving.']);
    expect(view.confidence).toBe('High');
    expect(view.evidenceCount).toBe(1);
  });

  it('offers no decision control at all', () => {
    const view = panelViewFor(askResponse());
    if (view.kind !== 'answer') throw new Error('expected an answer view');
    expect(view.decisions).toEqual([]);
  });

  it('says when an answer was replayed rather than newly asked', () => {
    const view = panelViewFor(askResponse({ deduped: true }));
    if (view.kind !== 'answer') throw new Error('expected an answer view');
    expect(view.deduped).toBe(true);
  });

  it('hides a constraint when nothing is holding the agent up', () => {
    const view = panelViewFor(askResponse());
    if (view.kind !== 'answer') throw new Error('expected an answer view');
    expect(view.constraint).toBeNull();
  });

  it('surfaces a constraint the agent reported', () => {
    const view = panelViewFor(
      askResponse({ answer: answer({ constraint: { kind: 'PROVIDER_BLOCKED', reason: 'DataForSEO: authentication failed' } }) }),
    );
    if (view.kind !== 'answer') throw new Error('expected an answer view');
    expect(view.constraint).toEqual({ kind: 'PROVIDER_BLOCKED', reason: 'DataForSEO: authentication failed' });
  });
});

/**
 * The rule the panel exists to keep: a control appears only for an answer the
 * AGENT said needs a decision, and only when there is a specific revision to
 * decide about.
 */
describe('decision controls', () => {
  it('appear for an approval-required answer that names its revision', () => {
    const controls = decisionControlsFor(
      answer({ approvalRequirement: 'APPROVAL_REQUIRED', identifiers: { ...answer().identifiers, revisionId: 'rev_9' } }),
    );
    expect(controls.map((control) => control.decision)).toEqual(['APPROVE', 'REJECT', 'REQUEST_REVISION']);
    expect(controls.every((control) => control.revisionId === 'rev_9')).toBe(true);
  });

  it('require a reason for a revision request and not for the other two', () => {
    const controls = decisionControlsFor(
      answer({ approvalRequirement: 'APPROVAL_REQUIRED', identifiers: { ...answer().identifiers, revisionId: 'rev_9' } }),
    );
    expect(controls.find((control) => control.decision === 'REQUEST_REVISION')?.reasonRequired).toBe(true);
    expect(controls.find((control) => control.decision === 'APPROVE')?.reasonRequired).toBe(false);
  });

  it('do NOT appear when the answer names no revision — an approve button with no object is worse than none', () => {
    expect(decisionControlsFor(answer({ approvalRequirement: 'APPROVAL_REQUIRED' }))).toEqual([]);
  });

  it('do not appear for merely prepared work, for information, or for a blocked answer', () => {
    for (const requirement of ['PREPARED_WORK', 'INFORMATIONAL', 'BLOCKED'] as const) {
      const controls = decisionControlsFor(
        answer({ approvalRequirement: requirement, identifiers: { ...answer().identifiers, revisionId: 'rev_9' } }),
      );
      expect(controls, requirement).toEqual([]);
    }
  });

  it('never appear because the answer was confident', () => {
    expect(decisionControlsFor(answer({ confidence: 'HIGH', approvalRequirement: 'INFORMATIONAL' }))).toEqual([]);
  });
});

describe('a request that was worded like an approval', () => {
  it('renders as a pending decision, with nothing decided', () => {
    const view = panelViewFor(
      askResponse({
        operation: 'decisions',
        routing: { kind: 'needs-confirmation', operation: 'decisions', rationale: 'Approving is a deliberate action.' },
        answer: null,
        approvalRequirement: 'APPROVAL_REQUIRED',
        pendingAction: {
          route: '/api/marketing/agent/decisions',
          method: 'POST',
          body: { revisionId: null, decision: 'APPROVE', confirmed: true },
          missing: ['revisionId'],
          note: 'Nothing has been decided.',
        },
      }),
    );
    expect(view.kind).toBe('pending-decision');
    if (view.kind !== 'pending-decision') return;
    expect(view.decision).toBe('APPROVE');
    expect(view.revisionId).toBeNull();
    expect(view.note).toBe('Nothing has been decided.');
  });
});

describe('problems', () => {
  it('marks a contract mismatch as an integration fault, not a marketing answer', () => {
    const view = problemView({ code: 'MARKETING_CONTRACT_UNSUPPORTED', message: 'found 2, supported 1', details: {} });
    expect(view.integration).toBe(true);
    expect(view.messageKey).toBe('manager.error.contract');
    expect(view.detail).toBe('found 2, supported 1');
  });

  it('marks an unreachable agent as unavailable rather than as an empty answer', () => {
    expect(problemView({ code: 'MARKETING_AGENT_UNAVAILABLE', message: '', details: {} })).toMatchObject({
      integration: false,
      messageKey: 'manager.error.unavailable',
    });
  });

  it('falls back to a generic message for a code it has no wording for', () => {
    expect(problemView({ code: 'ROUTE_NOT_FOUND', message: '', details: {} }).messageKey).toBe('manager.error.generic');
  });

  it('reports an answerless routed response as a problem rather than as "nothing going on"', () => {
    const view = panelViewFor(askResponse({ answer: null, pendingAction: null }));
    expect(view.kind).toBe('problem');
  });
});

describe('an unroutable request', () => {
  it('offers the agent suggestions rather than picking an operation', () => {
    const view = panelViewFor(
      askResponse({ routing: { kind: 'unroutable', reason: 'could not tell', suggestions: ['What opportunities do we have?'] }, answer: null }),
    );
    expect(view.kind).toBe('unroutable');
    if (view.kind !== 'unroutable') return;
    expect(view.suggestions).toEqual(['What opportunities do we have?']);
  });
});

describe('labels', () => {
  it('has a distinct badge for each of the four approval states', () => {
    const keys = (['INFORMATIONAL', 'PREPARED_WORK', 'APPROVAL_REQUIRED', 'BLOCKED'] as const).map(approvalBadgeKey);
    expect(new Set(keys).size).toBe(4);
  });

  it('has a label for each decision', () => {
    expect(decisionLabelKey('APPROVE')).toBe('manager.decision.approve');
    expect(decisionLabelKey('REJECT')).toBe('manager.decision.reject');
    expect(decisionLabelKey('REQUEST_REVISION')).toBe('manager.decision.revise');
  });
});

describe('stale sources', () => {
  it('names each out-of-date source and when it was last collected', () => {
    const rows = staleSourcesOf(
      answer({
        sourceFreshness: [
          { source: 'demand', dataAsOf: '2026-08-01T00:00:00.000Z', stale: true, staleAfterHours: 48 },
          { source: 'ga4', dataAsOf: null, stale: true, staleAfterHours: 24 },
          { source: 'acculynx-outcomes', dataAsOf: '2026-09-24T00:00:00.000Z', stale: false, staleAfterHours: 24 },
        ],
      }),
    );
    expect(rows).toEqual(['demand (latest 2026-08-01T00:00:00.000Z)', 'ga4 (latest never)']);
  });
});
