import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { __setBuildMode } from './buildMode';
import { JusticeOsShell } from './JusticeOsShell';
import { I18nProvider } from '../i18n/context';
import { usePanda } from '../store';

beforeEach(() => {
  usePanda.setState({
    mode: 'live',
    connections: {},
    activeConnectionId: null,
    activeSessionId: null,
    selectionGeneration: 0,
  });
});

afterEach(() => {
  __setBuildMode(null);
  usePanda.setState({ connections: {} });
});

describe('JusticeOsShell (demo build): a complete no-op, same contract as GatewayGate', () => {
  it('renders children directly, byte-for-byte identical to rendering them with no wrapper at all', () => {
    __setBuildMode('demo');
    const wrapped = renderToStaticMarkup(
      <JusticeOsShell>
        <div data-testid="app">the real app</div>
      </JusticeOsShell>,
    );
    const bare = renderToStaticMarkup(<div data-testid="app">the real app</div>);
    expect(wrapped).toBe(bare);
  });

  it('never renders the rail or dashboard in the demo build', () => {
    __setBuildMode('demo');
    const markup = renderToStaticMarkup(
      <JusticeOsShell>
        <div>the real app</div>
      </JusticeOsShell>,
    );
    expect(markup).not.toContain('gw-rail');
    expect(markup).not.toContain('gw-dashboard');
  });
});

describe('JusticeOsShell (gateway build): JusticeOS dashboard + rail', () => {
  it('shows the dashboard (not the wrapped app) by default, alongside the always-visible rail', () => {
    __setBuildMode('gateway');
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <JusticeOsShell>
          <div>the real app</div>
        </JusticeOsShell>
      </I18nProvider>,
    );
    expect(markup).toContain('gw-rail');
    expect(markup).toContain('gw-dashboard');
    expect(markup).toContain('JusticeOS');
    expect(markup).not.toContain('the real app');
  });

  it('renders the floating Justice Manager button on the dashboard', () => {
    __setBuildMode('gateway');
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <JusticeOsShell>
          <div>the real app</div>
        </JusticeOsShell>
      </I18nProvider>,
    );
    expect(markup).toContain('gw-manager-fab');
  });

  it('never renders "Panda" (visible text) or an Add agent control anywhere in the shell', () => {
    __setBuildMode('gateway');
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <JusticeOsShell>
          <div>the real app</div>
        </JusticeOsShell>
      </I18nProvider>,
    );
    // Strip src/href/alt attribute values before checking -- this scan is
    // about visible TEXT, not asset URLs (defensive: no asset path should
    // trip it either way now that the Justice Manager avatar is the
    // JusticeOS mark, not the old panda-badge.png).
    const visibleText = markup.replace(/\s(src|href|alt)="[^"]*"/gi, '');
    expect(visibleText).not.toMatch(/\bpanda\b/i);
    expect(markup).not.toMatch(/add agent/i);
  });

  it('renders a mobile "Open agents" trigger, and the sidebar starts neither collapsed nor open (Node/SSR has no localStorage, so the desktop preference reads its false default; the mobile drawer is never persisted and always starts closed)', () => {
    __setBuildMode('gateway');
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <JusticeOsShell>
          <div>the real app</div>
        </JusticeOsShell>
      </I18nProvider>,
    );
    expect(markup).toMatch(/aria-label="Open agents"/);
    expect(markup).not.toContain('gw-rail--collapsed');
    expect(markup).not.toContain('gw-rail--open');
    expect(markup).not.toContain('gw-rail-backdrop');
  });

  it('never renders the old shield icon for the agent anywhere in the shell', () => {
    __setBuildMode('gateway');
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <JusticeOsShell>
          <div>the real app</div>
        </JusticeOsShell>
      </I18nProvider>,
    );
    expect(markup).not.toContain('M20 13c0 5');
  });
});
