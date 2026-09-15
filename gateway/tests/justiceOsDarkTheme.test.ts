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

  it('index.css defines the gothic-theme override (dual anchor: :root[...] and bare [...]) with the exact brand hex values', () => {
    const overrideBlock = INDEX_CSS.match(
      /:root\[data-astryx-theme='gothic'\][\s\S]*?\n\}/,
    )?.[0];
    expect(overrideBlock, 'expected the gothic override block to exist in index.css').toBeTruthy();
    // Both anchors are required: the Astryx <Theme> component stamps
    // data-astryx-theme on BOTH <html> AND its own inner wrapper div, and
    // gothic's own --color-accent (a pale near-white, #e8f1f6) otherwise
    // keeps winning for everything inside that inner div -- i.e.
    // everything -- even once <html>'s own computed value is correctly
    // overridden. Confirmed by a live-browser check: a button's own
    // computed --color-accent read the un-overridden value until this dual
    // anchor was in place.
    expect(overrideBlock).toContain("[data-astryx-theme='gothic'] {");

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

  it('the override is safe without a [data-justiceos-theme] gate: gothic is structurally unreachable in the demo build', () => {
    // A bare [data-astryx-theme='gothic'] selector (no extra gate) is
    // exactly what's needed to also reach the <Theme> component's inner
    // div (see the test above) -- it's only safe because gothic can NEVER
    // actually be resolved in the demo build: loadThemeId() (src/theme.ts)
    // hard-falls-back to DEFAULT_THEME_ID for any stored id outside
    // EXPOSED_THEME_IDS, and gothic is not in that list. This test locks
    // down that guarantee itself, since the CSS selector no longer does.
    const THEME_TS = fs.readFileSync(path.join(REPO_ROOT, 'src/theme.ts'), 'utf8');
    expect(THEME_TS).toMatch(/EXPOSED_THEME_IDS:\s*readonly ThemeId\[\]\s*=\s*\['chocolate'\]/);
    expect(THEME_TS).toMatch(/if \(EXPOSED_THEME_IDS\.includes\(raw\)\) return raw;\s*\n\s*console\.warn[\s\S]*?return DEFAULT_THEME_ID;/);
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

describe('JusticeOS gateway build: the disabled Sign in button uses an intentional dark-mode style, not Chromium\'s native gray', () => {
  const LOGIN_CSS = fs.readFileSync(path.join(REPO_ROOT, 'src/gateway/LoginScreen.css'), 'utf8');

  it('resets appearance -- otherwise Chromium repaints a disabled <button> with its own native colors, ignoring every rule below regardless of what they say', () => {
    const submitRule = LOGIN_CSS.match(/\.gw-login-submit\s*\{[\s\S]*?\n\}/)?.[0];
    expect(submitRule, 'expected a base .gw-login-submit rule').toBeTruthy();
    expect(submitRule).toMatch(/appearance:\s*none/);
  });

  it('the disabled state is a muted violet-on-charcoal blend, never plain opacity/gray', () => {
    const disabledRule = LOGIN_CSS.match(/\.gw-login-submit:disabled\s*\{[\s\S]*?\n\}/)?.[0];
    expect(disabledRule, 'expected a .gw-login-submit:disabled rule').toBeTruthy();
    expect(disabledRule).toMatch(/color-mix\(in oklab, var\(--color-accent\)[^)]*var\(--color-raised\)\)/);
    // The old flat `opacity: 0.5` washed the enabled violet down to a
    // washed-out swatch rather than an intentional distinct color; it's
    // gone, replaced by the explicit background/color pairing above.
    expect(disabledRule).not.toMatch(/opacity:\s*0\.5/);
  });

  it('enabled, hover, and pressed states stay distinct rules from the disabled one', () => {
    expect(LOGIN_CSS).toMatch(/\.gw-login-submit:not\(:disabled\):hover/);
    expect(LOGIN_CSS).toMatch(/\.gw-login-submit:not\(:disabled\):active/);
  });

  it('never removes or weakens the global keyboard-focus outline for this control', () => {
    // The button relies on index.css's global `:focus-visible` rule
    // (unlayered, so it always wins) -- this locks down that LoginScreen.css
    // itself never adds a competing `outline: none` for the submit button.
    expect(LOGIN_CSS).not.toMatch(/\.gw-login-submit[^{]*\{[^}]*outline:\s*none/);
  });
});
