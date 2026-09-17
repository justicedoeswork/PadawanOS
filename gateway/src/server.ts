import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { config, marketingAgentActor } from './config.js';
import { createAuthRouter } from './auth.js';
import { createHealthRouter } from './health.js';
import { createAcpApiFallbackRouter } from './acpApiFallback.js';
import { createMarketingRouter } from './marketingRoutes.js';
import { createStaticSiteRouter } from './staticSite.js';
import { attachAcpProxy, type AcpProxyHandle } from './acpProxy.js';
import { assertProductionConfigIsValid } from './configValidation.js';
import { logError, logInfo } from './log.js';
import type { MarketingAgentClient } from './marketingAgentClient.js';

export interface GatewayOverrides {
  port?: number;
  distDir?: string;
  sessionSecret?: string | null;
  gatewayPassword?: string | null;
  gatewayPasswordHash?: string | null;
  allowedOrigins?: string[];
  insuranceAgentAcpUrl?: string | null;
  acpGatewayServiceKey?: string | null;
  allowedUserId?: string | null;
  allowedRealmId?: string | null;
  isProduction?: boolean;
  maxConnections?: number;
  marketingAgentBaseUrl?: string | null;
  marketingAgentApiKey?: string | null;
  marketingAgentActor?: string | null;
  marketingAgentTimeoutMs?: number;
  /** Test seam: an already-built Marketing Agent client, so a test never needs a real upstream or a real key. */
  marketingAgentClient?: MarketingAgentClient;
}

export interface GatewayInstance {
  app: express.Express;
  server: http.Server;
  acpProxy: AcpProxyHandle | null;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

/**
 * Builds (but does not start) one gateway instance. Every field that
 * matters for auth/security is resolved here from an explicit
 * override falling back to the real environment config -- tests
 * always pass overrides, so they never touch process.env or spawn a
 * subprocess to exercise a different configuration. See
 * tests/helpers/testGateway.ts.
 */
export function createGatewayServer(overrides: GatewayOverrides = {}): GatewayInstance {
  const sessionSecret = overrides.sessionSecret ?? config.sessionSigningSecret;
  const gatewayPassword = overrides.gatewayPassword ?? config.gatewayPassword;
  const gatewayPasswordHash = overrides.gatewayPasswordHash ?? config.gatewayPasswordHash;
  const allowedOrigins = overrides.allowedOrigins ?? config.allowedOrigins;
  const isProduction = overrides.isProduction ?? config.isProduction;
  const distDir = overrides.distDir ?? path.resolve(process.cwd(), '..', config.distDirName);

  const marketingBaseUrl = overrides.marketingAgentBaseUrl ?? config.marketingAgentBaseUrl;
  const marketingApiKey = overrides.marketingAgentApiKey ?? config.marketingAgentApiKey;
  const marketingActor = overrides.marketingAgentActor ?? marketingAgentActor();

  const acpUpstreamUrl = overrides.insuranceAgentAcpUrl ?? config.insuranceAgentAcpUrl;
  const serviceKey = overrides.acpGatewayServiceKey ?? config.acpGatewayServiceKey;
  const userId = overrides.allowedUserId ?? config.allowedUserId;
  const realmId = overrides.allowedRealmId ?? config.allowedRealmId;

  // Production-only startup gate: refuses to start rather than merely
  // logging when required config is missing or too weak. Skipped
  // entirely outside production, so the throwaway secrets and
  // ws://127.0.0.1 upstream URL every test and `pnpm dev` run relies
  // on are unaffected -- see configValidation.ts.
  if (isProduction) {
    assertProductionConfigIsValid({
      gatewayPassword,
      gatewayPasswordHash,
      sessionSecret,
      acpGatewayServiceKey: serviceKey,
      allowedOrigins,
      insuranceAgentAcpUrl: acpUpstreamUrl,
      allowedUserId: userId,
      allowedRealmId: realmId,
      marketingAgentBaseUrl: marketingBaseUrl,
      marketingAgentApiKey: marketingApiKey
    });
  }

  if (!sessionSecret) {
    logError('JUSTICEOS_SESSION_SECRET is not set -- login/session routes will refuse to work.');
  } else if (!gatewayPassword && !gatewayPasswordHash) {
    logError('Neither JUSTICEOS_GATEWAY_PASSWORD nor JUSTICEOS_GATEWAY_PASSWORD_HASH is set -- login will always fail.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Ahead of everything else: a health check must answer even when
  // session/ACP config is entirely missing (e.g. before secrets are
  // set on a freshly-provisioned machine), and must never depend on
  // config it isn't allowed to reveal.
  app.use(createHealthRouter());

  app.use(
    createAuthRouter({
      sessionSecret,
      gatewayPassword,
      gatewayPasswordHash,
      isProduction
    })
  );

  // Before the /acp fallback and the SPA catch-all: JusticeOS's
  // authenticated bridge to the Marketing Agent. Registering it
  // unconditionally (even with no upstream configured) is deliberate --
  // an unconfigured integration must answer a clear JSON error, not
  // fall through to index.html. A missing/unreachable Marketing Agent
  // never affects login or ACP chat.
  app.use(
    createMarketingRouter({
      sessionSecret,
      baseUrl: marketingBaseUrl,
      apiKey: marketingApiKey,
      actor: marketingActor,
      ...(overrides.marketingAgentTimeoutMs !== undefined ? { timeoutMs: overrides.marketingAgentTimeoutMs } : {}),
      ...(overrides.marketingAgentClient ? { client: overrides.marketingAgentClient } : {})
    })
  );

  const server = http.createServer(app);

  let acpProxy: AcpProxyHandle | null = null;

  if (sessionSecret && acpUpstreamUrl && serviceKey && userId && realmId) {
    acpProxy = attachAcpProxy(server, {
      sessionSecret,
      allowedOrigins,
      insuranceAgentAcpUrl: acpUpstreamUrl,
      acpGatewayServiceKey: serviceKey,
      allowedUserId: userId,
      allowedRealmId: realmId,
      ...(overrides.maxConnections !== undefined ? { maxConnections: overrides.maxConnections } : {})
    });
  } else {
    logError(
      'ACP proxy is not configured (missing session secret, upstream URL, service key, or allowed user/realm) -- /acp/insurance will not be available.'
    );
  }

  // After the real /acp/* routes but before the SPA fallback: anything
  // under /acp/ that isn't a WebSocket upgrade or a route the auth
  // router handled (wrong method, unknown path) gets an API-shaped
  // 404/405 here instead of falling through to index.html.
  app.use(createAcpApiFallbackRouter());

  // Static site last -- its GET '*' fallback must never shadow the API/ACP routes above.
  app.use(createStaticSiteRouter(distDir));

  return {
    app,
    server,
    acpProxy,
    listen(): Promise<{ port: number }> {
      const port = overrides.port ?? config.port;

      return new Promise((resolve) => {
        server.listen(port, '0.0.0.0', () => {
          const boundPort = (server.address() as { port: number }).port;
          logInfo(`JusticeOS gateway listening on port ${boundPort}`);
          resolve({ port: boundPort });
        });
      });
    },
    close(): Promise<void> {
      acpProxy?.closeAll();

      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}
