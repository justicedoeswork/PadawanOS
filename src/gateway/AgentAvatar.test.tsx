import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentAvatar } from './AgentAvatar';

describe('AgentAvatar (reusable wizard-themed agent-role icon system)', () => {
  it('renders the Insurance Audit Agent as an enchanted-scroll glyph, never the old shield', () => {
    const markup = renderToStaticMarkup(<AgentAvatar role="insurance-audit" />);
    // lucide's ShieldCheck path always starts with this exact command --
    // its absence is the real proof the shield is gone, not just that some
    // other svg also happens to render.
    expect(markup).not.toContain('M20 13c0 5');
    // The glyph's own checkmark path -- distinctive enough that its
    // presence is real proof the new icon rendered.
    expect(markup).toContain('M9.25 12.6 11 14.35 14.75 10.6');
  });

  it('is decorative -- aria-hidden, so the accessible name always comes from the surrounding control', () => {
    const markup = renderToStaticMarkup(<AgentAvatar role="insurance-audit" />);
    expect(markup).toMatch(/aria-hidden="true"/);
  });

  it('only uses the JusticeOS violet/cyan/moonlight/graphite palette -- no shield-style heraldic colors', () => {
    const markup = renderToStaticMarkup(<AgentAvatar role="insurance-audit" />);
    const hexColors = markup.match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(hexColors.length).toBeGreaterThan(0);
    for (const color of hexColors) {
      expect(['#FFF9ED', '#6C43F3', '#171B24', '#4FDCF7']).toContain(color.toUpperCase());
    }
  });

  it('respects a custom size', () => {
    const markup = renderToStaticMarkup(<AgentAvatar role="insurance-audit" size={32} />);
    expect(markup).toContain('width="32"');
    expect(markup).toContain('height="32"');
  });
});
