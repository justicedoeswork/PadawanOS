import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import { GatewayConnectingState } from './GatewayConnectingState';

describe('GatewayConnectingState (replaces EmptyState onboarding in the gateway build)', () => {
  it('renders an honest connecting status, never the demo/connect-your-own-agent onboarding copy', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <GatewayConnectingState />
      </I18nProvider>,
    );
    expect(markup).toMatch(/Connecting/i);
    expect(markup).not.toMatch(/watch a demo/i);
    expect(markup).not.toMatch(/connect your agent/i);
    expect(markup).not.toMatch(/quickstart/i);
    expect(markup).not.toMatch(/github\.com/i);
  });

  it('shows the real, unmodified JusticeOS mark in this loading state', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <GatewayConnectingState />
      </I18nProvider>,
    );
    expect(markup).toContain('gw-connecting-mark');
    // justiceos-mark.png is above Vite's inline threshold, so its own
    // filename survives in the resolved asset path.
    expect(markup).toMatch(/justiceos-mark[.\w-]*\.png/);
  });
});
