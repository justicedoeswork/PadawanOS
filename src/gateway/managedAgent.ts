/**
 * The managed Insurance Agent connection (Phase 3, requirements #6-#11):
 * the one agent every PadawanOS/gateway session connects to automatically,
 * with no endpoint Austin has to type.
 *
 * It rides the SAME profile/connection machinery every other agent uses
 * (profiles.ts + liveConnections.ts) rather than inventing a parallel
 * connection-identity class: `reconcileProfileSlots` sweeps any live
 * connection id that isn't a saved profile id or a `direct:` id, so a
 * connection id that ISN'T a real, persisted AgentProfile would get torn
 * down the moment the Sidebar's profile-reconciliation effect next runs.
 * Being a real profile also satisfies requirement #8 directly: the fixed
 * `/acp/insurance` path this resolves to carries no credential, so storing
 * it (like every other profile's endpoint) is exactly the "managed
 * configuration" the requirement allows.
 */
import {
  loadProfiles,
  profileToLiveTarget,
  saveProfiles,
  type AgentProfile,
  type ProfileStorage,
} from '../profiles';
import { connectLiveConnection, reconnectLiveConnection } from '../liveConnections';
import { usePanda, type ConnectionStatus } from '../store';
import { checkGatewaySession } from './session';
import { MANAGED_INSURANCE_PROFILE_ID, managedInsuranceAgentUrl } from './managedAgentId';

export { MANAGED_INSURANCE_PROFILE_ID, managedInsuranceAgentUrl };

/** The managed profile's current shape -- freshly derived, never read back
 * from storage: the URL must always track the CURRENT origin, not whatever
 * origin happened to be current the last time this ran. */
export function managedInsuranceAgentProfile(): AgentProfile {
  return {
    id: MANAGED_INSURANCE_PROFILE_ID,
    name: 'Insurance Agent',
    kind: 'websocket',
    url: managedInsuranceAgentUrl(),
    workspace: { kind: 'none' },
    mcpServerIds: [],
  };
}

/**
 * Upserts the managed profile into the saved list so it appears with zero
 * configuration (requirement #9) -- called once per successful login/
 * session-restore, BEFORE the gated app renders, so the very first Sidebar
 * mount already sees it instead of popping in a moment later. Idempotent:
 * skips the write (and the resulting notifyProfiles/localStorage churn)
 * when nothing actually changed since the last login.
 */
export function ensureManagedInsuranceProfile(storage?: ProfileStorage): void {
  const profiles = loadProfiles(storage);
  const managed = managedInsuranceAgentProfile();
  const existingIndex = profiles.findIndex((profile) => profile.id === MANAGED_INSURANCE_PROFILE_ID);
  if (existingIndex !== -1 && JSON.stringify(profiles[existingIndex]) === JSON.stringify(managed)) {
    return;
  }
  const next =
    existingIndex === -1
      ? [managed, ...profiles]
      : profiles.map((profile, index) => (index === existingIndex ? managed : profile));
  saveProfiles(next, storage);
}

/** Dials the managed profile through the normal profile-connect path (same
 * write-back-on-success behavior as any other profile). Fire-and-forget --
 * failures land on the connection slot's own error state, watched by the
 * reconnect supervisor below. */
export function connectManagedInsuranceAgent(): void {
  const profile = managedInsuranceAgentProfile();
  void connectLiveConnection(MANAGED_INSURANCE_PROFILE_ID, profileToLiveTarget(profile), profile.workspace, {
    profileId: MANAGED_INSURANCE_PROFILE_ID,
  });
}

// ---------------------------------------------------------------------------
// Bounded reconnect (requirement #11)
// ---------------------------------------------------------------------------

/**
 * Growing, capped retry schedule -- never a tight rapid loop, and never
 * silently gives up either (the agent may come back at any time, so this
 * keeps trying at the capped interval rather than stopping after N tries).
 */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 5000, 10000, 20000, 30000];

type Supervisor = {
  unsubscribe: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  lastStatus: ConnectionStatus | null;
  onSessionExpired: () => void;
  stopped: boolean;
};

let supervisor: Supervisor | null = null;

function delayForAttempt(attempt: number): number {
  const index = Math.min(attempt, RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index]!;
}

function scheduleReconnect(sup: Supervisor): void {
  if (sup.stopped || sup.timer !== null) return;
  const delay = delayForAttempt(sup.attempt);
  sup.attempt += 1;
  sup.timer = setTimeout(() => {
    sup.timer = null;
    if (sup.stopped) return;
    reconnectLiveConnection(MANAGED_INSURANCE_PROFILE_ID);
  }, delay);
}

/**
 * Runs on every transition of the managed slot INTO 'error' (requirement
 * #11): rechecks the gateway session first, since a WebSocket failure is
 * ambiguous between "the agent hiccuped" and "my login expired" -- the two
 * need opposite responses (retry vs. stop and show the login screen).
 */
async function handleFailure(sup: Supervisor): Promise<void> {
  if (sup.stopped) return;
  const check = await checkGatewaySession();
  if (sup.stopped || supervisor !== sup) return; // torn down while awaiting
  if (check.status === 'unauthenticated') {
    sup.onSessionExpired();
    stopManagedAgentSupervisor();
    return;
  }
  // Authenticated, or the check itself was unavailable (a network blip
  // proves nothing about login state) -- both keep retrying rather than
  // assuming logged out.
  scheduleReconnect(sup);
}

/**
 * Starts watching the managed connection and dials it for the first time.
 * Idempotent -- a second call replaces the previous supervisor cleanly
 * (used by GatewayGate on every fresh authenticated transition, including
 * a re-login after a session-expiry logout).
 */
export function startManagedAgentSupervisor(onSessionExpired: () => void): void {
  stopManagedAgentSupervisor();
  const sup: Supervisor = {
    unsubscribe: () => {},
    timer: null,
    attempt: 0,
    lastStatus: null,
    onSessionExpired,
    stopped: false,
  };
  supervisor = sup;
  sup.unsubscribe = usePanda.subscribe((state) => {
    const status = state.connections[MANAGED_INSURANCE_PROFILE_ID]?.connection.status ?? null;
    if (status === sup.lastStatus) return;
    const previous = sup.lastStatus;
    sup.lastStatus = status;
    if (status === 'connected') {
      sup.attempt = 0;
      if (sup.timer !== null) {
        clearTimeout(sup.timer);
        sup.timer = null;
      }
      return;
    }
    if (status === 'error' && previous !== 'error') {
      void handleFailure(sup);
    }
  });
  connectManagedInsuranceAgent();
}

/** Stops watching and cancels any pending retry -- called on logout, and
 * internally once the session is confirmed expired. Never itself closes the
 * WebSocket; that's GatewayGate's job (closeAllLiveConnections), so logout
 * ordering stays explicit at the call site. */
export function stopManagedAgentSupervisor(): void {
  if (!supervisor) return;
  supervisor.stopped = true;
  supervisor.unsubscribe();
  if (supervisor.timer !== null) clearTimeout(supervisor.timer);
  supervisor = null;
}

/** Test-only: whether a supervisor is currently running. */
export function __managedAgentSupervisorActive(): boolean {
  return supervisor !== null;
}
