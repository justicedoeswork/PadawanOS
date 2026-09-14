import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
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

  const { port, close } = await startTestGateway({
    insuranceAgentAcpUrl: `ws://127.0.0.1:${mockAgent.port}/acp`,
    acpGatewayServiceKey: TEST_SERVICE_KEY,
    allowedUserId: TEST_USER_ID,
    allowedRealmId: TEST_REALM_ID
  });
  cleanupGateway = close;

  const validCookie = `pg_session=${createSessionToken(TEST_SESSION_SECRET)}`;

  return { gatewayPort: port, agent: mockAgent, validCookie };
}

function connectRaw(
  port: number,
  { origin, cookie }: { origin?: string; cookie?: string }
): Promise<{ outcome: 'open' | 'rejected' | 'error'; statusCode?: number; ws?: WebSocket }> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers['Origin'] = origin;
    if (cookie !== undefined) headers['Cookie'] = cookie;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/acp/insurance`, { headers });
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
});
