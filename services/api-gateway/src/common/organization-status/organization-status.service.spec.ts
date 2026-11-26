import { GatewayTimeoutException, Logger } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { defer } from 'rxjs';
import type { RedisService } from '../redis/redis.service';
import type { CacheService } from '../cache/cache.service';
import { CACHE_SCOPES } from '../config/cache.config';
import { OrganizationStatusService } from './organization-status.service';

/** The four commands the status cache issues, in memory. */
class FakeRedis {
  readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  del(...keys: string[]): Promise<number> {
    return Promise.resolve(keys.filter((key) => this.store.delete(key)).length);
  }
}

describe('OrganizationStatusService', () => {
  const ORGANIZATION = 'org-1';

  /** A service whose status RPC answers with `answer()`, counting its calls. */
  const serviceWith = (answer: () => Promise<OrgStatus>) => {
    let calls = 0;
    const client = {
      getService: () => ({
        getOrganizationStatus: () =>
          defer(async () => {
            calls += 1;
            return { status: toProtoOrgStatus(await answer()), deleted: false };
          }),
      }),
    } as unknown as ClientGrpc;
    const cache = { invalidateScope: jest.fn().mockResolvedValue(0) };
    const redis = new FakeRedis();
    const service = new OrganizationStatusService(
      client,
      { client: redis } as unknown as RedisService,
      cache as unknown as CacheService,
    );
    service.onModuleInit();
    return { service, calls: () => calls, cache, redis };
  };

  it('caches a decision: two reads, one question', async () => {
    const { service, calls } = serviceWith(() =>
      Promise.resolve(OrgStatus.ACTIVE),
    );

    await service.get(ORGANIZATION);
    await service.get(ORGANIZATION);

    expect(calls()).toBe(1);
  });

  it('**a status read before a freeze and stored after it is never served**', async () => {
    // The race, without timing: the freeze lands while auth-service is still
    // answering ACTIVE. That answer is stored under the old generation, so
    // the next request asks again and sees FROZEN.
    let status = OrgStatus.ACTIVE;
    const { service, calls } = serviceWith(async () => {
      if (calls() === 1) {
        const answer = status;
        status = OrgStatus.FROZEN;
        await service.invalidate(ORGANIZATION);
        return answer;
      }
      return status;
    });

    const first = await service.get(ORGANIZATION);
    const second = await service.get(ORGANIZATION);

    expect([first.status, second.status]).toEqual([
      OrgStatus.ACTIVE,
      OrgStatus.FROZEN,
    ]);
    expect(calls()).toBe(2);
  });

  it("**invalidating also evicts the organization's cached `GET /organizations/current`**", async () => {
    const { service, cache } = serviceWith(() =>
      Promise.resolve(OrgStatus.ACTIVE),
    );

    await service.invalidate(ORGANIZATION);

    expect(cache.invalidateScope).toHaveBeenCalledWith(
      ORGANIZATION,
      CACHE_SCOPES.organizations,
    );
  });

  describe('an auth-service outage', () => {
    const KEY = `org-status:${ORGANIZATION}|#0`;
    const stored = (status: OrgStatus, freshUntil?: number) =>
      JSON.stringify({ status, deleted: false, freshUntil });

    /** Runs `read`, returning what it answered or threw, and the warnings logged. */
    const outcome = async (read: () => Promise<unknown>) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      let result: unknown;
      try {
        result = await read();
      } catch (error) {
        result = error;
      }
      const warnings = warn.mock.calls.map(([message]) => String(message));
      warn.mockRestore();

      return { result, warnings };
    };

    it.each([
      [
        'UNAVAILABLE',
        () =>
          Object.assign(new Error('down'), { code: GrpcStatus.UNAVAILABLE }),
      ],
      [
        'DEADLINE_EXCEEDED',
        () =>
          Object.assign(new Error('slow'), {
            code: GrpcStatus.DEADLINE_EXCEEDED,
          }),
      ],
      ['DEADLINE_EXCEEDED', () => new GatewayTimeoutException()],
    ])(
      '**serves a stale status when the call fails with %s, and warns**',
      async (code, failure) => {
        const { service, redis } = serviceWith(() => Promise.reject(failure()));
        redis.store.set(
          KEY,
          stored(OrgStatus.SUSPENDED_PAST_DUE, Date.now() - 1),
        );

        const { result, warnings } = await outcome(() =>
          service.get(ORGANIZATION),
        );

        expect(result).toEqual({
          status: OrgStatus.SUSPENDED_PAST_DUE,
          deleted: false,
        });
        expect(warnings).toEqual([
          `auth-service unreachable (${code}); serving the last known status of ${ORGANIZATION}`,
        ]);
      },
    );

    it('**any other failure refuses, stale entry or not**', async () => {
      const failure = Object.assign(new Error('bad'), {
        code: GrpcStatus.INTERNAL,
      });
      const { service, redis } = serviceWith(() => Promise.reject(failure));
      redis.store.set(KEY, stored(OrgStatus.ACTIVE, Date.now() - 1));

      expect((await outcome(() => service.get(ORGANIZATION))).result).toBe(
        failure,
      );
    });

    it('**no cached status refuses**', async () => {
      const failure = Object.assign(new Error('down'), {
        code: GrpcStatus.UNAVAILABLE,
      });
      const { service } = serviceWith(() => Promise.reject(failure));

      expect((await outcome(() => service.get(ORGANIZATION))).result).toBe(
        failure,
      );
    });

    it('an entry without `freshUntil` is fresh: an older replica wrote it', async () => {
      const { service, calls, redis } = serviceWith(() =>
        Promise.resolve(OrgStatus.ACTIVE),
      );
      redis.store.set(KEY, stored(OrgStatus.FROZEN));

      expect((await service.get(ORGANIZATION)).status).toBe(OrgStatus.FROZEN);
      expect(calls()).toBe(0);
    });

    it('a value not shaped as written is a miss, silently', async () => {
      const { service, calls, redis } = serviceWith(() =>
        Promise.resolve(OrgStatus.ACTIVE),
      );
      redis.store.set(KEY, JSON.stringify({ status: 7, deleted: 'no' }));

      const { result, warnings } = await outcome(() =>
        service.get(ORGANIZATION),
      );

      expect(result).toEqual({ status: OrgStatus.ACTIVE, deleted: false });
      expect(calls()).toBe(1);
      expect(warnings).toEqual([]);
    });

    it('writes `freshUntil` thirty seconds out', async () => {
      const { service, redis } = serviceWith(() =>
        Promise.resolve(OrgStatus.ACTIVE),
      );
      const before = Date.now();

      await service.get(ORGANIZATION);

      const { freshUntil } = JSON.parse(redis.store.get(KEY) ?? '{}') as {
        freshUntil: number;
      };
      expect(freshUntil).toBeGreaterThanOrEqual(before + 30_000);
      expect(freshUntil).toBeLessThanOrEqual(Date.now() + 30_000);
    });
  });
});
