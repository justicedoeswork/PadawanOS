import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import type { ConnectionLifecycle } from '../projector/connectionLifecycle';
import { Dashboard, dashboardAgentStatusKey, dashboardAttentionKeys, dashboardInProgressKeys } from './Dashboard';

function renderDashboard() {
  return renderToStaticMarkup(
    <I18nProvider>
      <Dashboard />
    </I18nProvider>,
  );
}

function lifecycle(overrides: Partial<ConnectionLifecycle> = {}): ConnectionLifecycle {
  return { phase: 'connected', error: null, running: false, busy: false, attention: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Pure logic (ADR 0006: meaning here, pixels in the component). Tested
// directly against constructed ConnectionLifecycle values, NOT through a
// rendered, zustand-seeded component: zustand/react.js's useSyncExternalStore
// binding calls getServerSnapshot() -> getInitialState() while rendering via
// renderToStaticMarkup, so a setState() made before such a render is never
// visible to it -- the same limitation GatewayGate.test.tsx's own header
// comment already documents for this project's SSR-only (no jsdom) tests.
// ---------------------------------------------------------------------------

describe('dashboardAgentStatusKey', () => {
  it('is disconnected when there is no connection slot at all', () => {
    expect(dashboardAgentStatusKey(null)).toBe('conn.disconnected');
  });

  it('is connected for every "link up" phase', () => {
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'connected' }))).toBe('conn.connected');
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'connected-degraded' }))).toBe('conn.connected');
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'switching-session' }))).toBe('conn.connected');
  });

  it('is connecting while the link is being established', () => {
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'connecting' }))).toBe('status.connecting');
  });

  it('is error / auth-required / disconnected for the remaining phases', () => {
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'error' }))).toBe('conn.error');
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'auth-required' }))).toBe('conn.authRequired');
    expect(dashboardAgentStatusKey(lifecycle({ phase: 'disconnected' }))).toBe('conn.disconnected');
  });
});

describe('dashboardAttentionKeys', () => {
  it('is empty when nothing needs attention -- never a fabricated reason', () => {
    expect(dashboardAttentionKeys(null)).toEqual([]);
    expect(dashboardAttentionKeys(lifecycle({ attention: [] }))).toEqual([]);
  });

  it('surfaces exactly the real reasons the lifecycle reports, in order', () => {
    expect(dashboardAttentionKeys(lifecycle({ attention: ['unread-completion'] }))).toEqual([
      'dashboard.attention.unreadCompletion',
    ]);
    expect(dashboardAttentionKeys(lifecycle({ attention: ['pending-permission', 'connection-error'] }))).toEqual([
      'dashboard.attention.pendingPermission',
      'dashboard.attention.connectionError',
    ]);
  });
});

describe('dashboardInProgressKeys', () => {
  it('is empty when nothing is running', () => {
    expect(dashboardInProgressKeys(null)).toEqual([]);
    expect(dashboardInProgressKeys(lifecycle({ running: false }))).toEqual([]);
  });

  it('reports the one real "in progress" item when the connection is mid-turn', () => {
    expect(dashboardInProgressKeys(lifecycle({ running: true }))).toEqual(['dashboard.inProgress.running']);
  });
});

// ---------------------------------------------------------------------------
// Rendered markup: reliable under SSR for the store's actual INITIAL state
// (no connections yet) -- exactly what a fresh dashboard mount shows before
// the managed agent supervisor's first status update arrives.
// ---------------------------------------------------------------------------

describe('Dashboard (JusticeOS home screen, LAYOUT #2)', () => {
  it('renders the JusticeOS heading and a device-local-time greeting', () => {
    const markup = renderDashboard();
    expect(markup).toContain('JusticeOS');
    expect(markup).toMatch(/Good (morning|afternoon|evening)/);
  });

  it('uses the real, unmodified JusticeOS wordmark for the heading, not plain text', () => {
    const markup = renderDashboard();
    expect(markup).toContain('gw-dashboard-logo');
    expect(markup).toMatch(/justiceos-logo-primary/);
  });

  it('renders a Justice Manager briefing card that never claims to have real content', () => {
    const markup = renderDashboard();
    expect(markup).toContain('Justice Manager briefing');
    expect(markup).toMatch(/will appear here once/i);
  });

  it('never renders an agent card, avatar, or launch control in the dashboard content -- agent navigation lives only in the sidebar', () => {
    const markup = renderDashboard();
    expect(markup).not.toContain('gw-dashboard-agent-card');
    expect(markup).not.toContain('gw-dashboard-agent-icon');
    expect(markup).not.toContain('gw-dashboard-agent-cta');
    expect(markup).not.toMatch(/open chat/i);
  });

  it('shows honest, unfabricated empty states for every card before any connection exists', () => {
    const markup = renderDashboard();
    expect(markup).toContain('Nothing needs your attention right now.');
    expect(markup).toContain('Nothing is in progress right now.');
    expect(markup).toContain('No completed work has been reported yet.');
    expect(markup).toContain('Nothing has failed or is blocked right now.');
    expect(markup).toContain('No findings have been reported yet.');
    expect(markup).toContain('No documents or reports have been produced yet.');
    expect(markup).toContain('Nothing scheduled yet.');
  });

  it('never renders a hardcoded list item, nor any fabricated count/number, in a card with no real data source', () => {
    const markup = renderDashboard();
    // Before any connection exists, EVERY card is empty -- so no card's
    // list markup should render at all, and no digit should appear in any
    // of the cards' VISIBLE text (a stray "3 findings" or "$12,400" would
    // be a fabricated figure with no backing data source). Tag names
    // (e.g. <h3>) legitimately contain digits, so this strips markup down
    // to text content first rather than scanning raw HTML.
    expect(markup).not.toContain('gw-dashboard-card-list');
    const gridMarkup = markup.slice(markup.indexOf('gw-dashboard-grid'));
    const visibleText = gridMarkup.replace(/<[^>]*>/g, ' ');
    expect(visibleText).not.toMatch(/[0-9]/);
  });

  it('covers every category the operational overview is required to prioritize', () => {
    const markup = renderDashboard();
    expect(markup).toContain('Needs your attention');
    expect(markup).toContain('In progress');
    expect(markup).toContain('Recently completed');
    expect(markup).toContain('Failed or blocked');
    expect(markup).toContain('Audit &amp; compliance findings');
    expect(markup).toContain('Recent documents &amp; reports');
    expect(markup).toContain('Upcoming deadlines &amp; follow-ups');
  });
});
