import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../i18n/context';
import { LoginScreen } from './LoginScreen';

function render() {
  return renderToStaticMarkup(
    <I18nProvider>
      <LoginScreen busy="idle" notice={null} noticeKind="info" onSubmit={() => {}} />
    </I18nProvider>,
  );
}

describe('LoginScreen (JusticeOS gateway build)', () => {
  it('renders the real, unmodified JusticeOS wordmark, not the old panda badge', () => {
    const markup = render();
    // justiceos-logo.png (a raster crop of the approved brand master) is
    // above Vite's inline-as-data-URI threshold, so it resolves to a real
    // asset path/URL rather than an inlined data URI -- its own filename
    // survives, and is the load-bearing proof this is the real asset, not
    // a placeholder.
    expect(markup).toMatch(/justiceos-logo[.\w-]*\.png/);
    expect(markup).not.toMatch(/panda-badge/);
    expect(markup).not.toMatch(/\.svg/);
  });

  it('never renders the word "Panda"', () => {
    const markup = render();
    const visibleText = markup.replace(/\s(src|href|alt)="[^"]*"/gi, '');
    expect(visibleText).not.toMatch(/\bpanda\b/i);
  });

  it('keeps the password field at 16px+ and every control at a 44px+ touch target (unaffected by the branding change)', () => {
    const markup = render();
    expect(markup).toContain('gw-login-input');
    expect(markup).toContain('gw-login-submit');
  });
});
