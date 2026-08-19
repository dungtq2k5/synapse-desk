import { ConfigService } from '@nestjs/config';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { createHash, randomUUID } from 'node:crypto';
import {
  ListDocumentChunksByIdsRequest,
  ListDocumentChunksByIdsResponse,
  ListDocumentsByIdsRequest,
  ListDocumentsByIdsResponse,
  CallerContext,
  ConfirmDocumentRequest,
  DeleteDocumentResponse,
  DocumentIdRequest,
  DocumentResponse,
  DownloadDocumentResponse,
  emptyPage,
  GetDocumentChunkRequest,
  ListDocumentChunksRequest,
  DocumentChunkResponse,
  ListDocumentChunksResponse,
  fromProtoDocumentFileType,
  fromProtoDocumentFlagType,
  fromProtoDocumentStatus,
  ListDocumentFlagsRequest,
  ListDocumentFlagsResponse,
  ListDocumentDepartmentsResponse,
  ListDocumentsRequest,
  ListDocumentsResponse,
  PresignDocumentRequest,
  PresignDocumentResponse,
  SetDocumentDepartmentsRequest,
  StorageUsageResponse,
  toPageMeta,
  toPrismaPage,
  toSearchFilter,
  toProtoTimestamp,
  UpdateDocumentRequest,
} from '@synapsedesk/grpc-proto';
import {
  BATCH_CHUNK_LIMIT,
  BATCH_ID_LIMIT,
  normalizeBatchIds,
  ALLOWED_DOCUMENT_MIME_TYPES,
  type AllowedDocumentMimeType,
  DOCUMENT_CHUNK_SORTABLE_FIELDS,
  DOCUMENT_FLAG_SORTABLE_FIELDS,
  DocumentFlagType,
  DOCUMENT_PATTERNS,
  DOCUMENT_SORTABLE_FIELDS,
  DocumentStatus,
  extensionFor,
  IngestionJobStatus,
  isUniqueConstraintViolation,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TITLE_LENGTH,
  requireActor,
  requireTenant,
  restoreData,
  softDeleteData,
} from '@synapsedesk/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthReferenceService } from '../auth-client/auth-reference.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';
import { DocumentEventPublisher } from '../events/document-event.publisher';
import { ScopeWriterService } from '../ingestion/scope-writer.service';
import { ScopeFanoutQueueService } from '../ingestion/scope-fanout-queue.service';
import { Prisma } from '../../generated/prisma/client';
import { documentVisibility } from '../../common/document-visibility';
import {
  DOCUMENT_INCLUDE,
  DocumentWithScope,
  toDocumentChunkResponse,
  toDocumentFlagResponse,
  toDocumentResponse,
} from './document.mapper';

/** The partial unique index the seeder applies: one live hash per tenant. */
const DOCUMENT_HASH_INDEX = 'documents_org_hash_key';

/**
 * The knowledge base's document surface.
 *
 * Three rules run through everything here and each is a security property
 * rather than a convenience:
 *
 *   - **Visibility is org-wide ∪ the caller's departments**, never tenant
 *     scoping alone (RDM §1.2). This is the same predicate `rag-service`
 *     enforces in retrieval, and the two must agree — a document invisible in
 *     the list but retrievable by the RAG pipeline is a disclosure.
 *   - **The quota gate is at presign**, before signing, so a tenant over
 *     `max_storage_bytes` never receives a usable upload URL.
 *   - **The row is created at CONFIRM**, so an abandoned presign leaves nothing
 *     pointing at an object that never arrived.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  /**
   * How long a download URL is ADVERTISED as valid.
   *
   * Deliberately shorter than the real lifetime storage-service signs it for —
   * see DOWNLOAD_URL_TTL_SECONDS in env.validation.ts for the constraint and
   * why the margin points this way.
   */
  private readonly downloadUrlTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authReference: AuthReferenceService,
    private readonly storage: StorageReferenceService,
    private readonly events: DocumentEventPublisher,
    private readonly scopeWriter: ScopeWriterService,
    private readonly fanoutQueue: ScopeFanoutQueueService,
    configService: ConfigService,
  ) {
    this.downloadUrlTtlMs =
      configService.getOrThrow<number>('DOWNLOAD_URL_TTL_SECONDS') * 1000;
  }

  // -------------------------------------------------------------------------
  // Upload — presign, then confirm
  // -------------------------------------------------------------------------

  /**
   * Gate on quota, THEN sign.
   *
   * The order is the whole point: a tenant already over `max_storage_bytes`
   * must be refused here rather than after they have uploaded 25 MB. The test
   * for this asserts storage-service was never called, because "also rejected
   * downstream" is not the same guarantee.
   */
  async presignDocument(
    request: PresignDocumentRequest,
    context: CallerContext,
  ): Promise<PresignDocumentResponse> {
    const organizationId = requireTenant(context);
    requireActor(context);

    this.assertUploadable(request.contentType, Number(request.sizeBytes));

    const [limitBytes, usedBytes] = await Promise.all([
      this.authReference.getStorageLimitBytes(context),
      this.usedBytes(organizationId),
    ]);

    if (usedBytes + Number(request.sizeBytes) > limitBytes) {
      // RESOURCE_EXHAUSTED -> 429 at the gateway. Not PERMISSION_DENIED: the
      // caller is allowed to upload documents, they have simply run out of
      // room, and 403 would send an admin looking at role grants.
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `This workspace has used ${usedBytes} of ${limitBytes} bytes of document storage`,
      });
    }

    // The id the ROW will have. There is no row yet — it is created at confirm
    // — so the path carries the future id, which is what lets confirm tie the
    // object back to the request that authorized it.
    const documentId = randomUUID();

    const presigned = await this.storage.presignDocument(
      {
        documentId,
        contentType: request.contentType,
        sizeBytes: Number(request.sizeBytes),
        fileName: request.fileName,
      },
      context,
    );

    return {
      uploadUrl: presigned.uploadUrl,
      objectPath: presigned.objectPath,
      expiresAt: toProtoTimestamp(presigned.expiresAt),
    };
  }

  /**
   * Confirm the object landed, then create the row and queue the job.
   *
   * `confirmUpload` is what makes this an authorization check rather than a
   * formality — storage-service verifies the path against the `PendingUpload`
   * it recorded at presign, so a caller cannot confirm a path from somebody
   * else's session.
   */
  async confirmDocument(
    request: ConfirmDocumentRequest,
    context: CallerContext,
  ): Promise<DocumentResponse> {
    const organizationId = requireTenant(context);
    const actorId = requireActor(context);

    const title = this.requireTitle(request.title);
    const departmentIds = [...new Set(request.departmentIds)];

    if (request.isOrganizationWide && departmentIds.length > 0) {
      // Refused rather than silently ignored. An admin who named departments
      // AND left it org-wide has expressed two different intentions, and
      // picking one for them would leave the document either more or less
      // visible than they believe.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message:
          'An organization-wide document cannot also be scoped to departments',
      });
    }
    if (departmentIds.length > 0) {
      await this.authReference.assertDepartmentsExist(departmentIds, context);
    }

    const confirmed = await this.storage.confirmUpload(
      request.objectPath,
      context,
    );
    this.assertUploadable(confirmed.contentType, confirmed.sizeBytes);

    // Hashed from the PATH, not the bytes.
    //
    // The bytes never pass through this service — that is the whole point of
    // presign — so a content hash would mean downloading every upload back out
    // of storage purely to fingerprint it. The object path already ends in a
    // uuid that storage-service minted for this caller, so hashing it gives a
    // stable per-upload identity. The consequence is honest and worth stating:
    // this dedups REPEATED CONFIRMS of one upload, not two uploads of the same
    // file. True content dedup needs the worker to hash while it parses, and
    // that is where it belongs — it is already reading the bytes.
    const fileHash = createHash('sha256')
      .update(request.objectPath)
      .digest('hex');

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const created = await tx.document.create({
          data: {
            organizationId,
            createdById: actorId,
            title,
            fileUrl: request.objectPath,
            fileType: extensionFor(confirmed.contentType),
            fileSizeBytes: BigInt(confirmed.sizeBytes),
            fileHash,
            isOrganizationWide: request.isOrganizationWide,
            status: DocumentStatus.PENDING,
            // Validated at the gateway against `OCR_LANGUAGES`.
            // Stored as given: `[]` is "not specified", which is almost every
            // upload, and the parser is what turns that into the `eng` default.
            ocrLanguages: request.ocrLanguages ?? [],
            departmentLinks: {
              create: departmentIds.map((departmentId) => ({ departmentId })),
            },
          },
          include: { departmentLinks: true },
        });

        // The job row is created in the SAME transaction as the document.
        // Outside it, a crash between the two leaves a PENDING document with
        // nothing scheduled to process it and nothing recording that fact —
        // the document would sit "pending" forever with no job to look at.
        const job = await tx.ingestionJob.create({
          data: {
            // Denormalized; the document it copies is written in this same
            // transaction.
            organizationId,
            documentId: created.id,
            // Filled in by the worker when BullMQ actually accepts it. Empty
            // rather than a fake id: a made-up job id in Redis-shaped format is
            // worse than an obviously absent one when somebody is debugging.
            bullmqJobId: '',
            status: IngestionJobStatus.QUEUED,
          },
        });

        return { created, job };
      });

      // AFTER the commit, never inside it. An event announcing a document a
      // rollback erases is one no consumer can un-handle.
      this.events.publish({
        pattern: DOCUMENT_PATTERNS.uploaded,
        organizationId,
        documentId: document.created.id,
        occurredAt: new Date().toISOString(),
        ingestionJobId: document.job.id,
        objectPath: request.objectPath,
        fileType: document.created.fileType,
        // On the EVENT rather than read from the row by the worker
        // The processor's only document read happens after the parse, so
        // carrying this here is what keeps the "no lookup to start" property
        // that `objectPath` and `fileType` are already there for.
        ocrLanguages: document.created.ocrLanguages,
      });

      return toDocumentResponse(document.created, departmentIds, 0);
    } catch (error) {
      if (isUniqueConstraintViolation(error, DOCUMENT_HASH_INDEX)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'That upload has already been confirmed',
        });
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listDocuments(
    request: ListDocumentsRequest,
    context: CallerContext,
  ): Promise<ListDocumentsResponse> {
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      DOCUMENT_SORTABLE_FIELDS,
    );
    const search = toSearchFilter(page.searchTerm);

    const where: Prisma.DocumentWhereInput = {
      organizationId: requireTenant(context),
      ...(request.includeDeleted ? {} : { deletedAt: null }),
      ...this.visibilityScope(context),
      // UNSPECIFIED (0) is falsy and means "no filter", so `fromProto*`
      // returning null and the field being absent are the same thing here.
      ...(fromProtoDocumentStatus(request.status)
        ? { status: fromProtoDocumentStatus(request.status)! }
        : {}),
      ...(fromProtoDocumentFileType(request.fileType)
        ? { fileType: fromProtoDocumentFileType(request.fileType)! }
        : {}),
      ...(request.departmentId
        ? { departmentLinks: { some: { departmentId: request.departmentId } } }
        : {}),
      ...(search ? { title: search } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy,
        skip,
        take,
        include: DOCUMENT_INCLUDE,
      }),
      // The SAME `where`. A count computed without the visibility filter would
      // tell a caller how many documents exist that they cannot see.
      this.prisma.document.count({ where }),
    ]);

    return {
      items: items.map((document) =>
        toDocumentResponse(
          document,
          document.departmentLinks.map((link) => link.departmentId),
          document._count.chunks,
        ),
      ),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  async getDocument(
    request: DocumentIdRequest,
    context: CallerContext,
  ): Promise<DocumentResponse> {
    const document = await this.load(request.id, context);

    return toDocumentResponse(
      document,
      document.departmentLinks.map((link) => link.departmentId),
      document._count.chunks,
    );
  }

  async listDocumentDepartments(
    request: DocumentIdRequest,
    context: CallerContext,
  ): Promise<ListDocumentDepartmentsResponse> {
    const document = await this.load(request.id, context);

    return {
      departmentIds: document.departmentLinks.map((link) => link.departmentId),
    };
  }

  /**
   * The ACL is re-checked HERE, before anything is signed.
   *
   * `load` applies org-wide ∪ the caller's departments, and it runs before the
   * storage call rather than being delegated to it — storage-service does not
   * know this document's department scoping and never will. It only refuses
   * paths belonging to another TENANT, which is a coarser boundary than the one
   * that matters here.
   */
  async downloadDocument(
    request: DocumentIdRequest,
    context: CallerContext,
  ): Promise<DownloadDocumentResponse> {
    const document = await this.load(request.id, context);

    const urls = await this.storage.resolveReadUrls(
      [document.fileUrl],
      context,
    );
    const downloadUrl = urls[document.fileUrl];

    if (!downloadUrl) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'That file is no longer available',
      });
    }

    return {
      downloadUrl,
      expiresAt: toProtoTimestamp(new Date(Date.now() + this.downloadUrlTtlMs)),
    };
  }

  async listDocumentChunks(
    request: ListDocumentChunksRequest,
    context: CallerContext,
  ): Promise<ListDocumentChunksResponse> {
    const document = await this.load(request.documentId, context);
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      DOCUMENT_CHUNK_SORTABLE_FIELDS,
    );

    const where: Prisma.DocumentChunkWhereInput = { documentId: document.id };

    const [items, totalItems] = await Promise.all([
      this.prisma.documentChunk.findMany({ where, orderBy, skip, take }),
      this.prisma.documentChunk.count({ where }),
    ]);

    return {
      items: items.map(toDocumentChunkResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  /**
   * The flag worklist.
   *
   * **Accepts EVERY flag type, and more than one at a time.** `UNRETRIEVED` and
   * `UNCITED` were one flag under a name that fitted only `UNRETRIEVED`, and
   * they were split because they are different findings with different fixes: a
   * document nobody's question came near may simply be mis-titled, while one
   * retrieved twenty times and cited never is actively displacing the sources
   * that would have answered. A filter that accepted only one of them would
   * quietly re-merge them, because a type nobody can select is a type nobody
   * sees.
   *
   * Unresolved by default: a resolved flag is history, and mixing history into
   * a worklist is how a worklist stops being read.
   */
  async listDocumentFlags(
    request: ListDocumentFlagsRequest,
    context: CallerContext,
  ): Promise<ListDocumentFlagsResponse> {
    const organizationId = requireTenant(context);
    const page = request.page ?? emptyPage();
    const { skip, take, orderBy } = toPrismaPage(
      page,
      DOCUMENT_FLAG_SORTABLE_FIELDS,
    );

    // **The membership check stays, and the enum did not make it redundant.**
    // protoc refuses an unknown value from a peer that shares this contract, but
    // ts-proto maps anything it cannot name to `UNRECOGNIZED` (-1) rather than
    // failing — so a newer build's flag type arrives here as a legal value of
    // the enum type that this build cannot act on. `fromProto*` answers null for
    // exactly that case, and null is what this rejects.
    //
    // Refused rather than ignored. Silently dropping an unknown filter answers a
    // DIFFERENT question than the one asked — and a caller reading "no OUTDATED
    // flags" as "nothing is outdated" is the whole failure.
    const requested: DocumentFlagType[] = [];
    const unknown: number[] = [];
    for (const flagType of request.flagTypes ?? []) {
      const domain = fromProtoDocumentFlagType(flagType);
      if (domain) requested.push(domain);
      else unknown.push(flagType);
    }
    if (unknown.length > 0) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Unknown flag type(s): ${unknown.join(', ')}`,
      });
    }

    const where: Prisma.DocumentFlagWhereInput = {
      organizationId,
      // The scope boundary. A flag names a document, so an unscoped list would
      // leak another tenant's document titles through the join below — and
      // `documentVisibility` is what keeps a department-scoped document out of
      // a worklist for a caller `GET /documents/:id` would answer NOT_FOUND.
      document: { deletedAt: null, ...documentVisibility(context) },
      ...(requested.length > 0 ? { flagType: { in: requested } } : {}),
      ...(request.includeResolved ? {} : { resolvedAt: null }),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.documentFlag.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { document: { select: { title: true } } },
      }),
      this.prisma.documentFlag.count({ where }),
    ]);

    return {
      items: items.map(toDocumentFlagResponse),
      meta: toPageMeta(page, totalItems, items.length),
    };
  }

  async getDocumentChunk(
    request: GetDocumentChunkRequest,
    context: CallerContext,
    // `DocumentChunkResponse`, not `ReturnType<typeof toDocumentChunkResponse>`.
    // The inferred form named the mapper instead of the contract, so the RPC's
    // return type was whatever the mapper happened to return — a mapper that
    // dropped a field would have changed this signature silently rather than
    // failing to compile against the proto.
  ): Promise<DocumentChunkResponse> {
    const document = await this.load(request.documentId, context);

    const chunk = await this.prisma.documentChunk.findFirst({
      where: { id: request.chunkId, documentId: document.id },
    });
    if (!chunk) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No chunk with that id on this document',
      });
    }

    return toDocumentChunkResponse(chunk);
  }

  /**
   * Usage against the entitlement.
   *
   * Deliberately NOT scoped by the caller's departments: this is a workspace
   * total, and a number that shrank depending on who asked would make the
   * storage page disagree with the quota that actually gates uploads.
   */
  async getStorageUsage(context: CallerContext): Promise<StorageUsageResponse> {
    const organizationId = requireTenant(context);

    const [usedBytes, limitBytes, documentCount] = await Promise.all([
      this.usedBytes(organizationId),
      this.authReference.getStorageLimitBytes(context),
      this.prisma.document.count({
        where: { organizationId, deletedAt: null },
      }),
    ]);

    return {
      usedBytes: usedBytes,
      limitBytes: limitBytes,
      documentCount,
    };
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async updateDocument(
    request: UpdateDocumentRequest,
    context: CallerContext,
  ): Promise<DocumentResponse> {
    const existing = await this.load(request.id, context);

    const data: Prisma.DocumentUpdateInput = {};
    if (request.title !== undefined)
      data.title = this.requireTitle(request.title);
    if (request.isOrganizationWide !== undefined) {
      data.isOrganizationWide = request.isOrganizationWide;
    }

    const document = await this.prisma.document.update({
      where: { id: existing.id },
      data,
      include: DOCUMENT_INCLUDE,
    });

    const departmentIds = document.departmentLinks.map(
      (link) => link.departmentId,
    );

    if (request.isOrganizationWide !== undefined) {
      await this.fanOutScope(document, departmentIds, {
        isOrganizationWide: existing.isOrganizationWide,
        departmentIds: existing.departmentLinks.map(
          (link) => link.departmentId,
        ),
        isDeleted: existing.deletedAt !== null,
      });
    }

    return toDocumentResponse(document, departmentIds, document._count.chunks);
  }

  /**
   * Replace the department links.
   *
   * Refused while the document is organization-wide, and 409 rather than a
   * silent no-op: an admin scoping a document to two departments believes they
   * have restricted it, and a request that "succeeded" while leaving it visible
   * to everyone is the worst possible answer.
   */
  async setDocumentDepartments(
    request: SetDocumentDepartmentsRequest,
    context: CallerContext,
  ): Promise<DocumentResponse> {
    const existing = await this.load(request.id, context);

    if (existing.isOrganizationWide) {
      throw new RpcException({
        code: status.ABORTED,
        message:
          'This document is organization-wide; turn that off before scoping it to departments',
      });
    }

    const departmentIds = [...new Set(request.departmentIds)];
    await this.authReference.assertDepartmentsExist(departmentIds, context);

    const document = await this.prisma.$transaction(async (tx) => {
      await tx.departmentDocument.deleteMany({
        where: { documentId: existing.id },
      });
      if (departmentIds.length > 0) {
        await tx.departmentDocument.createMany({
          data: departmentIds.map((departmentId) => ({
            documentId: existing.id,
            departmentId,
          })),
        });
      }

      return tx.document.findUniqueOrThrow({
        where: { id: existing.id },
        include: DOCUMENT_INCLUDE,
      });
    });

    await this.fanOutScope(document, departmentIds, {
      isOrganizationWide: existing.isOrganizationWide,
      departmentIds: existing.departmentLinks.map((link) => link.departmentId),
      isDeleted: existing.deletedAt !== null,
    });

    return toDocumentResponse(document, departmentIds, document._count.chunks);
  }

  /**
   * Soft delete — a RESTRICTION, so the retrievable stores go first.
   *
   * Nothing is removed: citations in already-sent ticket messages must still
   * resolve to their chunk text (RDM §1.4, §1.6). The chunk rows keep their
   * content and flip `is_deleted`, which is what takes them out of retrieval
   * without taking them out of history.
   */
  async deleteDocument(
    request: DocumentIdRequest,
    context: CallerContext,
  ): Promise<DeleteDocumentResponse> {
    const existing = await this.load(request.id, context);
    const departmentIds = existing.departmentLinks.map(
      (link) => link.departmentId,
    );

    // BOTH retrievable stores first, in that order, and SYNCHRONOUSLY —
    // Qdrant before the chunk rows before `documents`. Deleting is the
    // strongest restriction there is, so a partial failure must over-restrict.
    //
    // The synchronous part is the correction that matters: leaving Qdrant to
    // the async reconciler meant the semantic arm kept serving a document for
    // as long as that job was queued, while the API had already answered 200.
    const scope = {
      isOrganizationWide: existing.isOrganizationWide,
      departmentIds,
      isDeleted: true,
    };

    await this.scopeWriter.apply(existing.id, scope, {
      isOrganizationWide: existing.isOrganizationWide,
      departmentIds,
      isDeleted: false,
    });

    await this.prisma.document.update({
      where: { id: existing.id },
      data: softDeleteData(requireActor(context)),
    });

    await this.publishScopeChanged(existing.organizationId, existing.id, {
      ...scope,
      restricting: true,
    });

    return {};
  }

  /**
   * Restore — a GRANT, so `documents` goes first.
   *
   * Failing after that under-grants: the document is listed but not yet
   * retrievable, so somebody waits. Safe.
   */
  async restoreDocument(
    request: DocumentIdRequest,
    context: CallerContext,
  ): Promise<DocumentResponse> {
    // Deliberately NOT `load`, which excludes deleted rows — the only rows this
    // can act on.
    const existing = await this.prisma.document.findFirst({
      where: {
        id: request.id,
        organizationId: requireTenant(context),
        deletedAt: { not: null },
      },
      include: { departmentLinks: { select: { departmentId: true } } },
    });
    if (!existing) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No deleted document with that id',
      });
    }

    // Typed via the shared include so `document` is not `any` — an untyped
    // `let` here would silently disable every downstream property check.
    let document: DocumentWithScope;
    try {
      document = await this.prisma.document.update({
        where: { id: existing.id },
        data: restoreData(),
        include: DOCUMENT_INCLUDE,
      });
    } catch (error) {
      // The partial unique index released this hash when the document was
      // soft-deleted, and somebody else may have taken the slot since. Catch
      // the P2002 and NAME the conflict — identical to the user-restore case
      // Domain A already resolved. A raw 500 here tells an admin nothing about
      // why their restore failed.
      if (isUniqueConstraintViolation(error, DOCUMENT_HASH_INDEX)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message:
            'Another document with the same file now holds that slot; remove it before restoring this one',
        });
      }
      throw error;
    }

    const departmentIds = document.departmentLinks.map(
      (link) => link.departmentId,
    );

    // A GRANT: `documents` was written above, so the retrievable stores follow.
    // A failure here under-grants — the document is listed but not yet
    // retrievable — and the reconciler finishes it.
    const scope = {
      isOrganizationWide: document.isOrganizationWide,
      departmentIds,
      isDeleted: false,
    };

    await this.scopeWriter.apply(existing.id, scope, {
      isOrganizationWide: existing.isOrganizationWide,
      departmentIds,
      isDeleted: true,
    });

    await this.publishScopeChanged(existing.organizationId, existing.id, {
      ...scope,
      restricting: false,
    });

    return toDocumentResponse(document, departmentIds, document._count.chunks);
  }

  /**
   * The batch read behind the documents DataLoader
   *
   * Citations resolve chunk -> document through this.
   *
   * **`visibilityScope` applies, exactly as it does to the list.** Documents
   * carry a department boundary: a document scoped to a
   * department is invisible to users outside it, and a batch read that skipped
   * the filter would be a way to fetch any document in the tenant one id at a
   * time — including its TITLE, which is usually the sensitive part.
   */
  async listDocumentsByIds(
    request: ListDocumentsByIdsRequest,
    context: CallerContext,
  ): Promise<ListDocumentsByIdsResponse> {
    const { ids, overLimit } = normalizeBatchIds(request.documentIds);

    if (overLimit) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `At most ${BATCH_ID_LIMIT} document ids per call`,
      });
    }

    if (ids.length === 0) return { items: [] };

    const items = await this.prisma.document.findMany({
      where: {
        organizationId: requireTenant(context),
        ...this.visibilityScope(context),
        // Soft-deleted documents ARE returned by id. A citation
        // pointing at a retired document still has to render its title.
        id: { in: ids },
      },
      include: DOCUMENT_INCLUDE,
    });

    return {
      items: items.map((document) =>
        toDocumentResponse(
          document,
          document.departmentLinks.map((link) => link.departmentId),
          document._count.chunks,
        ),
      ),
    };
  }

  /**
   * Chunks by id — the citation preview loader.
   *
   * **Capped hardest of all the batch RPCs** (`BATCH_CHUNK_LIMIT`), because a
   * chunk carries its whole text: fifty of these is already megabytes where
   * fifty users is kilobytes. The cap is about BYTES, and one number shared with
   * the other batches would be wrong for one of them.
   *
   * Scoped through the parent DOCUMENT rather than on the chunk row: the
   * department boundary lives on the document, and a chunk inherits it. Filtering
   * on the chunk alone would return text from a document the caller cannot open.
   */
  async listDocumentChunksByIds(
    request: ListDocumentChunksByIdsRequest,
    context: CallerContext,
  ): Promise<ListDocumentChunksByIdsResponse> {
    const { ids, overLimit } = normalizeBatchIds(
      request.chunkIds,
      BATCH_CHUNK_LIMIT,
    );

    if (overLimit) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `At most ${BATCH_CHUNK_LIMIT} chunk ids per call`,
      });
    }

    if (ids.length === 0) return { items: [] };

    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        id: { in: ids },
        // The boundary, applied through the parent.
        document: {
          organizationId: requireTenant(context),
          ...this.visibilityScope(context),
        },
      },
      select: {
        id: true,
        documentId: true,
        pageNumber: true,
        chunkIndex: true,
        contentText: true,
        document: { select: { title: true } },
      },
    });

    return {
      items: chunks.map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.document.title,
        pageNumber: chunk.pageNumber ?? undefined,
        chunkIndex: chunk.chunkIndex,
        contentText: chunk.contentText,
      })),
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The visibility fan-out — BOTH retrievable stores, then the reconciler.
   *
   * The ordering is `ScopeWriterService`'s and is stated there: a restriction
   * writes Qdrant then the chunk rows, a grant writes them the other way
   * round, and both are synchronous because both stores are retrievable. The
   * event published afterwards queues the durable reconciler, which
   * re-applies the same absolute scope with retries.
   */
  private async fanOutScope(
    document: {
      id: string;
      organizationId: string;
      isOrganizationWide: boolean;
    },
    departmentIds: string[],
    before: {
      isOrganizationWide: boolean;
      departmentIds: string[];
      isDeleted: boolean;
    },
  ): Promise<void> {
    const after = {
      isOrganizationWide: document.isOrganizationWide,
      departmentIds,
      isDeleted: false,
    };

    const { restricting } = await this.scopeWriter.apply(
      document.id,
      after,
      before,
    );

    await this.publishScopeChanged(document.organizationId, document.id, {
      ...after,
      restricting,
    });
  }

  /**
   * Announces the change AND queues the reconciler.
   *
   * Both, rather than relying on the NATS round trip to come back to this same
   * service: the event is a broadcast other consumers may want, while the
   * reconciler is work THIS service owns. Routing our own durable job through
   * a fire-and-forget broadcast would make it as reliable as the broadcast —
   * which is at-most-once, with no retry.
   */
  private async publishScopeChanged(
    organizationId: string,
    documentId: string,
    scope: {
      isOrganizationWide: boolean;
      departmentIds: string[];
      isDeleted: boolean;
      restricting: boolean;
    },
  ): Promise<void> {
    const occurredAt = new Date().toISOString();

    await this.fanoutQueue.enqueue({
      pattern: DOCUMENT_PATTERNS.scopeChanged,
      organizationId,
      documentId,
      occurredAt,
      ...scope,
    });

    this.events.publish({
      pattern: DOCUMENT_PATTERNS.scopeChanged,
      organizationId,
      documentId,
      occurredAt,
      ...scope,
    });
  }

  /** {@link documentVisibility}, as a method so the call sites read unchanged. */
  private visibilityScope(context: CallerContext): Prisma.DocumentWhereInput {
    return documentVisibility(context);
  }

  /** `SUM(file_size_bytes)` over the tenant's LIVE documents. */
  private async usedBytes(organizationId: string): Promise<number> {
    const result = await this.prisma.document.aggregate({
      where: { organizationId, deletedAt: null },
      _sum: { fileSizeBytes: true },
    });

    return Number(result._sum.fileSizeBytes ?? 0n);
  }

  private assertUploadable(contentType: string, sizeBytes: number): void {
    if (
      // `AllowedDocumentMimeType` is the exported name for exactly this
      // indexed access — spelling it out inline meant the cast did not move
      // when the list did.
      !ALLOWED_DOCUMENT_MIME_TYPES.includes(
        contentType as AllowedDocumentMimeType,
      )
    ) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `'${contentType}' is not a supported document type`,
      });
    }
    if (sizeBytes <= 0 || sizeBytes > MAX_DOCUMENT_BYTES) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `A document must be between 1 and ${MAX_DOCUMENT_BYTES} bytes`,
      });
    }
  }

  private requireTitle(title: string): string {
    const trimmed = title?.trim() ?? '';

    if (!trimmed) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A title is required',
      });
    }
    if (trimmed.length > MAX_DOCUMENT_TITLE_LENGTH) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `A title cannot exceed ${MAX_DOCUMENT_TITLE_LENGTH} characters`,
      });
    }

    return trimmed;
  }

  /**
   * A document the caller may see, or NOT_FOUND.
   *
   * `findFirst` with the scope spread in, never `findUnique({ where: { id } })`
   * — `findUnique` cannot express the tenant or department filter, so it would
   * return another tenant's row and the handler would 200 it.
   *
   * NOT_FOUND rather than PERMISSION_DENIED for a document that exists but is
   * out of scope: "you may not see this" confirms it exists, which turns id
   * enumeration into a knowledge-base oracle.
   */
  private async load(documentId: string, context: CallerContext) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId: requireTenant(context),
        deletedAt: null,
        ...this.visibilityScope(context),
      },
      include: DOCUMENT_INCLUDE,
    });
    if (!document) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No document with that id',
      });
    }

    return document;
  }
}
