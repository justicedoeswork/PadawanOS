import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { resolveClientIp } from '../src/clientIp.js';

function mockRequest(headers: Record<string, string | undefined>, remoteAddress?: string): Request {
  return {
    headers,
    socket: { remoteAddress }
  } as unknown as Request;
}

describe('resolveClientIp', () => {
  it('uses the Fly-Client-IP header when present -- the edge-set, non-spoofable value', () => {
    const req = mockRequest({ 'fly-client-ip': '203.0.113.7' }, '10.0.0.1');
    expect(resolveClientIp(req)).toBe('203.0.113.7');
  });

  it('falls back to the raw socket address when Fly-Client-IP is absent', () => {
    const req = mockRequest({}, '198.51.100.9');
    expect(resolveClientIp(req)).toBe('198.51.100.9');
  });

  it('never trusts a client-supplied X-Forwarded-For header', () => {
    // A classic throttle bypass: a client claims a fresh IP on every
    // request via this header. It must be ignored entirely.
    const req = mockRequest({ 'x-forwarded-for': '1.2.3.4' }, '198.51.100.9');
    expect(resolveClientIp(req)).toBe('198.51.100.9');
  });

  it('falls back to "unknown" when neither is available', () => {
    const req = mockRequest({}, undefined);
    expect(resolveClientIp(req)).toBe('unknown');
  });

  it('ignores an empty or whitespace-only Fly-Client-IP header', () => {
    const req = mockRequest({ 'fly-client-ip': '   ' }, '198.51.100.9');
    expect(resolveClientIp(req)).toBe('198.51.100.9');
  });
});
