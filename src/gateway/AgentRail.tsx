import type { Ref } from 'react';
import { ChevronLeft, ChevronRight, Home, LogOut, Settings as SettingsIcon, X } from 'lucide-react';
import justiceOsMark from '../assets/brand/gateway-presentation/justiceos-mark-color.svg';
import { AgentAvatar } from './AgentAvatar';
import { useI18n } from '../i18n/context';
import type { ConnectionPhase } from '../projector/connectionLifecycle';
import { isLinkUp } from '../projector/connectionLifecycle';
import './AgentRail.css';

export type RailView = 'dashboard' | 'agent';

/**
 * The collapsible left agent sidebar for the JusticeOS gateway build
 * (LAYOUT #1). Every agent (today: exactly one, the managed Insurance
 * Audit Agent) lives here and only here -- the dashboard content column
 * never shows an agent card/launch control of its own.
 *
 * Two independent size states, both driven by props (JusticeOsShell owns
 * the state -- this stays purely presentational: every action is a
 * callback prop, so it never touches the connection/session stores or
 * localStorage directly, and stays trivially SSR-testable):
 *
 * - `collapsed` (desktop only, remembered across visits via
 *   sidebarPreference.ts): narrows the always-visible rail down to an
 *   icon-only strip. CSS-gated to >=768px -- see AgentRail.css.
 * - `mobileOpen` (never remembered; always starts false): below 768px the
 *   same nav becomes an off-canvas drawer, opened by the "Open agents"
 *   trigger button JusticeOsShell renders in its mobile top bar (that
 *   trigger has to live outside this drawer, since the drawer itself is
 *   off-screen while closed) and closed by the drawer's own close button,
 *   the backdrop, Escape, or picking Home/the agent. Toggling either state
 *   only ever calls onToggleCollapsed/onCloseMobile -- never onSignOut or
 *   anything connection-related, so it can never disconnect the managed
 *   agent or sign the user out.
 */
export function AgentRail({
  activeView,
  agentName,
  connectionPhase,
  collapsed,
  mobileOpen,
  onHome,
  onOpenAgent,
  onSettings,
  onSignOut,
  onToggleCollapsed,
  onCloseMobile,
  signOutBusy,
  navRef,
}: {
  activeView: RailView;
  agentName: string;
  connectionPhase: ConnectionPhase;
  collapsed: boolean;
  mobileOpen: boolean;
  onHome(): void;
  onOpenAgent(): void;
  onSettings(): void;
  onSignOut(): void;
  onToggleCollapsed(): void;
  onCloseMobile(): void;
  signOutBusy: boolean;
  /** Attached to the drawer's own root so JusticeOsShell can move keyboard
   * focus into it when the mobile drawer opens. */
  navRef?: Ref<HTMLElement>;
}) {
  const { t } = useI18n();
  const connected = isLinkUp(connectionPhase);
  const statusLabel = connectionPhaseLabel(connectionPhase, t);

  return (
    <>
      {mobileOpen && <div className="gw-rail-backdrop" onClick={onCloseMobile} aria-hidden="true" />}

      <nav
        id="gw-rail-nav"
        ref={navRef}
        tabIndex={-1}
        className={`gw-rail ${collapsed ? 'gw-rail--collapsed' : ''} ${mobileOpen ? 'gw-rail--open' : ''}`}
        aria-label={t('gateway.title')}
      >
        <div className="gw-rail-top">
          {/* Standalone mark: brand identity, not a navigation control --
              purely decorative (the Home button below is the actual
              "go to dashboard" affordance), so it's aria-hidden. */}
          <img src={justiceOsMark} alt="" className="gw-rail-brand-mark" aria-hidden="true" />
          <button type="button" className="gw-rail-btn gw-rail-mobile-close" aria-label={t('rail.closeAgents')} onClick={onCloseMobile}>
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          className={`gw-rail-btn gw-rail-home ${activeView === 'dashboard' ? 'gw-rail-btn--active' : ''}`}
          aria-label={t('rail.home')}
          aria-current={activeView === 'dashboard' ? 'page' : undefined}
          title={t('rail.homeTooltip')}
          onClick={onHome}
        >
          <Home size={20} />
          <span className="gw-rail-btn-label">{t('rail.home')}</span>
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
            <AgentAvatar role="insurance-audit" size={20} />
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
          className="gw-rail-btn gw-rail-collapse-toggle"
          aria-label={collapsed ? t('rail.expand') : t('rail.collapse')}
          aria-pressed={collapsed}
          title={collapsed ? t('rail.expand') : t('rail.collapse')}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          <span className="gw-rail-btn-label">{collapsed ? t('rail.expand') : t('rail.collapse')}</span>
        </button>

        <button
          type="button"
          className="gw-rail-btn"
          aria-label={t('rail.settings')}
          title={t('rail.settingsTooltip')}
          onClick={onSettings}
        >
          <SettingsIcon size={20} />
          <span className="gw-rail-btn-label">{t('rail.settings')}</span>
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
          <span className="gw-rail-btn-label">{t('rail.signOut')}</span>
        </button>
      </nav>
    </>
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
