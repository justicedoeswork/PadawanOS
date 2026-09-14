import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { startTestGateway, TEST_SERVICE_KEY, TEST_USER_ID, TEST_REALM_ID, TEST_ORIGIN } from './helpers/testGateway.js';

/**
 * Structural checks against the production deployment files themselves
 * (repo root Dockerfile/fly.toml/.dockerignore), same idea as
 * noSecretsInFrontend.test.ts: a static scan that fails loudly at PR
 * time rather than trusting a human to notice a secret-shaped value
 * crept into a committed config file.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FLY_TOML_PATH = path.join(REPO_ROOT, 'fly.toml');
const DOCKERFILE_PATH = path.join(REPO_ROOT, 'Dockerfile');
const DOCKERIGNORE_PATH = path.join(REPO_ROOT, '.dockerignore');

const SECRET_ENV_NAMES = [
  'JUSTICEOS_GATEWAY_PASSWORD',
  'JUSTICEOS_GATEWAY_PASSWORD_HASH',
  'JUSTICEOS_SESSION_SECRET',
  'ACP_GATEWAY_SERVICE_KEY',
  'ACP_ALLOWED_USER_ID',
  'ACP_ALLOWED_REALM_ID'
];

function readFlyToml(): string {
  return fs.readFileSync(FLY_TOML_PATH, 'utf8');
}

/**
 * Flags a long run of secret-alphabet characters that also looks
 * randomly generated (has real digit density, isn't just one repeated
 * character) -- catches an actual pasted hex/base64 secret while
 * ignoring false positives these files legitimately contain: comment
 * divider lines (a run of `-`) and hyphenated English identifiers like
 * the app-name placeholder (zero digits either way).
 */
function findSuspiciousSecretLikeTokens(text: string): string[] {
  const candidates = text.match(/[A-Za-z0-9+/_-]{32,}/g) ?? [];
  return candidates.filter((token) => {
    const digitCount = (token.match(/[0-9]/g) ?? []).length;
    const isRepeatedSingleChar = /^(.)\1+$/.test(token);
    return digitCount >= 3 && !isRepeatedSingleChar;
  });
}

describe('fly.toml (production deployment prep)', () => {
  it('targets the selected and reserved Fly app "justiceos"', () => {
    const toml = readFlyToml();
    const appLine = toml.split('\n').find((line) => /^app\s*=/.test(line.trim()));
    expect(appLine).toBe('app = "justiceos"');
  });

  it('sets the exact HTTPS allowed origin for the reserved app', () => {
    const toml = readFlyToml();
    const originLine = toml.split('\n').find((line) => /^\s*JUSTICEOS_ALLOWED_ORIGINS\s*=/.test(line));
    expect(originLine).toBe('  JUSTICEOS_ALLOWED_ORIGINS = "https://justiceos.fly.dev"');
  });

  it('never proposes or mentions Justice Exteriors branding -- JusticeOS is a standalone app name', () => {
    const toml = readFlyToml();
    expect(toml).not.toMatch(/justice[-\s]?exteriors/i);
  });

  it('sets the correct internal port, matching gateway/src/config.ts default', () => {
    const toml = readFlyToml();
    expect(toml).toMatch(/internal_port\s*=\s*4600/);
    expect(toml).toMatch(/PORT\s*=\s*"4600"/);
  });

  it('enforces HTTPS', () => {
    expect(readFlyToml()).toMatch(/force_https\s*=\s*true/);
  });

  it('exposes only one http_service block -- no other public service/port', () => {
    const toml = readFlyToml();
    const httpServiceBlocks = toml.match(/^\[http_service\]/gm) ?? [];
    const otherServiceBlocks = toml.match(/^\[\[services\]\]/gm) ?? [];
    expect(httpServiceBlocks.length).toBe(1);
    expect(otherServiceBlocks.length).toBe(0);
  });

  it('sets the private (.internal) Insurance Agent ACP URL, never the public host', () => {
    const toml = readFlyToml();
    const assignmentLine = toml.split('\n').find((line) => /^\s*INSURANCE_AGENT_ACP_URL\s*=/.test(line));
    expect(assignmentLine).toBe('  INSURANCE_AGENT_ACP_URL = "ws://insurance-audit-agent.internal:3001/acp"');
    // The public host may still be mentioned in an explanatory comment
    // (why it must never be used) -- only the actual assignment matters.
    expect(assignmentLine).not.toMatch(/insurance-audit-agent\.fly\.dev/);
  });

  it('never sets a real secret env var -- those five are absent from [env] entirely', () => {
    const toml = readFlyToml();
    const secretsThatMustNeverBeSet = [
      'JUSTICEOS_GATEWAY_PASSWORD',
      'JUSTICEOS_GATEWAY_PASSWORD_HASH',
      'JUSTICEOS_SESSION_SECRET',
      'ACP_GATEWAY_SERVICE_KEY',
      'ACP_ALLOWED_USER_ID',
      'ACP_ALLOWED_REALM_ID'
    ];
    for (const name of secretsThatMustNeverBeSet) {
      // Looks for an actual `NAME =` assignment, not just the word
      // appearing in a comment explaining why it's absent.
      expect(toml).not.toMatch(new RegExp(`^\\s*${name}\\s*=`, 'm'));
    }
  });

  it('contains no value that looks like an actual generated secret (long hex/base64-ish token)', () => {
    expect(findSuspiciousSecretLikeTokens(readFlyToml())).toEqual([]);
  });
});

describe('Dockerfile (production deployment prep)', () => {
  const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');

  it('pins the pnpm major version this repo\'s own CI/deploy workflows use', () => {
    expect(dockerfile).toMatch(/pnpm@11/);
  });

  it('pins Node 24, matching .github/workflows', () => {
    expect(dockerfile).toMatch(/node:24-slim/);
  });

  it('exposes the correct internal port', () => {
    expect(dockerfile).toMatch(/EXPOSE\s+4600/);
  });

  it('never bakes any secret env var name into an ENV/ARG instruction', () => {
    for (const name of SECRET_ENV_NAMES) {
      expect(dockerfile).not.toMatch(new RegExp(`^\\s*(ENV|ARG)\\s+${name}`, 'm'));
    }
  });

  it('never COPYs a real .env file into the image', () => {
    expect(dockerfile).not.toMatch(/COPY\s+.*\.env(?!\.example)/);
  });

  it('does not contain a long token that looks like a real secret value', () => {
    expect(findSuspiciousSecretLikeTokens(dockerfile)).toEqual([]);
  });
});

describe('.dockerignore (production deployment prep)', () => {
  it('excludes every real .env file from the build context', () => {
    const content = fs.readFileSync(DOCKERIGNORE_PATH, 'utf8');
    expect(content).toMatch(/gateway\/\.env/);
  });

  it('excludes node_modules and dist from the build context (rebuilt fresh in-image)', () => {
    const content = fs.readFileSync(DOCKERIGNORE_PATH, 'utf8');
    expect(content).toMatch(/node_modules/);
    expect(content).toMatch(/^dist$/m);
  });
});

/**
 * Ties fly.toml's actual committed INSURANCE_AGENT_ACP_URL value
 * directly to the existing auth guarantee, rather than trusting that
 * the two never drift apart: reads the real file (never a hardcoded
 * copy of it) and confirms an unauthenticated upgrade using that exact
 * URL is still rejected. The upstream is never actually dialed on a
 * rejection path, so the private `.internal` hostname (which cannot
 * resolve outside real Fly networking) never needs to be reachable
 * here.
 */
function readDeploymentAcpUrl(): string {
  const toml = fs.readFileSync(FLY_TOML_PATH, 'utf8');
  const line = toml.split('\n').find((l) => /^\s*INSURANCE_AGENT_ACP_URL\s*=/.test(l));
  const match = line ? /"([^"]+)"/.exec(line) : null;
  if (!match) throw new Error('could not read INSURANCE_AGENT_ACP_URL out of fly.toml');
  return match[1]!;
}

let cleanupGateway: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanupGateway) await cleanupGateway();
  cleanupGateway = null;
});

describe('no ACP route works without authentication, under the real deployment config', () => {
  it('rejects an unauthenticated upgrade even when pointed at fly.toml\'s real INSURANCE_AGENT_ACP_URL', async () => {
    const { port, close } = await startTestGateway({
      insuranceAgentAcpUrl: readDeploymentAcpUrl(),
      acpGatewayServiceKey: TEST_SERVICE_KEY,
      allowedUserId: TEST_USER_ID,
      allowedRealmId: TEST_REALM_ID
    });
    cleanupGateway = close;

    const outcome = await new Promise<{ outcome: string; statusCode?: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/acp/insurance`, { headers: { Origin: TEST_ORIGIN } });
      let settled = false;
      ws.on('open', () => {
        if (settled) return;
        settled = true;
        ws.terminate();
        resolve({ outcome: 'open' });
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
        resolve({ outcome: 'timeout' });
      }, 3000);
    });

    // No session cookie was sent -- must never be 'open'.
    expect(outcome.outcome).toBe('rejected');
    expect(outcome.statusCode).toBe(401);
  });
});
