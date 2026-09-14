import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createSessionToken, verifySessionToken } from '../src/session.js';

describe('session token', () => {
  it('a freshly created token verifies successfully', () => {
    const token = createSessionToken('secret-a');
    expect(verifySessionToken(token, 'secret-a')).toBe(true);
  });

  it('a token signed with a different secret is rejected (tampered signature)', () => {
    const token = createSessionToken('secret-a');
    expect(verifySessionToken(token, 'secret-b')).toBe(false);
  });

  it('a token with a modified payload is rejected', () => {
    const token = createSessionToken('secret-a');
    const parts = token.split('.');
    const tampered = `9999999999999.${parts[1]}.${parts[2]}`;
    expect(verifySessionToken(tampered, 'secret-a')).toBe(false);
  });

  it('a malformed token is rejected', () => {
    expect(verifySessionToken('not-a-real-token', 'secret-a')).toBe(false);
    expect(verifySessionToken('', 'secret-a')).toBe(false);
    expect(verifySessionToken(undefined, 'secret-a')).toBe(false);
  });

  it('an expired token is rejected', () => {
    // Construct a token whose expiry is already in the past, using the
    // exact same signing scheme.
    const expiresAt = Date.now() - 1000;
    const nonce = 'deadbeef';
    const payload = `${expiresAt}.${nonce}`;
    const signature = crypto.createHmac('sha256', 'secret-a').update(payload).digest('hex');
    const expiredToken = `${payload}.${signature}`;

    expect(verifySessionToken(expiredToken, 'secret-a')).toBe(false);
  });
});
