import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * JusticeOS is a standalone application brand: none of its user-facing
 * surface may name the company that operates it. This scans the
 * actual frontend source (the same technique noSecretsInFrontend.test.ts
 * uses for secrets) so a reintroduced "Justice Exteriors" string is
 * caught at PR time, not by someone noticing it in a screenshot later.
 *
 * Deliberately not scanned: gateway/src/**, fly.toml, and
 * docs/fly-deployment.md's own comments about the Insurance Agent's
 * *.internal hostname and ACP_ALLOWED_* identifiers -- those are
 * functional backend/business identifiers (per this rename's own
 * scope), never rendered to a user, and are covered separately by
 * deploymentArtifacts.test.ts's fly.toml scan instead.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const FRONTEND_SRC_DIR = path.join(REPO_ROOT, 'src');

const BRANDING_PATTERN = /justice[-\s]?exteriors/i;

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

describe('frontend never names Justice Exteriors -- JusticeOS is a standalone brand', () => {
  it('no frontend .ts/.tsx/.css file mentions "Justice Exteriors" in any spelling', () => {
    const frontendFiles = walkFiles(FRONTEND_SRC_DIR, ['.ts', '.tsx', '.css']);
    expect(frontendFiles.length).toBeGreaterThan(0); // sanity check the scan actually found files

    const offenders: string[] = [];

    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (BRANDING_PATTERN.test(content)) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('index.html (browser title/metadata) never mentions Justice Exteriors', () => {
    const indexHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
    expect(BRANDING_PATTERN.test(indexHtml)).toBe(false);
  });

  it('the managed agent displays as the neutral "Insurance Audit Agent", not any company-branded name', () => {
    const managedAgentSource = fs.readFileSync(path.join(FRONTEND_SRC_DIR, 'gateway', 'managedAgent.ts'), 'utf8');
    expect(managedAgentSource).toMatch(/name:\s*'Insurance Audit Agent'/);
  });
});
