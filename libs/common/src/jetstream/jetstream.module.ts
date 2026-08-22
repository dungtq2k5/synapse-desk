import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { headers, type NatsConnection } from 'nats';
import { connectJetStream } from './jetstream-bootstrap';
import { formatErrorMsg } from '../utils/format-error';

/** The raw JetStream connection, separate from Nest's core NATS transport. */
export const JETSTREAM_CONNECTION = Symbol('JETSTREAM_CONNECTION');

/**
 * Fire-and-forget publisher for the durable subjects (ADR 0041).
 *
 * Non-throwing for the same reason `AuditPublisher` and `NotificationPublisher`
 * are: recording that a thing happened is a consequence of it happening, not a
 * precondition, and a broker outage must not roll back the write the user asked
 * for.
 *
 * **The durability this buys is the STREAM's, not this method's.** Once the
 * publish is acked the message survives a broker restart and will be redelivered
 * until a consumer acks it. Before that ack there is nothing, which is why the
 * failure is logged rather than swallowed silently.
 */
@Injectable()
export class JetStreamPublisher {
  private readonly logger = new Logger(JetStreamPublisher.name);

  constructor(
    @Inject(JETSTREAM_CONNECTION)
    private readonly connection: NatsConnection,
  ) {}

  /**
   * @param messageId Sets `Nats-Msg-Id`, so the stream collapses a repeated
   * PUBLISH of one act inside `DUPLICATE_WINDOW_MS`. This is not the same
   * mechanism as the consumer's idempotency and does not replace it: the window
   * cannot see a redelivery of a message it already accepted.
   */
  publish(subject: string, payload: unknown, messageId: string): void {
    // **`try` AND `.catch()`, because they cover different throws.** The
    // `.catch()` handles a rejected publish; the `try` handles a SYNCHRONOUS
    // one — `jetstream()` on a closed connection, or a payload that will not
    // serialize. Only the second escaped, and it escaped into the caller's
    // request, which is the one thing a fire-and-forget publisher promises not
    // to do.
    try {
      const message = headers();
      message.set('Nats-Msg-Id', messageId);

      void this.connection
        .jetstream()
        .publish(subject, new TextEncoder().encode(JSON.stringify(payload)), {
          headers: message,
        })
        .catch((error: unknown) =>
          this.logger.error(
            `Failed to publish to ${subject}: ${formatErrorMsg(error)}`,
          ),
        );
    } catch (error) {
      this.logger.error(
        `Failed to publish to ${subject}: ${formatErrorMsg(error)}`,
      );
    }
  }
}

/**
 * The one JetStream connection per service, and the publisher over it.
 *
 * Global because the alternative is threading it through every feature module
 * that records an audit act, which is most of them — the same argument
 * `ConfigModule` is global for. It is a connection, not business logic.
 *
 * `main.ts` reads {@link JETSTREAM_CONNECTION} out of the container to declare
 * its streams, rather than opening a second connection of its own.
 */
@Global()
@Module({
  providers: [
    {
      provide: JETSTREAM_CONNECTION,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        connectJetStream(configService.getOrThrow<string>('NATS_URL')),
    },
    JetStreamPublisher,
  ],
  exports: [JETSTREAM_CONNECTION, JetStreamPublisher],
})
export class JetStreamModule implements OnApplicationShutdown {
  constructor(
    @Inject(JETSTREAM_CONNECTION)
    private readonly connection: NatsConnection,
  ) {}

  /**
   * `drain()` rather than `close()`: it flushes what is already in flight and
   * lets in-progress consumer fetches finish, which is the difference between a
   * clean redeploy and a handful of messages redelivered because their acks
   * never left the process.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.connection.drain();
  }
}
