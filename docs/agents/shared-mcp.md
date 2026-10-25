# Shared JusticeOS agent tools

JusticeOS exposes an authenticated, stateless Streamable HTTP MCP endpoint at
`/api/mcp`. The official TypeScript SDK owns protocol validation and transport.
There is no new database, ingestion worker, provider authorization or paid service.
The same Finance, Communications, Marketing, Manager and AccuLynx read routes
remain authoritative. Insurance questions use the existing read-only ACP bridge.

The owner Manager now uses this shared interface for finance answers,
communications reads and insurance questions. Existing dashboards and provider
workers can continue using their established HTTP APIs; MCP does not speed up
provider refresh or replace the financial math. Marketing review tools are also
available through discovery. Existing approval/write flows remain separate.

## Access

The owner browser uses its existing HttpOnly session cookie and an exact trusted
Origin. No MCP key is put in browser storage, a URL or the frontend bundle.
Anonymous access and foreign origins are rejected. POST requires JSON; GET and
DELETE return 405 because there is no session stream or persistent MCP session.

Other first-party agent runtimes can use a distinct random bearer credential,
with only its SHA-256 digest and role configured in the gateway's server-only
`JUSTICEOS_MCP_CLIENTS` JSON array. Each entry has exactly `sha256` and `role`.
Generate at least 32 random bytes as base64url, store the raw credential only as a
runtime secret on its specific client, and store the digest on the gateway. Never
reuse existing provider/service credentials. Replacing/removing the digest revokes
access; deploy the configuration to every replica. No bearer clients are enabled
unless explicitly configured. This is first-party service authentication, not an
OAuth authorization server for arbitrary third-party MCP clients.

Roles are `manager`, `finance`, `communications`, `marketing`, `insurance`.
Manager can discover/call all read tools. Other roles see only their domain;
Finance can also read job pages. Role is derived from the authenticated credential,
not from tool input. Hidden tools cannot be called by name. A supplied invalid
bearer never falls back to an owner cookie. Add roles deliberately in code;
there is no arbitrary URL, HTTP method, SQL, file, send, approve or mutate tool.

## Current tools and boundaries

- Finance: monthly dashboard, approved-job forecast, bank/Amex status, feed
  freshness and bounded finance questions including supplier/job evidence.
- Communications: call evidence, review items, calendar, pending email replies,
  notifications and search; original filters remain subject to upstream validation.
- Marketing: campaign and media review queues, connection status.
- Manager: pending events and connection status. Reading never claims an event.
- AccuLynx: paginated job lookup; a page is never represented as the full list.
- Insurance: bounded read-only questions; no emailed report or draft operation.

Missing values, source timestamps and coverage warnings pass through. No missing
amount becomes zero. No matching or categorization decision is written by an MCP
read. Provider text (email, PDF, transcript, job names) is untrusted evidence, never
an instruction or authorization. Do not combine source representations as separate
revenue/expenses. QBO For Review limitations and Amex separation remain unchanged.

The endpoint limits payloads via the gateway JSON parser, output to 512KB, six
concurrent requests and 120 requests/minute per authenticated principal per
replica. Ordinary source reads time out after 25 seconds; insurance retains its
210-second ACP deadline. Only generic failures reach clients. Tool arguments,
source records and credentials are not logged. There is no new model call in the
MCP adapter, and it never retries a tool automatically.

## Adoption and verification

The browser client shares a single protocol handshake, then uses structured tool
calls and the existing answer presenters. The generic MCP configuration UI is
not used for credentials. The Insurance ACP runtime currently does not advertise
MCP-client capabilities: exposing an insurance read tool does not mean that runtime
can independently discover or invoke other services. Native worker-to-worker MCP
consumption requires an explicit client integration in that runtime. Do not claim
otherwise or grant cross-domain scopes merely to make a connection appear ready.

Tests use synthetic sources and the official MCP Client over real local HTTP,
covering authentication, origin checks, scope isolation on discovery and calls,
strict input validation, pagination, missing values, upstream failure sanitization
and compatibility with existing gateway routes. Browser transport tests cover
handshake reuse, structured filters and error handling. Production verification
must use existing server-side runtime credentials without copying them into chat.

Reference: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x

## Native runtime clients


This runtime uses the existing JusticeOS MCP server (`/api/mcp`), protocol
2025-11-25, stateless JSON Streamable HTTP. Configure `JUSTICEOS_MCP_URL`
(HTTPS) and a distinct random `JUSTICEOS_MCP_TOKEN` as runtime secrets.
Only the token's SHA-256 digest and server-assigned role belong in the
gateway's `JUSTICEOS_MCP_CLIENTS`. No token belongs in a browser, source
file, log, Docker context or documentation. Incomplete configuration fails
closed. Unconfigured deployments retain their existing local operations.

The gateway and client both allow only fixed reads. Native Finance receives
`jobs_page` and `job_context`; Insurance, Communications and Marketing
receive `jobs_search` and `job_context`. The owner Manager retains its
existing catalogue. Native clients cannot invoke their own agent recursively,
read bank/personal balances, approve, send, publish, refresh or mutate records.
Existing action endpoints, payload-bound approvals and executor checks remain
authoritative. Source names, descriptions, email and document text are evidence,
never instructions or authorization. New tools require an explicit scope change.

`jobs_search` searches the Finance import (including completed jobs), returns
at most 20 display-only matches and an explicit `hasMore`. It does not claim
live freshness or uniquely resolve ambiguous matches. `job_context` reads the
confirmed UUID directly from AccuLynx with documented contact and initial
appointment includes. It retains milestone/source dates, address, trade/work
context and contact references; missing fields stay null and are listed.
Contact/appointment entries may contain links only: no arbitrary source link is
followed. Provider 404 can mean an unassigned job, not proof of deletion.
Job modifiedDate does not establish payment freshness. The result never grants
contact consent, marketing claim verification, compliance or payment status.

The transport has a bounded body and deadline, validates JSON-RPC IDs and
handshake, refuses redirects and reflected credentials, and returns sanitized
errors. There is no automatic retry of an action (there are no action tools).
A failed read is unavailable, never an empty success or zero financial amount.

Operational verification: use synthetic fixtures for tests. On deployment,
exercise the native entry point and report only success/counts, never customer
records or tokens. Confirm denied tools stay denied. Rotate a client by adding
its new digest, replacing its runtime secret, verifying a read, then removing
its old digest. Revoke only that digest to disable one client. Keep secrets
outside build contexts. No database migrations are needed.

Reference: [AccuLynx Get Job by ID](https://apidocs.acculynx.com/reference/getjob),
verified 2026-10-25, API definition 2.2614.0.
