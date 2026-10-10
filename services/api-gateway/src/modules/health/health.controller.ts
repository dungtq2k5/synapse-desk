import {
  Controller,
  Get,
  HttpStatus,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  ServiceRegistry,
  type ServiceHealth,
} from './service-registry.service';
import type { Response } from 'express';
import { RedisHealthService } from './redis-health.service';
import { DrainState } from './drain-state.service';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
} from './dto/rest/health-response.dto';

/**
 * Liveness and readiness probes (api-endpoints-plan §6). Both PUBLIC — an
 * orchestrator has no credentials, and a probe behind auth cannot restart a
 * process whose auth is broken.
 */
@ApiTags('Ops')
// Neutral as well as excluded from the prefix: without it, URI versioning
// serves the probes at `/v1/health` and every pod fails readiness.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly serviceRegistry: ServiceRegistry,
    private readonly redis: RedisHealthService,
    private readonly drain: DrainState,
  ) {}

  /**
   * Liveness: is this process alive?
   *
   * Deliberately checks NOTHING external — not a peer, not Redis, not even the
   * config. A liveness probe that fails when a dependency is down gets the
   * container killed and restarted, which fixes none of it and removes an
   * instance that could still have served cached or degraded traffic. The only
   * failure a restart repairs is a wedged process, and that is what an
   * unanswered request already signals.
   */
  @ApiOperation({
    summary: 'Liveness — is this process alive?',
    description:
      'Checks NOTHING external, deliberately. A liveness probe that failed on a ' +
      'dependency outage would get every container restarted, which repairs none ' +
      'of it. Served outside the `/api/v1` prefix: an orchestrator is not an API ' +
      'client and cannot follow a version migration.',
    // PUBLIC, and it must be: an orchestrator holds no credentials, and a probe
    // behind auth cannot restart a process whose auth is broken.
    security: [],
  })
  @ApiWrappedResponse(LivenessResponseDto)
  @ApiFilterErrors()
  @Get()
  liveness(): LivenessResponseDto {
    return { status: 'UP', timestamp: new Date() };
  }

  /**
   * Readiness: should this instance receive traffic?
   *
   * **Peer health does NOT gate this.** The test for belonging here is whether
   * removing THIS instance from rotation would help:
   *
   *   - **Redis**: yes. Sessions, throttling and the Socket.IO adapter need it,
   *     and a partitioned instance can be routed around while others serve.
   *   - **A gRPC peer**: no. Every instance sees the same peer down, so pulling
   *     them all helps nobody and ends every session.
   *
   * Peers are still reported, in the body, where they inform rather than
   * decide. **A partial outage should look partial.**
   *
   * **Draining gates too, and it is a different kind of reason.** Redis answers
   * "can this instance serve?"; draining answers "should anything still be sent
   * here?" — see `DrainState`. Both make the answer no, so both belong in
   * `ready`.
   *
   * **The status code is the answer a probe can read.** A `httpGet`
   * `readinessProbe` succeeds on any 2xx/3xx and never parses the body, so a
   * 200 carrying `ready: false` reports HEALTHY to the kubelet — the failure
   * that looks exactly like health, one transport over from the one
   * `ops-controller.ts` refuses. `@Res({ passthrough: true })` keeps the
   * envelope and the body identical and changes only the line the orchestrator
   * acts on; `TransformInterceptor` reads `response.statusCode` after the
   * handler for exactly this case.
   *
   * See `docs/decisions/0010-readiness-probes-do-not-cascade.md`.
   */
  @ApiOperation({
    summary: 'Readiness — should traffic reach THIS instance?',
    description:
      '`ready` gates on Redis and on whether this instance is draining. Peer gRPC ' +
      'health is REPORTED under `peers` and deliberately does not gate: every ' +
      'instance sees the same peer down, so gating would remove all of them and ' +
      'turn one service outage into a total one. A partial outage should look ' +
      'partial. Returns 503 when not ready — a probe reads the status line, not ' +
      'the body.',
    security: [],
  })
  @ApiWrappedResponse(ReadinessResponseDto)
  @ApiFilterErrors()
  @Get('ready')
  async readiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessResponseDto> {
    // Started before the peer read so the two overlap rather than queue. Both
    // are bounded; this only keeps the probe's latency at the slower of the two
    // rather than their sum.
    const redisReachable = this.redis.isReachable();
    const peers = this.serviceRegistry.checkAll();

    const draining = this.drain.isDraining();
    const redis: ServiceHealth = (await redisReachable) ? 'UP' : 'DOWN';
    const ready = redis === 'UP' && !draining;

    if (!ready) response.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      ready,
      draining,
      dependencies: { redis },
      peers,
      timestamp: new Date(),
    };
  }
}
