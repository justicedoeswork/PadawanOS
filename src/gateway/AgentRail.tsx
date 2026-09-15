import { Home, LogOut, ShieldCheck, Settings as SettingsIcon } from 'lucide-react';
import { useI18n } from '../i18n/context';
import type { ConnectionPhase } from '../projector/connectionLifecycle';
import { isLinkUp } from '../projector/connectionLifecycle';
import './AgentRail.css';

export type RailView = 'dashboard' | 'agent';

/**
 * The narrow, always-visible left rail for the JusticeOS gateway build
 * (LAYOUT #1). Replaces the generic multi-agent Sidebar in this build --
 * there is exactly one connection here (the managed Insurance Audit
 * Agent), so a session list / "Add agent" control / hamburger drawer
 * would all be showing controls for a feature this build doesn't have.
 *
 * Purely presentational: every action is a callback prop, so this
 * component never touches the connection/session stores directly and
 * stays trivially SSR-testable (no window/store access at render time).
 */
export function AgentRail({
  activeView,
  agentName,
  connectionPhase,
  onHome,
  onOpenAgent,
  onSettings,
  onSignOut,
  signOutBusy,
}: {
  activeView: RailView;
  agentName: string;
  connectionPhase: ConnectionPhase;
  onHome(): void;
  onOpenAgent(): void;
  onSettings(): void;
  onSignOut(): void;
  signOutBusy: boolean;
}) {
  const { t } = useI18n();
  const connected = isLinkUp(connectionPhase);
  const statusLabel = connectionPhaseLabel(connectionPhase, t);

  return (
    <nav className="gw-rail" aria-label={t('gateway.title')}>
      <button
        type="button"
        className={`gw-rail-btn gw-rail-home ${activeView === 'dashboard' ? 'gw-rail-btn--active' : ''}`}
        aria-label={t('rail.home')}
        aria-current={activeView === 'dashboard' ? 'page' : undefined}
        title={t('rail.homeTooltip')}
        onClick={onHome}
      >
        <Home size={20} />
      </button>

      <button
        type="button"
        className={`gw-rail-btn gw-rail-agent ${activeView === 'agent' ? 'gw-rail-btn--active' : ''}`}
        aria-label={`${agentName} — ${statusLabel}`}
        aria-current={activeView === 'agent' ? 'page' : undefined}
        title={t('rail.agentTooltip', { name: agentName })}
        onClick={onOpenAgent}
      >
        <span className="gw-rail-agent-icon">
          <ShieldCheck size={20} />
          <span
            className={`gw-rail-status-dot gw-rail-status-dot--${connected ? 'connected' : connectionPhase === 'connecting' ? 'connecting' : connectionPhase === 'error' || connectionPhase === 'auth-required' ? 'error' : 'offline'}`}
            aria-hidden="true"
          />
        </span>
        <span className="gw-rail-agent-caption truncate">{agentName}</span>
      </button>

      <div className="gw-rail-spacer" />

      <button
        type="button"
        className="gw-rail-btn"
        aria-label={t('rail.settings')}
        title={t('rail.settingsTooltip')}
        onClick={onSettings}
      >
        <SettingsIcon size={20} />
      </button>

      <button
        type="button"
        className="gw-rail-btn"
        aria-label={t('rail.signOut')}
        title={t('rail.signOut')}
        disabled={signOutBusy}
        onClick={onSignOut}
      >
        <LogOut size={20} />
      </button>
    </nav>
  );
}

function connectionPhaseLabel(
  phase: ConnectionPhase,
  t: (key: 'conn.connected' | 'conn.error' | 'conn.authRequired' | 'conn.disconnected' | 'status.connecting') => string,
): string {
  if (phase === 'connected' || phase === 'connected-degraded' || phase === 'switching-session') return t('conn.connected');
  if (phase === 'connecting') return t('status.connecting');
  if (phase === 'error') return t('conn.error');
  if (phase === 'auth-required') return t('conn.authRequired');
  return t('conn.disconnected');
}
