/**
 * Every environment variable the gateway reads. All of it stays here,
 * on the server -- nothing in this file is ever imported by the Vite
 * frontend build (the gateway is its own workspace package, built and
 * run with tsx/node, never bundled by vite). This is what makes the
 * "never expose these to the browser bundle" requirement structural
 * rather than just a rule someone has to remember: the frontend's
 * build graph simply never reaches this file.
 */
import 'dotenv/config';

function requireEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export const config = {
  port: Number(process.env.PORT || 4600),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  /**
   * Distribution directory for the built React app (`vite build`'s
   * output). Resolved by the caller (server.ts) relative to the repo
   * root, not fixed here, so tests can point it at a scratch
   * directory without touching a real build.
   */
  distDirName: 'dist',

  /**
   * Exactly one of these two should be set. A plain password is
   * fine for a single-owner tool getting started; the hash form
   * (`scrypt` salt:hash hex, see auth.ts) is preferred once this is
   * actually deployed. Neither is ever logged or sent to a client.
   */
  gatewayPassword: requireEnv('JUSTICEOS_GATEWAY_PASSWORD'),
  gatewayPasswordHash: requireEnv('JUSTICEOS_GATEWAY_PASSWORD_HASH'),

  /** Signs/verifies the justiceos_session cookie. Distinct from every other secret here on purpose -- rotating it revokes every session without touching anything else. */
  sessionSigningSecret: requireEnv('JUSTICEOS_SESSION_SECRET'),

  /**
   * The Insurance Agent's PRIVATE ACP listener, e.g.
   * ws://insurance-audit-agent.internal:3001/acp in production (Fly
   * private networking) or ws://127.0.0.1:3001/acp for local dev
   * against a locally-run Insurance Agent. Never a public
   * insurance-audit-agent.fly.dev URL -- that's exactly the surface
   * Phase 1 closed off.
   */
  insuranceAgentAcpUrl: requireEnv('INSURANCE_AGENT_ACP_URL'),

  /**
   * The SAME shared secret value Phase 1's ACP_GATEWAY_SERVICE_KEY
   * expects on the Insurance Agent side -- this is a distinct secret
   * from AUDIT_AGENT_API_KEY (that one is for GitHub Actions cron
   * jobs hitting the Insurance Agent's admin API; this one is only
   * ever presented on the private gateway-to-agent ACP connection).
   */
  acpGatewayServiceKey: requireEnv('ACP_GATEWAY_SERVICE_KEY'),

  /** The one user/realm this gateway is allowed to act as -- sent on the upstream connection, never accepted from the browser. */
  allowedUserId: requireEnv('ACP_ALLOWED_USER_ID'),
  allowedRealmId: requireEnv('ACP_ALLOWED_REALM_ID'),

  /**
   * The Marketing Agent's REST API root, e.g.
   * http://marketing-agent.internal:8787 in production (Fly private
   * networking) or http://127.0.0.1:8787 for local dev against a
   * locally-run Marketing Agent. The gateway appends the agent's own
   * /api/marketing prefix itself -- configure the host root only.
   *
   * Unset simply means the integration is off: /api/marketing/* answers
   * MARKETING_AGENT_NOT_CONFIGURED and every other part of the gateway
   * (login, ACP chat, the SPA) is unaffected.
   */
  marketingAgentBaseUrl: requireEnv('MARKETING_AGENT_BASE_URL'),

  /**
   * The Marketing Agent's own MARKETING_AGENT_API_KEY. Presented ONLY
   * on the server-to-server call from marketingAgentClient.ts; it is
   * never sent to, readable by, or needed by the browser -- the browser
   * authenticates to this gateway with its session cookie instead.
   */
  marketingAgentApiKey: requireEnv('MARKETING_AGENT_API_KEY'),

  /**
   * Who the Marketing Agent records as the operator for actions taken
   * through this gateway. Defaults to the same single owner the ACP
   * side already asserts (ACP_ALLOWED_USER_ID), because JusticeOS's
   * login is single-owner and its session token carries no user
   * identity. Never taken from the browser.
   */
  marketingAgentActor: requireEnv('MARKETING_AGENT_ACTOR'),

  /**
   * Which side owns making the Marketing Agent tick. Exactly one owner, by
   * design -- see docs/marketing-agent-padawan-integration.md.
   *
   *   marketing-internal-loop  (default) The Marketing Agent's own
   *                            AGENT_LOOP_ENABLED loop. JusticeOS drives no
   *                            ticks on a timer; its /tick route stays as an
   *                            operator action.
   *   justiceos                JusticeOS would drive ticks. NOT implemented:
   *                            this gateway has no scheduler, and its Fly
   *                            machine scales to zero, so it cannot be a
   *                            reliable one. Declaring it only changes what
   *                            the health report says.
   *   none                     Nothing is ticking. Reported as degraded.
   */
  marketingSchedulerOwner: requireEnv('MARKETING_AGENT_SCHEDULER_OWNER'),

  /**
   * The paid-research posture this deployment was configured with. Reporting
   * only: the real switches are AGENT_EXECUTE_WEBSITE_RESEARCH and
   * AGENT_EXECUTE_WATCHLIST_RECHECK on the Marketing Agent. JusticeOS pins
   * dryRun on every research call it makes regardless of this value, so it
   * can never itself trigger provider spend (marketing/operations.ts).
   *
   *   plan-only        (default) Free/read-only monitoring continues; the
   *                    agent plans and reports research rather than spending.
   *   execute-allowed  The operator has deliberately enabled autonomous paid
   *                    research on the Marketing Agent side.
   */
  marketingResearchExecution: requireEnv('MARKETING_AGENT_RESEARCH_EXECUTION'),

  /**
   * The Communications Agent's inbound marketing-event endpoint, e.g.
   * http://communications-agent.internal:8080/api/v1/... -- a private
   * destination, same rule as every other upstream here.
   *
   * Unset means no notification path is wired: marketing events are still
   * ingested and RETAINED by JusticeOS (so Austin sees them in the app), and
   * the health report says plainly that nobody is being notified.
   */
  communicationsAgentEventUrl: requireEnv('COMMUNICATIONS_AGENT_EVENT_URL'),

  /**
   * The COMMUNICATIONS Agent's own credential -- a different secret for a
   * different service. MARKETING_AGENT_API_KEY is never sent on this path
   * (marketing/communicationsHandoff.ts, and a test that proves it).
   */
  communicationsAgentApiKey: requireEnv('COMMUNICATIONS_AGENT_API_KEY'),

  /**
   * The machine credential a scheduled driver presents to run one marketing
   * event relay cycle (POST /api/marketing/agent/events/relay).
   *
   * This gateway has no scheduler of its own and its Fly machine stops when
   * idle, so the relay is driven from outside by a platform cron. That caller
   * has no browser and no session cookie, so it needs a credential -- a
   * narrow one, for one route. It is deliberately NOT the gateway password
   * (which would grant the whole app) and NOT the Marketing Agent key (which
   * would grant approval rights upstream): the worst a leaked relay key can
   * do is make one claim -> deliver -> acknowledge cycle run early.
   *
   * Unset means the relay stays session-only: an operator can still run a
   * cycle from the app, and no cron can. Nothing falls open.
   */
  justiceOsRelayKey: requireEnv('JUSTICEOS_RELAY_KEY'),

  /**
   * Exact-match allowlist for both the WebSocket upgrade's Origin
   * header and (if the gateway is ever run split from its own
   * frontend during development) CORS. Comma-separated, e.g.
   * "https://justiceos.justiceexteriors.app,http://127.0.0.1:5173".
   */
  allowedOrigins: (process.env.JUSTICEOS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
};

export function isAuthConfigured(): boolean {
  return Boolean(config.gatewayPassword || config.gatewayPasswordHash);
}

export function isMarketingAgentConfigured(): boolean {
  return Boolean(config.marketingAgentBaseUrl && config.marketingAgentApiKey);
}

/** The operator identity recorded upstream: an explicit override, else the single owner the ACP side already asserts. */
export function marketingAgentActor(): string | null {
  return config.marketingAgentActor || config.allowedUserId;
}

export type SchedulerOwnerSetting = 'MARKETING_INTERNAL_LOOP' | 'JUSTICEOS' | 'NONE';

/** Unrecognized spellings fall back to the default owner rather than silently leaving nothing ticking. */
export function marketingSchedulerOwner(): SchedulerOwnerSetting {
  const raw = (config.marketingSchedulerOwner ?? '').toLowerCase();
  if (raw === 'justiceos') return 'JUSTICEOS';
  if (raw === 'none') return 'NONE';
  return 'MARKETING_INTERNAL_LOOP';
}

export type ResearchExecutionSetting = 'PLAN_ONLY' | 'EXECUTE_ALLOWED';

/** Anything other than an explicit opt-in is plan-only. Spending must be asked for, never inherited from a typo. */
export function marketingResearchExecution(): ResearchExecutionSetting {
  return (config.marketingResearchExecution ?? '').toLowerCase() === 'execute-allowed' ? 'EXECUTE_ALLOWED' : 'PLAN_ONLY';
}

export function isCommunicationsHandoffConfigured(): boolean {
  return Boolean(config.communicationsAgentEventUrl && config.communicationsAgentApiKey);
}

/** Whether a scheduled driver can reach the relay at all. False means the event relay is operator-triggered only. */
export function isRelayDriverConfigured(): boolean {
  return Boolean(config.justiceOsRelayKey);
}

export function isAcpUpstreamConfigured(): boolean {
  return Boolean(
    config.insuranceAgentAcpUrl &&
      config.acpGatewayServiceKey &&
      config.allowedUserId &&
      config.allowedRealmId
  );
}
