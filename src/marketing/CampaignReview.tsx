import { Button } from '@astryxdesign/core/Button';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileImage, History, Info, ShieldAlert } from 'lucide-react';
import type { MarketingCampaignReview, MarketingChannelPreview } from './types';
import {
  approvalGate,
  canReplaceMedia,
  canRun,
  mediaCardModel,
  projectFactGroups,
  revisionTimeline,
  type ApprovalBlockReason,
} from './viewModel';
import { ChannelPreviewCard } from './ChannelPreviewCard';
import { useI18n } from '../i18n/context';
import { formatRelativeTime } from '../relativeTime';
import type { MessageKey } from '../i18n/messages';

/**
 * The review workspace for one revision. Presentational: every decision it
 * renders (can this be approved, which facts are safe to show, what a
 * preview contains) comes from viewModel.ts, and every action is a callback
 * — so a test can render this with fixture data and assert on what an
 * operator would actually see.
 *
 * The one rule with no fallback: `projectFactGroups` puts internal-only
 * facts in a NAMES-only group. There is no branch in this file that can
 * print an internal-only value, because no value is ever in scope.
 */

const APPROVAL_BLOCK_REASON: Record<ApprovalBlockReason, MessageKey> = {
  BLOCKERS: 'mkt.approve.blockedByBlockers',
  HISTORICAL_REVISION: 'mkt.approve.blockedHistorical',
  NOT_OFFERED: 'mkt.approve.blockedNotOffered',
  ALREADY_DECIDED: 'mkt.approve.blockedDecided',
};

export interface CampaignReviewActions {
  onBack(): void;
  onRequestChanges(): void;
  onApprove(): void;
  onReject(): void;
  onCancel(): void;
  onEditChannel(preview: MarketingChannelPreview): void;
  onRemoveChannel(preview: MarketingChannelPreview): void;
  onRegenerateChannel(preview: MarketingChannelPreview): void;
  onOpenRevision(revisionId: string): void;
}

export function CampaignReview({
  review,
  busy,
  actions,
}: {
  review: MarketingCampaignReview;
  busy: boolean;
  actions: CampaignReviewActions;
}) {
  const { t } = useI18n();
  const gate = approvalGate(review);
  const facts = projectFactGroups(review);
  const timeline = revisionTimeline(review);
  const blockers = review.approvalHealth.blockers;
  const historical = !review.revision.isActive;

  return (
    <div className={`mkt-review ${historical ? 'mkt-review--historical' : ''}`}>
      <header className="mkt-review-head">
        <div className="mkt-review-head-lead">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={14} />}
            label={t('mkt.review.back')}
            clickAction={actions.onBack}
          />
          <div>
            <h2 className="mkt-review-title">{review.campaign.name}</h2>
            <div className="mkt-review-sub">
              <span className={`mkt-chip ${historical ? 'mkt-chip--historical' : 'mkt-chip--current'}`}>
                {t('mkt.card.revision', { number: String(review.revision.revisionNumber) })} ·{' '}
                {historical ? t('mkt.review.historical') : t('mkt.review.current')}
              </span>
              <span className="mkt-chip">{review.campaign.status.replace(/_/g, ' ').toLowerCase()}</span>
              <span className={`mkt-chip ${blockers.length === 0 ? 'mkt-chip--ok' : 'mkt-chip--warn'}`}>
                {review.approvalHealth.status.replace(/_/g, ' ').toLowerCase()}
              </span>
            </div>
          </div>
        </div>
        <div className="mkt-review-actions">
          <Button
            variant="secondary"
            size="sm"
            label={t('mkt.action.requestChanges')}
            isDisabled={busy || !canRun(review, 'REQUEST_CHANGES')}
            clickAction={actions.onRequestChanges}
          />
          <Button
            variant="secondary"
            size="sm"
            label={t('mkt.action.reject')}
            isDisabled={busy || !canRun(review, 'REJECT_CAMPAIGN')}
            clickAction={actions.onReject}
          />
          <Button
            variant="secondary"
            size="sm"
            label={t('mkt.action.cancel')}
            isDisabled={busy || !canRun(review, 'CANCEL_DRAFT')}
            clickAction={actions.onCancel}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<CheckCircle2 size={14} />}
            label={t('mkt.action.approve')}
            isDisabled={busy || !gate.canApprove}
            clickAction={actions.onApprove}
          />
        </div>
      </header>

      {historical && (
        <p className="mkt-notice mkt-notice--historical">
          <History size={14} />
          {t('mkt.review.historicalHint')}
        </p>
      )}
      {!gate.canApprove && !historical && gate.reason && (
        <p className="mkt-notice">
          <Info size={14} />
          {t(APPROVAL_BLOCK_REASON[gate.reason])}
        </p>
      )}

      <dl className="mkt-overview">
        <Overview label={t('mkt.card.objective')} value={review.overview.objective} />
        <Overview label={t('mkt.card.trade')} value={review.overview.serviceTrade} />
        <Overview label={t('mkt.card.market')} value={review.overview.geographicMarket} />
        <Overview label={t('mkt.card.serviceArea')} value={review.overview.serviceAreaMarket} />
      </dl>

      {blockers.length > 0 && (
        <section className="mkt-panel mkt-panel--blockers">
          <h3>
            <ShieldAlert size={15} />
            {t('mkt.review.blockers')} ({blockers.length})
          </h3>
          <p className="mkt-muted">{t('mkt.review.blockersHint')}</p>
          <ul className="mkt-list">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}

      {review.changeRequests.some((request) => request.status === 'OPEN') && (
        <section className="mkt-panel">
          <h3>{t('mkt.review.changeRequests')}</h3>
          <ul className="mkt-list">
            {review.changeRequests
              .filter((request) => request.status === 'OPEN')
              .map((request) => (
                <li key={request.id}>
                  <strong>{request.category.replace(/_/g, ' ').toLowerCase()}</strong> — {request.instruction}
                  <span className="mkt-muted"> · {request.actor}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="mkt-panel">
        <h3>{t('mkt.review.why')}</h3>
        {review.overview.campaignAngle && (
          <p className="mkt-kv">
            <span className="mkt-kv-label">{t('mkt.review.angle')}</span>
            {review.overview.campaignAngle}
          </p>
        )}
        {review.whyThisCampaign.opportunityRationale && (
          <p className="mkt-kv">
            <span className="mkt-kv-label">{t('mkt.review.rationale')}</span>
            {review.whyThisCampaign.opportunityRationale}
          </p>
        )}
        <p className="mkt-kv">
          <span className="mkt-kv-label">{t('mkt.review.researchMode')}</span>
          {review.whyThisCampaign.researchMode ?? t('mkt.review.researchNone')}
        </p>
        {review.whyThisCampaign.researchInfluence.length > 0 && (
          <>
            <div className="mkt-chip-row">
              {review.whyThisCampaign.researchInfluence.map((source) => (
                <span key={source.researchSourceId} className="mkt-chip">
                  {source.publisherDomain ?? source.category}
                  {source.influenceType ? ` · ${source.influenceType.replace(/_/g, ' ').toLowerCase()}` : ''}
                </span>
              ))}
            </div>
            {/* Raw excerpts stay collapsed: they are evidence for the angle,
                not something a reviewer should have to wade through. */}
            <details className="mkt-details">
              <summary>{t('mkt.review.researchDetails')}</summary>
              <ul className="mkt-list">
                {review.whyThisCampaign.researchInfluence.map((source) => (
                  <li key={`${source.researchSourceId}-detail`}>
                    <strong>{source.title ?? source.url}</strong>
                    <span className="mkt-muted"> · {source.qualityStatus ?? ''} {source.provenance ?? ''}</span>
                    <p className="mkt-muted">{source.excerpt}</p>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      <section className="mkt-panel">
        <h3>{t('mkt.review.facts')}</h3>
        {!review.verifiedProjectFacts ? (
          <p className="mkt-muted">{t('mkt.facts.none')}</p>
        ) : (
          <div className="mkt-fact-groups">
            <div className="mkt-fact-group mkt-fact-group--authorized">
              <h4>{t('mkt.facts.authorized')}</h4>
              <dl>
                {facts.authorized.map((row) => (
                  <div key={row.field}>
                    <dt>{row.field}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="mkt-fact-group">
              <h4>{t('mkt.facts.internalOnly')}</h4>
              <p className="mkt-muted">{t('mkt.facts.internalOnlyHint')}</p>
              <div className="mkt-chip-row">
                {facts.internalOnlyFields.map((field) => (
                  <span key={field} className="mkt-chip mkt-chip--locked">
                    {field}
                  </span>
                ))}
              </div>
            </div>
            <div className="mkt-fact-group">
              <h4>{t('mkt.facts.unknown')}</h4>
              <p className="mkt-muted">{t('mkt.facts.unknownHint')}</p>
              <div className="mkt-chip-row">
                {facts.unknownFields.map((field) => (
                  <span key={field} className="mkt-chip">
                    {field}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        {facts.changedSinceGeneration.length > 0 && (
          <p className="mkt-notice mkt-notice--warn">
            <AlertTriangle size={14} />
            {t('mkt.facts.changed')}: {facts.changedSinceGeneration.join(', ')}
          </p>
        )}
      </section>

      <section className="mkt-panel">
        <h3>{t('mkt.review.media')}</h3>
        {review.media.length === 0 ? (
          <p className="mkt-muted">{t('mkt.media.none')}</p>
        ) : (
          <div className="mkt-media-grid">
            {review.media.map((item) => {
              const media = mediaCardModel(item);
              return (
                <div key={media.mediaAssetId} className="mkt-media">
                  <div className="mkt-media-placeholder">
                    <FileImage size={18} />
                    <span>{t('mkt.media.unavailable')}</span>
                  </div>
                  <div className="mkt-media-meta">
                    <span className="truncate mkt-media-name">{media.filename}</span>
                    <span className="mkt-muted">{media.mimeType}</span>
                    <span className="mkt-muted">
                      {t('mkt.media.safety')}: {media.safetyReviewState.toLowerCase()} · {t('mkt.media.state')}:{' '}
                      {media.currentAssetState.toLowerCase()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Button
          variant="secondary"
          size="sm"
          label={t('mkt.action.replaceMedia')}
          isDisabled
          tooltip={t('mkt.action.replaceMediaDisabled')}
          clickAction={() => undefined}
        />
        {!canReplaceMedia(review) && <p className="mkt-muted">{t('mkt.action.replaceMediaDisabled')}</p>}
      </section>

      {review.whyThisCampaign.assumptions.length > 0 && (
        <section className="mkt-panel">
          <h3>{t('mkt.review.assumptions')}</h3>
          <ul className="mkt-list mkt-list--muted">
            {review.whyThisCampaign.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mkt-panel">
        <h3>{t('mkt.review.channels')}</h3>
        {review.channelPreviews.length === 0 ? (
          <p className="mkt-muted">{t('mkt.preview.none')}</p>
        ) : (
          <div className="mkt-preview-grid">
            {review.channelPreviews.map((preview) => (
              <ChannelPreviewCard
                key={`${preview.platform}-${preview.slot}`}
                preview={preview}
                canEdit={canRun(review, 'EDIT_CHANNEL_CONTENT')}
                canRemove={canRun(review, 'REMOVE_CHANNEL')}
                canRegenerate={canRun(review, 'REGENERATE_CHANNEL')}
                busy={busy}
                onEdit={actions.onEditChannel}
                onRemove={actions.onRemoveChannel}
                onRegenerate={actions.onRegenerateChannel}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mkt-panel">
        <h3>{t('mkt.review.history')}</h3>
        <ol className="mkt-timeline">
          {timeline.map((entry) => (
            <li key={entry.revisionId} className={entry.isViewing ? 'mkt-timeline-entry--viewing' : undefined}>
              <button type="button" className="mkt-timeline-button" onClick={() => actions.onOpenRevision(entry.revisionId)}>
                <span className="mkt-timeline-number">{entry.revisionNumber}</span>
                <span className="mkt-timeline-label">{t(entry.reasonKey)}</span>
                <span className="mkt-muted">{formatRelativeTime(entry.createdAt, t) ?? entry.createdAt}</span>
                {entry.isActive && <span className="mkt-chip mkt-chip--current">{t('mkt.review.current')}</span>}
                {entry.decision && <span className="mkt-chip">{entry.decision.toLowerCase()}</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="mkt-panel">
        <details className="mkt-details">
          <summary>{t('mkt.review.activity')} ({review.actionHistory.length})</summary>
          <ul className="mkt-list">
            {review.actionHistory.map((entry, index) => (
              <li key={`${entry.action}-${entry.createdAt}-${index}`}>
                <strong>{entry.action.replace(/_/g, ' ').toLowerCase()}</strong>
                <span className="mkt-muted">
                  {' '}
                  · {entry.actor} · {formatRelativeTime(entry.createdAt, t) ?? entry.createdAt}
                </span>
                {entry.reason && <p className="mkt-muted">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}

function Overview({ label, value }: { label: string; value?: string }) {
  const { t } = useI18n();
  return (
    <div className="mkt-overview-item">
      <dt>{label}</dt>
      <dd>{value && value.length > 0 ? value : t('mkt.card.none')}</dd>
    </div>
  );
}
