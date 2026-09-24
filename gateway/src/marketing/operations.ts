/**
 * The ten Marketing Agent operations, as JusticeOS calls them.
 *
 * Every call in JusticeOS that reaches `/api/marketing/agent/*` goes through
 * this module, and it is the only place that knows the upstream paths. What
 * it adds on top of the transport (`marketingAgentClient.ts`) is the part
 * that is JusticeOS's job rather than the Marketing Agent's:
 *
 *   - correlation: the conversation/task identity on every request;
 *   - de-duplication, so one intent is one upstream call;
 *   - contract enforcement, failing closed on a version it was not built for;
 *   - normalization into the single answer shape the rest of JusticeOS reads.
 *
 * It adds nothing else. There is no retry anywhere in this file: a busy
 * agent, a provider in backoff and an exhausted budget all answer the same
 * way to a second identical request, and two of the three cost money. The
 * reason is surfaced; the call is not repeated.
 */
import type { MarketingAgentClient, MarketingAgentResult } from '../marketingAgentClient.js';
import {
  EXPECTED_CONTRACT_VERSION,
  normalizeAnswer,
  parseAgentAnswer,
  type MarketingAnswer
} from './contract.js';
import {
  headersFor,
  idempotencyKeyFor,
  RequestDeduper,
  type RequestContext
} from './requestIdentity.js';
import type { ServiceTrade } from './trades.js';

/** The Marketing Agent mounts its agent surface here, under its own API prefix. */
const AGENT_PREFIX = '/api/marketing/agent';

/** How long an identical request replays the first one's answer instead of asking again. */
export const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export type BriefKind = 'DAILY_MARKETING_BRIEF' | 'WEEKLY_MARKETING_BRIEF' | 'MONTHLY_MARKETING_REVIEW';
export type ResearchKind = 'WEBSITE' | 'WATCHLIST' | 'DEMAND';
export type PrepareWorkKind = 'PLAN_REVISION' | 'MARKETING_BRIEF' | 'WEBSITE_IMPROVEMENT_PACKAGE';
export type DecisionType = 'APPROVE' | 'REJECT' | 'REQUEST_REVISION';

/**
 * Everything one operation can come back as. Deliberately a union rather than
 * an exception: "the upstream said 409 APPROVAL_BLOCKED" is a perfectly good
 * answer that must reach Austin unchanged, and is not the same kind of event
 * as "the upstream is speaking a contract we do not understand".
 */
export type OperationOutcome =
  | {
      readonly kind: 'answer';
      readonly answer: MarketingAnswer;
      /** A second answer the operation composed in (only `performance`, which needs the brief AND its sources). */
      readonly supporting?: MarketingAnswer;
      readonly deduped: boolean;
      readonly originalTaskId: string | null;
    }
  /** The Marketing Agent's own structured error. Passed through with its status and body untouched. */
  | { readonly kind: 'agent-error'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'unsupported-contract'; readonly found: string; readonly operation: string }
  | { readonly kind: 'invalid-contract'; readonly problems: readonly string[]; readonly operation: string }
  | { readonly kind: 'unavailable'; readonly reason: 'timeout' | 'network' | 'malformed-response' }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'actor-not-configured' };

export interface MarketingOperationsOptions {
  readonly client: MarketingAgentClient | null;
  /** Who the Marketing Agent records as the operator. Null means mutations refuse before any upstream call. */
  readonly actor: string | null;
  readonly dedupeWindowMs?: number;
  readonly now?: () => number;
}

export interface OpportunityFilters {
  readonly trade?: ServiceTrade;
  readonly market?: string;
  readonly minScore?: number;
  readonly minConfidence?: number;
  readonly type?: string;
  readonly state?: string;
  readonly limit?: number;
  readonly includeHistory?: boolean;
}

export interface RecommendationFilters {
  readonly trade?: ServiceTrade;
  readonly channel?: string;
  readonly approvalState?: 'AWAITING_OWNER' | 'AGENT_MAY_START' | 'BLOCKED';
  readonly limit?: number;
}

export interface MarketingOperations {
  health(context: RequestContext): Promise<OperationOutcome>;
  dataSources(context: RequestContext): Promise<OperationOutcome>;
  brief(context: RequestContext, kind?: BriefKind): Promise<OperationOutcome>;
  /** The brief and the state of every source it was built from, answered together. */
  performance(context: RequestContext, kind?: BriefKind): Promise<OperationOutcome>;
  opportunities(context: RequestContext, filters?: OpportunityFilters): Promise<OperationOutcome>;
  recommendations(context: RequestContext, filters?: RecommendationFilters): Promise<OperationOutcome>;
  autonomy(context: RequestContext): Promise<OperationOutcome>;
  research(context: RequestContext, input: { readonly kind: ResearchKind; readonly competitor?: string; readonly trade?: ServiceTrade; readonly reason?: string }): Promise<OperationOutcome>;
  prepareWork(context: RequestContext, input: { readonly kind: PrepareWorkKind; readonly trade?: ServiceTrade; readonly reason?: string }): Promise<OperationOutcome>;
  decide(context: RequestContext, input: { readonly revisionId: string; readonly decision: DecisionType; readonly reason?: string }): Promise<OperationOutcome>;
  tick(context: RequestContext, input?: { readonly jobs?: readonly string[] }): Promise<OperationOutcome>;
}

export function createMarketingOperations(options: MarketingOperationsOptions): MarketingOperations {
  const deduper = new RequestDeduper(options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS, options.now);

  /**
   * One upstream call, from request to normalized answer. `dedupeKey` is what
   * makes a repeat of the same intent free; operations that are cheap and
   * whose answer moves constantly (health, a read) pass null and always ask.
   */
  async function call(input: {
    readonly method: 'GET' | 'POST';
    readonly operation: string;
    readonly path: string;
    readonly query?: string;
    readonly body?: unknown;
    readonly context: RequestContext;
    readonly dedupeKey: string | null;
    readonly idempotencyKey?: string;
  }): Promise<OperationOutcome> {
    const client = options.client;
    if (!client) return { kind: 'not-configured' };

    const perform = async (): Promise<OperationOutcome> => {
      const result: MarketingAgentResult = await client.request({
        method: input.method,
        path: `${AGENT_PREFIX}${input.path}`,
        ...(input.query ? { query: input.query } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        headers: headersFor(input.context, EXPECTED_CONTRACT_VERSION)
      });

      if (result.kind === 'unavailable') return { kind: 'unavailable', reason: result.reason };

      // A non-2xx is the agent's own structured refusal. It is an answer
      // about marketing (or about authorization), not a contract problem,
      // and JusticeOS relays it rather than reinterpreting it.
      if (result.status < 200 || result.status >= 300) {
        return { kind: 'agent-error', status: result.status, body: result.body };
      }

      const parsed = parseAgentAnswer(result.body);
      if (parsed.kind === 'unsupported-version') {
        return { kind: 'unsupported-contract', found: parsed.found, operation: input.operation };
      }
      if (parsed.kind === 'invalid') {
        return { kind: 'invalid-contract', problems: parsed.problems, operation: input.operation };
      }

      return {
        kind: 'answer',
        answer: normalizeAnswer(parsed.envelope, {
          conversationId: input.context.conversationId,
          taskId: input.context.taskId,
          idempotencyKey: input.idempotencyKey ?? null
        }),
        deduped: false,
        originalTaskId: input.context.taskId
      };
    };

    if (!input.dedupeKey) return perform();

    const outcome = await deduper.run(input.dedupeKey, input.context.taskId, perform);
    if (!outcome.deduped || outcome.value.kind !== 'answer') {
      return outcome.value;
    }
    // The replayed answer still belongs to the request that made it; saying
    // so is what lets Padawan explain "that research is already running"
    // instead of silently presenting someone else's result as this one's.
    return { ...outcome.value, deduped: true, originalTaskId: outcome.originalTaskId };
  }

  function queryOf(params: Record<string, string | number | boolean | undefined>): string | undefined {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value));
    }
    const encoded = search.toString();
    return encoded.length > 0 ? encoded : undefined;
  }

  return {
    health: (context) => call({ method: 'GET', operation: 'health', path: '/health', context, dedupeKey: null }),

    dataSources: (context) => call({ method: 'GET', operation: 'dataSources', path: '/data-sources', context, dedupeKey: null }),

    brief: (context, kind) =>
      call({ method: 'GET', operation: 'brief', path: '/brief', ...(kind ? { query: `kind=${kind}` } : {}), context, dedupeKey: null }),

    async performance(context, kind) {
      // Two reads, both free (the agent builds both from stored evidence and
      // calls no provider), issued together rather than in sequence.
      const [brief, sources] = await Promise.all([
        call({ method: 'GET', operation: 'brief', path: '/brief', ...(kind ? { query: `kind=${kind}` } : {}), context, dedupeKey: null }),
        call({ method: 'GET', operation: 'dataSources', path: '/data-sources', context, dedupeKey: null })
      ]);
      // The brief is the answer; the sources qualify it. A failure to read
      // the brief is the failure, and is reported as itself.
      if (brief.kind !== 'answer') return brief;
      return sources.kind === 'answer' ? { ...brief, supporting: sources.answer } : brief;
    },

    opportunities(context, filters = {}) {
      const query = queryOf({ ...filters });
      return call({ method: 'GET', operation: 'opportunities', path: '/opportunities', ...(query ? { query } : {}), context, dedupeKey: null });
    },

    recommendations(context, filters = {}) {
      const query = queryOf({ ...filters });
      return call({ method: 'GET', operation: 'recommendations', path: '/recommendations', ...(query ? { query } : {}), context, dedupeKey: null });
    },

    autonomy: (context) => call({ method: 'GET', operation: 'autonomy', path: '/autonomy', context, dedupeKey: null }),

    research(context, input) {
      // `dryRun` is pinned, not defaulted. The Marketing Agent plans rather
      // than fetches from this endpoint today; pinning it here means a
      // JusticeOS caller still cannot trigger provider spend through this
      // bridge if that ever changes upstream.
      const body = {
        kind: input.kind,
        ...(input.competitor ? { competitor: input.competitor } : {}),
        ...(input.trade ? { trade: input.trade } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        dryRun: true
      };
      // Deduped on the request itself, without the free-text reason: two
      // phrasings of the same research request are one request.
      const identity = { kind: input.kind, competitor: input.competitor ?? null, trade: input.trade ?? null };
      const idempotencyKey = idempotencyKeyFor('research', identity);
      return call({ method: 'POST', operation: 'research', path: '/research', body, context, dedupeKey: idempotencyKey, idempotencyKey });
    },

    prepareWork(context, input) {
      if (!options.actor) return Promise.resolve({ kind: 'actor-not-configured' } as const);
      const body = {
        kind: input.kind,
        actor: options.actor,
        ...(input.trade ? { trade: input.trade } : {}),
        ...(input.reason ? { reason: input.reason } : {})
      };
      const identity = { kind: input.kind, trade: input.trade ?? null, actor: options.actor };
      const idempotencyKey = idempotencyKeyFor('prepare-work', identity);
      return call({ method: 'POST', operation: 'prepareWork', path: '/prepare-work', body, context, dedupeKey: idempotencyKey, idempotencyKey });
    },

    decide(context, input) {
      if (!options.actor) return Promise.resolve({ kind: 'actor-not-configured' } as const);
      const body = {
        revisionId: input.revisionId,
        decision: input.decision,
        actor: options.actor,
        ...(input.reason ? { reason: input.reason } : {})
      };
      // A decision carries an idempotency key so a retried click cannot
      // record two decisions, but it is NOT replayed from the local window:
      // a decision's answer is state Austin is entitled to see current, and
      // the Marketing Agent is the one that decides what a repeat means.
      const idempotencyKey = idempotencyKeyFor('decision', { revisionId: input.revisionId, decision: input.decision, actor: options.actor });
      return call({ method: 'POST', operation: 'decisions', path: '/decisions', body, context, dedupeKey: null, idempotencyKey });
    },

    tick(context, input = {}) {
      const body = input.jobs && input.jobs.length > 0 ? { jobs: input.jobs } : {};
      const idempotencyKey = idempotencyKeyFor('tick', { jobs: [...(input.jobs ?? [])].sort() });
      return call({ method: 'POST', operation: 'tick', path: '/tick', body, context, dedupeKey: idempotencyKey, idempotencyKey });
    }
  };
}
