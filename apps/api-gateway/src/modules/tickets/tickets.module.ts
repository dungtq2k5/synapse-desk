import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TicketsController } from './tickets.controller';
import { TicketsGrpcClient } from './tickets-grpc.client';
import { AssignmentsGrpcClient } from './assignments-grpc.client';
import { MessagesGrpcClient } from './messages-grpc.client';
import { MessagesController } from './messages.controller';
import { AttachmentsController } from './attachments.controller';
import { AiGrpcClient } from './ai-grpc.client';
import { AiController } from './ai.controller';
import { TicketsResolver } from './tickets.resolver';
import { TicketMessagesResolver } from './ticket-messages.resolver';

/**
 * Imports AuthModule for `JwtAuthGuard` and the `JwtModule` it needs — a guard
 * applied with `@UseGuards(Class)` is instantiated by the module declaring the
 * CONTROLLER, so `JwtService` has to resolve in this injector.
 *
 * `TICKET_GRPC_CLIENT` needs no import: `TicketGrpcModule` is `@Global`,
 * because Domain B's surface spans several gateway modules and every one of
 * them must share the single channel to ticket-service.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    TicketsController,
    MessagesController,
    AttachmentsController,
    AiController,
  ],
  providers: [
    TicketsGrpcClient,
    AssignmentsGrpcClient,
    MessagesGrpcClient,
    AiGrpcClient,
    TicketsResolver,
    TicketMessagesResolver,
  ],
  exports: [
    TicketsGrpcClient,
    AssignmentsGrpcClient,
    MessagesGrpcClient,
    AiGrpcClient,
  ],
})
export class TicketsModule {}
