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

1. **Routes** a natural request onto one of the agent's ten conversational operations. (The three event-transport operations are driven by the relay, never by a sentence.)
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

## 7. Events: Marketing outbox → JusticeOS → Communications → Austin

> Marketing decides what matters. Communications decides how Austin hears
> about it. **Marketing never contacts Austin directly.**

### The authoritative path

```
Marketing Agent raises an event and writes it to MarketingCommunicationOutbox
  → POST /agent/events/claim          JusticeOS takes ownership (claimToken, TTL)
      → Communications Agent          one envelope per event; it decides channel,
                                      timing, wording, and whether to send at all
      → POST /agent/events/:id/ack    DELIVERED | DUPLICATE | FAILED_RETRYABLE | FAILED_FINAL
          → Marketing appends an immutable delivery attempt
  → JusticeOS retains the event       ← Austin sees this in the app, before and after
```

Driven by `POST /api/marketing/agent/events/relay`, which runs exactly one
cycle of that.

**The outbox is the transport, and it is the only one.** The brief's
`result.changesSinceLastBrief` was the transport while the outbox had no
endpoint of its own; that path is removed. A brief is a view and the outbox
is a record, so the outbox is what a consumer reads. The brief remains what
it always was — user-facing intelligence — and the relay never reads it.
`POST …/events/sync` answers `410 MARKETING_EVENT_SYNC_RETIRED` and does
nothing.

### Why the outbox is safe to consume

The Marketing Agent's `trg_protect_marketing_outbox` freezes `kind`,
`idempotencyKey`, `schemaVersion`, `payload` and `createdAt`, and permits
only `status` to move. So what a row *says* is immutable, a row can never be
deleted, and only what has *happened* to it can change. The projection a
consumer reads is built from the row's frozen payload, not the live event:
an event's own row keeps changing as it recurs, and what JusticeOS has to
deliver is what the agent decided at the moment of handoff.

### Claim before delivery

JusticeOS never fetches an event and sends it. Fetching is deliberately not
delivering — a read claims nothing and settles nothing, so a relay that
crashes after reading has not silently swallowed the event.

| | |
| --- | --- |
| Consumer | `justiceos-communications-relay` — one identity, every deploy |
| Limit | 10 events per claim |
| TTL | 10 minutes |

The consumer identity is a constant (`outboxEvents.ts`), not generated and
not configured. The Marketing Agent stamps `claimedBy` and every delivery-log
row with it, so it is how an operator answers *"who took that event, and who
said it was delivered"* months later. A per-process name would make the audit
log unreadable after the first restart. It names a role, never a person, a
machine, or a credential.

The TTL is **sized, not picked**: ten events at (5s Communications wait +
2×10s acknowledgement) is 250 seconds, so ten minutes is ~2.4× the longest a
cycle can legitimately take, and well inside the 30s–30m band the agent
clamps to. It is deliberately not larger — a claim is a promise to deliver or
die trying, and an over-long one means a crashed relay strands events for as
long as it lasts. The relay also **stops early**: when less than one
per-event budget of the claim remains, it delivers no more and lets the rest
lapse, because an acknowledgement refused for a lapsed claim is a delivery
nobody recorded.

Every delivery attempt persists its whole claim context — outbox id, event
id, `claimToken`, `ackKey`, `idempotencyKey`, `dedupeKey`, kind, and the
claim expiry. The `claimToken` goes back **unchanged**; ownership, not
identity, is what authorises an acknowledgement.

### The ack key

Derived, never random, and derived from the claim token:

```
ackKey = justiceos-ack-<sha256(consumer, outboxId, claimToken)[:32]>
```

That one choice gives both properties the contract needs.

- **Stable within a claim.** An acknowledgement whose answer was lost is
  re-sent verbatim, and Marketing's unique `(outboxId, ackKey)` replays the
  recorded result instead of counting a second attempt. **This is the rule:
  an uncertain acknowledgement is retried with the SAME ack key — once
  in-line, and again on the next cycle if that also fails. A new key would
  defeat the entire mechanism.**
- **Different across claims.** A genuine second attempt after a retryable
  failure arrives under a new claim token, so it is counted as an attempt
  rather than silently replayed as the first one's result.

Being derived also means a process that restarts mid-delivery recomputes the
same key from the same claim instead of double-counting the attempt.

### What JusticeOS reports back

| Communications answered | JusticeOS acknowledges | Marketing makes it |
| --- | --- | --- |
| 2xx | `DELIVERED` | `DELIVERED` |
| 409 — already had it | `DUPLICATE` | `DUPLICATE` |
| 401, 403, 408, 429, 5xx, timeout, unreachable | `FAILED_RETRYABLE` | `PENDING`, after a backoff |
| 400, 404, 405, 415, 422 | `FAILED_FINAL` | `FAILED`, retained for audit |

The line between retryable and final is drawn by **what a second identical
request would do**, not by how bad the status sounds. The receiver refusing
*this message* is permanent — the same envelope will be refused forever. The
receiver refusing *us*, or failing to answer, is a condition a human resolves
while the backoff runs. `DUPLICATE` is terminal and deliberately distinct
from `DELIVERED`: "I already handled this" is not the same evidence as "I
delivered this", and collapsing them would lose the only signal that
JusticeOS's own dedupe caught something the outbox did not.

There is no retry inside the handoff itself. Retrying is the outbox's job and
it does it properly — a backoff that doubles from a minute to an hour, with a
ceiling of 8 attempts.

### Duplicate protection, in three layers

1. **Marketing** — a delivered, duplicate or failed row is never offered
   again, and the claim means only one consumer holds it at a time.
2. **JusticeOS** — before sending, the relay asks its own store whether it
   has already handled this event, keyed on the agent's `idempotencyKey`
   (unique per event *occurrence*). If so it **does not send again** and
   acknowledges `DUPLICATE`. The `dedupeKey` is deliberately *not* used for
   this: it is stable across recurrences, and a genuine recurrence is a new
   occurrence the agent decided was worth raising again.
3. **The receiver** — the envelope carries `idempotencyKey` as both a field
   and an `Idempotency-Key` header, and a 409 back is read as `DUPLICATE`.

### Error handling

| Upstream | Status | JusticeOS does |
| --- | --- | --- |
| `EVENT_CLAIM_INVALID` | 409 | Nothing. No re-authentication, no second acknowledgement, no fabricated result. The event becomes `RETRY_PENDING` locally and re-enters the normal claim cycle on a later pass. |
| `EVENT_ALREADY_FINAL` | 409 | Stops delivery work for that event and reconciles its local status to the one the agent reports. An unrecognised terminal status reconciles to `FAILED`, never to `DELIVERED` — that guess cannot be taken back. |
| `EVENT_NOT_FOUND` | 404 | Records an integration inconsistency, degrades the transport in the health report, and keeps both facts: whatever Communications did, this acknowledgement did not happen. Never a fabricated success. |
| Any other deterministic refusal | 4xx | Recorded as a standing integration problem and **not** retried with that ack key, now or on a later cycle — an acknowledgement that can never be accepted would otherwise be re-sent forever. The claim lapses and the outbox offers the event again under a fresh one. |
| Unsupported / unreadable contract | 502 | Fails closed. Nothing claimed, delivered or acknowledged, and the Marketing integration is marked **degraded** until an operator acts. |

A transport failure is `DEGRADED`, not `BLOCKED`: the agent still answers
every read and Austin can still ask it anything. What is broken is the path
by which he would have been told *without* asking.

### No Communications endpoint configured

Which, today, is every deployment. The relay then **claims nothing at all** —
claiming is taking ownership of work it cannot do. It reads instead
(`GET /agent/events`, no side effects), retains what it finds so Austin can
see it in the app, and reports `mode: READ_ONLY`. The events stay `PENDING`
upstream for whoever eventually wires a receiver, and their retry budget is
untouched. It does not fall back to contacting anyone, does not queue for a
retry that will never come, and does not report success. An event nobody was
told about must not look delivered.

### Event state in JusticeOS

| Status | Meaning |
| --- | --- |
| `NEW` | Seen, not taken. Either never claimed, or read only. |
| `DELIVERING` | Claimed and in flight to Communications. |
| `DELIVERED` | Communications accepted it. |
| `DUPLICATE` | Already handled — ours or the receiver's idempotency said so. |
| `RETRY_PENDING` | A transient failure, or a lapsed claim. The outbox will offer it again. |
| `FAILED` | Permanently undeliverable, and kept as such. |

`delivery.acknowledged` is tracked separately from the status, because
"Communications took it" and "Marketing knows Communications took it" are
different facts — and an acknowledgement that timed out leaves the second one
false while the first stays true. That is precisely the state the
same-`ackKey` retry resolves.

**Retention.** An event stays listable after Communications has handled it. A
delivered event is settled, not erased.

**Dismissal is local, and only local.** It sets `dismissedAt` so the app can
stop showing the notification. It makes no upstream call — there is no
endpoint that could delete an outbox row, the row is undeletable by database
constraint, and JusticeOS would not use one if it existed. Dismissing means
"stop telling me", not "this never happened".

**Limitation, stated rather than implied.** The store is in the gateway
process — no database. The durable record is upstream: the outbox row is
insert-only and undeletable, and every acknowledgement is appended to an
immutable log there. A restart loses the projection, not the record. The
consequence is that JusticeOS's *own* layer of duplicate protection (layer 2
above) is gone across a restart, and de-duplication falls back to the two
layers that survive — Marketing never re-offering a settled event, and the
receiver honouring the idempotency key it is sent. Building a shared database
for JusticeOS was out of scope here and is not required for correctness,
because those two layers are durable.

### What crosses the boundary to Communications

`MARKETING_EVENT` / `schemaVersion: "1"` / `idempotencyKey` / `consumer` /
`payload`, where the payload is the Marketing Agent's own projection relayed
field-for-field: `outboxId`, `eventId`, `eventKind` (the public `MARKETING_*`
name), `internalType` (the durable one, for events with no public name),
title, summary, detailed reasoning, severity, significance, trade, channel,
evidence, recommended action and deadline, `ownerApprovalRequired`, first and
last detection, occurrence count, confidence, `dedupeKey`, and freshness.

What does **not** cross it: a channel choice, a recipient, a phone number, an
email address, a template, a send time, or any instruction to notify anyone.
JusticeOS composes no marketing copy and re-derives no event semantics — it
carries the agent's judgement and the receiver makes its own.

`MARKETING_AGENT_API_KEY` never appears on this path. The Communications
Agent authenticates with its own `COMMUNICATIONS_AGENT_API_KEY`, and a test
asserts the marketing credential reaches no Communications request.

### The relay driver — decided

JusticeOS has no scheduler and its Fly machine stops when idle, so something
outside the process has to run the cycle. Three options were real:

| Option | Why not / why |
| --- | --- |
| Communications polls the Marketing outbox itself | Cheapest, but it means handing a second service the Marketing credential and the claim/ack protocol — and it puts *which events matter* one step closer to the service that decides *how to tell Austin*, which is the line this integration exists to keep. |
| A lightweight always-on relay process | Costs money every hour of every day to do a few seconds of work, and is a new thing to deploy and monitor. Wrong shape for "move whatever is waiting". |
| **Platform cron → authenticated JusticeOS relay endpoint** | **Chosen.** No new process, no new credential distribution. `auto_start_machines = true` means the request wakes the machine, one cycle runs, and it sleeps again. |

Implemented as `.github/workflows/marketing-event-relay.yml`, deliberately
**not scheduled** — the `schedule:` trigger is commented out and activating
it is a listed deployment step. It authenticates with `JUSTICEOS_RELAY_KEY`,
a machine credential for exactly one route: not the gateway password (which
would grant the whole app) and not the Marketing key (which would grant
approval rights upstream). The worst a leaked relay key can do is make one
cycle run early; it cannot log in, read events, approve anything, tick the
agent, or reach the Marketing Agent directly, and tests prove each of those.
Unset, the relay is operator-triggered only and nothing falls open.

**This is not a second Marketing scheduler.** It drives no research, fires no
tick, and decides nothing about what the agent should look at — it moves
events the agent has already decided to raise.
`MARKETING_AGENT_SCHEDULER_OWNER` stays `marketing-internal-loop`, and
production still refuses to start if it says otherwise. If the relay never
runs, nothing is lost: the outbox is insert-only and undeletable, and the
events are still there.
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

**The event relay driver (§7) does not change any of this.** It runs
`claim → deliver → acknowledge` on events the Marketing Agent has already
decided to raise. It drives no research, fires no tick, and decides nothing
about what the agent should look at — so it is not a second scheduler and
`MARKETING_AGENT_SCHEDULER_OWNER` stays `marketing-internal-loop`. Two
different jobs, two different owners: the agent decides *when to look*,
JusticeOS decides *when to carry what it found*.

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
| POST | `…/events/relay` | One claim → deliver → acknowledge cycle. **Session cookie OR `JUSTICEOS_RELAY_KEY`.** |
| POST | `…/events/sync` | Retired. Always `410 MARKETING_EVENT_SYNC_RETIRED`; does nothing. |
| POST | `…/events/:eventId/dismiss` | Dismisses the notification; retains the event here and upstream. |

`…/events/relay` is the one route registered **before** the blanket session
check, and that order is load-bearing: the scheduled driver has no browser,
so the route carries its own credential check (§7) rather than inheriting one
only a browser can satisfy. Everything else under the prefix stays
session-only, and a test proves the relay key reaches nothing else.

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
| `MARKETING_EVENT_SYNC_RETIRED` | 410 | The brief-based transport is gone. Points at `…/events/relay`. Nothing synced, claimed, or delivered. |
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
| `COMMUNICATIONS_AGENT_EVENT_URL` | no | The Communications Agent's inbound event endpoint. Unset = the relay reads without claiming; events retained, nobody notified. |
| `COMMUNICATIONS_AGENT_API_KEY` | no | The Communications Agent's **own** credential. |
| `JUSTICEOS_RELAY_KEY` | no | The scheduled relay driver's machine credential, for `…/events/relay` and nothing else. Unset = the relay is operator-triggered only. |

Production validation (`configValidation.ts`) refuses to start on: a
half-configured Communications handoff, a plaintext public endpoint for it,
a short/placeholder credential, a short/placeholder `JUSTICEOS_RELAY_KEY`,
or `justiceos` as scheduler owner.

No JusticeOS migration is required by the event transport, and none is
possible: the gateway holds no database. The migration this change depends
on is the Marketing Agent's own `20260927090000_outbox_delivery`, which adds
the claim/attempt columns and `marketing_outbox_deliveries` on that side.

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

`src/manager/client.ts` exposes `relayEvents()` (one cycle, the operator's
"run it now") in place of the removed `syncEvents()`, and
`src/manager/types.ts` carries the six-state `MarketingEventStatus` and the
outbox event projection so a surface can be built against real types.

Not in this increment: an events/alerts surface on the dashboard (the
`/events` API exists and is tested; nothing renders it yet), and a
marketing health tile. Nothing in the browser holds or needs a credential —
the relay key is server-side, and a test asserts no frontend file names it
or imports the transport modules.

---

## 16. Tests

```
pnpm --filter panda-gateway test     # 383 tests
pnpm test                            # frontend + gateway
```

Gateway suites:

| File | Covers |
| --- | --- |
| `marketingContract.test.ts` | Version handling, envelope validation, approval state, constraints, normalization. |
| `marketingIntent.test.ts` | All nine specified mappings, "a question is never a decision", trade recognition. |
| `marketingRequestIdentity.test.ts` | Identifier hygiene, correlation headers, request identity, single-flight + replay window. |
| `marketingEvents.test.ts` | The outbox contract (fail-closed parsing), the ack-key derivation, the retained store and its statuses, receiver-side dedupe, and the Communications handoff's outcome classification and credential separation. |
| `marketingEventRelay.test.ts` | End-to-end transport acceptance A–L (below), plus the relay driver's credential and dismissal. |
| `marketingHealth.test.ts` | Degraded-is-not-an-outage, what genuinely blocks, what only JusticeOS knows. |
| `businessFactsArtifact.test.ts` | Validation, placeholder refusal, fingerprinting, provisioning steps. |
| `marketingAgentBridge.test.ts` | End-to-end acceptance A–I against a mocked agent (below). |

Transport acceptance cases, mapped to their `describe` blocks in
`marketingEventRelay.test.ts`. The Communications endpoint is a **mock**,
because the real one does not exist (§13 of the blockers):

- **A** — pending event → claim → Communications accepts → ACK `DELIVERED`;
  claimed before delivered, delivered before acknowledged; stable consumer,
  bounded limit, TTL sized above the worst case; the whole claim context
  persisted; still listable afterwards.
- **B** — fetch alone never delivers: with no receiver wired the relay reads
  and claims nothing, the event stays `NEW` and `PENDING` upstream, health
  says so, `…/events/sync` is a `410` tombstone, and no source line names the
  brief's event array any more.
- **C** — a duplicate is not sent again and is acknowledged `DUPLICATE`, never
  `DELIVERED`; the receiver's own 409 relays as `DUPLICATE` too; a genuine
  recurrence still delivers.
- **D** — transient failure → ACK `FAILED_RETRYABLE`; the event becomes
  available again by Marketing's policy and the later attempt uses a **new**
  ack key.
- **E** — permanent failure → ACK `FAILED_FINAL`; the event is kept, not
  discarded.
- **F** — uncertain acknowledgement → retried with the **same** ack key, in
  the cycle and again on the next one; Marketing replays; the attempt count
  does not double and Communications is not called twice.
- **G** — claim expired → `EVENT_CLAIM_INVALID`, no fake success, no second
  acknowledgement, normal reclaim later. Also `EVENT_ALREADY_FINAL`
  (reconcile) and `EVENT_NOT_FOUND` (recorded inconsistency).
- **H** — two relay attempts cannot both deliver one claimed event: the loser
  is handed an empty claim and issues no acknowledgement at all.
- **I** — unsupported contract version fails closed: nothing claimed,
  delivered or acknowledged, `502`, and the transport marked degraded (not an
  outage) in health.
- **J** — `MARKETING_AGENT_API_KEY` appears in no response body, no event
  listing, no health report, nothing sent to Communications, and no frontend
  source file.
- **K** — no provider call: the relay reaches only the agent's
  `/agent/events*` routes and never `/research`, `/tick`, `/prepare-work`,
  `/decisions` or `/brief`.
- **L** — no real notification: the only receiver is the mock, and the
  unconfigured default sends nothing and falls back to nobody.

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
- **D** — `MARKETING_OPPORTUNITY_FOUND` → claimed from the outbox →
  Communications → acknowledged → visible and retained; the brief is never
  read; retained through dismissal; read-only with no handoff configured.
  (The full lifecycle lives in `marketingEventRelay.test.ts`.)
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

1. **No Communications Agent inbound event endpoint exists — still the one
   gap in §7's end-to-end path.** The JusticeOS side is now complete: the
   claim client, the relay lifecycle, the envelope, the credential, the
   outcome classification and every failure state are built and tested
   against a mock receiver. But the Communications Agent's API today exposes
   intake for voice notes and call summaries, proposals, responses and
   direct commands — nothing that accepts a marketing event. Until a
   contract is agreed there, `NOT_CONFIGURED` remains a real state: the
   relay reads the outbox, claims nothing, retains what it finds so Austin
   sees it in the app, and reports honestly that nobody was notified. It
   does not fall back to contacting Austin directly, and it never will —
   that would make JusticeOS a notification service.
2. **The relay driver is implemented but not activated.**
   `.github/workflows/marketing-event-relay.yml` exists with its `schedule:`
   trigger commented out, by design (§7). Activating it needs three things,
   none of them done: the `JUSTICEOS_RELAY_KEY` secret set on the JusticeOS
   Fly app, `JUSTICEOS_RELAY_URL`/`JUSTICEOS_RELAY_KEY` set as repository
   secrets, and blocker 1 resolved — there is no point scheduling deliveries
   to a receiver that does not exist. Until then the relay is
   operator-triggered only.
3. **Event retention is in-process.** No database in the gateway. A restart
   loses JusticeOS's own duplicate-protection layer; the two durable layers
   remain (the outbox never re-offers a settled event, and the receiver
   honours the idempotency key it is sent). Not required for correctness,
   and deliberately not built here.
4. **The facts volume is not provisioned.** §11 is designed, validated and
   scripted; the volume, the mount, the env var and the upload have not
   been done.
5. **The Marketing Agent app is not deployed or configured, and its
   outbox-delivery migration has not been run.** Its Fly app name is still a
   placeholder; `AGENT_LOOP_ENABLED`, the `AGENT_EXECUTE_*` flags and its
   migrations — including `20260927090000_outbox_delivery`, which this
   transport depends on — are untouched by this work. JusticeOS needs no
   migration of its own; the gateway holds no database.
6. **No JusticeOS secrets are set.** `MARKETING_AGENT_BASE_URL` /
   `MARKETING_AGENT_API_KEY` have never been set on the JusticeOS Fly app;
   the integration is off there.
7. **Single-owner actor.** The audit identity upstream is the configured
   owner, not a per-user identity, because JusticeOS has no user table. Fine
   for a single-owner tool; revisit if JusticeOS grows accounts. (The relay's
   consumer identity is a separate thing and is correctly a service name.)
8. **No events/alerts UI.** The API is there — `GET …/events` now reports
   the six-state status, the per-status counts and the transport's degraded
   list — but the dashboard does not render it yet, so today a retained event
   is visible only through the API.
