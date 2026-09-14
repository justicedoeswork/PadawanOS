import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyJusticeOsHtmlBranding } from '../../vite.config';

/**
 * Confirms the production (gateway) build's visible browser title and
 * installable-web-app metadata say JusticeOS -- not Panda, not
 * PadawanOS, and not Justice Exteriors -- while the exact same
 * transform, applied to the exact same source index.html, is what a
 * real `pnpm build:gateway` run produces (verified manually against
 * the actual built dist/index.html; this test exercises the same pure
 * function without needing a full Vite build).
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const sourceHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');

describe('applyJusticeOsHtmlBranding (gateway build HTML)', () => {
  const gatewayHtml = applyJusticeOsHtmlBranding(sourceHtml);

  it('sets the browser title to exactly "JusticeOS"', () => {
    expect(gatewayHtml).toMatch(/<title>JusticeOS<\/title>/);
  });

  it('sets application-name and apple-mobile-web-app-title to JusticeOS', () => {
    expect(gatewayHtml).toMatch(/<meta name="application-name" content="JusticeOS" \/>/);
    expect(gatewayHtml).toMatch(/<meta name="apple-mobile-web-app-title" content="JusticeOS" \/>/);
  });

  it('sets og:title to JusticeOS', () => {
    expect(gatewayHtml).toMatch(/<meta property="og:title" content="JusticeOS" \/>/);
  });

  it('mentions the Insurance Audit Agent in its description, not the old "no accounts" claim (which is false for a login-gated app)', () => {
    expect(gatewayHtml).toMatch(/Insurance Audit Agent/);
    expect(gatewayHtml).not.toMatch(/no accounts/i);
  });

  it('drops the public demo site\'s og:url and og:image rather than pointing a private deployment at them', () => {
    expect(gatewayHtml).not.toMatch(/lukaisluka\.github\.io/);
  });

  it('contains no Panda, PadawanOS, or Justice Exteriors product-name branding anywhere', () => {
    expect(gatewayHtml).not.toMatch(/\bPanda\b/);
    expect(gatewayHtml).not.toMatch(/PadawanOS/i);
    expect(gatewayHtml).not.toMatch(/justice[-\s]?exteriors/i);
  });

  it('is well-formed HTML: still exactly one <title> element and a <div id="root">', () => {
    expect(gatewayHtml.match(/<title>/g)).toHaveLength(1);
    expect(gatewayHtml).toMatch(/<div id="root">/);
  });
});

describe('applyJusticeOsHtmlBranding leaves the demo build alone', () => {
  it('the source index.html itself (what the demo build ships unmodified) still says Panda -- proving this function is opt-in, not a global rewrite', () => {
    expect(sourceHtml).toMatch(/<title>Panda — ACP Client<\/title>/);
  });
});

describe('applyJusticeOsHtmlBranding fails loudly rather than silently no-op-ing', () => {
  it('throws if index.html no longer contains the expected Panda title markup', () => {
    const changedHtml = sourceHtml.replace('<title>Panda — ACP Client</title>', '<title>Something else entirely</title>');
    expect(() => applyJusticeOsHtmlBranding(changedHtml)).toThrow(/expected index\.html to contain/);
  });
});
