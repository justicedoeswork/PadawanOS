import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ManagerApiClient, ManagerApiResult } from '../src/managerApiClient.js';
import { PushDispatcher } from '../src/pushDispatcher.js';

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return {
    publicKey: Buffer.concat([Buffer.from([0x04]), Buffer.from(pub.x!, 'base64url'), Buffer.from(pub.y!, 'base64url')]).toString('base64url'),
    privateKey: priv.d!
  };
}

describe('PushDispatcher', () => {
  it('claims important events only after an active subscription exists and completes successful delivery', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const manager: ManagerApiClient = {
      async request(method, path, body): Promise<ManagerApiResult> {
        calls.push({ method, path, body });
        if (path.startsWith('/push/subscriptions?')) {
          return { kind: 'response', status: 200, body: { data: [{ id: 'sub-1', endpoint: 'https://push.example.test/send/1' }] } };
        }
        if (path === '/events/push/claim') {
          return { kind: 'response', status: 200, body: { data: [{ id: 'event-1', priority: 'important' }] } };
        }
        return { kind: 'response', status: 200, body: { data: {} } };
      }
    };
    const pair = keys();
    const dispatcher = new PushDispatcher({
      manager,
      userId: 'owner-1',
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: 'mailto:admin@example.test',
      fetchImpl: (async () => new Response(null, { status: 201 })) as typeof fetch
    });

    await dispatcher.runOnce();

    expect(calls).toContainEqual({
      method: 'POST',
      path: '/events/push/claim',
      body: { userId: 'owner-1', limit: 10 }
    });
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/events/event-1/push-complete',
      body: { userId: 'owner-1' }
    });
  });

  it('does not claim events when no active browser subscription exists', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const manager: ManagerApiClient = {
      async request(method, path, body): Promise<ManagerApiResult> {
        calls.push({ method, path, body });
        return { kind: 'response', status: 200, body: { data: [] } };
      }
    };
    const pair = keys();
    const dispatcher = new PushDispatcher({
      manager,
      userId: 'owner-1',
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: 'mailto:admin@example.test'
    });

    await dispatcher.runOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path.startsWith('/push/subscriptions?')).toBe(true);
  });
});
