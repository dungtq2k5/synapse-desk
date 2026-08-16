import {
  SCHEDULED_JOBS,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { buildTenant, createTicket, TenantFixture } from '../factories';
import { TicketRollupJob } from '../../src/modules/analytics/ticket-rollup.job';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { SchedulerProcessor } from '../../src/modules/scheduler/scheduler.processor';
import { AuthReferenceService } from '../../src/modules/auth-client/auth-reference.service';

/**
 * The daily rollup.
 *
 * **The rollups are the actual work.** The endpoints are thin; what decides
 * whether this feature is usable in month six is whether a dashboard load runs
 * a multi-month aggregation against the tables serving the hot path.
 *
 * Two properties here cannot be recovered after the fact and so are worth more
 * than the rest: **idempotency**, without which a rollup bug can never be
 * corrected, and **tenant-timezone bucketing**, which a UTC-only fixture passes
 * against an implementation that never converts.
 */
describe('§2.2 The ticket rollup (e2e)', () => {
  let fx: E2eFixture;
  let rollup: TicketRollupJob;
  let analytics: AnalyticsService;
  let scheduler: SchedulerProcessor;
  let listOrganizationTimezones: jest.SpyInstance;

  let tenant: TenantFixture;

  /** A tenant seven hours ahead of UTC — the bucketing case that fails silently. */
  const SAIGON = 'Asia/Ho_Chi_Minh';

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    rollup = fx.moduleRef.get(TicketRollupJob);
    analytics = fx.moduleRef.get(AnalyticsService);
    scheduler = fx.moduleRef.get(SchedulerProcessor);

    // auth-service is not running for this suite, and the tenant's TIMEZONE is
    // the one variable half these tests exist to vary.
    listOrganizationTimezones = jest.spyOn(
      fx.moduleRef.get(AuthReferenceService),
      'listOrganizationTimezones',
    );
  });

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();

    tenant = buildTenant();
    // UTC unless a test says otherwise — an empty map means "nobody set one".
    listOrganizationTimezones.mockResolvedValue(new Map());
  });

  afterAll(() => fx.close());

  const at = (iso: string) => new Date(iso);

  /** Relative to NOW — §6 test 7 must land inside the trailing window. */
  const hoursAgo = (hours: number) =>
    new Date(Date.now() - hours * 60 * 60 * 1000);

  const isoDay = (date: Date) => date.toISOString().slice(0, 10);

  /** Runs the rollup over a window wide enough to cover the fixtures. */
  const runOver = (from: string, to: string) =>
    rollup.backfill(at(`${from}T00:00:00.000Z`), at(`${to}T00:00:00.000Z`));

  const statsFor = (day: string) =>
    fx.prisma.ticketDailyStat.findMany({
      where: { day: at(`${day}T00:00:00.000Z`) },
    });

  describe('idempotency — the property that makes backfill possible', () => {
    it('1. Re-running the same day produces the same rows, not doubled ones', async () => {
      // **A job that cannot be safely re-run cannot be fixed after a bug**: the
      // numbers stay wrong forever because the correction only applies going
      // forward. Every other test here depends on this one holding.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-10T09:00:00.000Z'),
      });
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-10T11:00:00.000Z'),
      });

      await runOver('2026-03-10', '2026-03-10');
      const first = await statsFor('2026-03-10');

      await runOver('2026-03-10', '2026-03-10');
      const second = await statsFor('2026-03-10');

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(second[0].ticketsCreated).toBe(2);
      expect(first[0].ticketsCreated).toBe(second[0].ticketsCreated);
    });

    it('2. A 30-day backfill matches day-by-day runs', async () => {
      // The recovery path, proven before it is needed.
      for (let day = 1; day <= 5; day += 1) {
        await createTicket(fx.prisma, tenant, {
          createdAt: at(`2026-03-0${day}T09:00:00.000Z`),
        });
      }

      // Day by day…
      for (let day = 1; day <= 5; day += 1) {
        await runOver(`2026-03-0${day}`, `2026-03-0${day}`);
      }
      const perDay = await fx.prisma.ticketDailyStat.findMany({
        orderBy: { day: 'asc' },
      });

      // …then all at once, over a window covering everything.
      await runOver('2026-02-20', '2026-03-20');
      const backfilled = await fx.prisma.ticketDailyStat.findMany({
        orderBy: { day: 'asc' },
      });

      expect(perDay).toHaveLength(5);
      expect(backfilled).toHaveLength(5);
      expect(backfilled.map((row) => row.ticketsCreated)).toEqual(
        perDay.map((row) => row.ticketsCreated),
      );
      expect(backfilled.map((row) => row.day.toISOString())).toEqual(
        perDay.map((row) => row.day.toISOString()),
      );
    });

    it('3. A tenant with NO activity produces NO rows', async () => {
      // **Absent ≠ broken.** The endpoints read a missing row as zero, and
      // writing a zero row per tenant per day would make this the largest table
      // in the system, holding nothing. A dashboard that 500s for a quiet
      // tenant is the first thing a new customer sees.
      const outcome = await runOver('2026-03-01', '2026-03-31');

      expect(outcome.tenants).toBe(0);
      await expect(fx.prisma.ticketDailyStat.count()).resolves.toBe(0);
    });
  });

  describe('tenant-timezone bucketing', () => {
    it('4. A 23:30-local ticket lands on the LOCAL day, not the UTC one', async () => {
      // 2026-03-09 16:30 UTC is 23:30 on the 9th in Saigon (UTC+7) — the same
      // instant, two different Mondays. UTC bucketing puts it on the wrong day
      // and every daily figure for this tenant is one day out.
      listOrganizationTimezones.mockResolvedValue(
        new Map([[tenant.organizationId, SAIGON]]),
      );
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-09T16:30:00.000Z'),
      });

      await runOver('2026-03-08', '2026-03-11');

      const rows = await fx.prisma.ticketDailyStat.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].day.toISOString().slice(0, 10)).toBe('2026-03-09');
    });

    it('5. The SAME instant buckets differently for a UTC tenant', async () => {
      // The control. Without it, test 4 passes against an implementation that
      // ignores the timezone and happens to agree — 16:30 UTC is the 9th in
      // both zones, so the pair is chosen at 17:00+, where they disagree.
      listOrganizationTimezones.mockResolvedValue(
        new Map([[tenant.organizationId, SAIGON]]),
      );
      const utcTenant = buildTenant();

      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-09T18:00:00.000Z'),
      });
      await createTicket(fx.prisma, utcTenant, {
        createdAt: at('2026-03-09T18:00:00.000Z'),
      });

      await runOver('2026-03-08', '2026-03-11');

      const saigon = await fx.prisma.ticketDailyStat.findMany({
        where: { organizationId: tenant.organizationId },
      });
      const utc = await fx.prisma.ticketDailyStat.findMany({
        where: { organizationId: utcTenant.organizationId },
      });

      // 18:00 UTC on the 9th is 01:00 on the TENTH in Saigon.
      expect(saigon[0].day.toISOString().slice(0, 10)).toBe('2026-03-10');
      expect(utc[0].day.toISOString().slice(0, 10)).toBe('2026-03-09');
    });

    it('6. An INVALID timezone falls back to UTC rather than failing the run', async () => {
      // One tenant with a typo'd zone must not cost every other tenant their
      // numbers: an unknown zone in `AT TIME ZONE` is a runtime error that
      // aborts the statement.
      listOrganizationTimezones.mockResolvedValue(
        new Map([[tenant.organizationId, 'Mars/Olympus']]),
      );
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-09T18:00:00.000Z'),
      });

      await runOver('2026-03-08', '2026-03-11');

      const rows = await fx.prisma.ticketDailyStat.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].day.toISOString().slice(0, 10)).toBe('2026-03-09');
    });

    it('7. A DST boundary produces neither a 23- nor a 25-hour day', async () => {
      // The bug that yields one impossible Tuesday every March. It comes for
      // free because `day` is a DATE — there are no hours in it to be wrong
      // about — and the hour arithmetic happened once, in Postgres, which owns
      // the rules. Asserted anyway, because "it cannot happen" is exactly what
      // is said before it does.
      listOrganizationTimezones.mockResolvedValue(
        new Map([[tenant.organizationId, 'Europe/London']]),
      );

      // BST began 2026-03-29 in the UK: one ticket a day across the boundary.
      for (const day of ['27', '28', '29', '30']) {
        await createTicket(fx.prisma, tenant, {
          createdAt: at(`2026-03-${day}T12:00:00.000Z`),
        });
      }

      await runOver('2026-03-26', '2026-03-31');

      const rows = await fx.prisma.ticketDailyStat.findMany({
        orderBy: { day: 'asc' },
      });

      expect(rows.map((row) => row.day.toISOString().slice(0, 10))).toEqual([
        '2026-03-27',
        '2026-03-28',
        '2026-03-29',
        '2026-03-30',
      ]);
      expect(rows.every((row) => row.ticketsCreated === 1)).toBe(true);
    });
  });

  describe('the counters', () => {
    it('8. Counts created, resolved and escalated on their OWN days', async () => {
      // Each counter is bucketed on the day the thing it counts HAPPENED. A
      // ticket created Monday and resolved Wednesday is one creation on Monday
      // and one resolution on Wednesday — not two events on one day.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-04T09:00:00.000Z'),
        status: TicketStatus.RESOLVED,
        escalatedAt: at('2026-03-03T09:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-06');

      const [monday] = await statsFor('2026-03-02');
      const [tuesday] = await statsFor('2026-03-03');
      const [wednesday] = await statsFor('2026-03-04');

      expect(monday.ticketsCreated).toBe(1);
      expect(monday.ticketsResolved).toBe(0);
      expect(tuesday.ticketsEscalated).toBe(1);
      expect(wednesday.ticketsResolved).toBe(1);
      // 48 hours, stored as a SUM with its count beside it.
      expect(wednesday.resolutionSecondsSum).toBe(48 * 3600);
      expect(wednesday.resolutionCount).toBe(1);
    });

    it('9. Stores SUMS and COUNTS — no averaged column exists', async () => {
      // **The mistake that cannot be corrected later.** An average of daily
      // averages weights a Tuesday with 3 tickets equally with a Monday with
      // 300, and once the inputs are gone the real number is unrecoverable.
      const columns = await fx.prisma.$queryRawUnsafe<
        { column_name: string }[]
      >(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'ticket_daily_stats'`,
      );
      const names = columns.map((column) => column.column_name);

      expect(names).toEqual(
        expect.arrayContaining([
          'resolution_seconds_sum',
          'resolution_count',
          'first_response_seconds_sum',
          'first_response_count',
        ]),
      );
      // Nothing named like an average, a mean or a rate.
      expect(
        names.filter((name) => /_avg$|^avg_|_average|_mean|_rate$/.test(name)),
      ).toEqual([]);
    });

    it('10. Deflection counts CHAT conversations only, as a cohort', async () => {
      // **Not `1 − tickets/conversations`**: agent-created and email tickets
      // never had a chance to be deflected, so counting them makes the number
      // move when the AI did nothing differently.
      await createTicket(fx.prisma, tenant, {
        source: TicketSource.CHAT,
        status: TicketStatus.RESOLVED,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-02T09:05:00.000Z'),
      });
      await createTicket(fx.prisma, tenant, {
        source: TicketSource.CHAT,
        status: TicketStatus.ESCALATED,
        escalatedAt: at('2026-03-02T10:00:00.000Z'),
        createdAt: at('2026-03-02T09:30:00.000Z'),
      });
      // An EMAIL ticket, which is not a conversation at all.
      await createTicket(fx.prisma, tenant, {
        source: TicketSource.EMAIL,
        createdAt: at('2026-03-02T09:40:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');

      const [day] = await statsFor('2026-03-02');
      expect(day.chatConversations).toBe(2);
      expect(day.chatResolvedWithoutEscalation).toBe(1);
      expect(day.ticketsCreated).toBe(3);
    });

    it('11. A chat picked up by a HUMAN is not deflected', async () => {
      // Escalation is not the only way a conversation reaches a person: a
      // ticket quietly assigned to an agent was not deflected either, and
      // counting it would inflate the product's headline claim.
      await createTicket(fx.prisma, tenant, {
        source: TicketSource.CHAT,
        status: TicketStatus.RESOLVED,
        currentAssigneeId: tenant.agentId,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-02T10:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');

      const [day] = await statsFor('2026-03-02');
      expect(day.chatConversations).toBe(1);
      expect(day.chatResolvedWithoutEscalation).toBe(0);
    });

    it('12. First response ignores the AUTHOR’s own follow-up', async () => {
      // "First message" would read as a suspiciously fast team: the author's
      // own second message is not a response to them.
      const ticket = await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await fx.prisma.ticketMessage.createMany({
        data: [
          {
            ticketId: ticket.id,
            senderId: tenant.userId,
            content: 'Also, one more thing',
            createdAt: at('2026-03-02T09:05:00.000Z'),
          },
          {
            ticketId: ticket.id,
            senderId: tenant.agentId,
            content: 'Looking into it',
            createdAt: at('2026-03-02T10:00:00.000Z'),
          },
        ],
      });

      await runOver('2026-03-01', '2026-03-04');

      const [day] = await statsFor('2026-03-02');
      expect(day.firstResponseCount).toBe(1);
      // One HOUR, from the agent's reply — not the five minutes to the
      // author's own follow-up.
      expect(day.firstResponseSecondsSum).toBe(3600);
    });

    it('13. An INTERNAL NOTE is not a first response', async () => {
      // A note the requester cannot see is not a response to them, and counting
      // it would report a response time for a customer who is still waiting.
      const ticket = await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await fx.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: tenant.agentId,
          content: 'Watch this one',
          isInternalNote: true,
          createdAt: at('2026-03-02T09:10:00.000Z'),
        },
      });

      await runOver('2026-03-01', '2026-03-04');

      const [day] = await statsFor('2026-03-02');
      expect(day.firstResponseCount).toBe(0);
    });

    it('14. **AI first responses are counted SEPARATELY from human ones**', async () => {
      // The metric-measuring-itself guard. An AI reply in 2 seconds genuinely
      // is a first response — and blending it with human response time produces
      // a headline that improves whenever AI usage rises.
      const aiTicket = await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      const humanTicket = await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await fx.prisma.ticketMessage.createMany({
        data: [
          {
            ticketId: aiTicket.id,
            senderId: null,
            isAiGenerated: true,
            content: 'Here is what the handbook says',
            createdAt: at('2026-03-02T09:00:02.000Z'),
          },
          {
            ticketId: humanTicket.id,
            senderId: tenant.agentId,
            content: 'On it',
            createdAt: at('2026-03-02T10:00:00.000Z'),
          },
        ],
      });

      await runOver('2026-03-01', '2026-03-04');

      const [day] = await statsFor('2026-03-02');
      expect(day.aiFirstResponseCount).toBe(1);
      expect(day.aiFirstResponseSecondsSum).toBe(2);
      expect(day.firstResponseCount).toBe(1);
      expect(day.firstResponseSecondsSum).toBe(3600);
    });

    it('15. Keeps departments as separate rows, and tickets with none in their own', async () => {
      // `?departmentId=` has to agree with `GET /tickets?departmentId=`, which
      // a tenant-only rollup could not answer.
      await createTicket(fx.prisma, tenant, {
        currentDepartmentId: tenant.departmentId,
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await createTicket(fx.prisma, tenant, {
        currentDepartmentId: null,
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');

      const rows = await statsFor('2026-03-02');
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.departmentId === null)).toHaveLength(1);
    });

    it('16. Never mixes one tenant’s rows into another’s', async () => {
      // The isolation sweep, run against the ROLLUP specifically: these are new
      // tables written by a job rather than by a scoped request handler, which
      // is exactly where a missing `organization_id` filter hides.
      const other = buildTenant();

      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await createTicket(fx.prisma, other, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
        priority: TicketPriority.HIGH,
      });

      await runOver('2026-03-01', '2026-03-04');

      const mine = await fx.prisma.ticketDailyStat.findMany({
        where: { organizationId: tenant.organizationId },
      });
      const theirs = await fx.prisma.ticketDailyStat.findMany({
        where: { organizationId: other.organizationId },
      });

      expect(mine).toHaveLength(1);
      expect(theirs).toHaveLength(1);
      expect(mine[0].ticketsCreated).toBe(1);
      expect(theirs[0].ticketsCreated).toBe(1);
    });

    it('17. Records WHEN it ran, so a backfill can invalidate a cache', async () => {
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');
      const [first] = await statsFor('2026-03-02');

      await new Promise((resolve) => setTimeout(resolve, 10));
      await runOver('2026-03-01', '2026-03-04');
      const [second] = await statsFor('2026-03-02');

      expect(second.computedAt.getTime()).toBeGreaterThan(
        first.computedAt.getTime(),
      );
    });
  });

  describe('agent stats', () => {
    it('18. Credits the resolution to whoever HELD the ticket', async () => {
      await createTicket(fx.prisma, tenant, {
        currentAssigneeId: tenant.agentId,
        status: TicketStatus.RESOLVED,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-02T11:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');

      const rows = await fx.prisma.agentDailyStat.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].agentId).toBe(tenant.agentId);
      expect(rows[0].resolved).toBe(1);
      expect(rows[0].resolutionSecondsSum).toBe(2 * 3600);
    });

    it('19. Does NOT credit an agent for a reply the model wrote', async () => {
      // A productivity metric that counts AI messages is measuring the model.
      const ticket = await createTicket(fx.prisma, tenant, {
        currentAssigneeId: tenant.agentId,
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await fx.prisma.ticketMessage.createMany({
        data: [
          {
            ticketId: ticket.id,
            senderId: tenant.agentId,
            content: 'Typed by a person',
            createdAt: at('2026-03-02T10:00:00.000Z'),
          },
          {
            ticketId: ticket.id,
            senderId: null,
            isAiGenerated: true,
            content: 'Written by the model',
            createdAt: at('2026-03-02T10:05:00.000Z'),
          },
        ],
      });

      await runOver('2026-03-01', '2026-03-04');

      const [row] = await fx.prisma.agentDailyStat.findMany();
      expect(row.messagesSent).toBe(1);
    });

    it('20. Re-running does not double an agent’s counters either', async () => {
      await createTicket(fx.prisma, tenant, {
        currentAssigneeId: tenant.agentId,
        status: TicketStatus.RESOLVED,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-02T11:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');
      await runOver('2026-03-01', '2026-03-04');

      const rows = await fx.prisma.agentDailyStat.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].resolved).toBe(1);
    });
  });

  /**
   * The field that makes an unrun job legible.
   *
   * Every analytics test in this repo passed against empty tables while the
   * rollups had no scheduler, because a query returning zero rows is a valid
   * query. `dataThrough` is what separates "quiet tenant" from "nothing has
   * ever run" without reading a log.
   */
  describe('dataThrough — freshness, 20-doc §4.3', () => {
    const context = () => ({ organizationId: tenant.organizationId }) as never;
    const range = { from: '2026-03-01', to: '2026-03-31' };

    it('21. **is null when no rollup has ever run**', async () => {
      // The exact state this system was in. `null` must not be renderable as a
      // date, and must not be confused with a tenant that simply had no
      // tickets — those need different responses from whoever is looking.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      const overview = await analytics.getOverview(range, context());

      expect(overview.dataThrough).toBeUndefined();
      expect(overview.ticketsCreated).toBe(0);
    });

    it('22. reports the last rolled-up day once the job has run', async () => {
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-04');

      const overview = await analytics.getOverview(range, context());

      // The last day with a ROW, not the end of the window that was rolled up:
      // the job writes a row per day that had activity, so 3 and 4 March
      // produced nothing to point at.
      expect(overview.dataThrough).toBe('2026-03-02');
    });

    it('23. **a quiet tenant reads as stale — the known limitation, stated**', async () => {
      // `MAX(day)` answers "what period does this dashboard cover", which is
      // not quite "is the job running": a tenant with no tickets since Tuesday
      // reports Tuesday however healthy the scheduler is.
      //
      // Accepted deliberately, because it fails in the SAFE direction. A false
      // "your data looks old" costs someone a glance at the job status; the
      // inverse — a broken scheduler reporting today because it ran and found
      // nothing — is the failure this whole document exists about.
      //
      // The heartbeat table answers "is it running" separately,
      // and `/platform/metrics` is where that question belongs.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });

      await runOver('2026-03-01', '2026-03-20');

      const overview = await analytics.getOverview(range, context());

      expect(overview.dataThrough).toBe('2026-03-02');
    });

    it('24. **does NOT change because the caller asked about a narrower range**', async () => {
      // The whole value of the field is answering "how fresh is our data",
      // which is a property of the tenant and not of the question. Clipping it
      // to the range would report `2026-03-02` for a two-day query and hide
      // that newer data exists — inverting the signal precisely when somebody
      // is drilling into a specific week.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-10T09:00:00.000Z'),
      });
      await runOver('2026-03-01', '2026-03-12');

      const narrow = await analytics.getOverview(
        { from: '2026-03-01', to: '2026-03-02' },
        context(),
      );

      expect(narrow.dataThrough).toBe('2026-03-10');
      // And the narrow query still reports only its own window's numbers.
      expect(narrow.ticketsCreated).toBe(1);
    });

    it('25. every single-service endpoint carries it, not just the overview', async () => {
      // A dashboard renders six tiles from six endpoints. One of them knowing
      // the data is stale is not much use to the other five.
      await createTicket(fx.prisma, tenant, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await runOver('2026-03-01', '2026-03-04');

      const [deflection, responseTimes, volume, satisfaction] =
        await Promise.all([
          analytics.getDeflection(range, context()),
          analytics.getResponseTimes(range, context()),
          analytics.getVolume(range, context()),
          analytics.getSatisfaction(range, context()),
        ]);

      expect(deflection.dataThrough).toBe('2026-03-02');
      expect(responseTimes.dataThrough).toBe('2026-03-02');
      expect(volume.dataThrough).toBe('2026-03-02');
      expect(satisfaction.dataThrough).toBe('2026-03-02');
    });

    it('26. agent stats report their OWN table’s freshness', async () => {
      // `agent_daily_stats` is a different table from `ticket_daily_stats`. It
      // can legitimately be staler, and a shared figure would hide that.
      await createTicket(fx.prisma, tenant, {
        currentAssigneeId: tenant.agentId,
        status: TicketStatus.RESOLVED,
        createdAt: at('2026-03-02T09:00:00.000Z'),
        resolvedAt: at('2026-03-02T11:00:00.000Z'),
      });
      await runOver('2026-03-01', '2026-03-04');

      const agents = await analytics.getAgentStats(range, context());

      expect(agents.dataThrough).toBe('2026-03-02');
    });

    it('27. is scoped to the TENANT — another org’s rollup does not vouch for mine', async () => {
      // The worst version of this bug: a busy neighbour making an empty
      // tenant's dashboard look healthy.
      const other = buildTenant();
      await createTicket(fx.prisma, other, {
        createdAt: at('2026-03-02T09:00:00.000Z'),
      });
      await runOver('2026-03-01', '2026-03-04');

      const mine = await analytics.getOverview(range, context());

      expect(mine.dataThrough).toBeUndefined();
    });
  });

  /**
   * **The test that would have caught all of this.**
   *
   * Every other analytics test in this repo passed while the feature returned
   * zeros, because a query against an empty table is a valid query returning a
   * valid answer. The rollup suite passed because it called `backfill()`
   * directly. The endpoint suite passed because it stubbed the service. The
   * gateway suite passed because it stubbed the wire.
   *
   * Nothing anywhere drove the SCHEDULER and then read the ENDPOINT — so the
   * one thing nobody verified was that the two were connected at all.
   */
  describe('§6 test 7 — seed → SCHEDULER → endpoint', () => {
    const context = () => ({ organizationId: tenant.organizationId }) as never;

    it('28. **after a scheduled run on seeded data, the overview is NON-ZERO**', async () => {
      await createTicket(fx.prisma, tenant, {
        status: TicketStatus.RESOLVED,
        createdAt: hoursAgo(30),
        resolvedAt: hoursAgo(28),
      });

      // Driven through the SCHEDULER's own entry point, not through
      // `backfill()`. The distinction is the entire point: `backfill` was
      // always reachable and always worked, and the tick that calls `run()` on
      // a trailing window did not exist.
      await scheduler.process({
        name: SCHEDULED_JOBS.ANALYTICS_DAILY,
        data: {},
      } as never);

      const overview = await analytics.getOverview(
        { from: isoDay(hoursAgo(48)), to: isoDay(new Date()) },
        context(),
      );

      expect(overview.ticketsCreated).toBe(1);
      expect(overview.ticketsResolved).toBe(1);
      // And the freshness field moved, which is what a reader checks first.
      expect(overview.dataThrough).not.toBeUndefined();
    });

    it('29. the same run records a heartbeat, so "did it happen" is answerable', async () => {
      await createTicket(fx.prisma, tenant, { createdAt: hoursAgo(30) });

      await scheduler.process({
        name: SCHEDULED_JOBS.ANALYTICS_DAILY,
        data: {},
      } as never);

      const heartbeat = await fx.prisma.jobRun.findUniqueOrThrow({
        where: { jobName: SCHEDULED_JOBS.ANALYTICS_DAILY },
      });
      expect(heartbeat.lastSucceededAt).not.toBeNull();
    });

    it('30. **WITHOUT the run, the same endpoint answers zero and says so**', async () => {
      // The state this system was actually in. Note what a reader sees: a
      // correct answer, no error, no log line — and `dataThrough: null`, which
      // is the only thing distinguishing this from a quiet Tuesday.
      await createTicket(fx.prisma, tenant, { createdAt: hoursAgo(30) });

      const overview = await analytics.getOverview(
        { from: isoDay(hoursAgo(48)), to: isoDay(new Date()) },
        context(),
      );

      expect(overview.ticketsCreated).toBe(0);
      expect(overview.dataThrough).toBeUndefined();
    });
  });
});
