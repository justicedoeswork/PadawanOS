/**
 * `pnpm --filter panda-gateway facts:check <path> [--app <fly-app>] [--business "<name>"]`
 *
 * Validates a candidate `justice-business-facts.json`, fingerprints it, and
 * prints the provisioning steps. It reads one file and writes nothing: no
 * upload, no deploy, no volume, no secret. Exit code 1 when the file would not
 * be accepted, so this can gate a change without anyone having to read the
 * output carefully.
 *
 * The file's CONTENTS are never printed — only counts, the fingerprint, and
 * which structural rules failed. A facts file holds Austin's verified business
 * details, and a terminal is a place things get pasted.
 */
import fs from 'node:fs';
import { checkBusinessFactsArtifact, provisioningInstructions, RECOMMENDED_FACTS_PATH } from './businessFactsArtifact.js';

interface ParsedArgs {
  readonly path: string | null;
  readonly flags: Readonly<Record<string, string>>;
}

/** `--name value` pairs, plus the first bare argument as the path. Deliberately minimal; no dependency for four flags. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  let path: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('--')) {
      flags[arg.slice(2)] = argv[index + 1] ?? '';
      index += 1;
    } else if (path === null) {
      path = arg;
    }
  }
  return { path, flags };
}

function main(argv: readonly string[]): number {
  const { path, flags } = parseArgs(argv);
  if (!path) {
    console.error('usage: facts:check <path-to-justice-business-facts.json> [--app <fly-app>] [--business "<name>"] [--mount <path>]');
    return 2;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const businessName = flags.business || 'Justice Exteriors';
  const report = checkBusinessFactsArtifact(raw, { businessName });

  console.log(`file            ${path}`);
  console.log(`bytes           ${report.byteLength}`);
  console.log(`sha256          ${report.fingerprint}`);
  console.log(`schemaVersion   ${report.schemaVersion ?? '(missing)'}`);
  console.log(`business        ${report.business ?? '(missing)'}`);
  console.log(`facts           ${report.factCount}`);
  console.log(`publishable     ${report.publishableCount} (VERIFIED and cleared for public use)`);
  for (const warning of report.warnings) console.log(`WARNING         ${warning}`);
  for (const problem of report.problems) console.error(`PROBLEM         ${problem}`);

  if (!report.ok) {
    console.error('\nThis file would NOT be accepted. Nothing was uploaded.');
    return 1;
  }

  console.log('');
  for (const line of provisioningInstructions({
    flyApp: flags.app || '<marketing-agent-fly-app>',
    localPath: path,
    mountPath: flags.mount || RECOMMENDED_FACTS_PATH,
    fingerprint: report.fingerprint
  })) {
    console.log(line);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
