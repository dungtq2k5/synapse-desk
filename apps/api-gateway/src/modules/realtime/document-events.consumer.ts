import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  DOCUMENT_PATTERNS,
  DocumentEventOf,
  formatErrorMsg,
} from '@synapsedesk/common';
import { RealtimeGateway } from './realtime.gateway';
import {
  deptRoom,
  orgRoom,
  REALTIME_EVENTS,
  RealtimeRoom,
  userRoom,
} from './realtime.config';

/**
 * Domain C's half of the relay — 22-doc §6.2.
 *
 * There was no document consumer at all before this, which mattered in one
 * direction: a Knowledge Manager uploaded a file and then watched it sit in
 * `PROCESSING` with no way to learn it had finished, or failed, short of
 * refreshing.
 *
 * **Adding one raises the room question, and the obvious answer is wrong.**
 * `org:{organizationId}` is the room every other tenant-wide announcement uses
 * and it is a disclosure here: a department-scoped document is invisible to
 * users outside its departments, so announcing it tenant-wide leaks its
 * EXISTENCE and its TITLE to exactly the people that boundary excludes. The
 * title is often the sensitive part — "Q3 Redundancy Plan" discloses the thing
 * whether or not anyone can open the file.
 *
 * So the rooms follow the document's own scope, which is why `dept:` exists and
 * why nothing needed it until now.
 */
@Controller()
export class DocumentEventsConsumer {
  private readonly logger = new Logger(DocumentEventsConsumer.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  @EventPattern(DOCUMENT_PATTERNS.indexed)
  documentIndexed(
    @Payload() event: DocumentEventOf<typeof DOCUMENT_PATTERNS.indexed>,
  ): void {
    this.relay(event.pattern, () => {
      // ONE emit over every room — see `toRooms`. A loop here would deliver
      // twice to the uploader whenever they are also in the document's
      // department, which is the ordinary case rather than an edge one.
      this.gateway
        .toRooms(this.audience(event))
        .emit(REALTIME_EVENTS.documentIndexed, event);
    });
  }

  /**
   * A failure, to the UPLOADER only.
   *
   * **Not department news.** A document that failed to parse is one person's
   * upload not working; announcing it to a department tells everyone that
   * somebody tried to add something and could not, which is neither useful nor
   * theirs to know. The `reason` is pre-redacted by ingestion-service — never a
   * stack trace — which is what makes it safe to display at all.
   */
  @EventPattern(DOCUMENT_PATTERNS.ingestionFailed)
  documentFailed(
    @Payload()
    event: DocumentEventOf<typeof DOCUMENT_PATTERNS.ingestionFailed>,
  ): void {
    this.relay(event.pattern, () => {
      this.gateway
        .toRoom(userRoom(event.uploaderId))
        .emit(REALTIME_EVENTS.documentFailed, event);
    });
  }

  /**
   * Who may be told this document exists.
   *
   * A `Set` here only removes duplicate ROOM NAMES; removing duplicate
   * RECIPIENTS is `toRooms`'s job, because Socket.IO deduplicates within a
   * single emit and not across separate ones. Both are needed and neither
   * substitutes for the other.
   */
  private audience(
    event: DocumentEventOf<typeof DOCUMENT_PATTERNS.indexed>,
  ): RealtimeRoom[] {
    // The uploader is told regardless of scope: they are the one person who
    // asked for this outcome, and a document they can no longer see is still a
    // document they uploaded.
    const rooms = new Set<RealtimeRoom>([userRoom(event.uploaderId)]);

    if (event.isOrganizationWide) {
      // Genuinely tenant-wide, so the tenant room is the correct — and cheapest
      // — audience rather than a fan-out over every department.
      rooms.add(orgRoom(event.organizationId));
      return [...rooms];
    }

    for (const departmentId of event.departmentIds) {
      rooms.add(deptRoom(departmentId));
    }

    // A document that is neither org-wide nor linked to any department reaches
    // only its uploader, which is correct rather than a gap: nobody else can
    // retrieve it either.
    return [...rooms];
  }

  /**
   * Same error boundary as the ticket consumer, for the same reason: a relay
   * that throws would redeliver forever under a durable subscription, and take
   * the process down without one.
   */
  private relay(pattern: string, emit: () => void): void {
    try {
      emit();
      // See `TicketEventsConsumer.relay` — counted at the one boundary every
      // relayed event crosses.
      this.gateway.countEvent(pattern);
    } catch (error) {
      this.logger.error(`Failed to relay ${pattern}: ${formatErrorMsg(error)}`);
    }
  }
}
