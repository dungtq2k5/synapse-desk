# syntax=docker/dockerfile:1.7

# The image for EVERY Node service in this monorepo.
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
# -t synapsedesk/api-gateway.
#
# And to RUN the result (the mount is the one thing a reader cannot derive):
#
# The network is `synapsedesk-network` because `docker-compose.yml` sets
# `networks.default.name` explicitly. Compose's OWN default would be
# `<project>_default` — which is what this comment said until it was measured,
# and `docker run` answers a wrong network name with `network … not found`
# rather than anything that hints at the real one.
#
#     docker run --rm --network synapsedesk-network \
#       --env-file apps/auth-service/.env.docker \
#       -v "$PWD/apps/auth-service/secrets:/app/apps/auth-service/secrets:ro" \
#       synapsedesk/auth-service
#
# The mount target is `$WORKDIR/secrets`, because the key paths in the env
# contract are RELATIVE and resolved against `process.cwd()` — the same cwd
# `turbo run dev` uses in the package directory, which is why one value works
# in both places. storage-service is the odd one out: its credential is
# `./serviceAccountKey.json` at the package ROOT, not under `secrets/`, so its
# mount is `-v .../serviceAccountKey.json:/app/apps/storage-service/serviceAccountKey.json:ro`.
# `.env.docker` is GENERATED from `.env` by `scripts/generate-docker-env.mjs`
# (host addresses swapped for compose service names) and is gitignored — see
# that script's header for why generated-not-tracked is the drift answer.
#
# `rag-service` is Python and has its own file; it is the one service where the
# stages genuinely differ.

# 22.12 is the FLOOR, not a preference — `apps/ingestion-service/package.json`
# pins `engines.node: >=22.12` because `pdfjs-dist` is ESM-only and is loaded
# through `createRequire`, which needs a Node that can `require()` ESM. Running
# the image on 22.11 fails at the first PDF, not at boot.
#
# And the CEILING is pinned too, to a full version rather than `24-alpine`: a
# floating tag makes the image a function of the pull date — measured, the npm
# it ships moved 11.17.0 -> 11.19.0 between two pulls one hour apart, across
# the release that changed whether install scripts run at all. Read the new
# value off the registry when bumping; a tag still moves for security rebuilds
# of the same version, which is the pin's deliberate looseness.
ARG NODE_VERSION=24.19.0-alpine3.24

# --------------------------------------------------------------- build-args gate
# **First stage, and it depends on nothing** — so a missing arg fails in seconds
# rather than after the full install-and-compile. A guard that only fires ten
# minutes into a build is a guard people learn to work around by passing
# `GIT_SHA=x`; one that fails immediately is just part of the command.
#
# **The build FAILS without GIT_SHA**, deliberately. The
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

# --------------------------------------------------------------- prune
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
# Must match `turbo` in package-lock.json. The pruner decides the shape of the
# lockfile `npm ci` then installs from, so an unpinned `turbo@^2` makes the
# image's dependency tree a function of the build DATE — measured: the prune
# stage ran 2.10.12 from the network while the build stage ran the lockfile's
# 2.10.9. `image-contract.spec.ts` asserts this ARG equals the lockfile.
ARG TURBO_VERSION=2.10.9
RUN npx --yes "turbo@${TURBO_VERSION}" prune "@synapsedesk/${SERVICE}" --docker

# --------------------------------------------------------------- deps (full)
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Must match `packageManager` in package.json — which is TRUE on developer
# machines (measured: local npm is exactly 11.9.0) and was false only in the
# image, where the base ships whatever npm is current on the day of the pull.
# npm 11.17 changed whether install scripts run at all (`allowScripts`); the
# gate is harmless for this dependency set today (Prisma 7 ships its musl
# engine in-package, the native modules resolve prebuilds at require time),
# and pinning converts that from luck into construction.
# `image-contract.spec.ts` asserts this ARG equals the manifest.
ARG NPM_VERSION=11.9.0
RUN npm i -g "npm@${NPM_VERSION}"

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
#
# No build toolchain (`build-base`, `python3`, `g++`) here, ON PURPOSE — the
# classic Alpine native-module trap does not apply: both native packages in
# the tree (`bcrypt` via prebuildify, `msgpackr-extract`) ship musl prebuilds.
# Measured on this base: both install and load with a bare `npm ci`.
RUN --mount=type=cache,target=/root/.npm npm ci

# --------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
ARG SERVICE

COPY --from=prune /app/out/full/ ./
# `scripts/` sits outside every workspace, so prune leaves it behind — and
# `grpc-proto`'s build shells out to `scripts/copy-protos.mjs`, without which
# the image has compiled types and no.proto files to load at boot.
#
# ONLY that file, not `scripts/`: the directory also holds `seed-demo/`, whose
# TypeScript imports the generated Prisma clients of TWO services — code that
# cannot typecheck in a pruned single-service context, and the typecheck below
# is the point of this stage.
COPY --from=prune /app/scripts/copy-protos.mjs ./scripts/
# The ROOT tsconfig, which `prisma.config.ts` extends. Prisma 7 loads that config
# through the TypeScript compiler, so without it `db:generate` fails with
# `File '././tsconfig.json' not found`. Copied from the prune stage's own
# checkout rather than `out/`, which does not carry root config files.
#
# It lives HERE rather than in `deps` because generation moved into this stage
# with the rest of the build — see the note above `npm ci`.
COPY --from=prune /app/tsconfig.json ./

# `prisma-erd-generator` writes to `docs/reference/erd/<service>.md`, which
# `.dockerignore` excludes on purpose — documentation has no business in a
# build context. The generator opens the path and does not create the
# directory, so `db:generate` — a `dependsOn` of `build` — dies on ENOENT
# without this. The ERD it writes here is discarded with the stage; the
# committed one is generated on a developer machine, where the directory
# exists.
RUN mkdir -p /app/docs/reference/erd

# `...` builds this service AND the workspaces it depends on. Prune already
# narrowed the graph; the filter keeps the intent readable.
#
# This also runs `db:generate` first: `build` depends on it in `turbo.json`, so
# the Prisma client is produced here rather than as a side effect of `npm ci`.
# There is no `binaryTargets` in any schema and none is needed: generation
# happens HERE, on the same Alpine base the runtime stage uses, so the client
# is built for the platform it will run on. Adding
# `binaryTargets = ["linux-musl-openssl-3.0.x"]` would pin this image's
# platform into schemas that developers also generate from on glibc.
RUN npx turbo run build --filter="@synapsedesk/${SERVICE}..."

# **The BROADER of two type checks, and it is not redundant with the other.**
#
# This was once the only one: five of six services built with SWC at
# `typeCheck: false`, so a type error in `auth-service/src` shipped. They now
# set `typeCheck: true`, which means `turbo run build` above already rejected a
# type error in each service's `src/` — on the developer's machine too, not
# only here.
#
# What that pass does NOT cover is why this line stays. Each service's
# `tsconfig.build.json` carries `"exclude": [..., "test", "**/*spec.ts"]`, so
# the per-service check is blind to spec and harness files — and the measured
# case is exactly there: notification's `test/utils/bootstrap.ts` imported
# `@nestjs/testing` undeclared, and a full image run was what caught it. The
# root config includes `apps/*/test/**` and resolves `@synapsedesk/*` to SOURCE
# through `paths`, where the per-service pass resolves to the built `.d.ts`.
# Two corpora, two resolution modes; a green build is not a green typecheck.
#
# Over the pruned tree this checks the target service and the libs — the root
# include globs over absent workspaces match nothing.
#
# MOVE THIS TO CI when CI exists — it is a relocation, not a deletion, and the
# image build gets its minute back.
RUN npm run typecheck

# --------------------------------------------------------------- deps (runtime)
# A SECOND install rather than pruning the first. `npm prune --omit=dev` across
# workspaces leaves the symlink farm in a state that is hard to verify, and the
# thing being verified here is "does the runtime image contain a compiler" — a
# question worth a clean answer rather than a clever one.
FROM deps AS prod-deps
WORKDIR /app
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# --------------------------------------------------------------- runtime
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
# `node_modules/@synapsedesk/common` to `././libs/common`, so a runtime image
# that copied only `apps/` would carry a symlink pointing at nothing — and the
# failure is a module-not-found at boot, after the image has been pushed.
COPY --from=build /app/libs/common/package.json ./libs/common/
COPY --from=build /app/libs/common/dist ./libs/common/dist
COPY --from=build /app/libs/grpc-proto/package.json ./libs/grpc-proto/
# `dist/proto` carries the.proto FILES, not just the compiled types. gRPC's
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

# --------------------------------------------------------------- runtime-ocr
# ingestion-service only.
#
#     docker build -f docker/node-service.Dockerfile \
#       --target runtime-ocr \
#       --build-arg SERVICE=ingestion-service \
#       --build-arg GIT_SHA="$(git rev-parse HEAD)" \
#       --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
# -t synapsedesk/ingestion-service.
#
# **A second target rather than a bigger base.** Installing these in `runtime`
# would put a rasteriser and an OCR engine into api-gateway, auth-service,
# ticket-service, notification-service and storage-service, none of which will
# ever spawn them — the cost of one service's feature, paid by six images.
#
# **`apk`, not `apt-get`.** The base is `node:24-alpine`; the Debian spelling in
# the design would fail on the first line. The package names differ too:
# tesseract's language data is `tesseract-ocr-data-<code>`, and the code is
# tesseract's own — `chi_sim` with an underscore, the same string that goes to
# `-l`, not the Debian `chi-sim`. `TESSERACT_CODE_BY_LANGUAGE` in
# `@synapsedesk/common` is the mapping from the ISO 639-1 code the API speaks;
# these package names are packaging and stay here.
#
# **Language data is per package, and only English is installed.** The CJK sets
# are the large ones, and a demo that reads English scans should not carry
# Japanese and Chinese models to do it. Adding a language is one word here plus
# nothing else — the code already accepts all eight.
FROM busybox:1.37 AS ocr-args
ARG SERVICE
# `runtime-ocr` was "ingestion-service only" by convention; the heap bound
# below turned the convention into a correctness rule — a mis-targeted build
# now gets OCR binaries AND an ingestion-sized old-space cap, which is a
# misconfiguration rather than a fat image. Same shape as `build-args`, for
# the same reason: fail in seconds, before anything expensive.
RUN test "$SERVICE" = "ingestion-service" \
  || (echo "runtime-ocr is ingestion-service only — it carries OCR binaries and an ingestion-sized heap cap; SERVICE=$SERVICE would get both" \
      && false)

FROM runtime AS runtime-ocr

# Forces the `ocr-args` gate into this image's dependency graph — without a
# reference BuildKit prunes the stage and the guard never runs, exactly as the
# `build-args` tether above documents.
COPY --from=ocr-args /bin/true /tmp/.ocr-args-checked

# ingestion-service only (the gate above enforces it). `MAX_DOCUMENT_BYTES` is
# 100 MB and the worker runs at `concurrency: 2`, so two raw buffers plus
# parser overhead are resident at the peak. Buffers live OUTSIDE the V8 heap,
# so this flag does not bound them — it bounds the extracted text and the
# chunk arrays. The raw buffers are bounded only by the container's memory
# limit, which is set where the container is run (compose `mem_limit`, k8s
# `resources.limits.memory`), not here. The two numbers are chosen TOGETHER:
# 768 MB old-space inside a 1.5 GB container limit leaves headroom for the two
# 100 MB buffers and the runtime.
ENV NODE_OPTIONS=--max-old-space-size=768

# **Back to root to install, and back to `node` before the CMD.** The `runtime`
# stage ends on `USER node` deliberately; an image that installs packages and
# forgets to drop back is a non-root design undone by a convenience — and this
# is the one stage that runs C++ parsers over untrusted input, which is exactly
# where the uid matters most.
USER root

# `--no-cache` rather than `apk add` followed by `rm -rf /var/cache/apk`: it
# never writes the index in the first place, so there is no layer holding it.
#
# **One package per `OCR_LANGUAGES` entry, and the list must stay complete.**
# The DTO accepts eight ISO 639-1 codes and `TESSERACT_CODE_BY_LANGUAGE` maps
# each to the `-l` code below; the apk package is that code with a fixed prefix.
# Shipping only `eng` — which this stage did first — meant seven of the eight
# were accepted by the API and unservable by the image: tesseract exits 1 with
# `Error opening data file …/vie.traineddata`, the page is recorded as failed,
# and the resulting `PAGES_NOT_INDEXED` flag advises the tenant to "re-upload it
# specifying its language" — which is exactly what they had just done.
#
# `check-ocr-image.sh` asserts every one of these is present in the built image,
# so a language added to `OCR_LANGUAGES` without a package here fails the check
# rather than one tenant's document.
RUN apk add --no-cache \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-data-eng \
      tesseract-ocr-data-spa \
      tesseract-ocr-data-fra \
      tesseract-ocr-data-deu \
      tesseract-ocr-data-por \
      tesseract-ocr-data-vie \
      tesseract-ocr-data-jpn \
      tesseract-ocr-data-chi_sim

USER node

# --------------------------------------------------------------- default
# **This stage exists to restore the default target, and must stay last.**
#
# `docker build` with no `--target` builds the FINAL stage. Without this, that
# would be `runtime-ocr` — so every service built with the documented command
# above would carry a rasteriser and an OCR engine, silently undoing the one
# reason `runtime-ocr` is a separate target. The first build of it proved
# exactly that: `runtime` and `runtime-ocr` came out byte-identical, both with
# `/usr/bin/tesseract`.
#
# It adds no layer — a `FROM` with no instructions is an alias — and it is the
# cheapest way to make "the default is the small one" true rather than a
# property of where somebody appended a stage.
FROM runtime AS default
