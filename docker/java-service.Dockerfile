# The Java gateway's image.
#
# **Its own Dockerfile, not a matrix row on `node-service.Dockerfile`** — the
# same reason rag-service has one: the stages genuinely differ. A Maven build
# and a JRE runtime share nothing with a node build but the registry.
#
# **It reads four things from OUTSIDE the module**, and that is deliberate:
# the OpenAPI document, the protos, the GraphQL schema and the generated
# contracts are the files the Node gateway is built from too. So the build
# context is the REPOSITORY ROOT, not `apps/api-gateway-java`.

# Pinned to a full version for the reason `image-contract.spec.ts` states: a
# floating tag makes the image a function of the pull date. Both are read by
# that guard, which requires an `x.y.z`.
ARG MAVEN_VERSION=3.9.11-eclipse-temurin-21-alpine
ARG JRE_VERSION=21.0.5_11-jre-alpine

# ----------------------------------------------------------------- build
FROM maven:${MAVEN_VERSION} AS build
WORKDIR /build

# **The manifest first, and its dependencies resolved alone.** Layer caching:
# `pom.xml` changes rarely and the dependency download is the slow half, so a
# source-only change must not re-pay it.
COPY apps/api-gateway-java/pom.xml apps/api-gateway-java/pom.xml
COPY apps/api-gateway-java/.mvn apps/api-gateway-java/.mvn
COPY apps/api-gateway-java/mvnw apps/api-gateway-java/mvnw
RUN cd apps/api-gateway-java && mvn -q -B dependency:go-offline -DskipTests

# The four codegen inputs, then the sources. Each is a file this module reads
# from another workspace — see the note at the top.
COPY docs/reference/openapi.json docs/reference/openapi.json
COPY libs/grpc-proto/src/proto libs/grpc-proto/src/proto
COPY apps/api-gateway/src/schema.gql apps/api-gateway/src/schema.gql
COPY apps/api-gateway-java/src apps/api-gateway-java/src

# `-DskipTests`: the tests are `./mvnw verify`'s job, and CI has already run
# them. An image build that re-ran them would fail here for reasons that have
# nothing to do with the image — a missing Redis, most obviously.
RUN cd apps/api-gateway-java && mvn -q -B package -DskipTests

# --------------------------------------------------------------- runtime
FROM eclipse-temurin:${JRE_VERSION} AS runtime

# **Which build is this?** Baked, never read from git at runtime: a container
# has no `.git`, so a runtime lookup returns nothing and the natural fallback
# is "unknown" — the answer you get exactly when you need the real one.
ARG GIT_SHA
ARG BUILD_TIME
RUN test -n "$GIT_SHA" || (echo "GIT_SHA is required" >&2 && exit 1)
RUN test -n "$BUILD_TIME" || (echo "BUILD_TIME is required" >&2 && exit 1)
ENV BUILD_SHA=${GIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

# Not root. The JVM needs no privileged port here — the gateway listens on
# `PORT`, which is above 1024 in every environment this ships to.
RUN addgroup -S gateway && adduser -S -G gateway gateway
USER gateway

WORKDIR /app
COPY --from=build --chown=gateway:gateway \
  /build/apps/api-gateway-java/target/*.jar /app/gateway.jar

# The jar is renamed on copy so this line carries no version — the version
# lives in `pom.xml`, and repeating it here is a second place to change it.
ENTRYPOINT ["java", "-jar", "/app/gateway.jar"]
