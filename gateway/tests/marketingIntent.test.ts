import { describe, it, expect } from 'vitest';
import { asServiceTrade, routeMarketingIntent, tradeIn, type MarketingIntent } from '../src/marketing/intent.js';

function executed(request: string): Extract<MarketingIntent, { kind: 'execute' }> {
  const intent = routeMarketingIntent(request);
  if (intent.kind !== 'execute') throw new Error(`expected an executable intent for "${request}", got ${intent.kind}`);
  return intent;
}

function confirmation(request: string): Extract<MarketingIntent, { kind: 'needs-confirmation' }> {
  const intent = routeMarketingIntent(request);
  if (intent.kind !== 'needs-confirmation') throw new Error(`expected a confirmation-required intent for "${request}", got ${intent.kind}`);
  return intent;
}

/**
 * The nine mappings the integration was specified against, asked in Austin's
 * own words rather than in the API's.
 */
describe('the specified Padawan mappings', () => {
  it('"What should we work on in marketing?" reads the brief', () => {
    expect(executed('What should we work on in marketing?').operation).toBe('brief');
    expect(executed('What should we work on in marketing right now?').operation).toBe('brief');
  });

  it('"What opportunities do we have?" reads opportunities', () => {
    expect(executed('What opportunities do we have?').operation).toBe('opportunities');
  });

  it('"How is marketing performing?" reads the brief and its sources together', () => {
    expect(executed('How is marketing performing?').operation).toBe('performance');
    expect(executed("How's marketing doing this month?").operation).toBe('performance');
  });

  it('"What\'s producing approved jobs?" asks the agent own ranked-work interface', () => {
    expect(executed("What's producing approved jobs?").operation).toBe('recommendations');
    expect(executed('Which channels are driving leads?').operation).toBe('recommendations');
  });

  it('"Research this competitor." plans research', () => {
    const intent = executed('Research this competitor.');
    expect(intent.operation).toBe('research');
    expect(intent.research?.kind).toBe('WEBSITE');
    // "this competitor" names nobody — it must not become a competitor called
    // "this competitor", which would be a request to research nothing.
    expect(intent.research?.competitor).toBeUndefined();
  });

  it('extracts a competitor domain when the request actually names one', () => {
    expect(executed('Research acmeroofing.test').research?.competitor).toBe('acmeroofing.test');
  });

  it('"Prepare the gutter website changes for approval." prepares a website package', () => {
    const intent = executed('Prepare the gutter website changes for approval.');
    expect(intent.operation).toBe('prepareWork');
    expect(intent.prepareWork).toMatchObject({ kind: 'WEBSITE_IMPROVEMENT_PACKAGE', trade: 'GUTTERS' });
  });

  it('"Approve this proposal." maps to a decision but does not make one', () => {
    const intent = confirmation('Approve this proposal.');
    expect(intent.decision.decision).toBe('APPROVE');
    expect(intent.decision.revisionId).toBeNull();
    expect(intent.confirmVia).toBe('/api/marketing/agent/decisions');
  });

  it('"Reject this." maps to REJECT, still requiring confirmation', () => {
    expect(confirmation('Reject this.').decision.decision).toBe('REJECT');
  });

  it('"Revise this." maps to REQUEST_REVISION, still requiring confirmation', () => {
    expect(confirmation('Revise this.').decision.decision).toBe('REQUEST_REVISION');
  });
});

describe('approval is never inferred from a sentence', () => {
  it('routes every approving-shaped phrase to a confirmation, never to an execution', () => {
    for (const phrase of ['Approve it', 'approved', 'Sign off on the gutter package', 'ship it', 'Yes, approve this one']) {
      expect(routeMarketingIntent(phrase).kind).toBe('needs-confirmation');
    }
  });

  it('does not treat a question about an approval as an approval', () => {
    // "for approval" is the giveaway: this is a request to PREPARE something.
    expect(executed('Prepare the roofing page for approval').operation).toBe('prepareWork');
  });

  it('treats a question about approving as a question, not as an approval', () => {
    const intent = routeMarketingIntent('Should I approve this?');
    expect(intent.kind).toBe('unroutable');
    if (intent.kind !== 'unroutable') return;
    expect(intent.reason).toMatch(/deliberate actions/i);
  });

  it('only accepts a revision id the sentence actually contains', () => {
    const withId = confirmation('Approve 3f8b1c2d-9a44-4f0e-8b21-77e4c5d9a001');
    expect(withId.decision.revisionId).toBe('3f8b1c2d-9a44-4f0e-8b21-77e4c5d9a001');
    expect(confirmation('Approve that one').decision.revisionId).toBeNull();
  });
});

describe('requests it will not guess at', () => {
  it('refuses an empty request', () => {
    expect(routeMarketingIntent('   ').kind).toBe('unroutable');
  });

  it('refuses something unrelated rather than picking an operation that might cost money', () => {
    const intent = routeMarketingIntent('Order more ladders from the supplier');
    expect(intent.kind).toBe('unroutable');
    if (intent.kind !== 'unroutable') return;
    expect(intent.suggestions.length).toBeGreaterThan(0);
  });
});

describe('trade recognition', () => {
  it('maps Austin spellings onto the agent own taxonomy', () => {
    expect(tradeIn('the gutters on that house')).toBe('GUTTERS');
    expect(tradeIn('roof replacement')).toBe('ROOFING');
    expect(tradeIn('soffit and fascia')).toBe('SOFFIT_FASCIA');
    expect(tradeIn('nothing relevant')).toBeNull();
  });

  it('accepts a caller-supplied trade only if it is in the taxonomy', () => {
    expect(asServiceTrade('gutters')).toBe('GUTTERS');
    expect(asServiceTrade('WINDOWS')).toBeNull();
    expect(asServiceTrade(7)).toBeNull();
  });
});
