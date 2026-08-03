import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { formatErrorMsg } from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deletes short-lived records that are past their usefulness.
 *
 * Three tables grow without bound today, and `device_sessions` is the worst of
 * them: a spent rotation row is retained on purpose so a replayed refresh token
 * is DETECTABLE rather than merely unknown (RDM) — which means one row per
 * refresh, per user, forever. At a 15-minute access-token TTL that is ~96 rows
 * per user per day.
 *
 * Deleting only what has EXPIRED is what keeps replay detection intact: an
 * expired token is rejected on its expiry alone, so the row proves nothing
 * afterwards. Deleting on `rotatedAt` instead would throw away exactly the
 * evidence the retention exists for.
 *
 * `otps` and `password_reset_tokens` have the same unbounded-growth problem and
 * the same fix, so they are swept here rather than in three separate jobs.
 */
@Injectable()
export class ExpiredRecordsJob {
  private readonly logger = new Logger(ExpiredRecordsJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily. These rows are already unusable the moment they expire — the sweep
   * reclaims space, it does not enforce anything — so a tighter schedule would
   * be duplicated write load across replicas for no behavioural gain.
   *
   * Every statement is idempotent (`expiresAt < now`), so concurrent replicas
   * race harmlessly: the loser deletes zero rows.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    try {
      const now = new Date();

      const [sessions, otps, resetTokens] = await Promise.all([
        this.prisma.deviceSession.deleteMany({
          where: { expiresAt: { lt: now } },
        }),
        this.prisma.otp.deleteMany({ where: { expiresAt: { lt: now } } }),
        this.prisma.passwordResetToken.deleteMany({
          where: { expiresAt: { lt: now } },
        }),
      ]);

      const total = sessions.count + otps.count + resetTokens.count;
      if (total > 0) {
        this.logger.log(
          `Pruned ${sessions.count} session(s), ${otps.count} OTP(s), ` +
            `${resetTokens.count} reset token(s)`,
        );
      }
    } catch (error) {
      // A failed sweep must not take the process down — tomorrow retries.
      this.logger.error(
        `Failed to prune expired records: ${formatErrorMsg(error)}`,
      );
    }
  }
}
