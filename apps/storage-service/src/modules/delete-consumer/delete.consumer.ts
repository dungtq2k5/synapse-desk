import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  formatErrorMsg,
  ObjectSupersededEvent,
  STORAGE_PATTERNS,
} from '@synapsedesk/common';
import { FirebaseStorageService } from '../firebase/firebase-storage.service';

/**
 * Deleting a superseded object — §1.6, async and at-most-once.
 *
 * The owning service emits this the moment it commits the new `avatar_url` or
 * removes the row. Fire-and-forget, exactly like `AuditPublisher`: a delete
 * that fails must never roll back or block the write the user actually asked
 * for. The worst case is an orphaned object, which costs storage; the
 * alternative is a failed avatar change, which costs the user their action.
 *
 * `ignoreNotFound` is load-bearing. NATS core can redeliver or drop, so a
 * delete-of-already-deleted MUST be a no-op rather than an error — otherwise
 * the first redelivery turns a successful cleanup into a permanent error in the
 * log, and anyone reading that log learns to ignore it.
 *
 * This handler never rethrows, for the same reason `AuditConsumer` does not: a
 * throw on a malformed payload does not fail safely, it produces a poison
 * message that buries every good event behind it.
 */
@Controller()
export class DeleteConsumer {
  private readonly logger = new Logger(DeleteConsumer.name);

  constructor(private readonly firebase: FirebaseStorageService) {}

  @EventPattern(STORAGE_PATTERNS.objectSuperseded)
  async handle(@Payload() event: ObjectSupersededEvent): Promise<void> {
    // A missing path is a producer bug, not something to guess at. Deleting
    // "whatever the empty string resolves to" is the one outcome worth being
    // paranoid about here.
    if (!event?.objectPath) {
      this.logger.error('storage.object.superseded arrived with no objectPath');
      return;
    }

    try {
      await this.firebase.bucket
        .file(event.objectPath)
        .delete({ ignoreNotFound: true });

      this.logger.log(
        `Deleted '${event.objectPath}' (${event.reason ?? 'no reason given'})`,
      );
    } catch (error) {
      this.logger.error(
        `Could not delete '${event.objectPath}': ${formatErrorMsg(error)}`,
      );
    }
  }
}
