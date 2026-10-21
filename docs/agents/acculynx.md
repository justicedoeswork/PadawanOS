# AccuLynx read-only integration

The gateway owns `ACCULYNX_API_KEY` as a runtime secret. Set it on the
gateway host (the checked-in Fly configuration names the app `justiceos`),
or in ignored `gateway/.env` for local development. Never use a `VITE_`
variable, paste the key into chat, commit it, or put it in `fly.toml`.
Deploy the gateway code before expecting these routes to exist.

Authenticated routes use the existing HttpOnly JusticeOS session cookie:

| GET route | Result |
| --- | --- |
| `/api/acculynx/status` | Whether a key is configured; not a live connection check |
| `/api/acculynx/jobs?recordStartIndex=0` | One page of at most 25 jobs; advance by returned item count until `count` is reached |
| `/api/acculynx/jobs/{jobId}/payments` | Original received payments, paid payments, and additional expenses |

Only these reads are exposed. Hosts are fixed to `api.acculynx.com`, redirects
are rejected, requests time out after 20 seconds, and response bodies are
bounded to 8 MiB. Provider errors are sanitized. A 429 means stop and retry
later; the client does not automatically hammer the API. Missing credentials
disable only this integration. Verify credentials with the jobs route after
signing in; a configured status alone does not prove the key works.

## Complete export

From the repository root, run `pnpm --filter panda-gateway export:acculynx`
in a trusted environment with the runtime secret configured. It sequentially
reads all job pages and each job's payments, then writes one dated JSON
snapshot under ignored `gateway/.state/acculynx/`. Files use mode 0600 and
the directory is created with mode 0700. Each run is a separate snapshot;
previous files are not overwritten. Failed runs do not publish a partial
snapshot. Keep exports private, including backups and support attachments.
The Fly filesystem is not durable storage: copy exports to an approved private
store if running there. There is no scheduled refresh or automatic upload.

No job creation, milestone, assignment, or modified-date filter is applied.
Older jobs may receive new payments, and a payment edit is not assumed to
change its job's modified date. Pagination rejects changing counts and duplicate
job IDs. This is a scan over time, not an atomic database snapshot; source
changes during a run may require a second export.

## Reconciliation contract

Preserve source IDs, parent IDs, amounts, dates, reference numbers, and unpaid
flags. This integration deliberately does not calculate financial totals or
overwrite bank classifications. Parent payments and their sub-payments must
not both be added to totals. `isPaid: false` does not establish a cash outlay.
Group totals cover the source group, not a requested reporting period.

For downstream comparison, key records by job ID, category, and payment ID.
Compare snapshots as replacements per key, not as additive imports. Flag
changed or missing records for review; never silently erase reviewed overrides.
Use `paymentDate` for received/paid records and `transactionDate` for additional
expenses when separating periods. Preserve the API's date component without
converting midnight UTC to a prior local date. Missing dates require review.
Keep bank cash reconciliation separate from job payment records to avoid counting
the same movement twice.

This adds gateway access and an export command. It does not grant ChatGPT a
session, add an ACP tool, or connect a reconciliation database automatically.
Live verification still requires the operator's key and a running gateway.

Official API schemas checked during implementation:

- https://apidocs.acculynx.com/reference/getjobs.md
- https://apidocs.acculynx.com/reference/getpayments.md

Validation: `pnpm --filter panda-gateway exec vitest run tests/acculynx.test.ts`.
