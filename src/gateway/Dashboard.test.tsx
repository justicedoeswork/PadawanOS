import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import type { ConnectionLifecycle } from '../projector/connectionLifecycle';
import { Dashboard, dashboardAgentStatusKey, dashboardAttentionKeys, dashboardInProgressKeys } from './Dashboard';

function renderDashboard() {
  return renderToStaticMarkup(
    <I18nProvider>
      <Dashboard onOpenAgent={() => {}} />
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

  it('shows honest empty states for all four cards and "not connected" before any connection exists', () => {
    const markup = renderDashboard();
    expect(markup).toContain('Nothing needs your attention right now.');
    expect(markup).toContain('Nothing is in progress right now.');
    expect(markup).toContain('Your work queue is empty.');
    expect(markup).toContain('Nothing scheduled yet.');
    expect(markup).toContain('Insurance Audit Agent');
    expect(markup).toMatch(/Not connected/);
  });

  it('never renders a hardcoded item for Work queue / Upcoming -- both are always passed an empty list', () => {
    const markup = renderDashboard();
    expect(markup).not.toContain('gw-dashboard-card-list');
  });
});
