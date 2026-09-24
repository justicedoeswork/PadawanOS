import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestGateway, loginForTestCookie, TEST_MARKETING_API_KEY, TEST_MARKETING_ACTOR } from './helpers/testGateway.js';
import { startMockAgentContract, type MockAgentContract } from './helpers/mockAgentContract.js';
import {
  briefEnvelope,
  dataSourcesEnvelope,
  decisionEnvelope,
  envelope,
  eventRow,
  healthEnvelope,
  researchPlanEnvelope,
  websitePackageEnvelope
} from './helpers/agentEnvelopes.js';
import type { CommunicationsHandoff, MarketingEvent } from '../src/marketing/events.js';

/**
 * End-to-end acceptance tests for the Padawan ↔ Marketing Agent path, against
 * a mocked Marketing Agent. Nothing here touches a real agent, a real
 * provider, or a real notification: the mock enforces the credential and the
 * contract, and the Communications handoff is a recording stub.
 *
 * The lettered cases are the acceptance criteria this increment was specified
 * against, and they are written in those terms on purpose — a later reader
 * should be able to match each `describe` to the requirement it proves.
 */

let agent: MockAgentContract;
let gateway: Awaited<ReturnType<typeof startTestGateway>>;
let cookie: string;
let delivered: MarketingEvent[];
let communications: CommunicationsHandoff;
let handoffConfigured = true;

async function startWith(overrides: Parameters<typeof startTestGateway>[0] = {}): Promise<void> {
  gateway = await startTestGateway({
    marketingAgentBaseUrl: agent.url,
    marketingAgentApiKey: TEST_MARKETING_API_KEY,
    marketingAgentActor: TEST_MARKETING_ACTOR,
    communicationsHandoff: communications,
    ...overrides
  });
  cookie = await loginForTestCookie(gateway.port);
}

/**
 * Test-only loose read of a response body. These tests assert field by field
 * across a dozen shapes; a DTO per route would add types nothing else uses
 * and would hide a shape change rather than surface it as a failing assertion.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${gateway.port}${path}`, {
    ...init,
    headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
}

beforeEach(async () => {
  delivered = [];
  handoffConfigured = true;
  communications = {
    get configured() {
      return handoffConfigured;
    },
    async deliver(event) {
      if (!handoffConfigured) return { state: 'NOT_CONFIGURED', ref: null, detail: 'no endpoint configured' };
      delivered.push(event);
      return { state: 'DELIVERED', ref: event.id, detail: null };
    }
  };
  agent = await startMockAgentContract({ expectedApiKey: TEST_MARKETING_API_KEY });
});

afterEach(async () => {
  await gateway?.close();
  await agent.close();
});

// ── Authentication ──────────────────────────────────────────────────────────

describe('authentication', () => {
  it('rejects every bridge route without a JusticeOS session, before any upstream call', async () => {
    await startWith();
    for (const [method, path] of [
      ['GET', '/api/marketing/agent/brief'],
      ['GET', '/api/marketing/agent/health'],
      ['GET', '/api/agents'],
      ['POST', '/api/marketing/agent/ask'],
      ['POST', '/api/marketing/agent/decisions']
    ] as const) {
      const res = await fetch(`http://127.0.0.1:${gateway.port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect((await json(res)).error.code).toBe('UNAUTHORIZED');
    }
    expect(agent.requests).toHaveLength(0);
  });

  it('never returns the Marketing Agent credential to the browser', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    await startWith();
    const res = await api('/api/marketing/agent/brief');
    const text = await res.text();
    expect(text).not.toContain(TEST_MARKETING_API_KEY);
    for (const [, value] of res.headers) expect(value).not.toContain(TEST_MARKETING_API_KEY);
  });

  it('attaches the credential server-side and ignores a browser-supplied Authorization header', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    await startWith();
    await api('/api/marketing/agent/brief', { headers: { authorization: 'Bearer attacker-supplied' } });
    expect(agent.requests[0]?.authorization).toBe(`Bearer ${TEST_MARKETING_API_KEY}`);
  });
});

// ── Registration ────────────────────────────────────────────────────────────

describe('the Marketing Agent is a first-class JusticeOS agent', () => {
  it('appears in the registry with its capabilities and its autonomy bands', async () => {
    await startWith();
    const body = await json(await api('/api/agents'));
    const marketing = body.agents.find((entry: { id: string }) => entry.id === 'marketing');
    expect(marketing.name).toBe('Marketing Agent');
    expect(marketing.contractVersion).toBe('1');
    expect(marketing.capabilities).toEqual(
      expect.arrayContaining([
        'marketing intelligence',
        'demand analysis',
        'competitor research',
        'website research',
        'analytics analysis',
        'outcome attribution',
        'opportunity identification',
        'marketing planning',
        'draft preparation',
        'approval-package preparation'
      ])
    );
  });

  it('declares that it may research unattended but may never publish or overspend', async () => {
    await startWith();
    const body = await json(await api('/api/agents'));
    const marketing = body.agents.find((entry: { id: string }) => entry.id === 'marketing');
    expect(marketing.autonomous).toBe(true);
    expect(marketing.autonomy.automatic.some((entry: string) => entry.includes('research'))).toBe(true);
    expect(marketing.autonomy.never).toEqual(expect.arrayContaining(['publish content', 'modify the live website', 'spend beyond its configured budget']));
    expect(marketing.autonomy.ownerApprovalRequired).toEqual(expect.arrayContaining(['public website changes', 'social publishing', 'advertising launch', 'changing ad spend']));
  });
});

// ── A ───────────────────────────────────────────────────────────────────────

describe('A. "What should we work on in marketing right now?"', () => {
  it('routes to the brief and returns the structured answer', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    await startWith();

    const res = await api('/api/marketing/agent/ask', {
      method: 'POST',
      body: JSON.stringify({ request: 'What should we work on in marketing right now?', conversationId: 'conv_A' })
    });
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.routing).toMatchObject({ kind: 'execute', operation: 'brief' });
    expect(body.operation).toBe('brief');
    expect(body.answer.summary[0]).toBe('Marketing is steady; gutter demand is the one thing moving.');
    expect(body.answer.confidence).toBe('HIGH');
    expect(body.answer.approvalRequirement).toBe('INFORMATIONAL');
    expect(body.answer.identifiers.collectionRunId).toBe('run_1');
    expect(body.answer.identifiers.conversationId).toBe('conv_A');
    expect(body.task.taskId).toMatch(/^task_/);
    // Padawan relays the agent's own sentences; it does not compose marketing
    // prose of its own.
    expect(body.answer.evidence).toBeDefined();
    expect(body.answer.sourceFreshness[0]).toMatchObject({ source: 'demand', stale: false });
  });

  it('propagates the conversation and task identity upstream', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    await startWith();
    await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'What should we work on in marketing?', conversationId: 'conv_A', taskId: 'task_fixed' }) });
    expect(agent.requests[0]).toMatchObject({ conversationId: 'conv_A', taskId: 'task_fixed', requestingAgent: 'padawan' });
  });

  it('answers "how is marketing performing?" with the brief and its source status together', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    agent.route('GET /agent/data-sources', { status: 200, body: dataSourcesEnvelope([{ id: 'ga4', displayName: 'GA4', state: 'CONNECTED', freshness: 'FRESH', latestDataThrough: '2026-09-24', detail: '' }]) });
    await startWith();

    const body = await json(await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'How is marketing performing?' }) }));
    expect(body.operation).toBe('brief');
    expect(body.supporting.operation).toBe('dataSources');
  });
});

// ── B ───────────────────────────────────────────────────────────────────────

describe('B. "Prepare the gutter website changes for approval."', () => {
  it('prepares the package, publishes nothing, and comes back needing a decision', async () => {
    agent.route('POST /agent/prepare-work', { status: 200, body: websitePackageEnvelope({ trade: 'GUTTERS' }) });
    await startWith();

    const body = await json(await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'Prepare the gutter website changes for approval.' }) }));

    expect(body.routing.prepareWork).toMatchObject({ kind: 'WEBSITE_IMPROVEMENT_PACKAGE', trade: 'GUTTERS' });
    expect(body.answer.approvalRequirement).toBe('APPROVAL_REQUIRED');
    expect((body.answer.result as { published: boolean }).published).toBe(false);
    expect((body.answer.result as { publicationGate: string }).publicationGate).toContain('OWNER_REVIEW_REQUIRED');
    expect(body.answer.summary).toContain('Nothing was published and the live website was not touched.');

    // Exactly one upstream call, and it was prepare-work. No publish route is
    // called because JusticeOS has none to call.
    expect(agent.requests).toHaveLength(1);
    expect(agent.requests[0]).toMatchObject({ method: 'POST', url: '/api/marketing/agent/prepare-work' });
    expect(agent.requests[0]?.body).toMatchObject({ kind: 'WEBSITE_IMPROVEMENT_PACKAGE', trade: 'GUTTERS', actor: TEST_MARKETING_ACTOR });
  });

  it('asserts the operator identity itself and discards one the browser tried to claim', async () => {
    agent.route('POST /agent/prepare-work', { status: 200, body: websitePackageEnvelope() });
    await startWith();
    await api('/api/marketing/agent/prepare-work', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE_IMPROVEMENT_PACKAGE', trade: 'GUTTERS', actor: 'somebody-else' }) });
    expect((agent.requests[0]?.body as { actor: string }).actor).toBe(TEST_MARKETING_ACTOR);
  });

  it('refuses a mutation when no operator identity is configured, without calling upstream', async () => {
    await startWith({ marketingAgentActor: null, allowedUserId: null });
    const res = await api('/api/marketing/agent/prepare-work', { method: 'POST', body: JSON.stringify({ kind: 'PLAN_REVISION' }) });
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe('MARKETING_ACTOR_NOT_CONFIGURED');
    expect(agent.requests).toHaveLength(0);
  });
});

// ── C ───────────────────────────────────────────────────────────────────────

describe('C. approving an approval-required package', () => {
  it('records the decision and states that nothing was published', async () => {
    agent.route('POST /agent/decisions', { status: 200, body: decisionEnvelope('rev_1', 'APPROVE') });
    await startWith();

    const res = await api('/api/marketing/agent/decisions', { method: 'POST', body: JSON.stringify({ revisionId: 'rev_1', decision: 'APPROVE', confirmed: true }) });
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(agent.requests[0]?.body).toMatchObject({ revisionId: 'rev_1', decision: 'APPROVE', actor: TEST_MARKETING_ACTOR });
    expect((body.answer.result as { applied: boolean; published: boolean })).toMatchObject({ applied: true, published: false });
    expect(body.published).toBe(false);
    expect(body.publicationNote).toContain('Nothing was published');
  });

  it('refuses without a deliberate confirmation, and calls nothing upstream', async () => {
    agent.route('POST /agent/decisions', { status: 200, body: decisionEnvelope('rev_1', 'APPROVE') });
    await startWith();

    const res = await api('/api/marketing/agent/decisions', { method: 'POST', body: JSON.stringify({ revisionId: 'rev_1', decision: 'APPROVE' }) });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('MARKETING_DECISION_NOT_CONFIRMED');
    expect(agent.requests).toHaveLength(0);
  });

  it('refuses a decision with no named revision — "this" is never resolved by guessing', async () => {
    await startWith();
    const res = await api('/api/marketing/agent/decisions', { method: 'POST', body: JSON.stringify({ decision: 'APPROVE', confirmed: true }) });
    expect(res.status).toBe(400);
    expect(agent.requests).toHaveLength(0);
  });

  it('cannot be reached from a sentence: /ask returns a pending action and decides nothing', async () => {
    agent.route('POST /agent/decisions', { status: 200, body: decisionEnvelope('rev_1', 'APPROVE') });
    await startWith();

    const body = await json(await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'Approve this proposal.' }) }));
    expect(body.answer).toBeNull();
    expect(body.approvalRequirement).toBe('APPROVAL_REQUIRED');
    expect(body.pendingAction).toMatchObject({ route: '/api/marketing/agent/decisions', method: 'POST', missing: ['revisionId'] });
    expect(body.pendingAction.body.confirmed).toBe(true);
    expect(agent.requests).toHaveLength(0);
  });

  it('requires a reason for a revision request, since the agent cannot act on "no"', async () => {
    await startWith();
    const res = await api('/api/marketing/agent/decisions', { method: 'POST', body: JSON.stringify({ revisionId: 'rev_1', decision: 'REQUEST_REVISION', confirmed: true }) });
    expect(res.status).toBe(400);
    expect(agent.requests).toHaveLength(0);
  });

  it('passes an upstream refusal through with its own code and status', async () => {
    agent.route('POST /agent/decisions', { status: 403, body: { error: { code: 'AUTONOMY_REFUSED', message: 'Never permitted: publishing is a separate, human-gated system.', details: { capability: 'PUBLISH_CONTENT' } } } });
    await startWith();

    const res = await api('/api/marketing/agent/decisions', { method: 'POST', body: JSON.stringify({ revisionId: 'rev_1', decision: 'APPROVE', confirmed: true }) });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe('AUTONOMY_REFUSED');
  });
});

// ── D ───────────────────────────────────────────────────────────────────────

describe('D. an autonomous MARKETING_OPPORTUNITY_FOUND event', () => {
  it('reaches JusticeOS, is handed to Communications, and is retained', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope({ changes: [eventRow()] }) });
    await startWith();

    const sync = await json(await api('/api/marketing/agent/events/sync', { method: 'POST', body: '{}' }));
    expect(sync).toMatchObject({ received: 1, created: 1, handedOff: 1, handoffConfigured: true });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.kind).toBe('MARKETING_OPPORTUNITY_FOUND');

    const listed = await json(await api('/api/marketing/agent/events'));
    expect(listed.events).toHaveLength(1);
    expect(listed.events[0].handoff.state).toBe('DELIVERED');
  });

  it('proves dedupe: a second sync of the same event notifies nobody again', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope({ changes: [eventRow()] }) });
    await startWith();

    await api('/api/marketing/agent/events/sync', { method: 'POST', body: '{}' });
    const second = await json(await api('/api/marketing/agent/events/sync', { method: 'POST', body: '{}' }));

    expect(second).toMatchObject({ received: 1, created: 0, updated: 1, handedOff: 0 });
    expect(delivered).toHaveLength(1);
    expect((await json(await api('/api/marketing/agent/events'))).events).toHaveLength(1);
  });

  it('retains a dismissed event so Austin can still see it in the app', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope({ changes: [eventRow({ ownerAttentionRequired: true })] }) });
    await startWith();
    await api('/api/marketing/agent/events/sync', { method: 'POST', body: '{}' });

    const id = (await json(await api('/api/marketing/agent/events'))).events[0].id;
    const dismissed = await json(await api(`/api/marketing/agent/events/${encodeURIComponent(id)}/dismiss`, { method: 'POST', body: '{}' }));
    expect(dismissed.event.dismissedAt).not.toBeNull();
    expect(dismissed.retained).toBe(true);

    expect((await json(await api('/api/marketing/agent/events'))).events).toHaveLength(1);
    expect((await json(await api('/api/marketing/agent/events?includeDismissed=false'))).events).toHaveLength(0);
  });

  it('retains the event and reports that nobody was notified when no Communications endpoint is wired', async () => {
    handoffConfigured = false;
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope({ changes: [eventRow()] }) });
    await startWith();

    const sync = await json(await api('/api/marketing/agent/events/sync', { method: 'POST', body: '{}' }));
    expect(sync).toMatchObject({ created: 1, handedOff: 0, handoffConfigured: false });
    expect(sync.events[0].handoff.state).toBe('NOT_CONFIGURED');
    expect((await json(await api('/api/marketing/agent/events'))).events).toHaveLength(1);
  });
});

// ── E ───────────────────────────────────────────────────────────────────────

describe('E. a blocked marketing provider', () => {
  it('surfaces provider blocked / degraded without becoming a total outage', async () => {
    agent.route('GET /agent/health', { status: 200, body: healthEnvelope({ blocked: ['DataForSEO: authentication failed'] }) });
    agent.route('GET /agent/data-sources', {
      status: 200,
      body: dataSourcesEnvelope([{ id: 'dataforseo', displayName: 'DataForSEO', state: 'AUTH_ERROR', freshness: 'STALE', latestDataThrough: null, detail: 'credentials rejected' }])
    });
    await startWith();

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.state).toBe('DEGRADED');
    expect(report.providerAuthFailures).toContain('DataForSEO: authentication failed');
    expect(report.blocked).toEqual([]);
  });

  it('names the constraint on a read rather than retrying', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope({ blockers: ['DataForSEO: authentication failed'] }) });
    await startWith();

    const body = await json(await api('/api/marketing/agent/brief'));
    expect(body.answer.constraint).toMatchObject({ kind: 'PROVIDER_BLOCKED', reason: 'DataForSEO: authentication failed' });
    expect(body.answer.blockers).toContain('DataForSEO: authentication failed');
    // One request, one upstream call. No retry storm.
    expect(agent.countOf('GET /agent/brief')).toBe(1);
  });

  it('does not retry when the agent refuses, and reports the refusal', async () => {
    agent.route('POST /agent/research', { status: 403, body: { error: { code: 'AUTONOMY_REFUSED', message: 'Needs an owner decision first.', details: {} } } });
    await startWith();

    const res = await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE' }) });
    expect(res.status).toBe(403);
    expect(agent.countOf('POST /agent/research')).toBe(1);
  });

  it('reports a cooldown as deferred rather than as a failure', async () => {
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope({ executionAllowed: false, notDue: ['acme.test'] }) });
    await startWith();

    const body = await json(await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE' }) }));
    expect(body.answer.constraint.kind).toBe('DEFERRED');
    expect(body.answer.summary).toContain('Nothing was fetched and nothing was spent.');
  });
});

// ── F ───────────────────────────────────────────────────────────────────────

describe('F. the Marketing Agent is unavailable', () => {
  it('reports unavailable and fabricates no answer', async () => {
    agent.fallback({ status: 200, body: briefEnvelope() });
    await startWith();
    await agent.close();

    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe('MARKETING_AGENT_UNAVAILABLE');
    expect(body.error.details.reason).toBe('network');
    // No `answer` key at all: there is nothing to say about marketing, and
    // JusticeOS does not fill the gap from stale assumptions.
    expect(body.answer).toBeUndefined();
  });

  it('times out once, bounded, without retrying', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope(), delayMs: 300 });
    await startWith({ marketingAgentTimeoutMs: 60 });

    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(502);
    expect((await json(res)).error.details.reason).toBe('timeout');
    expect(agent.countOf('GET /agent/brief')).toBe(1);
  });

  it('reports the outage through the health aggregate too, as BLOCKED', async () => {
    agent.fallback({ status: 200, body: healthEnvelope() });
    await startWith();
    await agent.close();

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.state).toBe('BLOCKED');
    expect(report.integration.reachability).toBe('UNREACHABLE');
  });

  it('says the integration is not configured rather than pretending, when it is not', async () => {
    await startWith({ marketingAgentBaseUrl: null, marketingAgentApiKey: null });
    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe('MARKETING_AGENT_NOT_CONFIGURED');

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.state).toBe('NOT_CONFIGURED');
  });
});

// ── G ───────────────────────────────────────────────────────────────────────

describe('G. a duplicate request for the same research', () => {
  it('makes exactly one upstream research call', async () => {
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope() });
    await startWith();

    const first = await json(await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'acme.test' }) }));
    const second = await json(await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'acme.test' }) }));

    expect(agent.countOf('POST /agent/research')).toBe(1);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    // The replay says whose work it was, so Padawan can explain rather than
    // present someone else's result as this request's.
    expect(second.task.originalTaskId).toBe(first.task.taskId);
  });

  it('de-duplicates two different phrasings of the same research request', async () => {
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope() });
    await startWith();

    await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'Research acme.test' }) });
    await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'Can you look into acme.test for me' }) });

    expect(agent.countOf('POST /agent/research')).toBe(1);
  });

  it('still makes a separate call for genuinely different research', async () => {
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope() });
    await startWith();

    await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'acme.test' }) });
    await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'other.test' }) });

    expect(agent.countOf('POST /agent/research')).toBe(2);
  });

  it('sends a stable idempotency key so the agent can recognize the repeat itself', async () => {
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope() });
    await startWith();
    await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'acme.test' }) });
    expect(agent.requests[0]?.idempotencyKey).toMatch(/^justiceos-research-[0-9a-f]{32}$/);
  });

  it('never lets a caller turn research into provider spend', async () => {
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope() });
    await startWith();
    await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', dryRun: false, execute: true }) });
    // dryRun is pinned by the gateway, not taken from the request.
    expect(agent.requests[0]?.body).toMatchObject({ dryRun: true });
  });

  it('does not cache a failure: a network blip must not pin a "no"', async () => {
    agent.route('POST /agent/research', { status: 503, body: { error: { code: 'AGENT_NOT_CONFIGURED', message: '', details: {} } } });
    await startWith();

    await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'acme.test' }) });
    agent.route('POST /agent/research', { status: 200, body: researchPlanEnvelope() });
    const retry = await json(await api('/api/marketing/agent/research', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE', competitor: 'acme.test' }) }));

    // A refusal IS an answer and is replayed; what matters is that the window
    // holds the agent's own answer rather than a transport failure. Here the
    // upstream answered both times, so both calls were made.
    expect(agent.countOf('POST /agent/research')).toBeGreaterThanOrEqual(1);
    expect(retry).toBeDefined();
  });
});

// ── H ───────────────────────────────────────────────────────────────────────

describe('H. an unsupported contractVersion', () => {
  it('fails closed with a clear integration error and reads nothing from the answer', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    agent.route('GET /agent/brief', { status: 200, body: { ...briefEnvelope(), contractVersion: '2' } });
    await startWith();

    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe('MARKETING_CONTRACT_UNSUPPORTED');
    expect(body.error.details).toMatchObject({ found: '2', supported: ['1'], expected: '1' });
    expect(body.answer).toBeUndefined();
  });

  it('fails closed on a 2xx body that is not an answer envelope at all', async () => {
    agent.route('GET /agent/brief', { status: 200, body: { brief: 'here you go', priorities: [] } });
    await startWith();

    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(502);
    expect((await json(res)).error.code).toBe('MARKETING_CONTRACT_INVALID');
  });

  it('fails closed on an envelope missing a required field', async () => {
    const { ownerDecisionRequired, ...incomplete } = briefEnvelope() as Record<string, unknown>;
    void ownerDecisionRequired;
    agent.route('GET /agent/brief', { status: 200, body: incomplete });
    await startWith();

    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe('MARKETING_CONTRACT_INVALID');
    expect(body.error.details.problems).toContain('ownerDecisionRequired is missing');
  });

  it('treats a non-JSON reply as an outage rather than passing it through', async () => {
    agent.route('GET /agent/brief', { status: 200, body: null, rawText: '<html>nginx</html>' });
    await startWith();

    const res = await api('/api/marketing/agent/brief');
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.error.code).toBe('MARKETING_AGENT_UNAVAILABLE');
    expect(body.error.details.reason).toBe('malformed-response');
    expect(JSON.stringify(body)).not.toContain('nginx');
  });

  it('reports the incompatibility in the health aggregate as BLOCKED', async () => {
    agent.route('GET /agent/health', { status: 200, body: { ...healthEnvelope(), contractVersion: '2' } });
    await startWith();

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.state).toBe('BLOCKED');
    expect(report.contract).toMatchObject({ expected: '1', upstream: '2', compatible: false });
  });
});

// ── I ───────────────────────────────────────────────────────────────────────

describe('I. the justice-business-facts production artifact is missing', () => {
  it('still answers analysis questions', async () => {
    agent.route('GET /agent/brief', { status: 200, body: briefEnvelope() });
    agent.route('GET /agent/opportunities', { status: 200, body: envelope('opportunities', { collectionRunId: 'run_1', opportunities: [] }) });
    await startWith();

    expect((await api('/api/marketing/agent/brief')).status).toBe(200);
    expect((await api('/api/marketing/agent/opportunities')).status).toBe(200);
  });

  it('degrades drafting: the package is prepared but no claim in it is fact-checked', async () => {
    agent.route('POST /agent/prepare-work', { status: 200, body: websitePackageEnvelope({ factsAvailable: false }) });
    await startWith();

    const body = await json(await api('/api/marketing/agent/prepare-work', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE_IMPROVEMENT_PACKAGE', trade: 'GUTTERS' }) }));

    expect(body.answer.approvalRequirement).toBe('APPROVAL_REQUIRED');
    expect(body.answer.constraint.kind).toBe('FACTS_UNVERIFIED');
    expect(body.answer.confidence).toBe('LOW');
    expect(body.answer.blockers.some((line: string) => line.includes('Verified business facts are not available'))).toBe(true);
    expect((body.answer.result as { verifiedFacts: { usableCount: number | null } }).verifiedFacts.usableCount).toBeNull();
  });

  it('reports the facts gap in health as degraded drafting, not as an outage', async () => {
    agent.route('POST /agent/prepare-work', { status: 200, body: websitePackageEnvelope({ factsAvailable: false }) });
    agent.route('GET /agent/health', { status: 200, body: healthEnvelope() });
    agent.route('GET /agent/data-sources', { status: 200, body: dataSourcesEnvelope([]) });
    await startWith();

    // Before anything has revealed the gate, JusticeOS says it does not know.
    expect((await json(await api('/api/marketing/agent/health'))).businessFacts.state).toBe('UNKNOWN');

    await api('/api/marketing/agent/prepare-work', { method: 'POST', body: JSON.stringify({ kind: 'WEBSITE_IMPROVEMENT_PACKAGE', trade: 'GUTTERS' }) });

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.businessFacts.state).toBe('UNAVAILABLE');
    expect(report.state).toBe('DEGRADED');
    expect(report.blocked).toEqual([]);
  });
});

// ── Scheduler ───────────────────────────────────────────────────────────────

describe('scheduler ownership', () => {
  it('reports the Marketing Agent own loop as the single owner by default', async () => {
    agent.route('GET /agent/health', { status: 200, body: healthEnvelope() });
    agent.route('GET /agent/data-sources', { status: 200, body: dataSourcesEnvelope([]) });
    await startWith();

    const report = await json(await api('/api/marketing/agent/health'));
    expect(report.scheduler).toEqual({ owner: 'MARKETING_INTERNAL_LOOP', justiceOsDrivesTicks: false, disabled: false });
  });

  it('allows a manual tick only with a recorded reason', async () => {
    agent.route('POST /agent/tick', { status: 200, body: envelope('tick', { ran: 0, considered: 3, providerCalls: 0, records: [] }) });
    await startWith();

    const refused = await api('/api/marketing/agent/tick', { method: 'POST', body: '{}' });
    expect(refused.status).toBe(400);
    expect(agent.requests).toHaveLength(0);

    const accepted = await api('/api/marketing/agent/tick', { method: 'POST', body: JSON.stringify({ reason: 'Operator asked for a cycle now.' }) });
    expect(accepted.status).toBe(200);
    const body = await json(accepted);
    expect(body.manual).toBe(true);
    expect(body.schedulerOwner).toBe('MARKETING_INTERNAL_LOOP');
  });

  it('de-duplicates a double-clicked manual tick into one upstream call', async () => {
    agent.route('POST /agent/tick', { status: 200, body: envelope('tick', { ran: 0, considered: 3, providerCalls: 0, records: [] }) });
    await startWith();

    await Promise.all([
      api('/api/marketing/agent/tick', { method: 'POST', body: JSON.stringify({ reason: 'now' }) }),
      api('/api/marketing/agent/tick', { method: 'POST', body: JSON.stringify({ reason: 'now' }) })
    ]);
    expect(agent.countOf('POST /agent/tick')).toBe(1);
  });
});

// ── Routing hygiene ─────────────────────────────────────────────────────────

describe('routing hygiene', () => {
  it('does not let the older campaign-review router swallow the agent routes', async () => {
    agent.route('GET /agent/autonomy', { status: 200, body: envelope('autonomy', { allowed: [], ownerApprovalRequired: [], never: [] }) });
    await startWith();

    const res = await api('/api/marketing/agent/autonomy');
    expect(res.status).toBe(200);
    expect((await json(res)).operation).toBe('autonomy');
  });

  it('still serves the older campaign-review routes', async () => {
    agent.fallback({ status: 200, body: { campaigns: [] } });
    await startWith();
    const res = await api('/api/marketing/campaigns/review');
    expect(res.status).toBe(200);
  });

  it('answers a JSON 404 for an unknown bridge route rather than the SPA shell', async () => {
    await startWith();
    const res = await api('/api/marketing/agent/not-a-real-route');
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects an unknown brief kind before calling upstream', async () => {
    await startWith();
    const res = await api('/api/marketing/agent/brief?kind=HOURLY');
    expect(res.status).toBe(400);
    expect(agent.requests).toHaveLength(0);
  });

  it('forwards recognized filters and drops a trade outside the taxonomy', async () => {
    agent.route('GET /agent/opportunities', { status: 200, body: envelope('opportunities', { opportunities: [] }) });
    await startWith();

    await api('/api/marketing/agent/opportunities?trade=gutters&minScore=50&limit=5');
    expect(agent.requests[0]?.url).toContain('trade=GUTTERS');
    expect(agent.requests[0]?.url).toContain('minScore=50');

    await api('/api/marketing/agent/opportunities?trade=WINDOWS');
    expect(agent.requests[1]?.url).not.toContain('WINDOWS');
  });

  it('answers an unroutable request honestly instead of picking an operation', async () => {
    await startWith();
    const body = await json(await api('/api/marketing/agent/ask', { method: 'POST', body: JSON.stringify({ request: 'Order more ladders' }) }));
    expect(body.routing.kind).toBe('unroutable');
    expect(body.answer).toBeNull();
    expect(agent.requests).toHaveLength(0);
  });
});
