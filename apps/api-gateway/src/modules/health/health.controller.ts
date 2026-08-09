import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import {
  ServiceRegistry,
  type ServiceHealth,
} from './service-registry.service';
import { RedisHealthService } from './redis-health.service';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
} from './dto/health-response.dto';

/**
 * Liveness and readiness probes (api-endpoints-plan §6). Both PUBLIC — an
 * orchestrator has no credentials, and a probe behind auth cannot restart a
 * process whose auth is broken.
 */
@ApiTags('Ops')
@Controller('health')
export class HealthController {
  constructor(
    private readonly serviceRegistry: ServiceRegistry,
    private readonly redis: RedisHealthService,
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
   * Readiness: should this instance receive traffic? — 23-doc §1.
   *
   * **Peer health does NOT gate this, and that is the fix.** The previous
   * version computed `every(s => s.health !== 'DOWN')` over the gRPC peers, so a
   * single peer being down made every gateway instance report not-ready and
   * Kubernetes pulled all of them — turning one service's outage into a total
   * one. The blast radius of any one service became the whole product, and the
   * mechanism was the health check itself.
   *
   * The test for belonging here is whether removing THIS instance from rotation
   * would help:
   *
   *   - **Redis**: yes. Sessions, throttling and the Socket.IO adapter all need
   *     it, and a partitioned instance can be routed around while others serve.
   *   - **A gRPC peer**: no. Every instance sees the same peer down, so pulling
   *     them all helps nobody and ends every session in the process.
   *
   * Peers are still reported, because during an incident that is genuinely
   * useful — just in the body, where it informs rather than decides. **A partial
   * outage should look partial**: requests that need the down peer get a 503
   * from the route that needs it, and everything else keeps working.
   *
   * Not gated on `auth-service` either, despite every authenticated route
   * verifying through it — JWTs verify LOCALLY against the public key, so a
   * brief auth-service outage leaves existing sessions working and pulling the
   * gateway would be the thing that ends them.
   */
  @ApiOperation({
    summary: 'Readiness — should traffic reach THIS instance?',
    description:
      '`ready` gates on Redis alone. Peer gRPC health is REPORTED under `peers` ' +
      'and deliberately does not gate: every instance sees the same peer down, so ' +
      'gating would remove all of them and turn one service outage into a total ' +
      'one. A partial outage should look partial.',
    security: [],
  })
  @ApiWrappedResponse(ReadinessResponseDto)
  @ApiFilterErrors()
  @Get('ready')
  async readiness(): Promise<ReadinessResponseDto> {
    // Started before the peer read so the two overlap rather than queue. Both
    // are bounded; this only keeps the probe's latency at the slower of the two
    // rather than their sum.
    const redisReachable = this.redis.isReachable();
    const peers = this.serviceRegistry.checkAll();

    const redis: ServiceHealth = (await redisReachable) ? 'UP' : 'DOWN';

    return {
      ready: redis === 'UP',
      dependencies: { redis },
      peers,
      timestamp: new Date(),
    };
  }
}
