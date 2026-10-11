#!/usr/bin/env bash
# The gateway image builds, starts, and answers `/health`. Nothing is pushed.
#
#     ./docker/boot-gateway.sh
#
# Every other gateway check runs the code from a checkout, the jar under
# `target/`. The image is the thing that ships, and until this ran per PR
# an image that could not start was first found by a deploy.
#
# Needs compose's `redis` and `nats` up. Each container joins the compose
# network with the contract harness's own `gateway.env`, so it boots with the
# configuration the contract rows already prove, except for three things: the
# stores are reached by their compose names, the key paths move to where the
# fixtures are mounted, and NODE_ENV is production, as every deployment sets it.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

GIT_SHA="$(git rev-parse HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NAME=gateway-boot-check

# `gateway.env` writes `KEY = value`; `--env-file` wants `KEY=value`.
env_file=$(mktemp)
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -f "$env_file"' EXIT
grep -v '^[[:space:]]*#' test/gateway-contract/gateway.env | grep '=' |
  sed 's/[[:space:]]*=[[:space:]]*/=/' > "$env_file"
port=$(sed -n 's/^PORT=//p' "$env_file")

fail() { echo "  FAIL: $1" >&2; exit 1; }

boot() { # image
  echo "   starting $1…"
  docker run -d --name "$NAME" --network synapsedesk-network \
    -p "127.0.0.1:$port:$port" --env-file "$env_file" \
    -e REDIS_URL=redis://redis:6379/15 -e NATS_URL=nats://nats:4222 \
    -v "$PWD/test/fixtures/keys:/keys:ro" \
    -e JWT_ACCESS_PUBLIC_KEY_PATH=/keys/jwt-access.test.pub \
    -e JWT_2FA_PUBLIC_KEY_PATH=/keys/jwt-2fa.test.pub \
    -e NODE_ENV=production \
    "$1" >/dev/null

  for _ in $(seq 90); do
    if curl -fs -o /dev/null "http://localhost:$port/health"; then
      echo "   ok — $1 answered /health"
      docker rm -f "$NAME" >/dev/null
      return
    fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]]; then
      docker logs "$NAME" >&2
      fail "$1 exited before answering /health"
    fi
    sleep 2
  done
  docker logs "$NAME" >&2
  fail "$1 did not answer /health within 180s"
}

echo "building api-gateway…"
docker build -f docker/java-service.Dockerfile \
  --build-arg GIT_SHA="$GIT_SHA" --build-arg BUILD_TIME="$BUILD_TIME" \
  -t synapsedesk/api-gateway:boot-check . >/dev/null

boot synapsedesk/api-gateway:boot-check

echo "The gateway image boots."
