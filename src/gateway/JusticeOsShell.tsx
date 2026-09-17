import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { isGatewayBuild } from './buildMode';
import { usePanda } from '../store';
import { connectionLifecycle } from '../projector/connectionLifecycle';
import { MANAGED_INSURANCE_PROFILE_ID } from './managedAgentId';
import { AgentRail, type RailView } from './AgentRail';
import { Dashboard } from './Dashboard';
import { ManagerChat } from './ManagerChat';
import { useGatewayAuth } from './gatewayAuthStore';
import { loadSidebarCollapsed, saveSidebarCollapsed } from './sidebarPreference';
import { navigate, useHashRoute } from '../routes';
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
 * In the gateway build this owns the JusticeOS dashboard-vs-workspace
 * toggle (LAYOUT) plus the collapsible agent sidebar's state: the always-present
 * AgentRail (collapsed/expanded on desktop, an off-canvas drawer on
 * mobile) beside either the Dashboard home screen or `children` (the
 * real, untouched App -- same component, same store, same connection;
 * nothing about the chat itself changes). `children` unmounting while the
 * dashboard shows, or the sidebar opening/closing/collapsing, does NOT
 * touch the connection: the managed agent's WebSocket lives in
 * liveConnections.ts module state and managedAgent.ts's supervisor (a
 * zustand subscription), neither owned by App's or AgentRail's own
 * component lifecycle -- switching views or toggling the sidebar here
 * never disconnects, reconnects, signs out, or loses the session (the
 * state added below is local UI state and a localStorage preference read/
 * write only).
 */
export function JusticeOsShell({ children }: { children: ReactNode }) {
  if (!isGatewayBuild()) return <>{children}</>;
  return <GatewayDashboardShell>{children}</GatewayDashboardShell>;
}

function GatewayDashboardShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  // Which workspace `children` is currently showing comes from the hash
  // route, not from a second copy of that state here: App renders the
  // Marketing workspace for #/marketing, so the rail reads the same source
  // of truth rather than one that could drift from it.
  const route = useHashRoute();
  // A hash route that names a workspace (#/marketing, #/settings) has to
  // survive a reload or a pasted link: opening on the dashboard instead
  // would silently ignore the URL the person actually asked for. Every
  // other route starts on the dashboard, as before.
  const [view, setView] = useState<RailView>(() => (route === 'marketing' || route === 'settings' ? 'agent' : 'dashboard'));
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => loadSidebarCollapsed());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const railNavRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  const slot = usePanda((s) => s.connections[MANAGED_INSURANCE_PROFILE_ID]);
  const lifecycle = slot ? connectionLifecycle(slot) : null;
  const agentName = slot?.connection.agentName || t('dashboard.agentCard.title');
  const signOutBusy = useGatewayAuth((s) => s.busy);

  const closeMobileNav = () => setMobileNavOpen(false);

  // Mobile drawer a11y: move focus into it on open, return focus to the
  // trigger on close, close on Escape, and lock body scroll so the column
  // behind the drawer/backdrop can't be scrolled while it's open. This is
  // local UI state/DOM plumbing only -- it never calls onSignOut or
  // touches the connection store.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    railNavRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMobileNav();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      mobileTriggerRef.current?.focus();
    };
  }, [mobileNavOpen]);

  function toggleSidebarCollapsed() {
    const next = !sidebarCollapsed;
    setSidebarCollapsedState(next);
    saveSidebarCollapsed(next);
  }

  function goHome() {
    setView('dashboard');
    closeMobileNav();
  }

  /** Hands the content column back to `children` (App), whatever hash route it is on. */
  function showWorkspace() {
    setView('agent');
    closeMobileNav();
  }

  function openAgent() {
    // Leaves whatever hash workspace was showing (e.g. #/marketing) so the
    // agent button always lands on the chat it names. Settings deliberately
    // does NOT go through here: it sets its own route, and routing it
    // through this would immediately navigate away from it again.
    if (route === 'marketing') navigate('main');
    showWorkspace();
  }

  function openMarketing() {
    navigate('marketing');
    showWorkspace();
  }

  // The rail highlights the Marketing specialist whenever the content
  // column is showing its workspace; 'agent' otherwise.
  const railView: RailView = view === 'agent' && route === 'marketing' ? 'marketing' : view;

  return (
    <div className="gw-shell">
      <AgentRail
        activeView={railView}
        agentName={agentName}
        connectionPhase={lifecycle?.phase ?? 'disconnected'}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onHome={goHome}
        onOpenAgent={openAgent}
        onOpenMarketing={openMarketing}
        onSettings={() => {
          navigate('settings');
          showWorkspace();
        }}
        onSignOut={() => void useGatewayAuth.getState().logout()}
        onToggleCollapsed={toggleSidebarCollapsed}
        onCloseMobile={closeMobileNav}
        signOutBusy={signOutBusy}
        navRef={railNavRef}
      />
      <div className="gw-shell-main">
        <div className="gw-mobile-topbar">
          <button
            ref={mobileTriggerRef}
            type="button"
            className="gw-mobile-topbar-trigger"
            aria-label={t('rail.openAgents')}
            aria-expanded={mobileNavOpen}
            aria-controls="gw-rail-nav"
            aria-hidden={mobileNavOpen}
            tabIndex={mobileNavOpen ? -1 : 0}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} />
          </button>
        </div>
        {view === 'dashboard' ? <Dashboard /> : children}
      </div>
      {view === 'dashboard' && <ManagerChat />}
    </div>
  );
}
