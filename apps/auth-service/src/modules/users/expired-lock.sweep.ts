import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  AuditResourceType,
  EmailTemplateName,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditPublisher } from '../audit/audit-publisher.service';
import { NotificationPublisher } from '../notifications/notification-publisher.service';

/**
 * Clears locks whose expiry has passed — the second of two mechanisms.
 *
 * **Why this exists when the login path unlocks lazily.** The lazy unlock fires
 * only when the user tries to sign in, which for a locked account may be never.
 * Until then they stay *listed* as locked, excluded from both notification
 * audiences, and counted as inactive for the last-Org-Admin check. This sweep
 * makes all of those correct without any of them learning about time.
 *
 * **Why the lazy unlock exists when this sweep runs.** The sweep is hourly, so
 * alone it leaves up to an hour in which a user whose lock expired still cannot
 * log in — the visible, complaint-generating failure.
 *
 * Each covers the other's gap. At expiry they routinely fire at once, which is
 * why the write is conditional.
 *
 * See `docs/decisions/0027-lock-state-is-constrained-not-conventional.md`.
 */
@Injectable()
export class ExpiredLockSweep {
  private readonly logger = new Logger(ExpiredLockSweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublisher,
    private readonly notifications: NotificationPublisher,
  ) {}

  /**
   * Unlocks everyone whose `lockedUntil` has passed.
   *
   * **A plain method taking `now`, with no `@Cron`**. The scheduler
   * calls it; that is what makes it testable without waiting an hour.
   *
   * The scan is on `isLocked: true`, which is why the column carries no index:
   * locked accounts are a tiny set, and an index on a boolean that is false for
   * almost every row earns nothing.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.user.findMany({
      where: {
        isLocked: true,
        lockedUntil: { not: null, lte: now },
        deletedAt: null,
      },
      select: { id: true, email: true, fullName: true },
    });

    let unlocked = 0;

    for (const user of expired) {
      // **Conditional on the row still being locked**, so this and the login
      // path's lazy unlock racing the same user produce ONE unlock and one
      // audit row. At expiry both firing at once is the normal case, not an
      // edge case.
      const { count } = await this.prisma.user.updateMany({
        where: { id: user.id, isLocked: true },
        data: { isLocked: false, lockedUntil: null },
      });

      if (count === 0) continue;

      unlocked++;

      // No `CallerContext`: nobody did this, the clock did. Recorded as a
      // system action so the audit trail shows WHY an account became usable
      // again — an unlock with no actor and no row would read as a bug.
      this.audit.recordSystem({
        organizationId: null,
        action: AuditAction.USER_UNLOCKED,
        resourceType: AuditResourceType.USER,
        resourceId: user.id,
        metadata: { email: user.email, automatic: true },
      });

      this.notifications.sendEmail({
        template: EmailTemplateName.SECURITY_ALERT,
        to: user.email,
        data: {
          fullName: user.fullName,
          headline: 'Your account has been unlocked',
          detail:
            'The temporary lock on your account has expired. You can sign in again.',
          // No request produced this, so the origin names the SERVICE rather
          // than a fabricated IP — the same choice `recordSystem` makes, and
          // for the same reason: an invented `127.0.0.1` reads as a person.
          origin: { ip: 'system', userAgent: 'auth-service/scheduler' },
        },
      });
    }

    if (unlocked > 0) {
      this.logger.log(`Unlocked ${unlocked} account(s) whose lock expired`);
    }

    return unlocked;
  }
}
