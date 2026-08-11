import { RedisModule } from '../../common/redis/redis.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { RealtimeGateway } from './realtime.gateway';
import { TicketEventsConsumer } from './ticket-events.consumer';
import { NotificationEventsConsumer } from './notification-events.consumer';
import { DocumentEventsConsumer } from './document-events.consumer';
import { TicketAccessService } from './ticket-access.service';
import { AiStreamService } from './ai-stream.service';
import { PresenceService } from './presence.service';
import { WsThrottlerService } from './ws-throttler.service';

/**
 * Imports AuthModule for `JwtService` — the handshake verifies the SAME
 * access-token cookie with the SAME RS256 public key the HTTP guards use.
 * A second verification path would be a second thing to keep in step with key
 * rotation, and the one that gets forgotten is the one nobody exercises.
 *
 * Both consumers are `controllers` rather than providers: their
 * `@EventPattern` handlers are registered by Nest's transport discovery, which
 * only walks controllers.
 */
@Module({
  // `TicketsModule` for `MessagesGrpcClient` — `message:send` calls the SAME
  // RPC the HTTP controller calls (22-doc §2.1), so it reuses that client
  // rather than opening a second path to the same write.
  imports: [AuthModule, TicketsModule, RedisModule],
  controllers: [
    TicketEventsConsumer,
    NotificationEventsConsumer,
    DocumentEventsConsumer,
  ],
  providers: [
    RealtimeGateway,
    TicketAccessService,
    // Holds the `Chat` server-stream per socket — 22-doc §5. In this module
    // rather than a `ChatModule` because the thing it owns is a SOCKET's
    // lifetime: a stream is cancelled by disconnect, and disconnect is only
    // observable here.
    AiStreamService,
    // Redis-backed rather than in-process — 22-doc §4. A pod that crashes never
    // sends `disconnect`, so anything derived from disconnect events leaks
    // "online forever"; an expiring key needs no cleanup at all.
    PresenceService,
    WsThrottlerService,
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
