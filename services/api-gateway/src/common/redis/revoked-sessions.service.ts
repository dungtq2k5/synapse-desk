import { Injectable, Logger } from '@nestjs/common';
import { REVOKED_SESSION_KEY_PREFIX } from '@synapsedesk/contracts';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { RedisService } from './redis.service';

/**
 * Which session families auth-service has revoked.
 *
 * Signing a device out, signing out everywhere, or changing the password
 * deletes the family's refresh tokens and marks it
 * `revoked-session:{familyId}` in Redis. An access token names its family in
 * `sid`, so the gateway refuses it on its next call instead of letting it run
 * to its own expiry.
 *
 * A token without `sid` predates the claim and is never revoked here: it
 * expires on its own within 15 minutes.
 *
 * **Redis down fails open**, logged at WARN, as every other Redis read in the
 * gateway does. The token's own expiry stays the backstop.
 *
 * @example if (await revoked.isRevoked(payload.sid)) throw new UnauthorizedException();
 */
@Injectable()
export class RevokedSessionsService {
  private readonly logger = new Logger(RevokedSessionsService.name);

  constructor(private readonly redis: RedisService) {}

  /** Whether this family is revoked; `false` without one, or without Redis. */
  async isRevoked(sid: string | undefined): Promise<boolean> {
    if (!sid) return false;
    try {
      return (
        (await this.redis.client.exists(
          `${REVOKED_SESSION_KEY_PREFIX}${sid}`,
        )) === 1
      );
    } catch (error) {
      this.logger.warn(
        `Revoked-session check unavailable; allowing session ${sid}: ${formatErrorMsg(error)}`,
      );
      return false;
    }
  }

  /** The revoked families among these, in one `MGET`; none without Redis. */
  async revokedAmong(sids: string[]): Promise<Set<string>> {
    if (sids.length === 0) return new Set();
    try {
      const marks = await this.redis.client.mget(
        sids.map((sid) => `${REVOKED_SESSION_KEY_PREFIX}${sid}`),
      );
      return new Set(sids.filter((_, index) => marks[index] !== null));
    } catch (error) {
      this.logger.warn(
        `Revoked-session sweep unavailable; keeping every socket: ${formatErrorMsg(error)}`,
      );
      return new Set();
    }
  }
}
