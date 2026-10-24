import type { ClientGrpc } from '@nestjs/microservices';
import { OrgStatus } from '@synapsedesk/contracts';
import { toProtoOrgStatus } from '@synapsedesk/grpc-proto';
import { defer } from 'rxjs';
import type { RedisService } from '../redis/redis.service';
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
    const service = new OrganizationStatusService(client, {
      client: new FakeRedis(),
    } as unknown as RedisService);
    service.onModuleInit();
    return { service, calls: () => calls };
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
});
