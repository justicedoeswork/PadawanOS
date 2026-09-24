/**
 * Getting `config/justice-business-facts.json` into production, deliberately.
 *
 * The problem, stated plainly. The Marketing Agent will not write a public
 * claim about Justice Exteriors unless a verified fact backs it, and the facts
 * come from one operator-maintained JSON file. That file is gitignored (it is
 * Austin's data, not code) and its repository's Dockerfile copies the other
 * two operator config files and deliberately not this one. So in a freshly
 * built production container the file does not exist, and every claim in every
 * drafted page reads as unverified.
 *
 * The chosen production solution is the smallest one that survives a deploy:
 * a **Fly volume mounted into the Marketing Agent app**, with
 * `JUSTICE_BUSINESS_FACTS_FILE` pointing at a path on it. A volume is not
 * rebuilt when the image is, the file never enters git or an image layer, and
 * it needs no code change in either service — the Marketing Agent already
 * reads that variable and already degrades safely when the file is missing.
 *
 * What a volume does not give on its own is deliberateness: an sftp write is
 * not an audit trail. That is what this module is for. It validates the
 * candidate file against the same structural rules the Marketing Agent
 * enforces, fingerprints the exact bytes, and refuses anything that still
 * carries the example template's placeholders. The operator records the
 * fingerprint; two people can then agree about which facts are live without
 * either of them reading the file out loud.
 *
 * It is a checker and a fingerprinter. It writes nothing, uploads nothing, and
 * contacts nothing.
 */
import crypto from 'node:crypto';

/** The schema version of the facts file this tool knows how to check. */
export const SUPPORTED_FACTS_SCHEMA_VERSION = 1;

/** The recommended mount path on the Marketing Agent's volume. */
export const RECOMMENDED_FACTS_PATH = '/data/justice-business-facts.json';

export interface FactsArtifactReport {
  readonly ok: boolean;
  /** SHA-256 of the exact bytes, for the operator's change record. Not a secret: it reveals nothing about the contents. */
  readonly fingerprint: string;
  readonly byteLength: number;
  readonly schemaVersion: number | null;
  readonly business: string | null;
  readonly factCount: number;
  /** Facts marked verified AND cleared for public use — the ones that can actually appear in copy. */
  readonly publishableCount: number;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The placeholder shapes `config/justice-business-facts.example.json` ships
 * with. A file still containing one of these was copied from the template and
 * never filled in — and a half-filled facts file is worse than none, because
 * the Marketing Agent would treat what IS there as verified.
 */
const PLACEHOLDER_PATTERN = /<[^>]{2,}>|YYYY-MM-DD|REPLACE[-_ ]?ME|example\.com/i;

/**
 * Checks the bytes of a candidate facts file.
 *
 * Structural only, and that limit is the honest one: whether the phone number
 * is really Justice's phone number is not knowable from here, and this must
 * never imply otherwise. What it can prove is that the file parses, matches
 * the schema version the agent expects, names the right business, contains no
 * leftover template text, and that every fact carries the provenance fields
 * the agent's own validator requires.
 */
export function checkBusinessFactsArtifact(raw: string, expected: { readonly businessName: string }): FactsArtifactReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const bytes = Buffer.from(raw, 'utf8');
  const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');

  let parsed: unknown;
  try {
    // Tolerate the BOM a Windows editor adds, exactly as the Marketing
    // Agent's own loader does — otherwise this tool would pass a file the
    // agent rejects, or the reverse.
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    return {
      ok: false,
      fingerprint,
      byteLength: bytes.byteLength,
      schemaVersion: null,
      business: null,
      factCount: 0,
      publishableCount: 0,
      problems: [`the file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
      warnings
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      fingerprint,
      byteLength: bytes.byteLength,
      schemaVersion: null,
      business: null,
      factCount: 0,
      publishableCount: 0,
      problems: ['the top level of the file must be a JSON object'],
      warnings
    };
  }

  const schemaVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null;
  if (schemaVersion !== SUPPORTED_FACTS_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${SUPPORTED_FACTS_SCHEMA_VERSION} (found ${schemaVersion === null ? 'nothing' : String(schemaVersion)})`);
  }

  const business = typeof parsed.business === 'string' ? parsed.business : null;
  if (!business) {
    problems.push('business is required');
  } else if (business.trim() !== expected.businessName.trim()) {
    problems.push(`business must be exactly "${expected.businessName}" — the Marketing Agent rejects a facts file for a different business`);
  }

  const facts = Array.isArray(parsed.facts) ? parsed.facts : null;
  if (!facts) {
    problems.push('facts must be an array');
  }

  let publishableCount = 0;
  for (const [index, fact] of (facts ?? []).entries()) {
    if (!isRecord(fact)) {
      problems.push(`facts[${index}] must be an object`);
      continue;
    }
    if (typeof fact.kind !== 'string' || fact.kind.length === 0) problems.push(`facts[${index}] is missing kind`);
    if (!('value' in fact)) problems.push(`facts[${index}] is missing value`);
    if (typeof fact.status !== 'string') problems.push(`facts[${index}] is missing status`);
    if (typeof fact.publicUseAllowed !== 'boolean') problems.push(`facts[${index}] is missing publicUseAllowed`);
    if (!isRecord(fact.source) || typeof fact.source.kind !== 'string') problems.push(`facts[${index}] is missing source.kind — a fact with no provenance is not verified`);
    if (fact.status === 'VERIFIED' && typeof fact.verifiedAt !== 'string') problems.push(`facts[${index}] is VERIFIED but carries no verifiedAt`);
    if (fact.status === 'VERIFIED' && fact.publicUseAllowed === true) publishableCount += 1;
  }

  if (PLACEHOLDER_PATTERN.test(raw)) {
    problems.push('the file still contains template placeholders (e.g. <...>, YYYY-MM-DD, example.com) — it was copied from the example and not filled in');
  }

  if (problems.length === 0 && publishableCount === 0) {
    // Not a problem: a facts file that publishes nothing is a legitimate,
    // cautious state. It IS worth saying out loud, because the operator who
    // just uploaded it probably expected drafting to start working.
    warnings.push('no fact is both VERIFIED and cleared for public use, so no claim can appear in public copy yet');
  }

  return {
    ok: problems.length === 0,
    fingerprint,
    byteLength: bytes.byteLength,
    schemaVersion,
    business,
    factCount: facts?.length ?? 0,
    publishableCount,
    problems,
    warnings
  };
}

/**
 * The provisioning steps, printed rather than performed. Nothing here runs a
 * deploy, mounts a volume, or moves a file — a production change stays a thing
 * a human does, having read what it will do.
 */
export function provisioningInstructions(input: { readonly flyApp: string; readonly localPath: string; readonly mountPath?: string; readonly fingerprint: string }): readonly string[] {
  const mountPath = input.mountPath ?? RECOMMENDED_FACTS_PATH;
  const volumeDir = mountPath.slice(0, mountPath.lastIndexOf('/')) || '/data';
  return [
    `# Verified facts artifact ${input.fingerprint.slice(0, 16)}… (record this fingerprint in the change log)`,
    '',
    '# 1. One volume, once, in the Marketing Agent app. It survives every later deploy.',
    `flyctl volumes create marketing_config --app "${input.flyApp}" --region iad --size 1`,
    '',
    `# 2. Mount it, in that app's fly.toml, and point the agent at the file:`,
    '#      [mounts]',
    '#        source = "marketing_config"',
    `#        destination = "${volumeDir}"`,
    '#      [env]',
    `#        JUSTICE_BUSINESS_FACTS_FILE = "${mountPath}"`,
    '',
    '# 3. Upload the validated file. This is the only step that touches the facts.',
    `flyctl ssh sftp shell --app "${input.flyApp}"`,
    `#   put ${input.localPath} ${mountPath}`,
    '',
    '# 4. Confirm the agent can see it, without preparing work nobody asked for:',
    '#   JusticeOS: GET /api/marketing/agent/health -> businessFacts.state',
    '#   (UNKNOWN until a website package is prepared; AVAILABLE once one has been)'
  ];
}
