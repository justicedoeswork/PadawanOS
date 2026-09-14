import { describe, it, expect, afterEach } from 'vitest';
import { startTestGateway } from './helpers/testGateway.js';

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = null;
});

describe('GET /health', () => {
  it('answers 200 with no configuration or private data', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/health`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Deliberately narrow: only a status field, nothing describing
    // config state, secrets, or the ACP upstream.
    expect(Object.keys(body)).toEqual(['status']);
    expect(body.status).toBe('ok');
  });

  it('answers even when session/ACP config is entirely missing', async () => {
    const { port, close } = await startTestGateway({
      sessionSecret: null,
      gatewayPassword: null,
      gatewayPasswordHash: null,
      insuranceAgentAcpUrl: null,
      acpGatewayServiceKey: null,
      allowedUserId: null,
      allowedRealmId: null
    });
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('never reveals a config/secret identifier in its response body', async () => {
    const { port, close } = await startTestGateway();
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const text = await res.text();

    for (const identifier of [
      'JUSTICEOS_GATEWAY_PASSWORD',
      'JUSTICEOS_SESSION_SECRET',
      'ACP_GATEWAY_SERVICE_KEY',
      'ACP_ALLOWED_USER_ID',
      'ACP_ALLOWED_REALM_ID',
      'configured',
      'isProduction'
    ]) {
      expect(text).not.toContain(identifier);
    }
  });
});
