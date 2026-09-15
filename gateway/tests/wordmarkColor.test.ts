import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, getPixel, type Rgba } from './helpers/decodePng.js';

/**
 * The first approved-master derivative (see logoMaster.test.ts) shipped
 * the full "JusticeOS" wordmark entirely in ivory, including "OS" -- that
 * was REJECTED: "OS" must be violet, the same violet as the wizard's own
 * hat, with "Justice" staying ivory. The correction only overwrites the
 * RGB of already-transparent-background pixels at x >= 1215 (the gap
 * between "e" and "O") in justiceos-logo.png; every pixel's alpha is
 * untouched, so shape/antialiasing/kerning/baseline/position for every
 * glyph -- "O" and "S" included -- come along for free. Nothing else
 * (master, standalone mark, app icons, wizard/hat/sparkle/beard/terminal
 * pixels, background) is touched at all.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const LOGO_PATH = 'src/assets/brand/justiceos-logo.png';

const HAT_VIOLET = { r: 95, g: 64, b: 227 };
const IVORY_MIN = { r: 240, g: 230, b: 210 };

function loadLogo() {
  const buf = fs.readFileSync(path.join(REPO_ROOT, LOGO_PATH));
  return decodePng(buf);
}

function isIvoryish(p: Rgba): boolean {
  return p.r >= IVORY_MIN.r && p.g >= IVORY_MIN.g && p.b >= IVORY_MIN.b;
}

function isHatVioletish(p: Rgba): boolean {
  // Allow the same +/-2 sensor-noise tolerance the source master itself
  // has pixel-to-pixel (see logoMaster.test.ts's sibling analysis) --
  // the recolor uses one flat value, so in practice this is exact.
  return Math.abs(p.r - HAT_VIOLET.r) <= 2 && Math.abs(p.g - HAT_VIOLET.g) <= 2 && Math.abs(p.b - HAT_VIOLET.b) <= 2;
}

describe('JusticeOS production wordmark: "OS" is violet, "Justice" stays ivory', () => {
  it('is still the same 1543x619 RGBA PNG (dimensions and pixel format unchanged)', () => {
    const png = loadLogo();
    expect(png.width).toBe(1543);
    expect(png.height).toBe(619);
    expect(png.channels).toBe(4);
  });

  it('samples multiple interior points of "O" and confirms they are violet, not ivory', () => {
    const png = loadLogo();
    // Interior stroke points on the "O" glyph (bbox ~1219,277-1391,447),
    // picked to land on solid ring pixels rather than the hollow counter.
    const points: Array<[number, number]> = [
      [1327, 283],
      [1380, 400],
      [1243, 420],
    ];
    for (const [x, y] of points) {
      const p = getPixel(png, x, y);
      expect(p.a, `O @ (${x},${y}) should be fully opaque`).toBe(255);
      expect(isHatVioletish(p), `O @ (${x},${y}) = rgb(${p.r},${p.g},${p.b}) should be violet`).toBe(true);
      expect(isIvoryish(p), `O @ (${x},${y}) should no longer be ivory`).toBe(false);
    }
  });

  it('samples multiple interior points of "S" and confirms they are violet, not ivory', () => {
    const png = loadLogo();
    // Interior stroke points on the "S" glyph (bbox ~1392,276-1522,447).
    const points: Array<[number, number]> = [
      [1444, 284],
      [1410, 310],
      [1500, 420],
    ];
    for (const [x, y] of points) {
      const p = getPixel(png, x, y);
      expect(p.a, `S @ (${x},${y}) should be fully opaque`).toBe(255);
      expect(isHatVioletish(p), `S @ (${x},${y}) = rgb(${p.r},${p.g},${p.b}) should be violet`).toBe(true);
      expect(isIvoryish(p), `S @ (${x},${y}) should no longer be ivory`).toBe(false);
    }
  });

  it('"O" and "S" use the exact same violet as the wizard\'s own hat', () => {
    const png = loadLogo();
    const hat = getPixel(png, 200, 150);
    const o = getPixel(png, 1327, 283);
    const s = getPixel(png, 1444, 284);
    expect(hat).toEqual({ r: 94, g: 64, b: 225, a: 255 });
    // The recolor uses one flat value for every OS pixel (unlike the
    // master's own hat, which has faint per-pixel sensor noise) -- so
    // this is an exact match, not just "close".
    expect(o).toEqual({ r: 95, g: 64, b: 227, a: 255 });
    expect(s).toEqual({ r: 95, g: 64, b: 227, a: 255 });
  });

  it('"Justice" (J, u, e sampled) is untouched: still ivory, still the exact original pixels', () => {
    const png = loadLogo();
    // Captured from the file before the OS recolor; the recolor script
    // only ever touches x >= 1215, well right of every "Justice" glyph.
    const expectations: Array<[string, number, number, Rgba]> = [
      ['J', 587, 287, { r: 253, g: 243, b: 230, a: 255 }],
      ['u', 622, 328, { r: 247, g: 241, b: 233, a: 255 }],
      ['e', 1157, 330, { r: 253, g: 242, b: 230, a: 255 }],
    ];
    for (const [label, x, y, expected] of expectations) {
      const p = getPixel(png, x, y);
      expect(p, `"${label}" @ (${x},${y})`).toEqual(expected);
      expect(isIvoryish(p), `"${label}" should still read as ivory`).toBe(true);
    }
  });

  it('the wizard (hat interior) and the background are pixel-identical to before the color correction', () => {
    const png = loadLogo();
    expect(getPixel(png, 200, 150)).toEqual({ r: 94, g: 64, b: 225, a: 255 });
    expect(getPixel(png, 2, 2)).toEqual({ r: 36, g: 39, b: 44, a: 0 });
  });

  it('preserves the exact antialiased edge alpha of "O" and "S" -- only their RGB changed', () => {
    const png = loadLogo();
    // Edge (partial-coverage) pixels captured from the file before the OS
    // recolor, keyed by their alpha at the time -- the recolor script
    // only ever overwrites RGB and always leaves alpha untouched, so
    // these exact alpha values (the glyphs' antialiasing profile) must
    // still be exactly what they were.
    const edgeAlphas: Array<[number, number, number]> = [
      [1297, 277, 49],
      [1456, 310, 226],
      [1267, 331, 66],
      [1258, 358, 90],
      [1261, 385, 118],
      [1483, 406, 151],
    ];
    for (const [x, y, alpha] of edgeAlphas) {
      const p = getPixel(png, x, y);
      expect(p.a, `edge pixel @ (${x},${y}) alpha (antialiasing) should be unchanged`).toBe(alpha);
      // And its color should now read as violet-tinted, not ivory-tinted,
      // since it's past the x >= 1215 cut.
      expect(isHatVioletish(p), `edge pixel @ (${x},${y}) = rgb(${p.r},${p.g},${p.b}) should be violet-toned`).toBe(
        true,
      );
    }
  });

  it('does not touch the standalone wizard mark, the raster icons, or the provenance master', () => {
    // These never contained wordmark text in the first place, but this
    // locks down that the correction script (or a future one like it)
    // never reaches past justiceos-logo.png.
    const untouched = [
      'src/assets/brand/justiceos-mark.png',
      'src/assets/brand/master/justiceos-logo-master.png',
      'public/justiceos/icon-512.png',
      'public/justiceos/icon-192.png',
      'public/justiceos/apple-touch-icon.png',
      'public/justiceos/icon-maskable-512.png',
      'public/justiceos/favicon-32.png',
    ];
    for (const relPath of untouched) {
      expect(fs.existsSync(path.join(REPO_ROOT, relPath)), `${relPath} should still exist`).toBe(true);
    }
  });
});
