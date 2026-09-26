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

  it('stamps [data-justiceos-theme] on <html> -- the dark-mode override’s scoping hook (index.css)', () => {
    expect(gatewayHtml).toMatch(/<html lang="en" data-justiceos-theme="true">/);
  });

  it('installs the supplied favicon, apple-touch-icon, and manifest from /justiceos/, not the demo build’s own icons', () => {
    expect(gatewayHtml).toMatch(/<link rel="icon" href="\/justiceos\/favicon\.ico" sizes="any" \/>/);
    expect(gatewayHtml).toMatch(/<link rel="icon" type="image\/png" sizes="32x32" href="\/justiceos\/favicon-32\.png" \/>/);
    expect(gatewayHtml).toMatch(/<link rel="apple-touch-icon" href="\/justiceos\/apple-touch-icon\.png" \/>/);
    expect(gatewayHtml).toMatch(/<link rel="manifest" href="\/justiceos\/manifest\.webmanifest" \/>/);
    expect(gatewayHtml).not.toMatch(/href="\/favicon\.png"/);
    expect(gatewayHtml).not.toMatch(/href="\/apple-touch-icon\.png"/);
  });

  it('sets theme-color to the brand’s graphite background', () => {
    expect(gatewayHtml).toMatch(/<meta name="theme-color" content="#11151D" \/>/);
  });
});

describe('applyJusticeOsHtmlBranding leaves the demo build alone', () => {
  it('the source index.html itself (what the demo build ships unmodified) still says Panda -- proving this function is opt-in, not a global rewrite', () => {
    expect(sourceHtml).toMatch(/<title>Panda — ACP Client<\/title>/);
  });

  it('the source index.html keeps its own favicon/apple-touch-icon and carries no [data-justiceos-theme] or JusticeOS icon paths', () => {
    expect(sourceHtml).toMatch(/<link rel="icon" type="image\/png" href="\/favicon\.png" \/>/);
    expect(sourceHtml).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);
    expect(sourceHtml).not.toMatch(/data-justiceos-theme/);
    expect(sourceHtml).not.toMatch(/\/justiceos\//);
  });
});

describe('the gateway PWA manifest (public/justiceos/manifest.webmanifest)', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'public/justiceos/manifest.webmanifest'), 'utf8'),
  ) as {
    name: string;
    short_name: string;
    background_color: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };

  it('identifies the installed app as JusticeOS', () => {
    expect(manifest.name).toBe('JusticeOS');
    expect(manifest.short_name).toBe('JusticeOS');
  });

  it('uses the brand’s graphite for both background and theme color', () => {
    expect(manifest.background_color).toBe('#11151D');
    expect(manifest.theme_color).toBe('#11151D');
  });

  it('references the supplied 192/512/maskable icons, and every referenced file actually exists', () => {
    const srcs = manifest.icons.map((icon) => icon.src);
    expect(srcs).toContain('/justiceos/icon-192.png');
    expect(srcs).toContain('/justiceos/icon-512.png');
    expect(srcs).toContain('/justiceos/icon-maskable-512.png');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const onDisk = path.join(REPO_ROOT, 'public', icon.src.replace(/^\//, ''));
      expect(fs.existsSync(onDisk), `expected ${icon.src} to exist on disk`).toBe(true);
    }
  });
});

describe('applyJusticeOsHtmlBranding fails loudly rather than silently no-op-ing', () => {
  it('produces the same JusticeOS branding from Windows CRLF source HTML', () => {
    const crlfHtml = sourceHtml.replace(/\r?\n/g, '\r\n');
    const branded = applyJusticeOsHtmlBranding(crlfHtml);
    expect(branded).toMatch(/<title>JusticeOS<\/title>/);
    expect(branded).toMatch(/\/justiceos\/favicon\.ico/);
    expect(branded).not.toMatch(/href="\/favicon\.png"/);
  });

  it('throws if index.html no longer contains the expected Panda title markup', () => {
    const changedHtml = sourceHtml.replace('<title>Panda — ACP Client</title>', '<title>Something else entirely</title>');
    expect(() => applyJusticeOsHtmlBranding(changedHtml)).toThrow(/expected index\.html to contain/);
  });
});
