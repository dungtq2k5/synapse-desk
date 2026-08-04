import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  canTransition,
  TERMINAL_TICKET_STATUSES,
  TicketStatus,
} from '@synapsedesk/common';
import { bootstrapE2eTest, E2eFixture } from '../utils/bootstrap';
import { memberContext } from '../utils/context';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';
import { toProtoStatus } from '../../src/modules/tickets/ticket.mapper';

function rpcCode(error: unknown): number | undefined {
  if (!(error instanceof RpcException)) return undefined;
  return (error.getError() as { code?: number }).code;
}

/**
 * §3.3 The state-machine sweep — the full 6×6 grid, against a real database.
 *
 * The expectation is DERIVED from `canTransition`, never restated. That is the
 * whole design §3.3 asks for: one data table which both the unit test (in
 * `libs/common`, where the table lives) and this test import, so the two can
 * never disagree about what "legal" means. A hand-written list of legal pairs
 * here would be a second source of truth, and the first edit to the table would
 * make one of them wrong without failing anything.
 *
 * What this adds over the unit test is that the rule survives the round trip:
 * the status is a VarChar column, the RPC takes a numeric enum, and the mapping
 * between them is where a "legal" transition could quietly become a different
 * one.
 */
describe('§3.3 state machine sweep (e2e)', () => {
  let fx: E2eFixture;
  let tickets: TicketsService;
  let tenant: TenantFixture;

  const ALL = Object.values(TicketStatus);

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    tickets = fx.moduleRef.get(TicketsService);
    jest
      .spyOn(fx.moduleRef.get(TicketEventPublisher), 'publish')
      .mockImplementation(() => {});
  });

  beforeEach(async () => {
    await fx.reset();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  const agent = () =>
    memberContext(
      { id: tenant.agentId, organizationId: tenant.organizationId },
      ['ticket.read.all', 'ticket.update', 'ticket.escalate', 'ticket.resolve'],
    );

  /** Every ordered pair, including the self-transitions. */
  const GRID = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

  it.each(GRID.map(([from, to]) => [`${from} -> ${to}`, from, to] as const))(
    '%s behaves exactly as canTransition says',
    async (_label, from, to) => {
      const ticket = await createTicket(fx.prisma, tenant, { status: from });
      const legal = canTransition(from, to);

      const result = await tickets
        .changeTicketStatus(
          { id: ticket.id, status: toProtoStatus(to), reason: '' },
          agent(),
        )
        .then(() => 'accepted' as const)
        .catch((error: unknown) =>
          rpcCode(error) === status.ABORTED
            ? ('rejected' as const)
            : (`unexpected:${String(rpcCode(error))}` as const),
        );

      // Asserted as a TUPLE so a failure names the pair rather than just
      // reporting `true !== false` from somewhere in a 36-case loop.
      expect([`${from} -> ${to}`, result]).toEqual([
        `${from} -> ${to}`,
        legal ? 'accepted' : 'rejected',
      ]);

      // And the row agrees with the answer — an "accepted" that did not write,
      // or a "rejected" that did, would both pass the check above.
      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect([`${from} -> ${to}`, row.status]).toEqual([
        `${from} -> ${to}`,
        legal ? to : from,
      ]);
    },
  );

  describe('the convenience routes obey the SAME table', () => {
    // Five routes, one validator. `POST /tickets/:id/resolve` and
    // `POST /tickets/:id/status {RESOLVED}` must not be able to answer
    // differently — if they can, the table has stopped being the single
    // definition of legality.
    const ROUTES = [
      ['escalate', TicketStatus.ESCALATED],
      ['resolve', TicketStatus.RESOLVED],
      ['reopen', TicketStatus.OPEN],
      ['close', TicketStatus.CLOSED],
    ] as const;

    it.each(
      ALL.flatMap((from) =>
        ROUTES.map(
          ([route, to]) => [`${route} from ${from}`, from, route, to] as const,
        ),
      ),
    )(
      '%s matches the generic status change',
      async (_label, from, route, to) => {
        const viaRoute = await createTicket(fx.prisma, tenant, {
          status: from,
        });
        const viaGeneric = await createTicket(fx.prisma, tenant, {
          status: from,
        });

        const attempt = (promise: Promise<unknown>) =>
          promise
            .then(() => 'accepted' as const)
            .catch((error: unknown) => `rejected:${String(rpcCode(error))}`);

        const routeResult = await attempt(
          route === 'escalate'
            ? tickets.escalateTicket({ id: viaRoute.id }, agent())
            : route === 'resolve'
              ? tickets.resolveTicket({ id: viaRoute.id }, agent())
              : route === 'reopen'
                ? tickets.reopenTicket({ id: viaRoute.id }, agent())
                : tickets.closeTicket({ id: viaRoute.id }, agent()),
        );

        const genericResult = await attempt(
          tickets.changeTicketStatus(
            { id: viaGeneric.id, status: toProtoStatus(to), reason: '' },
            agent(),
          ),
        );

        expect([route, routeResult]).toEqual([route, genericResult]);
      },
    );
  });

  describe('the side effects the table implies', () => {
    it('1. RESOLVED stamps resolvedAt', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.resolveTicket({ id: ticket.id }, agent());

      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(row.resolvedAt).not.toBeNull();
    });

    it('2. ESCALATED stamps escalatedAt', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.escalateTicket({ id: ticket.id }, agent());

      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(row.escalatedAt).not.toBeNull();
    });

    it('3. reopening CLEARS resolvedAt but KEEPS escalatedAt', async () => {
      // The asymmetry is the point. `resolved_at` describes the CURRENT state
      // and would be a lie on a reopened ticket; `escalated_at` records that an
      // escalation happened, which reopening does not undo — and an escalation
      // review that lost that fact would under-count.
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });
      await tickets.escalateTicket({ id: ticket.id }, agent());
      await tickets.resolveTicket({ id: ticket.id }, agent());

      await tickets.reopenTicket({ id: ticket.id }, agent());

      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(row.resolvedAt).toBeNull();
      expect(row.escalatedAt).not.toBeNull();
    });
  });

  it('every TERMINAL status can still be reopened from the real database', async () => {
    // "Terminal" means work finished, not immutable — a customer replying to a
    // resolved ticket must reopen it, or every follow-up becomes a new ticket
    // with no history.
    for (const terminal of TERMINAL_TICKET_STATUSES) {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: terminal,
      });

      const reopened = await tickets.reopenTicket({ id: ticket.id }, agent());

      expect([terminal, reopened.status]).toEqual([
        terminal,
        toProtoStatus(TicketStatus.OPEN),
      ]);
    }
  });

  it('an UNKNOWN stored status is rejected, not treated as permissive', async () => {
    // `tickets.status` is a VarChar, so a migration or a psql session can put a
    // value there the table knows nothing about. Looking it up must refuse
    // every transition rather than allowing all of them.
    const ticket = await createTicket(fx.prisma, tenant);
    await fx.prisma.$executeRawUnsafe(
      `UPDATE "tickets" SET "status" = 'NONSENSE' WHERE "id" = $1::uuid`,
      ticket.id,
    );

    await tickets
      .closeTicket({ id: ticket.id }, agent())
      .then(() => {
        throw new Error('an unknown status must not permit a transition');
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(RpcException);
      });
  });
});
