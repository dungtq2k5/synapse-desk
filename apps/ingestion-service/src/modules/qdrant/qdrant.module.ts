import { Global, Module } from '@nestjs/common';
import { QdrantService } from './qdrant.service';

/**
 * `@Global`, and for the cache-shaped reason rather than convenience: the
 * service holds ONE Qdrant HTTP client, and providing it twice would open two
 * connection pools to the same server for one process.
 */
@Global()
@Module({
  providers: [QdrantService],
  exports: [QdrantService],
})
export class QdrantModule {}
