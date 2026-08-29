import type Redis from 'ioredis';
import { LimitAlertPublisher, limitAlertStateKey } from '@synapsedesk/common';
import { bootstrapE2eTest } from '../utils';
import { LIMIT_ALERT_REDIS } from '../../src/modules/limit-alerts/limit-alerts.module';

/**
 * Where this service's alarm levels live, and who closes the connection.
 *
 * Both properties were missing from the provider that builds this client, and
 * both are invisible in normal use: `.env.test` sets `REDIS_DB = 4`, so a
 * client with no `db` option wrote levels to db 0 — outside whatever the
 * fixture flushes, in the shared default keyspace, surviving between tests.
 */
describe('The limit-alarm Redis connection (e2e)', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';

  it('writes the level into the DB the rest of the service uses', async () => {
    const fx = await bootstrapE2eTest();
    const redis = fx.moduleRef.get<Redis>(LIMIT_ALERT_REDIS);
    const alerts = fx.moduleRef.get(LimitAlertPublisher);

    try {
      // Declared, and then demonstrated — the option alone would be a
      // configuration assertion, and what matters is where the key lands.
      expect(redis.options.db).toBe(Number(process.env.REDIS_DB ?? 0));
      // Not vacuous: db 0 is the value the missing option defaulted to, so a
      // test written against an unset REDIS_DB would pass either way.
      expect(redis.options.db).toBeGreaterThan(0);

      await alerts.evaluate(ORG, 'storage', 90, 100);

      const key = limitAlertStateKey(ORG, 'storage');
      await expect(redis.get(key)).resolves.toBe('80');

      // And it is genuinely in that database, not merely readable through a
      // client that happens to share one.
      const elsewhere = redis.duplicate({ db: 0 });
      try {
        await expect(elsewhere.get(key)).resolves.toBeNull();
      } finally {
        await elsewhere.quit();
      }

      await redis.del(key);
    } finally {
      await fx.close();
    }
  });

  it('is CLOSED when the module shuts down', async () => {
    // `useFactory` providers get no lifecycle hooks, so the module that built
    // the client owns closing it. Asserted on `status` rather than on the run
    // terminating: a hang is the absence of an event, which Jest reports as
    // `--detectOpenHandles` output rather than a failed expectation.
    const fx = await bootstrapE2eTest();
    const redis = fx.moduleRef.get<Redis>(LIMIT_ALERT_REDIS);

    expect(['connect', 'ready', 'connecting']).toContain(redis.status);

    await fx.close();

    expect(redis.status).toBe('end');
  });
});
