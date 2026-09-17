import { Button } from '@astryxdesign/core/Button';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { MarketingChannelPreview } from './types';
import { channelPreviewModel, EDITABLE_FIELDS_BY_PLATFORM } from './viewModel';
import { useI18n } from '../i18n/context';

/**
 * One channel's generated content, rendered as the structured fields it
 * actually is — headline, body, hashtags, CTA, SEO attributes — never as a
 * JSON blob. What each platform carries is decided in
 * channelPreviewModel(), so adding a field is a data change, not a JSX
 * change.
 */
export function ChannelPreviewCard({
  preview,
  canEdit,
  canRemove,
  canRegenerate,
  busy,
  onEdit,
  onRemove,
  onRegenerate,
}: {
  preview: MarketingChannelPreview;
  canEdit: boolean;
  canRemove: boolean;
  canRegenerate: boolean;
  busy: boolean;
  onEdit(preview: MarketingChannelPreview): void;
  onRemove(preview: MarketingChannelPreview): void;
  onRegenerate(preview: MarketingChannelPreview): void;
}) {
  const { t } = useI18n();
  const model = channelPreviewModel(preview);
  const editable = (EDITABLE_FIELDS_BY_PLATFORM[preview.platform] ?? []).length > 0;

  return (
    <article className="mkt-preview">
      <header className="mkt-preview-head">
        <h4>{preview.platform.replace(/_/g, ' ')}</h4>
        <div className="mkt-preview-actions">
          {canEdit && editable && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Pencil size={12} />}
              label={t('mkt.action.edit')}
              isDisabled={busy}
              clickAction={() => onEdit(preview)}
            />
          )}
          {canRegenerate && (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={12} />}
              label={t('mkt.action.regenerate')}
              isDisabled={busy}
              clickAction={() => onRegenerate(preview)}
            />
          )}
          {canRemove && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={12} />}
              label={t('mkt.action.remove')}
              isDisabled={busy}
              clickAction={() => onRemove(preview)}
            />
          )}
        </div>
      </header>

      {model.fields.length === 0 ? (
        <p className="mkt-muted">{t('mkt.preview.empty')}</p>
      ) : (
        <dl className="mkt-preview-fields">
          {model.fields.map((field) => (
            <div key={`${field.labelKey}-${field.value.slice(0, 12)}`} className={`mkt-preview-field mkt-preview-field--${field.kind}`}>
              <dt>{t(field.labelKey)}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <footer className="mkt-preview-foot">
        {model.cta && (
          <span className="mkt-chip mkt-chip--cta">
            {t('mkt.preview.cta')}: {model.cta}
          </span>
        )}
        {model.assetCount > 0 && <span className="mkt-chip">{t('mkt.preview.assets', { count: String(model.assetCount) })}</span>}
        {model.claims.length > 0 && (
          <details className="mkt-details">
            <summary>
              {t('mkt.preview.claims')} ({model.claims.length})
            </summary>
            <ul className="mkt-claim-list">
              {model.claims.map((claim) => (
                <li key={claim.statement}>
                  <span>{claim.statement}</span>
                  <span className={`mkt-chip mkt-chip--${claim.verificationStatus === 'VERIFIED' ? 'verified' : 'pending'}`}>
                    {claim.verificationStatus.replace(/_/g, ' ').toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </footer>
    </article>
  );
}
