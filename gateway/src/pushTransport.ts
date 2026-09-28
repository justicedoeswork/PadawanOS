import { createPrivateKey, sign } from 'node:crypto';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function decodePublicKey(publicKey: string): { x: string; y: string } {
  const raw = Buffer.from(publicKey, 'base64url');
  if (raw.length !== 65 || raw[0] !== 0x04) {
    throw new Error('VAPID public key must be an uncompressed P-256 key.');
  }
  return {
    x: raw.subarray(1, 33).toString('base64url'),
    y: raw.subarray(33, 65).toString('base64url')
  };
}

export function createVapidAuthorization(options: {
  endpoint: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  nowMs?: number;
}): string {
  const endpoint = new URL(options.endpoint);
  const audience = endpoint.origin;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(
    JSON.stringify({
      aud: audience,
      exp: nowSeconds + 12 * 60 * 60,
      sub: options.subject
    })
  );
  const { x, y } = decodePublicKey(options.publicKey);
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x,
      y,
      d: options.privateKey
    },
    format: 'jwk'
  });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  return `vapid t=${header}.${payload}.${signature}, k=${options.publicKey}`;
}

export interface PushSignalResult {
  status: number;
  accepted: boolean;
  expired: boolean;
}

export async function sendEmptyPushSignal(options: {
  endpoint: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  fetchImpl?: typeof fetch;
}): Promise<PushSignalResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const authorization = createVapidAuthorization(options);
  const response = await doFetch(options.endpoint, {
    method: 'POST',
    headers: {
      authorization,
      ttl: '60',
      urgency: 'high'
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });

  return {
    status: response.status,
    accepted: response.status >= 200 && response.status < 300,
    expired: response.status === 404 || response.status === 410
  };
}
