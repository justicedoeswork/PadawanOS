/**
 * What the JusticeOS gateway's Justice Manager bridge answers with.
 *
 * These mirror `gateway/src/marketing/contract.ts`, declared again on this side
 * of the wire for the same reason `src/marketing/types.ts` already does it: the
 * browser bundle never imports from `gateway/src` (a test enforces that, since
 * such an import is exactly how a server-only credential would end up in the
 * bundle). The gateway owns the shape; this is the page's reading of it.
 *
 * Nothing here carries a credential, and nothing here is the Marketing Agent's
 * own envelope — the gateway has already validated the contract version and
 * refused anything it could not read, so the page never sees an unparsed
 * upstream body.
 */

export type ApprovalRequirement = 'INFORMATIONAL' | 'PREPARED_WORK' | 'APPROVAL_REQUIRED' | 'BLOCKED';
export type AnswerStatus = 'OK' | 'DEGRADED' | 'UNAVAILABLE';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

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

export interface EvidenceLink {
  readonly kind: string;
  readonly ref: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface RecommendedAction {
  readonly action: string;
  readonly reason: string;
  readonly requiresOwnerApproval: boolean;
  readonly via?: string;
}

export interface SourceFreshness {
  readonly source: string;
  readonly dataAsOf: string | null;
  readonly stale: boolean;
  readonly staleAfterHours: number;
}

export interface MarketingAnswer {
  readonly agent: 'MARKETING_AGENT';
  readonly contractVersion: string;
  readonly operation: string;
  readonly asOf: string;
  readonly status: AnswerStatus;
  readonly summary: readonly string[];
  readonly result: unknown;
  readonly confidence: ConfidenceLevel;
  readonly evidence: readonly EvidenceLink[];
  readonly recommendation: readonly RecommendedAction[];
  readonly approvalRequirement: ApprovalRequirement;
  readonly sourceFreshness: readonly SourceFreshness[];
  readonly blockers: readonly string[];
  readonly followUpActions: readonly RecommendedAction[];
  readonly constraint: { readonly kind: ConstraintKind; readonly reason: string };
  readonly identifiers: {
    readonly conversationId: string | null;
    readonly taskId: string | null;
    readonly idempotencyKey: string | null;
    readonly collectionRunId: string | null;
    readonly revisionId: string | null;
  };
  readonly dataEnvironment: string;
}

/**
 * A decision the gateway has NOT taken. It arrives when a request was worded
 * as an approval: the page renders it as a control, and only a deliberate
 * click sends it.
 */
export interface PendingDecision {
  readonly route: string;
  readonly method: 'POST';
  readonly body: { readonly revisionId: string | null; readonly decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION'; readonly confirmed: true };
  /** Fields the page must supply before the action can be taken — `revisionId` when the request did not name one. */
  readonly missing: readonly string[];
  readonly note: string;
}

export type ManagerRouting =
  | { readonly kind: 'execute'; readonly operation: string; readonly rationale: string }
  | { readonly kind: 'needs-confirmation'; readonly operation: 'decisions'; readonly rationale: string }
  | { readonly kind: 'unroutable'; readonly reason: string; readonly suggestions: readonly string[] };

export interface ManagerAskResponse {
  readonly agent: string;
  readonly contractVersion: string;
  readonly operation: string | null;
  readonly routing: ManagerRouting;
  readonly answer: MarketingAnswer | null;
  readonly supporting?: MarketingAnswer | null;
  readonly approvalRequirement: ApprovalRequirement;
  readonly pendingAction: PendingDecision | null;
  readonly deduped?: boolean;
  readonly task: { readonly conversationId: string | null; readonly taskId: string | null; readonly originalTaskId?: string | null };
}

export interface ManagerDecisionResponse {
  readonly operation: string;
  readonly answer: MarketingAnswer;
  readonly published: false;
  readonly publicationNote: string;
}

/**
 * Where one event stands in JusticeOS.
 *
 *   NEW            Seen, not yet taken. Either never claimed, or read only.
 *   DELIVERING     Claimed and in flight to Communications right now.
 *   DELIVERED      Communications accepted it.
 *   DUPLICATE      Already handled — ours or the receiver's idempotency said so.
 *   RETRY_PENDING  A transient failure; the outbox will offer it again.
 *   FAILED         Permanently undeliverable, and kept as such.
 */
export type MarketingEventStatus = 'NEW' | 'DELIVERING' | 'DELIVERED' | 'DUPLICATE' | 'RETRY_PENDING' | 'FAILED';

/** The Marketing Agent's own projection of one outbound event, relayed unchanged. */
export interface OutboundMarketingEventView {
  readonly id: string;
  readonly eventId: string | null;
  /** The public MARKETING_* name where the agent has one; otherwise its durable internal type. */
  readonly kind: string;
  readonly internalType: string;
  readonly severity: string | null;
  readonly significance: string | null;
  readonly trade: string | null;
  readonly channel: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly recommendedAction: string | null;
  readonly ownerApprovalRequired: boolean;
  readonly firstDetectedAt: string | null;
  readonly lastDetectedAt: string | null;
  readonly occurrenceCount: number | null;
  readonly dedupeKey: string | null;
  readonly idempotencyKey: string;
}

export interface MarketingEventView {
  /** The outbox row id — upstream-assigned, and what an acknowledgement names. */
  readonly id: string;
  readonly event: OutboundMarketingEventView;
  readonly status: MarketingEventStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly delivery: {
    readonly status: MarketingEventStatus;
    readonly at: string;
    readonly ref: string | null;
    readonly detail: string | null;
    /** What JusticeOS reported upstream. Null before the acknowledgement. */
    readonly acknowledgedResult: string | null;
    /** False when the acknowledgement could not be confirmed — the event is not settled upstream. */
    readonly acknowledged: boolean;
    readonly attempts: number;
  };
  /**
   * Dismissing stops the notification. It does NOT delete the upstream event:
   * the outbox row is insert-only and undeletable, and JusticeOS makes no call
   * that could touch it.
   */
  readonly dismissedAt: string | null;
}

export interface MarketingEventsResponse {
  readonly transport: 'MARKETING_OUTBOX';
  readonly consumer: string;
  readonly events: readonly MarketingEventView[];
  readonly awaitingOwner: number;
  readonly byStatus: Readonly<Record<MarketingEventStatus, number>>;
  readonly handoffConfigured: boolean;
  readonly lastRelayAt: string | null;
  readonly degraded: readonly string[];
}

/** What one claim → deliver → acknowledge cycle did. */
export interface MarketingRelayResponse {
  readonly transport: 'MARKETING_OUTBOX';
  readonly relay: {
    readonly ranAt: string;
    readonly consumer: string;
    readonly handoffConfigured: boolean;
    /** READ_ONLY when no Communications endpoint is wired: events are read and retained, nothing is claimed. */
    readonly mode: 'CLAIM_AND_DELIVER' | 'READ_ONLY';
    readonly claimed: number;
    readonly delivered: number;
    readonly duplicate: number;
    readonly retryScheduled: number;
    readonly failed: number;
    readonly abandoned: number;
    /** Delivered, but the acknowledgement was not confirmed. Retried with the SAME ack key next cycle. */
    readonly ackUncertain: number;
    /** Acknowledgements refused deterministically. Not retried with the same key; a standing integration problem. */
    readonly ackRefused: number;
    readonly ackReplayed: number;
    readonly claimInvalid: number;
    readonly alreadyFinal: number;
    readonly notFound: number;
    readonly observed: number;
    readonly degraded: readonly string[];
    readonly events: readonly MarketingEventView[];
  };
}

export interface MarketingHealthView {
  readonly state: 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'NOT_CONFIGURED';
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
  readonly scheduler: { readonly owner: string; readonly justiceOsDrivesTicks: boolean; readonly disabled: boolean };
  readonly research: { readonly posture: string; readonly justiceOsMayTriggerPaidResearch: boolean };
  readonly businessFacts: { readonly state: string; readonly observedAt: string | null; readonly detail: string | null };
  readonly events: {
    readonly transport: 'MARKETING_OUTBOX';
    readonly consumer: string;
    readonly claimLimit: number;
    readonly claimTtlMs: number;
    readonly retained: number;
    readonly awaitingOwner: number;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly handoffConfigured: boolean;
    readonly lastRelayAt: string | null;
    readonly degraded: readonly string[];
  };
  readonly degraded: readonly string[];
  readonly blocked: readonly string[];
  readonly checkedAt: string;
}

/** Registry entry, as `GET /api/agents` returns it. */
export interface RegisteredAgentView {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly transport: string;
  readonly basePath: string | null;
  readonly capabilities: readonly string[];
  readonly autonomy: { readonly automatic: readonly string[]; readonly ownerApprovalRequired: readonly string[]; readonly never: readonly string[] };
  readonly contractVersion: string | null;
  readonly autonomous: boolean;
}
