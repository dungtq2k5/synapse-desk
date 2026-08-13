#!/usr/bin/env bash
# The two checks 34-doc §7 asks for, as something that runs.
#
# Nothing in this repo builds these images — no compose service, no pipeline —
# so these cannot be jest tests today. Written as a script rather than as a
# table in a document because a check with no runner is a check nobody
# executes: this one can be run by hand now and called from CI the day there is
# one, without being rewritten.
#
#     ./docker/check-ocr-image.sh
#
# It builds both targets, so it is minutes rather than seconds. Run it when the
# Dockerfile changes, not on every commit.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PLAIN=synapsedesk/ocr-check:default
OCR=synapsedesk/ocr-check:runtime-ocr

build() {
  docker build -f docker/node-service.Dockerfile \
    ${2:+--target "$2"} \
    --build-arg SERVICE=ingestion-service \
    --build-arg GIT_SHA="$(git rev-parse HEAD)" \
    --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t "$1" . >/dev/null
}

fail() { echo "  FAIL: $1" >&2; exit 1; }

echo "Building both targets…"
# **No `--target` on the first one, deliberately.** That is how every other
# service is built, and the check is only meaningful if it exercises the same
# command. The first version of this stage put `runtime-ocr` last in the file,
# which made it the default — both images came out identical, with tesseract in
# each, and the entire point of a second target was silently lost.
build "$PLAIN"
build "$OCR" runtime-ocr

echo "1. the cost boundary — the default target carries no OCR"
for binary in tesseract pdftoppm; do
  if docker run --rm --entrypoint sh "$PLAIN" -c "command -v $binary" >/dev/null 2>&1; then
    fail "$binary is in the DEFAULT image; every service would carry it"
  fi
  docker run --rm --entrypoint sh "$OCR" -c "command -v $binary" >/dev/null 2>&1 \
    || fail "$binary is missing from runtime-ocr"
done
echo "   ok — absent from the default image, present in runtime-ocr"

echo "2. the USER round trip — installed as root, runs as node"
who=$(docker run --rm --entrypoint sh "$OCR" -c 'id -un')
[ "$who" = "node" ] || fail "runtime-ocr runs as '$who', not node"

# Executable BY that user, which is the half a `command -v` as root would miss.
docker run --rm --entrypoint sh "$OCR" -c 'tesseract --version >/dev/null 2>&1' \
  || fail "tesseract is not executable by node"
docker run --rm --entrypoint sh "$OCR" -c 'pdftoppm -v >/dev/null 2>&1' \
  || fail "pdftoppm is not executable by node"
echo "   ok — runs as node, and both binaries execute as that user"

echo "3. Every language the API accepts has data in the image"
# **Derived from `TESSERACT_CODE_BY_LANGUAGE`, not restated here.** This check
# used to assert `eng` alone, which is how the image came to ship one language
# while the DTO accepted eight: the check encoded the same assumption as the
# Dockerfile, so it agreed with the bug. Reading the mapping means a ninth
# language added to the API fails this until its package is added too.
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
    || fail "tesseract has no '$code' data — the API accepts the language that maps to it, so a document declaring it fails with 'Error opening data file'"
done
echo "   ok — $(echo "$LANGS" | tr '\n' ' ')"

printf '\nsizes:\n'
docker images synapsedesk/ocr-check --format '  {{.Tag}}: {{.Size}}'

docker rmi "$PLAIN" "$OCR" >/dev/null 2>&1 || true
echo
echo "All checks passed."
