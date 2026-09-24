/**
 * JusticeOS's Padawan-facing bridge to the Marketing Agent.
 *
 * Distinct from `marketingRoutes.ts`, which is the older campaign-review
 * proxy: that one forwards operator actions on campaign revisions, this one
 * speaks the agent contract — one answer envelope, ten operations, and the
 * approval state model Padawan branches on. They share the session check, the
 * credential, and nothing else.
 *
 * The three things this router owns, and the reasons they live here rather
 * than in Padawan or in the Marketing Agent:
 *
 *   1. **Failing closed on the contract.** An answer JusticeOS cannot
 *      certainly read is refused with a clear integration error, never
 *      partially parsed.
 *   2. **Approval is an action, not an inference.** `POST /decisions` refuses
 *      without an explicit `confirmed: true` and a named revision. Reading a
 *      recommendation, opening a card, or saying something approving-shaped
 *      does not record a decision, and `POST /ask` deliberately cannot.
 *   3. **One intent is one call.** Identity and de-duplication are applied
 *      before the wire, so a double-click is not a second piece of research.
 *
 * What it does not own: any marketing judgement at all. Every sentence
 * Padawan relays is the agent's own `headline`.
 */
import { Router, type Request, type Response } from 'express';
import { createRequireSession } from '../requireSession.js';
import { AGENT_REGISTRY, MARKETING_AGENT } from '../agentRegistry.js';
import type { MarketingAgentClient } from '../marketingAgentClient.js';
import { EXPECTED_CONTRACT_VERSION, SUPPORTED_CONTRACT_VERSIONS } from './contract.js';
import {
  createMarketingOperations,
  type BriefKind,
  type MarketingOperations,
  type OperationOutcome
} from './operations.js';
import { asServiceTrade, routeMarketingIntent, type MarketingIntent } from './intent.js';
import { newTaskId, sanitizeId, PADAWAN_AGENT_ID, type RequestContext } from './requestIdentity.js';
import { eventsInBriefResult, MarketingEventStore, type CommunicationsHandoff } from './events.js';
import { notConfiguredHandoff } from './communicationsHandoff.js';
import {
  aggregateMarketingHealth,
  observeBusinessFacts,
  UNKNOWN_BUSINESS_FACTS,
  type BusinessFactsObservation,
  type MarketingHealthReport,
  type ResearchExecutionPosture,
  type SchedulerOwner
} from './health.js';

export const AGENT_BRIDGE_PREFIX = '/api/marketing/agent';
export const AGENT_REGISTRY_PATH = '/api/agents';

const BRIEF_KINDS: readonly string[] = ['DAILY_MARKETING_BRIEF', 'WEEKLY_MARKETING_BRIEF', 'MONTHLY_MARKETING_REVIEW'];
const DECISIONS: readonly string[] = ['APPROVE', 'REJECT', 'REQUEST_REVISION'];

export interface MarketingAgentRoutesOptions {
  readonly sessionSecret: string | null;
  readonly client: MarketingAgentClient | null;
  readonly actor: string | null;
  readonly schedulerOwner: SchedulerOwner;
  readonly researchExecution: ResearchExecutionPosture;
  /** Absent means no Communications Agent is wired: events are retained, nobody is notified. */
  readonly communications?: CommunicationsHandoff;
  readonly operations?: MarketingOperations;
  readonly now?: () => Date;
}

function errorBody(code: string, message: string, details: Record<string, unknown> = {}): { error: { code: string; message: string; details: Record<string, unknown> } } {
  return { error: { code, message, details } };
}

/**
 * Turns one operation outcome into an HTTP answer.
 *
 * The two contract failures are the important ones. They are 502, not 500: the
 * gateway is fine and the request was fine — the upstream is speaking
 * something this build cannot safely read, and the only correct response is to
 * say so and change nothing.
 */
function sendOutcome(res: Response, outcome: OperationOutcome, extra: Record<string, unknown> = {}): void {
  switch (outcome.kind) {
    case 'answer':
      res.status(200).json({
        agent: MARKETING_AGENT.id,
        contractVersion: outcome.answer.contractVersion,
        operation: outcome.answer.operation,
        answer: outcome.answer,
        supporting: outcome.supporting ?? null,
        deduped: outcome.deduped,
        ...extra
      });
      return;
    case 'agent-error':
      // The Marketing Agent's own refusal, with its status and body intact.
      res.status(outcome.status).json(outcome.body);
      return;
    case 'unsupported-contract':
      res.status(502).json(
        errorBody(
          'MARKETING_CONTRACT_UNSUPPORTED',
          'The Marketing Agent answered with a contract version this JusticeOS build does not support. Nothing was read from the answer and nothing was changed — update JusticeOS before using this integration.',
          { found: outcome.found, supported: SUPPORTED_CONTRACT_VERSIONS, expected: EXPECTED_CONTRACT_VERSION, operation: outcome.operation }
        )
      );
      return;
    case 'invalid-contract':
      res.status(502).json(
        errorBody(
          'MARKETING_CONTRACT_INVALID',
          'The Marketing Agent answered with a body that is not a valid answer envelope. JusticeOS refused to interpret it rather than guess at its fields.',
          { problems: outcome.problems, operation: outcome.operation, expected: EXPECTED_CONTRACT_VERSION }
        )
      );
      return;
    case 'unavailable':
      res.status(502).json(
        errorBody('MARKETING_AGENT_UNAVAILABLE', 'The Marketing Agent did not answer. Nothing was changed, and JusticeOS did not retry.', { reason: outcome.reason })
      );
      return;
    case 'not-configured':
      res.status(503).json(
        errorBody('MARKETING_AGENT_NOT_CONFIGURED', 'The Marketing Agent integration is not configured on this gateway (MARKETING_AGENT_BASE_URL / MARKETING_AGENT_API_KEY).')
      );
      return;
    case 'actor-not-configured':
      res.status(503).json(
        errorBody('MARKETING_ACTOR_NOT_CONFIGURED', 'This gateway has no operator identity configured, so it cannot record who is acting. Reads are unaffected.')
      );
      return;
  }
}

function contextOf(req: Request, actor: string | null): RequestContext {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return {
    conversationId: sanitizeId(body.conversationId) ?? sanitizeId(req.header('x-justiceos-conversation-id')),
    taskId: sanitizeId(body.taskId) ?? sanitizeId(req.header('x-justiceos-task-id')) ?? newTaskId(),
    requestingAgent: PADAWAN_AGENT_ID,
    actor
  };
}

function taskEnvelope(context: RequestContext, outcome: OperationOutcome): Record<string, unknown> {
  return {
    task: {
      conversationId: context.conversationId,
      taskId: context.taskId,
      originalTaskId: outcome.kind === 'answer' ? outcome.originalTaskId : null,
      requestingAgent: context.requestingAgent
    }
  };
}

function numberQuery(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function createMarketingAgentRouter(options: MarketingAgentRoutesOptions): Router {
  const router = Router();
  const requireSession = createRequireSession(options.sessionSecret);
  const now = options.now ?? (() => new Date());
  const operations = options.operations ?? createMarketingOperations({ client: options.client, actor: options.actor });
  const communications = options.communications ?? notConfiguredHandoff;
  const events = new MarketingEventStore(communications, now);

  // What JusticeOS has last OBSERVED about the verified-facts gate. It starts
  // as UNKNOWN and is never guessed at — see health.ts.
  let businessFacts: BusinessFactsObservation = UNKNOWN_BUSINESS_FACTS;
  let lastEventSyncAt: string | null = null;

  /** Every answer is a chance to learn something for the health report, for free. */
  function observe(outcome: OperationOutcome): void {
    if (outcome.kind !== 'answer') return;
    const observed = observeBusinessFacts(outcome.answer, now().toISOString());
    if (observed) businessFacts = observed;
  }

  router.use(AGENT_BRIDGE_PREFIX, requireSession);
  router.use(AGENT_REGISTRY_PATH, requireSession);

  /**
   * The agents JusticeOS knows about, including the Marketing Agent's
   * capabilities and its autonomy bands. Padawan reads this before routing so
   * it never offers something the agent is structurally unable to do.
   */
  router.get(AGENT_REGISTRY_PATH, (_req, res) => {
    res.status(200).json({ agents: AGENT_REGISTRY, contractVersion: EXPECTED_CONTRACT_VERSION });
  });

  // ── Reads ─────────────────────────────────────────────────────────────────

  router.get(`${AGENT_BRIDGE_PREFIX}/brief`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const raw = req.query.kind;
    if (typeof raw === 'string' && !BRIEF_KINDS.includes(raw)) {
      res.status(400).json(errorBody('INVALID_REQUEST', `Unknown brief kind "${raw}".`, { allowed: BRIEF_KINDS }));
      return;
    }
    const outcome = await operations.brief(context, typeof raw === 'string' ? (raw as BriefKind) : undefined);
    observe(outcome);
    sendOutcome(res, outcome, taskEnvelope(context, outcome));
  });

  router.get(`${AGENT_BRIDGE_PREFIX}/performance`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const outcome = await operations.performance(context);
    observe(outcome);
    sendOutcome(res, outcome, taskEnvelope(context, outcome));
  });

  router.get(`${AGENT_BRIDGE_PREFIX}/data-sources`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const outcome = await operations.dataSources(context);
    sendOutcome(res, outcome, taskEnvelope(context, outcome));
  });

  router.get(`${AGENT_BRIDGE_PREFIX}/opportunities`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const trade = asServiceTrade(req.query.trade);
    const outcome = await operations.opportunities(context, {
      ...(trade ? { trade } : {}),
      ...(typeof req.query.market === 'string' ? { market: req.query.market } : {}),
      ...(typeof req.query.type === 'string' ? { type: req.query.type } : {}),
      ...(typeof req.query.state === 'string' ? { state: req.query.state } : {}),
      ...(numberQuery(req.query.minScore) !== undefined ? { minScore: numberQuery(req.query.minScore) } : {}),
      ...(numberQuery(req.query.minConfidence) !== undefined ? { minConfidence: numberQuery(req.query.minConfidence) } : {}),
      ...(numberQuery(req.query.limit) !== undefined ? { limit: numberQuery(req.query.limit) } : {}),
      ...(req.query.includeHistory === 'true' ? { includeHistory: true } : {})
    });
    sendOutcome(res, outcome, taskEnvelope(context, outcome));
  });

  router.get(`${AGENT_BRIDGE_PREFIX}/recommendations`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const trade = asServiceTrade(req.query.trade);
    const approvalState = typeof req.query.approvalState === 'string' ? req.query.approvalState : undefined;
    if (approvalState !== undefined && !['AWAITING_OWNER', 'AGENT_MAY_START', 'BLOCKED'].includes(approvalState)) {
      res.status(400).json(errorBody('INVALID_REQUEST', `Unknown approvalState "${approvalState}".`, { allowed: ['AWAITING_OWNER', 'AGENT_MAY_START', 'BLOCKED'] }));
      return;
    }
    const outcome = await operations.recommendations(context, {
      ...(trade ? { trade } : {}),
      ...(typeof req.query.channel === 'string' ? { channel: req.query.channel } : {}),
      ...(approvalState ? { approvalState: approvalState as 'AWAITING_OWNER' | 'AGENT_MAY_START' | 'BLOCKED' } : {}),
      ...(numberQuery(req.query.limit) !== undefined ? { limit: numberQuery(req.query.limit) } : {})
    });
    sendOutcome(res, outcome, taskEnvelope(context, outcome));
  });

  router.get(`${AGENT_BRIDGE_PREFIX}/autonomy`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const outcome = await operations.autonomy(context);
    sendOutcome(res, outcome, taskEnvelope(context, outcome));
  });

  // ── Health ────────────────────────────────────────────────────────────────

  /**
   * One report, aggregated. Deliberately NOT the agent's own envelope: it
   * blends what the agent said with the three things only JusticeOS knows
   * (scheduler ownership, research posture, facts provisioning) and with the
   * state of the event handoff.
   */
  router.get(`${AGENT_BRIDGE_PREFIX}/health`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const configured = options.client !== null;
    const [health, dataSources] = configured
      ? await Promise.all([operations.health(context), operations.dataSources(context)])
      : [null, null];
    const reachability = !configured ? 'NOT_CONFIGURED' : health?.kind === 'answer' ? 'REACHABLE' : 'UNREACHABLE';

    const report: MarketingHealthReport = aggregateMarketingHealth({
      configured,
      actorConfigured: Boolean(options.actor),
      reachability,
      health,
      dataSources,
      schedulerOwner: options.schedulerOwner,
      researchExecution: options.researchExecution,
      businessFacts,
      events: {
        retained: events.list().length,
        awaitingOwner: events.countAwaitingOwner(),
        handoffConfigured: communications.configured,
        lastSyncAt: lastEventSyncAt
      },
      checkedAt: now().toISOString()
    });
    // Always 200: this endpoint's job is to REPORT a problem, so it must not
    // become the problem. `state` is what a caller branches on.
    res.status(200).json(report);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  router.post(`${AGENT_BRIDGE_PREFIX}/research`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === 'string' ? body.kind.toUpperCase() : 'WEBSITE';
    if (!['WEBSITE', 'WATCHLIST', 'DEMAND'].includes(kind)) {
      res.status(400).json(errorBody('INVALID_REQUEST', `Unknown research kind "${kind}".`, { allowed: ['WEBSITE', 'WATCHLIST', 'DEMAND'] }));
      return;
    }
    const trade = asServiceTrade(body.trade);
    const outcome = await operations.research(context, {
      kind: kind as 'WEBSITE' | 'WATCHLIST' | 'DEMAND',
      ...(typeof body.competitor === 'string' && body.competitor.trim().length > 0 ? { competitor: body.competitor.trim() } : {}),
      ...(trade ? { trade } : {}),
      ...(typeof body.reason === 'string' && body.reason.trim().length > 0 ? { reason: body.reason.trim() } : {})
    });
    sendOutcome(res, outcome, { ...taskEnvelope(context, outcome), planningOnly: true });
  });

  router.post(`${AGENT_BRIDGE_PREFIX}/prepare-work`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === 'string' ? body.kind.toUpperCase() : '';
    if (!['PLAN_REVISION', 'MARKETING_BRIEF', 'WEBSITE_IMPROVEMENT_PACKAGE'].includes(kind)) {
      res.status(400).json(
        errorBody('INVALID_REQUEST', 'kind is required.', { allowed: ['PLAN_REVISION', 'MARKETING_BRIEF', 'WEBSITE_IMPROVEMENT_PACKAGE'] })
      );
      return;
    }
    const trade = asServiceTrade(body.trade);
    const outcome = await operations.prepareWork(context, {
      kind: kind as 'PLAN_REVISION' | 'MARKETING_BRIEF' | 'WEBSITE_IMPROVEMENT_PACKAGE',
      ...(trade ? { trade } : {}),
      ...(typeof body.reason === 'string' && body.reason.trim().length > 0 ? { reason: body.reason.trim() } : {})
    });
    observe(outcome);
    sendOutcome(res, outcome, { ...taskEnvelope(context, outcome), published: false });
  });

  /**
   * The one route that records a decision.
   *
   * It requires three things, and all three are the point: a named revision
   * (so "this" can never be resolved by guessing), an explicit decision, and
   * `confirmed: true` — a field a browser cannot arrive at by rendering a
   * card, following a link, or asking a follow-up question. There is no other
   * path to a decision in JusticeOS; `POST /ask` cannot reach one.
   */
  router.post(`${AGENT_BRIDGE_PREFIX}/decisions`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const revisionId = typeof body.revisionId === 'string' ? body.revisionId.trim() : '';
    const decision = typeof body.decision === 'string' ? body.decision.toUpperCase() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (revisionId.length === 0) {
      res.status(400).json(errorBody('INVALID_REQUEST', 'revisionId is required — a decision is always about one named revision.'));
      return;
    }
    if (!DECISIONS.includes(decision)) {
      res.status(400).json(errorBody('INVALID_REQUEST', 'decision must be APPROVE, REJECT, or REQUEST_REVISION.', { allowed: DECISIONS }));
      return;
    }
    if (body.confirmed !== true) {
      res.status(400).json(
        errorBody(
          'MARKETING_DECISION_NOT_CONFIRMED',
          'A marketing decision requires a deliberate confirmation. Re-send with confirmed: true from an explicit approve/reject/revise action — JusticeOS never infers a decision from a question, a view, or an opened card.',
          { revisionId, decision }
        )
      );
      return;
    }
    if (decision === 'REQUEST_REVISION' && reason.length === 0) {
      res.status(400).json(errorBody('INVALID_REQUEST', 'reason is required when requesting a revision — the agent cannot act on "no".', { revisionId }));
      return;
    }

    const outcome = await operations.decide(context, { revisionId, decision: decision as 'APPROVE' | 'REJECT' | 'REQUEST_REVISION', ...(reason ? { reason } : {}) });
    sendOutcome(res, outcome, {
      ...taskEnvelope(context, outcome),
      // Restating the invariant in the response, because this is the answer an
      // operator reads after approving something: an approval here is an
      // internal state change. JusticeOS wires no publisher and the Marketing
      // Agent has none.
      published: false,
      publicationNote: 'Approval records internal state only. Nothing was published, sent, or launched.'
    });
  });

  /**
   * One tick, on an operator's say-so.
   *
   * JusticeOS is not the scheduler owner (see docs) and has no timer that
   * reaches this route — it exists so a human can ask for a cycle now. The
   * response says who the owner is, so a caller cannot mistake this for
   * having enabled scheduling.
   */
  router.post(`${AGENT_BRIDGE_PREFIX}/tick`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0) {
      res.status(400).json(
        errorBody('INVALID_REQUEST', 'reason is required — a manual tick is an operator action and is recorded as one.', { schedulerOwner: options.schedulerOwner })
      );
      return;
    }
    const jobs = Array.isArray(body.jobs) ? body.jobs.filter((job): job is string => typeof job === 'string') : undefined;
    const outcome = await operations.tick(context, { ...(jobs && jobs.length > 0 ? { jobs } : {}) });
    sendOutcome(res, outcome, { ...taskEnvelope(context, outcome), schedulerOwner: options.schedulerOwner, manual: true });
  });

  // ── Padawan ───────────────────────────────────────────────────────────────

  /**
   * Austin's words in, one operation out.
   *
   * The routing decision is returned alongside the answer, always — Padawan
   * relaying "here is the brief" should be auditable back to "because you
   * asked what to work on". And a request that routes to a decision comes back
   * as a pending action, never as a decision: this route cannot record one.
   */
  router.post(`${AGENT_BRIDGE_PREFIX}/ask`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = typeof body.request === 'string' ? body.request : '';
    const intent: MarketingIntent = routeMarketingIntent(request);

    const base = {
      agent: MARKETING_AGENT.id,
      contractVersion: EXPECTED_CONTRACT_VERSION,
      routing: intent,
      task: { conversationId: context.conversationId, taskId: context.taskId, requestingAgent: context.requestingAgent }
    };

    if (intent.kind === 'unroutable') {
      res.status(200).json({ ...base, operation: null, answer: null, pendingAction: null, approvalRequirement: 'INFORMATIONAL' });
      return;
    }

    if (intent.kind === 'needs-confirmation') {
      res.status(200).json({
        ...base,
        operation: 'decisions',
        answer: null,
        approvalRequirement: 'APPROVAL_REQUIRED',
        pendingAction: {
          route: intent.confirmVia,
          method: 'POST',
          // The payload the UI will send once Austin acts, with the one field
          // it cannot supply for him.
          body: { revisionId: intent.decision.revisionId, decision: intent.decision.decision, confirmed: true },
          missing: intent.decision.revisionId === null ? ['revisionId'] : [],
          note: 'Nothing has been decided. This is the action a deliberate approve/reject/revise would take.'
        }
      });
      return;
    }

    const outcome = await runIntent(intent, context);
    observe(outcome);
    if (outcome.kind !== 'answer') {
      sendOutcome(res, outcome, base);
      return;
    }
    res.status(200).json({
      ...base,
      operation: outcome.answer.operation,
      answer: outcome.answer,
      supporting: outcome.supporting ?? null,
      approvalRequirement: outcome.answer.approvalRequirement,
      pendingAction: null,
      deduped: outcome.deduped,
      task: { ...base.task, originalTaskId: outcome.originalTaskId }
    });
  });

  async function runIntent(intent: Extract<MarketingIntent, { kind: 'execute' }>, context: RequestContext): Promise<OperationOutcome> {
    switch (intent.operation) {
      case 'brief':
        return operations.brief(context);
      case 'performance':
        return operations.performance(context);
      case 'opportunities':
        return operations.opportunities(context, intent.opportunityTrade ? { trade: intent.opportunityTrade } : {});
      case 'recommendations':
        return operations.recommendations(context);
      case 'dataSources':
        return operations.dataSources(context);
      case 'autonomy':
        return operations.autonomy(context);
      case 'health':
        return operations.health(context);
      case 'research':
        return operations.research(context, intent.research ?? { kind: 'WEBSITE' });
      case 'prepareWork':
        return operations.prepareWork(context, intent.prepareWork ?? { kind: 'PLAN_REVISION' });
      // A tick is never reached from a sentence: it is an operator action with
      // its own route and its own required reason.
      case 'decisions':
      case 'tick':
        return { kind: 'agent-error', status: 400, body: errorBody('INVALID_REQUEST', 'That operation cannot be started from a request; it has its own route.') };
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /**
   * Pulls whatever the Marketing Agent has raised since the last brief, records
   * it, and hands the new ones to Communications.
   *
   * The read is free — the agent builds the brief from stored evidence and
   * calls no provider — which is what makes this an acceptable transport while
   * the outbox has no endpoint of its own.
   */
  router.post(`${AGENT_BRIDGE_PREFIX}/events/sync`, async (req, res) => {
    const context = contextOf(req, options.actor);
    const outcome = await operations.brief(context);
    if (outcome.kind !== 'answer') {
      sendOutcome(res, outcome, taskEnvelope(context, outcome));
      return;
    }
    const summary = await events.ingest(eventsInBriefResult(outcome.answer.result));
    lastEventSyncAt = now().toISOString();
    res.status(200).json({
      agent: MARKETING_AGENT.id,
      contractVersion: outcome.answer.contractVersion,
      syncedAt: lastEventSyncAt,
      received: summary.received,
      created: summary.created,
      updated: summary.updated,
      handedOff: summary.handedOff,
      handoffConfigured: communications.configured,
      events: summary.events,
      ...taskEnvelope(context, outcome)
    });
  });

  router.get(`${AGENT_BRIDGE_PREFIX}/events`, (req, res) => {
    const includeDismissed = req.query.includeDismissed !== 'false';
    const list = events.list({ includeDismissed });
    res.status(200).json({
      agent: MARKETING_AGENT.id,
      events: list,
      awaitingOwner: events.countAwaitingOwner(),
      handoffConfigured: communications.configured,
      lastSyncAt: lastEventSyncAt
    });
  });

  /** Dismissing is about the notification, never the record: the event stays listable. */
  router.post(`${AGENT_BRIDGE_PREFIX}/events/:eventId/dismiss`, (req, res) => {
    const id = decodeURIComponent(String(req.params.eventId ?? ''));
    const event = events.dismiss(id);
    if (!event) {
      res.status(404).json(errorBody('MARKETING_EVENT_NOT_FOUND', 'No retained marketing event with that id.', { eventId: id }));
      return;
    }
    res.status(200).json({ agent: MARKETING_AGENT.id, event, retained: true });
  });

  // Anything else under the agent prefix is a client mistake, not a client-side
  // route — JSON here rather than the SPA shell (same reasoning as
  // acpApiFallback.ts).
  router.use(AGENT_BRIDGE_PREFIX, (_req, res) => {
    res.status(404).json(errorBody('ROUTE_NOT_FOUND', 'No such Marketing Agent bridge endpoint on this gateway.'));
  });

  return router;
}
