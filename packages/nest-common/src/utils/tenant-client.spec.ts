import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { systemContext, type CallerContext } from '@synapsedesk/contracts';
import {
  scopedArgs,
  tenantExtension,
  type TenantRule,
  type TenantRules,
} from './tenant-client';

const ORG = 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb';
const ID = 'cccccccc-0000-4000-8000-cccccccccccc';

const tenant: TenantRule = { kind: 'tenant' };
const through: TenantRule = {
  kind: 'through',
  where: (organizationId) => ({ ticket: { organizationId } }),
};

const member = (overrides: Partial<CallerContext> = {}): CallerContext => ({
  ip: '',
  userAgent: '',
  sub: ID,
  organizationId: ORG,
  isSuperAdmin: false,
  departmentIds: [],
  permissionCodes: [],
  isEmailVerified: true,
  ...overrides,
});

const code = (run: () => unknown): number | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof RpcException) {
      return (error.getError() as { code: number }).code;
    }
    throw error;
  }

  return undefined;
};

describe('scopedArgs', () => {
  describe('a model with an organizationId column', () => {
    it.each([
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
      'updateMany',
      'updateManyAndReturn',
      'deleteMany',
    ])('**%s** gets the tenant under AND', (operation) => {
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          operation,
          { where: { status: 'OPEN' } },
          ORG,
        ),
      ).toEqual({ where: { status: 'OPEN', AND: [{ organizationId: ORG }] } });
    });

    it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete'])(
      '**%s** keeps the unique field at the top, beside the tenant',
      (operation) => {
        expect(
          scopedArgs(
            'Ticket',
            tenant,
            operation,
            { where: { id: ID }, data: {} },
            ORG,
          ),
        ).toEqual({
          where: { id: ID, AND: [{ organizationId: ORG }] },
          data: {},
        });
      },
    );

    it('**a query with no where** gets one', () => {
      expect(scopedArgs('Ticket', tenant, 'findMany', undefined, ORG)).toEqual({
        where: { AND: [{ organizationId: ORG }] },
      });
    });

    it('**an AND the caller wrote** is kept, as an array or a single filter', () => {
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          'findMany',
          { where: { AND: { a: 1 } } },
          ORG,
        ),
      ).toEqual({ where: { AND: [{ a: 1 }, { organizationId: ORG }] } });
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          'findMany',
          { where: { AND: [{ a: 1 }] } },
          ORG,
        ),
      ).toEqual({ where: { AND: [{ a: 1 }, { organizationId: ORG }] } });
    });

    it('**a hand-written organizationId for another tenant** still meets the tenant filter, so nothing matches', () => {
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          'findMany',
          { where: { organizationId: OTHER } },
          ORG,
        ),
      ).toEqual({
        where: { organizationId: OTHER, AND: [{ organizationId: ORG }] },
      });
    });

    it('**create** sets the tenant', () => {
      expect(
        scopedArgs('Ticket', tenant, 'create', { data: { title: 'x' } }, ORG),
      ).toEqual({
        data: { title: 'x', organizationId: ORG },
      });
    });

    it('**create naming the same tenant** is accepted', () => {
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          'create',
          { data: { organizationId: ORG } },
          ORG,
        ),
      ).toEqual({ data: { organizationId: ORG } });
    });

    it('**create naming another tenant throws**, naming both', () => {
      expect(() =>
        scopedArgs(
          'Ticket',
          tenant,
          'create',
          { data: { organizationId: OTHER } },
          ORG,
        ),
      ).toThrow(
        `A Ticket create names tenant "${OTHER}" from a client scoped to ${ORG}`,
      );
    });

    it('**createMany and createManyAndReturn** set every row, and refuse any that names another tenant', () => {
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          'createMany',
          { data: [{ a: 1 }, { a: 2 }] },
          ORG,
        ),
      ).toEqual({
        data: [
          { a: 1, organizationId: ORG },
          { a: 2, organizationId: ORG },
        ],
      });
      expect(
        code(() =>
          scopedArgs(
            'Ticket',
            tenant,
            'createManyAndReturn',
            { data: [{ a: 1 }, { organizationId: OTHER }] },
            ORG,
          ),
        ),
      ).toBe(status.INTERNAL);
    });

    it('**upsert** filters the where and stamps the create', () => {
      expect(
        scopedArgs(
          'Ticket',
          tenant,
          'upsert',
          { where: { id: ID }, create: { title: 'x' }, update: { title: 'y' } },
          ORG,
        ),
      ).toEqual({
        where: { id: ID, AND: [{ organizationId: ORG }] },
        create: { title: 'x', organizationId: ORG },
        update: { title: 'y' },
      });
    });
  });

  it('**tenant or global** reads the tenant’s rows and the shared ones', () => {
    expect(
      scopedArgs(
        'Role',
        { kind: 'tenantOrGlobal' },
        'findFirst',
        { where: { id: ID } },
        ORG,
      ),
    ).toEqual({
      where: {
        id: ID,
        AND: [{ OR: [{ organizationId: ORG }, { organizationId: null }] }],
      },
    });
  });

  it('**tenant or global** writes only the caller’s tenant', () => {
    expect(
      scopedArgs(
        'Role',
        { kind: 'tenantOrGlobal' },
        'create',
        { data: { name: 'x' } },
        ORG,
      ),
    ).toEqual({ data: { name: 'x', organizationId: ORG } });
  });

  it('**the tenant itself** (Organization) is read by id = tenant, and never created', () => {
    expect(
      scopedArgs(
        'Organization',
        { kind: 'self' },
        'findUnique',
        { where: { id: OTHER } },
        ORG,
      ),
    ).toEqual({ where: { id: OTHER, AND: [{ id: ORG }] } });
    expect(
      code(() =>
        scopedArgs(
          'Organization',
          { kind: 'self' },
          'create',
          { data: {} },
          ORG,
        ),
      ),
    ).toBe(status.INTERNAL);
  });

  it('**a child table** is filtered through its parent', () => {
    expect(
      scopedArgs(
        'TicketMessage',
        through,
        'findUnique',
        { where: { id: ID } },
        ORG,
      ),
    ).toEqual({
      where: { id: ID, AND: [{ ticket: { organizationId: ORG } }] },
    });
  });

  it('**a child table’s create** passes as written: its parent was loaded scoped', () => {
    const args = { data: { ticketId: ID, content: 'x' } };

    expect(scopedArgs('TicketMessage', through, 'create', args, ORG)).toBe(
      args,
    );
  });

  it('**a model that isn’t tenant data** passes through', () => {
    const args = { where: { jobName: 'x' } };

    expect(scopedArgs('JobRun', { kind: 'none' }, 'findMany', args, ORG)).toBe(
      args,
    );
  });

  it('**a model with no rule** is refused rather than left unscoped', () => {
    expect(
      code(() => scopedArgs('Ghost', undefined, 'findMany', {}, ORG)),
    ).toBe(status.INTERNAL);
  });

  it('**an operation it doesn’t know** is refused rather than left unscoped', () => {
    expect(
      code(() => scopedArgs('Ticket', tenant, 'findSomehow', {}, ORG)),
    ).toBe(status.INTERNAL);
  });
});

describe('tenantExtension', () => {
  const rules: TenantRules = { Ticket: tenant };
  const run = (context: CallerContext) => {
    const query = jest.fn((args: unknown) => Promise.resolve(args));
    void tenantExtension(rules, context).query.$allModels.$allOperations({
      model: 'Ticket',
      operation: 'findMany',
      args: { where: {} },
      query,
    });

    return query.mock.calls[0][0];
  };

  it('**scopes every model query** for a member', () => {
    expect(run(member())).toEqual({
      where: { AND: [{ organizationId: ORG }] },
    });
  });

  it('**scopes a system caller** to its tenant, like anyone else', () => {
    expect(run(systemContext(ORG))).toEqual({
      where: { AND: [{ organizationId: ORG }] },
    });
  });

  it('**refuses a Super Admin**: a tenant route is not the platform API', () => {
    expect(
      code(() =>
        tenantExtension(
          rules,
          member({ isSuperAdmin: true, organizationId: null }),
        ),
      ),
    ).toBe(status.FAILED_PRECONDITION);
  });

  it('**refuses a system caller with no tenant**: it must use the unscoped client', () => {
    expect(code(() => tenantExtension(rules, systemContext(null)))).toBe(
      status.FAILED_PRECONDITION,
    );
  });

  it('**refuses a caller with no identity**', () => {
    expect(
      code(() =>
        tenantExtension(rules, member({ sub: null, organizationId: null })),
      ),
    ).toBe(status.UNAUTHENTICATED);
  });
});
