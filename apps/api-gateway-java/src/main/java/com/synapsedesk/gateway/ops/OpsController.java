package com.synapsedesk.gateway.ops;

import com.synapsedesk.gateway.config.RuntimeProperties;
import com.synapsedesk.gateway.generated.api.OpsApi;
import com.synapsedesk.gateway.generated.model.HealthControllerLiveness200Response;
import com.synapsedesk.gateway.generated.model.HealthControllerReadiness200Response;
import com.synapsedesk.gateway.generated.model.LivenessResponseDto;
import com.synapsedesk.gateway.generated.model.ReadinessDependenciesResponseDto;
import com.synapsedesk.gateway.generated.model.ReadinessResponseDto;
import com.synapsedesk.gateway.generated.model.VersionControllerVersion200Response;
import com.synapsedesk.gateway.generated.model.VersionResponseDto;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

/**
 * The three routes an orchestrator reads, OUTSIDE the API prefix.
 *
 * <p><b>It implements the GENERATED interface</b>, so the routes, the request
 * shapes and the response types come from the document both gateways share
 * rather than from this file. That is what makes the drift guarantee real: a
 * path added to the `ops` tag becomes an abstract method here, and the build
 * fails until it is answered — measured as J3, and only true because
 * `skipDefaultInterface` is set.
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
 */
@RestController
public class OpsController implements OpsApi {

  /** The envelope's `statusCode`, repeated in the body because clients read it there. */
  private static final BigDecimal OK = BigDecimal.valueOf(200);

  private static final BigDecimal UNAVAILABLE = BigDecimal.valueOf(503);

  private final RuntimeProperties runtime;
  private final DrainState drain;
  private final List<ReadinessGate> gates;

  public OpsController(RuntimeProperties runtime, DrainState drain, List<ReadinessGate> gates) {
    this.runtime = runtime;
    this.drain = drain;
    this.gates = gates;
  }

  @Override
  public ResponseEntity<HealthControllerLiveness200Response> healthControllerLiveness() {
    LivenessResponseDto data =
        new LivenessResponseDto().status("ok").timestamp(OffsetDateTime.now());

    return ResponseEntity.ok(
        new HealthControllerLiveness200Response()
            .success(true)
            .statusCode(OK)
            .message("Healthy")
            .data(data));
  }

  @Override
  public ResponseEntity<HealthControllerReadiness200Response> healthControllerReadiness() {
    boolean draining = drain.isDraining();
    ReadinessDependenciesResponseDto dependencies = new ReadinessDependenciesResponseDto();
    boolean gatesReady = true;

    for (ReadinessGate gate : gates) {
      boolean ready = gate.isReady();
      gatesReady &= ready;
      gate.report(dependencies, ready);
    }

    boolean ready = !draining && gatesReady;
    ReadinessResponseDto data =
        new ReadinessResponseDto()
            .ready(ready)
            .draining(draining)
            .dependencies(dependencies)
            .timestamp(OffsetDateTime.now());

    HealthControllerReadiness200Response body =
        new HealthControllerReadiness200Response()
            .success(true)
            .statusCode(ready ? OK : UNAVAILABLE)
            .message(ready ? "Ready" : "Not ready")
            .data(data);

    // A probe reads the STATUS LINE; the body is for a human reading a log.
    return ready
        ? ResponseEntity.ok(body)
        : ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(body);
  }

  @Override
  public ResponseEntity<VersionControllerVersion200Response> versionControllerVersion() {
    VersionResponseDto data =
        new VersionResponseDto()
            .version(runtime.appVersion())
            .sha(runtime.buildSha())
            .builtAt(runtime.buildTime());

    return ResponseEntity.ok(
        new VersionControllerVersion200Response()
            .success(true)
            .statusCode(OK)
            .message("Version")
            .data(data));
  }
}
