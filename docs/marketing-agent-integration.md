# Marketing Agent integration (gateway bridge)

JusticeOS's authenticated server-side bridge to the **Marketing Agent**'s
REST API. This increment is the backend half only: the gateway can now
reach the Marketing Agent on behalf of a signed-in JusticeOS user, and
nothing in the frontend has changed (see "Deferred", below).

The Marketing Agent's own API contract — request bodies, response DTOs,
error codes, idempotency semantics — is served by that service at
`GET /api/marketing/openapi.json`. This document covers only what the
JusticeOS side adds: authentication, the operator identity, and what
happens when the Marketing Agent is unreachable.

## Auth chain

```
signed-in browser
  --(HttpOnly justiceos_session cookie, same-origin)-->
JusticeOS gateway
  --(Authorization: Bearer MARKETING_AGENT_API_KEY)-->
Marketing Agent API
```

The browser authenticates to JusticeOS exactly as it already does for
ACP chat: the existing password login (`POST /acp/session`) sets the
`justiceos_session` cookie, and that cookie is the only credential the
page ever holds. Every `/api/marketing/*` route requires a valid,
unexpired session (`gateway/src/requireSession.ts`) — the same check the
ACP WebSocket upgrade performs, in Express middleware form. An
unauthenticated request is rejected with `401 UNAUTHORIZED` **before any
upstream call is made**.

The Marketing Agent credential is attached server-side, in exactly one
place (`gateway/src/marketingAgentClient.ts`). It is never sent to the
browser, never logged (`log.ts` accepts only flat non-secret metadata),
never echoed in an error body, and never revealed by
`/api/marketing/status`. Two tests enforce this structurally:
`gateway/tests/noSecretsInFrontend.test.ts` scans the entire frontend
source for the variable name, for imports of the server-only modules,
and for any `Authorization`/`Bearer` header construction; and
`gateway/tests/marketingRoutes.test.ts` asserts the key appears in no
response body or header even when the upstream rejects it.

A browser-supplied `Authorization` header is ignored — the gateway
decides the upstream credential.

## Environment variables

All server-side, read only by the gateway package (`gateway/src/config.ts`),
which the Vite build graph never reaches. Set them in `gateway/.env` for
local development, or with `fly secrets set` in production (see
[fly-deployment.md](fly-deployment.md)).

| Variable | Required | Meaning |
| --- | --- | --- |
| `MARKETING_AGENT_BASE_URL` | for the integration | The Marketing Agent's API root, **without** its `/api/marketing` prefix — the gateway appends that itself. Production: a private destination, e.g. `http://marketing-agent.internal:8787`. Local: `http://127.0.0.1:8787`. |
| `MARKETING_AGENT_API_KEY` | for the integration | The Marketing Agent's own `MARKETING_AGENT_API_KEY`. Presented only on the server-to-server call. |
| `MARKETING_AGENT_ACTOR` | no | Who the Marketing Agent records as the operator. Defaults to `ACP_ALLOWED_USER_ID`. |

Both of the first two unset = the integration is simply off. In
production, `configValidation.ts` additionally refuses to start if only
one of the pair is set, if the key is shorter than 32 characters or looks
like a placeholder, or if the base URL is plaintext `http:` to anything
other than a `.internal`/loopback host — the same private-destination
rule the ACP upstream already follows, because this credential grants
campaign-approval rights.

## Routes

All under `/api/marketing`, all requiring a JusticeOS session. This is an
explicit allowlist, not a wildcard proxy, so a future Marketing Agent
endpoint is never exposed by accident. Each route forwards to the same
path on the Marketing Agent (query string included, for the queue).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/marketing/status` | JusticeOS-side integration status (see "Readiness"). Not a proxy. |
| GET | `/api/marketing/campaigns/review` | Review queue. `?limit=` and repeatable `?status=` are forwarded. |
| GET | `/api/marketing/campaigns/:campaignId/review` | Full review model for the active revision. |
| GET | `/api/marketing/revisions/:revisionId/review` | One exact revision (history/audit). |
| POST | `/api/marketing/revisions/:revisionId/request-changes` | |
| POST | `/api/marketing/revisions/:revisionId/edit-channel` | |
| POST | `/api/marketing/revisions/:revisionId/remove-channel` | |
| POST | `/api/marketing/revisions/:revisionId/regenerate-channel` | |
| POST | `/api/marketing/revisions/:revisionId/replace-media` | |
| POST | `/api/marketing/revisions/:revisionId/approve` | The only path that can create an Approval — upstream, in the Marketing Agent. |
| POST | `/api/marketing/campaigns/:campaignId/reject` | |
| POST | `/api/marketing/campaigns/:campaignId/cancel` | |

Anything else under the prefix answers a JSON `404 ROUTE_NOT_FOUND`
rather than falling through to the SPA shell (same reasoning as
`acpApiFallback.ts`).

The gateway holds no campaign logic. It does not interpret, validate, or
re-implement anything the Marketing Agent decides: approval gates,
revision staleness, media ownership, and the redaction of internal-only
project facts all stay upstream. **Approval through this bridge is one
ordinary API call — the gateway publishes nothing, schedules nothing, and
holds no publisher adapter.**

## Actor

`POST` bodies are forwarded as sent, except that any `actor` field the
browser included is **discarded and replaced** with the gateway's
configured operator identity (`MARKETING_AGENT_ACTOR`, else
`ACP_ALLOWED_USER_ID`). An audit identity is the server's to assert.

**Known limitation.** JusticeOS's login is single-owner: one shared
password, and the session token (`gateway/src/session.ts`) is an HMAC
over `expiresAt.nonce` — it carries no user id, because there is no user
table to carry one from. So "the authenticated JusticeOS operator" is
necessarily the single configured owner, not a per-user identity derived
from the session. If JusticeOS later grows real user accounts, the actor
should come from the session and this configuration becomes a fallback.

With no actor configured at all, **mutations** refuse with
`503 MARKETING_ACTOR_NOT_CONFIGURED` and no upstream call is made; reads
are unaffected.

## Idempotency

An `Idempotency-Key` header is forwarded verbatim. The gateway never
invents one and never stores anything about it — the semantics belong to
the Marketing Agent (a retry with the same key replays the recorded
result rather than applying twice). A future UI should generate a fresh
UUID per user action and resend the same value on retry.

## Errors

Everything under `/api/marketing` uses the Marketing Agent's structured
shape, including the gateway's own errors:

```json
{ "error": { "code": "…", "message": "…", "details": {} } }
```

The Marketing Agent's own statuses and bodies pass through **unchanged**
— `REVISION_STALE`, `APPROVAL_BLOCKED`, `CONTEXT_CHANGED`,
`MEDIA_CONFLICT`, `CAMPAIGN_ALREADY_FINAL`, `INVALID_EDIT`, and the rest
all reach the browser exactly as that service wrote them. Only response
*headers* are dropped (neither direction forwards them).

Codes the gateway itself produces:

| Code | Status | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | No valid JusticeOS session. No upstream call was made. |
| `GATEWAY_SESSION_NOT_CONFIGURED` | 503 | This gateway has no session secret, so it cannot authenticate anyone. |
| `MARKETING_AGENT_NOT_CONFIGURED` | 503 | `MARKETING_AGENT_BASE_URL` / `MARKETING_AGENT_API_KEY` are not set here. |
| `MARKETING_ACTOR_NOT_CONFIGURED` | 503 | No operator identity configured; mutations only. |
| `MARKETING_AGENT_UNAVAILABLE` | 502 | The Marketing Agent did not answer (`details.reason`: `timeout`, `network`, or `malformed-response`). Nothing was changed. |
| `ROUTE_NOT_FOUND` | 404 | No such Marketing Agent endpoint on this gateway. |

No stack trace ever reaches the browser. A non-JSON upstream reply (a
proxy error page, a wrong base URL) is reported as
`MARKETING_AGENT_UNAVAILABLE` rather than passed through, so whatever it
contained cannot leak. One upstream call is bounded at 10s (3s for the
status probe).

## Readiness

`GET /health` is unchanged and stays deliberately minimal — liveness
only, unauthenticated, revealing nothing about configuration. Fly's
health check keeps using it, and **a missing or unreachable Marketing
Agent never makes the gateway unhealthy, never blocks startup, and never
affects login or ACP chat.** Marketing is an integration dependency, not
a prerequisite.

Integration status lives behind the session at
`GET /api/marketing/status`:

```json
{
  "gateway": "ok",
  "marketing": {
    "configured": true,
    "actorConfigured": true,
    "reachability": "REACHABLE",
    "checkedAt": "2026-09-17T19:40:00.000Z"
  },
  "livePublishing": "DISABLED"
}
```

`reachability` is `REACHABLE`, `UNREACHABLE`, or `NOT_CONFIGURED`, so a
dashboard can distinguish "JusticeOS is fine, marketing is down" from
"marketing was never configured here". The base URL and the credential
are never included.

## Media gap (unsolved, deliberately)

The Marketing Agent returns media **metadata only** — asset id, MIME
type, original filename, safety state, project association, lifecycle
state — plus an explicit
`content: { kind: "NOT_SERVED_BY_THIS_API" }` marker. It does not serve
image bytes, and neither does this gateway.

Rendering campaign media therefore needs a separate, deliberate design: a
short-lived signed read URL, or a streaming endpoint that re-authenticates
the JusticeOS session per request. Until then a UI should render a
placeholder from the filename and MIME type. **Do not** mint public Drive
links or proxy Drive credentials to close this gap.

## Deferred

Intentionally **not** in this increment:

- any Marketing Agent UI — no new view, no queue screen, no campaign
  review workspace, no change to the ACP chat experience;
- frontend testing libraries (none are needed while no UI exists);
- media byte delivery (above);
- live publishing, which remains disabled in the Marketing Agent itself.

## Tests

`pnpm --filter panda-gateway test` — see `gateway/tests/marketingRoutes.test.ts`
(session enforcement, credential attachment and non-leakage, actor
override, body/idempotency forwarding, upstream error pass-through,
unavailable/timeout/malformed handling, optionality, status) and the
extended `noSecretsInFrontend.test.ts` / `deploymentArtifacts.test.ts`.
`gateway/tests/helpers/mockMarketingAgent.ts` enforces the real
`Authorization: Bearer` contract, so a test cannot pass while forgetting
the credential.
