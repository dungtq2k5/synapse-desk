import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { formatErrorMsg } from '@synapsedesk/common';
import { InvitationsService } from './invitations.service';

/**
 * Transitions PENDING invitations past their expiry to EXPIRED.
 *
 * The status matters beyond tidiness: `seatsInUse()` counts PENDING invitations
 * as reserved seats, so without this a tenant slowly runs out of seats that
 * nobody is using. Expiry is what RELEASES a reservation.
 *
 * Rows are transitioned, never deleted — "16 of 47 invitees never accepted" is
 * an onboarding metric, not garbage.
 */
@Injectable()
export class InvitationsExpiryJob {
  private readonly logger = new Logger(InvitationsExpiryJob.name);

  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * Hourly rather than per-minute: the TTL is measured in days, so an
   * invitation lingering up to an hour past expiry changes nothing — and every
   * replica runs this, so a tighter schedule is pure duplicated write load.
   *
   * The query is idempotent (`status = PENDING AND expiresAt < now`), so
   * concurrent replicas race harmlessly: the loser updates zero rows.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireStale(): Promise<void> {
    try {
      await this.invitationsService.expireStaleInvitations();
    } catch (error) {
      // A failed sweep must not take the process down — the next hour retries.
      this.logger.error(
        `Failed to expire stale invitations: ${formatErrorMsg(error)}`,
      );
    }
  }
}
