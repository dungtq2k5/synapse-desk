# syntax=docker/dockerfile:1.7

# The image for EVERY Node service in this monorepo — 23-doc §3.
#
# **One parameterized file rather than six near-identical ones.** The six differ
# only in which workspace they build, and six copies of the same five-stage
# build is six places for a fix to be applied five times. The same reasoning
# `libs/common` applies to shared behaviour, applied to the build:
#
#     docker build -f docker/node-service.Dockerfile \
#       --build-arg SERVICE=api-gateway \
#       --build-arg GIT_SHA="$(git rev-parse HEAD)" \
#       --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#       -t synapsedesk/api-gateway .
#
# `rag-service` is Python and has its own file; it is the one service where the
# stages genuinely differ.

# 22.12 is the FLOOR, not a preference — `apps/ingestion-service/package.json`
# pins `engines.node: >=22.12` because `pdfjs-dist` is ESM-only and is loaded
# through `createRequire`, which needs a Node that can `require()` ESM. Running
# the image on 22.11 fails at the first PDF, not at boot.
ARG NODE_VERSION=24-alpine

# ============================================================ build-args gate
#
# **First stage, and it depends on nothing** — so a missing arg fails in seconds
# rather than after the full install-and-compile. A guard that only fires ten
# minutes into a build is a guard people learn to work around by passing
# `GIT_SHA=x`; one that fails immediately is just part of the command.
#
# **The build FAILS without GIT_SHA**, deliberately (23-doc §3 test 2). The
# tempting alternative is a default of `"unknown"`, which produces an image that
# starts happily and cannot say what it is — at exactly the moment, mid
# incident, when "did the fix actually roll out?" is the only question anyone is
# asking. An unidentifiable image is worse than a failed build.
FROM busybox:1.37 AS build-args
ARG SERVICE
ARG GIT_SHA
ARG BUILD_TIME
RUN test -n "$SERVICE"    || (echo 'SERVICE build arg is required' && false)
RUN test -n "$GIT_SHA" \
  || (echo 'GIT_SHA build arg is required — an image that cannot identify itself must not ship' \
      && false)
RUN test -n "$BUILD_TIME" || (echo 'BUILD_TIME build arg is required' && false)

# ==================================================================== prune
#
# **`turbo prune` is what keeps one service's image from carrying all six
# services' dependencies.** A plain `npm ci` at the workspace root installs
# every workspace's production tree, so the notification-service image shipped
# `pdfjs-dist`, `socket.io` and the Firebase SDK — around a gigabyte of code it
# cannot execute, and every CVE in it lands on this service's report.
#
# `--docker` splits the output into `out/json` (manifests plus a PRUNED
# lockfile) and `out/full` (source), which is what lets the install layer below
# be keyed on manifests alone.
FROM node:${NODE_VERSION} AS prune
WORKDIR /app
COPY . .
ARG SERVICE
RUN npx --yes turbo@^2 prune "@synapsedesk/${SERVICE}" --docker

# =============================================================== deps (full)
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Manifests only, before the source. This layer is keyed on the pruned
# lockfile, so an ordinary source change reuses the cached `npm ci` instead of
# re-resolving the dependency tree — which is most of the build's wall clock.
COPY --from=prune /app/out/json/ ./

# **Nothing but manifests here, and that is the point.** This layer used to also
# copy every service's source (for `prisma/schema.prisma`) and the root tsconfig,
# because `prisma generate` ran from an npm `postinstall` and needed both at
# INSTALL time. That made the layer source-keyed: editing one line of TypeScript
# invalidated it and paid for a full `npm ci` on every build.
#
# Generation is now a turbo task that `build` depends on, so it happens in the
# stage that already has the source, and this layer is keyed on the pruned
# lockfile alone.
RUN --mount=type=cache,target=/root/.npm npm ci

# ==================================================================== build
FROM deps AS build
WORKDIR /app
ARG SERVICE

COPY --from=prune /app/out/full/ ./
# `scripts/` sits outside every workspace, so prune leaves it behind — and
# `grpc-proto`'s build shells out to `scripts/copy-protos.mjs`, without which
# the image has compiled types and no .proto files to load at boot.
COPY --from=prune /app/scripts ./scripts
# The ROOT tsconfig, which `prisma.config.ts` extends. Prisma 7 loads that config
# through the TypeScript compiler, so without it `db:generate` fails with
# `File '../../tsconfig.json' not found`. Copied from the prune stage's own
# checkout rather than `out/`, which does not carry root config files.
#
# It lives HERE rather than in `deps` because generation moved into this stage
# with the rest of the build — see the note above `npm ci`.
COPY --from=prune /app/tsconfig.json ./

# `...` builds this service AND the workspaces it depends on. Prune already
# narrowed the graph; the filter keeps the intent readable.
#
# This also runs `db:generate` first: `build` depends on it in `turbo.json`, so
# the Prisma client is produced here rather than as a side effect of `npm ci`.
RUN npx turbo run build --filter="@synapsedesk/${SERVICE}..."

# ============================================================ deps (runtime)
#
# A SECOND install rather than pruning the first. `npm prune --omit=dev` across
# workspaces leaves the symlink farm in a state that is hard to verify, and the
# thing being verified here is "does the runtime image contain a compiler" — a
# question worth a clean answer rather than a clever one.
FROM deps AS prod-deps
WORKDIR /app
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ================================================================== runtime
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ARG SERVICE
ARG GIT_SHA
ARG BUILD_TIME
ARG APP_VERSION=1.0.0

# Forces the `build-args` gate into this image's dependency graph. Without a
# reference to it, BuildKit prunes the stage as unreachable and the guard never
# runs — a check that is correct, present, and skipped.
COPY --from=build-args /bin/true /tmp/.build-args-checked

ENV NODE_ENV=production \
    BUILD_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME \
    APP_VERSION=$APP_VERSION \
    SERVICE_NAME=$SERVICE

COPY --from=prod-deps /app/node_modules ./node_modules

# The workspace libraries, at the SAME relative paths. npm workspaces links
# `node_modules/@synapsedesk/common` to `../../libs/common`, so a runtime image
# that copied only `apps/` would carry a symlink pointing at nothing — and the
# failure is a module-not-found at boot, after the image has been pushed.
COPY --from=build /app/libs/common/package.json ./libs/common/
COPY --from=build /app/libs/common/dist ./libs/common/dist
COPY --from=build /app/libs/grpc-proto/package.json ./libs/grpc-proto/
# `dist/proto` carries the .proto FILES, not just the compiled types. gRPC's
# loader reads them at startup, so an image without them fails to boot rather
# than failing on the first call — see `scripts/copy-protos.mjs`.
COPY --from=build /app/libs/grpc-proto/dist ./libs/grpc-proto/dist

COPY --from=build /app/apps/${SERVICE}/package.json ./apps/${SERVICE}/
COPY --from=build /app/apps/${SERVICE}/dist ./apps/${SERVICE}/dist

# **One entrypoint name for two compiler layouts**, resolved at BUILD time.
#
# Every service compiles with SWC and emits `dist/src/main.js`. api-gateway
# cannot: the Swagger CLI plugin is a TypeScript AST transformer, and SWC does
# not run it — so the gateway stays on `tsc`, whose path aliases pull
# `libs/*/src` into the program, move the common source root, and emit
# `dist/apps/api-gateway/src/main.js` instead.
#
# A single hardcoded ENTRY served one of those and silently broke the other. A
# second build-arg would work and is a footgun: the wrong default builds a
# pushed image that only fails at `docker run`. Probing here instead means a
# layout matching NEITHER fails the build, which is the one place a mistake is
# still cheap.
RUN set -eu; \
    cd "/app/apps/${SERVICE}"; \
    if   [ -f dist/src/main.js ];                    then target=dist/src/main.js; \
    elif [ -f "dist/apps/${SERVICE}/src/main.js" ];  then target="dist/apps/${SERVICE}/src/main.js"; \
    else echo "No compiled entrypoint for ${SERVICE} — was it built?" >&2; exit 1; fi; \
    ln -s "$target" entry.js; \
    echo "Entrypoint for ${SERVICE}: $target"

# Non-root. `node` exists in the base image already; creating a user here would
# only add a layer and a uid nothing else knows about.
USER node

# Secrets are MOUNTED, never copied: JWT keys and the Firebase service account
# are gitignored and must not be baked into a layer that anyone who can pull the
# image can extract. The paths come from each service's own `*_KEY_PATH` config.
WORKDIR /app/apps/${SERVICE}

# Not `npm start`: npm forks a shell that does not forward SIGTERM, so the
# process never sees the signal `enableShutdownHooks()` is waiting for and the
# container is SIGKILLed after the grace period — dropping in-flight requests on
# every deploy. Exec'ing node directly makes it PID 1 and gives it the signal.
#
# `${SERVICE}` cannot be interpolated in exec form, so it is baked into an env
# var at build time and exec'd through it. `entry.js` is the symlink resolved
# above; Node follows it and resolves the module's own `require`s from the real
# path, so relative imports inside `dist` are unaffected.
ENV ENTRY=/app/apps/${SERVICE}/entry.js
CMD ["sh", "-c", "exec node \"$ENTRY\""]
