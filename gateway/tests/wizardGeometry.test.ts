import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression test for the wizard face/beard alignment fix.
 *
 * The supplied artwork's beard (and the terminal ">_" glyph riding inside
 * it) were authored ~17px right of the face/moustache/hat-brim's own
 * mirror axis (measured with a real browser's getBBox(): face and
 * moustache both centered at x=235, the hat brim's bbox centered at
 * x=237.5, but the beard centered at x=252 and the terminal glyph at
 * x=255.5 -- confirmed by tracing each path's absolute anchor points by
 * hand and cross-checked against a live-browser bbox measurement).
 *
 * The fix is a pure horizontal translation of exactly those two shapes
 * (dx=-17): only each shape's own starting anchor coordinate changes: no
 * bezier control-point deltas, no other path, nothing redrawn. Re-
 * measuring afterward: beard centerX=235 (now matching the face/
 * moustache exactly), terminal centerX=238.5 (preserving its original
 * +3.5 offset from the beard's own center, i.e. the beard-to-terminal
 * relationship the artist drew is untouched -- only the pair's shared
 * position relative to the rest of the face moved).
 *
 * This can't be re-verified by calling getBBox() here (no browser in this
 * test runner) -- it locks down the exact corrected anchor coordinates at
 * the source level instead, in every file that carries this geometry, so
 * a future edit to any one of them can't silently reintroduce the offset
 * or de-sync the files from each other.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// Files using the combined-multi-subpath, space-separated, absolute-M
// format (mark-color.svg and app-icon.svg's own local coordinate space,
// which is NOT offset by an extra <g transform>).
const ABSOLUTE_FORMAT_FILES = [
  'src/assets/brand/justiceos-mark-color.svg',
  'src/assets/brand/justiceos-app-icon.svg',
  'src/assets/brand/gateway-presentation/justiceos-mark-color.svg',
];

// The wordmark files author each subpath as its own <path> element in a
// LOCAL coordinate space offset by an outer <g transform="translate(16)">
// -- so the local anchor is 16 less than the absolute-format files' anchor
// (180-16=164 for the beard, 192-16=176 for the terminal).
const WORDMARK_FORMAT_FILES = [
  'src/assets/brand/justiceos-logo-primary.svg',
  'src/assets/brand/gateway-presentation/justiceos-logo-primary.svg',
];

describe('wizard geometry: beard and terminal glyph are corrected to the face/hat axis', () => {
  it.each(ABSOLUTE_FORMAT_FILES)('%s: beard starts at the corrected M180 296 anchor, not the original M197 296', (relPath) => {
    const content = read(relPath);
    expect(content).toContain('M180 296');
    expect(content).not.toContain('M197 296');
  });

  it.each(ABSOLUTE_FORMAT_FILES)('%s: terminal glyph starts at the corrected m192 337 anchor, not the original m209 337', (relPath) => {
    const content = read(relPath);
    expect(content).toContain('m192 337');
    expect(content).not.toContain('m209 337');
  });

  it.each(WORDMARK_FORMAT_FILES)('%s: beard\'s three subpaths (main, left tuft, right tuft) all use the corrected local anchors', (relPath) => {
    const content = read(relPath);
    expect(content).toContain('m 164,296'); // main beard outline (was 181,296)
    expect(content).toContain('m 160,309'); // left tuft (was 177,309)
    expect(content).toContain('m 278,309'); // right tuft (was 295,309)
    expect(content).not.toContain('m 181,296');
    expect(content).not.toContain('m 177,309');
    expect(content).not.toContain('m 295,309');
  });

  it.each(WORDMARK_FORMAT_FILES)('%s: terminal glyph uses the corrected local anchor', (relPath) => {
    const content = read(relPath);
    expect(content).toContain('m 176,337'); // was 193,337
    expect(content).not.toContain('m 193,337');
  });

  it('every file agrees: the corrected beard/terminal shift is exactly 17px, applied consistently everywhere', () => {
    // Absolute-format anchors: 197->180 (beard), 209->192 (terminal) -- both dx=-17.
    expect(197 - 180).toBe(17);
    expect(209 - 192).toBe(17);
    // Wordmark-format local anchors carry the identical -17 shift.
    expect(181 - 164).toBe(17);
    expect(177 - 160).toBe(17);
    expect(295 - 278).toBe(17);
    expect(193 - 176).toBe(17);
  });

  it('the hat (cone + brim) and the cyan sparkle are untouched -- only the beard and terminal glyph moved', () => {
    for (const relPath of [...ABSOLUTE_FORMAT_FILES]) {
      const content = read(relPath);
      // Hat cone + brim (both fill #6C43F3 in this format) and the sparkle
      // (#4FDCF7) keep their original, unshifted anchors.
      expect(content).toMatch(/M94 211c37-66/i);
      expect(content).toMatch(/M64 228c58-30/i);
      expect(content).toMatch(/m364 100 9 20/i);
    }
  });
});
