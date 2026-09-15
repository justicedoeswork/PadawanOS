import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The JusticeOS logo was replaced with derivatives produced directly from
 * an approved raster master (a supplied brand image) -- the earlier hand-
 * authored SVG vector paths were REJECTED for not matching it and are
 * gone. This is a raster-pipeline equivalent of the old logoCentering.test.ts
 * / wizardGeometry.test.ts (both deleted -- they asserted on specific SVG
 * `d` path strings and viewBox values that no longer exist anywhere in
 * this codebase).
 *
 * What's checked here: the canonical source chain exists and is
 * internally consistent (one master, two derived-from-it PNGs, every
 * component importing those and nothing else), the rejected SVGs are
 * actually gone (not just unused), and no file anywhere claims raster
 * artwork is a vector.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function readPngDimensions(relPath: string): { width: number; height: number } {
  const buf = fs.readFileSync(path.join(REPO_ROOT, relPath));
  expect(buf.subarray(0, 8).toString('hex'), `${relPath} should start with the PNG signature`).toBe(
    '89504e470d0a1a0a',
  );
  // IHDR is always the first chunk: 8-byte signature, 4-byte length,
  // 4-byte "IHDR", then 4-byte width + 4-byte height (big-endian).
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

describe('JusticeOS logo: canonical raster master and its derivatives', () => {
  it('the approved master image is present, untouched, and not itself imported by any component', () => {
    const masterPath = 'src/assets/brand/master/justiceos-logo-master.png';
    expect(fs.existsSync(path.join(REPO_ROOT, masterPath)), 'expected the approved master to be preserved for provenance').toBe(
      true,
    );
    const dims = readPngDimensions(masterPath);
    expect(dims).toEqual({ width: 1942, height: 809 });

    // Kept as a reference/audit artifact only -- every gateway component
    // imports the derived justiceos-mark.png / justiceos-logo.png below,
    // never this file directly.
    const gatewaySrc = fs.readdirSync(path.join(REPO_ROOT, 'src/gateway'));
    for (const file of gatewaySrc) {
      if (!file.endsWith('.tsx')) continue;
      const content = fs.readFileSync(path.join(REPO_ROOT, 'src/gateway', file), 'utf8');
      expect(content, `${file} should not import the master directly`).not.toMatch(/brand\/master\//);
    }
  });

  it('the two canonical derived PNGs exist with the expected aspect ratios', () => {
    const mark = readPngDimensions('src/assets/brand/justiceos-mark.png');
    // Standalone mark: square canvas (matches every fixed-square CSS
    // placement -- sidebar rail, connecting state, manager FAB -- none of
    // which need to change since 1:1 is preserved).
    expect(mark.width).toBe(mark.height);

    const logo = readPngDimensions('src/assets/brand/justiceos-logo.png');
    const aspect = logo.width / logo.height;
    // ~2.49:1, derived from the approved master's own wizard+wordmark
    // lockup -- distinct from the old (rejected) vector's 3.125:1, and
    // deliberately not re-asserted as an exact literal here beyond a
    // sanity range, since the source of truth is the file itself.
    expect(aspect).toBeGreaterThan(2.3);
    expect(aspect).toBeLessThan(2.7);
  });

  it('every gateway component imports the new canonical PNGs, never a filename that used to exist', () => {
    const consumers = [
      'src/gateway/LoginScreen.tsx',
      'src/gateway/Dashboard.tsx',
      'src/gateway/AgentRail.tsx',
      'src/gateway/GatewayConnectingState.tsx',
      'src/gateway/ManagerChat.tsx',
    ];
    const wordmarkConsumers = new Set(['src/gateway/LoginScreen.tsx', 'src/gateway/Dashboard.tsx']);

    for (const relPath of consumers) {
      const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      expect(content, `${relPath} should not import any .svg brand asset`).not.toMatch(/brand\/[\w.-]*\.svg/);
      expect(content, `${relPath} should not reference the deleted gateway-presentation/ folder`).not.toMatch(
        /gateway-presentation/,
      );

      if (wordmarkConsumers.has(relPath)) {
        expect(content).toMatch(/assets\/brand\/justiceos-logo\.png/);
      } else {
        expect(content).toMatch(/assets\/brand\/justiceos-mark\.png/);
      }
    }
  });

  it('the rejected SVG artwork and the old gateway-presentation indirection are actually gone from disk', () => {
    for (const relPath of [
      'src/assets/brand/justiceos-logo-primary.svg',
      'src/assets/brand/justiceos-mark-color.svg',
      'src/assets/brand/justiceos-app-icon.svg',
      'src/assets/brand/gateway-presentation',
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, relPath)), `expected ${relPath} to be deleted`).toBe(false);
    }
  });

  it('no gateway source file claims raster artwork is a vector, or wraps the master JPEG/PNG in an SVG', () => {
    const gatewayDir = path.join(REPO_ROOT, 'src/gateway');
    for (const file of fs.readdirSync(gatewayDir)) {
      if (!/\.(tsx|css)$/.test(file)) continue;
      const content = fs.readFileSync(path.join(gatewayDir, file), 'utf8');
      // "vector" as a false claim about these specific raster assets --
      // scoped to lines mentioning the brand mark/logo/master filenames so
      // this doesn't misfire on unrelated code that happens to say "vector".
      const brandLines = content.split('\n').filter((line) => /justiceos-(mark|logo)(?!os)/.test(line));
      for (const line of brandLines) {
        expect(line.toLowerCase(), `${file}: "${line.trim()}" should not claim vector artwork`).not.toMatch(/vector/);
      }
    }
  });

  it('the raster icon derivatives (favicons, app icons) are real PNG/ICO files at their documented sizes, not SVGs', () => {
    const expectations: Array<[string, number]> = [
      ['public/justiceos/apple-touch-icon.png', 180],
      ['public/justiceos/favicon-32.png', 32],
      ['public/justiceos/icon-192.png', 192],
      ['public/justiceos/icon-512.png', 512],
      ['public/justiceos/icon-maskable-512.png', 512],
    ];
    for (const [relPath, size] of expectations) {
      const dims = readPngDimensions(relPath);
      expect(dims).toEqual({ width: size, height: size });
    }

    const ico = fs.readFileSync(path.join(REPO_ROOT, 'public/justiceos/favicon.ico'));
    expect(ico.subarray(0, 4).toString('hex'), 'favicon.ico should start with the ICO header (reserved=0, type=1)').toBe(
      '00000100',
    );
    const count = ico.readUInt16LE(4);
    expect(count).toBe(6);
  });
});
