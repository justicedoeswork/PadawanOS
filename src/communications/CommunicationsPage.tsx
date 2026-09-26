import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/context';

type Summary = {
  status: 'loading' | 'ready' | 'error';
  reachable: boolean;
  today: number;
  waiting: number;
  replies: number;
  approvals: number;
  notifications: number;
};

async function read(path: string): Promise<any> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(response.status));
  return body;
}

function countData(body: any): number {
  return Array.isArray(body?.data) ? body.data.length : 0;
}

export function CommunicationsPage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary>({
    status: 'loading',
    reachable: false,
    today: 0,
    waiting: 0,
    replies: 0,
    approvals: 0,
    notifications: 0
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      read('/api/communications/status'),
      read('/api/communications/ledger/views/today'),
      read('/api/communications/ledger/views/waiting'),
      read('/api/communications/emails/needs-reply'),
      read('/api/communications/approvals/pending'),
      read('/api/communications/notifications')
    ])
      .then(([status, today, waiting, replies, approvals, notifications]) => {
        if (cancelled) return;
        const approvalData = approvals?.data ?? {};
        setSummary({
          status: 'ready',
          reachable: status?.communications?.reachability === 'REACHABLE',
          today: countData(today),
          waiting: countData(waiting),
          replies: countData(replies),
          approvals:
            (Array.isArray(approvalData.responseDrafts) ? approvalData.responseDrafts.length : 0) +
            (Array.isArray(approvalData.calendarProposals) ? approvalData.calendarProposals.length : 0),
          notifications: countData(notifications)
        });
      })
      .catch(() => {
        if (!cancelled) setSummary((current) => ({ ...current, status: 'error' }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="communications-page">
      <section className="communications-hero">
        <div>
          <p className="communications-kicker">{t('communications.kicker')}</p>
          <h1>{t('communications.title')}</h1>
          <p>{t('communications.subtitle')}</p>
        </div>
        <span className={`communications-status communications-status--${summary.reachable ? 'ok' : 'down'}`}>
          {summary.status === 'loading'
            ? t('communications.loading')
            : summary.reachable
              ? t('communications.connected')
              : t('communications.unavailable')}
        </span>
      </section>

      {summary.status === 'error' ? (
        <p className="communications-error">{t('communications.error')}</p>
      ) : (
        <div className="communications-grid">
          <Metric label={t('communications.today')} value={summary.today} />
          <Metric label={t('communications.waiting')} value={summary.waiting} />
          <Metric label={t('communications.replies')} value={summary.replies} />
          <Metric label={t('communications.approvals')} value={summary.approvals} />
          <Metric label={t('communications.notifications')} value={summary.notifications} />
        </div>
      )}

      <section className="communications-note">
        <strong>{t('communications.readOnlyTitle')}</strong>
        <p>{t('communications.readOnlyBody')}</p>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <section className="communications-card">
      <span className="communications-card-value">{value}</span>
      <span className="communications-card-label">{label}</span>
    </section>
  );
}
