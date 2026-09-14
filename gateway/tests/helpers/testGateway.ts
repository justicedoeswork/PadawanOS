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
