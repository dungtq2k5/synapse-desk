import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { AssignmentsService } from './assignments.service';
import { AssignmentsGrpcController } from './assignments-grpc.controller';

/**
 * Imports `TicketsModule` for `TicketsService.load` — the tenant + visibility
 * check every assignment RPC runs before it touches anything. Importing the
 * module rather than re-providing the service is what keeps it a single
 * instance, and re-implementing the check here is what this import exists to
 * prevent.
 */
@Module({
  imports: [TicketsModule],
  controllers: [AssignmentsGrpcController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
