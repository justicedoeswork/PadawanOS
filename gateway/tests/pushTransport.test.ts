import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createVapidAuthorization, sendEmptyPushSignal } from '../src/pushTransport.js';

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const rawPublic = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(pub.x!, 'base64url'),
    Buffer.from(pub.y!, 'base64url')
  ]).toString('base64url');
  return { publicKey: rawPublic, privateKey: priv.d! };
}

describe('VAPID push transport', () => {
  it('builds a VAPID authorization header bound to the push origin', () => {
    const pair = keys();
    const header = createVapidAuthorization({
      endpoint: 'https://push.example.test/send/abc',
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: 'mailto:admin@example.test',
      nowMs: 1_800_000_000_000
    });

    expect(header.startsWith('vapid t=')).toBe(true);
    expect(header).toContain(`, k=${pair.publicKey}`);
    const token = header.slice('vapid t='.length).split(', k=')[0]!;
    const [, payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
    expect(claims.aud).toBe('https://push.example.test');
    expect(claims.sub).toBe('mailto:admin@example.test');
    expect(claims.exp).toBe(Math.floor(1_800_000_000_000 / 1000) + 43_200);
  });

  it('sends an empty authenticated push signal and identifies expired subscriptions', async () => {
    const pair = keys();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await sendEmptyPushSignal({
      endpoint: 'https://push.example.test/send/abc',
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      subject: 'mailto:admin@example.test',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 410 });
      }) as typeof fetch
    });

    expect(result).toEqual({ status: 410, accepted: false, expired: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe('POST');
    expect((calls[0]?.init?.headers as Record<string, string>).ttl).toBe('60');
    expect(calls[0]?.init?.body).toBeUndefined();
  });
});
