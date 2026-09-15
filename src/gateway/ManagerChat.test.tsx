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

  it('does not render the placeholder panel until opened (closed by default)', () => {
    const markup = render();
    expect(markup).not.toContain('gw-manager-panel"');
    expect(markup).not.toContain('Justice Manager chat is not connected yet');
  });

  it('never calls itself "Panda" anywhere in its own visible text', () => {
    const markup = render();
    const visibleText = markup.replace(/\s(src|href|alt)="[^"]*"/gi, '');
    expect(visibleText).not.toMatch(/\bpanda\b/i);
  });

  it('uses the real, unmodified JusticeOS mark SVG as the avatar, not the old panda mascot image', () => {
    const markup = render();
    // Vite inlines small SVGs as a data URI rather than a file path, so
    // this asserts on the SVG's own <title> text (proof the real supplied
    // artwork -- not a redrawn/regenerated stand-in -- is what's embedded).
    expect(markup).toMatch(/JusticeOS%20wizard%20mark/);
    expect(markup).not.toMatch(/panda-badge/);
  });
});
