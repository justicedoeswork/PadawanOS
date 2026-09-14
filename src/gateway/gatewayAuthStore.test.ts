import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./session', () => ({
  checkGatewaySession: vi.fn(),
  loginToGateway: vi.fn(),
  logoutOfGateway: vi.fn(async () => {}),
}));
vi.mock('./managedAgent', () => ({
  ensureManagedInsuranceProfile: vi.fn(),
  startManagedAgentSupervisor: vi.fn(),
  stopManagedAgentSupervisor: vi.fn(),
}));
vi.mock('../liveConnections', () => ({
  closeAllLiveConnections: vi.fn(),
}));

import { checkGatewaySession, loginToGateway, logoutOfGateway } from './session';
import { ensureManagedInsuranceProfile, startManagedAgentSupervisor, stopManagedAgentSupervisor } from './managedAgent';
import { closeAllLiveConnections } from '../liveConnections';
import { useGatewayAuth } from './gatewayAuthStore';
import { messages } from '../i18n/messages';

const mockedCheck = vi.mocked(checkGatewaySession);
const mockedLogin = vi.mocked(loginToGateway);
const mockedLogout = vi.mocked(logoutOfGateway);
const mockedEnsure = vi.mocked(ensureManagedInsuranceProfile);
const mockedStart = vi.mocked(startManagedAgentSupervisor);
const mockedStop = vi.mocked(stopManagedAgentSupervisor);
const mockedCloseAll = vi.mocked(closeAllLiveConnections);

beforeEach(() => {
  vi.clearAllMocks();
  useGatewayAuth.setState({ phase: 'checking', busy: false, notice: null, noticeKind: 'info' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkSession (requirement #2: GET /acp/session is the source of truth)', () => {
  it('authenticated: seeds the managed profile, starts the supervisor, settles on the authenticated phase', async () => {
    mockedCheck.mockResolvedValue({ status: 'authenticated' });
    await useGatewayAuth.getState().checkSession();
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('authenticated');
    expect(state.notice).toBeNull();
    expect(state.busy).toBe(false);
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(mockedStart.mock.calls[0]![0]).toBeTypeOf('function');
  });

  it('unauthenticated startup: lands on the login phase with no notice', async () => {
    mockedCheck.mockResolvedValue({ status: 'unauthenticated' });
    await useGatewayAuth.getState().checkSession();
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('login');
    expect(state.notice).toBeNull();
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('unavailable: lands on the login phase with an unavailable notice, not an "invalid password" one', async () => {
    mockedCheck.mockResolvedValue({ status: 'unavailable' });
    await useGatewayAuth.getState().checkSession();
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('login');
    expect(state.notice).toBe(messages['gateway.unavailable'].en);
    expect(state.noticeKind).toBe('error');
  });
});

describe('login', () => {
  it('sets busy synchronously, then settles authenticated on success', async () => {
    mockedLogin.mockResolvedValue({ ok: true });
    const promise = useGatewayAuth.getState().login('correct-password');
    expect(useGatewayAuth.getState().busy).toBe(true);
    await promise;
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('authenticated');
    expect(state.busy).toBe(false);
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
    expect(mockedStart).toHaveBeenCalledTimes(1);
  });

  it('invalid credentials: generic message, stays on login, not busy', async () => {
    mockedLogin.mockResolvedValue({ ok: false, reason: 'invalid' });
    await useGatewayAuth.getState().login('wrong');
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('login');
    expect(state.busy).toBe(false);
    expect(state.notice).toBe(messages['gateway.invalidCredentials'].en);
  });

  it('throttled: a distinct message from invalid credentials', async () => {
    mockedLogin.mockResolvedValue({ ok: false, reason: 'throttled' });
    await useGatewayAuth.getState().login('wrong');
    expect(useGatewayAuth.getState().notice).toBe(messages['gateway.throttled'].en);
  });

  it('unavailable: a distinct "temporarily unavailable" message', async () => {
    mockedLogin.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await useGatewayAuth.getState().login('correct-password');
    expect(useGatewayAuth.getState().notice).toBe(messages['gateway.unavailable'].en);
  });
});

describe('logout (requirement #12)', () => {
  it('stops the supervisor, closes every WebSocket, calls POST /acp/logout, and returns to login', async () => {
    useGatewayAuth.setState({ phase: 'authenticated', busy: false, notice: null, noticeKind: 'info' });
    await useGatewayAuth.getState().logout();
    expect(mockedStop).toHaveBeenCalledTimes(1);
    expect(mockedCloseAll).toHaveBeenCalledTimes(1);
    expect(mockedLogout).toHaveBeenCalledTimes(1);
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('login');
    expect(state.busy).toBe(false);
    expect(state.notice).toBeNull();
  });

  it('still returns to login even if the network call to the gateway unexpectedly throws', async () => {
    // logoutOfGateway is documented to never reject (session.ts catches
    // internally) -- this exercises the store's own defense-in-depth catch,
    // so a future regression there still can't strand Austin on a stale
    // "logging out…" screen.
    mockedLogout.mockRejectedValue(new Error('network down'));
    useGatewayAuth.setState({ phase: 'authenticated', busy: false, notice: null, noticeKind: 'info' });
    await useGatewayAuth.getState().logout();
    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('login');
    expect(state.busy).toBe(false);
  });
});

describe('session-expiry callback wired into the supervisor (requirement #11)', () => {
  it('closes connections and returns to login with a session-expired notice', async () => {
    mockedCheck.mockResolvedValue({ status: 'authenticated' });
    await useGatewayAuth.getState().checkSession();
    expect(useGatewayAuth.getState().phase).toBe('authenticated');

    const onSessionExpired = mockedStart.mock.calls[0]![0];
    onSessionExpired();

    const state = useGatewayAuth.getState();
    expect(state.phase).toBe('login');
    expect(state.notice).toBe(messages['gateway.sessionExpired'].en);
    expect(state.noticeKind).toBe('error');
    // closeAllLiveConnections was called once for the checkSession ->
    // authenticated path (zero) and once here.
    expect(mockedCloseAll).toHaveBeenCalledTimes(1);
  });
});
