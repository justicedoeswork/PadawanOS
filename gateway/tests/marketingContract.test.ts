import { describe, it, expect } from 'vitest';
import {
  approvalRequirementOf,
  blockersOf,
  constraintOf,
  normalizeAnswer,
  parseAgentAnswer,
  SUPPORTED_CONTRACT_VERSIONS,
  type AgentAnswerEnvelope
} from '../src/marketing/contract.js';
import { briefEnvelope, envelope, healthEnvelope, websitePackageEnvelope } from './helpers/agentEnvelopes.js';

function parsed(body: unknown): AgentAnswerEnvelope {
  const result = parseAgentAnswer(body);
  if (result.kind !== 'answer') throw new Error(`expected an answer, got ${result.kind}`);
  return result.envelope;
}

describe('contract version handling', () => {
  it('accepts version 1, the contract this build was written against', () => {
    expect(SUPPORTED_CONTRACT_VERSIONS).toEqual(['1']);
    expect(parseAgentAnswer(briefEnvelope()).kind).toBe('answer');
  });

  it('fails closed on a newer contract version rather than parsing what it recognizes', () => {
    const result = parseAgentAnswer(envelope('brief', {}, { contractVersion: '2' }));
    expect(result).toEqual({ kind: 'unsupported-version', found: '2' });
  });

  it('reports an unsupported version even when the rest of the envelope is unreadable', () => {
    // A future contract will legitimately fail the field checks; calling that
    // "malformed" would send an operator hunting in the wrong service.
    const result = parseAgentAnswer({ contractVersion: '9', agent: 'SOMETHING_ELSE' });
    expect(result).toEqual({ kind: 'unsupported-version', found: '9' });
  });

  it('refuses a body with no contractVersion at all', () => {
    const result = parseAgentAnswer({ agent: 'MARKETING_AGENT', operation: 'brief', result: {} });
    expect(result.kind).toBe('invalid');
  });

  it('refuses a non-object body', () => {
    expect(parseAgentAnswer('ok').kind).toBe('invalid');
    expect(parseAgentAnswer(null).kind).toBe('invalid');
    expect(parseAgentAnswer([briefEnvelope()]).kind).toBe('invalid');
  });
});

describe('envelope validation', () => {
  it('names every missing required field rather than failing on the first', () => {
    const result = parseAgentAnswer({ contractVersion: '1', agent: 'MARKETING_AGENT' });
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.problems).toContain('operation is missing');
    expect(result.problems).toContain('result is missing');
    expect(result.problems).toContain('ownerDecisionRequired is missing');
  });

  it('refuses an envelope from a different agent', () => {
    const result = parseAgentAnswer(envelope('brief', {}));
    expect(result.kind).toBe('answer');
    const foreign = { ...envelope('brief', {}), agent: 'COMMUNICATIONS_AGENT' };
    expect(parseAgentAnswer(foreign).kind).toBe('invalid');
  });

  it('refuses an unrecognized status or confidence instead of treating it as OK', () => {
    expect(parseAgentAnswer({ ...envelope('brief', {}), status: 'FINE' }).kind).toBe('invalid');
    expect(parseAgentAnswer({ ...envelope('brief', {}), confidence: 'PRETTY_SURE' }).kind).toBe('invalid');
  });

  it('treats an action with an unreadable approval flag as needing approval', () => {
    const answer = parsed(envelope('brief', {}, { nextActions: [{ action: 'Do a thing', reason: 'because' }] }));
    expect(answer.nextActions[0]?.requiresOwnerApproval).toBe(true);
  });

  it('treats a freshness row with an unreadable stale flag as stale', () => {
    const answer = parsed(envelope('brief', {}, { freshness: [{ source: 'demand', dataAsOf: null }] }));
    expect(answer.freshness[0]?.stale).toBe(true);
  });

  it('drops malformed evidence links rather than inventing fields for them', () => {
    const answer = parsed(envelope('brief', {}, { evidence: [{ kind: 'DEMAND_OPPORTUNITY', ref: 'opp_1' }, { kind: 'BROKEN' }, 'nonsense'] }));
    expect(answer.evidence).toEqual([{ kind: 'DEMAND_OPPORTUNITY', ref: 'opp_1' }]);
  });
});

describe('approval requirement', () => {
  it('is INFORMATIONAL for an ordinary read', () => {
    expect(approvalRequirementOf(parsed(briefEnvelope()))).toBe('INFORMATIONAL');
  });

  it('is APPROVAL_REQUIRED when the agent says a decision is pending', () => {
    expect(approvalRequirementOf(parsed(websitePackageEnvelope()))).toBe('APPROVAL_REQUIRED');
  });

  it('is PREPARED_WORK for something prepared with nothing waiting on Austin', () => {
    const prepared = envelope('prepareWork', { kind: 'MARKETING_BRIEF', prepared: true, published: false });
    expect(approvalRequirementOf(parsed(prepared))).toBe('PREPARED_WORK');
  });

  it('is BLOCKED when the agent cannot answer', () => {
    expect(approvalRequirementOf(parsed(healthEnvelope({ database: 'UNREACHABLE' })))).toBe('BLOCKED');
  });

  it('is BLOCKED when the result lists blocked integrations', () => {
    const blocked = envelope('health', { blocked: ['DataForSEO: authentication failed'] }, { status: 'DEGRADED' });
    expect(approvalRequirementOf(parsed(blocked))).toBe('BLOCKED');
  });

  it('never treats high confidence as approval', () => {
    const confident = envelope('recommendations', { items: [] }, { confidence: 'HIGH', ownerDecisionRequired: false });
    expect(approvalRequirementOf(parsed(confident))).toBe('INFORMATIONAL');
  });
});

describe('blockers and constraints', () => {
  it('merges the result blockers with the agent data gaps, without duplicating', () => {
    const answer = parsed(briefEnvelope({ blockers: ['Shared: a thing'], dataGaps: ['Shared: a thing', 'GA4 is not wired'] }));
    expect(blockersOf(answer)).toEqual(['Shared: a thing', 'GA4 is not wired']);
  });

  it('reports a provider auth failure ahead of a merely stale source', () => {
    const answer = parsed(healthEnvelope({ degraded: ['GA4 data is stale (latest never)'], blocked: ['DataForSEO: authentication failed'] }));
    expect(constraintOf(answer).kind).toBe('PROVIDER_BLOCKED');
  });

  it('recognizes a cooldown as DEFERRED, not as a failure', () => {
    const answer = parsed(envelope('requestResearch', { plan: {} }, { dataGaps: ['acme.test: cooldown not met'] }));
    expect(constraintOf(answer)).toEqual({ kind: 'DEFERRED', reason: 'acme.test: cooldown not met' });
  });

  it('recognizes job backoff', () => {
    const answer = parsed(healthEnvelope({ blocked: ['DEMAND_REFRESH: 3 consecutive failure(s), backing off'] }));
    expect(constraintOf(answer).kind).toBe('BACKING_OFF');
  });

  it('recognizes an exhausted budget', () => {
    const answer = parsed(envelope('tick', { ran: 0 }, { dataGaps: ['DEMAND_REFRESH: request budget exhausted for this period'] }));
    expect(constraintOf(answer).kind).toBe('BUDGET_EXHAUSTED');
  });

  it('recognizes a missing facts file as a drafting constraint, not an outage', () => {
    const answer = parsed(websitePackageEnvelope({ factsAvailable: false }));
    expect(constraintOf(answer).kind).toBe('FACTS_UNVERIFIED');
    expect(approvalRequirementOf(answer)).toBe('APPROVAL_REQUIRED');
  });

  it('reports no constraint when nothing is holding the agent up', () => {
    expect(constraintOf(parsed(briefEnvelope())).kind).toBe('NONE');
  });
});

describe('normalization', () => {
  it('relays the agent sentences verbatim as the summary', () => {
    const answer = normalizeAnswer(parsed(briefEnvelope()));
    expect(answer.summary[0]).toBe('Marketing is steady; gutter demand is the one thing moving.');
  });

  it('keeps only actions the agent pointed at a route as follow-ups', () => {
    const answer = normalizeAnswer(
      parsed(
        briefEnvelope({
          nextActions: [
            { action: 'Approve the revision', reason: 'money', requiresOwnerApproval: true, via: 'POST /agent/decisions' },
            { action: 'Call the supplier', reason: 'human work', requiresOwnerApproval: true }
          ]
        })
      )
    );
    expect(answer.recommendation).toHaveLength(2);
    expect(answer.followUpActions.map((action) => action.action)).toEqual(['Approve the revision']);
  });

  it('carries the JusticeOS identifiers alongside the agent own run ids', () => {
    const answer = normalizeAnswer(parsed(briefEnvelope()), { conversationId: 'conv_1', taskId: 'task_1', idempotencyKey: 'key_1' });
    expect(answer.identifiers).toEqual({
      conversationId: 'conv_1',
      taskId: 'task_1',
      idempotencyKey: 'key_1',
      collectionRunId: 'run_1',
      revisionId: null
    });
  });

  it('reads a revision id out of a prepared plan revision', () => {
    const revision = envelope('prepareWork', { kind: 'PLAN_REVISION', prepared: true, published: false, revisionId: 'rev_42' }, { ownerDecisionRequired: true });
    expect(normalizeAnswer(parsed(revision)).identifiers.revisionId).toBe('rev_42');
  });
});
