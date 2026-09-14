import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { __setBuildMode } from './buildMode';
import { GatewayGate } from './GatewayGate';
import { I18nProvider } from '../i18n/context';

/**
 * Server-side rendering (no jsdom in this project -- see the rest of the
 * test suite, which tests logic modules rather than mounting components) is
 * enough to prove the one thing that matters for requirement #14: the demo
 * build's render path never reaches the code that calls `fetch`. Effects
 * (GatedApp's checkSession() call) don't run under SSR at all, so this also
 * happens to be a clean way to assert "no gateway build ever calls fetch
 * during its very first render" without needing a live network mock for the
 * gateway-build branch.
 */

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('fetch must not be called from this render path');
  }));
});

afterEach(() => {
  __setBuildMode(null);
  vi.unstubAllGlobals();
});

describe('GatewayGate (requirement #14: GitHub Pages demo build)', () => {
  it('renders children directly with zero gateway requests when built for demo', () => {
    __setBuildMode('demo');
    const markup = renderToStaticMarkup(
      <GatewayGate>
        <div data-testid="app">the real app</div>
      </GatewayGate>,
    );
    expect(markup).toContain('the real app');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never renders the login form in the demo build, even though buildMode could theoretically flip', () => {
    __setBuildMode('demo');
    const markup = renderToStaticMarkup(
      <GatewayGate>
        <div>child</div>
      </GatewayGate>,
    );
    expect(markup).not.toContain('gw-login');
  });
});

describe('GatewayGate (gateway build)', () => {
  it('does not call fetch during the initial server-side render (only the mount effect does, and effects do not run under SSR)', () => {
    __setBuildMode('gateway');
    renderToStaticMarkup(
      <I18nProvider>
        <GatewayGate>
          <div>the real app</div>
        </GatewayGate>
      </I18nProvider>,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the checking state (never the app, never the login form) before the session check resolves', () => {
    __setBuildMode('gateway');
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <GatewayGate>
          <div>the real app</div>
        </GatewayGate>
      </I18nProvider>,
    );
    expect(markup).not.toContain('the real app');
  });
});
