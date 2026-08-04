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
      // `nats.publish('audit.record', json)` from anything at all — a test, a
      // future Python service, a `nats` CLI probe — reach a Nest
      // `@EventPattern` handler.
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
