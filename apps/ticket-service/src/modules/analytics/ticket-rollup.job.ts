import { Injectable, Logger } from '@nestjs/common';
import {
  backfillWindow,
  formatErrorMsg,
  RollupWindow,
  safeTimezone,
  trailingWindow,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';

/** How many trailing days a routine run recomputes. */
const DEFAULT_TRAILING_DAYS = 2;

// ASK Why we have two `docblock`?
/** What one run did, for the log and the tests. */
/** What one rollup run wrote. */
export type RollupOutcome = {
  tenants: number;
  ticketRows: number;
  agentRows: number;
};

/**
 * `ticket_daily_stats` and `agent_daily_stats`
 *
 * **A plain method taking a window, with no `@Cron` decorator.** The same shape
 * `chunk-usage.projection.ts` and `quota-reconciliation.job.ts` take, and for
 * the same reason: a job triggered by a schedule can only be tested by waiting,
 * and a test that waits gets deleted. The scheduler calls `run()`; the tests
 * call it with an explicit window.
 *
 * **Idempotent by construction, and that is the property that matters.** Each
 * tenant's affected days are DELETED and re-inserted inside one transaction, so
 * re-running recomputes a day from source rather than adding to it. A job that
 * cannot be safely re-run cannot be fixed after a bug — the numbers stay wrong
 * forever because the correction only applies going forward.
 *
 * Delete-then-insert rather than `ON CONFLICT DO UPDATE` for one concrete
 * reason: `department_id` is NULLable, so the uniqueness guard is a PARTIAL
 * index pair, and a single `ON CONFLICT` clause cannot name two indexes. The
 * alternative — a sentinel uuid standing in for "no department" — would put a
 * fake id in a column every consumer joins on.
 *
 * **Sums and counts, never averages.** An average of daily averages weights a
 * Tuesday with 3 tickets equally with a Monday with 300. Every rate and mean is
 * computed at read time.
 *
 * **Recomputes a TRAILING window rather than only yesterday.** A ticket created
 * on Monday and resolved on Wednesday changes Monday's cohort figures on
 * Wednesday, so a job that only ever touched the previous day would leave
 * deflection and resolution counts permanently short.
 */
@Injectable()
export class TicketRollupJob {
  private readonly logger = new Logger(TicketRollupJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
  ) {}

  /** The routine run: the last few local days, for every active tenant. */
  async run(
    now: Date = new Date(),
    days: number = DEFAULT_TRAILING_DAYS,
  ): Promise<RollupOutcome> {
    return this.rollup(trailingWindow(now, days));
  }

  /**
   * The BACKFILL entry point
   *
   * Shipped from day one because it is fifteen minutes while the job is fresh
   * and the alternative is discovering a rollup bug with no way to recompute:
   * a metric that stays wrong forever because the fix only applies going
   * forward. Both days inclusive, which is what an operator means by
   * "backfill March".
   */
  async backfill(fromDay: Date, toDay: Date): Promise<RollupOutcome> {
    this.logger.log(
      `Backfilling ticket rollups ${fromDay.toISOString().slice(0, 10)} → ` +
        `${toDay.toISOString().slice(0, 10)}`,
    );

    return this.rollup(backfillWindow(fromDay, toDay));
  }

  private async rollup(window: RollupWindow): Promise<RollupOutcome> {
    const organizationIds = await this.activeTenants(window);
    if (organizationIds.length === 0) {
      // **No rows for a quiet tenant, and that is correct** (
      // 5). Absent is not broken: the endpoints read a missing row as zero, and
      // writing zero rows for every tenant every day would be the largest table
      // in the system holding nothing.
      this.logger.log('No ticket activity in window; nothing to roll up');

      return { tenants: 0, ticketRows: 0, agentRows: 0 };
    }

    const timezones =
      await this.authReference.listOrganizationTimezones(organizationIds);

    let ticketRows = 0;
    let agentRows = 0;

    for (const organizationId of organizationIds) {
      const timezone = safeTimezone(timezones.get(organizationId));

      try {
        // Per tenant rather than one statement over all of them, because the
        // timezone is a literal in the date cast and tenants do not share one.
        // A handful of statements a day is not a cost worth optimising into a
        // CASE expression nobody can read.
        ticketRows += await this.rollupTickets(
          organizationId,
          timezone,
          window,
        );
        agentRows += await this.rollupAgents(organizationId, timezone, window);
      } catch (error) {
        // One tenant's failure must not cost every other tenant their numbers.
        // The window is re-run tomorrow anyway, so a transient failure heals
        // itself and a persistent one is visible in the log rather than as a
        // gap nobody can explain.
        this.logger.error(
          `Rollup failed for ${organizationId}: ${formatErrorMsg(error)}`,
        );
      }
    }

    this.logger.log(
      `Rolled up ${ticketRows} ticket row(s) and ${agentRows} agent row(s) ` +
        `across ${organizationIds.length} tenant(s)`,
    );

    return { tenants: organizationIds.length, ticketRows, agentRows };
  }

  /**
   * The tenants with anything to roll up in this window.
   *
   * Read from THIS service's own tables rather than by asking auth-service for
   * every tenant: a quiet tenant should cost nothing, and a tenant list that
   * came from elsewhere would make the job's cost scale with signups rather
   * than with activity.
   */
  private async activeTenants(window: RollupWindow): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT DISTINCT organization_id FROM tickets
      WHERE deleted_at IS NULL
        AND (
          (created_at   >= ${window.since} AND created_at   < ${window.until})
          OR (resolved_at  >= ${window.since} AND resolved_at  < ${window.until})
          OR (escalated_at >= ${window.since} AND escalated_at < ${window.until})
        )
    `;

    return rows.map((row) => row.organization_id);
  }

  /**
   * One statement, all thirteen counters.
   *
   * Written in SQL rather than as a read-modify-write loop for the same reason
   * the chunk-usage projection is: two overlapping runs cannot interleave a
   * read and a write and lose a value, because there is no read.
   *
   * **The bucketing is `(timestamp AT TIME ZONE $tz)::date`**, which is the one
   * thing in the stack that knows a zone's DST rules for a given date. Doing it
   * in TypeScript would need an offset table that is wrong twice a year — and
   * wrong for exactly the tenants who care, since a DST-observing zone is the
   * only case where it differs.
   *
   * Each counter is bucketed on the day the thing it counts HAPPENED, with one
   * deliberate exception: the deflection pair, which is a cohort. See the
   * schema note on `chat_conversations`.
   */
  private async rollupTickets(
    organizationId: string,
    timezone: string,
    window: RollupWindow,
  ): Promise<number> {
    const [, inserted] = await this.prisma.$transaction([
      // The days this window can touch, cleared first. Bounded by the same
      // timezone cast the insert uses, so the two agree by construction rather
      // than by arithmetic done twice.
      this.prisma.$executeRawUnsafe(
        `
        DELETE FROM ticket_daily_stats
        WHERE organization_id = $1::uuid
          AND day >= ($2::timestamptz AT TIME ZONE $4)::date
          AND day <= ($3::timestamptz AT TIME ZONE $4)::date
        `,
        organizationId,
        window.since,
        window.until,
        timezone,
      ),
      this.prisma.$executeRawUnsafe(
        `
      WITH bounds AS (
        SELECT $1::uuid AS org, $2::timestamptz AS since, $3::timestamptz AS until
      ),

      -- Every (day, department) pair that any counter below touches, so a day
      -- where only feedback arrived still produces a row.
      created AS (
        SELECT (t.created_at AT TIME ZONE $4)::date AS day,
               t.current_department_id AS department_id,
               COUNT(*)::int AS tickets_created,
               COUNT(*) FILTER (WHERE t.source = 'CHAT')::int AS chat_conversations,
               -- **Deflected**: a chat conversation that reached a terminal
               -- status without ever being escalated and without ever needing a
               -- human assignee. Escalation alone is not enough — a ticket
               -- quietly picked up by an agent was not deflected either.
               COUNT(*) FILTER (
                 WHERE t.source = 'CHAT'
                   AND t.status IN ('RESOLVED', 'CLOSED')
                   AND t.escalated_at IS NULL
                   AND t.current_assignee_id IS NULL
               )::int AS chat_deflected
        FROM tickets t, bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND t.created_at >= b.since AND t.created_at < b.until
        GROUP BY 1, 2
      ),

      resolved AS (
        SELECT (t.resolved_at AT TIME ZONE $4)::date AS day,
               t.current_department_id AS department_id,
               COUNT(*)::int AS tickets_resolved,
               -- Clamped at zero: a resolved_at before created_at is corrupt
               -- data, and a negative summand would silently shorten the mean
               -- for every other ticket that day.
               COALESCE(SUM(GREATEST(
                 EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)), 0
               ))::int, 0) AS resolution_seconds_sum,
               COUNT(*)::int AS resolution_count
        FROM tickets t, bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND t.resolved_at IS NOT NULL
          AND t.resolved_at >= b.since AND t.resolved_at < b.until
        GROUP BY 1, 2
      ),

      escalated AS (
        SELECT (t.escalated_at AT TIME ZONE $4)::date AS day,
               t.current_department_id AS department_id,
               COUNT(*)::int AS tickets_escalated
        FROM tickets t, bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND t.escalated_at IS NOT NULL
          AND t.escalated_at >= b.since AND t.escalated_at < b.until
        GROUP BY 1, 2
      ),

      -- **Time to first response** — the first message from a DIFFERENT party
      -- than the ticket's author. Not "the first message": the author's own
      -- follow-up is not a response, and counting it reads as a suspiciously
      -- fast team (19-doc §3.1).
      --
      -- Internal notes are excluded: a note the requester cannot see is not a
      -- response to them.
      first_response AS (
        SELECT DISTINCT ON (m.ticket_id)
               m.ticket_id,
               t.current_department_id AS department_id,
               m.created_at AS responded_at,
               t.created_at AS asked_at,
               m.is_ai_generated
        FROM ticket_messages m
        JOIN tickets t ON t.id = m.ticket_id
        CROSS JOIN bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND m.is_internal_note = false
          AND m.redacted_at IS NULL
          AND (m.sender_id IS DISTINCT FROM t.author_id)
        ORDER BY m.ticket_id, m.created_at ASC
      ),

      responses AS (
        SELECT (f.responded_at AT TIME ZONE $4)::date AS day,
               f.department_id,
               -- HUMAN and AI kept apart. An AI reply in 2 seconds genuinely is
               -- a first response, and blending it with human response time
               -- produces a headline that improves whenever AI usage rises —
               -- the metric measuring itself (19-doc §3.1).
               COALESCE(SUM(GREATEST(
                 EXTRACT(EPOCH FROM (f.responded_at - f.asked_at)), 0
               )) FILTER (WHERE NOT f.is_ai_generated)::int, 0)
                 AS first_response_seconds_sum,
               COUNT(*) FILTER (WHERE NOT f.is_ai_generated)::int
                 AS first_response_count,
               COALESCE(SUM(GREATEST(
                 EXTRACT(EPOCH FROM (f.responded_at - f.asked_at)), 0
               )) FILTER (WHERE f.is_ai_generated)::int, 0)
                 AS ai_first_response_seconds_sum,
               COUNT(*) FILTER (WHERE f.is_ai_generated)::int
                 AS ai_first_response_count
        FROM first_response f, bounds b
        WHERE f.responded_at >= b.since AND f.responded_at < b.until
        GROUP BY 1, 2
      ),

      feedback AS (
        SELECT (fb.created_at AT TIME ZONE $4)::date AS day,
               t.current_department_id AS department_id,
               COUNT(*) FILTER (WHERE fb.rating > 0)::int AS feedback_positive,
               COUNT(*) FILTER (WHERE fb.rating < 0)::int AS feedback_negative,
               COUNT(*) FILTER (WHERE fb.citation_accurate IS TRUE)::int
                 AS citation_accurate_count,
               -- The DENOMINATOR, stored beside the numerator. A citation
               -- accuracy rate without it is a percentage over an unknown
               -- number of ratings.
               COUNT(*) FILTER (WHERE fb.citation_accurate IS NOT NULL)::int
                 AS citation_rated_count
        FROM ai_response_feedbacks fb
        JOIN ticket_messages m ON m.id = fb.ticket_message_id
        JOIN tickets t ON t.id = m.ticket_id
        CROSS JOIN bounds b
        WHERE fb.organization_id = b.org
          AND fb.created_at >= b.since AND fb.created_at < b.until
        GROUP BY 1, 2
      ),

      -- FULL OUTER joins all the way down: a day that only saw a resolution
      -- must still produce a row, and an INNER join anywhere here would drop it.
      keys AS (
        SELECT day, department_id FROM created
        UNION SELECT day, department_id FROM resolved
        UNION SELECT day, department_id FROM escalated
        UNION SELECT day, department_id FROM responses
        UNION SELECT day, department_id FROM feedback
      )

      INSERT INTO ticket_daily_stats (
        id, organization_id, day, department_id,
        tickets_created, tickets_resolved, tickets_escalated,
        chat_conversations, chat_resolved_without_escalation,
        first_response_seconds_sum, first_response_count,
        ai_first_response_seconds_sum, ai_first_response_count,
        resolution_seconds_sum, resolution_count,
        feedback_positive, feedback_negative,
        citation_accurate_count, citation_rated_count,
        computed_at
      )
      SELECT gen_random_uuid(), $1::uuid, k.day, k.department_id,
             COALESCE(c.tickets_created, 0),
             COALESCE(r.tickets_resolved, 0),
             COALESCE(e.tickets_escalated, 0),
             COALESCE(c.chat_conversations, 0),
             COALESCE(c.chat_deflected, 0),
             COALESCE(p.first_response_seconds_sum, 0),
             COALESCE(p.first_response_count, 0),
             COALESCE(p.ai_first_response_seconds_sum, 0),
             COALESCE(p.ai_first_response_count, 0),
             COALESCE(r.resolution_seconds_sum, 0),
             COALESCE(r.resolution_count, 0),
             COALESCE(f.feedback_positive, 0),
             COALESCE(f.feedback_negative, 0),
             COALESCE(f.citation_accurate_count, 0),
             COALESCE(f.citation_rated_count, 0),
             NOW()
      FROM keys k
      LEFT JOIN created   c ON c.day = k.day AND c.department_id IS NOT DISTINCT FROM k.department_id
      LEFT JOIN resolved  r ON r.day = k.day AND r.department_id IS NOT DISTINCT FROM k.department_id
      LEFT JOIN escalated e ON e.day = k.day AND e.department_id IS NOT DISTINCT FROM k.department_id
      LEFT JOIN responses p ON p.day = k.day AND p.department_id IS NOT DISTINCT FROM k.department_id
      LEFT JOIN feedback  f ON f.day = k.day AND f.department_id IS NOT DISTINCT FROM k.department_id
      `,
        organizationId,
        window.since,
        window.until,
        timezone,
      ),
    ]);

    return inserted;
  }

  /**
   * `agent_daily_stats` — assigned, resolved, messages sent.
   *
   * `assigned` counts ASSIGNMENT ROWS rather than distinct tickets: a ticket
   * bounced between two agents was work for both, and counting it once would
   * make a reassignment look like it never happened to whoever lost it.
   */
  private async rollupAgents(
    organizationId: string,
    timezone: string,
    window: RollupWindow,
  ): Promise<number> {
    const [, inserted] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(
        `
        DELETE FROM agent_daily_stats
        WHERE organization_id = $1::uuid
          AND day >= ($2::timestamptz AT TIME ZONE $4)::date
          AND day <= ($3::timestamptz AT TIME ZONE $4)::date
        `,
        organizationId,
        window.since,
        window.until,
        timezone,
      ),
      this.prisma.$executeRawUnsafe(
        `
      WITH bounds AS (
        SELECT $1::uuid AS org, $2::timestamptz AS since, $3::timestamptz AS until
      ),

      assigned AS (
        SELECT (a.assigned_at AT TIME ZONE $4)::date AS day,
               a.assigned_to_id AS agent_id,
               COUNT(*)::int AS assigned
        FROM ticket_assignments a
        JOIN tickets t ON t.id = a.ticket_id
        CROSS JOIN bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND a.assigned_at >= b.since AND a.assigned_at < b.until
        GROUP BY 1, 2
      ),

      -- Credited to whoever HELD the ticket when it resolved. The assignment
      -- history knows who else touched it; the resolution belongs to one person.
      resolved AS (
        SELECT (t.resolved_at AT TIME ZONE $4)::date AS day,
               t.current_assignee_id AS agent_id,
               COUNT(*)::int AS resolved,
               COALESCE(SUM(GREATEST(
                 EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)), 0
               ))::int, 0) AS resolution_seconds_sum,
               COUNT(*)::int AS resolution_count
        FROM tickets t, bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND t.current_assignee_id IS NOT NULL
          AND t.resolved_at IS NOT NULL
          AND t.resolved_at >= b.since AND t.resolved_at < b.until
        GROUP BY 1, 2
      ),

      -- AI-generated messages have no sender and are excluded by the NOT NULL:
      -- crediting an agent for a reply the model wrote is the productivity
      -- metric measuring the model.
      messages AS (
        SELECT (m.created_at AT TIME ZONE $4)::date AS day,
               m.sender_id AS agent_id,
               COUNT(*)::int AS messages_sent
        FROM ticket_messages m
        JOIN tickets t ON t.id = m.ticket_id
        CROSS JOIN bounds b
        WHERE t.organization_id = b.org AND t.deleted_at IS NULL
          AND m.sender_id IS NOT NULL
          AND m.is_ai_generated = false
          AND m.sender_id IS DISTINCT FROM t.author_id
          AND m.created_at >= b.since AND m.created_at < b.until
        GROUP BY 1, 2
      ),

      keys AS (
        SELECT day, agent_id FROM assigned
        UNION SELECT day, agent_id FROM resolved
        UNION SELECT day, agent_id FROM messages
      )

      INSERT INTO agent_daily_stats (
        id, organization_id, day, agent_id,
        assigned, resolved, messages_sent,
        resolution_seconds_sum, resolution_count, computed_at
      )
      SELECT gen_random_uuid(), $1::uuid, k.day, k.agent_id,
             COALESCE(a.assigned, 0),
             COALESCE(r.resolved, 0),
             COALESCE(m.messages_sent, 0),
             COALESCE(r.resolution_seconds_sum, 0),
             COALESCE(r.resolution_count, 0),
             NOW()
      FROM keys k
      LEFT JOIN assigned a ON a.day = k.day AND a.agent_id = k.agent_id
      LEFT JOIN resolved r ON r.day = k.day AND r.agent_id = k.agent_id
      LEFT JOIN messages m ON m.day = k.day AND m.agent_id = k.agent_id
      WHERE k.agent_id IS NOT NULL
      `,
        organizationId,
        window.since,
        window.until,
        timezone,
      ),
    ]);

    return inserted;
  }
}
