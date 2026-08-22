import { ConfigService } from '@nestjs/config';
import { NatsOptions, Transport } from '@nestjs/microservices';

/**
 * Nest DI token for a NATS ClientProxy.
 *
 * Lives here rather than in one service's app.config because two services now
 * publish: auth-service (audit + notifications) and ticket-service (the
 * `ticket.*` domain events). A second declaration would be two symbols with the
 * same name — and since `Symbol()` is never equal to another `Symbol()`, the
 * failure would be a boot-time UnknownDependenciesException naming a token that
 * looks identical to the one that IS registered.
 */
export const NATS_CLIENT = Symbol('NATS_CLIENT');

/**
 * NATS transport options, for a client OR a server.
 *
 * One factory for both directions on purpose: the options are identical, and
 * the serializer pair in particular MUST match on both ends. Two copies would
 * be two chances for a publisher and a consumer to disagree about the wire
 * format — which NATS reports as nothing at all, because an undeliverable
 * payload is silently dropped rather than rejected.
 *
 * Returns `NatsOptions` rather than `MicroserviceOptions`, and that precision
 * is what makes one factory serve both: `NatsOptions` is a member of BOTH
 * `MicroserviceOptions` (the server union) and `ClientOptions` (the client
 * union), while the broader type is assignable to neither.
 */
export function createNatsTransport(configService: ConfigService): NatsOptions {
  return {
    transport: Transport.NATS,
    options: {
      servers: [configService.getOrThrow<string>('NATS_URL')],

      // NO custom serializer/deserializer. Nest's NATS defaults are already
      // JSON, and they do one thing a hand-rolled pair does not.
      //
      // `NatsRequestJSONDeserializer` decodes the payload and then asks whether
      // it carries `pattern`/`data`. If it does — a Nest client published it —
      // it passes straight through. If it does NOT, it maps the whole payload
      // onto the SUBJECT as its pattern. That fallback is what lets a raw
      // `nats.publish('ticket.assigned', json)` from anything at all — a test, a
      // future Python service, a `nats` CLI probe — reach a Nest
      // `@EventPattern` handler.
      //
      // The example used to be `audit.record`, which ADR 0041 moved to a
      // JetStream pull consumer — so it reaches no Nest handler at all now, and
      // nothing here applies to it. The core subjects this still describes are
      // `ticket.*`, `document.*` and `storage.object.superseded`.
      //
      // This previously declared a custom pair with `deserialize` nested INSIDE
      // `serializer`, where nothing reads it: the custom deserializer never ran
      // and the default's fallback was quietly doing the work. Tightening the
      // return type to `NatsOptions` is what surfaced it. Rather than fix the
      // key and lose the fallback, the pair is gone — the defaults were what
      // was running all along, and they are the better behaviour.
    },
  };
}

/**
 * Refuses to boot against a JetStream store that will not survive a restart.
 *
 * **Why this is fatal rather than a warning.** A stream declared on a broker
 * whose store is ephemeral is WORSE than the core publish it replaced: core
 * loses a message immediately and visibly, and nobody was told otherwise;
 * JetStream acks the publisher, the publisher records success, and the message
 * disappears at the next `compose up`. A service that starts and quietly
 * accepts durable messages it cannot keep converts an honest failure into a
 * silent one — by a change made to increase reliability.
 *
 * The default store is `/tmp/nats/jetstream`, inside the container's writable
 * layer, and `docker-compose.yml` mounts `nats_data:/data` — so before `-sd`
 * was passed the volume sat mounted, named and completely empty. That is the
 * shape worth naming: a configured-looking thing that is load-bearing in
 * appearance only.
 *
 * Read over the monitoring port rather than the client connection because
 * JetStream's client API does not expose `store_dir` at all — `getAccountInfo`
 * reports usage and limits, never where the bytes go.
 *
 * @param monitorUrl The broker's HTTP monitoring root, e.g. `http://nats:8222`.
 * @throws Error when the store is under `/tmp`, or when the broker reports no
 *   JetStream config at all — which means `-js` is missing entirely.
 */
export async function assertDurableStore(monitorUrl: string): Promise<void> {
  const response = await fetch(`${monitorUrl.replace(/\/$/, '')}/varz`);

  if (!response.ok) {
    throw new Error(
      `Could not read JetStream config from ${monitorUrl}/varz: HTTP ${response.status}`,
    );
  }

  const varz = (await response.json()) as {
    jetstream?: { config?: { store_dir?: string } };
  };
  const storeDir = varz.jetstream?.config?.store_dir;

  // Absent means the broker is running WITHOUT `-js`. Every publish would
  // silently fall back to core, which is the failure this whole feature exists
  // to remove and is invisible from the publisher's side.
  if (!storeDir) {
    throw new Error(
      `NATS at ${monitorUrl} reports no JetStream config; the broker is not running with -js`,
    );
  }

  if (storeDir.startsWith('/tmp')) {
    throw new Error(
      `JetStream store_dir is '${storeDir}', which does not survive a container ` +
        `recreate. Pass '-sd /data' so it writes to the mounted volume.`,
    );
  }
}
