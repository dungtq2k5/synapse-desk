import { status } from '@grpc/grpc-js';
import { faker } from '@faker-js/faker';
import { expectRpc } from '@synapsedesk/common/testing/rpc';
import { fromProtoTimestamp } from '@synapsedesk/grpc-proto';
import {
  AuditAction,
  AuditPublisher,
  AuditResourceType,
  DocumentFlagResolution,
  DocumentFlagSeverity,
  DocumentFlagType,
  compareAlphabetically,
} from '@synapsedesk/common';
import {
  DocumentFlagResolution as ProtoDocumentFlagResolution,
  DocumentFlagSeverity as ProtoDocumentFlagSeverity,
  DocumentFlagType as ProtoDocumentFlagType,
  type ListDocumentFlagsRequest,
  fromProtoDocumentFlagType,
  toProtoDocumentFlagType,
} from '@synapsedesk/grpc-proto';
import { E2eFixture, bootstrapE2eTest } from '../utils';
import { memberContext, pageRequest } from '../utils/context';
import {
  buildTenant,
  createDocument,
  createFlag,
  createScopedDocument,
  TenantFixture,
} from '../factories';
import { DocumentFlagsService } from '../../src/modules/document-flags/document-flags.service';
import { DocumentsService } from '../../src/modules/documents/documents.service';
import { DocumentsGrpcController } from '../../src/modules/documents/documents-grpc.controller';

/**
 * The quality worklist.
 *
 * Against a real database because every property worth proving is a `where`
 * clause: the tenant filter, the department filter that reaches through the
 * document relation, and the soft-delete filter this table has no column for.
 */
describe('Document flags (e2e)', () => {
  let fx: E2eFixture;
  let flags: DocumentFlagsService;
  // For the one test that soft-deletes through the real path rather than
  // writing `deletedAt` behind it.
  let documents: DocumentsService;
  // The transport adapter, for the one rule that can only be broken by a peer:
  // an UNSPECIFIED resolution never survives the gateway's typed routes.
  let controller: DocumentsGrpcController;
  let audit: jest.Mocked<Pick<AuditPublisher, 'record'>>;

  /** The actions published, in order. */
  const recordedActions = () =>
    audit.record.mock.calls.map(([, event]) => event.action);
  let tenant: TenantFixture;

  const manager = (t: TenantFixture = tenant) =>
    memberContext(
      { id: t.userId, organizationId: t.organizationId },
      ['document.delete'],
      { departmentIds: [t.departmentId] },
    );

  /** Same tenant, no departments — the caller a scoped document must exclude. */
  const outsider = (t: TenantFixture = tenant) =>
    memberContext(
      { id: faker.string.uuid(), organizationId: t.organizationId },
      [],
      { departmentIds: [] },
    );

  beforeAll(async () => {
    fx = await bootstrapE2eTest();
    flags = fx.moduleRef.get(DocumentFlagsService);
    documents = fx.moduleRef.get(DocumentsService);
    controller = fx.moduleRef.get(DocumentsGrpcController);
    // Spied rather than stubbed at the broker: what matters is WHICH act was
    // recorded, and NATS delivery is at-most-once by design either way.
    audit = fx.moduleRef.get(AuditPublisher);
    jest.spyOn(audit, 'record').mockReturnValue(undefined);
  }, 30_000);

  beforeEach(async () => {
    await fx.reset();
    jest.clearAllMocks();
    tenant = buildTenant();
  });

  afterAll(() => fx.close());

  describe('listDocumentFlags', () => {
    /**
     * The filter must express `UNRETRIEVED` and `UNCITED` SEPARATELY.
     *
     * They were one flag under a name that fitted only the first, and were
     * split because they are different findings with different fixes: a
     * document nobody's question came near may just be mis-titled, while one
     * retrieved twenty times and cited never is displacing the sources that
     * would have answered. A filter offering only `UNCITED` re-merges them in
     * practice — the type nobody can select is the type nobody sees.
     */
    const seedFlags = async () => {
      const unretrieved = await createDocument(fx.prisma, tenant, {
        title: 'Never found',
      });
      const uncited = await createDocument(fx.prisma, tenant, {
        title: 'Found and ignored',
      });

      await createFlag(fx.prisma, unretrieved, {
        flagType: DocumentFlagType.UNRETRIEVED,
      });
      await createFlag(fx.prisma, uncited, {
        flagType: DocumentFlagType.UNCITED,
        severity: DocumentFlagSeverity.WARNING,
      });

      return { unretrieved, uncited };
    };

    const flagsRequest = (
      overrides: Partial<{
        flagTypes: DocumentFlagType[];
        includeResolved: boolean;
      }> = {},
    ): ListDocumentFlagsRequest => ({
      flagTypes: (overrides.flagTypes ?? []).map(toProtoDocumentFlagType),
      includeResolved: overrides.includeResolved ?? false,
      page: pageRequest({ sortBy: 'detectedAt' }),
      severity: ProtoDocumentFlagSeverity.DOCUMENT_FLAG_SEVERITY_UNSPECIFIED,
      documentId: '',
    });

    it('1. returns EVERY type when no filter is given', async () => {
      await seedFlags();

      const { items } = await flags.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(
        items
          .map((flag) => fromProtoDocumentFlagType(flag.flagType)!)
          .sort(compareAlphabetically),
      ).toEqual(
        [DocumentFlagType.UNCITED, DocumentFlagType.UNRETRIEVED].sort(
          compareAlphabetically,
        ),
      );
    });

    it('2. filters to UNRETRIEVED alone', async () => {
      await seedFlags();

      const { items } = await flags.listDocumentFlags(
        flagsRequest({ flagTypes: [DocumentFlagType.UNRETRIEVED] }),
        manager(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].documentTitle).toBe('Never found');
    });

    it('3. filters to UNCITED alone', async () => {
      await seedFlags();

      const { items } = await flags.listDocumentFlags(
        flagsRequest({ flagTypes: [DocumentFlagType.UNCITED] }),
        manager(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].documentTitle).toBe('Found and ignored');
    });

    it('4. accepts BOTH at once', async () => {
      await seedFlags();

      const { items } = await flags.listDocumentFlags(
        flagsRequest({
          flagTypes: [DocumentFlagType.UNRETRIEVED, DocumentFlagType.UNCITED],
        }),
        manager(),
      );

      expect(items).toHaveLength(2);
    });

    it('5. REFUSES an unknown type rather than ignoring it', async () => {
      // Silently dropping the filter answers a different question than the one
      // asked, and "no OUTDTAED flags" reads as "nothing is outdated".
      // **The typo this used to send — `'OUTDTAED'` — is now unexpressible**,
      // which is the point of the enum. What survives is the case the enum does
      // NOT close: ts-proto maps a member this build cannot name to
      // `UNRECOGNIZED` (-1) rather than failing, so a newer peer's flag type
      // still arrives as a legal value of the type and must still be refused.
      await expectRpc(
        flags.listDocumentFlags(
          {
            ...flagsRequest(),
            flagTypes: [ProtoDocumentFlagType.UNRECOGNIZED],
          },
          manager(),
        ),
        status.INVALID_ARGUMENT,
      );
    });

    it('6. hides RESOLVED flags unless asked', async () => {
      // A resolved flag is history. Mixing history into a worklist is how a
      // worklist stops being read.
      const document = await createDocument(fx.prisma, tenant);
      await createFlag(fx.prisma, document, { resolvedAt: new Date() });

      const hidden = await flags.listDocumentFlags(flagsRequest(), manager());
      expect(hidden.items).toHaveLength(0);

      const shown = await flags.listDocumentFlags(
        flagsRequest({ includeResolved: true }),
        manager(),
      );
      expect(shown.items).toHaveLength(1);
    });

    it('7. carries the document TITLE, so the list is readable', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        title: 'Expense policy 2019',
      });
      await createFlag(fx.prisma, document);

      const { items } = await flags.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items[0].documentTitle).toBe('Expense policy 2019');
    });

    it('8. shows NOTHING from another tenant', async () => {
      const other = buildTenant();
      const document = await createDocument(fx.prisma, other);
      await createFlag(fx.prisma, document);

      const { items } = await flags.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items).toHaveLength(0);
    });

    it('**8b. shows nothing from a document outside the caller’s departments**', async () => {
      // The worklist follows the SAME boundary as `GET /documents`. Without it
      // a flag row hands `document.title` to a caller the by-id read refuses,
      // and `document.read` reaches SUPPORT_AGENT, not only KNOWLEDGE_MANAGER.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      await createFlag(fx.prisma, document);

      const { items, meta } = await flags.listDocumentFlags(
        flagsRequest(),
        outsider(),
      );

      expect(items).toHaveLength(0);
      expect(meta!.totalItems).toBe(0);
    });

    it('8c. still shows one to a member of the document’s department', async () => {
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      await createFlag(fx.prisma, document);

      const { items } = await flags.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items).toHaveLength(1);
    });

    it('9. drops a DELETED document’s flags from the worklist', async () => {
      // Otherwise the list keeps asking a reviewer to act on a document that no
      // longer exists, and the join would still surface its title.
      const document = await createDocument(fx.prisma, tenant);
      await createFlag(fx.prisma, document);
      await documents.deleteDocument({ id: document.id }, manager());

      const { items } = await flags.listDocumentFlags(
        flagsRequest(),
        manager(),
      );

      expect(items).toHaveLength(0);
    });

    it('10. filters by SEVERITY, and UNSPECIFIED means no filter', async () => {
      const document = await createDocument(fx.prisma, tenant);
      await createFlag(fx.prisma, document, {
        severity: DocumentFlagSeverity.WARNING,
        flagType: DocumentFlagType.UNCITED,
      });
      await createFlag(fx.prisma, document, {
        severity: DocumentFlagSeverity.INFO,
      });

      const warnings = await flags.listDocumentFlags(
        {
          ...flagsRequest(),
          severity: ProtoDocumentFlagSeverity.DOCUMENT_FLAG_SEVERITY_WARNING,
        },
        manager(),
      );
      const all = await flags.listDocumentFlags(flagsRequest(), manager());

      expect(warnings.items).toHaveLength(1);
      expect(all.items).toHaveLength(2);
    });

    it('11. filters by DOCUMENT, which is the quality history of one document', async () => {
      const subject = await createDocument(fx.prisma, tenant);
      const other = await createDocument(fx.prisma, tenant);
      await createFlag(fx.prisma, subject);
      await createFlag(fx.prisma, other);

      const { items, meta } = await flags.listDocumentFlags(
        { ...flagsRequest(), documentId: subject.id },
        manager(),
      );

      expect(items).toHaveLength(1);
      expect(items[0].documentId).toBe(subject.id);
      // The count follows the filter, or a paginated worklist reports a total
      // it will never hand over.
      expect(meta!.totalItems).toBe(1);
    });
  });

  describe('getDocumentFlag', () => {
    it('16. carries the detail view’s columns, not just the worklist’s', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const related = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document, {
        relatedDocumentId: related.id,
        confidenceScore: 0.87,
      });

      const found = await flags.getDocumentFlag(flag.id, manager());

      expect(found.id).toBe(flag.id);
      expect(found.documentTitle).toBe(document.title);
      expect(found.relatedDocumentId).toBe(related.id);
      expect(found.confidenceScore).toBeCloseTo(0.87);
    });

    it('**17. another tenant’s flag is NOT_FOUND, never PERMISSION_DENIED**', async () => {
      // One query carries both predicates, so "no such flag" and "not yours"
      // cannot diverge into a distinguishable answer.
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const flag = await createFlag(fx.prisma, theirs);

      await expectRpc(
        flags.getDocumentFlag(flag.id, manager()),
        status.NOT_FOUND,
      );
    });

    it('**18. a flag on a document outside the caller’s departments is NOT_FOUND**', async () => {
      // The sharper half of ADR 0037: a single-row read of a named document
      // that `GET /documents/:id` would refuse to acknowledge.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      const flag = await createFlag(fx.prisma, document);

      await expectRpc(
        flags.getDocumentFlag(flag.id, outsider()),
        status.NOT_FOUND,
      );
    });
  });

  describe('the audit trail', () => {
    it('**a dismissal and a fix record DIFFERENT actions**', async () => {
      // Dismissal suppresses the detector and the other resolutions do not, so
      // "who silenced this" has to be answerable without reading metadata.
      const document = await createDocument(fx.prisma, tenant);
      const dismissed = await createFlag(fx.prisma, document);
      const fixed = await createFlag(fx.prisma, document, {
        flagType: DocumentFlagType.UNCITED,
      });

      await flags.resolve(
        dismissed.id,
        DocumentFlagResolution.DISMISSED,
        manager(),
        'seasonal',
      );
      await flags.resolve(fixed.id, DocumentFlagResolution.FIXED, manager());

      expect(recordedActions()).toEqual([
        AuditAction.DOCUMENT_FLAG_DISMISSED,
        AuditAction.DOCUMENT_FLAG_RESOLVED,
      ]);
    });

    it('**a delete is audited — the row leaves no other trace**', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      await flags.deleteDocumentFlag(flag.id, manager());

      const [command] = audit.record.mock.calls.map(([, event]) => event);
      expect(command.action).toBe(AuditAction.DOCUMENT_FLAG_DELETED);
      expect(command.resourceId).toBe(flag.id);
      expect(command.resourceType).toBe(AuditResourceType.DOCUMENT_FLAG);
    });

    it('**a deleted RESOLVED flag records whose decision was destroyed**', async () => {
      // The delete row is the only trace. Without the resolution, deleting a
      // dismissed flag loses that it had ever been dismissed — and the
      // DOCUMENT_FLAG_DISMISSED event is a separate row a reader has to know to
      // go looking for.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);
      await flags.resolve(
        flag.id,
        DocumentFlagResolution.DISMISSED,
        manager(),
        'seasonal',
      );

      await flags.deleteDocumentFlag(flag.id, manager());

      const [, [, deleted]] = audit.record.mock.calls;
      expect(deleted.metadata).toMatchObject({
        documentId: document.id,
        resolution: DocumentFlagResolution.DISMISSED,
        resolvedById: tenant.userId,
      });
    });

    it('**NO event carries the comment — not the resolve, not the delete**', async () => {
      // `resolution_comment` is on the row. Copying it here would put a
      // person's words about somebody's document into a second store with a
      // different retention and a different audience.
      //
      // Every call, not the first: the delete row names what it destroyed, and
      // `resolution` and `resolvedById` are exactly the fields someone reaches
      // for the comment alongside.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      await flags.resolve(
        flag.id,
        DocumentFlagResolution.DISMISSED,
        manager(),
        'the author never updates this',
      );
      await flags.deleteDocumentFlag(flag.id, manager());

      expect(audit.record).toHaveBeenCalledTimes(2);
      for (const [, event] of audit.record.mock.calls) {
        expect(JSON.stringify(event)).not.toContain('never updates');
      }
    });

    it('a REFUSED write records nothing', async () => {
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const flag = await createFlag(fx.prisma, theirs);

      await expectRpc(
        flags.deleteDocumentFlag(flag.id, manager()),
        status.NOT_FOUND,
      );

      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('the resolve adapter', () => {
    it('**refuses UNSPECIFIED — a legal enum value, not a legal resolution**', async () => {
      // ts-proto maps anything it cannot name to a value of the enum type, and
      // the zero value is what an omitted field sends. Refused rather than
      // defaulted: guessing which of the three a caller meant is worse than
      // asking. The service's own parameter is the DOMAIN enum, where
      // UNSPECIFIED cannot be represented at all — so the check lives here.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      await expectRpc(
        controller.resolveDocumentFlag({
          id: flag.id,
          resolution:
            ProtoDocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_UNSPECIFIED,
        }),
        status.INVALID_ARGUMENT,
      );

      const after = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(after.resolvedAt).toBeNull();
    });
  });

  describe('deleteDocumentFlag', () => {
    it('19. removes the row outright — there is no soft delete here', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      const result = await flags.deleteDocumentFlag(flag.id, manager());

      expect(result.deleted).toBe(true);
      expect(
        await fx.prisma.documentFlag.findUnique({ where: { id: flag.id } }),
      ).toBeNull();
    });

    it('**20. another tenant’s flag is NOT_FOUND, and the row SURVIVES**', async () => {
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const flag = await createFlag(fx.prisma, theirs);

      await expectRpc(
        flags.deleteDocumentFlag(flag.id, manager()),
        status.NOT_FOUND,
      );

      // The assertion that matters: a refused delete must not have deleted.
      expect(
        await fx.prisma.documentFlag.findUnique({ where: { id: flag.id } }),
      ).not.toBeNull();
    });

    it('21. a flag on a document outside the caller’s departments is NOT_FOUND', async () => {
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      const flag = await createFlag(fx.prisma, document);

      await expectRpc(
        flags.deleteDocumentFlag(flag.id, outsider()),
        status.NOT_FOUND,
      );
    });
  });

  describe('resolve', () => {
    it('12. records WHO, when, and why', async () => {
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      const resolved = await flags.resolve(
        flag.id,
        DocumentFlagResolution.DISMISSED,
        manager(),
        'the title is fine, this document is seasonal',
      );

      expect(resolved.resolution).toBe(
        ProtoDocumentFlagResolution.DOCUMENT_FLAG_RESOLUTION_DISMISSED,
      );
      expect(resolved.resolvedById).toBe(tenant.userId);
      expect(resolved.resolvedAt).toBeDefined();
      expect(resolved.resolutionComment).toBe(
        'the title is fine, this document is seasonal',
      );
    });

    it('**12b. DISMISSED without a reason is INVALID_ARGUMENT**', async () => {
      // The rule the schema deliberately does not carry: a nullable column
      // would force FIXED and DOCUMENT_REPLACED to invent a string. When the
      // flag returns after the window, this comment is what the next person
      // reads.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      await expectRpc(
        flags.resolve(flag.id, DocumentFlagResolution.DISMISSED, manager()),
        status.INVALID_ARGUMENT,
      );

      // Whitespace is not a reason either.
      await expectRpc(
        flags.resolve(
          flag.id,
          DocumentFlagResolution.DISMISSED,
          manager(),
          '   ',
        ),
        status.INVALID_ARGUMENT,
      );

      const after = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(after.resolvedAt).toBeNull();
    });

    it('12c. FIXED and DOCUMENT_REPLACED need no comment', async () => {
      // Only dismissal asks for a reason — the other two assert a change was
      // made, and requiring prose would have them invent it.
      const document = await createDocument(fx.prisma, tenant);
      const fixed = await createFlag(fx.prisma, document);
      const replaced = await createFlag(fx.prisma, document, {
        flagType: DocumentFlagType.UNCITED,
      });

      await expect(
        flags.resolve(fixed.id, DocumentFlagResolution.FIXED, manager()),
      ).resolves.toBeDefined();
      await expect(
        flags.resolve(
          replaced.id,
          DocumentFlagResolution.DOCUMENT_REPLACED,
          manager(),
        ),
      ).resolves.toBeDefined();
    });

    it('**12d. a resolved flag cannot be resolved AGAIN, and nothing is overwritten**', async () => {
      // Resolution is once. A second write would move `resolvedAt` forward —
      // restarting the suppression window — and replace the resolution, the
      // resolver and the reason. "Refused" and "refused after writing" have to
      // be distinguishable, so the assertions are on the ROW, not the throw.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);

      const first = await flags.resolve(
        flag.id,
        DocumentFlagResolution.DISMISSED,
        manager(),
        'seasonal, not stale',
      );

      await expectRpc(
        flags.resolve(flag.id, DocumentFlagResolution.FIXED, manager()),
        status.FAILED_PRECONDITION,
      );

      const after = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(after.resolution).toBe(DocumentFlagResolution.DISMISSED);
      expect(after.resolutionComment).toBe('seasonal, not stale');
      expect(after.resolvedAt?.toISOString()).toBe(
        fromProtoTimestamp(first.resolvedAt)?.toISOString(),
      );
    });

    it('**12e. the refusal NAMES the resolution already recorded**', async () => {
      // Otherwise the caller cannot tell whether they need the delete path.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);
      await flags.resolve(flag.id, DocumentFlagResolution.FIXED, manager());

      await expect(
        flags.resolve(flag.id, DocumentFlagResolution.FIXED, manager()),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          DocumentFlagResolution.FIXED,
        ) as string,
      });
    });

    it('12f. re-dismissing cannot extend the suppression window', async () => {
      // The invariant §2 was written to hold: one wrong click must not be able
      // to remove a document from a quality signal for the life of the tenant.
      const document = await createDocument(fx.prisma, tenant);
      const flag = await createFlag(fx.prisma, document);
      await flags.resolve(
        flag.id,
        DocumentFlagResolution.DISMISSED,
        manager(),
        'first reason',
      );

      const dismissedAt = (
        await fx.prisma.documentFlag.findUniqueOrThrow({
          where: { id: flag.id },
        })
      ).resolvedAt;

      await expectRpc(
        flags.resolve(
          flag.id,
          DocumentFlagResolution.DISMISSED,
          manager(),
          'second reason',
        ),
        status.FAILED_PRECONDITION,
      );

      const after = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(after.resolvedAt).toEqual(dismissedAt);
    });

    it('**13. another tenant’s flag is NOT_FOUND, and the row is untouched**', async () => {
      // The unscoped `update({ where: { id } })` this replaced would have
      // resolved it — `findUnique` cannot express a tenant filter at all.
      const stranger = buildTenant();
      const theirs = await createDocument(fx.prisma, stranger);
      const flag = await createFlag(fx.prisma, theirs);

      await expectRpc(
        flags.resolve(flag.id, DocumentFlagResolution.FIXED, manager()),
        status.NOT_FOUND,
      );

      const after = await fx.prisma.documentFlag.findUniqueOrThrow({
        where: { id: flag.id },
      });
      expect(after.resolvedAt).toBeNull();
    });

    it('**14. a flag on a document outside the caller’s departments is NOT_FOUND**', async () => {
      // ADR 0037 reaches the write path too: a caller who cannot see the
      // document must not be able to close findings about it.
      const document = await createScopedDocument(fx.prisma, tenant, [
        tenant.departmentId,
      ]);
      const flag = await createFlag(fx.prisma, document);

      await expectRpc(
        flags.resolve(flag.id, DocumentFlagResolution.FIXED, outsider()),
        status.NOT_FOUND,
      );
    });

    it('15. a flag on a SOFT-DELETED document is NOT_FOUND', async () => {
      const document = await createDocument(fx.prisma, tenant, {
        deletedAt: new Date(),
        deletedById: tenant.userId,
      });
      const flag = await createFlag(fx.prisma, document);

      await expectRpc(
        flags.resolve(flag.id, DocumentFlagResolution.FIXED, manager()),
        status.NOT_FOUND,
      );
    });
  });
});
