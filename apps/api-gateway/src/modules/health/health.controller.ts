import { Controller, Get } from '@nestjs/common';
import {
  ServiceRegistry,
  type ServiceEndpoint,
} from './service-registry.service';

/**
 * Liveness and readiness probes (api-endpoints-plan). Both PUBLIC — an
 * orchestrator has no credentials, and a probe behind auth cannot restart a
 * process whose auth is broken.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly serviceRegistry: ServiceRegistry) {}

  /**
   * Liveness: is this process alive?
   *
   * Deliberately checks NOTHING external. A liveness probe that fails when a
   * dependency is down gets the container killed and restarted, which fixes
   * nothing and removes the instance that could have served cached or
   * degraded traffic. Dependencies belong in readiness, below.
   */
  @Get()
  liveness(): { status: string; timestamp: Date } {
    return { status: 'UP', timestamp: new Date() };
  }

  /** Readiness: should this instance receive traffic? */
  @Get('ready')
  readiness(): {
    ready: boolean;
    services: Record<string, ServiceEndpoint>;
    timestamp: Date;
  } {
    const services = this.serviceRegistry.checkAll();

    // DOWN blocks readiness; UNKNOWN does not. A peer still connecting during a
    // simultaneous restart would otherwise deadlock both sides at not-ready.
    const ready = Object.values(services).every((s) => s.health !== 'DOWN');

    return { ready, services, timestamp: new Date() };
  }
}
