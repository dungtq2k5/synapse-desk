import DataLoader from 'dataloader';
import type { UserSummary } from '@synapsedesk/grpc-proto';
import type { GqlContext } from '../../common/graphql/loaders/loaders.factory';
import { AgentStatResolver } from './analytics.resolver';
import type { AgentStatGqlDto } from './dto/graphql/analytics-response.gql-dto';

/**
 * `AgentStat.agent` resolves through the USERS loader.
 *
 * **The test is about which machinery the edge uses, not about the answer.** A
 * resolver that called `UserServiceGrpcClient` directly would return the same
 * name and pass any assertion about the output — while issuing one RPC per
 * agent row, which at a page of fifty is fifty round trips to auth-service. The
 * loader is what makes it one.
 *
 * `resolvers.spec.ts` catches the direct call by static scan; this catches the
 * subtler version, where the loader is present but a hand-rolled batch is what
 * actually runs.
 */
describe('AgentStat.agent', () => {
  const wireSummary = (userId: string): UserSummary => ({
    userId,
    fullName: 'Ada Lovelace',
    avatarUrl: 'https://example.test/ada.png',
    isLocked: false,
    deletedAt: undefined,
  });

  const contextWith = (batch: jest.Mock): GqlContext =>
    ({
      loaders: { users: new DataLoader<string, UserSummary | null>(batch) },
    }) as unknown as GqlContext;

  const stat = (agentId: string) => ({ agentId }) as AgentStatGqlDto;

  it('loads through the users loader', async () => {
    const batch = jest.fn((ids: readonly string[]) =>
      Promise.resolve(ids.map((id) => wireSummary(id))),
    );

    const agent = await new AgentStatResolver().agent(
      stat('agent-1'),
      contextWith(batch),
    );

    expect(agent).toEqual({
      id: 'agent-1',
      fullName: 'Ada Lovelace',
      avatarUrl: 'https://example.test/ada.png',
      isLocked: false,
      deletedAt: null,
    });
  });

  it('**batches a whole page of rows into ONE call**', async () => {
    // The property the loader exists for, and the one an output assertion
    // cannot see. Fifty agent rows resolved without it are fifty RPCs.
    const batch = jest.fn((ids: readonly string[]) =>
      Promise.resolve(ids.map((id) => wireSummary(id))),
    );
    const resolver = new AgentStatResolver();
    const context = contextWith(batch);

    const rows = Array.from({ length: 50 }, (_, index) =>
      stat(`agent-${index}`),
    );

    await Promise.all(rows.map((row) => resolver.agent(row, context)));

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(50);
  });

  it('returns null for an agent who no longer exists', async () => {
    // A rollup row outlives the user it counts. Last month's numbers stay,
    // and the id resolves to nothing — which must be a null field rather than
    // an error that empties the whole query of numbers somebody is reading.
    const batch = jest.fn((ids: readonly string[]) =>
      Promise.resolve(ids.map(() => null)),
    );

    const agent = await new AgentStatResolver().agent(
      stat('deleted-agent'),
      contextWith(batch),
    );

    expect(agent).toBeNull();
  });
});
