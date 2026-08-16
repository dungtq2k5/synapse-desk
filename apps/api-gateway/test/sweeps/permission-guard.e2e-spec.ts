import { of } from 'rxjs';
import { AiModelTier } from '@synapsedesk/grpc-proto';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { PermissionCode } from '@synapsedesk/common';
import { PermissionGuard } from '../../src/common/guards/permission.guard';
import {
  API,
  E2eFixture,
  authenticatedAgent,
  bootstrapE2eTest,
  flushTestRedis,
} from '../utils';
import { timestamp, wirePage, wireUser } from '../fixtures/wire';

/**
 * `PermissionGuard` ANY semantics.
 *
 * The rule is `.some()`, not `.every()`: several codes on one route means
 * "either of these may do this". It was `.every()` once, while the 403 message
 * said "Requires one of" — so a route listing two alternatives silently
 * demanded both and the error explained the opposite of what had happened.
 *
 * Split across two layers on purpose. **Every route in the codebase currently
 * lists exactly ONE code**, so the multi-code rule has no route to be tested
 * through — the e2e half covers the shape that exists, and the unit half covers
 * the rule itself, which is the part that regressed before.
 */
class TestController {} // NOSONAR

describe('PermissionGuard ANY semantics (unit)', () => {
  const buildGuard = () => {
    const reflector = new Reflector();
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test'),
      get: jest.fn().mockReturnValue('test'),
    } as unknown as ConfigService;

    return { guard: new PermissionGuard(reflector, config), reflector };
  };

  /** An ExecutionContext carrying a caller with exactly these permissions. */
  const contextFor = (
    permissionCodes: PermissionCode[],
    overrides: Record<string, unknown> = {},
  ): ExecutionContext => {
    const request = {
      user: {
        sub: 'actor',
        organizationId: 'tenant',
        isSuperAdmin: false,
        departmentIds: [],
        permissionCodes,
        isEmailVerified: true,
        ...overrides,
      },
      ip: '203.0.113.1',
      headers: {},
      // `RequestContextService.fromRequest` reads the user-agent through
      // Express's `req.get()`, so a bare object literal is not enough of a
      // request — the guard fails with `req.get is not a function` long before
      // it reaches the permission check it is under test for.
      get: (header: string) =>
        header.toLowerCase() === 'user-agent' ? 'jest' : undefined,
    };

    return {
      // **`getType` is required now**, and its absence is what this fixture
      // taught: `PermissionGuard` reads the request through `requestOf`, which
      // asks the context which transport it is before unwrapping it (26-doc
      // §1.1). A mock without it returns `undefined`, takes the HTTP branch by
      // accident, and would keep passing while the real guard had already
      // moved on.
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      // A named stand-in for the controller class. The guard only ever passes
      // this to `reflector.getAllAndOverride`, which reads metadata off it and
      // never instantiates it — so it needs an identity, not members.
      getClass: () => TestController,
    } as unknown as ExecutionContext;
  };

  const requiring = (
    reflector: Reflector,
    codes: PermissionCode[] | undefined,
  ) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(codes);
  };

  it('admits a caller holding ONLY the second of two required codes', () => {
    // The regression this whole file exists for.
    const { guard, reflector } = buildGuard();
    requiring(reflector, ['ticket.assign', 'ticket.assign.self']);

    expect(guard.canActivate(contextFor(['ticket.assign.self']))).toBe(true);
  });

  it('admits a caller holding ONLY the first', () => {
    const { guard, reflector } = buildGuard();
    requiring(reflector, ['ticket.assign', 'ticket.assign.self']);

    expect(guard.canActivate(contextFor(['ticket.assign']))).toBe(true);
  });

  it('refuses a caller holding NEITHER', () => {
    const { guard, reflector } = buildGuard();
    requiring(reflector, ['ticket.assign', 'ticket.assign.self']);

    expect(() => guard.canActivate(contextFor(['document.read']))).toThrow(
      ForbiddenException,
    );
  });

  it('a route requiring NOTHING admits everyone — authentication is the gate there', () => {
    const { guard, reflector } = buildGuard();
    requiring(reflector, undefined);

    expect(guard.canActivate(contextFor([]))).toBe(true);
  });

  it('a Super Admin BYPASSES the check entirely', () => {
    // They hold no tenant RBAC rows at all, so a subset check would forbid them
    // everything.
    const { guard, reflector } = buildGuard();
    requiring(reflector, ['organization.update']);

    expect(
      guard.canActivate(
        contextFor([], { isSuperAdmin: true, organizationId: null }),
      ),
    ).toBe(true);
  });

  it('holding EVERY required code is of course fine too', () => {
    const { guard, reflector } = buildGuard();
    requiring(reflector, ['ticket.assign', 'ticket.assign.self']);

    expect(
      guard.canActivate(contextFor(['ticket.assign', 'ticket.assign.self'])),
    ).toBe(true);
  });
});

describe('PermissionGuard on real routes (e2e)', () => {
  let fx: E2eFixture;

  /**
   * One representative route per permission-count shape in use.
   *
   * Only the single-code shape exists today. When a route with two codes is
   * added, it goes here as a second row — and the unit suite above already
   * proves the rule it will rely on.
   */
  const ROUTES: {
    name: string;
    method: 'get' | 'post';
    path: string;
    required: PermissionCode;
    stub: (fx: E2eFixture) => void;
  }[] = [
    {
      name: 'GET /departments',
      method: 'get',
      path: '/departments',
      required: 'department.read',
      stub: (f) =>
        f.stubs.department.listDepartments.mockReturnValue(of(wirePage([]))),
    },
    {
      name: 'GET /roles',
      method: 'get',
      path: '/roles',
      required: 'role.read',
      stub: (f) => f.stubs.role.listRoles.mockReturnValue(of(wirePage([]))),
    },
    {
      name: 'GET /users',
      method: 'get',
      path: '/users',
      required: 'user.read',
      stub: (f) => f.stubs.user.listUsers.mockReturnValue(of(wirePage([]))),
    },
    {
      name: 'GET /organizations/current/usage',
      method: 'get',
      path: '/organizations/current/usage',
      required: 'organization.read',
      stub: (f) =>
        f.stubs.organization.getOrganizationUsage.mockReturnValue(
          of({
            seats: { available: true, used: 1, limit: 10 },
            storage: { available: false, unavailableReason: 'n/a' },
            aiTokens: { available: false, unavailableReason: 'n/a' },
            // Non-optional on the wire: `requireProtoTimestamp` throws on a missing
            // value rather than substituting a date, so omitting it here
            // produces a 500 and the route never reports on its guard.
            billingCycleStart: timestamp(),
            aiModelTier: AiModelTier.AI_MODEL_TIER_FAST,
            planName: 'Free',
          }),
        ),
    },
    {
      name: 'GET /permissions',
      method: 'get',
      path: '/permissions',
      required: 'role.read',
      stub: (f) =>
        f.stubs.role.listPermissions.mockReturnValue(of({ items: [] })),
    },
  ];

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  it('every guarded route ADMITS a caller holding its code', async () => {
    const refused: string[] = [];

    for (const route of ROUTES) {
      route.stub(fx);
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: [route.required],
      })[route.method](`${API}${route.path}`);

      if (res.status === 403)
        refused.push(`${route.name}: 403 despite holding ${route.required}`);
    }

    expect(refused).toEqual([]);
  });

  it('every guarded route REFUSES a caller holding an unrelated code', async () => {
    // An unrelated code rather than none at all: an empty set could be refused
    // by a `length` check that never consults the codes.
    const admitted: string[] = [];

    for (const route of ROUTES) {
      route.stub(fx);
      const res = await authenticatedAgent(fx.app, {
        permissionCodes: ['audit.export'],
      })[route.method](`${API}${route.path}`);

      if (res.status !== 403)
        admitted.push(`${route.name}: ${res.status}, expected 403`);
    }

    expect(admitted).toEqual([]);
  });

  it('every guarded route ADMITS a Super Admin holding no codes at all', async () => {
    const refused: string[] = [];

    for (const route of ROUTES) {
      route.stub(fx);
      const res = await authenticatedAgent(fx.app, {
        isSuperAdmin: true,
        organizationId: null,
        permissionCodes: [],
      })[route.method](`${API}${route.path}`);

      if (res.status === 403)
        refused.push(`${route.name}: 403 for a Super Admin`);
    }

    expect(refused).toEqual([]);
  });

  it('the 403 names what was required OUTSIDE production, and says nothing in it', async () => {
    // The detail is a developer affordance. In production it would tell an
    // attacker which permission to go looking for.
    fx.stubs.department.listDepartments.mockReturnValue(of(wirePage([])));

    const res = await authenticatedAgent(fx.app, {
      permissionCodes: ['audit.export'],
    }).get(`${API}/departments`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Requires one of: department\.read/);
  });

  it('a route with NO permission requirement still needs authentication', async () => {
    // `GET /users/me` carries no @RequirePermission — being signed in is the
    // whole authorization, and that must not decay into "no check at all".
    fx.stubs.user.getCurrentUser.mockReturnValue(
      of({ user: wireUser(), permissionCodes: [], departmentIds: [] }),
    );

    const withSession = await authenticatedAgent(fx.app, {
      permissionCodes: [],
    }).get(`${API}/users/me`);
    expect(withSession.status).toBe(200);
  });
});
