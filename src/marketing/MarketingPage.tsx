import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { LayoutContent } from '@astryxdesign/core/Layout';
import { Spinner } from '@astryxdesign/core/Spinner';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { CheckCircle2, RotateCw } from 'lucide-react';
import {
  approveRevision,
  cancelCampaign,
  editChannel,
  getCampaignReview,
  getReviewQueue,
  getRevisionReview,
  getMarketingStatus,
  regenerateChannel,
  removeChannel,
  requestChanges,
  rejectCampaign,
  MarketingRequestAborted,
  type MarketingApiError,
  type MarketingResult,
} from './client';
import type { MarketingCampaignReview, MarketingChannelPreview, MarketingIntegrationStatus, MarketingQueue as QueueDto } from './types';
import {
  approvalSuccessNotice,
  changedFields,
  currentFieldValue,
  EDITABLE_FIELDS_BY_PLATFORM,
  newIdempotencyKey,
  presentError,
} from './viewModel';
import { MarketingQueue } from './MarketingQueue';
import { CampaignReview } from './CampaignReview';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import './MarketingPage.css';

/**
 * The Marketing workspace (`#/marketing`): the review queue, one campaign's
 * review, and the operator actions on it. Every call goes to the JusticeOS
 * gateway's `/api/marketing/*` bridge with the session cookie — the browser
 * never holds the Marketing Agent credential (see client.ts).
 *
 * Two behaviors are deliberate and easy to get wrong:
 *  - a content action (edit/remove/regenerate) creates a NEW revision, so
 *    the workspace refetches the CAMPAIGN afterwards and lands on whatever
 *    is now active, rather than optimistically mutating the preview it was
 *    showing;
 *  - an action's idempotency key is generated once per operator click and
 *    reused if the same click is retried, so a double-click or a retry can
 *    never apply twice.
 */

type WorkspaceMode = { kind: 'queue' } | { kind: 'campaign'; campaignId: string; revisionId?: string };

type DialogState =
  | { kind: 'none' }
  | { kind: 'request-changes' }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'cancel' }
  | { kind: 'remove'; preview: MarketingChannelPreview }
  | { kind: 'regenerate'; preview: MarketingChannelPreview }
  | { kind: 'edit'; preview: MarketingChannelPreview; draft: Record<string, string> };

interface Notice {
  readonly tone: 'success' | 'warn';
  readonly messageKey: MessageKey;
  readonly vars?: Record<string, string>;
  readonly secondaryKey?: MessageKey;
  readonly details?: readonly string[];
}

export function MarketingPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<WorkspaceMode>({ kind: 'queue' });
  const [status, setStatus] = useState<MarketingIntegrationStatus | null>(null);
  const [queue, setQueue] = useState<QueueDto | null>(null);
  const [review, setReview] = useState<MarketingCampaignReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MarketingApiError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<MessageKey | null>(null);
  /** One key per operator click, reused on retry — see the module comment. */
  const idempotencyKeys = useRef(new Map<string, string>());

  const keyFor = useCallback((action: string) => {
    const existing = idempotencyKeys.current.get(action);
    if (existing) return existing;
    const fresh = newIdempotencyKey();
    idempotencyKeys.current.set(action, fresh);
    return fresh;
  }, []);

  const clearKey = useCallback((action: string) => {
    idempotencyKeys.current.delete(action);
  }, []);

  const loadQueue = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const [statusResult, queueResult] = await Promise.all([getMarketingStatus(signal), getReviewQueue(signal)]);
    if (statusResult.ok) setStatus(statusResult.data);
    if (queueResult.ok) {
      setQueue(queueResult.data);
      setError(null);
    } else {
      setError(queueResult.error);
    }
    setLoading(false);
  }, []);

  const loadCampaign = useCallback(async (campaignId: string, signal?: AbortSignal) => {
    setLoading(true);
    const result = await getCampaignReview(campaignId, signal);
    if (result.ok) {
      setReview(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  const loadRevision = useCallback(async (revisionId: string, signal?: AbortSignal) => {
    setLoading(true);
    const result = await getRevisionReview(revisionId, signal);
    if (result.ok) {
      setReview(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      try {
        if (mode.kind === 'queue') {
          await loadQueue(controller.signal);
        } else if (mode.revisionId) {
          await loadRevision(mode.revisionId, controller.signal);
        } else {
          await loadCampaign(mode.campaignId, controller.signal);
        }
      } catch (err) {
        // A superseded request (route change, faster click) is not a failure.
        if (!(err instanceof MarketingRequestAborted)) throw err;
      }
    };
    void run();
    return () => controller.abort();
  }, [mode, loadQueue, loadCampaign, loadRevision]);

  const closeDialog = useCallback(() => {
    setDialog({ kind: 'none' });
    setReason('');
    setFormError(null);
  }, []);

  /**
   * Runs one operator action, then reloads the campaign so the screen shows
   * the revision that now exists. An error the API says is caused by the
   * state having moved (stale revision, changed context, already final)
   * also triggers a reload — the operator is shown the truth, not a stale
   * screen with a red box on it.
   */
  const runAction = useCallback(
    async <T,>(
      actionId: string,
      call: () => Promise<MarketingResult<T>>,
      onSuccess: (data: T) => Notice | null,
    ): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setNotice(null);
      const campaignId = review?.campaign.id;
      try {
        const result = await call();
        if (result.ok) {
          clearKey(actionId);
          closeDialog();
          setNotice(onSuccess(result.data));
          if (campaignId) await loadCampaign(campaignId);
          return;
        }

        const presented = presentError(result.error);
        setNotice({ tone: 'warn', messageKey: presented.messageKey, details: presented.details });
        if (presented.refetch && campaignId) {
          closeDialog();
          await loadCampaign(campaignId);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, review, clearKey, closeDialog, loadCampaign],
  );

  const revisionId = review?.revision.id ?? '';
  const nextRevisionNumber = (review?.revision.revisionNumber ?? 0) + 1;

  const actions = useMemo(
    () => ({
      onBack: () => {
        setReview(null);
        setNotice(null);
        setMode({ kind: 'queue' });
      },
      onRequestChanges: () => setDialog({ kind: 'request-changes' }),
      onApprove: () => setDialog({ kind: 'approve' }),
      onReject: () => setDialog({ kind: 'reject' }),
      onCancel: () => setDialog({ kind: 'cancel' }),
      onEditChannel: (preview: MarketingChannelPreview) => {
        const fields = EDITABLE_FIELDS_BY_PLATFORM[preview.platform] ?? [];
        const draft: Record<string, string> = {};
        for (const field of fields) draft[field] = currentFieldValue(preview, field);
        setDialog({ kind: 'edit', preview, draft });
      },
      onRemoveChannel: (preview: MarketingChannelPreview) => setDialog({ kind: 'remove', preview }),
      onRegenerateChannel: (preview: MarketingChannelPreview) => setDialog({ kind: 'regenerate', preview }),
      onOpenRevision: (nextRevisionId: string) => {
        if (!review) return;
        setNotice(null);
        setMode(
          nextRevisionId === review.revisionHistory.find((entry) => entry.isActive)?.revisionId
            ? { kind: 'campaign', campaignId: review.campaign.id }
            : { kind: 'campaign', campaignId: review.campaign.id, revisionId: nextRevisionId },
        );
      },
    }),
    [review],
  );

  const integration = status?.marketing;
  const unavailable =
    error?.code === 'MARKETING_AGENT_UNAVAILABLE' ||
    error?.code === 'GATEWAY_UNREACHABLE' ||
    error?.code === 'MARKETING_AGENT_NOT_CONFIGURED';

  return (
    <div className="mkt-page">
      <div className="mkt-topbar">
        <div className="mkt-status">
          <StatusDot
            variant={
              integration?.reachability === 'REACHABLE' ? 'success' : integration?.configured === false ? 'neutral' : 'warning'
            }
            label={
              integration?.reachability === 'REACHABLE'
                ? t('mkt.status.reachable')
                : integration?.configured === false
                  ? t('mkt.status.notConfigured')
                  : t('mkt.status.unreachable')
            }
          />
          <span className="mkt-muted">
            {integration?.reachability === 'REACHABLE'
              ? t('mkt.status.reachable')
              : integration?.configured === false
                ? t('mkt.status.notConfigured')
                : t('mkt.status.unreachable')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCw size={13} />}
          label={t('mkt.refresh')}
          isDisabled={loading || busy}
          clickAction={() => {
            if (mode.kind === 'queue') void loadQueue();
            else void loadCampaign(mode.campaignId);
          }}
        />
      </div>

      {notice && (
        <div className={`mkt-notice mkt-notice--${notice.tone}`}>
          {notice.tone === 'success' && <CheckCircle2 size={15} />}
          <div>
            <p className="mkt-notice-main">{t(notice.messageKey, notice.vars)}</p>
            {notice.secondaryKey && <p className="mkt-notice-sub">{t(notice.secondaryKey)}</p>}
            {notice.details && notice.details.length > 0 && (
              <ul className="mkt-list">
                {notice.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && unavailable && (
        <div className="mkt-integration-down">
          {/* The unavailable/not-configured copy already carries its own
              "JusticeOS chat is unaffected" reassurance — no second line. */}
          <p className="mkt-integration-title">{t(presentError(error).messageKey)}</p>
          <Button variant="secondary" size="sm" label={t('mkt.retry')} clickAction={() => void loadQueue()} />
        </div>
      )}

      {loading && (
        <div className="mkt-loading">
          <Spinner size="sm" label={t('mkt.loading')} />
          <span className="mkt-muted">{t('mkt.loading')}</span>
        </div>
      )}

      {!loading && !unavailable && error && (
        <div className="mkt-integration-down">
          <p className="mkt-integration-title">{t(presentError(error).messageKey)}</p>
          <Button variant="secondary" size="sm" label={t('mkt.retry')} clickAction={() => void loadQueue()} />
        </div>
      )}

      {!loading && !error && mode.kind === 'queue' && queue && (
        <MarketingQueue
          items={queue.items}
          totalAwaitingReview={queue.totalAwaitingReview}
          onOpen={(campaignId) => {
            setNotice(null);
            setMode({ kind: 'campaign', campaignId });
          }}
        />
      )}

      {!loading && !error && mode.kind === 'campaign' && review && (
        <CampaignReview review={review} busy={busy} actions={actions} />
      )}

      {/* ---- dialogs: every mutation is an explicit, confirmed action ---- */}

      <Dialog isOpen={dialog.kind === 'request-changes'} onOpenChange={closeDialog} purpose="form" width={460}>
        <DialogHeader title={t('mkt.dialog.requestChangesTitle')} subtitle={t('mkt.dialog.requestChangesDesc')} onOpenChange={closeDialog} />
        <LayoutContent>
          <TextArea
            label={t('mkt.dialog.requestChangesTitle')}
            isLabelHidden
            value={reason}
            onChange={(value: string) => setReason(value)}
            rows={5}
            placeholder={t('mkt.dialog.requestChangesPlaceholder')}
            {...(formError ? { status: { type: 'error' as const, message: t(formError) } } : {})}
          />
          <div className="mkt-dialog-actions">
            <Button variant="secondary" size="sm" label={t('mkt.action.dismiss')} clickAction={closeDialog} />
            <Button
              variant="primary"
              size="sm"
              label={busy ? t('mkt.action.working') : t('mkt.action.requestChanges')}
              isDisabled={busy}
              clickAction={() => {
                if (reason.trim().length === 0) {
                  setFormError('mkt.dialog.instructionRequired');
                  return;
                }
                void runAction(
                  'request-changes',
                  () => requestChanges(revisionId, { instruction: reason.trim() }, keyFor('request-changes')),
                  // Explicitly NOT an approval: the campaign stays in review.
                  () => ({ tone: 'success', messageKey: 'mkt.result.changesRequested' }),
                );
              }}
            />
          </div>
        </LayoutContent>
      </Dialog>

      <Dialog isOpen={dialog.kind === 'edit'} onOpenChange={closeDialog} purpose="form" width={560}>
        {dialog.kind === 'edit' && (
          <>
            <DialogHeader
              title={t('mkt.dialog.editTitle', { platform: dialog.preview.platform.replace(/_/g, ' ') })}
              subtitle={t('mkt.dialog.editNotice', { number: String(nextRevisionNumber) })}
              onOpenChange={closeDialog}
            />
            <LayoutContent>
              <div className="mkt-edit-fields">
                {Object.entries(dialog.draft).map(([field, value]) =>
                  value.length > 120 || field.includes('Copy') || field.includes('caption') || field === 'bodyDraft' ? (
                    <TextArea
                      key={field}
                      label={field}
                      value={value}
                      rows={5}
                      onChange={(next: string) =>
                        setDialog((current) =>
                          current.kind === 'edit' ? { ...current, draft: { ...current.draft, [field]: next } } : current,
                        )
                      }
                    />
                  ) : (
                    <TextInput
                      key={field}
                      label={field}
                      value={value}
                      onChange={(next: string) =>
                        setDialog((current) =>
                          current.kind === 'edit' ? { ...current, draft: { ...current.draft, [field]: next } } : current,
                        )
                      }
                    />
                  ),
                )}
              </div>
              {formError && <p className="mkt-form-error">{t(formError)}</p>}
              <p className="mkt-muted">{t('mkt.dialog.editNotice', { number: String(nextRevisionNumber) })}</p>
              <div className="mkt-dialog-actions">
                <Button variant="secondary" size="sm" label={t('mkt.action.dismiss')} clickAction={closeDialog} />
                <Button
                  variant="primary"
                  size="sm"
                  label={busy ? t('mkt.action.working') : t('mkt.dialog.editSave')}
                  isDisabled={busy}
                  clickAction={() => {
                    const changes = changedFields(dialog.preview, dialog.draft);
                    if (Object.keys(changes).length === 0) {
                      setFormError('mkt.dialog.editNoChanges');
                      return;
                    }
                    void runAction(
                      'edit-channel',
                      () =>
                        editChannel(
                          revisionId,
                          { platform: dialog.preview.platform, slot: dialog.preview.slot, changes },
                          keyFor('edit-channel'),
                        ),
                      (data) => ({
                        tone: 'success',
                        messageKey: 'mkt.result.revisionCreated',
                        vars: { number: String(data.revisionNumber) },
                      }),
                    );
                  }}
                />
              </div>
            </LayoutContent>
          </>
        )}
      </Dialog>

      <Dialog isOpen={dialog.kind === 'remove'} onOpenChange={closeDialog} purpose="form" width={420}>
        {dialog.kind === 'remove' && (
          <>
            <DialogHeader
              title={t('mkt.dialog.removeTitle', { platform: dialog.preview.platform.replace(/_/g, ' ') })}
              subtitle={t('mkt.dialog.removeDesc', { number: String(nextRevisionNumber) })}
              onOpenChange={closeDialog}
            />
            <LayoutContent>
              <div className="mkt-dialog-actions">
                <Button variant="secondary" size="sm" label={t('mkt.action.dismiss')} clickAction={closeDialog} />
                <Button
                  variant="primary"
                  size="sm"
                  label={busy ? t('mkt.action.working') : t('mkt.action.remove')}
                  isDisabled={busy}
                  clickAction={() =>
                    void runAction(
                      'remove-channel',
                      () =>
                        removeChannel(
                          revisionId,
                          { platform: dialog.preview.platform, slot: dialog.preview.slot },
                          keyFor('remove-channel'),
                        ),
                      (data) => ({
                        tone: 'success',
                        messageKey: 'mkt.result.revisionCreated',
                        vars: { number: String(data.revisionNumber) },
                      }),
                    )
                  }
                />
              </div>
            </LayoutContent>
          </>
        )}
      </Dialog>

      <Dialog isOpen={dialog.kind === 'regenerate'} onOpenChange={closeDialog} purpose="form" width={420}>
        {dialog.kind === 'regenerate' && (
          <>
            <DialogHeader
              title={t('mkt.dialog.regenerateTitle', { platform: dialog.preview.platform.replace(/_/g, ' ') })}
              subtitle={t('mkt.dialog.regenerateDesc', { number: String(nextRevisionNumber) })}
              onOpenChange={closeDialog}
            />
            <LayoutContent>
              <div className="mkt-dialog-actions">
                <Button variant="secondary" size="sm" label={t('mkt.action.dismiss')} clickAction={closeDialog} />
                <Button
                  variant="primary"
                  size="sm"
                  label={busy ? t('mkt.action.working') : t('mkt.action.regenerate')}
                  isDisabled={busy}
                  clickAction={() =>
                    void runAction(
                      'regenerate-channel',
                      () =>
                        regenerateChannel(
                          revisionId,
                          { platform: dialog.preview.platform, slot: dialog.preview.slot },
                          keyFor('regenerate-channel'),
                        ),
                      (data) => ({
                        tone: 'success',
                        messageKey: 'mkt.result.revisionCreated',
                        vars: { number: String(data.revisionNumber) },
                      }),
                    )
                  }
                />
              </div>
            </LayoutContent>
          </>
        )}
      </Dialog>

      <Dialog isOpen={dialog.kind === 'approve'} onOpenChange={closeDialog} purpose="form" width={460}>
        {review && (
          <>
            <DialogHeader
              title={t('mkt.dialog.approveTitle', { number: String(review.revision.revisionNumber) })}
              subtitle={t('mkt.dialog.approveNotPublished')}
              onOpenChange={closeDialog}
            />
            <LayoutContent>
              <p className="mkt-kv">
                <span className="mkt-kv-label">{t('mkt.dialog.approveChannels')}</span>
                {review.channelPreviews.map((preview) => preview.platform.replace(/_/g, ' ')).join(', ')}
              </p>
              <p className="mkt-muted">{t('mkt.result.approvedNotPublished')}</p>
              <div className="mkt-dialog-actions">
                <Button variant="secondary" size="sm" label={t('mkt.action.dismiss')} clickAction={closeDialog} />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<CheckCircle2 size={14} />}
                  label={busy ? t('mkt.action.working') : t('mkt.action.approve')}
                  // Disabled the moment the click lands: a second click can
                  // never start a second approval.
                  isDisabled={busy}
                  clickAction={() =>
                    void runAction(
                      'approve',
                      () => approveRevision(revisionId, {}, keyFor('approve')),
                      // Headline and "nothing was published" always travel together.
                      () => ({ tone: 'success', ...approvalSuccessNotice() }),
                    )
                  }
                />
              </div>
            </LayoutContent>
          </>
        )}
      </Dialog>

      <Dialog isOpen={dialog.kind === 'reject' || dialog.kind === 'cancel'} onOpenChange={closeDialog} purpose="form" width={440}>
        {(dialog.kind === 'reject' || dialog.kind === 'cancel') && review && (
          <>
            <DialogHeader
              title={dialog.kind === 'reject' ? t('mkt.dialog.rejectTitle') : t('mkt.dialog.cancelTitle')}
              subtitle={dialog.kind === 'reject' ? t('mkt.dialog.rejectDesc') : t('mkt.dialog.cancelDesc')}
              onOpenChange={closeDialog}
            />
            <LayoutContent>
              <TextInput
                label={t('mkt.dialog.reasonLabel')}
                value={reason}
                onChange={(value: string) => setReason(value)}
                placeholder={t('mkt.dialog.reasonPlaceholder')}
                {...(formError ? { status: { type: 'error' as const, message: t(formError) } } : {})}
              />
              <div className="mkt-dialog-actions">
                <Button variant="secondary" size="sm" label={t('mkt.action.dismiss')} clickAction={closeDialog} />
                <Button
                  variant="primary"
                  size="sm"
                  label={busy ? t('mkt.action.working') : dialog.kind === 'reject' ? t('mkt.action.reject') : t('mkt.action.cancel')}
                  isDisabled={busy}
                  clickAction={() => {
                    if (reason.trim().length === 0) {
                      setFormError('mkt.dialog.reasonRequired');
                      return;
                    }
                    const isReject = dialog.kind === 'reject';
                    void runAction(
                      isReject ? 'reject' : 'cancel',
                      () =>
                        isReject
                          ? rejectCampaign(review.campaign.id, { reason: reason.trim(), revisionId }, keyFor('reject'))
                          : cancelCampaign(review.campaign.id, { reason: reason.trim(), revisionId }, keyFor('cancel')),
                      () => ({ tone: 'success', messageKey: isReject ? 'mkt.result.rejected' : 'mkt.result.cancelled' }),
                    );
                  }}
                />
              </div>
            </LayoutContent>
          </>
        )}
      </Dialog>
    </div>
  );
}
