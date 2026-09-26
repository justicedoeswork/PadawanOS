import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProductionConfigProblems, assertProductionConfigIsValid, type ProductionConfigInput } from '../src/configValidation.js';
import { createGatewayServer } from '../src/server.js';

const validInput: ProductionConfigInput = {
  gatewayPassword: null,
  gatewayPasswordHash: 'somesalt:somehash',
  sessionSecret: 'a'.repeat(32),
  acpGatewayServiceKey: 'b'.repeat(32),
  allowedOrigins: ['https://justiceos.example.com'],
  insuranceAgentAcpUrl: 'ws://insurance-agent.internal:9000/acp',
  allowedUserId: 'austin',
  allowedRealmId: '123'
};

describe('findProductionConfigProblems', () => {
  it('reports no problems for a fully valid production config', () => {
    expect(findProductionConfigProblems(validInput)).toEqual([]);
  });

  it('rejects a plaintext gateway password even alongside a hash', () => {
    const problems = findProductionConfigProblems({ ...validInput, gatewayPassword: 'plaintext' });
    expect(problems.some((p) => p.includes('JUSTICEOS_GATEWAY_PASSWORD'))).toBe(true);
  });

  it('requires a password hash', () => {
    const problems = findProductionConfigProblems({ ...validInput, gatewayPasswordHash: null });
    expect(problems.some((p) => p.includes('JUSTICEOS_GATEWAY_PASSWORD_HASH'))).toBe(true);
  });

  it('requires a session secret meeting the minimum length', () => {
    expect(
      findProductionConfigProblems({ ...validInput, sessionSecret: 'short' }).some((p) => p.includes('JUSTICEOS_SESSION_SECRET'))
    ).toBe(true);
    expect(
      findProductionConfigProblems({ ...validInput, sessionSecret: null }).some((p) => p.includes('JUSTICEOS_SESSION_SECRET'))
    ).toBe(true);
  });

  it('requires a service key meeting the minimum length', () => {
    expect(
      findProductionConfigProblems({ ...validInput, acpGatewayServiceKey: 'short' }).some((p) =>
        p.includes('ACP_GATEWAY_SERVICE_KEY')
      )
    ).toBe(true);
  });

  it('requires at least one exact HTTPS origin', () => {
    expect(
      findProductionConfigProblems({ ...validInput, allowedOrigins: ['http://justiceos.example.com'] }).some((p) =>
        p.includes('HTTPS')
      )
    ).toBe(true);
    expect(findProductionConfigProblems({ ...validInput, allowedOrigins: [] }).some((p) => p.includes('HTTPS'))).toBe(true);
  });

  it('requires the Insurance Agent ACP URL to be present', () => {
    expect(
      findProductionConfigProblems({ ...validInput, insuranceAgentAcpUrl: null }).some((p) =>
        p.includes('INSURANCE_AGENT_ACP_URL')
      )
    ).toBe(true);
  });

  it('rejects a public Insurance Agent ACP URL', () => {
    const problems = findProductionConfigProblems({
      ...validInput,
      insuranceAgentAcpUrl: 'wss://insurance-audit-agent.fly.dev/acp'
    });
    expect(problems.some((p) => p.includes('private/internal'))).toBe(true);
  });

  it('rejects a non-ws(s) protocol for the ACP URL', () => {
    const problems = findProductionConfigProblems({ ...validInput, insuranceAgentAcpUrl: 'https://agent.internal/acp' });
    expect(problems.some((p) => p.includes('private/internal'))).toBe(true);
  });

  it('accepts every approved private ACP URL host', () => {
    for (const url of ['ws://agent.internal:9000/acp', 'wss://agent.internal:9000/acp', 'ws://127.0.0.1:9000/acp', 'ws://localhost:9000/acp']) {
      expect(findProductionConfigProblems({ ...validInput, insuranceAgentAcpUrl: url })).toEqual([]);
    }
  });

  it('requires complete and safe Communications read-only config when enabled', () => {
    expect(
      findProductionConfigProblems({ ...validInput, communicationsAgentBaseUrl: 'https://communications.example.com' }).some((p) =>
        p.includes('COMMUNICATIONS_API_READ_KEY')
      )
    ).toBe(true);

    expect(
      findProductionConfigProblems({ ...validInput, communicationsApiReadKey: 'c'.repeat(32) }).some((p) =>
        p.includes('COMMUNICATIONS_AGENT_BASE_URL')
      )
    ).toBe(true);

    expect(
      findProductionConfigProblems({
        ...validInput,
        communicationsAgentBaseUrl: 'http://public.example.com',
        communicationsApiReadKey: 'c'.repeat(32)
      }).some((p) => p.includes('COMMUNICATIONS_AGENT_BASE_URL') && p.includes('private/internal'))
    ).toBe(true);

    expect(
      findProductionConfigProblems({
        ...validInput,
        communicationsAgentBaseUrl: 'https://justice-exteriors-communications-nonprod.fly.dev',
        communicationsApiReadKey: 'c'.repeat(32)
      })
    ).toEqual([]);
  });

  it('rejects weak or placeholder Communications read keys', () => {
    expect(
      findProductionConfigProblems({
        ...validInput,
        communicationsAgentBaseUrl: 'https://communications.example.com',
        communicationsApiReadKey: 'short'
      }).some((p) => p.includes('COMMUNICATIONS_API_READ_KEY'))
    ).toBe(true);

    expect(
      findProductionConfigProblems({
        ...validInput,
        communicationsAgentBaseUrl: 'https://communications.example.com',
        communicationsApiReadKey: 'replace-me-with-a-real-read-key-padding'
      }).some((p) => p.includes('COMMUNICATIONS_API_READ_KEY') && p.includes('placeholder'))
    ).toBe(true);
  });

  it('requires the allowed user id and realm id', () => {
    expect(findProductionConfigProblems({ ...validInput, allowedUserId: null }).some((p) => p.includes('ACP_ALLOWED_USER_ID'))).toBe(
      true
    );
    expect(
      findProductionConfigProblems({ ...validInput, allowedRealmId: null }).some((p) => p.includes('ACP_ALLOWED_REALM_ID'))
    ).toBe(true);
  });

  // Production deployment prep: gateway/.env.example's own placeholder
  // text ("replace-me-with-a-random-64-char-hex-string") is deliberately
  // long enough that it would otherwise pass MIN_SECRET_LENGTH -- these
  // confirm a copy-pasted example value is still refused.
  describe('placeholder detection', () => {
    it('rejects a session secret copied verbatim from .env.example', () => {
      const problems = findProductionConfigProblems({
        ...validInput,
        sessionSecret: 'replace-me-with-a-random-64-char-hex-string-padding-to-length'
      });
      expect(problems.some((p) => p.includes('JUSTICEOS_SESSION_SECRET') && p.includes('placeholder'))).toBe(true);
    });

    it('rejects a service key or password hash that still looks like an example value', () => {
      const longPlaceholder = 'example-value-not-a-real-secret-padding-out-to-length';
      expect(
        findProductionConfigProblems({ ...validInput, acpGatewayServiceKey: longPlaceholder }).some((p) =>
          p.includes('ACP_GATEWAY_SERVICE_KEY') && p.includes('placeholder')
        )
      ).toBe(true);
      expect(
        findProductionConfigProblems({ ...validInput, gatewayPasswordHash: `salt:${longPlaceholder}` }).some((p) =>
          p.includes('JUSTICEOS_GATEWAY_PASSWORD_HASH') && p.includes('placeholder')
        )
      ).toBe(true);
    });

    it('rejects a user or realm id left as "replace-me"/"changeme"', () => {
      expect(
        findProductionConfigProblems({ ...validInput, allowedUserId: 'replace-me' }).some((p) =>
          p.includes('ACP_ALLOWED_USER_ID') && p.includes('placeholder')
        )
      ).toBe(true);
      expect(
        findProductionConfigProblems({ ...validInput, allowedRealmId: 'CHANGEME' }).some((p) =>
          p.includes('ACP_ALLOWED_REALM_ID') && p.includes('placeholder')
        )
      ).toBe(true);
    });

    it('does not flag a real-looking random secret as a placeholder', () => {
      // Sanity check against false positives: hex/base64-shaped random
      // output must never trip the heuristic.
      const randomLooking = '3f9a2b7c4d1e8f6a0b5c9d2e7f1a4b8c6d3e9f0a1b2c5d8e7f4a3b6c9d0e1f2a';
      expect(findProductionConfigProblems({ ...validInput, sessionSecret: randomLooking })).toEqual([]);
    });
  });
});

describe('assertProductionConfigIsValid', () => {
  it('does not throw for a valid config', () => {
    expect(() => assertProductionConfigIsValid(validInput)).not.toThrow();
  });

  it('throws listing every problem at once for a completely empty config', () => {
    const empty: ProductionConfigInput = {
      gatewayPassword: null,
      gatewayPasswordHash: null,
      sessionSecret: null,
      acpGatewayServiceKey: null,
      allowedOrigins: [],
      insuranceAgentAcpUrl: null,
      allowedUserId: null,
      allowedRealmId: null
    };

    expect(() => assertProductionConfigIsValid(empty)).toThrow(/Refusing to start in production/);

    let thrown: Error | null = null;
    try {
      assertProductionConfigIsValid(empty);
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).not.toBeNull();
    const message = thrown!.message;
    expect(message).toContain('JUSTICEOS_GATEWAY_PASSWORD_HASH');
    expect(message).toContain('JUSTICEOS_SESSION_SECRET');
    expect(message).toContain('ACP_GATEWAY_SERVICE_KEY');
    expect(message).toContain('HTTPS');
    expect(message).toContain('INSURANCE_AGENT_ACP_URL');
    expect(message).toContain('ACP_ALLOWED_USER_ID');
    expect(message).toContain('ACP_ALLOWED_REALM_ID');
  });
});

describe('createGatewayServer production startup gate', () => {
  function freshEmptyDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'panda-gateway-config-test-dist-'));
  }

  it('refuses to start (throws) rather than merely logging when production config is invalid', () => {
    expect(() =>
      createGatewayServer({
        isProduction: true,
        distDir: freshEmptyDir(),
        sessionSecret: 'short',
        gatewayPassword: 'plaintext',
        gatewayPasswordHash: null,
        allowedOrigins: ['http://insecure.example.com'],
        insuranceAgentAcpUrl: 'wss://insurance-audit-agent.fly.dev/acp',
        acpGatewayServiceKey: 'short',
        allowedUserId: null,
        allowedRealmId: null
      })
    ).toThrow(/Refusing to start in production/);
  });

  it('starts normally in production with a fully valid config', () => {
    expect(() =>
      createGatewayServer({
        isProduction: true,
        distDir: freshEmptyDir(),
        sessionSecret: 'a'.repeat(32),
        gatewayPassword: null,
        gatewayPasswordHash: 'somesalt:somehash',
        allowedOrigins: ['https://justiceos.example.com'],
        insuranceAgentAcpUrl: 'ws://agent.internal:9000/acp',
        acpGatewayServiceKey: 'b'.repeat(32),
        allowedUserId: 'austin',
        allowedRealmId: '123'
      })
    ).not.toThrow();
  });

  it('leaves throwaway development/test configuration completely unaffected outside production', () => {
    expect(() =>
      createGatewayServer({
        isProduction: false,
        distDir: freshEmptyDir(),
        sessionSecret: 'short',
        gatewayPassword: 'plaintext',
        gatewayPasswordHash: null,
        allowedOrigins: ['http://127.0.0.1:5173'],
        insuranceAgentAcpUrl: null,
        acpGatewayServiceKey: null,
        allowedUserId: null,
        allowedRealmId: null
      })
    ).not.toThrow();
  });
});
