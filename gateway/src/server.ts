import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { config } from './config.js';
import { createAuthRouter } from './auth.js';
import { createStaticSiteRouter } from './staticSite.js';
import { attachAcpProxy, type AcpProxyHandle } from './acpProxy.js';
import { logError, logInfo } from './log.js';

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

  const acpUpstreamUrl = overrides.insuranceAgentAcpUrl ?? config.insuranceAgentAcpUrl;
  const serviceKey = overrides.acpGatewayServiceKey ?? config.acpGatewayServiceKey;
  const userId = overrides.allowedUserId ?? config.allowedUserId;
  const realmId = overrides.allowedRealmId ?? config.allowedRealmId;

  if (!sessionSecret) {
    logError('PADAWAN_SESSION_SECRET is not set -- login/session routes will refuse to work.');
  } else if (!gatewayPassword && !gatewayPasswordHash) {
    logError('Neither PADAWAN_GATEWAY_PASSWORD nor PADAWAN_GATEWAY_PASSWORD_HASH is set -- login will always fail.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use(
    createAuthRouter({
      sessionSecret,
      gatewayPassword,
      gatewayPasswordHash,
      isProduction
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
          logInfo(`PadawanOS gateway listening on port ${boundPort}`);
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
