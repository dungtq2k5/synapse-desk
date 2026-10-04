import type { INestMicroservice } from '@nestjs/common';
import type { LeaseRuntime } from './gateway-lease.service';

/** The transport inside a Nest microservice: what listens and what stops. */
type TransportServer = { close(): Promise<void> | void };

/**
 * What the lease starts and stops: the NATS consumer, and the sockets this process
 * serves.
 *
 * **Stops the TRANSPORT, never the microservice.** `connectMicroservice` shares
 * the application's module container, and `INestMicroservice.close()` closes
 * the application: it runs every provider's `onModuleDestroy`,
 * `beforeApplicationShutdown` and `onApplicationShutdown`, and closes the
 * Socket.IO servers. Called on a lease step-down, that quit the shared Redis
 * client (so the lease's own release failed and the other side waited out the
 * 30 s TTL) and set readiness to draining for good. A mid-life lease loss would
 * have left a running process that could never serve again. The transport's own
 * `close()` stops consuming and nothing else, and `listen()` can start it again.
 *
 * `serverInstance` is private in Nest's typings, so it is reached through this
 * one cast; `lease-runtime.spec.ts` holds it to a real hybrid application.
 *
 * @example lease.bind(natsLeaseRuntime(natsConsumer, () => app.get(RealtimeGateway).dropEverySocket()))
 */
export function natsLeaseRuntime(
  consumer: INestMicroservice,
  dropEverySocket: () => void,
): LeaseRuntime {
  const transport = () =>
    (consumer as unknown as { serverInstance: TransportServer }).serverInstance;

  return {
    activate: async () => {
      await consumer.listen();
    },
    // Order matters and is the opposite of starting: stop consuming, then drop
    // the sockets this process was serving, so no frame is relayed to a client
    // the new owner is about to take over.
    deactivate: async () => {
      await transport().close();
      dropEverySocket();
    },
  };
}
