import 'dotenv/config';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AcculynxError, collectAcculynxSnapshot, createAcculynxClient } from './acculynxClient.js';

// Run from gateway with pnpm export:acculynx. Private data never goes to public/ or Git.
const key = process.env.ACCULYNX_API_KEY?.trim();
if (!key) {
  console.error('Set ACCULYNX_API_KEY in the server environment or gateway/.env first.');
  process.exitCode = 1;
} else {
  const directory = path.resolve('.state/acculynx');
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const temp = path.join(directory, `${id}.partial`);
  try {
    const snapshot = await collectAcculynxSnapshot(createAcculynxClient(key));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temp, JSON.stringify(snapshot, null, 2), { flag: 'wx', mode: 0o600 });
    const destination = path.join(directory, `${id}.json`);
    await rename(temp, destination);
    console.log(`Exported ${snapshot.jobCount} jobs to ${destination}`);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    console.error(error instanceof AcculynxError ? error.code : 'ACCULYNX_EXPORT_FAILED');
    process.exitCode = 1;
  }
}
