import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import { MarketingQueue } from './MarketingQueue';
import { CampaignReview } from './CampaignReview';
import { MarketingPage } from './MarketingPage';
import type { MarketingCampaignReview, MarketingQueueItem } from './types';

/**
 * Server-side rendering, following this project's existing precedent (see
 * src/gateway/GatewayGate.test.tsx): there is no jsdom here, and mounting
 * is not needed to prove what matters about this screen — what it puts on
 * the page, and what it refuses to put on the page. Effects don't run under
 * SSR, so rendering also proves the first paint makes no network call.
 *
 * Interactive behavior (clicking through a dialog, the disabled-on-click
 * approval, refetch after a mutation) is covered by viewModel.test.ts at
 * the logic level and by the gateway's own tests at the transport level;
 * the click-through itself is manual.
 */

const CUSTOMER_NAME = 'Craig Dennis';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('fetch must not be called during a render');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
}

function queueItem(overrides: Partial<MarketingQueueItem> = {}): MarketingQueueItem {
  return {
    campaignId: 'campaign-1',
    revisionId: 'revision-1',
    revisionNumber: 2,
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
    revision: { id: 'revision-2', revisionNumber: 2, provenanceReason: 'HUMAN_EDIT', createdAt: '2026-09-17T15:00:00.000Z', isActive: true },
    overview: {
      objective: 'PROJECT_CREDIBILITY',
      serviceTrade: 'ROOFING',
      geographicMarket: 'Greenville, SC',
      serviceAreaMarket: 'Greenville County, South Carolina',
      campaignAngle: 'Real project photos support credibility.',
    },
    whyThisCampaign: {
      opportunityRationale: 'A completed local project supports credibility.',
      researchMode: 'LIVE_WEB',
      researchInfluence: [
        {
          researchSourceId: 'r1',
          title: 'Roof questions in Greenville County',
          url: 'https://example-roofing.test/q1',
          publisherDomain: 'example-roofing.test',
          category: 'HOMEOWNER_SEARCH_QUESTION',
          provenance: 'LIVE_WEB',
          qualityStatus: 'ACCEPTED',
          influenceType: 'HOMEOWNER_QUESTION',
          excerpt: 'Homeowners ask how to tell when a roof needs replacing.',
        },
      ],
      assumptions: ['Completion status is not verified for public use.'],
    },
    verifiedProjectFacts: {
      contextVersion: 2,
      changedSinceGeneration: [],
      publicFacts: { trades: ['ROOFING'], location: 'Greenville, SC' },
      internalOnlyFields: ['customerName'],
      unknownFields: ['warranty', 'status'],
    },
    media: [
      {
        mediaAssetId: 'asset-1',
        mimeType: 'image/jpeg',
        originalFilename: 'IMG_0001.jpg',
        safetyReviewState: 'CLEARED',
        currentAssetState: 'RESERVED',
        content: { kind: 'NOT_SERVED_BY_THIS_API', reason: 'metadata only' },
      },
    ],
    channelPreviews: [
      {
        platform: 'FACEBOOK',
        slot: 'primary',
        content: {
          postCopy: "Here's a look at roofing work in Greenville, SC from our team.",
          headline: 'Our Roofing Work, Up Close',
          hashtags: ['#RoofingContractor'],
          cta: { label: 'Request a free estimate' },
          assetIds: ['asset-1'],
        },
        factualClaimsUsed: [
          {
            category: 'PROJECT_DETAIL',
            statement: 'Project located in Greenville, SC.',
            evidenceType: 'PROJECT_RECORD',
            evidenceRef: 'verified-project-context:p1:v2:location',
            verificationStatus: 'VERIFIED',
          },
        ],
        provenanceStatus: 'ALL_EVIDENCED',
      },
    ],
    approvalHealth: { status: 'READY_FOR_APPROVAL', blockers: [] },
    changeRequests: [],
    revisionHistory: [
      { revisionId: 'revision-1', revisionNumber: 1, provenanceReason: 'INITIAL_GENERATION', createdAt: '2026-09-17T14:00:00.000Z', isActive: false },
      { revisionId: 'revision-2', revisionNumber: 2, provenanceReason: 'HUMAN_EDIT', createdAt: '2026-09-17T15:00:00.000Z', isActive: true },
    ],
    availableActions: ['EDIT_CHANNEL_CONTENT', 'REMOVE_CHANNEL', 'REGENERATE_CHANNEL', 'REQUEST_CHANGES', 'APPROVE_CAMPAIGN', 'REJECT_CAMPAIGN'],
    actionHistory: [
      { action: 'EDIT_CHANNEL_CONTENT', outcome: 'REVISION_CREATED', actor: 'austin', createdAt: '2026-09-17T15:00:00.000Z', reason: 'tighter headline' },
    ],
    ...overrides,
  };
}

const noopActions = {
  onBack: () => undefined,
  onRequestChanges: () => undefined,
  onApprove: () => undefined,
  onReject: () => undefined,
  onCancel: () => undefined,
  onEditChannel: () => undefined,
  onRemoveChannel: () => undefined,
  onRegenerateChannel: () => undefined,
  onOpenRevision: () => undefined,
};

describe('review queue rendering', () => {
  it('renders the campaigns the API returned, with the facts an operator triages on', () => {
    const markup = render(<MarketingQueue items={[queueItem()]} totalAwaitingReview={1} onOpen={() => undefined} />);

    expect(markup).toContain('Otis St — Project Highlights');
    expect(markup).toContain('Revision 2');
    expect(markup).toContain('ROOFING');
    expect(markup).toContain('Greenville, SC');
    expect(markup).toContain('Greenville County, South Carolina');
    expect(markup).toContain('facebook');
    expect(markup).toContain('Ready for approval');
  });

  it('separates the states without inventing any, and never shows raw ids as the primary label', () => {
    const markup = render(
      <MarketingQueue
        items={[
          queueItem({ revisionId: 'r-ready' }),
          queueItem({ revisionId: 'r-blocked', campaignId: 'campaign-2', approvalHealthStatus: 'BLOCKED', blockerCount: 2 }),
          queueItem({ revisionId: 'r-changes', campaignId: 'campaign-3', openChangeRequestCount: 1 }),
        ]}
        totalAwaitingReview={3}
        onOpen={() => undefined}
      />,
    );

    expect(markup).toContain('Ready for approval');
    expect(markup).toContain('Needs attention');
    expect(markup).toContain('Changes requested');
    expect(markup).toContain('2 blockers');
    // Ids exist in the DOM only as keys/handlers, never as visible text.
    expect(markup).not.toContain('>campaign-1<');
    expect(markup).not.toContain('>revision-1<');
  });

  it('shows an empty state rather than a blank panel', () => {
    const markup = render(<MarketingQueue items={[]} totalAwaitingReview={0} onOpen={() => undefined} />);
    expect(markup).toContain('Nothing is waiting for review.');
  });
});

describe('campaign review rendering', () => {
  it('renders the campaign, why it was chosen, and the structured channel preview', () => {
    const markup = render(<CampaignReview review={review()} busy={false} actions={noopActions} />);

    expect(markup).toContain('Otis St — Project Highlights');
    expect(markup).toContain('Revision 2');
    expect(markup).toContain('Current revision');
    expect(markup).toContain('Real project photos support credibility.');
    expect(markup).toContain('LIVE_WEB');
    expect(markup).toContain('example-roofing.test');
    // Structured fields, not a JSON dump.
    expect(markup).toContain('Our Roofing Work, Up Close');
    expect(markup).toContain('Request a free estimate');
    expect(markup).toContain('#RoofingContractor');
    expect(markup).not.toContain('&quot;postCopy&quot;');
  });

  it('never renders an internal-only project value — names only, even if the payload carries values', () => {
    // A hostile/regressed payload: the real API sends names only, but if a
    // value ever rode along, this screen must still not print it.
    const hostile = review({
      verifiedProjectFacts: {
        contextVersion: 2,
        changedSinceGeneration: [],
        publicFacts: { trades: ['ROOFING'], location: 'Greenville, SC' },
        internalOnlyFields: ['customerName', 'streetAddress'],
        unknownFields: ['warranty'],
        ...({ internalOnlyValues: [CUSTOMER_NAME, '123 Main St'] } as Record<string, unknown>),
      },
    });

    const markup = render(<CampaignReview review={hostile} busy={false} actions={noopActions} />);

    expect(markup).toContain('customerName');
    expect(markup).toContain('streetAddress');
    expect(markup).not.toContain(CUSTOMER_NAME);
    expect(markup).not.toContain('123 Main St');
    expect(markup).toContain('Field names only');
  });

  it('shows the media placeholder and never a media URL', () => {
    const markup = render(<CampaignReview review={review()} busy={false} actions={noopActions} />);

    expect(markup).toContain('IMG_0001.jpg');
    expect(markup).toContain('image/jpeg');
    expect(markup).toContain('Media preview unavailable — secure delivery not connected yet.');
    expect(markup).toContain('Media replacement will be enabled when secure media browsing is connected.');
    expect(markup).not.toMatch(/drive\.google|googleusercontent|<img/i);
  });

  it('disables approval and explains why when the revision is blocked', () => {
    const blocked = review({
      approvalHealth: { status: 'BLOCKED', blockers: ['Media asset asset-1 has not cleared safety review (state: BLOCKED).'] },
    });

    const markup = render(<CampaignReview review={blocked} busy={false} actions={noopActions} />);

    expect(markup).toContain('has not cleared safety review');
    expect(markup).toContain('Approval stays disabled until these are resolved.');
    expect(markup).toContain('Resolve the blockers before approving.');
    expect(markup).toContain('disabled');
  });

  it('marks a historical revision and never offers approval on it', () => {
    const historical = review({
      revision: { id: 'revision-1', revisionNumber: 1, provenanceReason: 'INITIAL_GENERATION', createdAt: '2026-09-17T14:00:00.000Z', isActive: false },
    });

    const markup = render(<CampaignReview review={historical} busy={false} actions={noopActions} />);

    expect(markup).toContain('Historical revision');
    expect(markup).toContain('You are viewing an earlier revision. It cannot be approved or edited.');
    expect(markup).toContain('disabled');
  });

  it('renders the revision timeline and the activity trail', () => {
    const markup = render(<CampaignReview review={review()} busy={false} actions={noopActions} />);

    expect(markup).toContain('Revision history');
    expect(markup).toContain('Operator edit');
    expect(markup).toContain('Generated');
    expect(markup).toContain('Activity');
    expect(markup).toContain('austin');
    expect(markup).toContain('tighter headline');
  });

  it('keeps raw research excerpts behind a details control rather than in the body', () => {
    const markup = render(<CampaignReview review={review()} busy={false} actions={noopActions} />);
    const excerptIndex = markup.indexOf('Homeowners ask how to tell');
    expect(excerptIndex).toBeGreaterThan(-1);
    expect(markup.slice(0, excerptIndex)).toContain('<details');
  });
});

describe('the workspace never fetches during render', () => {
  it('renders its loading state with zero network calls (effects do not run under SSR)', () => {
    const markup = render(<MarketingPage />);
    expect(markup).toContain('Loading');
    expect(fetch).not.toHaveBeenCalled();
  });
});
