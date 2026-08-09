import type {
  ServiceEndpoint,
  ServiceHealth,
} from '../service-registry.service';

/** `GET /health` — liveness. */
export class LivenessResponseDto {
  status!: 'UP';
  timestamp!: Date;
}

/** What this instance cannot serve without. These GATE readiness. */
export class ReadinessDependenciesDto {
  redis!: ServiceHealth;
}

/**
 * `GET /health/ready` — 23-doc §1.
 *
 * **The split between `ready` and `peers` is the whole design.** `ready` answers
 * one question — should traffic reach THIS instance? — and everything that does
 * not change that answer lives beside it as reporting rather than inside it as a
 * condition. A field added to `dependencies` gates the load balancer; the same
 * field added to `peers` informs a human. Putting a new check in the wrong one
 * is how §1's outage happened, so they are separate objects rather than one flat
 * bag a future field could land in by accident.
 */
export class ReadinessResponseDto {
  ready!: boolean;
  dependencies!: ReadinessDependenciesDto;
  /** Peer connectivity, for humans during an incident. Does NOT gate. */
  peers!: Record<string, ServiceEndpoint>;
  timestamp!: Date;
}

/**
 * `GET /version` — 23-doc §3.
 *
 * **Three fields, and the test asserts the exact key set.** This is the endpoint
 * that accretes fields: Node version, dependency versions, environment name and
 * hostname all look harmless, and each turns a support aid into a reconnaissance
 * endpoint on a route that is deliberately public and unauthenticated. None of
 * them answer "which build is this?", which is the only reason it exists.
 */
export class VersionResponseDto {
  version!: string;
  sha!: string;
  builtAt!: string;
}
