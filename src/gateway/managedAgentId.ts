/**
 * Leaf module: just the managed Insurance Agent's identity and URL
 * derivation, with no dependency on the store or the connection manager.
 * Split out from managedAgent.ts specifically so store.ts (which needs the
 * id to pin the managed connection first in sidebar order, requirement #9)
 * can import it without a store.ts -> managedAgent.ts -> store.ts cycle.
 */

/** Fixed, well-known profile id -- every UI spot that needs to recognize
 * "this is the managed one" (Sidebar badge, ordering) compares against it
 * directly rather than carrying a separate flag through the profile schema. */
export const MANAGED_INSURANCE_PROFILE_ID = 'managed-insurance-agent';

/** Same-origin WebSocket URL for the gateway's ACP proxy (requirement #7):
 * derived from window.location at call time, never hardcoded and never a
 * production hostname baked into the bundle -- a build served from any
 * origin (a Fly app rename, a future custom domain) resolves correctly
 * without a rebuild. Carries no session or secret (requirement #8) -- the
 * gateway authenticates the WebSocket upgrade off the same-origin cookie,
 * never a URL parameter. */
export function managedInsuranceAgentUrl(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/acp/insurance`;
}
