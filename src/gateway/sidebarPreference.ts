/**
 * Desktop agent-sidebar collapsed/expanded preference (JusticeOS gateway
 * build only), persisted to localStorage per browser -- same injectable-
 * storage pattern as theme.ts / profiles.ts (node has no localStorage;
 * tests inject an in-memory fake).
 *
 * Mobile's drawer open/closed state is NEVER persisted here -- it is plain
 * component state that must default closed on every load, per the brand
 * brief ("The sidebar must be closed by default" on mobile). Only the
 * desktop collapse/expand choice is a remembered preference.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'justiceos.sidebarCollapsed';

export interface SidebarPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `undefined`/no-localStorage (SSR, Node test runner) is a normal, silent
 * case -- distinct from a genuine runtime storage error, which does warn. */
function defaultStorage(): SidebarPreferenceStorage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

export function loadSidebarCollapsed(storage: SidebarPreferenceStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch (err) {
    console.warn('[justiceos/sidebar] could not read sidebar preference', err);
    return false;
  }
}

/** Best-effort persistence, same contract as theme.ts's saveThemeId: a
 * storage failure warns but never throws. */
export function saveSidebarCollapsed(collapsed: boolean, storage: SidebarPreferenceStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch (err) {
    console.warn('[justiceos/sidebar] could not persist sidebar preference', err);
  }
}
