/**
 * Every decision the Marketing workspace makes about what to show and what
 * to allow, as pure functions over the API's own data — components render
 * these, they never derive them (ADR 0006's rule, and the reason this file
 * is where the tests live).
 *
 * Two rules are load-bearing and deliberately expressed here rather than in
 * JSX, where they would be easy to lose in a refactor:
 *
 *  1. An internal-only project fact is a NAME, never a value. The API sends
 *     names only; `projectFactGroups` keeps them in a separate group that
 *     structurally has nowhere to put a value.
 *  2. Approval is allowed only when the API itself says so — active
 *     revision, APPROVE_CAMPAIGN in availableActions, health READY, zero
 *     blockers. `approvalGate` returns the reason when it isn't, so the UI
 *     can explain rather than just disable.
 */
import type { MarketingApiError, MarketingErrorCode } from './client';
import type {
  MarketingCampaignReview,
  MarketingChannelPreview,
  MarketingMediaItem,
  MarketingQueueItem,
} from './types';
import type { MessageKey } from '../i18n/messages';

/** What a queue row actually needs from the operator, derived only from returned fields. */
export type QueueItemState = 'CHANGES_REQUESTED' | 'BLOCKED' | 'READY_FOR_APPROVAL' | 'NOT_REVIEWABLE';

export function queueItemState(item: MarketingQueueItem): QueueItemState {
  // An outstanding request the operator themselves raised comes first: the
  // campaign is waiting on a regeneration, not on a decision.
  if (item.openChangeRequestCount > 0) return 'CHANGES_REQUESTED';
  if (item.approvalHealthStatus === 'BLOCKED' || item.blockerCount > 0) return 'BLOCKED';
  if (item.approvalHealthStatus === 'READY_FOR_APPROVAL') return 'READY_FOR_APPROVAL';
  return 'NOT_REVIEWABLE';
}

export const QUEUE_SECTION_ORDER: readonly QueueItemState[] = [
  'READY_FOR_APPROVAL',
  'BLOCKED',
  'CHANGES_REQUESTED',
  'NOT_REVIEWABLE',
];

export interface QueueSection {
  readonly state: QueueItemState;
  readonly items: readonly MarketingQueueItem[];
}

/** Groups the queue into the sections the screen shows, dropping empty ones. */
export function queueSections(items: readonly MarketingQueueItem[]): QueueSection[] {
  return QUEUE_SECTION_ORDER.map((state) => ({ state, items: items.filter((item) => queueItemState(item) === state) })).filter(
    (section) => section.items.length > 0,
  );
}

export const QUEUE_STATE_LABEL: Record<QueueItemState, MessageKey> = {
  READY_FOR_APPROVAL: 'mkt.state.ready',
  BLOCKED: 'mkt.state.blocked',
  CHANGES_REQUESTED: 'mkt.state.changesRequested',
  NOT_REVIEWABLE: 'mkt.state.notReviewable',
};

export type ApprovalBlockReason =
  | 'HISTORICAL_REVISION'
  | 'BLOCKERS'
  | 'NOT_OFFERED'
  | 'ALREADY_DECIDED';

export interface ApprovalGate {
  readonly canApprove: boolean;
  readonly reason?: ApprovalBlockReason;
}

/**
 * Approval is never inferred. A historical revision can never be approved
 * (the Marketing Agent would refuse anyway — this makes sure the UI doesn't
 * even offer it), and neither can one the API did not list APPROVE_CAMPAIGN
 * for.
 */
export function approvalGate(review: MarketingCampaignReview): ApprovalGate {
  if (!review.revision.isActive) return { canApprove: false, reason: 'HISTORICAL_REVISION' };
  if (review.decision) return { canApprove: false, reason: 'ALREADY_DECIDED' };
  if (review.approvalHealth.status !== 'READY_FOR_APPROVAL' || review.approvalHealth.blockers.length > 0) {
    return { canApprove: false, reason: 'BLOCKERS' };
  }
  if (!review.availableActions.includes('APPROVE_CAMPAIGN')) return { canApprove: false, reason: 'NOT_OFFERED' };
  return { canApprove: true };
}

/** Whether a content-changing action should be offered at all, per the API's own list. */
export function canRun(review: MarketingCampaignReview, action: string): boolean {
  return review.revision.isActive && review.availableActions.includes(action);
}

export interface FactRow {
  readonly field: string;
  readonly value: string;
}

export interface ProjectFactGroups {
  /** Public, marketing-authorized facts: the only group that carries values. */
  readonly authorized: readonly FactRow[];
  /** Field NAMES only — there is deliberately no value slot on this type. */
  readonly internalOnlyFields: readonly string[];
  readonly unknownFields: readonly string[];
  readonly changedSinceGeneration: readonly string[];
  readonly contextVersion?: number;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(displayValue).filter((entry) => entry.length > 0).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${displayValue(entry)}`)
      .join(', ');
  }
  return String(value);
}

export function projectFactGroups(review: MarketingCampaignReview): ProjectFactGroups {
  const facts = review.verifiedProjectFacts;
  if (!facts) {
    return { authorized: [], internalOnlyFields: [], unknownFields: [], changedSinceGeneration: [] };
  }
  const authorized = Object.entries(facts.publicFacts)
    .map(([field, value]) => ({ field, value: displayValue(value) }))
    .filter((row) => row.value.length > 0 && row.value !== 'UNKNOWN');

  return {
    authorized,
    internalOnlyFields: facts.internalOnlyFields,
    unknownFields: facts.unknownFields,
    changedSinceGeneration: facts.changedSinceGeneration,
    contextVersion: facts.contextVersion,
  };
}

export interface PreviewField {
  readonly labelKey: MessageKey;
  readonly value: string;
  /** Long-form prose gets more room than a one-line attribute. */
  readonly kind: 'text' | 'prose' | 'list';
}

const TEXT_FIELDS: Record<string, { readonly labelKey: MessageKey; readonly kind: PreviewField['kind'] }> = {
  headline: { labelKey: 'mkt.preview.headline', kind: 'text' },
  hook: { labelKey: 'mkt.preview.hook', kind: 'text' },
  openingHook: { labelKey: 'mkt.preview.hook', kind: 'text' },
  postCopy: { labelKey: 'mkt.preview.body', kind: 'prose' },
  caption: { labelKey: 'mkt.preview.caption', kind: 'prose' },
  localPostCopy: { labelKey: 'mkt.preview.body', kind: 'prose' },
  bodyDraft: { labelKey: 'mkt.preview.bodyDraft', kind: 'prose' },
  professionalAngle: { labelKey: 'mkt.preview.angle', kind: 'prose' },
  title: { labelKey: 'mkt.preview.title', kind: 'text' },
  seoTitle: { labelKey: 'mkt.preview.seoTitle', kind: 'text' },
  metaDescription: { labelKey: 'mkt.preview.metaDescription', kind: 'prose' },
  proposedSlug: { labelKey: 'mkt.preview.slug', kind: 'text' },
  primaryQueryConcept: { labelKey: 'mkt.preview.queryConcept', kind: 'text' },
  contentType: { labelKey: 'mkt.preview.contentType', kind: 'text' },
  postType: { labelKey: 'mkt.preview.postType', kind: 'text' },
  format: { labelKey: 'mkt.preview.format', kind: 'text' },
  authorizedServiceArea: { labelKey: 'mkt.preview.serviceArea', kind: 'text' },
  verifiedGeographicRelevance: { labelKey: 'mkt.preview.geographicRelevance', kind: 'text' },
  localContext: { labelKey: 'mkt.preview.localContext', kind: 'text' },
  mediaTreatment: { labelKey: 'mkt.preview.mediaTreatment', kind: 'text' },
};

const LIST_FIELDS: Record<string, MessageKey> = {
  hashtags: 'mkt.preview.hashtags',
  outline: 'mkt.preview.outline',
  overlayText: 'mkt.preview.overlayText',
  proposedShotOrder: 'mkt.preview.shotOrder',
  secondaryQueryConcepts: 'mkt.preview.secondaryConcepts',
};

/**
 * The order fields are shown in — headline/body first, structure after, so
 * a reviewer reads the copy the customer would see before the SEO plumbing.
 * Anything not listed here simply isn't rendered as a field (asset ids and
 * claims have their own presentation), which is what keeps the preview from
 * degenerating into raw JSON.
 */
const FIELD_ORDER = [
  'headline',
  'hook',
  'openingHook',
  'title',
  'postCopy',
  'caption',
  'localPostCopy',
  'bodyDraft',
  'professionalAngle',
  'metaDescription',
  'outline',
  'hashtags',
  'overlayText',
  'proposedShotOrder',
  'seoTitle',
  'proposedSlug',
  'primaryQueryConcept',
  'secondaryQueryConcepts',
  'contentType',
  'postType',
  'format',
  'localContext',
  'verifiedGeographicRelevance',
  'authorizedServiceArea',
  'mediaTreatment',
];

export interface ChannelPreviewModel {
  readonly platform: string;
  readonly slot: string;
  readonly fields: readonly PreviewField[];
  readonly cta?: string;
  readonly assetCount: number;
  readonly claims: readonly { readonly statement: string; readonly verificationStatus: string; readonly evidenceType: string }[];
  readonly provenanceStatus?: string;
}

export function channelPreviewModel(preview: MarketingChannelPreview): ChannelPreviewModel {
  const content = preview.content ?? {};
  const fields: PreviewField[] = [];

  for (const key of FIELD_ORDER) {
    const raw = content[key];
    if (raw === undefined || raw === null) continue;

    const listLabel = LIST_FIELDS[key];
    if (listLabel) {
      const entries = Array.isArray(raw) ? raw.map((entry) => String(entry)).filter((entry) => entry.length > 0) : [];
      if (entries.length > 0) fields.push({ labelKey: listLabel, value: entries.join(' · '), kind: 'list' });
      continue;
    }

    const textField = TEXT_FIELDS[key];
    if (textField && typeof raw === 'string' && raw.trim().length > 0) {
      fields.push({ labelKey: textField.labelKey, value: raw, kind: textField.kind });
    }
  }

  const cta = (content.cta as { label?: unknown } | undefined)?.label;
  const assetIds = [
    ...((content.assetIds as unknown[] | undefined) ?? []),
    ...((content.videoAssetIds as unknown[] | undefined) ?? []),
  ];

  return {
    platform: preview.platform,
    slot: preview.slot,
    fields,
    ...(typeof cta === 'string' && cta.length > 0 ? { cta } : {}),
    assetCount: assetIds.length,
    claims: (preview.factualClaimsUsed ?? []).map((claim) => ({
      statement: claim.statement,
      verificationStatus: claim.verificationStatus,
      evidenceType: claim.evidenceType,
    })),
    ...(preview.provenanceStatus ? { provenanceStatus: preview.provenanceStatus } : {}),
  };
}

/** Which copy fields an operator may edit for a platform — mirrors the Marketing Agent's own EDITABLE_COPY_FIELDS; anything else is rejected upstream as INVALID_EDIT. */
export const EDITABLE_FIELDS_BY_PLATFORM: Readonly<Record<string, readonly string[]>> = {
  FACEBOOK: ['postCopy', 'headline', 'cta.label'],
  INSTAGRAM: ['caption', 'hook', 'cta.label'],
  LINKEDIN: ['postCopy', 'professionalAngle', 'cta.label'],
  GOOGLE_BUSINESS_PROFILE: ['localPostCopy', 'cta.label'],
  WEBSITE: ['title', 'seoTitle', 'metaDescription', 'primaryQueryConcept', 'bodyDraft', 'cta.label'],
  TIKTOK: ['caption', 'openingHook', 'cta.label'],
};

/** The current value of an editable field, for pre-filling the edit form. */
export function currentFieldValue(preview: MarketingChannelPreview, field: string): string {
  const content = preview.content ?? {};
  if (field === 'cta.label') {
    const label = (content.cta as { label?: unknown } | undefined)?.label;
    return typeof label === 'string' ? label : '';
  }
  const value = content[field];
  return typeof value === 'string' ? value : '';
}

/** Only fields whose value actually changed are sent — the Marketing Agent rejects a no-op edit. */
export function changedFields(preview: MarketingChannelPreview, draft: Readonly<Record<string, string>>): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const [field, value] of Object.entries(draft)) {
    if (value.trim().length > 0 && value.trim() !== currentFieldValue(preview, field).trim()) {
      changes[field] = value.trim();
    }
  }
  return changes;
}

export interface MediaCardModel {
  readonly mediaAssetId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly safetyReviewState: string;
  readonly currentAssetState: string;
  readonly projectName?: string;
  /** Always true in this increment: the API returns metadata, never bytes. */
  readonly previewUnavailable: boolean;
}

export function mediaCardModel(item: MarketingMediaItem): MediaCardModel {
  return {
    mediaAssetId: item.mediaAssetId,
    filename: item.originalFilename ?? item.mediaAssetId,
    mimeType: item.mimeType,
    safetyReviewState: item.safetyReviewState,
    currentAssetState: item.currentAssetState,
    ...(item.projectName ? { projectName: item.projectName } : {}),
    // The gateway serves no media bytes, and inventing a Drive link would
    // be exactly the insecure shortcut the integration doc rules out.
    previewUnavailable: item.content?.kind !== 'SERVED',
  };
}

/**
 * Media replacement needs a pool of eligible replacement assets to choose from, and
 * the review DTO carries only the assets this revision already uses. Until
 * the API exposes eligible alternatives (and a way to look at them), the
 * action stays visibly disabled rather than opening a picker that cannot
 * honestly show anything.
 */
export function canReplaceMedia(review: MarketingCampaignReview): boolean {
  void review;
  return false;
}

export interface RevisionTimelineEntry {
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly createdAt: string;
  readonly actor?: string;
  readonly reasonKey: MessageKey;
  readonly isActive: boolean;
  readonly isViewing: boolean;
  readonly decision?: string | null;
}

const PROVENANCE_LABEL: Record<string, MessageKey> = {
  INITIAL_GENERATION: 'mkt.revision.generated',
  HUMAN_EDIT: 'mkt.revision.humanEdit',
  REGENERATED: 'mkt.revision.regenerated',
  SYSTEM_REPAIR: 'mkt.revision.systemRepair',
};

export function revisionTimeline(review: MarketingCampaignReview): RevisionTimelineEntry[] {
  return [...review.revisionHistory]
    .sort((a, b) => b.revisionNumber - a.revisionNumber)
    .map((entry) => ({
      revisionId: entry.revisionId,
      revisionNumber: entry.revisionNumber,
      createdAt: entry.createdAt,
      ...(entry.createdByActor ? { actor: entry.createdByActor } : {}),
      reasonKey: PROVENANCE_LABEL[entry.provenanceReason ?? ''] ?? 'mkt.revision.changed',
      isActive: entry.isActive,
      isViewing: entry.revisionId === review.revision.id,
      decision: entry.decision ?? null,
    }));
}

/**
 * How the workspace reacts to each stable error code: what to say, and
 * whether the right move is to refetch (the state moved under the
 * operator) rather than to leave a stale screen up.
 */
export interface ErrorPresentation {
  readonly messageKey: MessageKey;
  readonly refetch: boolean;
  /** Blockers/details worth showing verbatim, already redacted upstream. */
  readonly details: readonly string[];
}

export function presentError(error: MarketingApiError): ErrorPresentation {
  const details = Array.isArray(error.details?.blockers)
    ? (error.details.blockers as unknown[]).map((blocker) => String(blocker))
    : [];
  const byCode: Partial<Record<MarketingErrorCode, { key: MessageKey; refetch: boolean }>> = {
    REVISION_STALE: { key: 'mkt.error.revisionStale', refetch: true },
    APPROVAL_BLOCKED: { key: 'mkt.error.approvalBlocked', refetch: true },
    CONTEXT_CHANGED: { key: 'mkt.error.contextChanged', refetch: true },
    MEDIA_CONFLICT: { key: 'mkt.error.mediaConflict', refetch: true },
    CAMPAIGN_ALREADY_FINAL: { key: 'mkt.error.campaignFinal', refetch: true },
    INVALID_EDIT: { key: 'mkt.error.invalidEdit', refetch: false },
    INVALID_REQUEST: { key: 'mkt.error.invalidRequest', refetch: false },
    INVALID_ACTION: { key: 'mkt.error.invalidAction', refetch: true },
    CAMPAIGN_NOT_FOUND: { key: 'mkt.error.notFound', refetch: false },
    REVISION_NOT_FOUND: { key: 'mkt.error.notFound', refetch: false },
    UNAUTHORIZED: { key: 'mkt.error.unauthorized', refetch: false },
    GATEWAY_SESSION_NOT_CONFIGURED: { key: 'mkt.error.unauthorized', refetch: false },
    MARKETING_AGENT_UNAVAILABLE: { key: 'mkt.error.unavailable', refetch: false },
    GATEWAY_UNREACHABLE: { key: 'mkt.error.unavailable', refetch: false },
    MARKETING_AGENT_NOT_CONFIGURED: { key: 'mkt.error.notConfigured', refetch: false },
    MARKETING_ACTOR_NOT_CONFIGURED: { key: 'mkt.error.actorNotConfigured', refetch: false },
  };
  const mapped = byCode[error.code];
  return { messageKey: mapped?.key ?? 'mkt.error.generic', refetch: mapped?.refetch ?? false, details };
}

/**
 * The two-part success message an approval shows: what happened, and —
 * immediately below it — that nothing was published. They are returned
 * together so no call site can show the first without the second.
 */
export function approvalSuccessNotice(): { readonly messageKey: MessageKey; readonly secondaryKey: MessageKey } {
  return { messageKey: 'mkt.result.approved', secondaryKey: 'mkt.result.approvedNotPublished' };
}

/**
 * One idempotency key per operator action, reused on retry so a
 * double-click or a retried request can never apply twice. `randomUUID`
 * exists in every browser this app supports; the fallback keeps SSR and
 * older test environments working.
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `mkt-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
