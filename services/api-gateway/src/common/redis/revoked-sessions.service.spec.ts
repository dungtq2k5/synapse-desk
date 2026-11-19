import { REVOKED_SESSION_KEY_PREFIX } from '@synapsedesk/contracts';
import type { RedisService } from './redis.service';
import { RevokedSessionsService } from './revoked-sessions.service';

describe('RevokedSessionsService', () => {
  const build = (client: Partial<RedisService['client']>) =>
    new RevokedSessionsService({ client } as RedisService);

  it('**a marked family is revoked**; an unmarked one is not', async () => {
    const marked = new Set([`${REVOKED_SESSION_KEY_PREFIX}gone`]);
    const revoked = build({
      exists: ((key: string) =>
        Promise.resolve(marked.has(key) ? 1 : 0)) as never,
    });

    await expect(revoked.isRevoked('gone')).resolves.toBe(true);
    await expect(revoked.isRevoked('live')).resolves.toBe(false);
  });

  it('**a token without `sid` is never revoked**, and costs no call', async () => {
    const exists = jest.fn();
    await expect(build({ exists }).isRevoked(undefined)).resolves.toBe(false);
    expect(exists).not.toHaveBeenCalled();
  });

  it('**Redis down fails open**', async () => {
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    const revoked = build({ exists: down, mget: down });

    await expect(revoked.isRevoked('any')).resolves.toBe(false);
    await expect(revoked.revokedAmong(['a', 'b'])).resolves.toEqual(new Set());
  });

  it('**the sweep reads every family in ONE `MGET`**', async () => {
    const mget = jest.fn((keys: string[]) =>
      Promise.resolve(keys.map((key) => (key.endsWith('b') ? '1' : null))),
    );

    await expect(
      build({ mget: mget as never }).revokedAmong(['a', 'b', 'c']),
    ).resolves.toEqual(new Set(['b']));
    expect(mget).toHaveBeenCalledTimes(1);
  });
});
