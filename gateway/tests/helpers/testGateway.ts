import { createGatewayServer, type GatewayOverrides, type GatewayInstance } from '../../src/server.js';
import { resetLoginThrottleForTests } from '../../src/loginThrottle.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const TEST_PASSWORD = 'correct-horse-battery-staple';
export const TEST_SESSION_SECRET = 'test-session-secret-do-not-use-in-real-life';
export const TEST_SERVICE_KEY = 'test-service-key-do-not-use-in-real-life';
export const TEST_USER_ID = 'austin';
export const TEST_REALM_ID = '9130357381765966';
export const TEST_ORIGIN = 'http://127.0.0.1:5173';

/**
 * A config that satisfies configValidation.ts's production gate,
 * for the handful of tests that specifically exercise
 * `isProduction: true` behavior (e.g. the Secure cookie flag) and so
 * can't use the throwaway defaults above, which are deliberately weak.
 * TEST_PRODUCTION_PASSWORD_HASH is the scrypt hash (see password.ts)
 * of TEST_PASSWORD, so logging in with TEST_PASSWORD still succeeds.
 */
export const TEST_PRODUCTION_PASSWORD_HASH =
  'ddbb23de8d20cde044c7c576fb37639d:105da2541e9e7f8ded99e14e2bd82580f90ad3daffb54091cb276267944cd11975911d72bad4df38f82dad68fc01c7723f80c3749753d9dd84b06fd5efc8c72e';
export const TEST_PRODUCTION_SESSION_SECRET = 'a'.repeat(32);
export const TEST_PRODUCTION_SERVICE_KEY = 'b'.repeat(32);
export const TEST_PRODUCTION_ORIGIN = 'https://padawanos.example.com';
export const TEST_PRODUCTION_ACP_URL = 'ws://insurance-agent.internal:9000/acp';

export const TEST_PRODUCTION_OVERRIDES: GatewayOverrides = {
  isProduction: true,
  sessionSecret: TEST_PRODUCTION_SESSION_SECRET,
  gatewayPassword: null,
  gatewayPasswordHash: TEST_PRODUCTION_PASSWORD_HASH,
  allowedOrigins: [TEST_PRODUCTION_ORIGIN],
  insuranceAgentAcpUrl: TEST_PRODUCTION_ACP_URL,
  acpGatewayServiceKey: TEST_PRODUCTION_SERVICE_KEY,
  allowedUserId: TEST_USER_ID,
  allowedRealmId: TEST_REALM_ID
};

/**
 * Every test gets its own instance with its own explicit config --
 * never real environment variables, never shared state between tests
 * (login-throttle state is reset here too, since it's a module-level
 * map).
 */
export async function startTestGateway(overrides: GatewayOverrides = {}): Promise<{
  instance: GatewayInstance;
  port: number;
  close: () => Promise<void>;
}> {
  resetLoginThrottleForTests();

  // A directory with no index.html -- the static-site fallback path is
  // exercised deliberately, since none of these tests care about the
  // actual built frontend.
  const emptyDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-gateway-test-dist-'));

  const instance = createGatewayServer({
    port: 0,
    distDir: emptyDistDir,
    sessionSecret: TEST_SESSION_SECRET,
    gatewayPassword: TEST_PASSWORD,
    gatewayPasswordHash: null,
    allowedOrigins: [TEST_ORIGIN],
    isProduction: false,
    ...overrides
  });

  const { port } = await instance.listen();

  return {
    instance,
    port,
    close: () => instance.close()
  };
}
