# syntax=docker/dockerfile:1.7

# `rag-service` — the one Python peer.
#
# Its own file rather than a branch in `node-service.Dockerfile`: the stages
# genuinely differ (pip, not npm; no compile step) and a Dockerfile with an
# `if` in it is a Dockerfile nobody can read.
#
#     docker build -f docker/rag-service.Dockerfile \
#       --build-arg GIT_SHA="$(git rev-parse HEAD)" \
#       --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
#       -t synapsedesk/rag-service .

ARG PYTHON_VERSION=3.12-slim

# ============================================================ build-args gate
#
# First stage and dependency-free, so a missing arg fails in seconds rather than
# after pip has resolved the whole dependency tree.
FROM busybox:1.37 AS build-args
ARG GIT_SHA
ARG BUILD_TIME
RUN test -n "$GIT_SHA" \
  || (echo 'GIT_SHA build arg is required — an image that cannot identify itself must not ship' \
      && false)
RUN test -n "$BUILD_TIME" || (echo 'BUILD_TIME build arg is required' && false)

# ==================================================================== deps
FROM python:${PYTHON_VERSION} AS deps
WORKDIR /app

# Requirements before source, for the same layer-caching reason as the Node
# image: a change to a servicer must not re-resolve torch.
COPY apps/rag-service/requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --prefix=/install -r requirements.txt

# ================================================================== runtime
FROM python:${PYTHON_VERSION} AS runtime
WORKDIR /app

ARG GIT_SHA
ARG BUILD_TIME
ARG APP_VERSION=1.0.0

# Forces the gate into this image's graph — BuildKit prunes an unreferenced
# stage, and a pruned guard is a guard that never runs. It matters here for the
# same reason as the Node image: a rolling deploy where one service lagged is
# precisely the state `/version` diagnoses, and a peer that answers "unknown" is
# the peer you cannot rule out.
COPY --from=build-args /bin/true /tmp/.build-args-checked

ENV BUILD_SHA=$GIT_SHA \
    BUILD_TIME=$BUILD_TIME \
    APP_VERSION=$APP_VERSION \
    PYTHONUNBUFFERED=1 \
    # No .pyc files: the image is read-only in practice and writing them only
    # dirties the layer at runtime.
    PYTHONDONTWRITEBYTECODE=1

COPY --from=deps /install /usr/local
COPY apps/rag-service/rag_service ./rag_service

# Non-root, created here because the Python base image has no unprivileged user
# of its own — unlike `node`.
RUN useradd --system --create-home --uid 10001 rag
USER rag

# `python -m` rather than a script, so the process is PID 1 and receives
# SIGTERM directly — grpc.aio's graceful stop depends on seeing it.
CMD ["python", "-m", "rag_service.server"]
