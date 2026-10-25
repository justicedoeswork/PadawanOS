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
    // justiceos-logo.png (a raster crop of the approved brand master) is
    // above Vite's inline threshold, so its own filename survives in the
    // resolved asset path.
    expect(markup).toMatch(/justiceos-logo[.\w-]*\.png/);
  });

  it('shows actionable live-data sections without claiming unloaded data is zero', () => {
    const markup = renderDashboard();
    for (const label of ['Business cash available', 'Forecast gross profit', 'Still to collect', 'Collected this month', 'Needs your attention', 'Available &amp; pending', 'Collections &amp; job costs', 'How current is this?']) expect(markup).toContain(label);
    expect(markup).toContain('Not available');
    expect(markup).not.toContain('$0');
    expect(markup).not.toContain('Nothing needs your attention right now');
  });
});
