import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANALYTICS_EXPORT_KINDS,
  ANSWER_STATUSES,
  AnalyticsExportStatus,
  AnswerStatus,
  AuditAction,
  AuditResourceType,
  NOTIFICATION_TYPE_VALUES,
  NotificationResourceType,
  ReassignmentReason,
  StoragePurpose,
  DOCUMENT_FILE_TYPES,
  DOCUMENT_FLAG_TYPES,
  DOCUMENT_STATUSES,
  DOCUMENT_FLAG_RESOLUTIONS,
  DocumentFlagSeverity,
  INGESTION_JOB_STATUSES,
  AiGenerationOutcome,
  TICKET_PRIORITIES,
  TicketSource,
  TicketStatus,
} from '@synapsedesk/common';
import { AnswerStatus as ProtoRagAnswerStatus } from './generated/synapsedesk/rag/rag';
import { MessageAnswerStatus as ProtoMessageAnswerStatus } from './generated/synapsedesk/ticket/message';
import {
  fromProtoAiGenerationOutcome,
  fromProtoAnalyticsExportKind,
  fromProtoAnalyticsExportStatus,
  fromProtoAuditAction,
  fromProtoAuditResourceType,
  fromProtoDocumentFileType,
  fromProtoDocumentFlagResolution,
  fromProtoDocumentFlagSeverity,
  fromProtoDocumentFlagType,
  fromProtoDocumentStatus,
  fromProtoIngestionJobStatus,
  fromProtoMessageAnswerStatus,
  fromProtoNotificationResourceType,
  fromProtoNotificationType,
  fromProtoRagAnswerStatus,
  fromProtoTicketPriority,
  fromProtoReassignmentReason,
  fromProtoStoragePurpose,
  fromProtoTicketSource,
  fromProtoTicketStatus,
  toProtoAiGenerationOutcome,
  toProtoAnalyticsExportKind,
  toProtoAnalyticsExportStatus,
  toProtoAuditAction,
  toProtoAuditResourceType,
  toProtoDocumentFileType,
  toProtoDocumentFlagResolution,
  toProtoDocumentFlagSeverity,
  toProtoDocumentFlagType,
  toProtoDocumentStatus,
  toProtoIngestionJobStatus,
  toProtoMessageAnswerStatus,
  toProtoNotificationResourceType,
  toProtoNotificationType,
  toProtoRagAnswerStatus,
  toProtoTicketPriority,
  toProtoReassignmentReason,
  toProtoStoragePurpose,
  toProtoTicketSource,
  toProtoTicketStatus,
} from './mappers';

/**
 * The properties every domain <-> proto enum bridge must have.
 *
 * `Record<Domain, Proto>` already makes a MISSING member a compile error, which
 * is why the forward map stays explicit. Three things it cannot check, and each
 * has been a real bug somewhere in this repo:
 *
 *   1. **Round-tripping.** Two members mapped onto the same proto value
 *      compiles perfectly and silently merges them — the value goes out as one
 *      thing and comes back as another.
 *   2. **UNSPECIFIED is not a member.** If a domain member mapped onto the zero
 *      value, "the caller did not set this" and a real choice would be the same
 *      wire byte, and every `?? null` fallback downstream would fire for a
 *      value that was set.
 *   3. **UNRECOGNIZED answers null.** ts-proto emits `-1` on every enum for a
 *      member some newer build knows about. A bridge that returned a default
 *      there would report a stranger's value as a familiar one.
 */
describe('every enum bridge round-trips', () => {
  /**
   * Typed explicitly rather than left to `as const`.
   *
   * `describe.each` widens a const-asserted tuple array to `any` when it
   * destructures, which silently turns every assertion below into an unchecked
   * one — the exact shape of problem this file exists to catch elsewhere.
   */
  type Bridge = readonly [
    label: string,
    members: readonly string[],
    toProto: (value: string | null | undefined) => number,
    fromProto: (value: number | undefined) => string | null,
  ];

  const bridges: Bridge[] = [
    [
      'DocumentStatus',
      DOCUMENT_STATUSES,
      toProtoDocumentStatus,
      fromProtoDocumentStatus,
    ],
    [
      'IngestionJobStatus',
      INGESTION_JOB_STATUSES,
      toProtoIngestionJobStatus,
      fromProtoIngestionJobStatus,
    ],
    [
      'DocumentFileType',
      DOCUMENT_FILE_TYPES,
      toProtoDocumentFileType,
      fromProtoDocumentFileType,
    ],
    [
      'DocumentFlagType',
      DOCUMENT_FLAG_TYPES,
      toProtoDocumentFlagType,
      fromProtoDocumentFlagType,
    ],
    [
      'DocumentFlagSeverity',
      Object.values(DocumentFlagSeverity),
      toProtoDocumentFlagSeverity,
      fromProtoDocumentFlagSeverity,
    ],
    [
      'DocumentFlagResolution',
      DOCUMENT_FLAG_RESOLUTIONS,
      toProtoDocumentFlagResolution,
      fromProtoDocumentFlagResolution,
    ],
    [
      'AiGenerationOutcome',
      Object.values(AiGenerationOutcome),
      toProtoAiGenerationOutcome,
      fromProtoAiGenerationOutcome,
    ],
    [
      'AuditAction',
      Object.values(AuditAction),
      toProtoAuditAction,
      fromProtoAuditAction,
    ],
    [
      'AuditResourceType',
      Object.values(AuditResourceType),
      toProtoAuditResourceType,
      fromProtoAuditResourceType,
    ],
    [
      'AnalyticsExportKind',
      ANALYTICS_EXPORT_KINDS,
      toProtoAnalyticsExportKind,
      fromProtoAnalyticsExportKind,
    ],
    [
      'AnalyticsExportStatus',
      Object.values(AnalyticsExportStatus),
      toProtoAnalyticsExportStatus,
      fromProtoAnalyticsExportStatus,
    ],
    [
      'TicketStatus',
      Object.values(TicketStatus),
      toProtoTicketStatus,
      fromProtoTicketStatus,
    ],
    [
      'TicketPriority',
      TICKET_PRIORITIES,
      toProtoTicketPriority,
      fromProtoTicketPriority,
    ],
    [
      'TicketSource',
      Object.values(TicketSource),
      toProtoTicketSource,
      fromProtoTicketSource,
    ],
    [
      'StoragePurpose',
      Object.values(StoragePurpose),
      toProtoStoragePurpose,
      fromProtoStoragePurpose,
    ],
    [
      'ReassignmentReason',
      Object.values(ReassignmentReason),
      toProtoReassignmentReason,
      fromProtoReassignmentReason,
    ],
    [
      'MessageAnswerStatus',
      ANSWER_STATUSES,
      toProtoMessageAnswerStatus,
      fromProtoMessageAnswerStatus,
    ],
    [
      'RagAnswerStatus',
      ANSWER_STATUSES,
      toProtoRagAnswerStatus,
      fromProtoRagAnswerStatus,
    ],
    [
      'NotificationType',
      NOTIFICATION_TYPE_VALUES,
      toProtoNotificationType,
      fromProtoNotificationType,
    ],
    [
      'NotificationResourceType',
      Object.values(NotificationResourceType),
      toProtoNotificationResourceType,
      fromProtoNotificationResourceType,
    ],
  ];

  it('**covers every bridge `enumBridge` builds**', () => {
    // Guards the guard: a bridge added to `enums.ts` and forgotten here is
    // otherwise tested by nothing at all, which is the state this whole file
    // was written to leave behind.
    //
    // Read out of the source as TEXT, following `mime.spec.ts` and
    // `column-bounds.spec.ts`. Importing the module and counting its exports
    // would also count the hand-written bridges that predate `enumBridge` —
    // Gender, OtpPurpose, InvitationStatus, OrgStatus, AiModelTier, the
    // notification four and SortOrder — which `mappers.spec.ts` already covers.
    const source = readFileSync(join(__dirname, 'mappers/enums.ts'), 'utf8');
    const built = [...source.matchAll(/^const (\w+) = enumBridge/gm)].map(
      ([, name]) => name,
    );

    expect(built.length).toBeGreaterThan(0);
    expect(
      built.filter(
        (name) =>
          !bridges.some(
            ([label]) => label.toLowerCase() === name.toLowerCase(),
          ),
      ),
    ).toEqual([]);
  });

  describe.each(bridges)('%s', (_name, members, toProto, fromProto) => {
    it('round-trips every member', () => {
      for (const member of members) {
        expect(fromProto(toProto(member))).toBe(member);
      }
    });

    it('maps no member onto UNSPECIFIED', () => {
      // The zero value means "not set". A member landing there is
      // indistinguishable from an omitted field on the wire.
      //
      // `Number(...)` because the comparison is against the numeric ZERO VALUE
      // rather than against a named member — every bridge has a different enum
      // type, so there is no shared one to compare within.
      expect(members.filter((member) => Number(toProto(member)) === 0)).toEqual(
        [],
      );
    });

    it('gives every member a DISTINCT proto value', () => {
      const values = members.map((member) => toProto(member));

      expect(new Set(values).size).toBe(members.length);
    });

    it('answers null for UNSPECIFIED, UNRECOGNIZED and an unknown string', () => {
      expect(fromProto(0)).toBeNull();
      // -1 is `UNRECOGNIZED`, which ts-proto emits on every enum for a member
      // some newer build knows about.
      expect(fromProto(-1)).toBeNull();
      expect(fromProto(undefined)).toBeNull();
      // The `to` direction takes a bare `string` on purpose — its caller is
      // usually handing over a Prisma VarChar — and must answer UNSPECIFIED
      // rather than throwing on the response path.
      expect(Number(toProto('NOT_A_MEMBER'))).toBe(0);
      expect(Number(toProto(null))).toBe(0);
      expect(Number(toProto(undefined))).toBe(0);
    });
  });
});

/**
 * `AnswerStatus` is declared THREE times — once in `@synapsedesk/common` and
 * once in each of two proto packages — and `message.proto`'s copy exists
 * because importing rag's would point ticket at a package downstream of it.
 *
 * Duplication that nothing checks is how `UNRETRIEVED`/`UNCITED` became one
 * flag under a name that fitted only the first. This is that check.
 */
describe('the two AnswerStatus protos stay aligned', () => {
  const numbered = (
    members: Record<string, string | number>,
  ): [string, number][] =>
    Object.entries(members)
      .filter(([, value]) => typeof value === 'number' && value >= 0)
      .map(([name, value]) => [name, value as number]);

  it('numbers the same members identically', () => {
    const rag = numbered(ProtoRagAnswerStatus).map(
      ([name, value]) => [name.replace(/^ANSWER_STATUS_/, ''), value] as const,
    );
    const message = numbered(ProtoMessageAnswerStatus).map(
      ([name, value]) =>
        [name.replace(/^MESSAGE_ANSWER_STATUS_/, ''), value] as const,
    );

    expect(rag.length).toBeGreaterThan(1);
    expect(message).toEqual(rag);
  });

  it('the DOMAIN enum names every member both protos carry', () => {
    // A proto member with no domain counterpart is a value the column cannot
    // legally hold, which is where `'UNSPECIFIED'` used to get written into a
    // `VarChar(30)` by a `.replace()`.
    const protoMembers = numbered(ProtoRagAnswerStatus)
      .map(([name]) => name.replace(/^ANSWER_STATUS_/, ''))
      .filter((name) => name !== 'UNSPECIFIED');

    expect(protoMembers.sort()).toEqual([...ANSWER_STATUSES].sort());
  });

  it('a value crossing from rag to a message keeps its meaning', () => {
    // The crossing the gateway actually makes on the streaming path: rag's
    // numeric enum -> domain string -> persisted, then back out as ticket's.
    for (const status of ANSWER_STATUSES) {
      const overTheWireFromRag = toProtoRagAnswerStatus(status);
      const persisted = fromProtoRagAnswerStatus(overTheWireFromRag);

      expect(persisted).toBe(status);
      expect(
        fromProtoMessageAnswerStatus(toProtoMessageAnswerStatus(persisted)),
      ).toBe(status);
    }
  });

  it('REFUSED is not GREETING, in either proto', () => {
    // The two share a short-circuit in the generator and the whole
    // point of the member is that they are labelled differently — a refusal
    // filed as a greeting is wrong in the thread and in the trail.
    expect(AnswerStatus.REFUSED).not.toBe(AnswerStatus.GREETING);
    expect(toProtoRagAnswerStatus(AnswerStatus.REFUSED)).not.toBe(
      toProtoRagAnswerStatus(AnswerStatus.GREETING),
    );
    expect(toProtoMessageAnswerStatus(AnswerStatus.REFUSED)).not.toBe(
      toProtoMessageAnswerStatus(AnswerStatus.GREETING),
    );
  });
});
