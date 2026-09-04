#!/usr/bin/env bash
# The image checks that NEED a daemon, as something that runs.
#
# The static half — phantom imports, version-pin agreement, floating tags —
# lives in `libs/common/src/configs/image-contract.spec.ts` and runs on every
# `npm run test`, precisely because this script's predecessor is the measured
# argument against scripts: `check-ocr-image.sh` was correct and unrun for
# three weeks while the build it depended on was broken, its leftover images
# reading like current state. What stays here is only what a file parse cannot
# decide: that the images build, that the runtime trees resolve, that the
# stage guards actually fire.
#
#     ./docker/check-images.sh            # everything: ~all seven builds
#     ./docker/check-images.sh --ocr-only # just the OCR section
#
# Minutes, not seconds — run it when the Dockerfiles change, and from CI the
# day there is one.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

NODE_SERVICES=(api-gateway auth-service ticket-service ingestion-service notification-service storage-service)
GIT_SHA="$(git rev-parse HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PLAIN=synapsedesk/ocr-check:default
OCR=synapsedesk/ocr-check:runtime-ocr

# A failing run must clean up too: `docker rmi` at the tail only ran on
# success, which is why 2026-08-13's wreckage sat on this machine for three
# weeks reading like current state. Only the throwaway ocr-check pair is
# removed — the service images are the artifacts this script exists to
# produce.
trap 'docker rmi "$PLAIN" "$OCR" >/dev/null 2>&1 || true' EXIT

fail() { echo "  FAIL: $1" >&2; exit 1; }

build_node() { # tag, service, [target]
  docker build -f docker/node-service.Dockerfile \
    ${3:+--target "$3"} \
    --build-arg SERVICE="$2" \
    --build-arg GIT_SHA="$GIT_SHA" \
    --build-arg BUILD_TIME="$BUILD_TIME" \
    -t "$1" . >/dev/null
}

# ---------------------------------------------------------------- OCR section

# Unchanged in substance from `check-ocr-image.sh`, which now delegates here.
ocr_checks() {
  echo "Building both OCR-comparison targets…"
  # **No `--target` on the first one, deliberately.** That is how every other
  # service is built, and the check is only meaningful if it exercises the
  # same command. The first version of the stage put `runtime-ocr` last in
  # the file, which made it the default — both images came out identical,
  # with tesseract in each, and the entire point of a second target was
  # silently lost.
  build_node "$PLAIN" ingestion-service
  build_node "$OCR" ingestion-service runtime-ocr

  echo "ocr-1. the cost boundary — the default target carries no OCR"
  for binary in tesseract pdftoppm; do
    if docker run --rm --entrypoint sh "$PLAIN" -c "command -v $binary" >/dev/null 2>&1; then
      fail "$binary is in the DEFAULT image; every service would carry it"
    fi
    docker run --rm --entrypoint sh "$OCR" -c "command -v $binary" >/dev/null 2>&1 \
      || fail "$binary is missing from runtime-ocr"
  done
  echo "   ok — absent from the default image, present in runtime-ocr"

  echo "ocr-2. the USER round trip — installed as root, runs as node"
  who=$(docker run --rm --entrypoint sh "$OCR" -c 'id -un')
  [ "$who" = "node" ] || fail "runtime-ocr runs as '$who', not node"

  # Executable BY that user, which is the half a `command -v` as root misses.
  docker run --rm --entrypoint sh "$OCR" -c 'tesseract --version >/dev/null 2>&1' \
    || fail "tesseract is not executable by node"
  docker run --rm --entrypoint sh "$OCR" -c 'pdftoppm -v >/dev/null 2>&1' \
    || fail "pdftoppm is not executable by node"
  echo "   ok — runs as node, and both binaries execute as that user"

  echo "ocr-3. every language the API accepts has data in the image"
  # **Derived from `TESSERACT_CODE_BY_LANGUAGE`, not restated here.** This
  # check used to assert `eng` alone, which is how the image came to ship one
  # language while the DTO accepted eight: the check encoded the same
  # assumption as the Dockerfile, so it agreed with the bug.
  LANGS=$(
    sed -n '/^export const TESSERACT_CODE_BY_LANGUAGE/,/^};/p' \
      libs/common/src/configs/document.config.ts |
      grep -oE ":[[:space:]]*'[a-z_]+'" |
      grep -oE "[a-z_]+'" | tr -d "'"
  )
  [ -n "$LANGS" ] || fail "could not read TESSERACT_CODE_BY_LANGUAGE — has the mapping moved?"

  INSTALLED=$(docker run --rm --entrypoint sh "$OCR" -c 'tesseract --list-langs 2>&1')
  for code in $LANGS; do
    echo "$INSTALLED" | grep -qx "$code" \
      || fail "tesseract has no '$code' data — a document declaring that language fails with 'Error opening data file'"
  done
  echo "   ok — $(echo "$LANGS" | tr '\n' ' ')"
}

if [ "${1:-}" = "--ocr-only" ]; then
  ocr_checks
  echo
  echo "OCR checks passed."
  exit 0
fi

# ---------------------------------------------------------------- 1. every image builds

# ingestion-service builds its REAL target (`runtime-ocr`); the others build
# the default. rag has its own file.
echo "1. every service image builds"
for service in "${NODE_SERVICES[@]}"; do
  target=""
  [ "$service" = "ingestion-service" ] && target="runtime-ocr"
  echo "   building $service${target:+ ($target)}…"
  build_node "synapsedesk/$service" "$service" "$target" \
    || fail "$service did not build"
done
echo "   building rag-service…"
docker build -f docker/rag-service.Dockerfile \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  -t synapsedesk/rag-service . >/dev/null || fail "rag-service did not build"
echo "   ok — all seven built"

# --------------------------------------------------------------- 3. the runtime tree actually resolves
#
# The centrepiece, and building alone would not find what it finds: a
# type-only phantom fails the build, but a VALUE phantom in a service compiled
# by SWC ships and dies at `docker run` — measured, `import 'dotenv/config'`
# on line 2 of storage-service's `main.js` would have been the first line the
# container ever failed on.
#
# The composition with the static spec is what makes this complete:
# `image-contract.spec.ts` proves src-imports ⊆ declared; this proves
# declared ⊆ installed-and-resolvable *from the service directory of the
# pruned runtime image*. Together: everything imported resolves.
# `import.meta.resolve`, not `require.resolve` — ESM-only packages
# (pdfjs-dist) have no require export and would false-fail.
echo "3. every declared dependency resolves inside the runtime image"
for service in "${NODE_SERVICES[@]}"; do
  docker run --rm -w "/app/apps/$service" --entrypoint node \
    "synapsedesk/$service" \
    --input-type=module -e '
      import { readFileSync } from "node:fs";
      const own = JSON.parse(readFileSync("package.json", "utf8"));
      const libs = ["common", "grpc-proto"].map((lib) =>
        JSON.parse(readFileSync(`/app/libs/${lib}/package.json`, "utf8")));
      const deps = new Set([own, ...libs].flatMap((m) => Object.keys(m.dependencies ?? {})));
      let failed = 0;
      for (const dep of deps) {
        try { import.meta.resolve(dep); }
        catch { console.error(`  cannot resolve ${dep}`); failed = 1; }
      }
      process.exit(failed);
    ' || fail "$service: a declared dependency does not resolve in the runtime image"
  echo "   ok — $service"
done

# --------------------------------------------------------------- 6. the heap bound and the stage guard both hold

echo "6. runtime-ocr carries the heap bound; runtime does not; the guard fires"
env_of() { docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1"; }

env_of synapsedesk/ingestion-service | grep -q '^NODE_OPTIONS=.*max-old-space' \
  || fail "runtime-ocr (ingestion) is missing the NODE_OPTIONS heap bound"
if env_of synapsedesk/auth-service | grep -q '^NODE_OPTIONS='; then
  fail "plain runtime carries NODE_OPTIONS — an ingestion-shaped cap on a service that parses nothing"
fi

# The NEGATIVE build: runtime-ocr must refuse any other SERVICE. Cached
# layers make this fail in seconds, in the ocr-args stage.
if docker build -f docker/node-service.Dockerfile --target runtime-ocr \
    --build-arg SERVICE=api-gateway \
    --build-arg GIT_SHA="$GIT_SHA" \
    --build-arg BUILD_TIME="$BUILD_TIME" \
    -t synapsedesk/ocr-guard-probe . >/dev/null 2>&1; then
  docker rmi synapsedesk/ocr-guard-probe >/dev/null 2>&1 || true
  fail "runtime-ocr accepted SERVICE=api-gateway — the ocr-args guard is not wired"
fi
echo "   ok — bound present, absent, and guard refused a gateway build"

# --------------------------------------------------------------- 7. the build-args gate held

# `SERVICE_NAME`/`BUILD_SHA`/`BUILD_TIME` non-empty in every image. This is
# what tethers the `COPY --from=build-args /bin/true` line: that copy is
# load-bearing and looks like debris, and a guard whose only tether is one
# puzzling COPY is a guard one tidy-up away from silence.
echo "7. every image identifies itself"
for service in "${NODE_SERVICES[@]}"; do
  for var in SERVICE_NAME BUILD_SHA BUILD_TIME; do
    env_of "synapsedesk/$service" | grep -q "^$var=.." \
      || fail "$service: $var is empty or missing"
  done
done
for var in BUILD_SHA BUILD_TIME; do
  env_of synapsedesk/rag-service | grep -q "^$var=.." \
    || fail "rag-service: $var is empty or missing"
done
echo "   ok — all seven"

# --------------------------------------------------- 7a. the migrate target
#
# The init container ADR 0043 chose. Three properties, none of which a file
# parse can decide:
#
#   - it BUILDS for a service that owns a schema;
#   - it REFUSES one that does not, which is what keeps the manifest's
#     "init container exactly where a schema is" true on the image side too;
#   - it carries the Prisma CLI, which `runtime` cannot — that is the whole
#     reason the stage is `FROM build`.
echo "7a. the migrate target builds where a schema is and refuses where it is not"

docker build -f docker/node-service.Dockerfile --target migrate \
  --build-arg SERVICE=auth-service \
  --build-arg GIT_SHA="$GIT_SHA" --build-arg BUILD_TIME="$BUILD_TIME" \
  -t synapsedesk/auth-service-migrate . >/dev/null \
  || fail "migrate target failed to build for auth-service"

docker run --rm --entrypoint sh synapsedesk/auth-service-migrate \
  -c 'test -f prisma/schema.prisma && npx prisma --version >/dev/null' \
  || fail "migrate image lacks the schema or the Prisma CLI"

# api-gateway owns no schema. The stage must refuse it rather than produce an
# image whose init container would hang the pod at Init:Error forever.
if docker build -f docker/node-service.Dockerfile --target migrate \
     --build-arg SERVICE=api-gateway \
     --build-arg GIT_SHA="$GIT_SHA" --build-arg BUILD_TIME="$BUILD_TIME" \
     -t synapsedesk/gateway-migrate-should-not-exist . >/dev/null 2>&1; then
  fail "migrate target built for api-gateway, which owns no prisma/schema.prisma"
fi
echo "   ok — built for auth-service, refused api-gateway"

# --------------------------------------------------------------- 8. OCR section

ocr_checks

printf '\nsizes:\n'
docker images 'synapsedesk/*' --format '  {{.Repository}}:{{.Tag}}: {{.Size}}' | grep -v ocr-check

echo
echo "All checks passed."
