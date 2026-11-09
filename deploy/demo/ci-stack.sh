#!/usr/bin/env bash
# The whole stack, built from this checkout and started: every image the demo
# (and a deploy) runs, every migrate one-shot exiting 0, every long-running
# service healthy, one request each to the web and the gateway through the
# stack's own network, then `check-images.sh`'s daemon checks. CI's `stack`
# job runs exactly this.
#
#     ./deploy/demo/ci-stack.sh
#
# **Never the live demo's project.** The demo runs from compose.yaml as
# `synapsedesk-demo`; this always passes its own project name and tags its
# images `ci-<sha>`, so it can't start into the demo or retag its images, and
# its `down -v` removes only its own volumes. Its env files and secrets are
# placeholders and synthetic credentials in a temporary project directory
# (`scripts/write-ci-demo-env.mjs`), never `deploy/demo/env/`.
#
# No real provider and no cloudflared: compose.ci.yaml adds the Firebase
# emulator, and Stripe, Resend and Gemini get keys that reach nothing.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PROJECT=synapsedesk-ci
BOUND=300 # seconds for every service to be healthy
export DEMO_SOURCE="$PWD"
export DEMO_SHA="ci-$(git rev-parse --short=8 HEAD)"
export DEMO_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# The examples' database URLs carry these.
export DB_USER=postgres DB_PASSWORD=password123456789

dir=$(mktemp -d)
# compose.yaml mounts `./healthcheck` relative to the project directory.
ln -s "$PWD/deploy/demo/healthcheck" "$dir/healthcheck"

compose() {
  docker compose -p "$PROJECT" --project-directory "$dir" \
    -f deploy/demo/compose.yaml -f deploy/demo/compose.ci.yaml "$@"
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$dir"
  # A local run leaves no images behind; a runner is thrown away anyway.
  if [[ -z "${CI:-}" ]]; then
    docker images --format '{{.Repository}}:{{.Tag}}' |
      grep ":$DEMO_SHA\$" | xargs -r docker rmi >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() { echo "  FAIL: $1" >&2; exit 1; }

node scripts/write-ci-demo-env.mjs "$dir"

echo "1. every image the stack runs builds"
start=$SECONDS
compose build || fail "an image did not build (the service is named above)"
echo "   ok — built in $((SECONDS - start))s"

echo "2. every migrate exits 0 and every service is healthy within ${BOUND}s"
services=$(compose config --services | grep -vx cloudflared)
start=$SECONDS
# shellcheck disable=SC2086 # one service name per word
if ! compose up -d --wait --wait-timeout "$BOUND" $services; then
  compose ps -a --format '{{.Service}}\t{{.Status}}' >&2
  for service in $services; do
    status=$(compose ps -a --format '{{.Status}}' "$service")
    case "$status" in
      *'(healthy)'* | 'Exited (0)'*) ;;
      *)
        echo "--- $service: $status" >&2
        compose logs --no-color --tail 40 "$service" >&2
        ;;
    esac
  done
  fail "the stack did not start healthy (the services above)"
fi
echo "   ok — healthy in $((SECONDS - start))s"

echo "3. the web's /login and the gateway's /health/ready, from inside the network"
compose exec -T web node -e "
  const get = (url) => fetch(url).then(async (r) => [r.status, await r.text()]);
  Promise.all([get('http://web:5173/login'), get('http://api-gateway:3000/health/ready')])
    .then(([[login], [ready, body]]) => {
      console.log('   /login', login, '· /health/ready', ready, body.slice(0, 80));
      process.exit(login === 200 && ready === 200 ? 0 : 1);
    }, (error) => { console.error(error); process.exit(1); });
" || fail "the smoke requests did not both answer 200"

echo "4. the gRPC health check refuses a port that isn't one"
for port in '' 5001x; do
  if output=$(compose exec -T -e GRPC_PORT="$port" auth-service \
      sh -c 'NODE_PATH=/app/node_modules node /healthcheck/grpc-health.cjs' 2>&1); then
    fail "grpc-health.cjs accepted GRPC_PORT='$port'"
  fi
  grep -q 'GRPC_PORT must be a port' <<<"$output" \
    || fail "grpc-health.cjs failed on GRPC_PORT='$port' for another reason: $output"
done
echo "   ok — unset and 5001x both exit 1"

compose down -v --remove-orphans >/dev/null

echo "5. the image checks that need a daemon"
./docker/check-images.sh

echo
echo "The stack builds and starts healthy."
