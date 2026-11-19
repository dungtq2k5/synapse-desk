import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RevokedSessionsService } from './revoked-sessions.service';

/**
 * The shared Redis connection, for the modules that ask for it.
 *
 * **Not `@Global()`**, though it would work. Conventions reserve global
 * modules for config, logging and database connections, and warns that a global
 * provider hides a dependency: a module using Redis would not say so in its
 * imports. Three modules need it today, an explicit import each, and the import
 * list stays an honest statement of what a module talks to.
 */
@Module({
  providers: [RedisService, RevokedSessionsService],
  exports: [RedisService, RevokedSessionsService],
})
export class RedisModule {}
