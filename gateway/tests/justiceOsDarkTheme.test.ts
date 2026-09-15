import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The JusticeOS gateway build replaces the app's default brown/chocolate
 * theme with a dark graphite/violet/aqua palette (JusticeOS-Brand-Assets.zip's
 * README: Graphite #11151D, Ink #171B24, Ultraviolet #6C43F3, Aqua #4FDCF7,
 * Moonlight #FFF9ED). This can't be verified by rendering (this project has
 * no jsdom, so no test actually computes CSS cascade/color values) -- it's
 * verified at the source level here (the override block and the theme-
 * forcing wire-up both exist, with the right values) and separately, for
 * real rendered pixels, via a live-browser screenshot pass.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const INDEX_CSS = fs.readFileSync(path.join(REPO_ROOT, 'src/index.css'), 'utf8');
const MAIN_TSX = fs.readFileSync(path.join(REPO_ROOT, 'src/main.tsx'), 'utf8');

const GATEWAY_CSS_FILES = [
  'AgentRail.css',
  'Dashboard.css',
  'ManagerChat.css',
  'LoginScreen.css',
  'JusticeOsShell.css',
  'GatewayConnectingState.css',
].map((name) => path.join(REPO_ROOT, 'src/gateway', name));

// A rough brown/tan/chocolate hue detector: warm hex colors where red is
// clearly the dominant channel and green/blue trail off -- the "brown
// undertone" family this change is required to remove. Not exhaustive (it
// can't be, for arbitrary hex), but catches the obvious cases and never
// flags the JusticeOS palette itself (graphite/ink are cool near-black,
// violet/aqua/moonlight/green/amber/red below all fail this test on
// purpose -- amber #FBBF24 has G > R so it's excluded; deliberately
// checked below).
function isBrownish(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  // Brown/tan/chocolate: warm, mid-to-low lightness, red clearly ahead of
  // blue, and not so saturated/bright it reads as a clear brand red/orange.
  return r > b + 20 && r > 60 && r < 200 && g < r && b < g + 40;
}

describe('JusticeOS gateway build: dark-mode brand palette (replaces brown/chocolate)', () => {
  it('main.tsx forces the gothic (dark-only) theme for the gateway build, never the stored preference', () => {
    expect(MAIN_TSX).toMatch(/isGatewayBuild\(\)\s*\?\s*resolveTheme\(['"]gothic['"]\)/);
  });

  it('index.css defines the [data-justiceos-theme] override with the exact brand hex values', () => {
    const overrideBlock = INDEX_CSS.match(
      /:root\[data-astryx-theme='gothic'\]\[data-justiceos-theme\][\s\S]*?\n\}/,
    )?.[0];
    expect(overrideBlock, 'expected the gothic+justiceos-theme override block to exist in index.css').toBeTruthy();

    // Graphite / Ink backgrounds.
    expect(overrideBlock).toMatch(/--color-background-body:\s*#11151D/);
    expect(overrideBlock).toMatch(/--color-background-muted:\s*#171B24/);
    // Moonlight primary text.
    expect(overrideBlock).toMatch(/--color-text-primary:\s*#FFF9ED/);
    // Ultraviolet accent.
    expect(overrideBlock).toMatch(/--color-accent:\s*#6C43F3/);
    // Green/amber/red reserved for success/warning/error only.
    expect(overrideBlock).toMatch(/--color-success:\s*#34D399/);
    expect(overrideBlock).toMatch(/--color-warning:\s*#FBBF24/);
    expect(overrideBlock).toMatch(/--color-error:\s*#F87171/);
  });

  it('the override is scoped to the gateway build only -- never touches the demo build’s own themes', () => {
    // Scoped by BOTH the gothic theme id AND the gateway-only
    // [data-justiceos-theme] attribute (only ever stamped by the
    // gateway-only HTML transform) -- a bare [data-astryx-theme='gothic']
    // rule with no justiceos gate would be a real risk (gothic ships,
    // hidden, in the demo build too; see src/theme.ts's EXPOSED_THEME_IDS).
    expect(INDEX_CSS).not.toMatch(/\[data-astryx-theme='gothic'\]\s*\{/);
  });

  it('none of the JusticeOS gateway component CSS files hardcode a brown/tan/chocolate color', () => {
    const offenders: Array<{ file: string; color: string }> = [];
    for (const file of GATEWAY_CSS_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      const hexColors = content.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      for (const color of hexColors) {
        if (isBrownish(color)) offenders.push({ file: path.relative(REPO_ROOT, file), color });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sanity check: the brownish-hue heuristic itself does not flag the JusticeOS palette', () => {
    expect(isBrownish('#11151D')).toBe(false); // graphite
    expect(isBrownish('#171B24')).toBe(false); // ink
    expect(isBrownish('#6C43F3')).toBe(false); // ultraviolet
    expect(isBrownish('#4FDCF7')).toBe(false); // aqua
    expect(isBrownish('#FFF9ED')).toBe(false); // moonlight
    expect(isBrownish('#34D399')).toBe(false); // success green
    expect(isBrownish('#FBBF24')).toBe(false); // warning amber
    expect(isBrownish('#F87171')).toBe(false); // error red
    // And that it DOES flag an actual brown, so the "no offenders" result
    // above is a real assertion, not a heuristic that never fires.
    expect(isBrownish('#8B5E34')).toBe(true);
  });
});
