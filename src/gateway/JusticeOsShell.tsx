import { useState, type ReactNode } from 'react';
import { isGatewayBuild } from './buildMode';
import { usePanda } from '../store';
import { connectionLifecycle } from '../projector/connectionLifecycle';
import { MANAGED_INSURANCE_PROFILE_ID } from './managedAgentId';
import { AgentRail, type RailView } from './AgentRail';
import { Dashboard } from './Dashboard';
import { ManagerChat } from './ManagerChat';
import { useGatewayAuth } from './gatewayAuthStore';
import { navigate } from '../routes';
import { useI18n } from '../i18n/context';
import './JusticeOsShell.css';

/**
 * Wraps `<App/>` in the gateway build only (main.tsx: GatewayGate >
 * JusticeOsShell > App) -- a complete no-op in the GitHub Pages demo
 * build, same contract as GatewayGate itself: `isGatewayBuild()` false
 * means this renders `children` directly and touches nothing else, so
 * the demo build's App (Sidebar, EmptyState onboarding, Panda branding)
 * is byte-for-byte unaffected.
 *
 * In the gateway build this owns the JusticeOS dashboard-vs-chat toggle
 * (LAYOUT): the always-visible AgentRail plus either the Dashboard home
 * screen or `children` (the real, untouched App -- same component,
 * same store, same connection; nothing about the chat itself changes).
 * `children` unmounting while the dashboard shows does NOT touch the
 * connection: the managed agent's WebSocket lives in liveConnections.ts
 * module state and managedAgent.ts's supervisor (a zustand subscription),
 * neither owned by App's own component lifecycle -- switching views here
 * never disconnects, reconnects, or loses the session.
 */
export function JusticeOsShell({ children }: { children: ReactNode }) {
  if (!isGatewayBuild()) return <>{children}</>;
  return <GatewayDashboardShell>{children}</GatewayDashboardShell>;
}

function GatewayDashboardShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [view, setView] = useState<RailView>('dashboard');
  const slot = usePanda((s) => s.connections[MANAGED_INSURANCE_PROFILE_ID]);
  const lifecycle = slot ? connectionLifecycle(slot) : null;
  const agentName = slot?.connection.agentName || t('dashboard.agentCard.title');
  const signOutBusy = useGatewayAuth((s) => s.busy);

  return (
    <div className="gw-shell">
      <AgentRail
        activeView={view}
        agentName={agentName}
        connectionPhase={lifecycle?.phase ?? 'disconnected'}
        onHome={() => setView('dashboard')}
        onOpenAgent={() => setView('agent')}
        onSettings={() => {
          navigate('settings');
          setView('agent');
        }}
        onSignOut={() => void useGatewayAuth.getState().logout()}
        signOutBusy={signOutBusy}
      />
      <div className="gw-shell-main">
        {view === 'dashboard' ? <Dashboard onOpenAgent={() => setView('agent')} /> : children}
      </div>
      {view === 'dashboard' && <ManagerChat />}
    </div>
  );
}
