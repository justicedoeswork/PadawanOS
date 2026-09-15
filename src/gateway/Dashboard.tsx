import { useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { usePanda } from '../store';
import { connectionLifecycle, isLinkUp, type ConnectionLifecycle } from '../projector/connectionLifecycle';
import { MANAGED_INSURANCE_PROFILE_ID } from './managedAgentId';
import { greetingPeriodForHour } from './dashboardGreeting';
import './Dashboard.css';

const GREETING_KEYS = {
  morning: 'dashboard.greeting.morning',
  afternoon: 'dashboard.greeting.afternoon',
  evening: 'dashboard.greeting.evening',
} as const;

const ATTENTION_MESSAGE_KEYS = {
  'unread-completion': 'dashboard.attention.unreadCompletion',
  'pending-permission': 'dashboard.attention.pendingPermission',
  'connection-error': 'dashboard.attention.connectionError',
  'auth-required': 'dashboard.attention.connectionError',
} as const;

type ConnStatusKey = 'conn.disconnected' | 'status.connecting' | 'conn.connected' | 'conn.error' | 'conn.authRequired';

/**
 * The agent card's status label, as an i18n KEY rather than translated
 * text -- pure and directly unit-testable (ADR 0006: meaning here, pixels
 * in the component) without touching React or the zustand store, whose
 * SSR snapshot (`getServerSnapshot` -> `getInitialState()`, zustand/react.js)
 * can never reflect a `setState()` call made before a `renderToStaticMarkup`
 * render -- exactly why this logic is split out instead of asserted on
 * through a rendered, store-seeded component the way GatewayGate.test.tsx's
 * own header comment already flags as unreliable in this project.
 */
export function dashboardAgentStatusKey(lifecycle: ConnectionLifecycle | null): ConnStatusKey {
  if (!lifecycle) return 'conn.disconnected';
  if (lifecycle.phase === 'connecting') return 'status.connecting';
  if (isLinkUp(lifecycle.phase)) return 'conn.connected';
  if (lifecycle.phase === 'error') return 'conn.error';
  if (lifecycle.phase === 'auth-required') return 'conn.authRequired';
  return 'conn.disconnected';
}

/** Attention message KEYS for whichever real reasons the lifecycle
 * reports -- empty when there are none, never invented. */
export function dashboardAttentionKeys(lifecycle: ConnectionLifecycle | null): Array<(typeof ATTENTION_MESSAGE_KEYS)[keyof typeof ATTENTION_MESSAGE_KEYS]> {
  return (lifecycle?.attention ?? []).map((reason) => ATTENTION_MESSAGE_KEYS[reason]);
}

/** "In progress" has exactly one possible real item today (the managed
 * connection's own document mid-turn) -- never a fabricated list. */
export function dashboardInProgressKeys(lifecycle: ConnectionLifecycle | null): Array<'dashboard.inProgress.running'> {
  return lifecycle?.running ? ['dashboard.inProgress.running'] : [];
}

/**
 * JusticeOS dashboard home screen (LAYOUT #2). Every figure here comes
 * from the managed connection's own real state (connectionLifecycle,
 * same projection Sidebar/StatusBar already use) -- never invented. Work
 * queue and Upcoming have no backing data source in this frontend yet, so
 * they render their honest empty state unconditionally rather than a
 * fabricated count.
 */
export function Dashboard({ onOpenAgent }: { onOpenAgent(): void }) {
  const { t } = useI18n();
  // Computed once per mount, not on every render (a dashboard left open
  // past a period boundary keeps its opening greeting rather than
  // flickering mid-visit -- device-local time per the spec, read once).
  const [greetingPeriod] = useState(() => greetingPeriodForHour(new Date().getHours()));

  const slot = usePanda((s) => s.connections[MANAGED_INSURANCE_PROFILE_ID]);
  const lifecycle = useMemo(() => (slot ? connectionLifecycle(slot) : null), [slot]);
  const agentName = slot?.connection.agentName || t('dashboard.agentCard.title');
  const connected = lifecycle ? isLinkUp(lifecycle.phase) : false;
  const statusLabel = t(dashboardAgentStatusKey(lifecycle));
  const attentionItems = dashboardAttentionKeys(lifecycle).map((key) => t(key));
  const inProgressItems = dashboardInProgressKeys(lifecycle).map((key) => t(key));

  return (
    <div className="gw-dashboard">
      <header className="gw-dashboard-header">
        <h1 className="gw-dashboard-heading">{t('dashboard.heading')}</h1>
        <p className="gw-dashboard-greeting">{t(GREETING_KEYS[greetingPeriod])}</p>
      </header>

      <section className="gw-dashboard-briefing" aria-label={t('dashboard.briefing.title')}>
        <h2 className="gw-dashboard-briefing-title">{t('dashboard.briefing.title')}</h2>
        <p className="gw-dashboard-briefing-body">{t('dashboard.briefing.placeholder')}</p>
      </section>

      <button type="button" className="gw-dashboard-agent-card" onClick={onOpenAgent}>
        <span className="gw-dashboard-agent-icon" aria-hidden="true">
          <ShieldCheck size={22} />
        </span>
        <span className="gw-dashboard-agent-info">
          <span className="gw-dashboard-agent-name truncate">{agentName}</span>
          <span className={`gw-dashboard-agent-status ${connected ? 'gw-dashboard-agent-status--connected' : ''}`}>
            {statusLabel}
          </span>
        </span>
        <span className="gw-dashboard-agent-cta">{t('dashboard.agentCard.open')}</span>
      </button>

      <div className="gw-dashboard-grid">
        <DashboardCard title={t('dashboard.card.attention')} items={attentionItems} emptyText={t('dashboard.empty.attention')} />
        <DashboardCard title={t('dashboard.card.inProgress')} items={inProgressItems} emptyText={t('dashboard.empty.inProgress')} />
        <DashboardCard title={t('dashboard.card.workQueue')} items={[]} emptyText={t('dashboard.empty.workQueue')} />
        <DashboardCard title={t('dashboard.card.upcoming')} items={[]} emptyText={t('dashboard.empty.upcoming')} />
      </div>
    </div>
  );
}

function DashboardCard({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <section className="gw-dashboard-card" aria-label={title}>
      <h3 className="gw-dashboard-card-title">{title}</h3>
      {items.length === 0 ? (
        <p className="gw-dashboard-card-empty">{emptyText}</p>
      ) : (
        <ul className="gw-dashboard-card-list">
          {items.map((item, index) => (
            <li key={index} className="gw-dashboard-card-item">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
