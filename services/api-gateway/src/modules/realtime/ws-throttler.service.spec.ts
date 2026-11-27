import { Logger } from '@nestjs/common';
import { failOpenLines } from '@synapsedesk/testing/fail-open';
import type { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import type { RedisService } from '../../common/redis/redis.service';
import { WsThrottlerService } from './ws-throttler.service';

/** The one command the throttler issues, in memory: the counting script. */
class FakeRedis {
  readonly hits = new Map<string, number>();
  readonly windows = new Map<string, number>();
  failing = false;

  eval(_script: string, _keys: number, key: string, ttlMs: number) {
    if (this.failing) return Promise.reject(new Error('down'));
    const next = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, next);
    if (next === 1) this.windows.set(key, ttlMs);
    return Promise.resolve(next);
  }
}

describe('WsThrottlerService', () => {
  const LIMITS: Record<string, number> = {
    WS_HANDSHAKE_LIMIT: 3,
    WS_HANDSHAKE_TTL: 60_000,
    WS_HANDSHAKE_FAILED_LIMIT: 2,
    WS_HANDSHAKE_FAILED_TTL: 30_000,
    WS_HANDSHAKE_USER_LIMIT: 2,
    WS_HANDSHAKE_USER_TTL: 45_000,
  };

  const throttler = () => {
    const redis = new FakeRedis();
    const service = new WsThrottlerService(
      { client: redis } as unknown as RedisService,
      { getOrThrow: (key: string) => LIMITS[key] } as unknown as ConfigService,
    );
    return { service, redis };
  };

  /** A socket behind the Ingress: the client is the rightmost forwarded entry. */
  const from = (ip: string, sub?: string) =>
    ({
      handshake: {
        address: '10.0.0.1',
        headers: { 'x-forwarded-for': `198.51.100.1, ${ip}` },
      },
      data: { user: sub ? { sub } : undefined },
    }) as unknown as Socket;

  const times = async (n: number, call: () => Promise<boolean>) => {
    const answers: boolean[] = [];
    for (let i = 0; i < n; i++) answers.push(await call());
    return answers;
  };

  it('**the flood ceiling is per client address**, and its window starts on the first hit', async () => {
    const { service, redis } = throttler();

    expect(
      await times(4, () => service.allowHandshake(from('203.0.113.1'))),
    ).toEqual([true, true, true, false]);
    expect(await service.allowHandshake(from('203.0.113.2'))).toBe(true);
    expect(redis.windows.get('ws_handshake:flood:203.0.113.1')).toBe(60_000);
  });

  it('**the failed-handshake limit is per client address**', async () => {
    const { service, redis } = throttler();
    const client = from('203.0.113.3');

    expect(await times(3, () => service.allowFailed(client))).toEqual([
      true,
      true,
      false,
    ]);
    expect(await service.allowFailed(from('203.0.113.4'))).toBe(true);
    expect(redis.windows.get('ws_handshake:failed:203.0.113.3')).toBe(30_000);
  });

  it('**the per-user limit is keyed on the user**, never the address', async () => {
    const { service, redis } = throttler();

    expect(await times(3, () => service.allowUser('user-1'))).toEqual([
      true,
      true,
      false,
    ]);
    expect(await service.allowUser('user-2')).toBe(true);
    expect(redis.windows.get('ws_handshake:user:user-1')).toBe(45_000);
  });

  it('an event is counted per user; one with no user is refused', async () => {
    const { service } = throttler();

    expect(
      await times(3, () =>
        service.allowEvent(
          from('203.0.113.5', 'user-1'),
          'typing:start',
          2,
          1_000,
        ),
      ),
    ).toEqual([true, true, false]);
    expect(
      await service.allowEvent(from('203.0.113.5'), 'typing:start', 2, 1_000),
    ).toBe(false);
  });

  it('**a Redis failure allows every handshake and event, each with its line on `FAIL_OPEN_LINES`**', async () => {
    const { service, redis } = throttler();
    redis.failing = true;
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const answers = [
      await service.allowHandshake(from('203.0.113.6')),
      await service.allowFailed(from('203.0.113.6')),
      await service.allowUser('user-1'),
      await service.allowEvent(
        from('203.0.113.6', 'user-1'),
        'typing:start',
        2,
        1_000,
      ),
    ];
    const lines = error.mock.calls.map(([message]) => String(message));
    error.mockRestore();

    expect(answers).toEqual([true, true, true, true]);
    // One line per call, and each one the guard would catch in a test run.
    expect(lines).toHaveLength(4);
    expect(failOpenLines(lines.join('\n'))).toEqual(lines);
  });
});
