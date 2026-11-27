import type { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Socket } from 'socket.io';
import { SHED_ONLY, WsThrottlerService } from './ws-throttler.service';

describe('WsThrottlerService', () => {
  const LIMIT = 2;

  /** Storage that counts per key and records each call's block duration. */
  const storage = () => {
    const hits = new Map<string, number>();
    const blockDurations: number[] = [];
    const fake = {
      increment: (key: string, ttl: number, _limit: number, block: number) => {
        blockDurations.push(block);
        const totalHits = (hits.get(key) ?? 0) + 1;
        hits.set(key, totalHits);
        return Promise.resolve({
          totalHits,
          timeToExpire: ttl,
          isBlocked: false,
          timeToBlockExpire: 0,
        });
      },
    };
    return { fake: fake as unknown as ThrottlerStorage, blockDurations };
  };

  const config = {
    getOrThrow: (key: string) =>
      key === 'WS_HANDSHAKE_LIMIT' ? LIMIT : 60_000,
  } as unknown as ConfigService;

  const client = {
    handshake: { address: '10.0.0.1', headers: {} },
    data: { user: { sub: 'user-1' } },
    disconnect: jest.fn(),
  } as unknown as Socket;

  it('**past the handshake budget the address is refused**, and every call can be stored', async () => {
    const { fake, blockDurations } = storage();
    const throttler = new WsThrottlerService(fake, config);

    const answers: boolean[] = [];
    for (let n = 0; n <= LIMIT; n++) {
      answers.push(await throttler.allowHandshake(client, 'Realtime'));
    }

    expect(answers).toEqual([true, true, false]);
    // Redis refuses `PX 0`, and a refused write fails open.
    expect(blockDurations.every((block) => block >= 1)).toBe(true);
  });

  it('**past an event limit the frame is dropped**, with a block Redis accepts', async () => {
    const { fake, blockDurations } = storage();
    const throttler = new WsThrottlerService(fake, config);

    const answers: boolean[] = [];
    for (let n = 0; n < 3; n++) {
      answers.push(
        await throttler.allowEvent(client, 'typing:start', 2, 1_000),
      );
    }

    expect(answers).toEqual([true, true, false]);
    expect(blockDurations).toEqual([SHED_ONLY, SHED_ONLY, SHED_ONLY]);
  });
});
