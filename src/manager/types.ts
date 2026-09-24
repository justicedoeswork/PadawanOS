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

export interface MarketingEventView {
  readonly id: string;
  readonly kind: string;
  readonly severity: string | null;
  readonly title: string;
  readonly summary: string;
  readonly trade: string | null;
  readonly channel: string | null;
  readonly detectedAt: string | null;
  readonly lastDetectedAt: string | null;
  readonly occurrences: number;
  readonly ownerAttentionRequired: boolean;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly handoff: { readonly state: string; readonly ref: string | null; readonly at: string | null; readonly detail: string | null };
  readonly dismissedAt: string | null;
}

export interface MarketingEventsResponse {
  readonly events: readonly MarketingEventView[];
  readonly awaitingOwner: number;
  readonly handoffConfigured: boolean;
  readonly lastSyncAt: string | null;
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
  readonly events: { readonly retained: number; readonly awaitingOwner: number; readonly handoffConfigured: boolean; readonly lastSyncAt: string | null };
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
