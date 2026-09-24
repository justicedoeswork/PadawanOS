/**
 * What the Justice Manager panel shows, as a value rather than as JSX.
 *
 * The same split ADR 0006 already draws for this project: meaning here, pixels
 * in the component. Everything below is pure and directly testable — which
 * matters more than usual here, because the thing being decided is whether a
 * given answer puts an APPROVE button on the screen, and that decision should
 * be provable without rendering anything.
 *
 * Two rules it enforces on the page's behalf:
 *
 *   - An approval control appears only for an answer the AGENT said needs a
 *     decision, and only when there is a specific revision to decide about.
 *     "Approve" with nothing named is not offered.
 *   - A contract mismatch is reported as an integration problem, never as a
 *     marketing answer. The panel does not degrade into guessing.
 */
import type { MessageKey } from '../i18n/messages';
import type { ManagerBridgeError } from './client';
import type { ApprovalRequirement, MarketingAnswer, ManagerAskResponse } from './types';

/** A decision the panel may offer, with everything the request needs already resolved. */
export interface DecisionControl {
  readonly decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION';
  readonly revisionId: string;
  /** REQUEST_REVISION cannot be sent without one — the agent cannot act on "no". */
  readonly reasonRequired: boolean;
}

export interface PanelAnswerView {
  readonly kind: 'answer';
  readonly operation: string;
  readonly approvalRequirement: ApprovalRequirement;
  /** The agent's own sentences, relayed. */
  readonly summary: readonly string[];
  readonly rationale: string;
  readonly confidence: string;
  readonly blockers: readonly string[];
  readonly staleSources: readonly string[];
  readonly followUps: readonly { readonly action: string; readonly reason: string; readonly requiresOwnerApproval: boolean }[];
  readonly evidenceCount: number;
  readonly constraint: { readonly kind: string; readonly reason: string } | null;
  readonly decisions: readonly DecisionControl[];
  /** True when this answer was replayed from an identical request rather than newly asked. */
  readonly deduped: boolean;
  readonly taskId: string | null;
}

export interface PanelPendingView {
  readonly kind: 'pending-decision';
  readonly decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION';
  readonly rationale: string;
  readonly note: string;
  /** Null when the request named no revision: the panel asks which one rather than picking. */
  readonly revisionId: string | null;
  readonly reasonRequired: boolean;
}

export interface PanelUnroutableView {
  readonly kind: 'unroutable';
  readonly reason: string;
  readonly suggestions: readonly string[];
}

export interface PanelProblemView {
  readonly kind: 'problem';
  /** An integration fault (a contract JusticeOS cannot read) as opposed to a marketing-side refusal. */
  readonly integration: boolean;
  readonly messageKey: MessageKey;
  /** The gateway's own words, shown under the translated headline so nothing is lost in paraphrase. */
  readonly detail: string;
}

export type PanelView = PanelAnswerView | PanelPendingView | PanelUnroutableView | PanelProblemView;

const CONFIDENCE_LABELS: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', NONE: 'None' };

/** Error codes that mean the two services disagree about the contract, not that marketing said no. */
const INTEGRATION_CODES: readonly string[] = ['MARKETING_CONTRACT_UNSUPPORTED', 'MARKETING_CONTRACT_INVALID'];

const PROBLEM_MESSAGE_KEYS: Partial<Record<string, MessageKey>> = {
  MARKETING_CONTRACT_UNSUPPORTED: 'manager.error.contract',
  MARKETING_CONTRACT_INVALID: 'manager.error.contract',
  MARKETING_AGENT_UNAVAILABLE: 'manager.error.unavailable',
  MARKETING_AGENT_NOT_CONFIGURED: 'manager.error.notConfigured',
  MARKETING_ACTOR_NOT_CONFIGURED: 'manager.error.notConfigured',
  AGENT_NOT_CONFIGURED: 'manager.error.notConfigured',
  DEMAND_NOT_CONFIGURED: 'manager.error.notConfigured',
  AUTONOMY_REFUSED: 'manager.error.refused',
  UNAUTHORIZED: 'manager.error.signedOut',
  GATEWAY_UNREACHABLE: 'manager.error.unavailable'
};

export function problemView(error: ManagerBridgeError): PanelProblemView {
  return {
    kind: 'problem',
    integration: INTEGRATION_CODES.includes(error.code),
    messageKey: PROBLEM_MESSAGE_KEYS[error.code] ?? 'manager.error.generic',
    detail: error.message
  };
}

/**
 * The decision controls this answer earns.
 *
 * Empty unless the agent itself said a decision is pending AND the answer
 * names the revision it is about. Both conditions matter: the first is the
 * agent's judgement, and the second is what stops "approve" from being a
 * button with no object. A prepared package that carries no revision id gets
 * no controls, and the panel says which workspace to go to instead.
 */
export function decisionControlsFor(answer: MarketingAnswer): readonly DecisionControl[] {
  if (answer.approvalRequirement !== 'APPROVAL_REQUIRED') return [];
  const revisionId = answer.identifiers.revisionId;
  if (!revisionId) return [];
  return [
    { decision: 'APPROVE', revisionId, reasonRequired: false },
    { decision: 'REJECT', revisionId, reasonRequired: false },
    { decision: 'REQUEST_REVISION', revisionId, reasonRequired: true }
  ];
}

/** Sources the agent reported as out of date, phrased for a person. */
export function staleSourcesOf(answer: MarketingAnswer): readonly string[] {
  return answer.sourceFreshness.filter((row) => row.stale).map((row) => `${row.source} (latest ${row.dataAsOf ?? 'never'})`);
}

/** One ask response, as the panel renders it. */
export function panelViewFor(response: ManagerAskResponse): PanelView {
  if (response.routing.kind === 'unroutable') {
    return { kind: 'unroutable', reason: response.routing.reason, suggestions: response.routing.suggestions };
  }

  if (response.pendingAction) {
    const decision = response.pendingAction.body.decision;
    return {
      kind: 'pending-decision',
      decision,
      rationale: response.routing.kind === 'needs-confirmation' ? response.routing.rationale : '',
      note: response.pendingAction.note,
      revisionId: response.pendingAction.body.revisionId,
      reasonRequired: decision === 'REQUEST_REVISION'
    };
  }

  const answer = response.answer;
  if (!answer) {
    // The gateway routed the request but returned nothing to show. Reporting
    // it as a problem is the honest move: there is no answer to relay, and
    // inventing an empty one would read as "marketing has nothing going on".
    return { kind: 'problem', integration: false, messageKey: 'manager.error.generic', detail: '' };
  }

  return {
    kind: 'answer',
    operation: answer.operation,
    approvalRequirement: answer.approvalRequirement,
    summary: answer.summary,
    rationale: response.routing.kind === 'execute' ? response.routing.rationale : '',
    confidence: CONFIDENCE_LABELS[answer.confidence] ?? answer.confidence,
    blockers: answer.blockers,
    staleSources: staleSourcesOf(answer),
    followUps: answer.followUpActions.map((action) => ({ action: action.action, reason: action.reason, requiresOwnerApproval: action.requiresOwnerApproval })),
    evidenceCount: answer.evidence.length,
    constraint: answer.constraint.kind === 'NONE' ? null : answer.constraint,
    decisions: decisionControlsFor(answer),
    deduped: response.deduped === true,
    taskId: response.task.taskId
  };
}

/** The i18n key for an approval state's badge. */
export function approvalBadgeKey(requirement: ApprovalRequirement): MessageKey {
  switch (requirement) {
    case 'APPROVAL_REQUIRED':
      return 'manager.state.approvalRequired';
    case 'PREPARED_WORK':
      return 'manager.state.preparedWork';
    case 'BLOCKED':
      return 'manager.state.blocked';
    case 'INFORMATIONAL':
      return 'manager.state.informational';
  }
}

export function decisionLabelKey(decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION'): MessageKey {
  if (decision === 'APPROVE') return 'manager.decision.approve';
  if (decision === 'REJECT') return 'manager.decision.reject';
  return 'manager.decision.revise';
}
