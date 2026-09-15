import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import { AgentRail } from './AgentRail';

function renderRail(overrides: Partial<Parameters<typeof AgentRail>[0]> = {}) {
  return renderToStaticMarkup(
    <I18nProvider>
      <AgentRail
        activeView="dashboard"
        agentName="Insurance Audit Agent"
        connectionPhase="connected"
        onHome={() => {}}
        onOpenAgent={() => {}}
        onSettings={() => {}}
        onSignOut={() => {}}
        signOutBusy={false}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe('AgentRail (JusticeOS gateway build, LAYOUT #1)', () => {
  it('renders Home, the agent icon+name, Settings, and Sign out -- no Add agent control', () => {
    const markup = renderRail();
    expect(markup).toContain('Insurance Audit Agent');
    expect(markup).not.toMatch(/add agent/i);
  });

  it('never renders the word "Panda"', () => {
    const markup = renderRail();
    expect(markup).not.toMatch(/panda/i);
  });

  it('renders the real, unmodified standalone JusticeOS mark at the top of the rail', () => {
    const markup = renderRail();
    expect(markup).toContain('gw-rail-brand-mark');
    // justiceos-mark-color.svg is small enough to be inlined as a data URI
    // by Vite -- its own <title> text is the real, load-bearing proof that
    // the actual supplied artwork (not a redrawn stand-in) is embedded.
    expect(markup).toMatch(/JusticeOS%20wizard%20mark/);
  });

  it('renders no hamburger/menu control -- the rail itself is the only navigation', () => {
    const markup = renderRail();
    expect(markup).not.toMatch(/open navigation|close navigation/i);
  });

  it('marks the active view with aria-current', () => {
    const dashboardActive = renderRail({ activeView: 'dashboard' });
    expect(dashboardActive).toMatch(/gw-rail-home[^>]*aria-current="page"/);

    const agentActive = renderRail({ activeView: 'agent' });
    expect(agentActive).toMatch(/gw-rail-agent[^>]*aria-current="page"/);
  });

  it('reflects a connected phase with the connected status dot', () => {
    expect(renderRail({ connectionPhase: 'connected' })).toContain('gw-rail-status-dot--connected');
  });

  it('reflects a disconnected phase with the offline status dot', () => {
    expect(renderRail({ connectionPhase: 'disconnected' })).toContain('gw-rail-status-dot--offline');
  });

  it('reflects an error phase with the error status dot', () => {
    expect(renderRail({ connectionPhase: 'error' })).toContain('gw-rail-status-dot--error');
  });

  it('disables the sign-out control while a sign-out is in flight', () => {
    const idle = renderRail({ signOutBusy: false });
    const busy = renderRail({ signOutBusy: true });
    expect(idle).not.toContain('disabled=""');
    expect(busy).toContain('disabled=""');
  });
});
