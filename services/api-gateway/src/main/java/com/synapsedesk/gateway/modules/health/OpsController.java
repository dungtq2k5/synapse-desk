package com.synapsedesk.gateway.modules.health;

import com.synapsedesk.gateway.common.config.RuntimeProperties;
import com.synapsedesk.gateway.common.lifecycle.OrgAccess;
import com.synapsedesk.gateway.common.lifecycle.OrgAccessKind;
import com.synapsedesk.gateway.common.openapi.RouteSecurity;
import com.synapsedesk.gateway.common.web.ApiResponse;
import com.synapsedesk.gateway.modules.health.dto.rest.LivenessResponseDto;
import com.synapsedesk.gateway.modules.health.dto.rest.ReadinessDependenciesResponseDto;
import com.synapsedesk.gateway.modules.health.dto.rest.ReadinessResponseDto;
import com.synapsedesk.gateway.modules.health.dto.rest.VersionResponseDto;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The three routes an orchestrator reads, OUTSIDE the API prefix.
 *
 * <p><b>Migrated off `OpsApi`.</b> `@RequestMapping` used to arrive through
 * the generated interface; it is declared directly on each method now.
 *
 * <p>Outside the prefix because an orchestrator is not an API client and
 * cannot follow a version migration: a probe configured for
 * `/api/v1/health` breaks the day the version moves, and it breaks by
 * restarting healthy pods.
 *
 * <p><b>Liveness and readiness answer different questions.</b> `/health` says
 * "is this process alive", and answers 200 while draining and while standing
 * by — a liveness probe that failed then would restart a pod that is working.
 * `/health/ready` says "should traffic reach THIS instance", and is the one
 * that goes 503.
 *
 * <p><b>No `@ResponseStatus` on readiness, deliberately.</b> Its status is a
 * RUNTIME decision (200 or 503 depending on `ready`), not a fixed one a
 * single annotation could state — springdoc documents it as 200, the same
 * as the committed document already did; 503 was never a declared success
 * response there either.
 */
@Tag(name = "Ops")
@RestController
// Public: no session is authenticated here, so the lifecycle gate never runs either.
@OrgAccessKind(OrgAccess.AUTH)
@Validated
public class OpsController {

  /** The envelope's `statusCode`, repeated in the body because clients read it there. */
  private static final int OK = 200;

  private static final int UNAVAILABLE = 503;

  private final RuntimeProperties runtime;
  private final DrainState drain;
  private final List<ReadinessGate> gates;

  public OpsController(
    RuntimeProperties runtime,
    DrainState drain,
    List<ReadinessGate> gates
  ) {
    this.runtime = runtime;
    this.drain = drain;
    this.gates = gates;
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @GetMapping(value = "/health", produces = { "application/json" })
  public ResponseEntity<
    ApiResponse<LivenessResponseDto>
  > healthControllerLiveness() {
    LivenessResponseDto data = new LivenessResponseDto()
      .status("ok")
      .timestamp(OffsetDateTime.now(ZoneOffset.UTC));

    return ResponseEntity.ok(ApiResponse.of(OK, "Healthy", data));
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @GetMapping(value = "/health/ready", produces = { "application/json" })
  public ResponseEntity<
    ApiResponse<ReadinessResponseDto>
  > healthControllerReadiness() {
    boolean draining = drain.isDraining();
    ReadinessDependenciesResponseDto dependencies =
      new ReadinessDependenciesResponseDto();
    boolean gatesReady = true;

    for (ReadinessGate gate : gates) {
      boolean ready = gate.isReady();
      gatesReady &= ready;
      gate.report(dependencies, ready);
    }

    boolean ready = !draining && gatesReady;
    ReadinessResponseDto data = new ReadinessResponseDto()
      .ready(ready)
      .draining(draining)
      .dependencies(dependencies)
      .timestamp(OffsetDateTime.now(ZoneOffset.UTC));

    ApiResponse<ReadinessResponseDto> body = ApiResponse.of(
      ready ? OK : UNAVAILABLE,
      ready ? "Ready" : "Not ready",
      data
    );

    // A probe reads the STATUS LINE; the body is for a human reading a log.
    return ready
      ? ResponseEntity.ok(body)
      : ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
  }

  @RouteSecurity(RouteSecurity.Scheme.NONE)
  @GetMapping(value = "/version", produces = { "application/json" })
  public ResponseEntity<
    ApiResponse<VersionResponseDto>
  > versionControllerVersion() {
    VersionResponseDto data = new VersionResponseDto()
      .version(runtime.appVersion())
      .sha(runtime.buildSha())
      .builtAt(runtime.buildTime());

    return ResponseEntity.ok(ApiResponse.of(OK, "Version", data));
  }
}
