/**
 * Same-origin gateway-session client (Phase 3, requirements #1-#3): the
 * browser's only channel to the JusticeOS gateway's auth routes
 * (`gateway/src/auth.ts`). Every call is a plain same-origin `fetch` with
 * `credentials: 'same-origin'` -- the gateway's session cookie is HttpOnly
 * (see gateway/src/cookies.ts), so it rides along on these requests
 * automatically without this module (or anything else in the browser) ever
 * touching the cookie jar directly. There is deliberately no other state here: no
 * password, cookie, token or session id is ever written to a variable that
 * outlives one call, and none of it is ever persisted to any browser storage
 * mechanism -- `GET /acp/session` is the one source of truth for "am I
 * logged in".
 */

const SESSION_PATH = '/acp/session';
const LOGOUT_PATH = '/acp/logout';

export type SessionCheck =
  | { status: 'authenticated' }
  | { status: 'unauthenticated' }
  /** Network failure, or the gateway answered with something other than a
   * well-formed 200 -- indistinguishable from "gateway unreachable" from
   * here, and handled the same way by callers (retry, don't assume logged
   * out). */
  | { status: 'unavailable' };

/** `GET /acp/session`: the one source of truth for authentication state. */
export async function checkGatewaySession(): Promise<SessionCheck> {
  let res: Response;
  try {
    res = await fetch(SESSION_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return { status: 'unavailable' };
  }
  if (!res.ok) return { status: 'unavailable' };
  try {
    const body = (await res.json()) as { authenticated?: unknown };
    return body.authenticated === true ? { status: 'authenticated' } : { status: 'unauthenticated' };
  } catch {
    return { status: 'unavailable' };
  }
}

export type LoginOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'throttled' }
  /** Covers both a network failure and every gateway response this client
   * doesn't have specific copy for (5xx, malformed body, misconfiguration) --
   * all of it reads to Austin as "try again in a moment", never as a wrong
   * password. */
  | { ok: false; reason: 'unavailable' };

/** `POST /acp/session`: attempts one login with the given password. The
 * password lives only in this call's stack frame and the caller's own
 * component state -- never persisted, never logged. */
export async function loginToGateway(password: string): Promise<LoginOutcome> {
  let res: Response;
  try {
    res = await fetch(SESSION_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, reason: 'throttled' };
  if (res.status === 401) return { ok: false, reason: 'invalid' };
  return { ok: false, reason: 'unavailable' };
}

/** `POST /acp/logout`: best-effort. The caller (GatewayGate) clears its own
 * in-memory authenticated state and returns to login regardless of whether
 * this network call actually reaches the gateway (requirement #12) -- a
 * dropped logout request must never strand Austin on a page that still acts
 * logged in. */
export async function logoutOfGateway(): Promise<void> {
  try {
    await fetch(LOGOUT_PATH, { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Best-effort; see doc comment above.
  }
}
