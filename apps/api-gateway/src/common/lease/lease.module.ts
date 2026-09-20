import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { GatewayLeaseService } from './gateway-lease.service';

/**
 * The implementation lease, for the two modules that read it and the
 * composition root that drives it.
 *
 * **Not `@Global()`**, for the reason `RedisModule` gives: conventions reserve
 * global modules for config, logging and database connections, and a global
 * provider hides a dependency. Two modules ask whether this process is
 * serving — readiness and the socket gateway — and both say so in their
 * imports. `main.ts` reaches it through `app.get`, which searches the whole
 * container.
 */
@Module({
  imports: [RedisModule],
  providers: [GatewayLeaseService],
  exports: [GatewayLeaseService],
})
export class LeaseModule {}
