import { useMemo, useState } from 'react';
import { HomeOverview } from './HomeOverview';
import justiceOsLogo from '../assets/brand/justiceos-logo.png';
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

export function Dashboard({ onNavigate }: { onNavigate?: (section: 'overview'|'bank'|'forecast'|'tasks'|'connections') => void }) {
  const { t } = useI18n();
  const [greetingPeriod] = useState(() => greetingPeriodForHour(new Date().getHours()));
  const slot = usePanda((s) => s.connections[MANAGED_INSURANCE_PROFILE_ID]);
  const lifecycle = useMemo(() => (slot ? connectionLifecycle(slot) : null), [slot]);
  return <div className="gw-dashboard gw-home">
    <header className="gw-dashboard-header">
      <h1 className="gw-dashboard-heading"><img src={justiceOsLogo} alt={t('dashboard.heading')} className="gw-dashboard-logo" /></h1>
      <p className="gw-dashboard-greeting">{t(GREETING_KEYS[greetingPeriod])}</p>
      <p className="home-subtitle">Your business, at a glance. Cash today, work ahead, and decisions that need you.</p>
    </header>
    <HomeOverview onNavigate={onNavigate} attention={dashboardAttentionKeys(lifecycle).map(key=>t(key))} running={Boolean(lifecycle?.running)} />
  </div>;
}
