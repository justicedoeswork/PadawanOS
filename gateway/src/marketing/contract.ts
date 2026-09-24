/**
 * The Marketing Agent's Padawan-facing answer envelope, as JusticeOS reads
 * it.
 *
 * The Marketing Agent publishes one envelope for all ten of its
 * `/api/marketing/agent/*` operations (its own
 * `domain/agent/padawan-response.ts`), carrying a `contractVersion`. This
 * module is the only place in JusticeOS that interprets that shape, and it
 * does exactly two things:
 *
 *   1. It FAILS CLOSED. An envelope whose `contractVersion` is not one this
 *      build supports is refused outright — never parsed "as far as it
 *      goes", never partially believed. A 2xx body that is not an envelope
 *      at all is refused the same way. JusticeOS would rather tell Austin
 *      "this integration needs an update" than relay a field it guessed at.
 *
 *   2. It NORMALIZES, without interpreting marketing. Every operation's
 *      answer becomes the same small JusticeOS-facing view: the sentences to
 *      relay, the evidence behind them, the recommended actions, the
 *      confidence, what is stale, what is blocking, and — the one derived
 *      value — which of the four approval states the answer is in. Nothing
 *      here decides what the marketing answer IS; the Marketing Agent owns
 *      that and JusticeOS never re-derives it.
 */

/** Every envelope version this build understands. A new major version is added here deliberately, with the code that handles it. */
export const SUPPORTED_CONTRACT_VERSIONS: readonly string[] = ['1'];

/** What JusticeOS announces as the contract it was built against. */
export const EXPECTED_CONTRACT_VERSION = '1';

export const AGENT_NAME = 'MARKETING_AGENT';

export type AnswerStatus = 'OK' | 'DEGRADED' | 'UNAVAILABLE';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/**
 * The four states JusticeOS's approval UX distinguishes. They are about what
 * Austin has to DO, not about how the answer reads:
 *
 *   INFORMATIONAL     — nothing is waiting on anyone.
 *   PREPARED_WORK     — a draft/package exists and is inert.
 *   APPROVAL_REQUIRED — nothing public happens until Austin decides.
 *   BLOCKED           — the agent cannot proceed until something is fixed.
 */
export type ApprovalRequirement = 'INFORMATIONAL' | 'PREPARED_WORK' | 'APPROVAL_REQUIRED' | 'BLOCKED';

export interface EvidenceLink {
  readonly kind: string;
  readonly ref: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface RecommendedAction {
  readonly action: string;
  readonly reason: string;
  readonly requiresOwnerApproval: boolean;
  /** The Marketing Agent's own pointer at whatever would carry the action out. Relayed verbatim; JusticeOS never invents one. */
  readonly via?: string;
}

export interface SourceFreshness {
  readonly source: string;
  readonly dataAsOf: string | null;
  readonly stale: boolean;
  readonly staleAfterHours: number;
}

/**
 * Why the agent did not do the thing, when it did not. Padawan surfaces this
 * reason instead of retrying: every one of these is a state an identical
 * second request would land in again, at best — and would pay for again, at
 * worst.
 */
export type ConstraintKind =
  | 'NONE'
  | 'BUSY'
  | 'BACKING_OFF'
  | 'DEFERRED'
  | 'BUDGET_EXHAUSTED'
  | 'PROVIDER_BLOCKED'
  | 'AUTONOMY_REFUSED'
  | 'NOT_CONFIGURED'
  | 'STALE_DATA'
  | 'FACTS_UNVERIFIED';

export interface Constraint {
  readonly kind: ConstraintKind;
  /** The agent's own words, never a paraphrase — the label above is the guess, this is the evidence for it. */
  readonly reason: string;
}

/** The identifiers that tie one answer back to a JusticeOS conversation and task, and to whatever run produced the evidence. */
export interface AnswerIdentifiers {
  readonly conversationId: string | null;
  readonly taskId: string | null;
  readonly idempotencyKey: string | null;
  /** The Marketing Agent's own run/revision ids, read out of `result` where the contract puts them. */
  readonly collectionRunId: string | null;
  readonly revisionId: string | null;
}

/** The raw envelope, validated field by field. `result` stays `unknown`: its shape is per-operation and belongs to the Marketing Agent. */
export interface AgentAnswerEnvelope {
  readonly agent: string;
  readonly contractVersion: string;
  readonly operation: string;
  readonly asOf: string;
  readonly status: AnswerStatus;
  readonly headline: readonly string[];
  readonly result: unknown;
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly EvidenceLink[];
  readonly dataGaps: readonly string[];
  readonly freshness: readonly SourceFreshness[];
  readonly nextActions: readonly RecommendedAction[];
  readonly ownerDecisionRequired: boolean;
  readonly dataEnvironment: string;
}

/** What JusticeOS hands to Padawan, the UI, and the event path. One shape for every operation. */
export interface MarketingAnswer {
  readonly agent: typeof AGENT_NAME;
  readonly contractVersion: string;
  readonly operation: string;
  readonly asOf: string;
  readonly status: AnswerStatus;
  /** The sentences Padawan relays. Never rewritten, never summarised further. */
  readonly summary: readonly string[];
  readonly result: unknown;
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly EvidenceLink[];
  readonly recommendation: readonly RecommendedAction[];
  readonly approvalRequirement: ApprovalRequirement;
  readonly sourceFreshness: readonly SourceFreshness[];
  readonly blockers: readonly string[];
  readonly followUpActions: readonly RecommendedAction[];
  readonly constraint: Constraint;
  readonly identifiers: AnswerIdentifiers;
  readonly dataEnvironment: string;
}

export type ContractParseResult =
  | { readonly kind: 'answer'; readonly envelope: AgentAnswerEnvelope }
  | { readonly kind: 'unsupported-version'; readonly found: string }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] };

const STATUSES: readonly string[] = ['OK', 'DEGRADED', 'UNAVAILABLE'];
const CONFIDENCES: readonly string[] = ['HIGH', 'MEDIUM', 'LOW', 'NONE'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function evidenceOf(value: unknown): readonly EvidenceLink[] {
  if (!Array.isArray(value)) return [];
  const links: EvidenceLink[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.kind !== 'string' || typeof entry.ref !== 'string') continue;
    links.push({ kind: entry.kind, ref: entry.ref, ...(isRecord(entry.detail) ? { detail: entry.detail } : {}) });
  }
  return links;
}

function actionsOf(value: unknown): readonly RecommendedAction[] {
  if (!Array.isArray(value)) return [];
  const actions: RecommendedAction[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.action !== 'string') continue;
    actions.push({
      action: entry.action,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      // Absent is treated as "needs approval", never as "go ahead": an
      // unreadable flag on a gate must fail toward the gate.
      requiresOwnerApproval: entry.requiresOwnerApproval !== false,
      ...(typeof entry.via === 'string' ? { via: entry.via } : {})
    });
  }
  return actions;
}

function freshnessOf(value: unknown): readonly SourceFreshness[] {
  if (!Array.isArray(value)) return [];
  const rows: SourceFreshness[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.source !== 'string') continue;
    rows.push({
      source: entry.source,
      dataAsOf: typeof entry.dataAsOf === 'string' ? entry.dataAsOf : null,
      // Same fail-toward-caution rule: an unreadable staleness flag counts as stale.
      stale: entry.stale !== false,
      staleAfterHours: typeof entry.staleAfterHours === 'number' ? entry.staleAfterHours : 0
    });
  }
  return rows;
}

/**
 * Validates a 2xx body as an envelope. Only ever called for a successful
 * upstream status — the Marketing Agent's errors are
 * `{ error: { code, message, details } }` and are passed through as errors,
 * never parsed as answers.
 */
export function parseAgentAnswer(body: unknown): ContractParseResult {
  if (!isRecord(body)) {
    return { kind: 'invalid', problems: ['the response body is not a JSON object'] };
  }

  // Version first, and before any other complaint: an envelope from a
  // future contract will legitimately fail the field checks below, and
  // reporting that as "malformed" would send an operator hunting for a bug
  // in the wrong service.
  const version = body.contractVersion;
  if (typeof version !== 'string' || version.length === 0) {
    return { kind: 'invalid', problems: ['contractVersion is missing — this is not a Marketing Agent answer envelope'] };
  }
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(version)) {
    return { kind: 'unsupported-version', found: version };
  }

  const problems: string[] = [];
  if (body.agent !== AGENT_NAME) problems.push(`agent must be "${AGENT_NAME}"`);
  if (typeof body.operation !== 'string' || body.operation.length === 0) problems.push('operation is missing');
  if (typeof body.asOf !== 'string' || Number.isNaN(Date.parse(body.asOf))) problems.push('asOf is missing or not a timestamp');
  if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) problems.push('status is missing or unrecognized');
  if (typeof body.confidence !== 'string' || !CONFIDENCES.includes(body.confidence)) problems.push('confidence is missing or unrecognized');
  if (!Array.isArray(body.headline)) problems.push('headline is missing');
  if (!('result' in body)) problems.push('result is missing');
  if (!Array.isArray(body.dataGaps)) problems.push('dataGaps is missing');
  if (!Array.isArray(body.nextActions)) problems.push('nextActions is missing');
  if (typeof body.ownerDecisionRequired !== 'boolean') problems.push('ownerDecisionRequired is missing');
  if (typeof body.dataEnvironment !== 'string') problems.push('dataEnvironment is missing');

  if (problems.length > 0) return { kind: 'invalid', problems };

  return {
    kind: 'answer',
    envelope: {
      agent: body.agent as string,
      contractVersion: version,
      operation: body.operation as string,
      asOf: body.asOf as string,
      status: body.status as AnswerStatus,
      headline: stringsOf(body.headline),
      result: body.result,
      confidence: body.confidence as ConfidenceLevel,
      evidence: evidenceOf(body.evidence),
      dataGaps: stringsOf(body.dataGaps),
      freshness: freshnessOf(body.freshness),
      nextActions: actionsOf(body.nextActions),
      ownerDecisionRequired: body.ownerDecisionRequired as boolean,
      dataEnvironment: body.dataEnvironment as string
    }
  };
}

/**
 * Blockers, as an operator would list them: whatever the agent said it could
 * not see, plus whatever the operation's own result calls blocked. Both are
 * read defensively — `result` is per-operation and JusticeOS must not require
 * a field it has not been promised.
 */
export function blockersOf(envelope: AgentAnswerEnvelope): readonly string[] {
  const fromResult: string[] = [];
  if (isRecord(envelope.result)) {
    fromResult.push(...stringsOf(envelope.result.blockers));
    fromResult.push(...stringsOf(envelope.result.blocked));
  }
  return [...new Set([...fromResult, ...envelope.dataGaps])];
}

/**
 * Which of the four approval states this answer is in. Deliberately derived
 * from the agent's own flags rather than from how the answer reads:
 *
 * - The agent saying it cannot answer, or listing `blocked` integrations, is
 *   BLOCKED.
 * - `ownerDecisionRequired` is the agent's own statement that something is
 *   waiting on Austin — that is APPROVAL_REQUIRED and nothing else, however
 *   confident the answer is.
 * - A prepare-work answer that produced something, with no decision pending,
 *   is PREPARED_WORK: a draft exists and is inert.
 * - Everything else is INFORMATIONAL.
 *
 * High confidence never moves an answer toward approval, and reading an
 * answer never moves it either — only a recorded decision does.
 */
export function approvalRequirementOf(envelope: AgentAnswerEnvelope): ApprovalRequirement {
  if (envelope.status === 'UNAVAILABLE') return 'BLOCKED';
  if (isRecord(envelope.result) && stringsOf(envelope.result.blocked).length > 0) return 'BLOCKED';
  if (envelope.ownerDecisionRequired) return 'APPROVAL_REQUIRED';
  if (isRecord(envelope.result) && envelope.result.prepared === true) return 'PREPARED_WORK';
  return 'INFORMATIONAL';
}

/**
 * Ordered by seriousness, not by likelihood. A provider rejecting our
 * credentials matters more than a source that is merely stale, and JusticeOS
 * reports the former even when both are true.
 */
const CONSTRAINT_PATTERNS: readonly { readonly kind: ConstraintKind; readonly pattern: RegExp }[] = [
  { kind: 'PROVIDER_BLOCKED', pattern: /authentication failed|auth[_ -]?error|provider (is )?blocked|blocked by (the )?provider|rate ?limit/i },
  { kind: 'BUDGET_EXHAUSTED', pattern: /budget|quota|spend (cap|limit)|request limit/i },
  { kind: 'BACKING_OFF', pattern: /consecutive failure|backing off|back[- ]off/i },
  { kind: 'BUSY', pattern: /lease|already running|in progress|held by/i },
  { kind: 'DEFERRED', pattern: /cooldown|not due|NOT_DUE|deferred/i },
  { kind: 'FACTS_UNVERIFIED', pattern: /verified business facts|cannot be published|no verified|unverified/i },
  { kind: 'NOT_CONFIGURED', pattern: /not configured|NOT_CONFIGURED|not wired/i },
  { kind: 'STALE_DATA', pattern: /is stale|stale \(/i }
];

/**
 * The single most important reason the agent is held up, if it is.
 *
 * This exists so Padawan can say "the watchlist recheck is in cooldown"
 * rather than retrying and reporting nothing. It reads the agent's own
 * sentences, which is a deliberate trade-off: the contract carries no
 * machine-readable constraint field, so this is a best-effort LABEL placed
 * next to the verbatim reason, never instead of it.
 */
export function constraintOf(envelope: AgentAnswerEnvelope, blockers: readonly string[] = blockersOf(envelope)): Constraint {
  const candidates = [...blockers, ...envelope.headline];
  for (const { kind, pattern } of CONSTRAINT_PATTERNS) {
    const hit = candidates.find((line) => pattern.test(line));
    if (hit) return { kind, reason: hit };
  }
  if (envelope.status === 'UNAVAILABLE') {
    return { kind: 'PROVIDER_BLOCKED', reason: envelope.headline[0] ?? 'The Marketing Agent reported it cannot answer.' };
  }
  return { kind: 'NONE', reason: '' };
}

export interface NormalizeOptions {
  readonly conversationId?: string | null;
  readonly taskId?: string | null;
  readonly idempotencyKey?: string | null;
}

function identifiersOf(envelope: AgentAnswerEnvelope, options: NormalizeOptions): AnswerIdentifiers {
  const result = isRecord(envelope.result) ? envelope.result : {};
  return {
    conversationId: options.conversationId ?? null,
    taskId: options.taskId ?? null,
    idempotencyKey: options.idempotencyKey ?? null,
    collectionRunId: typeof result.collectionRunId === 'string' ? result.collectionRunId : null,
    revisionId: typeof result.revisionId === 'string' ? result.revisionId : null
  };
}

/** The validated envelope as the rest of JusticeOS sees it. */
export function normalizeAnswer(envelope: AgentAnswerEnvelope, options: NormalizeOptions = {}): MarketingAnswer {
  const blockers = blockersOf(envelope);
  return {
    agent: AGENT_NAME,
    contractVersion: envelope.contractVersion,
    operation: envelope.operation,
    asOf: envelope.asOf,
    status: envelope.status,
    summary: envelope.headline,
    result: envelope.result,
    confidence: envelope.confidence,
    evidence: envelope.evidence,
    recommendation: envelope.nextActions,
    approvalRequirement: approvalRequirementOf(envelope),
    sourceFreshness: envelope.freshness,
    blockers,
    // "What could JusticeOS actually do next" — the subset the agent itself
    // pointed at an endpoint or job. An action with no `via` is advice for
    // Austin, not a call Padawan can make.
    followUpActions: envelope.nextActions.filter((action) => typeof action.via === 'string' && action.via.length > 0),
    constraint: constraintOf(envelope, blockers),
    identifiers: identifiersOf(envelope, options),
    dataEnvironment: envelope.dataEnvironment
  };
}
