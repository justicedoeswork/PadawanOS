import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import { ManagerChat } from './ManagerChat';

function render() {
  return renderToStaticMarkup(
    <I18nProvider>
      <ManagerChat />
    </I18nProvider>,
  );
}

describe('ManagerChat (floating Justice Manager button, LAYOUT #3)', () => {
  it('renders a tappable floating button labeled for opening Justice Manager chat', () => {
    const markup = render();
    expect(markup).toContain('gw-manager-fab');
    expect(markup).toMatch(/aria-label="Chat with your Justice Manager"/);
  });

  it('does not render the panel until opened (closed by default)', () => {
    const markup = render();
    expect(markup).not.toContain('gw-manager-panel"');
    expect(markup).not.toContain('gw-mgr-input');
  });

  /**
   * The panel is now Padawan's marketing surface rather than a placeholder, so
   * the claim it must never make is the opposite of the old one: it must not
   * say it is disconnected, and it must not put an approval control on screen
   * before an answer has earned one. Both are asserted on the closed/initial
   * render, which is all `renderToStaticMarkup` can reach (see
   * GatewayGate.test.tsx's header comment on why this project does not seed a
   * store and re-render).
   */
  it('no longer claims the manager is unconnected', () => {
    expect(render()).not.toContain('is not connected yet');
  });

  it('renders no approve/reject control before any answer has asked for one', () => {
    const markup = render();
    expect(markup).not.toContain('gw-mgr-decision');
    expect(markup).not.toMatch(/>Approve</);
  });

  it('never calls itself "Panda" anywhere in its own visible text', () => {
    const markup = render();
    const visibleText = markup.replace(/\s(src|href|alt)="[^"]*"/gi, '');
    expect(visibleText).not.toMatch(/\bpanda\b/i);
  });

  it('uses the real, unmodified JusticeOS mark as the avatar, not the old panda mascot image', () => {
    const markup = render();
    // justiceos-mark.png (a raster crop of the approved brand master) is
    // above Vite's inline-as-data-URI threshold, so its own filename
    // survives in the resolved asset path -- proof the real supplied
    // artwork, not a redrawn/regenerated stand-in, is what's embedded.
    expect(markup).toMatch(/justiceos-mark[.\w-]*\.png/);
    expect(markup).not.toMatch(/panda-badge/);
  });
});
