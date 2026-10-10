import { Module } from '@nestjs/common';
import { TicketAccessService } from './ticket-access.service';

/**
 * The third module in CLAUDE.md §1.1's "extract shared logic" resolution.
 *
 * Deliberately tiny and dependency-free beyond Prisma: anything else added here
 * becomes a dependency of every module that needs a visibility check, which is
 * most of Domain B.
 */
@Module({
  providers: [TicketAccessService],
  exports: [TicketAccessService],
})
export class TicketAccessModule {}
