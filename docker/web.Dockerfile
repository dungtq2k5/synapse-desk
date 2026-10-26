# syntax=docker/dockerfile:1.7

# The web client, `apps/web`: Next.js's `standalone` output on the same Node
# base as the services.
#
#     docker build -f docker/web.Dockerfile \
#       --build-arg GIT_SHA="$(git rev-parse HEAD)" \
#       --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#       -t synapsedesk/web .
#
#     docker run --rm -p 5173:5173 -e GATEWAY_URL=http://api-gateway:3000 synapsedesk/web
#
# **Its own file, not a target of `node-service.Dockerfile`.** The stages
# differ where it matters: no Prisma, no `dist/` per workspace, and a runtime
# that is Next's traced `standalone` tree rather than a second `npm ci`.
# `standalone` copies exactly the files the server can reach, so the runtime
# carries no compiler and no devDependency by construction.

# The same pin as `node-service.Dockerfile`, for the same reason;
# `image-contract.spec.ts` asserts the two agree.
ARG NODE_VERSION=24.19.0-alpine3.24

# --------------------------------------------------------------- build-args gate
# First, depending on nothing, so a missing arg fails in seconds:
# `node-service.Dockerfile` explains why an image that can't say what it is
# must not build.
FROM busybox:1.37 AS build-args
ARG GIT_SHA
ARG BUILD_TIME
RUN test -n "$GIT_SHA" \
  || (echo 'GIT_SHA build arg is required — an image that cannot identify itself must not ship' \
      && false)
RUN test -n "$BUILD_TIME" || (echo 'BUILD_TIME build arg is required' && false)

# --------------------------------------------------------------- prune
FROM node:${NODE_VERSION} AS prune
WORKDIR /app
COPY . .
# The lockfile's turbo; `image-contract.spec.ts` asserts it.
ARG TURBO_VERSION=2.10.9
RUN npm i -g --ignore-scripts "turbo@${TURBO_VERSION}" \
  && turbo prune @synapsedesk/web --docker

# --------------------------------------------------------------- deps
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# The manifest's `packageManager`; `image-contract.spec.ts` asserts it.
ARG NPM_VERSION=11.9.0
RUN npm i -g --ignore-scripts "npm@${NPM_VERSION}"
# Manifests only, so a source change reuses the install.
COPY --from=prune /app/out/json/ ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# --------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY --from=prune /app/out/full/ ./
# The REST client is generated from the API document at build time, and the
# document lives outside every workspace, so prune leaves it behind.
# `.dockerignore` lets exactly this file of `docs/` into the context.
COPY --from=prune /app/docs/reference/openapi.json ./docs/reference/
# `standalone` traces from the repository root (`outputFileTracingRoot`), and
# `next build` typechecks against the root tsconfig the app's extends.
COPY --from=prune /app/tsconfig.json ./
# `...` builds the app and the packages it depends on, generation first, with
# the turbo `npm ci` installed from the lockfile.
# The commit the browser reports its errors under (`NEXT_PUBLIC_BUILD_ID`,
# inlined at build time by next.config.ts).
ARG GIT_SHA
ENV GIT_SHA=${GIT_SHA}
RUN ./node_modules/.bin/turbo run build --filter="@synapsedesk/web..."

# --------------------------------------------------------------- runtime
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ARG GIT_SHA
ARG BUILD_TIME
ARG APP_VERSION=1.0.0

# Ties the build-args gate into the graph; without a reference BuildKit
# prunes it and the guard never runs.
COPY --from=build-args /bin/true /tmp/.build-args-checked

# `HOSTNAME` is what the standalone server binds: every interface, not the
# container's own name. `PORT` is the one the Service and the probes use.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=5173 \
    BUILD_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME \
    APP_VERSION=$APP_VERSION \
    SERVICE_NAME=web

# The traced server and its node_modules, then the two directories
# `standalone` leaves out by design: the static chunks and `public/`.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 5173

# Node directly, as PID 1, so it receives SIGTERM (`node-service.Dockerfile`
# says why `npm start` would not).
CMD ["node", "apps/web/server.js"]
