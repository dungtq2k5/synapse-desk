import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ChatController } from './chat.controller';

/**
 * No providers of its own — the whole module is one controller forwarding to
 * `TicketsModule`'s clients. If a service ever appears here, the "thin wrapper"
 * claim has been broken and the rules have started being duplicated.
 */
@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [ChatController],
})
export class ChatModule {}
