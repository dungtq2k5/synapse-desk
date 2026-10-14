import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { REVOKED_SESSION_KEY_PREFIX } from '@synapsedesk/contracts';
import { LIMIT_ALERT_REDIS } from '../limit-alerts/limit-alerts.module';

/**
 * Tells the gateway a session family is gone, so its access tokens stop
 * working now rather than when they expire.
 *
 * An access token names its family in `sid`. Deleting the family's rows stops
 * the next refresh; this writes `revoked-session:{familyId}` to the Redis the
 * gateway reads on every request, for as long as an access token lives. After
 * that every token of the family has expired on its own, and the key goes.
 *
 * A failed write is logged, not thrown: the rows are already deleted, and the
 * token's own expiry is the backstop.
 */
@Injectable()
export class RevokedSessions {
  private readonly logger = new Logger(RevokedSessions.name);

  /**
   * An access token's lifetime in seconds, as `JwtModule` reads
   * `JWT_ACCESS_EXPIRES_IN` (`15m`, `900`, `1h`…): a probe signed with the
   * same option, so the two can't disagree.
   */
  private readonly ttlSeconds: number;

  constructor(
    @Inject(LIMIT_ALERT_REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const probe = new JwtService({
      secret: 'lifetime-probe',
      signOptions: {
        expiresIn: config.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN'),
      } as JwtSignOptions,
    });
    const { iat, exp } = probe.decode<{ iat: number; exp: number }>(
      probe.sign({}),
    );
    this.ttlSeconds = exp - iat;
  }

  /** Marks these families revoked for the gateway. */
  async mark(familyIds: Iterable<string>): Promise<void> {
    const unique = [...new Set(familyIds)];
    if (unique.length === 0) return;

    try {
      const pipeline = this.redis.pipeline();
      for (const familyId of unique) {
        pipeline.set(
          `${REVOKED_SESSION_KEY_PREFIX}${familyId}`,
          '1',
          'EX',
          this.ttlSeconds,
        );
      }
      const results = await pipeline.exec();
      const failed = results?.find(([error]) => error)?.[0];
      if (failed) throw failed;
    } catch (error) {
      this.logger.warn(
        `Couldn't mark ${unique.length} revoked session(s) for the gateway; ` +
          `their access tokens work until they expire: ${String(error)}`,
      );
    }
  }
}
