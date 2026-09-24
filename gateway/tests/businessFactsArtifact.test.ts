import { describe, it, expect } from 'vitest';
import { checkBusinessFactsArtifact, provisioningInstructions, RECOMMENDED_FACTS_PATH } from '../src/businessFactsArtifact.js';

const BUSINESS = 'Justice Exteriors';

function verifiedFact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'BUSINESS_PHONE',
    value: { phone: '(864) 766-3485' },
    status: 'VERIFIED',
    publicUseAllowed: true,
    source: { kind: 'OWNER_ATTESTATION', reference: 'owner confirmed on 2026-09-20' },
    verifiedAt: '2026-09-20',
    verifiedBy: 'Austin',
    ...overrides
  };
}

function factsFile(facts: readonly unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, business: BUSINESS, facts, ...overrides });
}

describe('a facts file that would be accepted', () => {
  it('passes, counts what is publishable, and fingerprints the exact bytes', () => {
    const report = checkBusinessFactsArtifact(factsFile([verifiedFact()]), { businessName: BUSINESS });
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.factCount).toBe(1);
    expect(report.publishableCount).toBe(1);
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same fingerprint for the same bytes and a different one for different bytes', () => {
    const a = checkBusinessFactsArtifact(factsFile([verifiedFact()]), { businessName: BUSINESS });
    const b = checkBusinessFactsArtifact(factsFile([verifiedFact()]), { businessName: BUSINESS });
    const c = checkBusinessFactsArtifact(factsFile([verifiedFact({ verifiedAt: '2026-09-21' })]), { businessName: BUSINESS });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('tolerates the byte-order mark a Windows editor adds, exactly as the agent loader does', () => {
    const report = checkBusinessFactsArtifact(`﻿${factsFile([verifiedFact()])}`, { businessName: BUSINESS });
    expect(report.ok).toBe(true);
  });

  it('warns, without failing, when nothing in it can appear in public copy', () => {
    const report = checkBusinessFactsArtifact(factsFile([verifiedFact({ publicUseAllowed: false })]), { businessName: BUSINESS });
    expect(report.ok).toBe(true);
    expect(report.publishableCount).toBe(0);
    expect(report.warnings[0]).toContain('no fact is both VERIFIED and cleared for public use');
  });
});

/**
 * The failure this tool exists to prevent: the example template being uploaded
 * as if it were real data. A half-filled facts file is worse than none, because
 * the agent treats whatever IS there as verified.
 */
describe('a facts file that would not be accepted', () => {
  it('refuses a file still carrying the example template placeholders', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      business: BUSINESS,
      facts: [{ kind: 'BUSINESS_PHONE', value: { phone: '<full 10-digit number>' }, status: 'UNVERIFIED', publicUseAllowed: false, source: { kind: 'OWNER_ATTESTATION' }, verifiedAt: '<YYYY-MM-DD>' }]
    });
    const report = checkBusinessFactsArtifact(raw, { businessName: BUSINESS });
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.includes('template placeholders'))).toBe(true);
  });

  it('refuses a file for a different business', () => {
    const report = checkBusinessFactsArtifact(factsFile([verifiedFact()], { business: 'Someone Else Exteriors' }), { businessName: BUSINESS });
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.includes('must be exactly'))).toBe(true);
  });

  it('refuses a schema version the agent does not read', () => {
    const report = checkBusinessFactsArtifact(factsFile([verifiedFact()], { schemaVersion: 2 }), { businessName: BUSINESS });
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.includes('schemaVersion'))).toBe(true);
  });

  it('refuses a fact with no provenance', () => {
    const { source, ...withoutSource } = verifiedFact();
    void source;
    const report = checkBusinessFactsArtifact(factsFile([withoutSource]), { businessName: BUSINESS });
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.includes('source.kind'))).toBe(true);
  });

  it('refuses a fact claiming VERIFIED with no verification date', () => {
    const { verifiedAt, ...undated } = verifiedFact();
    void verifiedAt;
    const report = checkBusinessFactsArtifact(factsFile([undated]), { businessName: BUSINESS });
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.includes('verifiedAt'))).toBe(true);
  });

  it('refuses invalid JSON, and still fingerprints what it was given', () => {
    const report = checkBusinessFactsArtifact('{ "schemaVersion": 1,', { businessName: BUSINESS });
    expect(report.ok).toBe(false);
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a top level that is not an object', () => {
    expect(checkBusinessFactsArtifact('[]', { businessName: BUSINESS }).ok).toBe(false);
  });
});

describe('the provisioning instructions', () => {
  it('describe a mounted volume and never print the facts themselves', () => {
    const lines = provisioningInstructions({ flyApp: 'justice-marketing-agent', localPath: './config/justice-business-facts.json', fingerprint: 'a'.repeat(64) });
    const text = lines.join('\n');
    expect(text).toContain('flyctl volumes create');
    expect(text).toContain(RECOMMENDED_FACTS_PATH);
    expect(text).toContain('JUSTICE_BUSINESS_FACTS_FILE');
    // A checker prints steps; it does not run them.
    expect(text).not.toContain('flyctl deploy');
  });

  it('carries the fingerprint so a change can be recorded without reading the file out loud', () => {
    const lines = provisioningInstructions({ flyApp: 'app', localPath: 'f.json', fingerprint: 'b'.repeat(64) });
    expect(lines[0]).toContain('b'.repeat(16));
  });

  it('honours a different mount path', () => {
    const lines = provisioningInstructions({ flyApp: 'app', localPath: 'f.json', mountPath: '/opt/facts/business.json', fingerprint: 'c'.repeat(64) });
    expect(lines.join('\n')).toContain('/opt/facts/business.json');
    expect(lines.join('\n')).toContain('destination = "/opt/facts"');
  });
});
