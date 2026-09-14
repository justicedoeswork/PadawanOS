# Production image for the PadawanOS gateway (gateway/) -- the one Fly
# service that serves the gateway-mode Vite build and terminates the
# authenticated /acp/insurance WebSocket proxy to the Insurance Agent's
# private ACP listener. This builds and packages the gateway; it does
# NOT configure any secret, does NOT create a Fly app, and does NOT by
# itself connect anywhere -- see fly.toml and docs/fly-deployment.md
# for what still has to happen (by a human, with real secrets) before
# any of that becomes true.
#
# Node 24 / pnpm 11 deliberately match .github/workflows/ci.yml and
# deploy.yml's own explicit version pins -- this repo has no
# `packageManager` field to corepack against automatically, so both
# CI and this image pin the same major versions by hand rather than
# risking a "latest" drift between them.

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# build: install the full pnpm workspace and produce the gateway-mode
# frontend build (dist/). A single COPY + install (rather than a
# deps-only layer with --ignore-scripts) is deliberate: the root
# package's own postinstall (scripts/sync-material-icons.mjs) copies
# icon assets INTO public/ that vite build then bundles -- skipping it
# would silently ship a build missing file-type icons, so the full
# source must already be present before `pnpm install` runs its
# scripts. This costs some Docker layer-cache efficiency (any source
# change reruns the install step); a follow-up could split this into a
# manifest-only --ignore-scripts layer plus a second scripted install,
# but that optimization is deferred rather than risking the icon sync
# breaking silently in the meantime.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:gateway

# ---------------------------------------------------------------------------
# runtime: only what the gateway process actually needs. No frontend
# source, no other workspace package (desktop/, test-agent/), no dev
# tooling beyond what gateway/package.json's own `start` script already
# requires (tsx -- see the comment in gateway/package.json; shipping it
# to production is an existing tradeoff of using the repo's own start
# script unmodified, not something this image adds).
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/gateway/node_modules ./gateway/node_modules
COPY --from=build /app/gateway/package.json ./gateway/package.json
COPY --from=build /app/gateway/src ./gateway/src
COPY --from=build /app/dist ./dist

WORKDIR /app/gateway

# Matches gateway/src/config.ts's default (Number(process.env.PORT || 4600))
# and fly.toml's internal_port -- kept in sync by hand since neither file
# reads the other.
EXPOSE 4600

# Same entry point gateway/package.json's own "start" script uses --
# this image does not invent a different production entry point.
CMD ["node", "--import", "tsx", "src/index.ts"]
