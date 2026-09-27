import { afterEach, describe, expect, it } from 'vitest';
import { loginForTestCookie, startTestGateway, TEST_USER_ID } from './helpers/testGateway.js';
import type { ManagerApiClient, ManagerApiResult } from '../src/managerApiClient.js';

let cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

function fakeClient() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const client: ManagerApiClient = {
    async request(method, path, body): Promise<ManagerApiResult> {
      calls.push({ method, path, body });
      if (path === '/health') return { kind: 'response', status: 200, body: { ok: true } };
      if (path === '/conversations/open') {
        return { kind: 'response', status: 200, body: { data: { id: '11111111-1111-4111-8111-111111111111' } } };
      }
      if (path.endsWith('/turns') && method === 'GET') {
        return { kind: 'response', status: 200, body: { data: [] } };
      }
      return { kind: 'response', status: 201, body: { data: { id: 'turn-1' } } };
    }
  };
  return { client, calls };
}

describe('persistent manager gateway bridge', () => {
  it('requires the JusticeOS session before contacting the manager backend', async () => {
    const fake = fakeClient();
    const { port, close } = await startTestGateway({
      managerApiUrl: 'https://manager.example.test',
      managerServiceKey: 'x'.repeat(32),
      managerApiClient: fake.client
    });
    cleanups.push(close);

    const res = await fetch(`http://127.0.0.1:${port}/api/manager/conversations/open`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
  });

  it('injects the configured owner identity server-side when opening a conversation', async () => {
    const fake = fakeClient();
    const { port, close } = await startTestGateway({
      allowedUserId: TEST_USER_ID,
      managerApiUrl: 'https://manager.example.test',
      managerServiceKey: 'x'.repeat(32),
      managerApiClient: fake.client
    });
    cleanups.push(close);
    const cookie = await loginForTestCookie(port);

    const res = await fetch(`http://127.0.0.1:${port}/api/manager/conversations/open`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });

    expect(res.status).toBe(200);
    expect(fake.calls.at(-1)).toEqual({
      method: 'POST',
      path: '/conversations/open',
      body: { userId: TEST_USER_ID, title: 'Padawan' }
    });
  });

  it('injects the configured owner identity when surfacing a manager event', async () => {
    const fake = fakeClient();
    const { port, close } = await startTestGateway({
      allowedUserId: TEST_USER_ID,
      managerApiUrl: 'https://manager.example.test',
      managerServiceKey: 'x'.repeat(32),
      managerApiClient: fake.client
    });
    cleanups.push(close);
    const cookie = await loginForTestCookie(port);
    const eventId = '22222222-2222-4222-8222-222222222222';

    const res = await fetch(`http://127.0.0.1:${port}/api/manager/events/${eventId}/surface`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'attacker-selected-user' })
    });

    expect(res.status).toBe(201);
    expect(fake.calls.at(-1)).toEqual({
      method: 'POST',
      path: `/events/${eventId}/surface`,
      body: { userId: TEST_USER_ID }
    });
  });

  it('forwards only bounded manager-turn fields, never browser credentials', async () => {
    const fake = fakeClient();
    const { port, close } = await startTestGateway({
      allowedUserId: TEST_USER_ID,
      managerApiUrl: 'https://manager.example.test',
      managerServiceKey: 'x'.repeat(32),
      managerApiClient: fake.client
    });
    cleanups.push(close);
    const cookie = await loginForTestCookie(port);
    const id = '11111111-1111-4111-8111-111111111111';

    const res = await fetch(`http://127.0.0.1:${port}/api/manager/conversations/${id}/turns`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Authorization: 'Bearer browser-key' },
      body: JSON.stringify({ role: 'user', content: 'Catch me up', ignored: 'do not forward' })
    });

    expect(res.status).toBe(201);
    expect(fake.calls.at(-1)).toEqual({
      method: 'POST',
      path: `/conversations/${id}/turns`,
      body: { role: 'user', content: 'Catch me up', intent: null, sourceRefs: [] }
    });
  });
});
