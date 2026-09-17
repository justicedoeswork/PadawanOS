import { describe, expect, it } from 'vitest';
import { loadSidebarCollapsed, saveSidebarCollapsed, type SidebarPreferenceStorage } from './sidebarPreference';

/** In-memory localStorage fake — tests run in node, where localStorage is absent. */
class MemoryStorage implements SidebarPreferenceStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

class ThrowingStorage implements SidebarPreferenceStorage {
  getItem(): string | null {
    throw new Error('storage disabled');
  }
  setItem(): void {
    throw new Error('storage disabled');
  }
}

describe('sidebar collapse preference (desktop only)', () => {
  it('defaults to expanded (not collapsed) with no storage at all -- Node/SSR has no localStorage', () => {
    expect(loadSidebarCollapsed(null)).toBe(false);
  });

  it('defaults to expanded when nothing has been saved yet', () => {
    expect(loadSidebarCollapsed(new MemoryStorage())).toBe(false);
  });

  it('round-trips a saved collapsed preference', () => {
    const storage = new MemoryStorage();
    saveSidebarCollapsed(true, storage);
    expect(loadSidebarCollapsed(storage)).toBe(true);
    saveSidebarCollapsed(false, storage);
    expect(loadSidebarCollapsed(storage)).toBe(false);
  });

  it('never throws when storage access fails -- read falls back to expanded, write is a silent no-op', () => {
    const storage = new ThrowingStorage();
    expect(() => loadSidebarCollapsed(storage)).not.toThrow();
    expect(loadSidebarCollapsed(storage)).toBe(false);
    expect(() => saveSidebarCollapsed(true, storage)).not.toThrow();
  });
});
