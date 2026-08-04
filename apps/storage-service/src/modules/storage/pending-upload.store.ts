import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const STORAGE_REDIS = Symbol('STORAGE_REDIS');

/**
 * What was authorized, and for whom — §1.2.
 *
 * Recorded at presign, checked again at confirm. This record is the ENTIRE
 * reason confirm is an authorization check rather than a formality: without it,
 * "does an object exist at this path" is all confirm could ask, and a caller
 * could confirm a path from somebody else's session. Guessing a uuid is
 * unlikely, but guessing is not the only way a stray path shows up — a client
 * bug, a replayed request, a path copy-pasted out of dev tools.
 */
export type PendingUpload = {
  objectPath: string;
  organizationId: string;
  /** The caller who was authorized to write here. */
  actorId: string;
  contentType: string;
  sizeBytes: number;
  originalFileName: string;
};

/**
 * Redis, not Postgres — §1.2.
 *
 * Two reasons, and both are about this record having no value once the upload
 * window closes. Redis's TTL *is* the cleanup mechanism, so there is no pruning
 * job to write and none to forget; and `storage-service` has no other business
 * data, so a Postgres tier for a few-minutes-lived session record would be
 * provisioning a whole database for what is architecturally a cache entry.
 */
@Injectable()
export class PendingUploadStore implements OnModuleDestroy {
  constructor(@Inject(STORAGE_REDIS) private readonly redis: Redis) {}

  /**
   * Closes the connection when the app shuts down.
   *
   * The store owns this rather than the provider factory because a `useFactory`
   * provider gets no lifecycle hooks — Nest only calls them on class providers.
   * Without it the client stays open after `app.close()`, which in production
   * is a leaked connection per restart and in tests is a run that finishes
   * every assertion and then hangs forever with no output. The second is how
   * this was found.
   */
  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * Keyed by objectPath, which is unique by construction (it ends in a fresh
   * uuid), so two concurrent presigns cannot collide.
   */
  async put(pending: PendingUpload, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      this.key(pending.objectPath),
      JSON.stringify(pending),
      'EX',
      ttlSeconds,
    );
  }

  async get(objectPath: string): Promise<PendingUpload | null> {
    const raw = await this.redis.get(this.key(objectPath));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as PendingUpload;
    } catch {
      // A corrupt value is treated as absent. The caller's confirm then fails
      // closed with NOT_FOUND, which is the safe direction — the alternative is
      // a 500 that tells them to retry into the same broken record.
      return null;
    }
  }

  /**
   * Consume — confirm is NOT idempotent, by design.
   *
   * A second confirm of the same path is suspicious rather than a retry to
   * shrug off: the legitimate client already has its success response from the
   * first call. Deleting on consume is what makes the second one fail.
   */
  async consume(objectPath: string): Promise<void> {
    await this.redis.del(this.key(objectPath));
  }

  private key(objectPath: string): string {
    return `storage:pending:${objectPath}`;
  }
}
