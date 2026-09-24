/**
 * Marketing health, as one answer Austin can read without opening a terminal.
 *
 * The governing rule here is the one that makes health reports worth reading:
 * **a degraded integration is not an outage.** The Marketing Agent is designed
 * so that a missing GA4 credential or a stale demand run means it knows less,
 * not that it is broken — so this aggregation keeps those in a `degraded` list
 * and reserves BLOCKED for the handful of things that genuinely stop it: its
 * database being unreachable, the agent reporting it cannot answer, or a
 * contract JusticeOS was not built for.
 *
 * It also reports the three things only JusticeOS knows, which no amount of
 * asking the agent would reveal: which side owns the scheduler, what paid
 * research posture this deployment was configured with, and whether the
 * verified business facts artifact was ever provisioned.
 */
import type { MarketingAnswer } from './contract.js';
import { SUPPORTED_CONTRACT_VERSIONS, EXPECTED_CONTRACT_VERSION } from './contract.js';
import type { OperationOutcome } from './operations.js';

export type MarketingHealthState = 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'NOT_CONFIGURED';

/** Who is responsible for making the agent tick. Exactly one owner — see docs/marketing-agent-padawan-integration.md. */
export type SchedulerOwner = 'MARKETING_INTERNAL_LOOP' | 'JUSTICEOS' | 'NONE';

/** What this deployment allows the agent to spend on research without being asked. */
export type ResearchExecutionPosture = 'PLAN_ONLY' | 'EXECUTE_ALLOWED';

/**
 * Whether the Marketing Agent has the verified business facts it needs before
 * it will write a public claim.
 *
 * UNKNOWN is a real and common answer, not a failure to look: the agent
 * exposes the facts gate only through a prepare-work answer, and probing it
 * would mean preparing work nobody asked for. So JusticeOS reports what it
 * last OBSERVED, and says plainly when it has not observed anything.
 */
export type BusinessFactsState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export interface BusinessFactsObservation {
  readonly state: BusinessFactsState;
  readonly observedAt: string | null;
  readonly detail: string | null;
}

export interface MarketingHealthInputs {
  readonly configured: boolean;
  readonly actorConfigured: boolean;
  readonly reachability: 'REACHABLE' | 'UNREACHABLE' | 'NOT_CONFIGURED';
  /** The outcome of `GET /agent/health`. Any non-answer outcome is itself the health finding. */
  readonly health: OperationOutcome | null;
  /** The outcome of `GET /agent/data-sources`. Optional: its absence degrades the report, never blocks it. */
  readonly dataSources: OperationOutcome | null;
  readonly schedulerOwner: SchedulerOwner;
  readonly researchExecution: ResearchExecutionPosture;
  readonly businessFacts: BusinessFactsObservation;
  readonly events: { readonly retained: number; readonly awaitingOwner: number; readonly handoffConfigured: boolean; readonly lastSyncAt: string | null };
  readonly checkedAt: string;
}

export interface MarketingHealthReport {
  readonly state: MarketingHealthState;
  readonly contract: { readonly expected: string; readonly supported: readonly string[]; readonly upstream: string | null; readonly compatible: boolean | null };
  readonly integration: { readonly configured: boolean; readonly actorConfigured: boolean; readonly reachability: string };
  readonly agent: {
    readonly status: string | null;
    readonly database: string | null;
    readonly scheduler: { readonly state: string | null; readonly jobsConfigured: number | null; readonly jobsFailing: number | null };
    readonly lastSuccessfulCycleAt: string | null;
  };
  readonly staleSources: readonly string[];
  readonly providerAuthFailures: readonly string[];
  readonly scheduler: { readonly owner: SchedulerOwner; readonly justiceOsDrivesTicks: boolean; readonly disabled: boolean };
  readonly research: { readonly posture: ResearchExecutionPosture; readonly justiceOsMayTriggerPaidResearch: false };
  readonly businessFacts: BusinessFactsObservation;
  readonly events: MarketingHealthInputs['events'];
  readonly degraded: readonly string[];
  readonly blocked: readonly string[];
  readonly checkedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** The newest `lastSuccessAt` across every scheduled job — "when did monitoring last actually work". */
function lastSuccessfulCycle(result: unknown): string | null {
  if (!isRecord(result) || !Array.isArray(result.jobs)) return null;
  let newest: string | null = null;
  for (const job of result.jobs) {
    if (!isRecord(job)) continue;
    const at = typeof job.lastSuccessAt === 'string' ? job.lastSuccessAt : null;
    if (at && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/** Providers the agent says are refusing our credentials. Read off `data-sources`, which reports state per provider. */
function providerAuthFailures(answer: MarketingAnswer | null): string[] {
  if (!answer || !isRecord(answer.result) || !Array.isArray(answer.result.providers)) return [];
  const failures: string[] = [];
  for (const provider of answer.result.providers) {
    if (!isRecord(provider)) continue;
    if (provider.state === 'AUTH_ERROR') {
      failures.push(`${typeof provider.displayName === 'string' ? provider.displayName : String(provider.id ?? 'provider')}: authentication failed`);
    }
  }
  return failures;
}

function staleSources(answers: readonly (MarketingAnswer | null)[]): string[] {
  const stale = new Set<string>();
  for (const answer of answers) {
    for (const row of answer?.sourceFreshness ?? []) {
      if (row.stale) stale.add(`${row.source} (latest ${row.dataAsOf ?? 'never'})`);
    }
    if (answer && isRecord(answer.result) && Array.isArray(answer.result.providers)) {
      for (const provider of answer.result.providers) {
        if (isRecord(provider) && provider.freshness === 'STALE') {
          stale.add(`${typeof provider.displayName === 'string' ? provider.displayName : String(provider.id ?? 'provider')} (latest ${typeof provider.latestDataThrough === 'string' ? provider.latestDataThrough : 'never'})`);
        }
      }
    }
  }
  return [...stale];
}

function answerOf(outcome: OperationOutcome | null): MarketingAnswer | null {
  return outcome?.kind === 'answer' ? outcome.answer : null;
}

/**
 * Turns whatever the two probes came back with into one report.
 *
 * Every non-answer outcome is translated into a named finding rather than
 * being dropped: "the contract is unsupported" and "the agent did not answer"
 * are the two most important things this report can say, and both arrive as
 * outcomes that carry no envelope at all.
 */
export function aggregateMarketingHealth(inputs: MarketingHealthInputs): MarketingHealthReport {
  const degraded: string[] = [];
  const blocked: string[] = [];

  const healthAnswer = answerOf(inputs.health);
  const sourcesAnswer = answerOf(inputs.dataSources);
  const healthResult = healthAnswer && isRecord(healthAnswer.result) ? healthAnswer.result : null;

  let upstreamContract: string | null = healthAnswer?.contractVersion ?? null;
  let compatible: boolean | null = healthAnswer ? SUPPORTED_CONTRACT_VERSIONS.includes(healthAnswer.contractVersion) : null;

  for (const [label, outcome] of [
    ['health', inputs.health],
    ['data-sources', inputs.dataSources]
  ] as const) {
    if (!outcome) continue;
    switch (outcome.kind) {
      case 'unsupported-contract':
        upstreamContract = outcome.found;
        compatible = false;
        blocked.push(`The Marketing Agent answers contract version ${outcome.found}; this JusticeOS build supports ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}. The integration is disabled until JusticeOS is updated.`);
        break;
      case 'invalid-contract':
        compatible = false;
        blocked.push(`The Marketing Agent's ${label} answer did not match the expected contract: ${outcome.problems.join('; ')}.`);
        break;
      case 'unavailable':
        blocked.push(`The Marketing Agent did not answer the ${label} probe (${outcome.reason}).`);
        break;
      case 'agent-error': {
        const code = isRecord(outcome.body) && isRecord(outcome.body.error) && typeof outcome.body.error.code === 'string' ? outcome.body.error.code : `HTTP ${outcome.status}`;
        // The agent refusing a probe is a real finding, but only the health
        // probe failing means the agent is unusable — a data-sources refusal
        // means we know less about it.
        (label === 'health' ? blocked : degraded).push(`The Marketing Agent refused the ${label} probe: ${code}.`);
        break;
      }
      case 'not-configured':
        degraded.push('The Marketing Agent integration is not configured on this gateway.');
        break;
      case 'actor-not-configured':
        degraded.push('No operator identity is configured, so no marketing action can be recorded.');
        break;
      case 'answer':
        break;
    }
  }

  if (healthResult) {
    degraded.push(...stringsOf(healthResult.degraded));
    // The agent's own `blocked` list is per-integration ("this provider's
    // credentials are rejected", "this job is backing off"). Those stop part
    // of its work, not all of it, so they are reported as degraded findings
    // here — with the one exception below, which genuinely stops everything.
    degraded.push(...stringsOf(healthResult.blocked));
    if (healthResult.database === 'UNREACHABLE') {
      blocked.push('The Marketing Agent cannot reach its own database — it can answer nothing until that is fixed.');
    }
  }
  if (healthAnswer?.status === 'UNAVAILABLE') {
    blocked.push(healthAnswer.summary[0] ?? 'The Marketing Agent reported it cannot answer.');
  }

  const stale = staleSources([healthAnswer, sourcesAnswer]);
  const authFailures = providerAuthFailures(sourcesAnswer);

  // Staleness and a rejected credential are findings in their own right, not
  // only when the agent happened to mention them in `dataGaps` — an answer
  // that reports a source as STALE has told us something the report must say
  // out loud, because "the numbers are three weeks old" changes what Austin
  // should conclude from them.
  for (const source of stale) degraded.push(`${source} is stale`);
  degraded.push(...authFailures);

  if (inputs.reachability === 'UNREACHABLE') blocked.push('The Marketing Agent is not reachable from this gateway.');
  if (inputs.schedulerOwner === 'NONE') degraded.push('No scheduler owner is configured, so the Marketing Agent is not being ticked by anything.');
  if (inputs.researchExecution === 'PLAN_ONLY') {
    degraded.push('Autonomous paid research execution is off in this deployment: the agent plans and reports research, and does not spend.');
  }
  if (inputs.businessFacts.state === 'UNAVAILABLE') {
    degraded.push(inputs.businessFacts.detail ?? 'Verified business facts are unavailable to the Marketing Agent, so no public claim can be fact-checked. Drafting is degraded; analysis is unaffected.');
  }
  if (!inputs.events.handoffConfigured) {
    degraded.push('No Communications Agent endpoint is configured, so marketing events are retained in JusticeOS but nobody is notified.');
  }

  const state: MarketingHealthState = !inputs.configured
    ? 'NOT_CONFIGURED'
    : blocked.length > 0
      ? 'BLOCKED'
      : degraded.length > 0
        ? 'DEGRADED'
        : 'HEALTHY';

  const scheduler = healthResult && isRecord(healthResult.scheduler) ? healthResult.scheduler : null;

  return {
    state,
    contract: { expected: EXPECTED_CONTRACT_VERSION, supported: SUPPORTED_CONTRACT_VERSIONS, upstream: upstreamContract, compatible },
    integration: { configured: inputs.configured, actorConfigured: inputs.actorConfigured, reachability: inputs.reachability },
    agent: {
      status: healthAnswer?.status ?? null,
      database: healthResult && typeof healthResult.database === 'string' ? healthResult.database : null,
      scheduler: {
        state: scheduler && typeof scheduler.state === 'string' ? scheduler.state : null,
        jobsConfigured: scheduler && typeof scheduler.jobsConfigured === 'number' ? scheduler.jobsConfigured : null,
        jobsFailing: scheduler && typeof scheduler.jobsFailing === 'number' ? scheduler.jobsFailing : null
      },
      lastSuccessfulCycleAt: lastSuccessfulCycle(healthResult)
    },
    staleSources: stale,
    providerAuthFailures: authFailures,
    scheduler: {
      owner: inputs.schedulerOwner,
      justiceOsDrivesTicks: inputs.schedulerOwner === 'JUSTICEOS',
      disabled: inputs.schedulerOwner === 'NONE'
    },
    // Not a configurable claim: JusticeOS pins `dryRun` on every research
    // call it makes (see operations.ts), so this is false by construction
    // rather than by policy.
    research: { posture: inputs.researchExecution, justiceOsMayTriggerPaidResearch: false },
    businessFacts: inputs.businessFacts,
    events: inputs.events,
    degraded: [...new Set(degraded)],
    blocked: [...new Set(blocked)],
    checkedAt: inputs.checkedAt
  };
}

/**
 * Reads the facts gate out of a prepare-work answer, which is the only place
 * the contract reveals it. Called opportunistically — whenever a package
 * happens to be prepared, JusticeOS learns the current state for free.
 */
export function observeBusinessFacts(answer: MarketingAnswer, at: string): BusinessFactsObservation | null {
  if (answer.operation !== 'prepareWork') return null;
  const result = isRecord(answer.result) ? answer.result : null;
  const verified = result && isRecord(result.verifiedFacts) ? result.verifiedFacts : null;
  const hasEvidence = answer.evidence.some((link) => link.kind === 'BUSINESS_FACTS');
  const gap = answer.blockers.find((line) => /verified business facts (are not available|could not be read)/i.test(line));

  if (gap) return { state: 'UNAVAILABLE', observedAt: at, detail: gap };
  if (hasEvidence || (verified && typeof verified.usableCount === 'number')) {
    return {
      state: 'AVAILABLE',
      observedAt: at,
      detail: verified && typeof verified.usableCount === 'number' ? `${verified.usableCount} verified fact(s) are usable in public copy.` : null
    };
  }
  return null;
}

export const UNKNOWN_BUSINESS_FACTS: BusinessFactsObservation = {
  state: 'UNKNOWN',
  observedAt: null,
  detail: 'JusticeOS has not yet seen a Marketing Agent answer that reports the verified-facts gate. Preparing a website package is what reveals it.'
};
