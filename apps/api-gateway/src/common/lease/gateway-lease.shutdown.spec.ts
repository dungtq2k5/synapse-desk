import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GatewayLeaseService } from './gateway-lease.service';
import { LeaseModule } from './lease.module';

/** What the Redis client was asked to do, in order, across the whole shutdown. */
const calls: string[] = [];

jest.mock(
  'ioredis',
  () =>
    class FakeRedis {
      on() {
        return this;
      }

      eval() {
        calls.push('eval');
        return Promise.resolve(1);
      }

      zrem() {
        calls.push('zrem');
        return Promise.resolve(1);
      }

      quit() {
        calls.push('quit');
        return Promise.resolve('OK');
      }
    },
);

/**
 * The lease entry is released while the Redis client is still open.
 *
 * Driven through Nest's own shutdown, not by calling the hook: the release ran in
 * `onApplicationShutdown`, which Nest calls AFTER every `onModuleDestroy`, and
 * `RedisService` quit its client in `onModuleDestroy`. So the release always met a
 * closed client ("Connection is closed"), the entry stayed, and the other
 * implementation waited out the 30 s TTL. Measured in the cutover rehearsal: the old
 * side's entry outlived its pods by ~28 s, most of the handover window.
 */
describe('the gateway lease on shutdown', () => {
  it('**releases its entry before the Redis client quits**, in Nest’s own hook order', async () => {
    const app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ REDIS_URL: 'redis://127.0.0.1:6379' })],
        }),
        LeaseModule,
      ],
    }).compile();
    const lease = app.get(GatewayLeaseService);

    await lease.beat();
    expect(lease.isActive()).toBe(true);

    await app.close();

    expect(calls.filter((call) => call !== 'eval')).toEqual(['zrem', 'quit']);
  });
});
