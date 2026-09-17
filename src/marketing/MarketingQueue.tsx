import { AlertTriangle, CheckCircle2, Clock, Images, MessageSquareWarning, PanelsTopLeft } from 'lucide-react';
import type { MarketingQueueItem } from './types';
import { queueItemState, queueSections, QUEUE_STATE_LABEL, type QueueItemState } from './viewModel';
import { useI18n } from '../i18n/context';
import { formatRelativeTime } from '../relativeTime';

/**
 * The review queue: campaigns waiting on an operator, grouped by what they
 * are actually waiting FOR (see queueItemState — derived from returned
 * fields only, never an invented status). Purely presentational so it can
 * be rendered in a test without a network.
 */

const STATE_ICON: Record<QueueItemState, typeof CheckCircle2> = {
  READY_FOR_APPROVAL: CheckCircle2,
  BLOCKED: AlertTriangle,
  CHANGES_REQUESTED: MessageSquareWarning,
  NOT_REVIEWABLE: Clock,
};

export function MarketingQueue({
  items,
  totalAwaitingReview,
  onOpen,
}: {
  items: readonly MarketingQueueItem[];
  totalAwaitingReview: number;
  onOpen(campaignId: string): void;
}) {
  const { t } = useI18n();
  const sections = queueSections(items);

  if (items.length === 0) {
    return (
      <div className="mkt-empty">
        <PanelsTopLeft size={22} />
        <p className="mkt-empty-title">{t('mkt.queue.empty')}</p>
        <p className="mkt-empty-hint">{t('mkt.queue.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="mkt-queue">
      <div className="mkt-queue-summary">{t('mkt.queue.count', { count: String(totalAwaitingReview) })}</div>
      {sections.map((section) => (
        <section key={section.state} className="mkt-queue-section">
          <h3 className={`mkt-section-title mkt-section-title--${section.state.toLowerCase()}`}>
            {t(QUEUE_STATE_LABEL[section.state])}
            <span className="mkt-section-count">{section.items.length}</span>
          </h3>
          <div className="mkt-card-grid">
            {section.items.map((item) => (
              <QueueCard key={item.revisionId} item={item} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function QueueCard({ item, onOpen }: { item: MarketingQueueItem; onOpen(campaignId: string): void }) {
  const { t } = useI18n();
  const state = queueItemState(item);
  const Icon = STATE_ICON[state];

  return (
    <button type="button" className={`mkt-card mkt-card--${state.toLowerCase()}`} onClick={() => onOpen(item.campaignId)}>
      <div className="mkt-card-head">
        <span className={`mkt-badge mkt-badge--${state.toLowerCase()}`}>
          <Icon size={12} />
          {t(QUEUE_STATE_LABEL[state])}
        </span>
        <span className="mkt-card-revision">{t('mkt.card.revision', { number: String(item.revisionNumber) })}</span>
      </div>
      <h4 className="mkt-card-title truncate">{item.title}</h4>
      <dl className="mkt-card-facts">
        <Fact label={t('mkt.card.objective')} value={item.objective} />
        <Fact label={t('mkt.card.trade')} value={item.serviceTrade} />
        <Fact label={t('mkt.card.market')} value={item.geographicMarket} />
        <Fact label={t('mkt.card.serviceArea')} value={item.serviceAreaMarket} />
      </dl>
      {item.channels.length > 0 && (
        <div className="mkt-chip-row">
          {item.channels.map((channel) => (
            <span key={channel} className="mkt-chip">
              {channel.replace(/_/g, ' ').toLowerCase()}
            </span>
          ))}
        </div>
      )}
      <div className="mkt-card-foot">
        <span className="mkt-card-status">{item.status.replace(/_/g, ' ').toLowerCase()}</span>
        <span className="mkt-card-meta">
          <Images size={12} />
          {t('mkt.card.media', { count: String(item.mediaCount) })}
        </span>
        {item.blockerCount > 0 && (
          <span className="mkt-card-meta mkt-card-meta--warn">
            {t('mkt.card.blockers', { count: String(item.blockerCount) })}
          </span>
        )}
        {item.openChangeRequestCount > 0 && (
          <span className="mkt-card-meta">
            {t('mkt.card.changeRequests', { count: String(item.openChangeRequestCount) })}
          </span>
        )}
        <span className="mkt-card-meta mkt-card-meta--time">
          {t('mkt.card.updated', { time: formatRelativeTime(item.updatedAt, t) ?? item.updatedAt })}
        </span>
      </div>
    </button>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  const { t } = useI18n();
  return (
    <div className="mkt-fact">
      <dt>{label}</dt>
      <dd className="truncate">{value && value.length > 0 ? value : t('mkt.card.none')}</dd>
    </div>
  );
}
