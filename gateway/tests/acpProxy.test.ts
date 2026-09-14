import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import net from 'node:net';
import {
  startTestGateway,
  TEST_SERVICE_KEY,
  TEST_USER_ID,
  TEST_REALM_ID,
  TEST_ORIGIN,
  TEST_SESSION_SECRET
} from './helpers/testGateway.js';
import { startMockAcpAgent, type MockAcpAgent } from './helpers/mockAcpAgent.js';
import { createSessionToken } from '../src/session.js';

/**
 * A TCP server that accepts the connection but never writes an HTTP
 * response -- stands in for an Insurance Agent whose upstream
 * WebSocket handshake never completes, so tests can exercise the
 * pre-upstream buffer limits and the handshake timeout without a real
 * hung agent.
 */
function startHangingUpstream(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

let cleanupGateway: (() => Promise<void>) | null = null;
let mockAgent: MockAcpAgent | null = null;

afterEach(async () => {
  if (cleanupGateway) await cleanupGateway();
  if (mockAgent) await mockAgent.close();
  cleanupGateway = null;
  mockAgent = null;
});

async function setup() {
  mockAgent = await startMockAcpAgent({
    expectedServiceKey: TEST_SERVICE_KEY,
    expectedUserId: TEST_USER_ID,
    expectedRealmId: TEST_REALM_ID
  });

  const { port, close, instance } = await startTestGateway({
    insuranceAgentAcpUrl: `ws://127.0.0.1:${mockAgent.port}/acp`,
    acpGatewayServiceKey: TEST_SERVICE_KEY,
    allowedUserId: TEST_USER_ID,
    allowedRealmId: TEST_REALM_ID
  });
  cleanupGateway = close;

  const validCookie = `pg_session=${createSessionToken(TEST_SESSION_SECRET)}`;

  return { gatewayPort: port, agent: mockAgent, validCookie, instance };
}

/** Same gateway setup, but pointed at an upstream that never completes its WebSocket handshake. */
async function setupWithHangingUpstream() {
  const hanging = await startHangingUpstream();

  const { port, close, instance } = await startTestGateway({
    insuranceAgentAcpUrl: `ws://127.0.0.1:${hanging.port}/acp`,
    acpGatewayServiceKey: TEST_SERVICE_KEY,
    allowedUserId: TEST_USER_ID,
    allowedRealmId: TEST_REALM_ID
  });
  cleanupGateway = async () => {
    hanging.close();
    await close();
  };

  const validCookie = `pg_session=${createSessionToken(TEST_SESSION_SECRET)}`;

  return { gatewayPort: port, validCookie, instance };
}

function connectRaw(
  port: number,
  { origin, cookie, path = '/acp/insurance' }: { origin?: string; cookie?: string; path?: string }
): Promise<{ outcome: 'open' | 'rejected' | 'error'; statusCode?: number; ws?: WebSocket }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers['Origin'] = origin;
    if (cookie !== undefined) headers['Cookie'] = cookie;

    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    let settled = false;

    ws.on('open', () => {
      if (settled) return;
      settled = true;
      resolve({ outcome: 'open', ws });
    });

    ws.on('unexpected-response', (_req, res) => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve({ outcome: 'rejected', statusCode: res.statusCode });
    });

    ws.on('error', () => {
      if (settled) return;
      settled = true;
      resolve({ outcome: 'error' });
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve({ outcome: 'error' });
    }, 3000);
  });
}

describe('/acp/insurance upgrade auth', () => {
  it('rejects a missing session cookie', async () => {
    const { gatewayPort } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN });
    expect(result.outcome).not.toBe('open');
  });

  it('rejects a missing Origin header', async () => {
    const { gatewayPort, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, { cookie: validCookie });
    expect(result.outcome).not.toBe('open');
  });

  it('rejects a disallowed Origin even with a valid session', async () => {
    const { gatewayPort, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, {
      origin: 'https://not-padawanos.example.com',
      cookie: validCookie
    });
    expect(result.outcome).not.toBe('open');
  });

  it('accepts a valid session cookie and allowed Origin', async () => {
    const { gatewayPort, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    result.ws?.close();
  });

  it('rejects an upgrade to an unrecognized path promptly, rather than hanging', async () => {
    const { gatewayPort, validCookie } = await setup();

    const start = Date.now();
    const result = await connectRaw(gatewayPort, {
      origin: TEST_ORIGIN,
      cookie: validCookie,
      path: '/acp/not-a-real-agent'
    });
    const elapsedMs = Date.now() - start;

    expect(result.outcome).not.toBe('open');
    // "promptly" means well under connectRaw's own 3s give-up timeout --
    // an unknown path is rejected synchronously in the upgrade handler.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('rejects an upgrade to an unrecognized top-level path promptly, rather than hanging', async () => {
    const { gatewayPort } = await setup();

    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, path: '/socket' });
    expect(result.outcome).not.toBe('open');
  });
});

describe('/acp/insurance upstream relay', () => {
  it('opens exactly one upstream connection per accepted browser connection, with the correct auth/identity headers', async () => {
    const { gatewayPort, agent, validCookie } = await setup();

    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');

    await new Promise((r) => setTimeout(r, 200));

    expect(agent.connections).toHaveLength(1);
    const upstreamHeaders = agent.connections[0]?.headers;
    expect(upstreamHeaders?.['authorization']).toBe(`Bearer ${TEST_SERVICE_KEY}`);
    expect(upstreamHeaders?.['x-acp-user-id']).toBe(TEST_USER_ID);
    expect(upstreamHeaders?.['x-acp-realm-id']).toBe(TEST_REALM_ID);

    result.ws?.close();
  });

  it('reconnecting opens a fresh upstream connection rather than reusing one', async () => {
    const { gatewayPort, agent, validCookie } = await setup();

    const first = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    await new Promise((r) => setTimeout(r, 150));
    expect(agent.connections).toHaveLength(1);
    first.ws?.close();
    await new Promise((r) => setTimeout(r, 150));

    const second = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    await new Promise((r) => setTimeout(r, 150));
    expect(agent.connections).toHaveLength(2);

    second.ws?.close();
  });

  it('relays individual JSON-RPC frames in both directions without combining or splitting', async () => {
    const { gatewayPort, agent, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    // Deliberately shaped to tempt a naive newline-join/split bug:
    // embedded braces and no trailing newline.
    const frames = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { note: '{"nested":true}' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { text: 'line one\nline two' } })
    ];

    const received: string[] = [];
    ws.on('message', (data) => received.push(data.toString('utf8')));

    for (const frame of frames) {
      ws.send(frame);
      // Small gap so frames are unambiguously separate sends.
      await new Promise((r) => setTimeout(r, 20));
    }

    await new Promise((r) => setTimeout(r, 200));

    expect(agent.connections[0]?.receivedMessages).toEqual(frames);

    // The mock agent replies to id 1 (initialize) with a real result --
    // confirms the return path is frame-accurate too.
    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]!) as { id: number; result: { agentInfo: { name: string } } };
    expect(parsed.id).toBe(1);
    expect(parsed.result.agentInfo.name).toBe('mock-agent');

    ws.close();
  });

  it('rejects an oversized frame instead of crashing the connection pair', async () => {
    const { gatewayPort, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));

    const oversized = 'x'.repeat(400 * 1024); // over the 256KB limit
    ws.send(oversized);

    const closeCode = await closed;
    expect(closeCode).not.toBe(1000); // not a normal close
  });

  it('propagates a downstream close to the upstream connection', async () => {
    const { gatewayPort, agent, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');

    await new Promise((r) => setTimeout(r, 150));
    const upstreamSocket = agent.connections[0]!.socket;
    const upstreamClosed = new Promise<void>((resolve) => upstreamSocket.once('close', () => resolve()));

    result.ws!.close(1000, 'client done');

    await upstreamClosed; // resolves or the test times out
  });

  it('propagates an upstream close to the downstream connection', async () => {
    const { gatewayPort, agent, validCookie } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    await new Promise((r) => setTimeout(r, 150));
    const downstreamClosed = new Promise<void>((resolve) => ws.once('close', () => resolve()));

    agent.connections[0]!.socket.close(1000, 'agent done');

    await downstreamClosed;
  });

  it('cleans up exactly once and returns the active connection count to zero, even though both sides close', async () => {
    const { gatewayPort, agent, validCookie, instance } = await setup();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    await new Promise((r) => setTimeout(r, 150));
    expect(instance.acpProxy?.activeConnectionCount()).toBe(1);
    expect(agent.connections).toHaveLength(1);

    // Closing the browser side triggers upstream.close() (see downstream's
    // 'close' handler), whose own close event ALSO fires and calls the
    // same cleanup() -- both paths run for one ordinary disconnect.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const downstreamClosed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    ws.close(1000, 'done');
    await downstreamClosed;
    await new Promise((r) => setTimeout(r, 150));

    expect(instance.acpProxy?.activeConnectionCount()).toBe(0);

    const closedLogLines = logSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('acp connection closed')
    );
    expect(closedLogLines).toHaveLength(1);

    logSpy.mockRestore();
  });
});

describe('/acp/insurance pre-upstream buffer limits', () => {
  it('closes the connection pair once the cumulative buffered byte limit is exceeded', async () => {
    const { gatewayPort, validCookie } = await setupWithHangingUpstream();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));

    // 6 frames of 200KB (each under the 256KB per-frame limit) total
    // 1.2MB, over the 1MB cumulative pre-upstream buffer limit -- the
    // upstream here never opens, so every frame stays buffered.
    const frame = 'x'.repeat(200 * 1024);
    for (let i = 0; i < 6 && ws.readyState === WebSocket.OPEN; i++) {
      ws.send(frame);
    }

    const closeCode = await closed;
    expect(closeCode).not.toBe(1000); // not a normal close
  });

  it('closes the connection pair once the buffered frame-count ceiling is exceeded', async () => {
    const { gatewayPort, validCookie } = await setupWithHangingUpstream();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));

    // 105 tiny frames trip the 100-frame ceiling long before the 1MB
    // byte ceiling could ever be reached.
    for (let i = 0; i < 105 && ws.readyState === WebSocket.OPEN; i++) {
      ws.send('ping');
    }

    const closeCode = await closed;
    expect(closeCode).not.toBe(1000);
  });

  it('never grows the buffer without bound while the upstream stays hung', async () => {
    const { gatewayPort, validCookie, instance } = await setupWithHangingUpstream();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));

    // Far more data than either limit allows, sent continuously --
    // proves the pair is torn down (and the slot freed) rather than
    // the buffer accumulating this indefinitely.
    const frame = 'x'.repeat(200 * 1024);
    for (let i = 0; i < 50 && ws.readyState === WebSocket.OPEN; i++) {
      ws.send(frame);
    }

    await closed;
    await new Promise((r) => setTimeout(r, 100));
    expect(instance.acpProxy?.activeConnectionCount()).toBe(0);
  });
});

describe('/acp/insurance upstream handshake timeout', () => {
  it('closes the browser connection with a generic error if the upstream never completes its handshake', async () => {
    const { gatewayPort, validCookie, instance } = await setupWithHangingUpstream();
    const result = await connectRaw(gatewayPort, { origin: TEST_ORIGIN, cookie: validCookie });
    expect(result.outcome).toBe('open');
    const ws = result.ws!;

    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }))
    );

    const { code, reason } = await closed;
    expect(code).not.toBe(1000);
    // Never the raw upstream/network failure detail -- a generic reason only.
    expect(reason.toLowerCase()).not.toMatch(/econnrefused|dns|enotfound|127\.0\.0\.1/);

    expect(instance.acpProxy?.activeConnectionCount()).toBe(0);
  }, 15_000);
});
