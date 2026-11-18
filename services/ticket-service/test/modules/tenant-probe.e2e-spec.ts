import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  AuditAction,
  AuditResourceType,
  ExportKind,
  PERMISSION_CODES,
  ReassignmentReason,
  TicketPriority,
  TicketStatus,
} from '@synapsedesk/contracts';
import {
  toProtoExportKind,
  toProtoReassignmentReason,
  toProtoTicketPriority,
  toProtoTicketStatus,
} from '@synapsedesk/grpc-proto';
import { pageRequest } from '@synapsedesk/grpc-proto/testing/page';
import {
  CLEAN,
  controllerCall,
  type IdTakingMethod,
  idTakingMethods,
  probeCall,
  superAdminReach,
  snapshot,
  tenantIdentifiers,
  wireRequest,
} from '@synapsedesk/grpc-proto/testing/tenant-probe';
import { memberContext, superAdminContext } from '@synapsedesk/testing/context';
import { E2eFixture, bootstrapE2eTest } from '../utils/bootstrap';
import {
  buildTenant,
  createAiMessage,
  createAiSummary,
  createAssignedTicket,
  createAttachment,
  createAuditLog,
  createFeedback,
  createMessage,
} from '../factories';
import { AiGrpcController } from '../../src/modules/ai/ai-grpc.controller';
import { AnalyticsGrpcController } from '../../src/modules/analytics/analytics-grpc.controller';
import { AssignmentsGrpcController } from '../../src/modules/assignments/assignments-grpc.controller';
import { AuditGrpcController } from '../../src/modules/audit/audit-grpc.controller';
import { FeedbackGrpcController } from '../../src/modules/feedback/feedback-grpc.controller';
import { MessagesGrpcController } from '../../src/modules/messages/messages-grpc.controller';
import { TicketsGrpcController } from '../../src/modules/tickets/tickets-grpc.controller';

/**
 * **The cross-tenant probe**: every RPC that takes an id, called by tenant
 * B's most privileged member on tenant A's ids, answers as it does for an id
 * that doesn't exist, names nothing of A's, and leaves A's rows as they were.
 *
 * The RPC list comes from the proto files (`idTakingMethods`), and the first
 * row holds this table to it: a new id-taking RPC fails here until it says
 * how to call it.
 */
describe('Cross-tenant probe: ticket-service (e2e)', () => {
  let fx: E2eFixture;
  let controllers: Record<string, object>;

  const B = buildTenant();
  const asB = memberContext(
    { id: B.agentId, organizationId: B.organizationId },
    [...PERMISSION_CODES],
    { departmentIds: [B.departmentId] },
  );

  type A = Awaited<ReturnType<typeof seedA>>;

  /** Tenant A with one of everything this service stores. */
  async function seedA() {
    const tenant = buildTenant();
    const { ticket } = await createAssignedTicket(fx.prisma, tenant);
    const message = await createMessage(fx.prisma, ticket.id, {
      senderId: tenant.userId,
    });
    const generation = randomUUID();
    const aiMessage = await createAiMessage(fx.prisma, ticket.id);
    const attachment = await createAttachment(fx.prisma, message.id);
    await createAiSummary(fx.prisma, ticket.id);
    await createFeedback(fx.prisma, {
      ticketMessageId: aiMessage.id,
      userId: tenant.agentId,
      organizationId: tenant.organizationId,
    });
    await fx.prisma.ticketStatusChange.create({
      data: {
        ticketId: ticket.id,
        organizationId: tenant.organizationId,
        toStatus: TicketStatus.OPEN,
        changedById: tenant.agentId,
      },
    });
    await fx.prisma.ticketReadState.create({
      data: {
        ticketId: ticket.id,
        userId: tenant.agentId,
        organizationId: tenant.organizationId,
        lastReadAt: new Date(),
      },
    });
    await createAuditLog(fx.prisma, {
      organizationId: tenant.organizationId,
      userId: tenant.agentId,
      action: AuditAction.USER_CREATED,
      resourceType: AuditResourceType.USER,
      resourceId: tenant.userId,
    });
    const inboundMessageId = `<${randomUUID()}@mail.test>`;
    await fx.prisma.inboundEmail.create({
      data: {
        organizationId: tenant.organizationId,
        messageId: inboundMessageId,
      },
    });
    const exported = await fx.prisma.export.create({
      data: {
        organizationId: tenant.organizationId,
        requestedById: tenant.agentId,
        kind: ExportKind.TICKET,
        fromDay: new Date('2026-11-01'),
        toDay: new Date('2026-11-07'),
      },
    });
    await fx.prisma.ticketDailyStat.create({
      data: {
        organizationId: tenant.organizationId,
        day: new Date('2026-11-02'),
      },
    });
    await fx.prisma.agentDailyStat.create({
      data: {
        organizationId: tenant.organizationId,
        day: new Date('2026-11-02'),
        agentId: tenant.agentId,
      },
    });

    return {
      ...tenant,
      ticket: ticket.id,
      message: message.id,
      aiMessage: aiMessage.id,
      generation,
      attachment: attachment.id,
      attachmentPath: attachment.fileUrl,
      inboundMessageId,
      export: exported.id,
    };
  }

  type Row =
    | {
        build: (a: A) => Record<string, unknown>;
        /** The finding this row holds as a known failure until the scoped client closes it. */
        knownFailure?: string;
      }
    | { exempt: string };

  const ticketId = (a: A) => ({ ticketId: a.ticket });
  const id = (a: A) => ({ id: a.ticket });
  const range = (a: A) => ({
    from: '2026-11-01',
    to: '2026-11-07',
    departmentId: a.departmentId,
    granularity: 'day',
  });

  /** How to call each id-taking RPC with A's ids. */
  const PROBE: Record<string, Row> = {
    'AiService/GenerateSummary': { build: ticketId },
    'AiService/GetSummary': { build: ticketId },
    'AiService/GenerateDraft': {
      build: (a) => ({ ticketId: a.ticket, instruction: 'shorter' }),
    },
    'AiService/GetSuggestions': { build: ticketId },
    'AiService/ClassifyTicket': { build: ticketId },
    'AiService/ListSimilarTickets': { build: ticketId },
    'AnalyticsService/CreateExport': {
      build: (a) => ({
        kind: toProtoExportKind(ExportKind.TICKET),
        from: '2026-11-01',
        to: '2026-11-07',
        departmentId: a.departmentId,
        filters: '',
      }),
    },
    'AnalyticsService/GetExport': { build: (a) => ({ id: a.export }) },
    'AnalyticsService/GetOverview': { build: range },
    'AnalyticsService/GetDeflection': { build: range },
    'AnalyticsService/GetResponseTimes': { build: range },
    'AnalyticsService/GetVolume': { build: range },
    'AnalyticsService/GetSatisfaction': { build: range },
    'AnalyticsService/GetAgentStats': { build: range },
    'AssignmentService/AssignTicket': {
      build: (a) => ({
        ticketId: a.ticket,
        assigneeId: a.agentId,
        departmentId: a.departmentId,
        reason: toProtoReassignmentReason(ReassignmentReason.LOAD_BALANCING),
      }),
    },
    'AssignmentService/AssignTicketToSelf': {
      build: (a) => ({ ticketId: a.ticket, departmentId: a.departmentId }),
    },
    'AssignmentService/ReassignTicket': {
      build: (a) => ({
        ticketId: a.ticket,
        assigneeId: a.agentId,
        departmentId: a.departmentId,
        reason: toProtoReassignmentReason(ReassignmentReason.LOAD_BALANCING),
      }),
    },
    'AssignmentService/UnassignTicket': {
      build: (a) => ({ ticketId: a.ticket, reason: 'B' }),
    },
    'AssignmentService/ListAssignments': { build: ticketId },
    'AuditService/ListAuditLogs': {
      build: (a) => ({
        page: pageRequest(),
        userId: a.agentId,
        resourceId: a.userId,
      }),
    },
    'FeedbackService/SubmitFeedback': {
      build: (a) => ({
        ticketMessageId: a.aiMessage,
        rating: -1,
        feedbackText: 'B',
      }),
    },
    'FeedbackService/GetFeedback': {
      build: (a) => ({ ticketMessageId: a.aiMessage }),
    },
    'FeedbackService/WithdrawFeedback': {
      build: (a) => ({ ticketMessageId: a.aiMessage }),
    },
    'MessageService/CreateMessage': {
      build: (a) => ({
        ticketId: a.ticket,
        content: 'B was here',
        generatedFromId: a.generation,
      }),
    },
    'MessageService/AppendAiMessage': {
      build: (a) => ({
        ticketId: a.ticket,
        content: 'B was here',
        generationId: a.generation,
      }),
    },
    'MessageService/ListMessages': {
      build: (a) => ({ ticketId: a.ticket, page: pageRequest() }),
    },
    'MessageService/UpdateMessage': {
      build: (a) => ({
        ticketId: a.ticket,
        messageId: a.message,
        content: 'B was here',
      }),
    },
    'MessageService/RedactMessage': {
      build: (a) => ({ ticketId: a.ticket, messageId: a.message }),
    },
    'MessageService/ExcludeFromAiContext': {
      build: (a) => ({ ticketId: a.ticket, messageId: a.message }),
    },
    'MessageService/AnswerOpening': { build: ticketId },
    'MessageService/UploadAttachment': {
      build: (a) => ({
        ticketId: a.ticket,
        messageId: a.message,
        fileName: 'b.pdf',
        fileSizeBytes: 1024,
        mimeType: 'application/pdf',
      }),
    },
    'MessageService/IngestAttachment': {
      build: (a) => ({
        ticketId: a.ticket,
        fileName: 'b.pdf',
        fileSizeBytes: 1024,
        mimeType: 'application/pdf',
        sourceUrl: 'https://files.example.test/b.pdf',
      }),
    },
    'MessageService/ConfirmAttachment': {
      build: (a) => ({
        ticketId: a.ticket,
        messageId: a.message,
        objectPath: a.attachmentPath,
        fileName: 'b.pdf',
      }),
    },
    'MessageService/DownloadAttachment': {
      build: (a) => ({ attachmentId: a.attachment }),
    },
    'MessageService/GetAiAttachments': {
      build: (a) => ({ messageId: a.message }),
    },
    'MessageService/DeleteAttachment': {
      build: (a) => ({ attachmentId: a.attachment }),
    },
    'MessageService/ListAttachments': {
      build: (a) => ({ ticketId: a.ticket, messageId: a.message }),
    },
    'TicketService/ListTicketsByIds': {
      build: (a) => ({ ticketIds: [a.ticket] }),
    },
    'TicketService/CreateTicket': {
      // `authorId` and `inboundMessageId` are the inbound-mail path's: B's
      // member must not file a ticket as A's user, or claim A's mail.
      build: (a) => ({
        title: 'B',
        description: 'B',
        priority: toProtoTicketPriority(TicketPriority.LOW),
        authorId: a.userId,
        inboundMessageId: a.inboundMessageId,
      }),
    },
    'TicketService/GetTicket': { build: id },
    'TicketService/ListTickets': {
      build: (a) => ({
        page: pageRequest(),
        assigneeId: a.agentId,
        departmentId: a.departmentId,
        authorId: a.userId,
        includeDeleted: true,
      }),
    },
    'TicketService/UpdateTicket': {
      build: (a) => ({
        id: a.ticket,
        title: 'B was here',
        priority: toProtoTicketPriority(TicketPriority.LOW),
      }),
    },
    'TicketService/ChangeTicketStatus': {
      build: (a) => ({
        id: a.ticket,
        status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
        reason: 'B',
      }),
    },
    'TicketService/EscalateTicket': {
      build: (a) => ({ ticketId: a.ticket, reason: 'B' }),
    },
    'TicketService/ResolveTicket': {
      build: (a) => ({ ticketId: a.ticket, reason: 'B' }),
    },
    'TicketService/ReopenTicket': {
      build: (a) => ({ ticketId: a.ticket, reason: 'B' }),
    },
    'TicketService/CloseTicket': {
      build: (a) => ({ ticketId: a.ticket, reason: 'B' }),
    },
    'TicketService/BulkChangeTicketStatus': {
      build: (a) => ({
        ticketIds: [a.ticket],
        status: toProtoTicketStatus(TicketStatus.PENDING_AGENT),
        reason: 'B',
      }),
    },
    'TicketService/BulkChangeTicketPriority': {
      build: (a) => ({
        ticketIds: [a.ticket],
        priority: toProtoTicketPriority(TicketPriority.LOW),
      }),
    },
    'TicketService/ListTicketStatusChanges': { build: id },
    'TicketService/MarkTicketRead': { build: ticketId },
    'TicketService/DeleteTicket': { build: id },
    'TicketService/RestoreTicket': { build: id },
  };

  const methods = idTakingMethods('ticket');

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    controllers = {
      AiService: fx.moduleRef.get(AiGrpcController),
      AnalyticsService: fx.moduleRef.get(AnalyticsGrpcController),
      AssignmentService: fx.moduleRef.get(AssignmentsGrpcController),
      AuditService: fx.moduleRef.get(AuditGrpcController),
      FeedbackService: fx.moduleRef.get(FeedbackGrpcController),
      MessageService: fx.moduleRef.get(MessagesGrpcController),
      TicketService: fx.moduleRef.get(TicketsGrpcController),
    };
  });

  afterAll(async () => fx.close());

  beforeEach(async () => fx.reset());

  /** A's world for one row: A seeded, A's identifiers, and the request on A's ids. */
  const setUp = async (name: string, method: IdTakingMethod) => {
    const a = await seedA();
    // A's rows here, plus values that are A's data without being ids.
    const local = new Set([
      ...tenantIdentifiers(await snapshot(fx.prisma), a.organizationId),
      a.attachmentPath,
      a.inboundMessageId,
    ]);
    const foreign = new Set([
      a.userId,
      a.agentId,
      a.departmentId,
      a.generation,
    ]);
    const row = PROBE[name] as { build: (a: A) => Record<string, unknown> };

    return { local, foreign, request: wireRequest(method, row.build(a)) };
  };

  it('**no row is a known failure**: every cross-tenant reach found here is closed', () => {
    expect(
      Object.keys(PROBE).filter((name) => 'knownFailure' in PROBE[name]),
    ).toEqual([]);
  });

  it('**every id-taking RPC has a row**, and no row names an RPC that is gone', () => {
    expect(Object.keys(PROBE).sort()).toEqual(
      methods.map((m) => m.name).sort(),
    );
  });

  const probe = async (name: string, method: IdTakingMethod) => {
    const { request, local, foreign } = await setUp(name, method);

    const report = await probeCall({
      request,
      call: controllerCall(controllers, name, asB),
      local,
      foreign,
      prisma: fx.prisma,
    });

    expect(report).toEqual({
      ...CLEAN,
      onA: report.onA,
      onMissing: report.onMissing,
    });
  };

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map((method) => [method.name, method] as const),
  )(
    '**%s** as tenant B on A’s ids: answers as for a missing id, names nothing of A’s, changes nothing of A’s',
    probe,
  );
  /**
   * **What a Super Admin reaches** on each id-taking RPC, called through the
   * tenant route with no tenant, as the gateway lets a Super Admin do. The
   * expectation is the behavior before the scoped client, recorded by running
   * these rows against `a53b7797`. A change to who a Super Admin reaches fails
   * a row; one that reaches A's data says why.
   *
   * `PROBE_RECORD=<file>` writes each outcome to the file instead.
   */
  const SUPER_ADMIN: Record<string, string> = {
    'AiService/ClassifyTicket': 'refused UNAVAILABLE',
    'AiService/GenerateDraft': 'refused UNAVAILABLE',
    'AiService/GenerateSummary': 'refused UNAVAILABLE',
    'AiService/GetSuggestions': 'refused UNAVAILABLE',
    'AiService/GetSummary':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'AiService/ListSimilarTickets': 'refused UNAVAILABLE',
    'AnalyticsService/CreateExport': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetAgentStats': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetDeflection': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetExport': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetOverview': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetResponseTimes': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetSatisfaction': 'refused FAILED_PRECONDITION',
    'AnalyticsService/GetVolume': 'refused FAILED_PRECONDITION',
    'AssignmentService/AssignTicket': 'refused UNAVAILABLE',
    'AssignmentService/AssignTicketToSelf': 'refused UNAVAILABLE',
    'AssignmentService/ListAssignments':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'AssignmentService/ReassignTicket': 'refused UNAVAILABLE',
    'AssignmentService/UnassignTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'AuditService/ListAuditLogs': 'refused FAILED_PRECONDITION',
    'FeedbackService/GetFeedback': 'refused FAILED_PRECONDITION',
    'FeedbackService/SubmitFeedback': 'refused FAILED_PRECONDITION',
    'FeedbackService/WithdrawFeedback': 'refused FAILED_PRECONDITION',
    'MessageService/AnswerOpening': 'refused PERMISSION_DENIED',
    'MessageService/AppendAiMessage':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'MessageService/ConfirmAttachment': 'refused UNAVAILABLE',
    'MessageService/CreateMessage': 'refused PERMISSION_DENIED',
    'MessageService/DeleteAttachment':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'MessageService/DownloadAttachment': 'refused NOT_FOUND',
    'MessageService/ExcludeFromAiContext':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'MessageService/GetAiAttachments': 'answers',
    'MessageService/IngestAttachment': 'refused UNAVAILABLE',
    'MessageService/ListAttachments':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'MessageService/ListMessages':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'MessageService/RedactMessage':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'MessageService/UpdateMessage': 'refused PERMISSION_DENIED',
    'MessageService/UploadAttachment': 'refused UNAVAILABLE',
    'TicketService/BulkChangeTicketPriority':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/BulkChangeTicketStatus':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/ChangeTicketStatus':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/CloseTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/CreateTicket': 'refused FAILED_PRECONDITION',
    'TicketService/DeleteTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/EscalateTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/GetTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/ListTicketStatusChanges':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/ListTickets':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/ListTicketsByIds':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/MarkTicketRead':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/ReopenTicket': 'refused ABORTED',
    'TicketService/ResolveTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
    'TicketService/RestoreTicket': 'refused FAILED_PRECONDITION',
    'TicketService/UpdateTicket':
      "reaches: a Super Admin works any tenant's tickets; no tenant filter for one, by design",
  };
  const asSuperAdmin = () => superAdminContext();

  it('**every id-taking RPC has a Super Admin expectation**', () => {
    if (process.env.PROBE_RECORD) return;
    expect(Object.keys(SUPER_ADMIN).sort()).toEqual(
      methods
        .filter((method) => 'build' in PROBE[method.name])
        .map((method) => method.name)
        .sort(),
    );
  });

  it.each(
    methods
      .filter((method) => 'build' in PROBE[method.name])
      .map(
        (method) =>
          [
            method.name,
            SUPER_ADMIN[method.name] ?? 'unrecorded',
            method,
          ] as const,
      ),
  )(
    '**%s** as a Super Admin on A’s ids: %s',
    async (name, expected, method) => {
      const { request, local, foreign } = await setUp(name, method);

      const reached = await superAdminReach({
        request,
        call: controllerCall(controllers, name, asSuperAdmin()),
        local,
        foreign,
        prisma: fx.prisma,
      });

      if (process.env.PROBE_RECORD) {
        appendFileSync(
          process.env.PROBE_RECORD,
          `${JSON.stringify([name, reached])}\n`,
        );
        return;
      }
      expect(reached).toBe(expected.split(':')[0]);
    },
  );
});
