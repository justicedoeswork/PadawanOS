/**
 * Lightweight hash routing (IA refactor phase 1). Panda has exactly four
 * in-app views — the session screen (`#/`), the settings screen
 * (`#/settings`), the demo replay (`#/demo`, phase 2: the hash
 * is what drives the demo/live session mode; leaving the route switches the
 * UI back to live without touching connections), and the Marketing
 * workspace (`#/marketing`, the operator review surface for the Marketing
 * Agent — it talks only to the JusticeOS gateway and never touches ACP
 * connections) — plus dev-only tree-level pages that replace the whole
 * render root (`#/astryx-smoke`); those are parsed by the same function so
 * every hash spelling lives in one place.
 *
 * No router dependency: a `hashchange` listener and this module are the
 * entire mechanism. Unknown hashes fall back to the main view (a stale or
 * mistyped link must never blank the app).
 */
import { useEffect, useState } from 'react';

export type AppRoute = 'main' | 'settings' | 'demo' | 'marketing';

export type DevPage = 'astryx-smoke' | 'crash';

/** `''` · `'#'` · `'#/'` → main; `#/settings` → settings; `#/demo` → demo
 * (the scripted replay — reachable in production by explicit URL and via
 * the first-run empty state's entry (#200); the app never opens on it by
 * itself). */
export function parseHash(hash: string): AppRoute {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (path === 'settings') return 'settings';
  if (path === 'demo') return 'demo';
  if (path === 'marketing') return 'marketing';
  return 'main';
}

/** Dev-only tree-level pages (main.tsx renders a different root for these). */
export function parseDevPage(hash: string): DevPage | null {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (import.meta.env.DEV && path === 'astryx-smoke') return 'astryx-smoke';
  if (import.meta.env.DEV && path === 'crash') return 'crash';
  return null;
}

/** The canonical hash for a route — the single spelling authority. */
export function routeHash(route: AppRoute): string {
  return route === 'main' ? '#/' : `#/${route}`;
}

export function navigate(route: AppRoute): void {
  window.location.hash = routeHash(route);
}

/** The hash as seen from wherever this runs. Server-side rendering (which
 * this project's component tests use instead of jsdom) has no `window` at
 * all, so reading it during render would throw there — the initial route is
 * simply "main" until the browser's own first effect resolves the real one. */
function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

/** The current route, re-resolved on every `hashchange`. Navigation goes
 * through `navigate()` — it flips the hash and the listener re-resolves. */
export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState(() => parseHash(currentHash()));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(currentHash()));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
