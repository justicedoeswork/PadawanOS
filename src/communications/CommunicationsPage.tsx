import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useI18n } from '../i18n/context';

type PanelKey = 'today' | 'waiting' | 'replies' | 'approvals' | 'notifications';

type LoadedData = {
  status: 'loading' | 'ready' | 'error';
  reachable: boolean;
  today: unknown[];
  waiting: unknown[];
  replies: unknown[];
  responseDrafts: unknown[];
  calendarProposals: unknown[];
  notifications: unknown[];
};

async function read(path: string): Promise<any> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(response.status));
  return body;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown, ...keys: string[]): string | undefined {
  const row = record(value);
  for (const key of keys) {
    const candidate = row[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function nestedString(value: unknown, parent: string, ...keys: string[]): string | undefined {
  return stringField(record(value)[parent], ...keys);
}

export function CommunicationsPage() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<PanelKey | null>(() => {const panel=typeof window==='undefined'?null:new URLSearchParams(window.location.hash.split('?')[1]).get('panel');return panel==='replies'||panel==='approvals'?panel:'replies';});
  const [data, setData] = useState<LoadedData>({
    status: 'loading',
    reachable: false,
    today: [],
    waiting: [],
    replies: [],
    responseDrafts: [],
    calendarProposals: [],
    notifications: []
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
        const approvalData = record(approvals?.data);
        setData({
          status: 'ready',
          reachable: status?.communications?.reachability === 'REACHABLE',
          today: arr(today?.data),
          waiting: arr(waiting?.data),
          replies: arr(replies?.data),
          responseDrafts: arr(approvalData.responseDrafts),
          calendarProposals: arr(approvalData.calendarProposals),
          notifications: arr(notifications?.data)
        });
      })
      .catch(() => {
        if (!cancelled) setData((current) => ({ ...current, status: 'error' }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(
    () => [
            { key: 'replies' as const, label: t('communications.replies'), value: data.replies.length },
      {
        key: 'approvals' as const,
        label: t('communications.approvals'),
        value: data.responseDrafts.length + data.calendarProposals.length
      },
      { key: 'today' as const, label: t('communications.today'), value: data.today.length },
      { key: 'waiting' as const, label: t('communications.waiting'), value: data.waiting.length },
      { key: 'notifications' as const, label: t('communications.notifications'), value: data.notifications.length }
    ],
    [data, t]
  );

  return (
    <div className="communications-page">
      <section className="communications-hero">
        <div>
          <h1>{t('communications.title')}</h1>
        </div>
        <span className={`communications-status communications-status--${data.reachable ? 'ok' : 'down'}`}>
          {data.status === 'loading'
            ? t('communications.loading')
            : data.reachable
              ? t('communications.connected')
              : t('communications.unavailable')}
        </span>
      </section>

      {data.status === 'error' ? (
        <p className="communications-error">{t('communications.error')}</p>
      ) : (
        <>
          <div className="communications-grid">
            {metrics.map((metric) => (
              <Metric
                key={metric.key}
                label={metric.label}
                value={data.status==='ready'?metric.value:null}
                selected={selected===metric.key}
                onClick={() => setSelected(metric.key)}
              />
            ))}
          </div>

          {selected && data.status==='ready' && (
            <Drilldown
              panel={selected}
              data={data}
              onClose={() => setSelected(null)}
              title={metrics.find((metric) => metric.key === selected)?.label ?? ''}
              emptyText={t('communications.empty')}
            />
          )}
        </>
      )}

      <details className="communications-note">
        <summary>{t('communications.readOnlyTitle')}</summary>
        <p>{t('communications.readOnlyBody')}</p>
      </details>
    </div>
  );
}

function Metric({ label, value, selected, onClick }: { label: string; value: number|null; selected:boolean; onClick(): void }) {
  return (
    <button type="button" className="communications-card communications-card--button" aria-pressed={selected} disabled={value===null} onClick={onClick}>
      <span className="communications-card-value">{value??'—'}</span>
      <span className="communications-card-row">
        <span className="communications-card-label">{label}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}

export function Drilldown({
  panel,
  data,
  title,
  emptyText,
  onClose
}: {
  panel: PanelKey;
  data: LoadedData;
  title: string;
  emptyText: string;
  onClose(): void;
}) {
  let rows: Array<{ title: string; detail?: string; meta?: string }> = [];

  if (panel === 'today' || panel === 'waiting') {
    const source = panel === 'today' ? data.today : data.waiting;
    rows = source.map((item) => ({
      title: stringField(item, 'title', 'description') ?? 'Untitled item',
      detail: stringField(item, 'description'),
      meta: [
        stringField(item, 'waitingOn') ? `Waiting on ${stringField(item, 'waitingOn')}` : undefined,
        stringField(item, 'dueAt') ? `Due ${new Date(stringField(item, 'dueAt')!).toLocaleString()}` : undefined
      ]
        .filter(Boolean)
        .join(' · ') || undefined
    }));
  } else if (panel === 'replies') {
    rows = data.replies.map((item) => ({
      title: nestedString(item, 'message', 'subject') ?? '(no subject)',
      detail: nestedString(item, 'message', 'sender') ?? stringField(record(record(item).message).sender,'displayName','emailAddress','address') ?? 'Unknown sender',
      meta: nestedString(item, 'message', 'occurredAt')
        ? new Date(nestedString(item, 'message', 'occurredAt')!).toLocaleString()
        : undefined
    }));
  } else if (panel === 'approvals') {
    rows = [
      ...data.responseDrafts.map((item) => ({
        title: stringField(item, 'subject') ?? stringField(item, 'requestSummary') ?? 'Response draft',
        detail: stringField(item, 'requestSummary'),
        meta: 'Email draft awaiting approval'
      })),
      ...data.calendarProposals.map((item) => ({
        title: stringField(item, 'title') ?? 'Calendar proposal',
        detail: stringField(item, 'location'),
        meta: stringField(item, 'startAt')
          ? `Starts ${new Date(stringField(item, 'startAt')!).toLocaleString()}`
          : 'Calendar proposal awaiting approval'
      }))
    ];
  } else {
    rows = data.notifications.map((item) => ({
      title: stringField(item, 'title', 'kind') ?? 'Notification',
      detail: stringField(item, 'message', 'body'),
      meta: stringField(item, 'createdAt', 'occurredAt')
        ? new Date(stringField(item, 'createdAt', 'occurredAt')!).toLocaleString()
        : undefined
    }));
  }

  return (
    <section className="communications-drilldown" aria-label={title}>
      <div className="communications-drilldown-header">
        <div>
          <h2>{title}</h2>
        </div>
        <button type="button" className="communications-drilldown-close" onClick={onClose} aria-label="Close details">
          <X size={18} />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="communications-drilldown-empty">{emptyText}</p>
      ) : (
        <div className="communications-list">
          {rows.map((row, index) => (
            <article className="communications-list-item" key={index}>
              <strong>{row.title}</strong>
              {row.detail && row.detail !== row.title && (panel==='replies'?<p>{row.detail}</p>:<details><summary>Details</summary><p>{row.detail}</p></details>)}
              {row.meta && <span>{row.meta}</span>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
