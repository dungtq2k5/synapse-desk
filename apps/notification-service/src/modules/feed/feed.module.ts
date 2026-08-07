import { Module } from '@nestjs/common';
import { FeedService } from './feed.service';
import { NotificationsGrpcController } from './notifications-grpc.controller';

/**
 * The read half of Domain E.
 *
 * Separate from the write path on purpose: the consumers write rows from NATS
 * events and this serves them back over gRPC, and the only thing they share is
 * the table. Keeping them in one module would put a gRPC controller in the same
 * file tree as an event handler and invite a producer to call the feed directly.
 */
@Module({
  controllers: [NotificationsGrpcController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
