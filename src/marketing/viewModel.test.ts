import { describe, expect, it } from 'vitest';
import {
  approvalGate,
  approvalSuccessNotice,
  canReplaceMedia,
  canRun,
  changedFields,
  channelPreviewModel,
  currentFieldValue,
  mediaCardModel,
  newIdempotencyKey,
  presentError,
  projectFactGroups,
  queueItemState,
  queueSections,
  revisionTimeline,
} from './viewModel';
import { messages } from '../i18n/messages';
import type { MarketingCampaignReview, MarketingQueueItem } from './types';

/** A campaign the Marketing Agent would really return for the validated Otis St shape. */
function queueItem(overrides: Partial<MarketingQueueItem> = {}): MarketingQueueItem {
  return {
    campaignId: 'campaign-1',
    revisionId: 'revision-1',
    revisionNumber: 1,
    title: 'Otis St — Project Highlights',
    status: 'DRAFT',
    objective: 'PROJECT_CREDIBILITY',
    serviceTrade: 'ROOFING',
    geographicMarket: 'Greenville, SC',
    serviceAreaMarket: 'Greenville County, South Carolina',
    channels: ['FACEBOOK', 'WEBSITE'],
    mediaCount: 1,
    blockerCount: 0,
    approvalHealthStatus: 'READY_FOR_APPROVAL',
    openChangeRequestCount: 0,
    reviewable: true,
    createdAt: '2026-09-17T15:00:00.000Z',
    updatedAt: '2026-09-17T15:00:00.000Z',
    ...overrides,
  };
}

function review(overrides: Partial<MarketingCampaignReview> = {}): MarketingCampaignReview {
  return {
    campaign: { id: 'campaign-1', name: 'Otis St — Project Highlights', status: 'DRAFT' },
    revision: { id: 'revision-2', revisionNumber: 2, createdAt: '2026-09-17T15:00:00.000Z', isActive: true },
    overview: { objective: 'PROJECT_CREDIBILITY', serviceTrade: 'ROOFING', geographicMarket: 'Greenville, SC' },
    whyThisCampaign: { researchInfluence: [], assumptions: [] },
    media: [],
    channelPreviews: [],
    approvalHealth: { status: 'READY_FOR_APPROVAL', blockers: [] },
    changeRequests: [],
    revisionHistory: [
      { revisionId: 'revision-1', revisionNumber: 1, provenanceReason: 'INITIAL_GENERATION', createdAt: '2026-09-17T14:00:00.000Z', isActive: false },
      { revisionId: 'revision-2', revisionNumber: 2, provenanceReason: 'HUMAN_EDIT', createdAt: '2026-09-17T15:00:00.000Z', isActive: true },
    ],
    availableActions: ['EDIT_CHANNEL_CONTENT', 'REMOVE_CHANNEL', 'REGENERATE_CHANNEL', 'REQUEST_CHANGES', 'APPROVE_CAMPAIGN', 'REJECT_CAMPAIGN'],
    actionHistory: [],
    ...overrides,
  };
}

describe('review queue: states come from returned data, never invented', () => {
  it('sorts each campaign into the state it is actually waiting on', () => {
    expect(queueItemState(queueItem())).toBe('READY_FOR_APPROVAL');
    expect(queueItemState(queueItem({ approvalHealthStatus: 'BLOCKED', blockerCount: 2 }))).toBe('BLOCKED');
    expect(queueItemState(queueItem({ blockerCount: 1 }))).toBe('BLOCKED');
    expect(queueItemState(queueItem({ openChangeRequestCount: 1 }))).toBe('CHANGES_REQUESTED');
    expect(queueItemState(queueItem({ approvalHealthStatus: 'NOT_REVIEWABLE', reviewable: false }))).toBe('NOT_REVIEWABLE');
  });

  it('puts an outstanding change request ahead of a blocker — it is waiting on a regeneration, not a decision', () => {
    expect(queueItemState(queueItem({ openChangeRequestCount: 1, blockerCount: 3 }))).toBe('CHANGES_REQUESTED');
  });

  it('groups into sections in a fixed order and drops empty ones', () => {
    const sections = queueSections([
      queueItem({ revisionId: 'a' }),
      queueItem({ revisionId: 'b', blockerCount: 1 }),
      queueItem({ revisionId: 'c', openChangeRequestCount: 2 }),
    ]);
    expect(sections.map((section) => section.state)).toEqual(['READY_FOR_APPROVAL', 'BLOCKED', 'CHANGES_REQUESTED']);
    expect(sections.every((section) => section.items.length === 1)).toBe(true);
    expect(queueSections([])).toEqual([]);
  });
});

describe('approval gating', () => {
  it('allows approval only when the API itself offers it on a clean, active revision', () => {
    expect(approvalGate(review())).toEqual({ canApprove: true });
  });

  it('refuses a historical revision', () => {
    const historical = review({ revision: { id: 'revision-1', revisionNumber: 1, createdAt: '2026-09-17T14:00:00.000Z', isActive: false } });
    expect(approvalGate(historical)).toEqual({ canApprove: false, reason: 'HISTORICAL_REVISION' });
  });

  it('refuses a blocked revision, however many blockers there are', () => {
    expect(approvalGate(review({ approvalHealth: { status: 'BLOCKED', blockers: ['a blocker'] } }))).toEqual({
      canApprove: false,
      reason: 'BLOCKERS',
    });
    expect(approvalGate(review({ approvalHealth: { status: 'READY_FOR_APPROVAL', blockers: ['sneaky'] } })).canApprove).toBe(false);
  });

  it('refuses when the API did not list approval as available, or a decision already exists', () => {
    expect(approvalGate(review({ availableActions: ['REQUEST_CHANGES'] }))).toEqual({ canApprove: false, reason: 'NOT_OFFERED' });
    expect(
      approvalGate(review({ decision: { decision: 'APPROVED', actor: 'austin', decidedAt: '2026-09-17T16:00:00.000Z', notes: null } })),
    ).toEqual({ canApprove: false, reason: 'ALREADY_DECIDED' });
  });

  it('offers content actions only on the active revision, and only when the API lists them', () => {
    expect(canRun(review(), 'EDIT_CHANNEL_CONTENT')).toBe(true);
    expect(canRun(review(), 'CANCEL_DRAFT')).toBe(false);
    const historical = review({ revision: { id: 'revision-1', revisionNumber: 1, createdAt: '2026-09-17T14:00:00.000Z', isActive: false } });
    expect(canRun(historical, 'EDIT_CHANNEL_CONTENT')).toBe(false);
  });
});

describe('verified project facts: values for public, names only for internal-only', () => {
  const withFacts = review({
    verifiedProjectFacts: {
      contextVersion: 2,
      changedSinceGeneration: [],
      publicFacts: { trades: ['ROOFING'], location: 'Greenville, SC', status: 'UNKNOWN' },
      internalOnlyFields: ['customerName', 'streetAddress'],
      unknownFields: ['warranty'],
    },
  });

  it('renders public values and drops empty/UNKNOWN ones', () => {
    const groups = projectFactGroups(withFacts);
    expect(groups.authorized).toEqual([
      { field: 'trades', value: 'ROOFING' },
      { field: 'location', value: 'Greenville, SC' },
    ]);
  });

  it('keeps internal-only facts as NAMES — the group has no value slot at all', () => {
    const groups = projectFactGroups(withFacts);
    expect(groups.internalOnlyFields).toEqual(['customerName', 'streetAddress']);
    expect(JSON.stringify(groups)).not.toMatch(/craig|dennis|main st/i);
    // Structural: every entry is a bare string, so there is nowhere for a value to ride along.
    expect(groups.internalOnlyFields.every((field) => typeof field === 'string')).toBe(true);
  });

  it('is empty, not broken, for a campaign with no verified context', () => {
    expect(projectFactGroups(review())).toEqual({
      authorized: [],
      internalOnlyFields: [],
      unknownFields: [],
      changedSinceGeneration: [],
    });
  });
});

describe('channel previews are structured fields, not JSON', () => {
  const facebook = {
    platform: 'FACEBOOK',
    slot: 'primary',
    content: {
      postCopy: "Here's a look at roofing work in Greenville, SC from our team.",
      headline: 'Our Roofing Work, Up Close',
      hashtags: ['#RoofingContractor', '#GreenvilleSC'],
      cta: { label: 'Request a free estimate' },
      assetIds: ['asset-1'],
      localContext: 'Greenville, SC',
    },
    factualClaimsUsed: [
      { category: 'PROJECT_DETAIL', statement: 'Project located in Greenville, SC.', evidenceType: 'PROJECT_RECORD', evidenceRef: 'verified-project-context:p1:v2:location', verificationStatus: 'VERIFIED' },
    ],
  };

  it('extracts the fields a reviewer reads, in reading order', () => {
    const model = channelPreviewModel(facebook);
    expect(model.fields.map((field) => field.labelKey)).toEqual([
      'mkt.preview.headline',
      'mkt.preview.body',
      'mkt.preview.hashtags',
      'mkt.preview.localContext',
    ]);
    expect(model.cta).toBe('Request a free estimate');
    expect(model.assetCount).toBe(1);
    expect(model.claims[0]?.verificationStatus).toBe('VERIFIED');
  });

  it('renders website SEO attributes as their own fields', () => {
    const model = channelPreviewModel({
      platform: 'WEBSITE',
      slot: 'primary',
      content: {
        title: 'Exterior Services From Our Team',
        seoTitle: 'Exterior Services From Our Team',
        metaDescription: 'Looking for an exterior contractor in Greenville, SC?',
        proposedSlug: 'exterior-services',
        primaryQueryConcept: 'roofing contractor Greenville SC',
        contentType: 'LOCAL_PAGE',
        outline: ['Introduction', 'Why choose our team'],
        authorizedServiceArea: 'Greenville County, South Carolina',
      },
    });
    const labels = model.fields.map((field) => field.labelKey);
    expect(labels).toContain('mkt.preview.seoTitle');
    expect(labels).toContain('mkt.preview.metaDescription');
    expect(labels).toContain('mkt.preview.slug');
    expect(labels).toContain('mkt.preview.queryConcept');
    expect(labels).toContain('mkt.preview.serviceArea');
    expect(labels).toContain('mkt.preview.outline');
  });

  it('ignores structural payload keys, so a preview can never degrade into raw JSON', () => {
    const model = channelPreviewModel({ platform: 'FACEBOOK', slot: 'primary', content: { claims: [{ statement: 'x' }], assetIds: ['a'] } });
    expect(model.fields).toEqual([]);
  });
});

describe('editing', () => {
  const preview = {
    platform: 'FACEBOOK',
    slot: 'primary',
    content: { postCopy: 'Original copy.', headline: 'Original headline', cta: { label: 'Get a free estimate' } },
  };

  it('reads the current value of an editable field, including the nested CTA label', () => {
    expect(currentFieldValue(preview, 'postCopy')).toBe('Original copy.');
    expect(currentFieldValue(preview, 'cta.label')).toBe('Get a free estimate');
    expect(currentFieldValue(preview, 'nope')).toBe('');
  });

  it('sends only genuinely changed fields — an unchanged draft is not an edit', () => {
    expect(
      changedFields(preview, { postCopy: 'Original copy.', headline: 'Tighter headline', 'cta.label': 'Get a free estimate' }),
    ).toEqual({ headline: 'Tighter headline' });
    expect(changedFields(preview, { postCopy: '  Original copy.  ' })).toEqual({});
    expect(changedFields(preview, { postCopy: '   ' })).toEqual({});
  });
});

describe('media', () => {
  it('always reports the preview as unavailable — this API serves metadata, never bytes', () => {
    const model = mediaCardModel({
      mediaAssetId: 'asset-1',
      mimeType: 'image/jpeg',
      originalFilename: 'IMG_0001.jpg',
      safetyReviewState: 'CLEARED',
      currentAssetState: 'RESERVED',
      content: { kind: 'NOT_SERVED_BY_THIS_API', reason: 'metadata only' },
    });
    expect(model).toMatchObject({ filename: 'IMG_0001.jpg', previewUnavailable: true });
    expect(JSON.stringify(model)).not.toMatch(/drive|https?:/i);
  });

  it('keeps media replacement disabled while there is no safe way to browse alternatives', () => {
    expect(canReplaceMedia(review())).toBe(false);
  });
});

describe('revision history', () => {
  it('lists newest first, marks the active one, and marks the one being viewed', () => {
    const timeline = revisionTimeline(review());
    expect(timeline.map((entry) => entry.revisionNumber)).toEqual([2, 1]);
    expect(timeline[0]).toMatchObject({ isActive: true, isViewing: true, reasonKey: 'mkt.revision.humanEdit' });
    expect(timeline[1]).toMatchObject({ isActive: false, isViewing: false, reasonKey: 'mkt.revision.generated' });
  });
});

describe('error presentation', () => {
  it('maps each stable code to its message, and refetches when the state moved underneath', () => {
    expect(presentError({ code: 'REVISION_STALE', message: '', details: {} })).toMatchObject({
      messageKey: 'mkt.error.revisionStale',
      refetch: true,
    });
    expect(presentError({ code: 'CONTEXT_CHANGED', message: '', details: {} })).toMatchObject({
      messageKey: 'mkt.error.contextChanged',
      refetch: true,
    });
    expect(presentError({ code: 'CAMPAIGN_ALREADY_FINAL', message: '', details: {} }).refetch).toBe(true);
    expect(presentError({ code: 'MEDIA_CONFLICT', message: '', details: {} }).messageKey).toBe('mkt.error.mediaConflict');
    expect(presentError({ code: 'MARKETING_AGENT_UNAVAILABLE', message: '', details: {} })).toMatchObject({
      messageKey: 'mkt.error.unavailable',
      refetch: false,
    });
    expect(presentError({ code: 'MARKETING_AGENT_NOT_CONFIGURED', message: '', details: {} }).messageKey).toBe('mkt.error.notConfigured');
    expect(presentError({ code: 'UNAUTHORIZED', message: '', details: {} }).messageKey).toBe('mkt.error.unauthorized');
  });

  it('surfaces approval blockers, and falls back generically for an unknown code', () => {
    const presented = presentError({ code: 'APPROVAL_BLOCKED', message: '', details: { blockers: ['Media asset a1 is not eligible.'] } });
    expect(presented.details).toEqual(['Media asset a1 is not eligible.']);
    expect(presentError({ code: 'SOMETHING_NEW' as never, message: '', details: {} }).messageKey).toBe('mkt.error.generic');
  });

  it("never asks the user to read API internals for an auth problem", () => {
    expect(messages['mkt.error.unauthorized'].en).not.toMatch(/401|bearer|token|api/i);
  });
});

describe('approval wording never claims publication', () => {
  it('pairs the approved headline with the not-published sentence', () => {
    expect(approvalSuccessNotice()).toEqual({
      messageKey: 'mkt.result.approved',
      secondaryKey: 'mkt.result.approvedNotPublished',
    });
  });

  it('says ready for publication, and explicitly that nothing was posted or scheduled', () => {
    expect(messages['mkt.result.approved'].en).toBe('Approved — ready for publication');
    expect(messages['mkt.result.approved'].en).not.toMatch(/\bpublished\b/i);
    expect(messages['mkt.result.approvedNotPublished'].en).toMatch(/not enabled yet/i);
    expect(messages['mkt.result.approvedNotPublished'].en).toMatch(/nothing has been posted or scheduled/i);
  });

  it('never tells an operator a campaign is live or published anywhere in the workspace dictionary', () => {
    for (const [key, entry] of Object.entries(messages)) {
      if (!key.startsWith('mkt.')) continue;
      expect(entry.en, key).not.toMatch(/\bis (now )?(live|published)\b/i);
    }
  });
});

describe('idempotency keys', () => {
  it('produces a distinct key per call, so one click carries one key', () => {
    const keys = new Set([newIdempotencyKey(), newIdempotencyKey(), newIdempotencyKey()]);
    expect(keys.size).toBe(3);
    for (const key of keys) expect(key.length).toBeGreaterThan(8);
  });
});
