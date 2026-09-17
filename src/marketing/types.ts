/**
 * The shapes the JusticeOS gateway returns from `/api/marketing/*`. They
 * mirror the Marketing Agent's own DTOs (that service's
 * `GET /api/marketing/openapi.json` is the contract of record) and are
 * deliberately permissive: everything the UI does not strictly need is
 * optional, so a Marketing Agent that adds a field, or omits one for a
 * sparse campaign, never blanks this screen.
 *
 * Note what is NOT here, by design: no internal-only project VALUES (the
 * API returns internal-only field NAMES only), no media bytes or URLs, and
 * no credential of any kind — the browser talks only to the gateway, and
 * the gateway holds the Marketing Agent key.
 */

export interface MarketingMediaContentRef {
  readonly kind: string;
  readonly reason?: string;
}

export interface MarketingQueueItem {
  readonly campaignId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly title: string;
  readonly status: string;
  readonly objective?: string;
  readonly serviceTrade?: string;
  readonly geographicMarket?: string;
  readonly serviceAreaMarket?: string;
  readonly channels: readonly string[];
  readonly mediaCount: number;
  readonly mediaThumbnail?: {
    readonly mediaAssetId: string;
    readonly mimeType: string;
    readonly originalFilename?: string;
    readonly safetyReviewState: string;
    readonly currentAssetState: string;
    readonly content?: MarketingMediaContentRef;
  } | null;
  readonly blockerCount: number;
  readonly approvalHealthStatus: string;
  readonly openChangeRequestCount: number;
  readonly reviewable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MarketingQueue {
  readonly items: readonly MarketingQueueItem[];
  readonly totalAwaitingReview: number;
  readonly generatedAt: string;
}

export interface MarketingResearchInfluence {
  readonly researchSourceId: string;
  readonly title?: string;
  readonly url: string;
  readonly publisherDomain?: string;
  readonly category: string;
  readonly provenance?: string;
  readonly qualityStatus?: string;
  readonly influenceType?: string;
  readonly excerpt: string;
}

export interface MarketingVerifiedFacts {
  readonly contextVersion: number;
  readonly currentContextVersion?: number;
  readonly changedSinceGeneration: readonly string[];
  /** PUBLIC values only — the API never sends an internal-only value. */
  readonly publicFacts: Readonly<Record<string, unknown>>;
  /** Field NAMES only. */
  readonly internalOnlyFields: readonly string[];
  readonly unknownFields: readonly string[];
  readonly wordingPermittedNow?: Readonly<Record<string, unknown>>;
}

export interface MarketingMediaItem {
  readonly mediaAssetId: string;
  readonly mimeType: string;
  readonly originalFilename?: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly intendedUse?: string;
  readonly selectedChannels?: readonly string[];
  readonly safetyReviewState: string;
  readonly unresolvedSafetyFlagCount?: number;
  readonly currentAssetState: string;
  readonly content?: MarketingMediaContentRef;
}

export interface MarketingChannelPreview {
  readonly platform: string;
  readonly slot: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly selectedAssetIds?: readonly string[];
  readonly factualClaimsUsed?: readonly {
    readonly category: string;
    readonly statement: string;
    readonly evidenceType: string;
    readonly evidenceRef: string;
    readonly verificationStatus: string;
  }[];
  readonly provenanceStatus?: string;
}

export interface MarketingCampaignReview {
  readonly campaign: { readonly id: string; readonly name: string; readonly status: string };
  readonly revision: {
    readonly id: string;
    readonly revisionNumber: number;
    readonly createdBy?: string;
    readonly createdByActor?: string;
    readonly provenanceReason?: string;
    readonly parentRevisionId?: string | null;
    readonly createdAt: string;
    readonly isActive: boolean;
  };
  readonly overview: {
    readonly objective?: string;
    readonly serviceTrade?: string;
    readonly audienceIntent?: string;
    readonly geographicMarket?: string;
    readonly serviceAreaMarket?: string;
    readonly campaignAngle?: string;
    readonly proposedCta?: string;
    readonly duplicationWarning?: string;
  };
  readonly whyThisCampaign: {
    readonly opportunityRationale?: string;
    readonly strategyRationale?: string;
    readonly researchMode?: string;
    readonly researchInfluence: readonly MarketingResearchInfluence[];
    readonly assumptions: readonly string[];
  };
  readonly verifiedProjectFacts?: MarketingVerifiedFacts;
  readonly media: readonly MarketingMediaItem[];
  readonly channelPreviews: readonly MarketingChannelPreview[];
  readonly approvalHealth: { readonly status: string; readonly blockers: readonly string[] };
  readonly assetState?: readonly {
    readonly mediaAssetId: string;
    readonly status: string;
    readonly heldByThisRevision: boolean;
  }[];
  readonly changeRequests: readonly {
    readonly id: string;
    readonly raisedAgainstRevisionId: string;
    readonly raisedAgainstRevisionNumber: number;
    readonly instruction: string;
    readonly category: string;
    readonly platforms: readonly string[];
    readonly actor: string;
    readonly createdAt: string;
    readonly status: string;
  }[];
  readonly decision?: {
    readonly decision: string;
    readonly actor: string;
    readonly decidedAt: string;
    readonly notes: string | null;
  } | null;
  readonly publication?: {
    readonly eligible: boolean;
    readonly platforms: readonly string[];
    readonly reason: string;
    readonly livePublishingEnabled?: boolean;
  };
  readonly revisionHistory: readonly {
    readonly revisionId: string;
    readonly revisionNumber: number;
    readonly provenanceReason?: string;
    readonly createdByActor?: string;
    readonly createdAt: string;
    readonly isActive: boolean;
    readonly decision?: string | null;
  }[];
  readonly availableActions: readonly string[];
  readonly actionHistory: readonly {
    readonly action: string;
    readonly outcome: string;
    readonly actor: string;
    readonly sourceRevisionId?: string;
    readonly resultingRevisionId?: string | null;
    readonly reason?: string | null;
    readonly createdAt: string;
  }[];
}

export interface MarketingIntegrationStatus {
  readonly gateway: string;
  readonly marketing: {
    readonly configured: boolean;
    readonly actorConfigured?: boolean;
    readonly reachability: string;
    readonly checkedAt?: string;
  };
  readonly livePublishing?: string;
}

export interface MarketingApproveResult {
  readonly status: string;
  readonly campaignId: string;
  readonly revisionId: string;
  readonly approvalId: string;
  readonly approvedChannels: readonly string[];
  readonly livePublishing?: { readonly enabled: boolean; readonly publicationJobsCreated: number };
  readonly idempotentReplay?: boolean;
}

export interface MarketingRevisionActionResult {
  readonly action: string;
  readonly campaignId: string;
  readonly sourceRevisionId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly approvalHealth?: { readonly status: string; readonly blockerCount: number; readonly blockers: readonly string[] };
}
