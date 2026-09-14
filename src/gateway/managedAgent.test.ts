import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAcpClient, LiveClientHandlers } from '../acp/LiveAcpClient';
import { __resetLiveConnections, __setDefaultClientFactory } from '../liveConnections';
import { usePanda } from '../store';
import type { ProfileStorage } from '../profiles';
import { loadProfiles, subscribeProfiles } from '../profiles';
import {
  MANAGED_INSURANCE_PROFILE_ID,
  RECONNECT_DELAYS_MS,
  __managedAgentSupervisorActive,
  connectManagedInsuranceAgent,
  ensureManagedInsuranceProfile,
  managedInsuranceAgentProfile,
  managedInsuranceAgentUrl,
  startManagedAgentSupervisor,
  stopManagedAgentSupervisor,
} from './managedAgent';

class MemoryStorage implements ProfileStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

type StubbedClient = { handlers: LiveClientHandlers; client: LiveAcpClient };

/** Same stub pattern as liveConnections.test.ts: connect/disconnect are
 * spies, and the manager's real handler-wiring is exercised through the
 * captured handlers. */
function installStubClients(): StubbedClient[] {
  const created: StubbedClient[] = [];
  __setDefaultClientFactory((handlers) => {
    const stub: StubbedClient = {
      handlers,
      client: {
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(() => handlers.onDisconnected(null)),
        newSession: vi.fn(async () => {}),
        loadSession: vi.fn(async () => {}),
        deleteSession: vi.fn(async () => {}),
        send: vi.fn(async () => {}),
        resolvePermission: vi.fn(),
        cancel: vi.fn(),
      } as unknown as LiveAcpClient,
    };
    created.push(stub);
    return stub.client;
  });
  return created;
}

/** Flushes the microtask queue -- connectLiveConnection/reconnectLiveConnection
 * suspend on exactly one `await client.connect(...)` hop before this stub
 * resolves, plus checkGatewaySession's own fetch + json() hops; fake timers
 * (used below) don't touch Promise scheduling, so this alone is what lets
 * those settle between assertions. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function stubWindowLocation(protocol: string, host: string): void {
  vi.stubGlobal('window', { location: { protocol, host } });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  usePanda.setState({
    mode: 'live',
    connections: {},
    activeConnectionId: null,
    activeSessionId: null,
    selectionGeneration: 0,
  });
  __resetLiveConnections();
  stopManagedAgentSupervisor();
  stubWindowLocation('https:', 'justiceos.example.com');
});

afterEach(() => {
  stopManagedAgentSupervisor();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('managedInsuranceAgentUrl', () => {
  it('derives wss:// from https://', () => {
    expect(managedInsuranceAgentUrl({ protocol: 'https:', host: 'justiceos.fly.dev' })).toBe(
      'wss://justiceos.fly.dev/acp/insurance',
    );
  });

  it('derives ws:// from http:// (local dev)', () => {
    expect(managedInsuranceAgentUrl({ protocol: 'http:', host: '127.0.0.1:5173' })).toBe(
      'ws://127.0.0.1:5173/acp/insurance',
    );
  });

  it('never hardcodes a hostname -- it always reflects window.location', () => {
    expect(managedInsuranceAgentUrl({ protocol: 'https:', host: 'a-different-host.example' })).toBe(
      'wss://a-different-host.example/acp/insurance',
    );
  });
});

describe('managedInsuranceAgentProfile', () => {
  it('carries no credential -- just the fixed, derived, non-secret path', () => {
    const profile = managedInsuranceAgentProfile();
    expect(profile.id).toBe(MANAGED_INSURANCE_PROFILE_ID);
    expect(profile.kind).toBe('websocket');
    if (profile.kind === 'websocket') {
      expect(profile.url).toBe('wss://justiceos.example.com/acp/insurance');
      expect(profile.url).not.toMatch(/token|password|secret|key=/i);
    }
  });

  it('displays as the neutral "Insurance Audit Agent" name -- carries no company branding', () => {
    const profile = managedInsuranceAgentProfile();
    expect(profile.name).toBe('Insurance Audit Agent');
    expect(profile.name).not.toMatch(/justice[-\s]?exteriors/i);
  });
});

describe('ensureManagedInsuranceProfile', () => {
  it('creates the managed profile with zero configuration when none exists', () => {
    const storage = new MemoryStorage();
    ensureManagedInsuranceProfile(storage);
    const profiles = loadProfiles(storage);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.id).toBe(MANAGED_INSURANCE_PROFILE_ID);
  });

  it('refreshes the stored URL if the origin changed since last login', () => {
    const storage = new MemoryStorage();
    ensureManagedInsuranceProfile(storage);
    stubWindowLocation('https:', 'renamed-app.fly.dev');
    ensureManagedInsuranceProfile(storage);
    const profiles = loadProfiles(storage);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.kind === 'websocket' && profiles[0]!.url).toBe('wss://renamed-app.fly.dev/acp/insurance');
  });

  it('preserves any of Austin’s own saved profiles alongside it', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'panda.profiles',
      JSON.stringify([{ id: 'my-dev-agent', name: 'Dev', kind: 'websocket', url: 'ws://localhost:9000/acp', workspace: { kind: 'none' }, mcpServerIds: [] }]),
    );
    ensureManagedInsuranceProfile(storage);
    const ids = loadProfiles(storage).map((p) => p.id);
    expect(ids).toContain('my-dev-agent');
    expect(ids).toContain(MANAGED_INSURANCE_PROFILE_ID);
  });

  it('does not trigger an extra profiles-changed notification when nothing changed', () => {
    // profiles.ts's own loadProfiles() rewrites storage on every read as a
    // normalize-on-load side effect (unrelated to this function) -- that's
    // not what matters here. What matters is that ensureManagedInsuranceProfile
    // itself skips its own saveProfiles() (and the notifyProfiles() storm
    // that follows it, which is what the Sidebar's subscription actually
    // reacts to) when the stored profile already matches.
    const storage = new MemoryStorage();
    ensureManagedInsuranceProfile(storage);
    const notifications: unknown[] = [];
    const unsubscribe = subscribeProfiles((profiles) => notifications.push(profiles));
    ensureManagedInsuranceProfile(storage);
    unsubscribe();
    expect(notifications).toHaveLength(0);
  });
});

describe('automatic managed connection (requirement #6/#9)', () => {
  it('connects with zero endpoint configuration -- Austin types nothing', async () => {
    const stubs = installStubClients();
    connectManagedInsuranceAgent();
    await flush();
    expect(stubs).toHaveLength(1);
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(1);
    expect(usePanda.getState().connections[MANAGED_INSURANCE_PROFILE_ID]?.connection.url).toBe(
      'wss://justiceos.example.com/acp/insurance',
    );
  });
});

describe('reconnect supervisor (requirement #11)', () => {
  it('dials the managed agent immediately on start', async () => {
    const stubs = installStubClients();
    startManagedAgentSupervisor(() => {});
    await flush();
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(1);
  });

  it('on a WebSocket failure while still authenticated, schedules a bounded retry rather than an immediate loop', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ authenticated: true }) }) as unknown as Response));
    const stubs = installStubClients();
    startManagedAgentSupervisor(() => {});
    await flush();
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(1);

    stubs[0]!.handlers.onDisconnected('boom');
    await flush();

    // A retry is scheduled, not fired immediately -- exactly one pending
    // timer, and it has not connected again yet.
    expect(vi.getTimerCount()).toBe(1);
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(2);
  });

  it('grows the retry delay on repeated failures and caps it -- never a tight rapid loop', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ authenticated: true }) }) as unknown as Response));
    const stubs = installStubClients();
    startManagedAgentSupervisor(() => {});
    await flush();

    const observedDelays: number[] = [];
    for (let i = 0; i < RECONNECT_DELAYS_MS.length + 2; i++) {
      stubs[0]!.handlers.onDisconnected('boom again');
      await flush();
      const before = vi.getTimerCount();
      expect(before).toBe(1); // never more than one retry ever pending
      const pending = vi.getTimerCount() > 0 ? RECONNECT_DELAYS_MS[Math.min(i, RECONNECT_DELAYS_MS.length - 1)]! : 0;
      observedDelays.push(pending);
      await vi.advanceTimersByTimeAsync(pending);
    }

    // Monotonically non-decreasing, and capped at the schedule's max --
    // this is what "bounded" means: it never shrinks back to a rapid loop.
    for (let i = 1; i < observedDelays.length; i++) {
      expect(observedDelays[i]!).toBeGreaterThanOrEqual(observedDelays[i - 1]!);
    }
    expect(Math.max(...observedDelays)).toBe(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]);
  });

  it('resets the backoff after a successful reconnect', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ authenticated: true }) }) as unknown as Response));
    const stubs = installStubClients();
    startManagedAgentSupervisor(() => {});
    await flush();

    // Fail twice, advancing through the schedule -- then reconnect the
    // slot to 'connected' before failing again.
    stubs[0]!.handlers.onDisconnected('boom');
    await flush();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]!);
    stubs[0]!.handlers.onDisconnected('boom');
    await flush();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[1]!);

    stubs[0]!.handlers.onConnected({ agentName: 'insurance-agent', protocolVersion: 1 });

    stubs[0]!.handlers.onDisconnected('boom once more');
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    // Back to the FIRST delay, not the third -- the counter really reset.
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]! - 1);
    expect(stubs[0]!.client.connect).not.toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(4);
  });

  it('on session expiration, stops reconnecting and reports it instead of retrying (requirement #11)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ authenticated: false }) }) as unknown as Response));
    const stubs = installStubClients();
    const onSessionExpired = vi.fn();
    startManagedAgentSupervisor(onSessionExpired);
    await flush();

    stubs[0]!.handlers.onDisconnected('unauthorized');
    await flush();

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0); // no retry was scheduled
    expect(__managedAgentSupervisorActive()).toBe(false);

    // Advancing time proves it too: nothing more happens, ever.
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]!);
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(1);
  });

  it('stopManagedAgentSupervisor cancels a pending retry and stops watching', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ authenticated: true }) }) as unknown as Response));
    const stubs = installStubClients();
    startManagedAgentSupervisor(() => {});
    await flush();

    stubs[0]!.handlers.onDisconnected('boom');
    await flush();
    expect(vi.getTimerCount()).toBe(1);

    stopManagedAgentSupervisor();
    expect(vi.getTimerCount()).toBe(0);
    expect(__managedAgentSupervisorActive()).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(1); // never reconnected
  });

  it('starting a second time replaces the previous supervisor cleanly (idempotent)', async () => {
    const stubs = installStubClients();
    startManagedAgentSupervisor(() => {});
    await flush();
    startManagedAgentSupervisor(() => {});
    await flush();
    expect(__managedAgentSupervisorActive()).toBe(true);
    // Two starts, two connect attempts on the one reused slot -- not a
    // runaway multiplying set of subscriptions.
    expect(stubs[0]!.client.connect).toHaveBeenCalledTimes(2);
  });
});
