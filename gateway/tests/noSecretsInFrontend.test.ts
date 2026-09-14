import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural proof, not just a rule someone has to remember: the
 * frontend's build graph (Vite's `src/` + its own config) never
 * references any of the gateway's server-only secrets. If it did,
 * `vite build` would happily inline the value into the shipped
 * bundle -- this test scans the actual frontend source so that
 * mistake is caught here, at PR time, rather than by reading a
 * built bundle after the fact.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FRONTEND_SRC_DIR = path.join(REPO_ROOT, 'src');
const VITE_CONFIG_PATH = path.join(REPO_ROOT, 'vite.config.ts');

const FORBIDDEN_IDENTIFIERS = [
  'JUSTICEOS_GATEWAY_PASSWORD',
  'JUSTICEOS_GATEWAY_PASSWORD_HASH',
  'JUSTICEOS_SESSION_SECRET',
  'ACP_GATEWAY_SERVICE_KEY',
  'ACP_ALLOWED_USER_ID',
  'ACP_ALLOWED_REALM_ID'
];

function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }

  return results;
}

describe('frontend source never references gateway secrets', () => {
  it('no frontend .ts/.tsx file mentions a gateway-only secret name', () => {
    const frontendFiles = walkFiles(FRONTEND_SRC_DIR, ['.ts', '.tsx']);
    expect(frontendFiles.length).toBeGreaterThan(0); // sanity check the scan actually found files

    const offenders: string[] = [];

    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const identifier of FORBIDDEN_IDENTIFIERS) {
        if (content.includes(identifier)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} references ${identifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('vite.config.ts never references a gateway-only secret name', () => {
    const content = fs.readFileSync(VITE_CONFIG_PATH, 'utf8');
    const offenders = FORBIDDEN_IDENTIFIERS.filter((identifier) => content.includes(identifier));
    expect(offenders).toEqual([]);
  });

  it('no frontend file calls localStorage.setItem with a credential-shaped key', () => {
    const frontendFiles = walkFiles(FRONTEND_SRC_DIR, ['.ts', '.tsx']);
    const suspiciousPattern = /localStorage\.setItem\(\s*['"`][^'"`]*(password|secret|token|credential)/i;

    const offenders = frontendFiles.filter((file) => suspiciousPattern.test(fs.readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});
