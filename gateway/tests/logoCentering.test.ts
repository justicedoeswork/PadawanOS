import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The supplied brand SVGs (justiceos-mark-color.svg, justiceos-logo-
 * primary.svg) have asymmetric transparent padding baked into their own
 * viewBox: measured with a real browser's SVGGraphicsElement.getBBox(),
 * the visible artwork sits at x=64 y=32.0636... w=347/1342.28 h=428.9364
 * inside viewBoxes that start at 0,0 -- 64px of padding on the left but
 * 101/193.7px on the right, and 32px on top but 51px on the bottom. Every
 * consumer renders these files at a uniform width/height, so that
 * asymmetric padding reads as the artwork sitting visibly left-and-up of
 * center no matter how well the surrounding CSS itself is centered.
 *
 * gateway-presentation/*.svg are non-destructive copies that fix this by
 * re-aiming the viewBox window (no path data touched, nothing redrawn/
 * recolored/stretched/cropped) so the content's own bounding box sits
 * exactly centered in the frame. This is a static regression test for
 * that fix -- it can't call getBBox() itself (no browser in this test
 * runner), so it instead (a) locks the exact centered viewBox values,
 * derived from the same real getBBox() measurement and verified against
 * it once during implementation, and (b) proves the path data is
 * completely untouched by diffing everything BUT the viewBox/comment
 * against the original supplied file.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const BRAND_DIR = path.join(REPO_ROOT, 'src/assets/brand');
const PRESENTATION_DIR = path.join(BRAND_DIR, 'gateway-presentation');

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

/** Every <path d="..."/> and <path style="fill:...".../> value, in order --
 * the actual vector geometry, independent of surrounding whitespace/XML
 * formatting/viewBox/comments. */
function pathData(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\/>/g)].map((m) => m[0]);
}

describe('logo centering: gateway-presentation SVGs re-center the supplied artwork without touching it', () => {
  it('justiceos-mark-color.svg: the centered copy uses the exact viewBox that centers its measured content bbox', () => {
    const svg = fs.readFileSync(path.join(PRESENTATION_DIR, 'justiceos-mark-color.svg'), 'utf8');
    expect(svg).toMatch(/viewBox="-18\.5 -9\.47 512 512"/);
  });

  it('justiceos-logo-primary.svg: the centered copy uses the exact viewBox that centers its measured content bbox', () => {
    const svg = fs.readFileSync(path.join(PRESENTATION_DIR, 'justiceos-logo-primary.svg'), 'utf8');
    expect(svg).toMatch(/viewBox="-64\.86 -9\.47 1600 512"/);
  });

  it('justiceos-mark-color.svg: every path\'s geometry is byte-identical to the original supplied artwork', () => {
    const original = readFile('src/assets/brand/justiceos-mark-color.svg');
    const centered = fs.readFileSync(path.join(PRESENTATION_DIR, 'justiceos-mark-color.svg'), 'utf8');
    expect(pathData(centered)).toEqual(pathData(original));
    expect(pathData(original).length).toBeGreaterThan(0);
  });

  it('justiceos-logo-primary.svg: every path\'s geometry is byte-identical to the original supplied artwork', () => {
    const original = readFile('src/assets/brand/justiceos-logo-primary.svg');
    const centered = fs.readFileSync(path.join(PRESENTATION_DIR, 'justiceos-logo-primary.svg'), 'utf8');
    expect(pathData(centered)).toEqual(pathData(original));
    expect(pathData(original).length).toBeGreaterThan(0);
  });

  it('the original, unadjusted supplied files are untouched -- the fix lives only in the gateway-presentation copies', () => {
    const originalMark = readFile('src/assets/brand/justiceos-mark-color.svg');
    const originalLogo = readFile('src/assets/brand/justiceos-logo-primary.svg');
    expect(originalMark).toMatch(/viewBox="0 0 512 512"/);
    expect(originalLogo).toMatch(/viewBox="0 0 1600 512"/);
  });

  it('every gateway component that renders the wordmark or standalone mark imports the centered gateway-presentation copy, not the original', () => {
    const consumers = [
      'src/gateway/LoginScreen.tsx',
      'src/gateway/Dashboard.tsx',
      'src/gateway/AgentRail.tsx',
      'src/gateway/GatewayConnectingState.tsx',
      'src/gateway/ManagerChat.tsx',
    ];
    for (const relPath of consumers) {
      const content = readFile(relPath);
      const importsMarkOrLogo = /assets\/brand\/(justiceos-(mark-color|logo-primary))\.svg/.test(content);
      expect(importsMarkOrLogo, `${relPath} should not import the original`).toBe(false);
      expect(content).toMatch(/assets\/brand\/gateway-presentation\/justiceos-(mark-color|logo-primary)\.svg/);
    }
  });
});
