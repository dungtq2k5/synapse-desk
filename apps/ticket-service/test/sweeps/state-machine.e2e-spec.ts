import { RpcException } from '@nestjs/microservices';
import { rpcCode } from '@synapsedesk/common/testing/rpc';
import { status } from '@grpc/grpc-js';
import {
  canTransition,
  TERMINAL_TICKET_STATUSES,
  TicketStatus,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest, memberContext } from '../utils';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { TicketEventPublisher } from '../../src/modules/events/ticket-event.publisher';
import { toProtoTicketStatus } from '../../src/modules/tickets/ticket.mapper';

/**
 * The state-machine sweep — the full 6×6 grid, against a real database.
 *
 * The expectation is DERIVED from `canTransition`, never restated. That is the
 * whole design asks for: one data table which both the unit test (in
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
describe('State machine sweep (e2e)', () => {
  let fx: E2eFixture;
  let tickets: TicketsService;
  let tenant: TenantFixture;

  const ALL = Object.values(TicketStatus);

  const agent = () =>
    memberContext(
      { id: tenant.agentId, organizationId: tenant.organizationId },
      ['ticket.read.all', 'ticket.update', 'ticket.escalate', 'ticket.resolve'],
    );

  /** Every ordered pair, including the self-transitions. */
  const GRID = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

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

  it.each(GRID.map(([from, to]) => [`${from} -> ${to}`, from, to] as const))(
    '%s behaves exactly as canTransition says',
    async (_label, from, to) => {
      const ticket = await createTicket(fx.prisma, tenant, { status: from });

      // TWO rules decide this route's answer, and they are different kinds of
      // rule. `canTransition` is LEGALITY. The terminal refusal is
      // AUTHORIZATION: `RESOLVED` and `CLOSED` require `ticket.resolve`, which
      // this route's `ticket.update` decorator cannot express, so they are
      // reachable only through `/resolve` and `/close`.
      //
      // Encoded separately rather than folded into one expectation, and the
      // CODES are distinguished, because collapsing them is what would let an
      // authorization refusal pass as a state-machine one.
      const terminal = TERMINAL_TICKET_STATUSES.includes(to);
      const legal = canTransition(from, to);
      const expected = terminal
        ? 'refused:authorization'
        : legal // NOSONAR
          ? 'accepted'
          : 'refused:legality';

      const result = await tickets
        .changeTicketStatus(
          { id: ticket.id, status: toProtoTicketStatus(to), reason: '' },
          agent(),
        )
        .then(() => 'accepted' as const)
        .catch((error: unknown) => {
          if (rpcCode(error) === status.ABORTED) return 'refused:legality';
          if (rpcCode(error) === status.FAILED_PRECONDITION) {
            return 'refused:authorization';
          }
          return `unexpected:${String(rpcCode(error))}`;
        });

      // Asserted as a TUPLE so a failure names the pair rather than just
      // reporting `true !== false` from somewhere in a 36-case loop.
      expect([`${from} -> ${to}`, result]).toEqual([
        `${from} -> ${to}`,
        expected,
      ]);

      // And the row agrees with the answer — an "accepted" that did not write,
      // or a "rejected" that did, would both pass the check above.
      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect([`${from} -> ${to}`, row.status]).toEqual([
        `${from} -> ${to}`,
        result === 'accepted' ? to : from,
      ]);
    },
  );

  describe('the convenience routes obey the SAME table', () => {
    // Five routes, one validator: each convenience route's answer must equal
    // `canTransition`, or the table has stopped being the single definition of
    // legality.
    //
    // Compared against `canTransition` DIRECTLY rather than against the generic
    // route, which is the shape this used to have. The generic route now
    // refuses `RESOLVED` and `CLOSED` on authorization grounds, so two of these
    // four have no generic counterpart to be compared with — and comparing them
    // anyway would assert that `/resolve` is broken.
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
    )('%s matches canTransition', async (_label, from, route, to) => {
      const viaRoute = await createTicket(fx.prisma, tenant, {
        status: from,
      });

      const attempt = (promise: Promise<unknown>) =>
        promise
          .then(() => 'accepted' as const)
          .catch((error: unknown) => `rejected:${String(rpcCode(error))}`);

      const routeResult = await attempt(
        route === 'escalate'
          ? tickets.escalateTicket({ ticketId: viaRoute.id }, agent())
          : route === 'resolve' // NOSONAR
            ? tickets.resolveTicket({ ticketId: viaRoute.id }, agent())
            : route === 'reopen' // NOSONAR
              ? tickets.reopenTicket({ ticketId: viaRoute.id }, agent())
              : tickets.closeTicket({ ticketId: viaRoute.id }, agent()),
      );

      expect([route, routeResult]).toEqual([
        route,
        canTransition(from, to)
          ? 'accepted'
          : `rejected:${String(status.ABORTED)}`,
      ]);
    });
  });

  describe('the side effects the table implies', () => {
    it('1. RESOLVED stamps resolvedAt', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.resolveTicket({ ticketId: ticket.id }, agent());

      const row = await fx.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(row.resolvedAt).not.toBeNull();
    });

    it('2. ESCALATED stamps escalatedAt', async () => {
      const ticket = await createTicket(fx.prisma, tenant, {
        status: TicketStatus.OPEN,
      });

      await tickets.escalateTicket({ ticketId: ticket.id }, agent());

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
      await tickets.escalateTicket({ ticketId: ticket.id }, agent());
      await tickets.resolveTicket({ ticketId: ticket.id }, agent());

      await tickets.reopenTicket({ ticketId: ticket.id }, agent());

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

      const reopened = await tickets.reopenTicket(
        { ticketId: ticket.id },
        agent(),
      );

      expect([terminal, reopened.status]).toEqual([
        terminal,
        toProtoTicketStatus(TicketStatus.OPEN),
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
      .closeTicket({ ticketId: ticket.id }, agent())
      .then(() => {
        throw new Error('an unknown status must not permit a transition');
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(RpcException);
      });
  });
});
