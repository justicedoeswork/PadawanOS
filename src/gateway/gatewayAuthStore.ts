/**
 * Gateway login gate's state (Phase 3): a small zustand store, same idiom as
 * the rest of Panda's state (store.ts), so both GatewayGate (renders it) and
 * SettingsPage (the sign-out button) can read/drive it without threading
 * props through the whole tree. Only ever constructed/used when
 * isGatewayBuild() is true -- see GatewayGate.tsx, which is the only place
 * that calls checkSession().
 */
import { create } from 'zustand';
import { checkGatewaySession, loginToGateway, logoutOfGateway } from './session';
import { ensureManagedInsuranceProfile, startManagedAgentSupervisor, stopManagedAgentSupervisor } from './managedAgent';
import { closeAllLiveConnections } from '../liveConnections';
import { t } from '../i18n';

export type GatewayAuthPhase = 'checking' | 'login' | 'authenticated';
export type GatewayNoticeKind = 'info' | 'error';

interface GatewayAuthState {
  phase: GatewayAuthPhase;
  /** True while a login or logout request is in flight -- disables the
   * form/button so a slow network can't produce a double submit. */
  busy: boolean;
  /** Pre-resolved, localized banner text (invalid/throttled/unavailable/
   * session-expired/signed-out); null = nothing to show. */
  notice: string | null;
  noticeKind: GatewayNoticeKind;
  /** `GET /acp/session` -- requirement #2: the one source of truth for
   * whether Austin is logged in. Called once on mount by GatewayGate. */
  checkSession(): Promise<void>;
  login(password: string): Promise<void>;
  logout(): Promise<void>;
}

/** Shared by both the initial-check success path and a fresh login success:
 * seeds the managed profile, starts the reconnect supervisor (which dials
 * the managed agent immediately), and settles the UI phase. */
function enterAuthenticated(set: (partial: Partial<GatewayAuthState>) => void): void {
  ensureManagedInsuranceProfile();
  startManagedAgentSupervisor(() => {
    // The managed agent's WebSocket failed AND a session recheck came back
    // unauthenticated (requirement #11) -- the login itself expired, not
    // just this one connection. Close everything and return to login.
    closeAllLiveConnections();
    set({ phase: 'login', busy: false, notice: t('gateway.sessionExpired'), noticeKind: 'error' });
  });
  set({ phase: 'authenticated', busy: false, notice: null });
}

export const useGatewayAuth = create<GatewayAuthState>((set) => ({
  phase: 'checking',
  busy: false,
  notice: null,
  noticeKind: 'info',

  checkSession: async () => {
    set({ phase: 'checking' });
    const result = await checkGatewaySession();
    if (result.status === 'authenticated') {
      enterAuthenticated(set);
      return;
    }
    set({
      phase: 'login',
      notice: result.status === 'unavailable' ? t('gateway.unavailable') : null,
      noticeKind: 'error',
    });
  },

  login: async (password: string) => {
    set({ busy: true, notice: null });
    const result = await loginToGateway(password);
    if (result.ok) {
      enterAuthenticated(set);
      return;
    }
    const message =
      result.reason === 'invalid'
        ? t('gateway.invalidCredentials')
        : result.reason === 'throttled'
          ? t('gateway.throttled')
          : t('gateway.unavailable');
    // Explicit phase: 'login' rather than relying on it already being the
    // current phase (true in the real flow -- login() only ever runs from
    // the login screen) -- self-contained is one branch cheaper than a
    // future caller assuming otherwise and getting stuck.
    set({ phase: 'login', busy: false, notice: message, noticeKind: 'error' });
  },

  logout: async () => {
    set({ busy: true });
    // Local cleanup first and unconditionally (requirement #12) -- the
    // network call to tell the gateway is best-effort and must never gate
    // returning to login. logoutOfGateway() already catches internally and
    // never rejects; the try/catch here is defense in depth so a future
    // change to that contract still can't strand Austin on a stale screen.
    stopManagedAgentSupervisor();
    closeAllLiveConnections();
    try {
      await logoutOfGateway();
    } catch {
      // Best-effort, see above.
    }
    set({ phase: 'login', busy: false, notice: null, noticeKind: 'info' });
  },
}));
