import type { ClientGrpc } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import {
  DEPARTMENT_SERVICE_NAME,
  UserProjection,
  USER_SERVICE_NAME,
} from '@synapsedesk/grpc-proto';
import type { RequestContext } from '@synapsedesk/contracts';
import type { CacheService } from '../../common/cache/cache.service';
import { TicketReferences } from './ticket-references.service';
import type { TicketResponseDto } from './dto/rest/ticket-response.dto';
import type { MessageResponseDto } from './dto/rest/message-response.dto';

describe('TicketReferences', () => {
  const ORG = 'org-1';
  const context = {
    sub: 'caller',
    organizationId: ORG,
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
    ip: '',
    userAgent: '',
  } as RequestContext;

  /** Every cache read misses and every write is dropped: the RPCs answer. */
  const cache = {
    mget: (inputs: { scope: string }[]) =>
      Promise.resolve(
        inputs.map((input) => ({ value: null, key: input.scope })),
      ),
    msetEx: () => Promise.resolve(),
  } as unknown as CacheService;

  const build = (users: jest.Mock, departments: jest.Mock) => {
    const auth = {
      getService: (name: string) =>
        name === USER_SERVICE_NAME
          ? { listUsersByIds: users }
          : name === DEPARTMENT_SERVICE_NAME
            ? { listDepartmentsByIds: departments }
            : {},
    } as unknown as ClientGrpc;
    const ingestion = { getService: () => ({}) } as unknown as ClientGrpc;
    return new TicketReferences(auth, ingestion, cache);
  };

  const ticket = (n: number, overrides: Partial<TicketResponseDto> = {}) =>
    ({
      id: `t-${n}`,
      authorId: `author-${n % 3}`,
      currentAssigneeId: n % 2 ? 'agent' : null,
      currentDepartmentId: n % 2 ? 'dept' : null,
      author: null,
      assignee: null,
      department: null,
      ...overrides,
    }) as TicketResponseDto;

  const summaries = (ids: string[]) =>
    of({
      summaries: ids.map((id) => ({
        userId: id,
        fullName: `Name ${id}`,
        isLocked: false,
      })),
    });

  it('**names a 20-ticket page with ONE call of each kind**, in the caller’s tenant', async () => {
    const users = jest.fn((request: { userIds: string[] }) =>
      summaries(request.userIds),
    );
    const departments = jest.fn(() =>
      of({ items: [{ id: 'dept', name: 'Support' }] }),
    );
    const page = Array.from({ length: 20 }, (_, n) => ticket(n));

    await build(users, departments).fillTickets(context, page);

    expect(users).toHaveBeenCalledTimes(1);
    expect(departments).toHaveBeenCalledTimes(1);
    expect(users.mock.calls[0][0]).toMatchObject({
      organizationId: ORG,
      includeInactive: true,
      projection: UserProjection.USER_PROJECTION_SUMMARY,
    });
    expect([...users.mock.calls[0][0].userIds].sort()).toEqual([
      'agent',
      'author-0',
      'author-1',
      'author-2',
    ]);
    expect(page[1]).toMatchObject({
      author: { id: 'author-1', fullName: 'Name author-1', avatarUrl: null },
      assignee: { id: 'agent', fullName: 'Name agent' },
      department: { id: 'dept', name: 'Support' },
    });
    expect(page[0]).toMatchObject({ assignee: null, department: null });
  });

  it('**an id that names nobody stays null**; the rest are named', async () => {
    const users = jest.fn(() => summaries(['author-1']));
    const departments = jest.fn(() => of({ items: [] }));
    const page = [
      ticket(1, { authorId: 'author-1' }),
      ticket(3, { authorId: 'gone' }),
    ];

    await build(users, departments).fillTickets(context, page);

    expect(page[0].author).toMatchObject({ id: 'author-1' });
    expect(page[1].author).toBeNull();
    expect(page[1].department).toBeNull();
  });

  it('**a failed lookup still answers**, with every name null', async () => {
    const down = () =>
      throwError(() =>
        Object.assign(new Error('auth-service is down'), {
          code: status.UNAVAILABLE,
        }),
      );
    const page = [ticket(1)];

    await expect(
      build(jest.fn(down), jest.fn(down)).fillTickets(context, page),
    ).resolves.toBe(page);
    expect(page[0]).toMatchObject({
      author: null,
      assignee: null,
      department: null,
    });
  });

  it('**an AI message has no sender**, and is not looked up', async () => {
    const users = jest.fn((request: { userIds: string[] }) =>
      summaries(request.userIds),
    );
    const messages = [
      { id: 'm-1', senderId: 'person', isAiGenerated: false, sender: null },
      { id: 'm-2', senderId: 'person-ai', isAiGenerated: true, sender: null },
    ] as MessageResponseDto[];

    await build(users, jest.fn()).fillMessages(context, messages);

    expect(users.mock.calls[0][0].userIds).toEqual(['person']);
    expect(messages[0].sender).toMatchObject({ id: 'person' });
    expect(messages[1].sender).toBeNull();
  });

  it('**nothing to name makes no call**', async () => {
    const users = jest.fn();
    const departments = jest.fn();

    await build(users, departments).fillMessages(context, [
      { id: 'm', senderId: null, isAiGenerated: false, sender: null },
    ] as MessageResponseDto[]);

    expect(users).not.toHaveBeenCalled();
    expect(departments).not.toHaveBeenCalled();
  });
});
