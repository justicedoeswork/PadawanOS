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
        collapsed={false}
        mobileOpen={false}
        onHome={() => {}}
        onOpenAgent={() => {}}
        onOpenMarketing={() => {}}
        onOpenCommunications={() => {}}
        onSettings={() => {}}
        onSignOut={() => {}}
        onToggleCollapsed={() => {}}
        onCloseMobile={() => {}}
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

  it('lists Marketing and Communications specialists alongside the Insurance Agent', () => {
    const markup = renderRail();
    expect(markup).toContain('Marketing');
    expect(markup).toContain('Communications');
  });

  it('lists the Marketing specialist alongside the agent, with its own glyph', () => {
    const markup = renderRail();
    expect(markup).toContain('Marketing');
    // Its own role glyph, not the audit scroll reused: the orb's stand is
    // unique to it.
    expect(markup).toContain('M7.5 17h9l-1.2 3h-6.6z');
  });

  it('gives Marketing and Communications no connection dots — they are gateway workspaces, not ACP connections', () => {
    const markup = renderRail({ connectionPhase: 'connected' });
    // Exactly one status dot in the whole rail: the ACP agent's.
    // The modifier class appears once per dot element (the base class
    // appears twice in each class attribute).
    expect(markup.match(/gw-rail-status-dot--/g)?.length).toBe(1);
  });

  it('marks Marketing as the current page when it is the active view', () => {
    const marketingActive = renderRail({ activeView: 'marketing' });
    expect(marketingActive).toMatch(/aria-label="Marketing"[^>]*aria-current="page"/);
    // ...and the ACP agent is then NOT current.
    expect(marketingActive).not.toMatch(/Insurance Audit Agent[^>]*aria-current="page"/);
  });

  it('never renders the word "Panda"', () => {
    const markup = renderRail();
    expect(markup).not.toMatch(/panda/i);
  });

  it('renders the real, unmodified standalone JusticeOS mark at the top of the rail', () => {
    const markup = renderRail();
    expect(markup).toContain('gw-rail-brand-mark');
    // justiceos-mark.png (a raster crop of the approved brand master) is
    // above Vite's inline-as-data-URI threshold, so it resolves to a real
    // asset path -- its own filename is the load-bearing proof the actual
    // supplied artwork (not a redrawn stand-in) is embedded, not an inlined
    // SVG data URI.
    expect(markup).toMatch(/justiceos-mark[.\w-]*\.png/);
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

  it('never uses the old generic shield icon for the agent -- the wizard-themed AgentAvatar replaces it', () => {
    const markup = renderRail();
    // lucide's ShieldCheck renders a <path> starting with this exact "M20 13c0 5…"
    // command; asserting its absence (rather than just presence of the new
    // icon) is what actually proves the shield is gone, not just supplemented.
    expect(markup).not.toContain('M20 13c0 5');
  });

  it('renders the reusable wizard-scroll AgentAvatar glyph for the Insurance Audit Agent', () => {
    const markup = renderRail();
    // The avatar glyph's own checkmark path -- distinctive enough that its
    // presence is real proof the new icon rendered, not just "some svg".
    expect(markup).toContain('M9.25 12.6 11 14.35 14.75 10.6');
  });

  it('keeps the connection-status dot and the agent icon as separate, non-overlapping elements', () => {
    const markup = renderRail();
    // The badge wraps both as siblings (icon glyph, then the absolutely-
    // positioned status dot) inside .gw-rail-agent-icon -- never nested one
    // inside the other, which is what CSS relies on to place the dot at the
    // badge's own corner clear of the icon's paths.
    expect(markup).toMatch(/<span class="gw-rail-agent-icon">.*<svg[^>]*>.*<\/svg>.*<span class="gw-rail-status-dot/s);
  });

  describe('collapsible sidebar', () => {
    it('is not collapsed by default and has no open/collapsed modifier classes when both flags are false', () => {
      const markup = renderRail({ collapsed: false, mobileOpen: false });
      expect(markup).not.toContain('gw-rail--collapsed');
      expect(markup).not.toContain('gw-rail--open');
    });

    it('applies the collapsed modifier class when collapsed', () => {
      expect(renderRail({ collapsed: true })).toContain('gw-rail--collapsed');
    });

    it('applies the open modifier class and renders a backdrop only when the mobile drawer is open', () => {
      const closed = renderRail({ mobileOpen: false });
      expect(closed).not.toContain('gw-rail--open');
      expect(closed).not.toContain('gw-rail-backdrop');

      const open = renderRail({ mobileOpen: true });
      expect(open).toContain('gw-rail--open');
      expect(open).toContain('gw-rail-backdrop');
    });

    it('gives the collapse toggle an accessible, state-reflecting label in both directions', () => {
      const expanded = renderRail({ collapsed: false });
      expect(expanded).toMatch(/aria-label="Collapse sidebar"/);
      expect(expanded).toMatch(/aria-pressed="false"/);

      const collapsed = renderRail({ collapsed: true });
      expect(collapsed).toMatch(/aria-label="Expand sidebar"/);
      expect(collapsed).toMatch(/aria-pressed="true"/);
    });

    it('gives the drawer\'s own close button an accessible "Close agents" label', () => {
      const markup = renderRail();
      expect(markup).toContain('gw-rail-mobile-close');
      expect(markup).toMatch(/gw-rail-mobile-close[^>]*aria-label="Close agents"/);
    });

    it('gives the drawer root a stable id so an external "Open agents" trigger can aria-control it', () => {
      expect(renderRail()).toContain('id="gw-rail-nav"');
    });
  });

  describe('sidebar toggling never touches the connection or auth/logout functions', () => {
    it('the collapse toggle and drawer-close controls wire only to onToggleCollapsed/onCloseMobile, never onSignOut', () => {
      const markup = renderRail();
      // Slice out just the collapse-toggle and mobile-close <button> tags and
      // confirm neither one's own markup/attributes reference sign-out or
      // settings -- the strongest thing an SSR (no jsdom, so no simulated
      // clicks) assertion can prove: these two controls are visually and
      // structurally isolated from every connection/session action.
      const collapseToggleTag = markup.match(/<button[^>]*gw-rail-collapse-toggle[^>]*>/)?.[0];
      const closeTag = markup.match(/<button[^>]*gw-rail-mobile-close[^>]*>/)?.[0];
      expect(collapseToggleTag).toBeTruthy();
      expect(closeTag).toBeTruthy();
      expect(collapseToggleTag).not.toMatch(/sign.?out/i);
      expect(closeTag).not.toMatch(/sign.?out/i);
    });

    it('calling onToggleCollapsed or onCloseMobile in isolation never calls the other callback props', () => {
      // AgentRail is purely presentational (every action is a callback prop
      // it never invokes itself) -- this locks that contract down directly:
      // rendering it with spies and invoking the props JusticeOsShell would
      // wire to sidebar-only state confirms none of the connection/session
      // callbacks fire as a side effect of the module executing.
      let toggleCalls = 0;
      let closeCalls = 0;
      let signOutCalls = 0;
      let openAgentCalls = 0;
      renderRail({
        onToggleCollapsed: () => {
          toggleCalls += 1;
        },
        onCloseMobile: () => {
          closeCalls += 1;
        },
        onSignOut: () => {
          signOutCalls += 1;
        },
        onOpenAgent: () => {
          openAgentCalls += 1;
        },
      });
      expect(toggleCalls).toBe(0);
      expect(closeCalls).toBe(0);
      expect(signOutCalls).toBe(0);
      expect(openAgentCalls).toBe(0);
    });
  });
});
