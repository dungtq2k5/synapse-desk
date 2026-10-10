import type Redis from 'ioredis';
import { bootstrapE2eTest } from '../utils';
import { LIMIT_ALERT_REDIS } from '../../src/modules/limit-alerts/limit-alerts.module';

/**
 * The connection the alarm opens, and who closes it.
 *
 * `useFactory` providers get no lifecycle hooks, so a client built inside one
 * survives `app.close()` unless the module that built it owns the shutdown.
 * `QuotaCounterService` wrote this rule down after the same leak; these two
 * clients are the same shape and did not follow it.
 *
 * **Asserted on `status`, not on the process exiting.** A hang is the absence
 * of an event — Jest reports it as `--detectOpenHandles` output rather than a
 * failed expectation, so "the run terminates" is not writable as an assertion.
 * What is writable is the state of the socket the leak would leave open.
 */
describe('The limit-alarm Redis connection (e2e)', () => {
  it('is CLOSED when the module shuts down', async () => {
    const fx = await bootstrapE2eTest();
    const redis = fx.moduleRef.get<Redis>(LIMIT_ALERT_REDIS);

    // Not vacuous: a client that never connected is already 'end'.
    expect(['connect', 'ready', 'connecting']).toContain(redis.status);

    await fx.close();

    expect(redis.status).toBe('end');
  });

  it('lands in the same logical database as the rest of the service', async () => {
    // Omitting `db` puts the alarm levels in db 0 while everything else uses
    // `REDIS_DB`. It works today only because auth happens to leave `REDIS_DB`
    // unset — and the day somebody sets it, alerts re-fire forever because the
    // level is written where nothing reads it.
    const fx = await bootstrapE2eTest();
    const redis = fx.moduleRef.get<Redis>(LIMIT_ALERT_REDIS);

    try {
      expect(redis.options.db).toBe(Number(process.env.REDIS_DB ?? 0));
    } finally {
      await fx.close();
    }
  });
});
