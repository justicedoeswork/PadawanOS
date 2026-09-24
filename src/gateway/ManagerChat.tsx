import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import justiceOsMark from '../assets/brand/justiceos-mark.png';
import { useI18n } from '../i18n/context';
import { ask, decide, type ManagerBridgeError } from '../manager/client';
import { approvalBadgeKey, decisionLabelKey, panelViewFor, problemView, type DecisionControl, type PanelView } from '../manager/viewModel';
import './ManagerChat.css';

/**
 * The floating Justice Manager panel (LAYOUT #3), now wired to the gateway's
 * marketing routing rather than showing a placeholder.
 *
 * What it does: takes a question in Austin's words, posts it to
 * `/api/marketing/agent/ask`, and renders what comes back — the Marketing
 * Agent's own sentences, its confidence, what it could not see, and which of
 * the four approval states the answer is in.
 *
 * What it deliberately does not do:
 *
 *   - compose any marketing prose of its own. Every sentence on screen is the
 *     agent's `headline`, relayed;
 *   - approve anything as a side effect. A question worded like an approval
 *     comes back as a control, and the decision is sent only when Austin
 *     clicks it — with the revision it applies to already named. If the
 *     request named no revision, it says so and offers no button;
 *   - guess when the Marketing Agent is unreachable or speaking a contract
 *     version JusticeOS was not built for. Both are reported as what they
 *     are.
 *
 * The scope is honest, and the panel says so: marketing is the one specialist
 * the manager routes to today.
 */
export function ManagerChat() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<PanelView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  // One conversation per panel session, so the gateway can correlate the
  // turns it sees and the Marketing Agent's logs line up with them.
  const conversationId = useRef(`conv_${Math.random().toString(36).slice(2, 12)}`);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = request.trim();
    if (text.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await ask(text, { conversationId: conversationId.current });
    setBusy(false);
    setView(result.ok ? panelViewFor(result.data) : problemView(result.error));
  }

  /**
   * The only path to a recorded decision in this component, reached only from
   * a button press. `decide()` sends `confirmed: true`; the gateway refuses
   * without it.
   */
  async function confirmDecision(control: DecisionControl) {
    if (busy) return;
    const reason = revisionReason.trim();
    if (control.reasonRequired && reason.length === 0) return;
    setBusy(true);
    const result = await decide({
      revisionId: control.revisionId,
      decision: control.decision,
      conversationId: conversationId.current,
      ...(reason ? { reason } : {})
    });
    setBusy(false);
    if (!result.ok) {
      setView(problemView(result.error as ManagerBridgeError));
      return;
    }
    setRevisionReason('');
    setNotice(`${t('manager.decision.recorded')} ${result.data.publicationNote}`);
  }

  return (
    <>
      <button
        type="button"
        className="gw-manager-fab"
        aria-label={t('manager.openTooltip')}
        title={t('manager.openTooltip')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <img src={justiceOsMark} alt="" className="gw-manager-fab-icon" />
      </button>

      {open && (
        <div className="gw-manager-panel" role="dialog" aria-modal="true" aria-label={t('manager.panelTitle')}>
          <div className="gw-manager-panel-header">
            <span className="gw-manager-panel-title">{t('manager.panelTitle')}</span>
            <button type="button" className="gw-manager-panel-close" aria-label={t('manager.panelClose')} onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="gw-manager-panel-body">
            <p className="gw-mgr-intro">{t('manager.ask.intro')}</p>

            <form className="gw-mgr-form" onSubmit={submit}>
              <label className="gw-mgr-label" htmlFor="gw-mgr-input">
                {t('manager.ask.inputLabel')}
              </label>
              <textarea
                id="gw-mgr-input"
                className="gw-mgr-input"
                rows={2}
                value={request}
                placeholder={t('manager.ask.inputPlaceholder')}
                onChange={(event) => setRequest(event.target.value)}
              />
              <button type="submit" className="gw-mgr-send" disabled={busy || request.trim().length === 0}>
                {busy ? t('manager.ask.thinking') : t('manager.ask.send')}
              </button>
            </form>

            {notice && <p className="gw-mgr-notice">{notice}</p>}
            {view && <PanelBody view={view} onDecide={confirmDecision} reason={revisionReason} onReasonChange={setRevisionReason} busy={busy} />}

            <p className="gw-mgr-scope">{t('manager.ask.marketingOnly')}</p>
          </div>
        </div>
      )}
    </>
  );
}

function PanelBody({
  view,
  onDecide,
  reason,
  onReasonChange,
  busy
}: {
  view: PanelView;
  onDecide(control: DecisionControl): void;
  reason: string;
  onReasonChange(value: string): void;
  busy: boolean;
}) {
  const { t } = useI18n();

  if (view.kind === 'problem') {
    return (
      <div className={`gw-mgr-problem ${view.integration ? 'gw-mgr-problem--integration' : ''}`} role="status">
        <p className="gw-mgr-problem-headline">{t(view.messageKey)}</p>
        {view.detail && <p className="gw-mgr-problem-detail">{view.detail}</p>}
      </div>
    );
  }

  if (view.kind === 'unroutable') {
    return (
      <div className="gw-mgr-unroutable" role="status">
        <p className="gw-mgr-problem-headline">{t('manager.unroutable')}</p>
        <p className="gw-mgr-problem-detail">{view.reason}</p>
        <p className="gw-mgr-hint">{t('manager.unroutable.tryOne')}</p>
        <ul className="gw-mgr-list">
          {view.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (view.kind === 'pending-decision') {
    return (
      <div className="gw-mgr-pending" role="status">
        <span className="gw-mgr-badge gw-mgr-badge--approval">{t('manager.state.approvalRequired')}</span>
        <p className="gw-mgr-problem-detail">{view.note}</p>
        {view.rationale && <p className="gw-mgr-hint">{view.rationale}</p>}
        {/* No revision named, so no button: the manager will not choose which
            package an approval applies to. */}
        <p className="gw-mgr-hint">{t('manager.decision.whichOne')}</p>
      </div>
    );
  }

  return (
    <div className="gw-mgr-answer">
      <span className={`gw-mgr-badge gw-mgr-badge--${view.approvalRequirement.toLowerCase()}`}>{t(approvalBadgeKey(view.approvalRequirement))}</span>

      {view.summary.map((line) => (
        <p key={line} className="gw-mgr-summary-line">
          {line}
        </p>
      ))}

      {view.deduped && <p className="gw-mgr-hint">{t('manager.ask.deduped')}</p>}

      <p className="gw-mgr-meta">
        {t('manager.ask.confidence')}: {view.confidence}
        {view.evidenceCount > 0 && ` · ${t('manager.section.evidence')}: ${view.evidenceCount}`}
      </p>

      {view.constraint && <p className="gw-mgr-constraint">{view.constraint.reason}</p>}

      {view.blockers.length > 0 && (
        <section className="gw-mgr-section" aria-label={t('manager.section.blockers')}>
          <h4 className="gw-mgr-section-title">{t('manager.section.blockers')}</h4>
          <ul className="gw-mgr-list">
            {view.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}

      {view.staleSources.length > 0 && (
        <section className="gw-mgr-section" aria-label={t('manager.section.stale')}>
          <h4 className="gw-mgr-section-title">{t('manager.section.stale')}</h4>
          <ul className="gw-mgr-list">
            {view.staleSources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </section>
      )}

      {view.followUps.length > 0 && (
        <section className="gw-mgr-section" aria-label={t('manager.section.followUps')}>
          <h4 className="gw-mgr-section-title">{t('manager.section.followUps')}</h4>
          <ul className="gw-mgr-list">
            {view.followUps.map((followUp) => (
              <li key={followUp.action}>
                {followUp.action}
                {followUp.requiresOwnerApproval && <span className="gw-mgr-owner-tag"> — {t('manager.ask.needsOwner')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.decisions.length > 0 && (
        <section className="gw-mgr-decisions" aria-label={t('manager.state.approvalRequired')}>
          <p className="gw-mgr-hint">{t('manager.decision.nothingPublished')}</p>
          <label className="gw-mgr-label" htmlFor="gw-mgr-reason">
            {t('manager.decision.reasonLabel')}
          </label>
          <input id="gw-mgr-reason" className="gw-mgr-input" value={reason} onChange={(event) => onReasonChange(event.target.value)} />
          <div className="gw-mgr-decision-row">
            {view.decisions.map((control) => (
              <button
                key={control.decision}
                type="button"
                className={`gw-mgr-decision gw-mgr-decision--${control.decision.toLowerCase()}`}
                disabled={busy || (control.reasonRequired && reason.trim().length === 0)}
                onClick={() => onDecide(control)}
              >
                {t(decisionLabelKey(control.decision))}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
