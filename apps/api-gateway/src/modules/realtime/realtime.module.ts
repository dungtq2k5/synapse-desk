import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { TicketEventsConsumer } from './ticket-events.consumer';
import { TicketAccessService } from './ticket-access.service';
import { WsThrottlerService } from '../../common/services/ws-throttler.service';

/**
 * Imports AuthModule for `JwtService` — the handshake verifies the SAME
 * access-token cookie with the SAME RS256 public key the HTTP guards use.
 * A second verification path would be a second thing to keep in step with key
 * rotation, and the one that gets forgotten is the one nobody exercises.
 *
 * `TicketEventsConsumer` is a `controller` rather than a provider: its
 * `@EventPattern` handlers are registered by Nest's transport discovery, which
 * only walks controllers.
 */
@Module({
  imports: [AuthModule],
  controllers: [TicketEventsConsumer],
  providers: [RealtimeGateway, TicketAccessService, WsThrottlerService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
