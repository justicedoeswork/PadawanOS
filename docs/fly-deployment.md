# Deploying the JusticeOS gateway to Fly.io

**Status: preparation only.** Nothing in this document, `Dockerfile`,
or `fly.toml` has been deployed. No Fly app, DNS record, or secret
exists yet. This is the reviewed starting point for the person who
does that (Austin), not a completed deployment.

> **JusticeOS is currently an internal Justice Exteriors application
> name. Perform formal name clearance and rebranding review before
> public or App Store distribution.**

## What this Fly service is

One Fly app running the container built from the repo-root
`Dockerfile`: the JusticeOS gateway (`gateway/`), serving the
gateway-mode Vite build (`pnpm build:gateway`'s `dist/`) and
terminating the authenticated `/acp/insurance` WebSocket proxy to the
Insurance Agent's private ACP listener
(`ws://insurance-audit-agent.internal:3001/acp`, reachable only over
Fly's private 6PN networking -- see the Insurance Agent repo's own
Phase 1/pre-canary hardening work for that side).

Only the gateway's own HTTP(S) port is exposed publicly
(`fly.toml`'s `[http_service]`); there is no other public service or
port.

## Required production environment variables

Every one of these must be set (as a Fly **secret**, via
`fly secrets set`, never in `fly.toml`, never committed) before
`NODE_ENV=production` will actually start the process --
`gateway/src/configValidation.ts` throws and refuses to boot
otherwise. No value is created or suggested below beyond the format
each one needs.

| Variable | Secret? | Required shape | Set via |
|---|---|---|---|
| `NODE_ENV` | no | exactly `production` | `fly.toml` `[env]` (already set) |
| `JUSTICEOS_GATEWAY_PASSWORD_HASH` | **yes** | `scrypt` output, `<salt-hex>:<derived-key-hex>` (see `gateway/src/password.ts`'s header comment for the exact `node -e` command to generate one) | `fly secrets set` |
| `JUSTICEOS_SESSION_SECRET` | **yes** | random string, at least 32 characters (`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` gives 64) | `fly secrets set` |
| `ACP_GATEWAY_SERVICE_KEY` | **yes** | random string, at least 32 characters; must be the *same* value configured as the Insurance Agent's `ACP_GATEWAY_SERVICE_KEY` -- a shared secret between exactly these two services, never reused from the Insurance Agent's own `AUDIT_AGENT_API_KEY` | `fly secrets set` |
| `JUSTICEOS_ALLOWED_ORIGINS` | no (but sensitive to get right) | comma-separated, exact HTTPS origin(s) this app is actually served from (e.g. `https://<final-app-name>.fly.dev`) -- production refuses to boot without at least one exact HTTPS origin | `fly.toml` `[env]`, once the app name below is final, or `fly secrets set` if you'd rather not commit it |
| `INSURANCE_AGENT_ACP_URL` | no | `ws://insurance-audit-agent.internal:3001/acp` -- already set in `fly.toml` | `fly.toml` `[env]` (already set) |
| user id | **yes** | the one allowed ACP user id (matches the Insurance Agent's own allowlist, e.g. `austin`) | `fly secrets set` |
| realm id | **yes** | the one allowed QuickBooks realm id (the same value already used throughout the Insurance Agent's own config/tests) | `fly secrets set` |

**Naming note:** the last two are documented here without a
`JUSTICEOS_`-prefixed name because the gateway's actual code
(`gateway/src/config.ts`) reads `ACP_ALLOWED_USER_ID` /
`ACP_ALLOWED_REALM_ID` -- these were not in this rename's requested
list of variables to rename, and are shared naming with the ACP
connection itself rather than JusticeOS-specific branding, so they
were left as-is. Say the word if you'd rather these were renamed too;
that would be a small, separate change to `config.ts` and everywhere
they're read.

`JUSTICEOS_GATEWAY_PASSWORD` (plaintext) is deliberately **not** in
this table: it exists only for local development, and production
refuses to start if it's set at all (`configValidation.ts`) -- use the
hash form above.

## Confirmed: production refuses to boot on every unsafe input

Verified directly against the real entry point (`gateway/src/index.ts`
via `node --import tsx src/index.ts`, `NODE_ENV=production`), not just
unit tests -- each of these crashes the process immediately with an
explicit, itemized error rather than starting half-configured:

- every secret above missing entirely
- `JUSTICEOS_GATEWAY_PASSWORD_HASH` / `JUSTICEOS_SESSION_SECRET` /
  `ACP_GATEWAY_SERVICE_KEY` left as the literal example text from
  `gateway/.env.example` (e.g. `replace-me...`) -- a copy-paste of the
  example file is caught even when it happens to be long enough to
  pass the plain length check
- `JUSTICEOS_GATEWAY_PASSWORD` (plaintext) set instead of the hash
- `INSURANCE_AGENT_ACP_URL` pointed at a public host (e.g. the
  Insurance Agent's own `insurance-audit-agent.fly.dev`) instead of a
  `.internal`/private address
- `JUSTICEOS_ALLOWED_ORIGINS` with no exact HTTPS entry

## Proposed Fly app name

Fly app names are globally unique and become part of the default
`<name>.fly.dev` hostname, which then has to match
`JUSTICEOS_ALLOWED_ORIGINS` exactly. Neither of these is reserved or
checked for availability yet.

- `justiceos` -- primary choice
- `justice-exteriors-justiceos` -- fallback, if `justiceos` is
  unavailable; also matches the Insurance Agent's own
  `justice-exteriors-*` naming, if you want the two to read as a pair

Whichever is used, replace `fly.toml`'s `app =` value with it (it
currently reads `"justiceos"` as a proposed candidate, not a
confirmed/reserved name) before running anything.

## Exact required setup sequence (none of this has been run)

1. Confirm the app name (above) is actually available:
   `fly apps create justiceos` (or `justice-exteriors-justiceos` if
   not, or let `fly launch` create it in step 3 -- either way, this is
   the first real infrastructure this process creates, and it's a
   deliberate, separate step from everything in this repo).
2. Update `fly.toml`'s `app =` value if the fallback name was needed,
   and set `JUSTICEOS_ALLOWED_ORIGINS` in `[env]` to
   `https://<chosen-name>.fly.dev` (or a custom domain, once that
   domain is actually attached).
3. Generate and set every secret from the table above:
   ```
   fly secrets set \
     JUSTICEOS_GATEWAY_PASSWORD_HASH='<generated hash>' \
     JUSTICEOS_SESSION_SECRET='<generated random string>' \
     ACP_GATEWAY_SERVICE_KEY='<the same value set on the Insurance Agent side>' \
     ACP_ALLOWED_USER_ID='<the real user id>' \
     ACP_ALLOWED_REALM_ID='<the real realm id>' \
     --app <chosen-name>
   ```
4. Confirm the Insurance Agent side already has its matching
   `ACP_GATEWAY_SERVICE_KEY` set and its private ACP listener enabled
   (`ACP_ENABLED=true` on that app only) -- this gateway dialing out
   is only half of the connection.
5. Confirm both apps are in the same Fly organization (private `.internal`
   networking is org-scoped) so `insurance-audit-agent.internal` actually
   resolves from this gateway's app.
6. Only then: `fly deploy`.
7. After deploying, verify from *outside* Fly's network that
   `/acp/insurance` still rejects an unauthenticated/wrong-Origin
   connection (curl or a browser dev console against the real
   `https://<chosen-name>.fly.dev`), the same way the automated tests
   already prove locally -- a production environment is the one place
   those tests can't run themselves.

None of steps 1-6 were performed as part of this preparation; step 7
obviously can't be performed until they are.

## Remaining risks / things this preparation could not verify here

- **Docker build was not executable in this sandbox.** This
  environment's egress policy blocks Docker Hub's CDN entirely (the
  same class of restriction that blocked direct HTTPS access to
  `*.fly.dev` in earlier phases of this project) -- `docker pull
  node:24-slim` itself fails here with a 403. The `Dockerfile` was
  instead verified by: (a) running the exact commands it invokes
  (`pnpm install --frozen-lockfile`, `pnpm build:gateway`) natively,
  both of which succeeded, and (b) reconstructing the runtime stage's
  exact directory layout on the local filesystem (symlinked
  `node_modules`, copied `gateway/src`+`package.json`+built `dist/`)
  and running its exact `CMD` from it, which booted correctly, served
  the real built frontend at `/`, and answered `/health`. A real
  `docker build` should still be run once by someone with normal
  internet access before the first deploy, as a final check.
- **`Fly-Client-IP` trust (`gateway/src/clientIp.ts`)**: documented in
  the code itself as unverified against the real Fly platform, since
  this gateway has never been deployed. Worth a manual spot-check
  after the first real deploy.
- **`min_machines_running = 0`**: chosen to match the Insurance
  Agent's own reviewed, running configuration, but means a scaled-to-
  zero machine can drop an open `/acp/insurance` WebSocket. Reconsider
  if that turns out to matter in practice.
- **Image size / prod dependencies**: the runtime image ships `tsx`
  and `typescript` (gateway's own `devDependencies`) because
  `gateway/package.json`'s existing `start` script runs the TypeScript
  source directly via `tsx` rather than a compiled-JS entry point.
  This preparation deliberately did not change that script (out of
  scope for "minimum production deployment files"), but a smaller,
  slightly faster-starting image is possible later by adding a real
  `tsc` build step and running compiled JS with plain `node` instead.
- **Naming/branding is internal-only.** "JusticeOS" has not been
  through trademark/name clearance and is not cleared for any public
  or App Store listing -- see the notice at the top of this document.
