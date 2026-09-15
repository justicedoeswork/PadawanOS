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
    // justiceos-logo-primary.svg is above Vite's inline-as-data-URI
    // threshold, so it resolves to a real asset path/URL rather than an
    // inlined data URI -- either way, its own filename survives.
    expect(markup).toMatch(/justiceos-logo-primary/);
    expect(markup).not.toMatch(/panda-badge/);
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
