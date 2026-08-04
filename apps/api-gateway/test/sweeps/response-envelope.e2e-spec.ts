import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import type { PermissionCode } from '@synapsedesk/common';
import {
  bootstrapE2eTest,
  E2eFixture,
  flushTestRedis,
} from '../utils/bootstrap';
import { anonymousAgent, API, authenticatedAgent } from '../utils/auth';
import { grpcError, timestamp, wirePage, wireUser } from '../fixtures/wire';

/**
 * the response envelope sweep.
 *
 * `success` is the ONE field a client branches on, which only works if it is
 * present on every response from every controller. A route that returns a bare
 * body — because it used `@Res()` and bypassed the interceptor, say — breaks
 * that contract for one endpoint, and the client that trusted it fails on a
 * shape it has never seen.
 *
 * Parametrized over one representative success and one guaranteed failure per
 * controller, so a new controller is one row rather than a new file.
 */
/** A fixed uuid for the routes that need one in the path. */
const SWEEP_TICKET_ID = '11111111-1111-4111-8111-111111111111';

type Probe = {
  controller: string;
  path: string;
  /** Permissions the caller needs; `null` means "call it anonymously". */
  as: PermissionCode[] | null;
  /** Makes the stubbed peer succeed. */
  succeed: (fx: E2eFixture) => void;
  /** Makes the stubbed peer fail with a mapped gRPC status. */
  fail: (fx: E2eFixture) => void;
  expectedFailureStatus: number;
};

const PROBES: Probe[] = [
  {
    controller: 'DepartmentsController',
    path: '/departments',
    as: ['department.read'],
    succeed: (f) =>
      f.stubs.department.listDepartments.mockReturnValue(of(wirePage([]))),
    fail: (f) =>
      f.stubs.department.listDepartments.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'nope')),
      ),
    expectedFailureStatus: 404,
  },
  {
    controller: 'RolesController',
    path: '/roles',
    as: ['role.read'],
    succeed: (f) => f.stubs.role.listRoles.mockReturnValue(of(wirePage([]))),
    fail: (f) =>
      f.stubs.role.listRoles.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.ABORTED, 'conflict')),
      ),
    expectedFailureStatus: 409,
  },
  {
    controller: 'PermissionsController',
    path: '/permissions',
    as: ['role.read'],
    succeed: (f) =>
      f.stubs.role.listPermissions.mockReturnValue(of({ items: [] })),
    fail: (f) =>
      f.stubs.role.listPermissions.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.INTERNAL, 'boom')),
      ),
    expectedFailureStatus: 500,
  },
  {
    controller: 'UserAdminController',
    path: '/users',
    as: ['user.read'],
    succeed: (f) => f.stubs.user.listUsers.mockReturnValue(of(wirePage([]))),
    fail: (f) =>
      f.stubs.user.listUsers.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.PERMISSION_DENIED, 'no')),
      ),
    expectedFailureStatus: 403,
  },
  {
    controller: 'UsersController',
    path: '/users/me',
    as: [],
    succeed: (f) =>
      f.stubs.user.getCurrentUser.mockReturnValue(
        of({ user: wireUser(), permissionCodes: [], departmentIds: [] }),
      ),
    fail: (f) =>
      f.stubs.user.getCurrentUser.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'gone')),
      ),
    expectedFailureStatus: 404,
  },
  {
    controller: 'OrganizationsController',
    path: '/organizations/current/usage',
    as: ['organization.read'],
    succeed: (f) =>
      f.stubs.organization.getOrganizationUsage.mockReturnValue(
        of({
          seats: { available: true, used: 1, limit: 10 },
          storage: { available: false, unavailableReason: 'n/a' },
          aiTokens: { available: false, unavailableReason: 'n/a' },
          billingCycleStart: timestamp(),
        }),
      ),
    fail: (f) =>
      f.stubs.organization.getOrganizationUsage.mockReturnValue(
        throwError(() =>
          grpcError(GrpcStatus.FAILED_PRECONDITION, 'not a tenant'),
        ),
      ),
    expectedFailureStatus: 400,
  },
  {
    controller: 'SessionsController',
    path: '/auth/sessions',
    as: [],
    succeed: (f) =>
      f.stubs.session.listSessions.mockReturnValue(of({ items: [] })),
    fail: (f) =>
      f.stubs.session.listSessions.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAUTHENTICATED, 'nope')),
      ),
    expectedFailureStatus: 401,
  },
  {
    controller: 'InvitationsController',
    path: '/users/invitations',
    as: ['user.read'],
    succeed: (f) =>
      f.stubs.invitation.listInvitations.mockReturnValue(of(wirePage([]))),
    fail: (f) =>
      f.stubs.invitation.listInvitations.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'gone')),
      ),
    expectedFailureStatus: 404,
  },
  {
    controller: 'PlatformController',
    path: '/platform/metrics',
    as: null,
    succeed: (f) =>
      f.stubs.platform.getMetrics.mockReturnValue(
        of({
          totalOrganizations: 0,
          organizationsByStatus: {},
          totalUsers: 0,
          activeUsers: 0,
          pendingInvitations: 0,
          liveSessions: 0,
          seatsAllocated: 0,
          seatsInUse: 0,
          generatedAt: timestamp(),
        }),
      ),
    fail: (f) =>
      f.stubs.platform.getMetrics.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.INTERNAL, 'boom')),
      ),
    expectedFailureStatus: 500,
  },

  // ---------------------------------------------------------------------
  // Domain B. Rows, not a second sweep file — §3.5 says to reuse this
  // harness, and a parallel one would be a second definition of "the
  // envelope" that could drift from this one.
  // ---------------------------------------------------------------------
  {
    controller: 'TicketsController',
    path: '/tickets',
    as: [],
    succeed: (f) =>
      f.stubs.ticket.listTickets.mockReturnValue(of(wirePage([]))),
    fail: (f) =>
      f.stubs.ticket.listTickets.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'gone')),
      ),
    expectedFailureStatus: 404,
  },
  {
    controller: 'MessagesController',
    path: `/tickets/${SWEEP_TICKET_ID}/messages`,
    as: [],
    succeed: (f) =>
      f.stubs.message.listMessages.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      ),
    fail: (f) =>
      f.stubs.message.listMessages.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'gone')),
      ),
    expectedFailureStatus: 404,
  },
  {
    controller: 'TicketsController (assignments)',
    path: `/tickets/${SWEEP_TICKET_ID}/assignments`,
    as: [],
    succeed: (f) =>
      f.stubs.assignment.listAssignments.mockReturnValue(of({ items: [] })),
    fail: (f) =>
      f.stubs.assignment.listAssignments.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.NOT_FOUND, 'gone')),
      ),
    expectedFailureStatus: 404,
  },
  {
    controller: 'AiController',
    path: `/tickets/${SWEEP_TICKET_ID}/ai/summary`,
    as: ['ticket.read.all'],
    succeed: (f) =>
      f.stubs.ai.getSummary.mockReturnValue(
        of({
          id: SWEEP_TICKET_ID,
          ticketId: SWEEP_TICKET_ID,
          summaryText: 's',
          suggestedAction: 'a',
          confidenceScore: 0.5,
          modelName: 'm',
          createdAt: timestamp(),
          updatedAt: timestamp(),
        }),
      ),
    fail: (f) =>
      f.stubs.ai.getSummary.mockReturnValue(
        // The 503 every AI route answers today. It has to carry the envelope
        // too — a client parsing `success` must not hit a bare body on the one
        // status it will actually see in production right now.
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'not yet')),
      ),
    expectedFailureStatus: 503,
  },
  {
    controller: 'ChatController',
    path: '/chat/conversations',
    as: [],
    succeed: (f) =>
      f.stubs.ticket.listTickets.mockReturnValue(of(wirePage([]))),
    fail: (f) =>
      f.stubs.ticket.listTickets.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.ABORTED, 'conflict')),
      ),
    expectedFailureStatus: 409,
  },
  {
    controller: 'FeedbackController',
    path: '/feedback',
    as: ['analytics.read'],
    succeed: (f) =>
      f.stubs.feedback.listFeedback.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      ),
    fail: (f) =>
      f.stubs.feedback.listFeedback.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.INTERNAL, 'boom')),
      ),
    expectedFailureStatus: 500,
  },
  {
    controller: 'AuditLogsController',
    path: '/audit-logs',
    as: ['audit.read'],
    succeed: (f) =>
      f.stubs.audit.listAuditLogs.mockReturnValue(
        of({ items: [], meta: wirePage([]).meta }),
      ),
    fail: (f) =>
      f.stubs.audit.listAuditLogs.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.PERMISSION_DENIED, 'no')),
      ),
    expectedFailureStatus: 403,
  },
  {
    controller: 'AttachmentsController',
    path: `/attachments/${SWEEP_TICKET_ID}/download`,
    as: [],
    succeed: (f) =>
      f.stubs.message.downloadAttachment.mockReturnValue(
        of({ downloadUrl: 'https://example/x', expiresAt: timestamp() }),
      ),
    fail: (f) =>
      f.stubs.message.downloadAttachment.mockReturnValue(
        throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'not yet')),
      ),
    expectedFailureStatus: 503,
  },
];

describe('response envelope sweep (e2e)', () => {
  let fx: E2eFixture;

  beforeAll(async () => {
    await flushTestRedis();
    fx = await bootstrapE2eTest();
  });

  beforeEach(async () => {
    await flushTestRedis();
    jest.clearAllMocks();
  });

  afterAll(() => fx.close());

  /** Platform routes need a Super Admin; everything else needs its codes. */
  function agentFor(probe: Probe) {
    return probe.as === null
      ? authenticatedAgent(fx.app, {
          isSuperAdmin: true,
          organizationId: null,
        })
      : authenticatedAgent(fx.app, { permissionCodes: probe.as });
  }

  it('every 2xx carries { success: true, statusCode, message, data }', async () => {
    const wrong: string[] = [];

    for (const probe of PROBES) {
      probe.succeed(fx);
      const res = await agentFor(probe).get(`${API}${probe.path}`);

      if (res.status >= 300) {
        wrong.push(`${probe.controller}: ${res.status} — expected a success`);
        continue;
      }
      if (res.body?.success !== true) {
        wrong.push(`${probe.controller}: success !== true`);
      }
      if (res.body?.statusCode !== res.status) {
        wrong.push(
          `${probe.controller}: body.statusCode ${res.body?.statusCode} != HTTP ${res.status}`,
        );
      }
      if (typeof res.body?.message !== 'string') {
        wrong.push(`${probe.controller}: no message`);
      }
      if (!('data' in (res.body ?? {}))) {
        wrong.push(`${probe.controller}: no data key`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('every 4xx/5xx carries { success: false, statusCode, path, timestamp, error }', async () => {
    const wrong: string[] = [];

    for (const probe of PROBES) {
      probe.fail(fx);
      const res = await agentFor(probe).get(`${API}${probe.path}`);

      if (res.status !== probe.expectedFailureStatus) {
        wrong.push(
          `${probe.controller}: ${res.status}, expected ${probe.expectedFailureStatus}`,
        );
      }
      if (res.body?.success !== false) {
        wrong.push(`${probe.controller}: success !== false`);
      }
      for (const key of ['statusCode', 'path', 'timestamp', 'error']) {
        if (!(key in (res.body ?? {}))) {
          wrong.push(`${probe.controller}: missing ${key}`);
        }
      }
      // A failure envelope must never also carry data — a client branching on
      // `success` would then find both shapes true at once.
      if ('data' in (res.body ?? {})) {
        wrong.push(`${probe.controller}: failure envelope carries data`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('the failure `path` is the URL that failed, not a generic one', async () => {
    // It is the field that makes a client-side error report actionable.
    PROBES[0].fail(fx);
    const res = await agentFor(PROBES[0]).get(`${API}${PROBES[0].path}`);

    expect(res.body.path).toContain(PROBES[0].path);
  });

  it('the failure `timestamp` is a parseable ISO instant', async () => {
    PROBES[0].fail(fx);
    const res = await agentFor(PROBES[0]).get(`${API}${PROBES[0].path}`);

    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('a 401 from the GUARD is enveloped identically to one from the peer', async () => {
    // The filter is terminal for both, and a client must not need to know which
    // layer refused it.
    const guard = await anonymousAgent(fx.app).get(`${API}/departments`);

    expect(guard.status).toBe(401);
    expect(guard.body).toMatchObject({
      success: false,
      statusCode: 401,
      path: expect.any(String),
      timestamp: expect.any(String),
      error: expect.any(String),
    });
  });

  it('a 404 for an UNKNOWN route is enveloped too', async () => {
    // Nest's own NotFoundException goes through the same filter, so even a
    // typo'd URL answers in the shape the client parses.
    const res = await anonymousAgent(fx.app).get(`${API}/no-such-route`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('a 400 from ValidationPipe is enveloped too', async () => {
    const res = await anonymousAgent(fx.app)
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, statusCode: 400 });
  });
});
