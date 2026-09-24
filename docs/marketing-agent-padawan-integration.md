# Marketing Agent ↔ Padawan integration (agent contract)

JusticeOS's orchestration bridge to the **Marketing Agent**'s agent API —
the `/api/marketing/agent/*` surface, contract version `1`. This is the
increment that makes the Marketing Agent a first-class JusticeOS agent
that Padawan can route to.

It is distinct from [marketing-agent-integration.md](marketing-agent-integration.md),
which documents the older campaign-review proxy (`/api/marketing/campaigns/*`,
`/api/marketing/revisions/*`). Both exist, both are served, and they share
the session check and the credential and nothing else. **Nothing in this
increment is deployed**; see "Blockers before deployment" at the end.

---

## 1. Division of labour

> The Marketing Agent owns marketing reasoning. Padawan orchestrates.

Concretely, the gateway bridge does four things and no more:

1. **Routes** a natural request onto one of the agent's ten operations.
2. **Carries identity** — conversation, task, requesting agent, operator —
   and **de-duplicates**, so one intent is one upstream call.
3. **Enforces the contract**, failing closed on a version it was not built
   for.
4. **Normalizes** every answer into one shape JusticeOS reads.

It never composes a marketing sentence. Every line Austin reads is the
agent's own `headline`, relayed. It holds no marketing rule: what an
opportunity is worth, what "performing well" means, whether a claim may be
published, and what research is due all stay upstream.

---

## 2. The agent registry

`gateway/src/agentRegistry.ts` — the first agent registry JusticeOS has
had. Before it, the Insurance Agent was a hard-coded ACP profile id and the
Marketing Agent a hard-coded route prefix, and the only place either was
"declared" was the sidebar button drawn for it. That is enough for a picker
and useless for an orchestrator, which has to answer *who could do this,
and are they even allowed to* before routing.

Served at `GET /api/agents` (session required).

**Marketing Agent** — `transport: HTTP_AGENT_CONTRACT`,
`basePath: /api/marketing/agent`, `contractVersion: "1"`,
`autonomous: true`.

Capabilities: marketing intelligence · demand analysis · competitor
research · website research · analytics analysis · outcome attribution ·
opportunity identification · marketing planning · draft preparation ·
approval-package preparation.

Autonomy, mirroring the agent's own three bands (`GET /agent/autonomy`) so
Padawan can refuse an intent *before* spending a call on it:

| Band | Contents |
| --- | --- |
| `automatic` | read stored evidence · sync first-party analytics · research within configured rules, budget and cooldowns · analyse · prepare drafts · create internal recommendations · emit internal events |
| `ownerApprovalRequired` | public website changes · social publishing · advertising launch · changing ad spend · customer-facing marketing communications · changing public business facts · applying a plan revision · widening paid collection |
| `never` | publish content · modify the live website · contact a customer · spend beyond budget · rewrite stored observations · change verified business facts |

The `never` band is the load-bearing line: Padawan must never offer to make
this agent publish or overspend, however a request is phrased. The agent's
own live policy remains the authority when the two disagree.

---

## 3. Routing: Austin's words → one operation

`gateway/src/marketing/intent.ts`, pure and unit-tested.

| Request | Operation |
| --- | --- |
| "What should we work on in marketing?" | `GET /agent/brief` |
| "What opportunities do we have?" | `GET /agent/opportunities` |
| "How is marketing performing?" | `GET /agent/brief` **+** `GET /agent/data-sources`, answered together |
| "What's producing approved jobs?" | `GET /agent/recommendations` (the agent's own ranked-work/outcome interface) |
| "Research this competitor." | `POST /agent/research` |
| "Prepare the gutter website changes for approval." | `POST /agent/prepare-work` (`WEBSITE_IMPROVEMENT_PACKAGE`, trade `GUTTERS`) |
| "Approve this proposal." | `POST /agent/decisions` `APPROVE` — **as a proposal requiring confirmation** |
| "Reject this." | `POST /agent/decisions` `REJECT` — same |
| "Revise this." | `POST /agent/decisions` `REQUEST_REVISION` — same |

Two rules the router enforces because they are JusticeOS's to enforce:

- **A question is never a decision.** "What's producing approved jobs?"
  uses *approved* as an adjective; "should I approve this?" is Austin
  thinking out loud. Neither produces a decision control.
- **Research is planned, never executed.** `dryRun: true` is pinned by the
  gateway rather than defaulted, so a caller cannot turn a research request
  into provider spend even if the agent's own endpoint ever changed.

A request it cannot place comes back `unroutable`, with the suggestions,
rather than being guessed at — the wrong guess here can cost money.

`POST /api/marketing/agent/ask` is the single entry point. It returns the
routing decision alongside the answer, always, so "here is the brief" is
auditable back to "because you asked what to work on".

---

## 4. The answer shape (contract version 1)

`gateway/src/marketing/contract.ts` is the only place in JusticeOS that
interprets the agent's envelope.

**Fail closed.** An envelope whose `contractVersion` is not supported is
refused outright — never parsed as far as it goes, never partially
believed. So is a 2xx body that is not an envelope, and one missing a
required field.

| Failure | Code | Status |
| --- | --- | --- |
| Version this build does not support | `MARKETING_CONTRACT_UNSUPPORTED` | 502 |
| Not a valid envelope / missing field | `MARKETING_CONTRACT_INVALID` | 502 |
| Non-JSON reply (proxy page, wrong URL) | `MARKETING_AGENT_UNAVAILABLE` (`reason: malformed-response`) | 502 |

Version is checked **first**, before any field complaint: an envelope from
a future contract will legitimately fail the field checks, and calling that
"malformed" would send an operator hunting in the wrong service.

**Normalized answer.** Every operation produces the same shape:

| Field | From |
| --- | --- |
| `summary` | `headline`, verbatim |
| `evidence` | `evidence` |
| `recommendation` | `nextActions` |
| `followUpActions` | `nextActions` that name a `via` — what JusticeOS could actually call next |
| `confidence` | `confidence` |
| `approvalRequirement` | derived; see §6 |
| `sourceFreshness` | `freshness` |
| `blockers` | `result.blockers` / `result.blocked` + `dataGaps`, de-duplicated |
| `constraint` | derived label + the agent's verbatim reason; see §5 |
| `identifiers` | JusticeOS's conversation/task/idempotency key + the agent's `collectionRunId` / `revisionId` |

Two fields fail toward caution when unreadable: an action whose
`requiresOwnerApproval` cannot be read counts as needing approval, and a
freshness row whose `stale` cannot be read counts as stale.

---

## 5. Identity, concurrency, and not retrying

`gateway/src/marketing/requestIdentity.ts`.

The agent's contract accepts three pieces of caller identity: an
`Idempotency-Key` header (which it also uses as its own request id),
`actor` on the two mutating operations, and a free-text `reason`. It has no
conversation or task field. So JusticeOS sends its identifiers as headers —
carried, logged at both ends, ignored upstream today, available the moment
the contract grows fields for them:

```
X-JusticeOS-Conversation-Id
X-JusticeOS-Task-Id
X-JusticeOS-Requesting-Agent      (always "padawan")
X-JusticeOS-Contract-Version      (what JusticeOS was built against)
```

**De-duplication is enforced here, not hoped for upstream.** A double
click, a retried fetch, or two Padawan turns about the same thing is a
JusticeOS bug, and it is fixed on this side of the wire: `research`,
`prepare-work` and `tick` are single-flighted and replayed for 10 minutes,
keyed on the operation and its parameters. Deliberately **not** keyed on
the conversation — the same competitor research asked in two threads is
still one piece of research, and charging twice because the threads differ
would be indefensible. A failure is never cached.

`decisions` carries a stable idempotency key so a retried click cannot
record two decisions, but is not locally replayed: a decision's state is
something Austin is entitled to see current, and the agent decides what a
repeat means.

**There is no retry anywhere in this bridge.** A busy agent, a provider in
backoff and an exhausted budget all answer identically to a second
request — and two of the three cost money. The reason is surfaced instead,
labelled by `constraint.kind` and always shown next to the agent's own
words:

`BUSY` · `BACKING_OFF` · `DEFERRED` (cooldown / not due) ·
`BUDGET_EXHAUSTED` · `PROVIDER_BLOCKED` · `AUTONOMY_REFUSED` ·
`NOT_CONFIGURED` · `STALE_DATA` · `FACTS_UNVERIFIED`

The label is a best-effort read of the agent's sentences (the contract
carries no machine-readable constraint field), which is why it is placed
*beside* the verbatim reason and never instead of it.

---

## 6. Approval UX contract

Four states, derived from the agent's own flags rather than from how an
answer reads:

| State | Meaning | Derived from |
| --- | --- | --- |
| `INFORMATIONAL` | Nothing is waiting on anyone. | default |
| `PREPARED_WORK` | A draft exists and is inert. | `result.prepared === true`, no decision pending |
| `APPROVAL_REQUIRED` | Nothing public happens until Austin decides. | `ownerDecisionRequired === true` |
| `BLOCKED` | Cannot proceed until something is fixed. | `status === "UNAVAILABLE"` or a non-empty `result.blocked` |

**High confidence is never approval.** Neither is opening a card, viewing a
recommendation, asking a follow-up, or saying something approving-shaped.

`POST /api/marketing/agent/decisions` is the only route that records a
decision, and it requires all three of:

- a named `revisionId` — "this" is never resolved by guessing;
- an explicit `decision`;
- `confirmed: true` — a field no page reaches by rendering, navigating, or
  asking a question.

Without it: `400 MARKETING_DECISION_NOT_CONFIRMED`, and **no upstream call
is made**. `POST /ask` cannot reach a decision at all; a request worded as
an approval returns a `pendingAction` naming the route and the payload,
with `revisionId: null` and `missing: ["revisionId"]` when the sentence
named none.

The UI honours the same rule (`src/manager/viewModel.ts`): decision
controls appear only for an `APPROVAL_REQUIRED` answer that names its
revision. An approve button with no object is worse than no button.

Every decision response restates, in the body, that approval changed
internal state only: `published: false` plus a `publicationNote`. JusticeOS
wires no publisher and the Marketing Agent has none.

---

## 7. Events: Marketing → JusticeOS → Communications → Austin

> Marketing decides what matters. Communications decides how Austin hears
> about it. **Marketing never contacts Austin directly.**

### The path as built

```
Marketing Agent raises an event (its own dedupe lifecycle, one row per problem)
  → GET /agent/brief  →  result.changesSinceLastBrief
      → POST /api/marketing/agent/events/sync
          → JusticeOS event store (retained, deduped)   ← Austin sees this in the app
          → Communications handoff (one envelope, idempotency-keyed)
              → Communications Agent decides channel, timing, and whether to send
```

The seven kinds: `MARKETING_OPPORTUNITY_FOUND`,
`MARKETING_PERFORMANCE_DROP`, `MARKETING_PERFORMANCE_GAIN`,
`MARKETING_DATA_STALE`, `MARKETING_RESEARCH_COMPLETED`,
`MARKETING_APPROVAL_REQUIRED`, `MARKETING_PROVIDER_BLOCKED`.

### Why the brief, and not the outbox

The Marketing Agent writes every owner-facing envelope into
`marketing_communication_outbox`, and that table's own header comment names
"the JusticeOS shared backend / event queue" as its eventual reader. That
is the more faithful transport — but **the agent contract exposes no
endpoint over that table**, and JusticeOS has no shared backend to read it
with (the gateway holds no database). The brief's
`changesSinceLastBrief` is what the contract actually offers, it is already
narrowed to the seven JusticeOS-facing kinds, it is already collapsed by the
agent's own dedupe, and the read is free — stored evidence, no provider
call. So it is the transport, and the outbox gap is recorded as a blocker
rather than quietly worked around.

### Dedupe

Event identity is `kind | trade | channel | firstDetectedAt | title`. The
occurrence count and last-detection time deliberately do **not**
participate: a recurring problem stays one event, which is what the agent's
own dedupe already decided. A re-ingest updates the occurrence count and
**does not re-notify** — otherwise one decision would become a notification
every poll.

### Retention and dismissal

JusticeOS retains every event so Austin can see it in the app even if a
notification is dismissed. Dismissing sets `dismissedAt`; the event stays
listable, and a later recurrence updates it in place rather than
resurrecting it.

**Limitation, stated rather than implied.** The store is in the gateway
process — no database. The durable record is upstream (the agent's own
event rows and its outbox), and this store is a projection plus JusticeOS's
handoff ledger, rebuilt by the next sync after a restart. The consequence:
across a gateway restart, delivery de-duplication depends on the *receiver*
honouring the idempotency key it is sent (the event identity), which the
envelope carries for exactly that reason.

### What crosses the boundary

`MARKETING_EVENT` / `schemaVersion: "1"` / `idempotencyKey` / `payload`,
mirroring the shape the agent already writes to its own outbox. What does
**not** cross it: a channel, a recipient, a phone number, an email address,
a template, a send time, or any instruction to notify anyone. A JusticeOS
that decided those would have quietly become a notification service.

`MARKETING_AGENT_API_KEY` never appears on this path. The Communications
Agent authenticates with its own `COMMUNICATIONS_AGENT_API_KEY`, and a test
asserts the marketing credential reaches no Communications request.

With no endpoint configured, the handoff records `NOT_CONFIGURED` and
nothing else: it does not fall back to contacting anyone, does not queue
for a retry that will never come, and does not report success. An event
nobody was told about must not look delivered.

---

## 8. Authentication

```
signed-in browser
  --(HttpOnly justiceos_session cookie, same-origin)-->
JusticeOS gateway
  --(Authorization: Bearer MARKETING_AGENT_API_KEY)-->
Marketing Agent
```

Unchanged from the campaign-review bridge, and deliberately so: **no second
user-facing password exists for the Marketing Agent.** The browser holds
the session cookie and nothing else. Every bridge route requires a valid
session, checked before any upstream call — an unauthenticated caller
learns nothing, not even whether the integration is configured.

The credential is attached in exactly one place
(`gateway/src/marketingAgentClient.ts`). It is never sent to the browser,
never logged (`log.ts` accepts only flat non-secret metadata), never echoed
in an error body, and never sent to the Communications Agent. A
browser-supplied `Authorization` header is ignored — and now structurally
so: correlation headers are applied first and the credential is written
last, so no caller can overwrite it.

Rotation needs no code change: it is an environment variable read at
startup, so `fly secrets set MARKETING_AGENT_API_KEY=… && fly deploy` is
the whole procedure.

The **operator identity** (`actor`) is asserted server-side and a
browser-supplied one is discarded. JusticeOS's login is single-owner and
its session token carries no user id (see `gateway/src/session.ts`), so the
actor is the configured owner, not a per-user identity — the same known
limitation the campaign-review bridge documents. With no actor configured,
mutations refuse with `503 MARKETING_ACTOR_NOT_CONFIGURED` and no upstream
call is made; reads are unaffected.

---

## 9. Scheduler ownership — decided

**One owner: the Marketing Agent's own internal loop
(`AGENT_LOOP_ENABLED=true`).** JusticeOS drives no ticks on a timer.

Two structural reasons, not preferences:

1. This gateway contains no scheduler.
2. Its Fly machine is configured `auto_stop_machines = "stop"` with
   `min_machines_running = 0`. An idle JusticeOS machine is stopped, so it
   could not fire a timer even if it had one.

The Marketing Agent's process, by contrast, is the one that holds the job
leases and is always the same process. Production refuses to start if
`MARKETING_AGENT_SCHEDULER_OWNER` is `justiceos`
(`gateway/src/configValidation.ts`).

`POST /api/marketing/agent/tick` remains, as an **operator action**: it
requires a recorded `reason`, is de-duplicated, and its response names the
scheduler owner so nobody can mistake calling it for having enabled
scheduling. The agent's DB leases make a duplicate tick a no-op anyway;
single ownership is about knowing who to look at when nothing ran.

Configuration to apply on the **Marketing Agent** app when scheduling is
turned on (not yet):

```
AGENT_LOOP_ENABLED=true
AGENT_LOOP_INTERVAL_MS=300000   # the agent's own default; floor is 60s
```

---

## 10. Paid research — proposed production default

**Autonomous paid research execution OFF for the initial deployment.
Free/read-only monitoring stays ON.**

On the **Marketing Agent** app:

```
AGENT_EXECUTE_WEBSITE_RESEARCH=false     # Firecrawl competitor crawls
AGENT_EXECUTE_WATCHLIST_RECHECK=false    # DataForSEO watchlist rechecks
```

Both are already off unless explicitly set to `true`, so this is a
confirmation of the agent's own default rather than a new switch.

What stays on, deliberately — the distinction the posture turns on is
free/read-only monitoring versus provider spend, not "monitoring off":

- first-party syncs (GA4, Search Console, AccuLynx) — Justice's own data,
  read-only, checkpointed, free or near-free;
- opportunity recompute, brief regeneration, performance monitoring — all
  derived from stored rows, no provider call;
- research **planning** and the events raised from it, so a stale source or
  an earned recheck still surfaces as something Austin can approve.

On the JusticeOS side this is enforced rather than declared: the bridge
pins `dryRun: true` on every research call, so JusticeOS cannot trigger
provider spend whatever the agent's flags say. The health report states
`research.justiceOsMayTriggerPaidResearch: false` as a fact about the code,
not a policy setting.

`MARKETING_AGENT_RESEARCH_EXECUTION=plan-only` on the JusticeOS side is a
declaration for the health report only.

**When to reconsider.** Turn `AGENT_EXECUTE_*` on once the deployment has
demonstrated, over real cycles, that: the provider budget rules hold; the
freshness rules are the thing actually triggering research; cooldowns are
observed; the competitor/source set is the approved one; and the events
raised by planning have been reviewed and look right. Until then the agent
plans and reports, and a human executes.

---

## 11. `config/justice-business-facts.json` in production — decided

**A mounted Fly volume on the Marketing Agent app, with
`JUSTICE_BUSINESS_FACTS_FILE` pointing at a path on it.**

The problem: the Marketing Agent will not write a public claim about
Justice Exteriors unless a verified fact backs it, and the facts come from
one operator-maintained JSON file. That file is gitignored (it is Austin's
data, not code) and its repository's Dockerfile copies the other two
operator config files and deliberately not this one. So in a freshly built
production container **the file does not exist**, and every claim in every
drafted page reads as unverified.

Why a volume, of the three options considered:

| Option | Verdict |
| --- | --- |
| **Mounted persistent volume** | **Chosen.** Survives every deploy (the image is rebuilt, the volume is not). No code change in either service — the agent already reads `JUSTICE_BUSINESS_FACTS_FILE` and already degrades safely without it. The file never enters git or an image layer. |
| Generated from a secret at boot | Needs an entrypoint change in the Marketing Agent, whose implementation is complete. Also puts a multi-KB structured document into a secret store built for credentials. |
| Shared config table | JusticeOS has no shared backend at all. Building one for one file is the configuration service this was explicitly not to become. |

What a volume does not give on its own is **deliberateness** — an sftp
write is not an audit trail. That is what `gateway/src/businessFactsArtifact.ts`
and its CLI are for:

```
pnpm --filter panda-gateway facts:check ./config/justice-business-facts.json \
  --app justice-marketing-agent
```

It validates the candidate against the same structural rules the agent
enforces (schema version, business name, per-fact provenance, `verifiedAt`
on anything claiming VERIFIED), **refuses a file still carrying the example
template's placeholders** — a half-filled facts file is worse than none,
because the agent treats whatever is there as verified — fingerprints the
exact bytes with SHA-256 for the change record, and prints the provisioning
steps. It reads one file and writes nothing: no upload, no deploy, no
volume, no secret. Exit code 1 if the file would not be accepted. The
file's contents are never printed.

To apply (not yet done):

```toml
# Marketing Agent app's fly.toml
[mounts]
  source = "marketing_config"
  destination = "/data"
[env]
  JUSTICE_BUSINESS_FACTS_FILE = "/data/justice-business-facts.json"
```

```
flyctl volumes create marketing_config --app <marketing-app> --region iad --size 1
flyctl ssh sftp shell --app <marketing-app>   # put <validated file> /data/justice-business-facts.json
```

**Degradation, not silence.** With the file missing, the agent still
answers every analysis question; a website package is still prepared, but
reports every claim as unverified (`verifiedFacts.usableCount: null`,
confidence `LOW`, the gap in `dataGaps`). JusticeOS reads that and reports
`businessFacts.state: UNAVAILABLE` as a **degraded** finding, never as an
outage. Unverified claims are never treated as verified.

---

## 12. Health aggregation

`GET /api/marketing/agent/health` — one report, always `200` (this
endpoint's job is to *report* a problem, so it must not become one).
`state` is what a caller branches on.

**A degraded integration is not an outage.** A missing GA4 credential or a
stale demand run means the agent knows less, not that it is broken.

| `state` | When |
| --- | --- |
| `HEALTHY` | Nothing degraded, nothing blocked. |
| `DEGRADED` | Anything else — stale sources, provider auth failures, job backoff, plan-only research, unavailable facts, no Communications endpoint, no scheduler owner. |
| `BLOCKED` | The agent cannot work: its database is unreachable, it reported `UNAVAILABLE`, it did not answer the health probe, or the contract is unsupported. |
| `NOT_CONFIGURED` | The integration was never set up on this gateway. |

Reported: contract expected/supported/upstream/compatible · configured and
actor-configured · reachability · agent status and database · scheduler
state and failing-job count · **last successful monitoring cycle** (newest
`lastSuccessAt` across every scheduled job) · stale sources ·
**provider auth failures** · scheduler owner and whether JusticeOS drives
ticks · research posture · **business-facts availability** · retained event
count, how many await Austin, whether the handoff is configured, and the
last sync.

Business-facts state is `AVAILABLE` / `UNAVAILABLE` / `UNKNOWN`, and
`UNKNOWN` is a real answer rather than a failure to look: the agent exposes
the facts gate only through a prepare-work answer, and probing it would
mean preparing work nobody asked for. JusticeOS reports what it last
observed — every prepare-work answer updates it for free — and says plainly
when it has observed nothing.

`GET /health` is unchanged: unauthenticated liveness only. A missing or
unreachable Marketing Agent never makes the gateway unhealthy and never
affects login or ACP chat.

---

## 13. Routes

All under `/api/marketing/agent`, all requiring a JusticeOS session.
Registered **before** the campaign-review router, which ends with a
catch-all 404 for everything under `/api/marketing` — that order is
load-bearing and a test covers it.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/agents` | The agent registry. Not under the agent prefix. |
| GET | `…/health` | Aggregated report (above). Not the agent's envelope. |
| GET | `…/brief` | `?kind=` validated against the three brief kinds. |
| GET | `…/performance` | Brief + data-source status, answered together. |
| GET | `…/data-sources` | |
| GET | `…/opportunities` | `trade` (taxonomy-checked), `market`, `minScore`, `minConfidence`, `type`, `state`, `limit`, `includeHistory`. |
| GET | `…/recommendations` | `trade`, `channel`, `approvalState`, `limit`. |
| GET | `…/autonomy` | |
| POST | `…/ask` | Natural request → one operation. Cannot reach a decision. |
| POST | `…/research` | Always `dryRun: true`. De-duplicated. |
| POST | `…/prepare-work` | Server-asserted actor. De-duplicated. Publishes nothing. |
| POST | `…/decisions` | Requires `revisionId` + `decision` + `confirmed: true`. |
| POST | `…/tick` | Operator action; requires `reason`. |
| GET | `…/events` | Retained events. `?includeDismissed=false` to exclude. |
| POST | `…/events/sync` | Ingest from the brief, hand new ones to Communications. |
| POST | `…/events/:eventId/dismiss` | Dismisses the notification; retains the event. |

Anything else under the prefix answers JSON `404 ROUTE_NOT_FOUND` rather
than the SPA shell.

### Error codes the bridge itself produces

| Code | Status | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | No valid JusticeOS session. No upstream call. |
| `MARKETING_CONTRACT_UNSUPPORTED` | 502 | Upstream contract version unsupported. Nothing read. |
| `MARKETING_CONTRACT_INVALID` | 502 | Not a valid answer envelope. Nothing interpreted. |
| `MARKETING_AGENT_UNAVAILABLE` | 502 | No useful answer (`timeout`, `network`, `malformed-response`). No retry. |
| `MARKETING_AGENT_NOT_CONFIGURED` | 503 | Not configured on this gateway. |
| `MARKETING_ACTOR_NOT_CONFIGURED` | 503 | No operator identity; mutations only. |
| `MARKETING_DECISION_NOT_CONFIRMED` | 400 | A decision without a deliberate confirmation. No upstream call. |
| `MARKETING_EVENT_NOT_FOUND` | 404 | No retained event with that id. |
| `INVALID_REQUEST` | 400 | Rejected before any upstream call. |
| `ROUTE_NOT_FOUND` | 404 | No such bridge endpoint. |

The Marketing Agent's own statuses and bodies pass through **unchanged** —
`AUTONOMY_REFUSED`, `AGENT_NOT_CONFIGURED`, `DEMAND_NOT_CONFIGURED`,
`REVISION_NOT_FOUND`, `INVALID_REQUEST` and the rest reach the browser
exactly as that service wrote them. A non-JSON upstream reply is reported
as unavailable rather than passed through, so whatever it contained cannot
leak. No stack trace ever reaches the browser.

---

## 14. Environment variables

All server-side, read only by the gateway package
(`gateway/src/config.ts`), which the Vite build graph never reaches.

| Variable | Required | Meaning |
| --- | --- | --- |
| `MARKETING_AGENT_BASE_URL` | for the integration | The agent's API root, without its `/api/marketing` prefix. Private destination in production. |
| `MARKETING_AGENT_API_KEY` | for the integration | Presented only server-to-server. |
| `MARKETING_AGENT_ACTOR` | no | Operator recorded upstream. Defaults to `ACP_ALLOWED_USER_ID`. |
| `MARKETING_AGENT_SCHEDULER_OWNER` | no | `marketing-internal-loop` (default) · `justiceos` (refused in production) · `none`. |
| `MARKETING_AGENT_RESEARCH_EXECUTION` | no | `plan-only` (default) · `execute-allowed`. Reporting only. |
| `COMMUNICATIONS_AGENT_EVENT_URL` | no | The Communications Agent's inbound event endpoint. Unset = events retained, nobody notified. |
| `COMMUNICATIONS_AGENT_API_KEY` | no | The Communications Agent's **own** credential. |

Production validation (`configValidation.ts`) refuses to start on: a
half-configured Communications handoff, a plaintext public endpoint for it,
a short/placeholder credential, or `justiceos` as scheduler owner.

---

## 15. UI

`src/manager/` (client, types, pure view model) and the Justice Manager
panel (`src/gateway/ManagerChat.tsx`), which was a placeholder and is now
the ask surface: a question in, the agent's own sentences out, with the
approval state, the confidence, what the agent could not see, what is out
of date, and what could happen next.

The panel's name in the UI stays **Justice Manager**, matching the rest of
this interface; the orchestrator identity on the wire is server-side only.

Decision controls follow §6 exactly, and the pure view model
(`src/manager/viewModel.ts`) is where that is proven: an approval control
appears only for an `APPROVAL_REQUIRED` answer that names its revision, and
a contract mismatch renders as an integration problem rather than as a
marketing answer.

Not in this increment: an events/alerts surface on the dashboard (the
`/events` API exists and is tested; nothing renders it yet), and a
marketing health tile.

---

## 16. Tests

```
pnpm --filter panda-gateway test     # 325 tests
pnpm test                            # 1224 (frontend + gateway), 5 skipped
```

New gateway suites:

| File | Covers |
| --- | --- |
| `marketingContract.test.ts` | Version handling, envelope validation, approval state, constraints, normalization. |
| `marketingIntent.test.ts` | All nine specified mappings, "a question is never a decision", trade recognition. |
| `marketingRequestIdentity.test.ts` | Identifier hygiene, correlation headers, request identity, single-flight + replay window. |
| `marketingEvents.test.ts` | Brief → events, identity, notify-once, retention through dismissal, handoff states, credential separation. |
| `marketingHealth.test.ts` | Degraded-is-not-an-outage, what genuinely blocks, what only JusticeOS knows. |
| `businessFactsArtifact.test.ts` | Validation, placeholder refusal, fingerprinting, provisioning steps. |
| `marketingAgentBridge.test.ts` | End-to-end acceptance A–I against a mocked agent (below). |

Acceptance cases, mapped to their `describe` blocks in
`marketingAgentBridge.test.ts`:

- **A** — "What should we work on in marketing right now?" → brief →
  structured answer; identity propagated; "how is marketing performing?"
  answers brief + sources.
- **B** — "Prepare the gutter website changes for approval." → package,
  `published: false`, `APPROVAL_REQUIRED`, one upstream call, server-asserted
  actor.
- **C** — approval → decision endpoint → internal state only; refused
  without `confirmed: true`, without a revision, and from `/ask`.
- **D** — `MARKETING_OPPORTUNITY_FOUND` → sync → Communications → visible
  and retained; dedupe proven; retained through dismissal; retained with no
  handoff configured.
- **E** — provider blocked → `DEGRADED` with the provider named, not an
  outage; constraint surfaced; no retry storm; cooldown reported as
  deferred.
- **F** — agent unavailable → `502 MARKETING_AGENT_UNAVAILABLE`, no
  fabricated answer, bounded single timeout, `BLOCKED` in health.
- **G** — duplicate research → exactly one upstream call; two phrasings
  collapse; different research still calls; `dryRun` unspoofable.
- **H** — unsupported `contractVersion` → fail closed with
  `MARKETING_CONTRACT_UNSUPPORTED`; also invalid envelope, missing field,
  non-JSON reply.
- **I** — missing facts artifact → analysis still answered, drafting
  degraded and unverified, health `DEGRADED` not blocked.

`gateway/tests/helpers/mockAgentContract.ts` enforces
`Authorization: Bearer` the way the real service does, so a test cannot
pass while the gateway forgets the credential, and counts calls per route
so de-duplication is proven rather than assumed.

---

## Blockers before deployment

1. **No Communications Agent inbound event endpoint exists.** The handoff,
   its envelope, its credential and its failure states are built and
   tested, but the Communications Agent's API today exposes intake for
   voice notes and call summaries, proposals, responses and direct
   commands — nothing that accepts a marketing event. Until a contract is
   agreed there, events are retained in JusticeOS and nobody is notified
   (reported honestly as such). This is the one gap in requirement 7's
   end-to-end path.
2. **The outbox has no endpoint.** Event transport rides
   `changesSinceLastBrief` rather than the Marketing Agent's
   `marketing_communication_outbox`. Acceptable and free, but the outbox is
   the more faithful path and would need either an agent endpoint over it
   or the shared backend its own comment anticipates.
3. **Nothing polls `/events/sync`.** It is operator/UI-triggered. With the
   scheduler owned by the Marketing Agent and the JusticeOS machine
   stopping when idle, a periodic JusticeOS-side sync needs a decision of
   its own (a UI poll while the app is open is the obvious minimum).
4. **Event retention is in-process.** No database in the gateway. A restart
   rebuilds from the next sync and relies on the receiver's idempotency for
   delivery dedupe.
5. **The facts volume is not provisioned.** §11 is designed, validated and
   scripted; the volume, the mount, the env var and the upload have not
   been done.
6. **The Marketing Agent app is not deployed or configured.** Its Fly app
   name is still a placeholder; `AGENT_LOOP_ENABLED`, the
   `AGENT_EXECUTE_*` flags and its migrations are untouched by this work.
7. **No JusticeOS secrets are set.** `MARKETING_AGENT_BASE_URL` /
   `MARKETING_AGENT_API_KEY` have never been set on the JusticeOS Fly app;
   the integration is off there.
8. **Single-owner actor.** The audit identity upstream is the configured
   owner, not a per-user identity, because JusticeOS has no user table. Fine
   for a single-owner tool; revisit if JusticeOS grows accounts.
9. **No events/alerts UI.** The API is there; the dashboard does not render
   it yet, so today a retained event is visible only through the API.
