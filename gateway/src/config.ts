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
   * Communications Agent REST API root. This integration is deliberately
   * read-only: the gateway receives only COMMUNICATIONS_API_READ_KEY and
   * exposes a narrow GET allowlist to the signed-in JusticeOS browser.
   * No write/approval/send credential is accepted here.
   */
  communicationsAgentBaseUrl: requireEnv('COMMUNICATIONS_AGENT_BASE_URL'),
  communicationsApiReadKey: requireEnv('COMMUNICATIONS_API_READ_KEY'),

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

export function isCommunicationsAgentConfigured(): boolean {
  return Boolean(config.communicationsAgentBaseUrl && config.communicationsApiReadKey);
}

/** The operator identity recorded upstream: an explicit override, else the single owner the ACP side already asserts. */
export function marketingAgentActor(): string | null {
  return config.marketingAgentActor || config.allowedUserId;
}

export function isAcpUpstreamConfigured(): boolean {
  return Boolean(
    config.insuranceAgentAcpUrl &&
      config.acpGatewayServiceKey &&
      config.allowedUserId &&
      config.allowedRealmId
  );
}
