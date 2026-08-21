import { Cacheable } from '../../common/decorators/cacheable.decorator';
import { CACHE_SCOPES } from '../../common/config/cache.config';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DocumentFlagResolution, RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { DocumentsService } from './documents.service';
import { IngestionJobsService } from '../ingestion-jobs/ingestion-jobs.service';
import { IngestionJobResponseDto } from '../ingestion-jobs/dto/rest/ingestion-job-response.dto';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
  Paginated,
} from '../../common/decorators/api-response.decorator';
import {
  ConfirmDocumentDto,
  ListDocumentFlagsQueryDto,
  ResolveDocumentFlagDto,
  ListDocumentsQueryDto,
  PresignDocumentDto,
  SetDocumentDepartmentsDto,
  ReplaceDocumentDto,
  UpdateDocumentDto,
} from './dto/rest/document.dto';
import {
  DocumentChunkResponseDto,
  DocumentDepartmentsResponseDto,
  DocumentFlagResponseDto,
  DocumentResponseDto,
  DownloadDocumentResponseDto,
  PresignDocumentResponseDto,
  StorageUsageResponseDto,
} from './dto/rest/document-response.dto';

/**
 * The knowledge base (api-endpoints-plan §3.1).
 *
 * **Reads are open to any member; writes are permissioned.** That split is the
 * product: a knowledge base exists to be read by everyone in the tenant, and
 * gating reads would mean an agent needed a grant to look something up. The
 * narrowing happens in ingestion-service, which applies org-wide ∪ the caller's
 * departments — the SAME predicate `rag-service` will enforce in retrieval, so
 * a document invisible here cannot be retrievable there.
 */
@ApiTags('Documents')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly ingestionJobs: IngestionJobsService,
  ) {}

  @ApiOperation({
    summary:
      "List documents visible to the caller (org-wide ∪ their departments' via department_documents)",
  })
  @ApiWrappedResponse(Paginated(DocumentResponseDto))
  @ApiFilterErrors(['401'])
  @Cacheable({
    scope: CACHE_SCOPES.documents,
    ttlSeconds: 60,
    varyBy: 'caller',
  })
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<PaginationResponseDto<DocumentResponseDto>> {
    return this.documents.list(query, context);
  }

  // MUST stay declared BEFORE `@Get(':id')`: Nest matches in declaration order,
  // and `:id` would swallow `presign` and `storage` -- surfacing as a
  // `ParseUUIDPipe` 400 that reads as a client bug, not a routing mistake.
  @ApiOperation({ summary: 'Storage usage breakdown vs max_storage_bytes' })
  @ApiWrappedResponse(StorageUsageResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('storage')
  @RequirePermission('document.read')
  storageUsage(
    @CurrentUser() context: RequestContext,
  ): Promise<StorageUsageResponseDto> {
    return this.documents.storageUsage(context);
  }

  /**
   * The flag worklist. Declared before `@Get(':id')`, like
   * `storage`.
   *
   * `document.read` rather than open to every member: a flag names a document
   * as stale, unread or redundant, which is a judgement about somebody's work
   * and belongs with the people who curate the knowledge base.
   */
  @ApiOperation({ summary: 'List quality flags' })
  @ApiWrappedResponse(Paginated(DocumentFlagResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get('flags')
  @RequirePermission('document.read')
  listFlags(
    @CurrentUser() context: RequestContext,
    @Query() query: ListDocumentFlagsQueryDto,
  ): Promise<PaginationResponseDto<DocumentFlagResponseDto>> {
    return this.documents.listFlags(query, context);
  }

  /**
   * One flag, in full.
   *
   * Grouped with `@Get('flags')`, but NOT for its reason: `:id` is a single
   * segment and this path is two, so no ordering hazard exists here. The
   * warning above applies to `flags` and `storage`, which are single-segment
   * literals `:id` really can swallow.
   */
  @ApiOperation({ summary: 'Get one quality flag' })
  @ApiWrappedResponse(DocumentFlagResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get('flags/:flagId')
  @RequirePermission('document.read')
  getFlag(
    @CurrentUser() context: RequestContext,
    @Param('flagId', ParseUUIDPipe) flagId: string,
  ): Promise<DocumentFlagResponseDto> {
    return this.documents.getFlag(flagId, context);
  }

  /**
   * Resolves a flag as `DISMISSED` — "this is not a problem".
   *
   * **The only resolution that suppresses anything**, and only for
   * `DISMISSAL_SUPPRESSION_DAYS`: a detector that re-raised it tomorrow would
   * be arguing with the person who dismissed it. The comment is required for
   * that reason — when the flag returns, the next person reads why it was
   * waved off last time — and ingestion-service refuses the write without one.
   */
  @ApiOperation({ summary: 'Dismiss a quality flag' })
  @ApiWrappedResponse(DocumentFlagResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post('flags/:flagId/dismiss')
  @RequirePermission('document.update')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Flag dismissed')
  dismissFlag(
    @CurrentUser() context: RequestContext,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Body() dto: ResolveDocumentFlagDto,
  ): Promise<DocumentFlagResponseDto> {
    return this.documents.resolveFlag(
      flagId,
      DocumentFlagResolution.DISMISSED,
      dto,
      context,
    );
  }

  /**
   * Resolves a flag as `FIXED` — "the problem was real and I corrected it".
   *
   * Suppresses NOTHING. If the detector finds it again it is reporting that the
   * fix did not work, which is the one message this must not swallow.
   */
  @ApiOperation({ summary: 'Mark a quality flag fixed' })
  @ApiWrappedResponse(DocumentFlagResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post('flags/:flagId/fixed')
  @RequirePermission('document.update')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Flag marked fixed')
  fixFlag(
    @CurrentUser() context: RequestContext,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Body() dto: ResolveDocumentFlagDto,
  ): Promise<DocumentFlagResponseDto> {
    return this.documents.resolveFlag(
      flagId,
      DocumentFlagResolution.FIXED,
      dto,
      context,
    );
  }

  /** Resolves a flag as `DOCUMENT_REPLACED`. Suppresses nothing, like `fixed`. */
  @ApiOperation({ summary: 'Mark a quality flag replaced' })
  @ApiWrappedResponse(DocumentFlagResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post('flags/:flagId/replaced')
  @RequirePermission('document.update')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Flag marked replaced')
  replaceFlag(
    @CurrentUser() context: RequestContext,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Body() dto: ResolveDocumentFlagDto,
  ): Promise<DocumentFlagResponseDto> {
    return this.documents.resolveFlag(
      flagId,
      DocumentFlagResolution.DOCUMENT_REPLACED,
      dto,
      context,
    );
  }

  /**
   * Removes a flag row.
   *
   * **Only for a row that should not exist** — a bad detector run, a test
   * artefact. It is not how a finding is suppressed: for a swept type
   * (`UNRETRIEVED`, `UNCITED`) the next detection cycle raises it again.
   * Dismiss is what makes a finding go away.
   */
  @ApiOperation({ summary: 'Delete a quality flag' })
  @ApiWrappedResponse(undefined, { status: HttpStatus.NO_CONTENT })
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Delete('flags/:flagId')
  @RequirePermission('document.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFlag(
    @CurrentUser() context: RequestContext,
    @Param('flagId', ParseUUIDPipe) flagId: string,
  ): Promise<void> {
    return this.documents.deleteFlag(flagId, context);
  }

  // 200, not 201: nothing is created yet. The storage quota is checked in
  // ingestion-service BEFORE anything is signed, so a tenant over
  // `max_storage_bytes` never gets a usable URL rather than finding out at 25MB.
  @ApiOperation({
    summary:
      '{ contentType, sizeBytes, fileName } → storage-service.PresignUpload(purpose: DOCUMENT) → { uploadUrl, objectPath, expiresAt }',
  })
  @ApiWrappedResponse(PresignDocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @Post('presign')
  @RequirePermission('document.create')
  @HttpCode(HttpStatus.OK)
  presign(
    @CurrentUser() context: RequestContext,
    @Body() dto: PresignDocumentDto,
  ): Promise<PresignDocumentResponseDto> {
    return this.documents.presign(dto, context);
  }

  /**
   * Where the `documents` row is actually created.
   *
   * Not at presign: an upload the client abandons must not leave a row pointing
   * at an object that never arrived.
   */
  @ApiOperation({ summary: 'Confirm' })
  @ApiWrappedResponse(DocumentResponseDto, { status: HttpStatus.CREATED })
  @ApiFilterErrors(['400', '401', '403'])
  @Post('confirm')
  @RequirePermission('document.create')
  @ResponseMessage('Document uploaded')
  confirm(
    @CurrentUser() context: RequestContext,
    @Body() dto: ConfirmDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documents.confirm(dto, context);
  }

  @ApiOperation({
    summary: 'Metadata + ingestion status + linked departments + chunk count',
  })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get(':id')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    return this.documents.get(id, context);
  }

  @ApiOperation({ summary: 'Update' })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Patch(':id')
  @RequirePermission('document.update')
  @ResponseMessage('Document updated')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documents.update(id, dto, context);
  }

  @ApiOperation({ summary: 'Remove' })
  @ApiWrappedResponse(undefined, { status: HttpStatus.NO_CONTENT })
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Delete(':id')
  @RequirePermission('document.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.documents.remove(id, context);
  }

  @ApiOperation({ summary: 'Restore' })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/restore')
  @RequirePermission('document.delete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Document restored')
  restore(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    return this.documents.restore(id, context);
  }

  /**
   * Re-runs ingestion over the file already attached — a chunking or model
   * change, not a new upload.
   *
   * `INDEXED` only; a document whose ingestion FAILED goes through
   * `POST /ingestion-jobs/:id/retry` instead. Returns the JOB rather than the
   * document, because the work is asynchronous — poll it at
   * `GET /ingestion-jobs/:id`.
   *
   * 400 means the document is not indexed, or a run is already in flight.
   */
  @ApiOperation({ summary: 'Reindex' })
  @ApiWrappedResponse(IngestionJobResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Post(':id/reindex')
  @RequirePermission('document.reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Reindex queued')
  reindex(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IngestionJobResponseDto> {
    return this.documents.reindex(id, context);
  }

  /**
   * Swaps the FILE behind an existing document, then re-runs ingestion.
   *
   * The same presign/confirm pair as an upload, against an id that already
   * exists: `POST /documents/presign`, PUT the bytes, then this.
   *
   * Identity is untouched — title, visibility and departments stay put. Open
   * flags resolve as `DOCUMENT_REPLACED`; `reindex` leaves them.
   *
   * Returns the DOCUMENT, whose jobs are at
   * `GET /documents/:id/ingestion-jobs`.
   *
   * 409 means that presign was already confirmed.
   */
  @ApiOperation({ summary: 'Replace the file' })
  @ApiWrappedResponse(DocumentResponseDto, { status: HttpStatus.ACCEPTED })
  @ApiFilterErrors(['400', '401', '403', '404', '409'])
  @Post(':id/replace')
  @RequirePermission('document.update')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Replacement queued')
  replace(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.documents.replace(id, dto, context);
  }

  /**
   * Visibility is re-checked in ingestion-service BEFORE the storage call.
   *
   * storage-service refuses paths from another TENANT, which is a coarser
   * boundary than the one that matters here — it knows nothing about this
   * document's department scoping and never will.
   */
  @ApiOperation({ summary: 'Short-lived signed URL via GetSignedReadUrls' })
  @ApiWrappedResponse(DownloadDocumentResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get(':id/download')
  download(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DownloadDocumentResponseDto> {
    return this.documents.download(id, context);
  }

  @ApiOperation({ summary: 'Ingestion history for this document' })
  @ApiWrappedResponse(Paginated(IngestionJobResponseDto))
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id/ingestion-jobs')
  @RequirePermission('document.read')
  listIngestionJobs(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaginationResponseDto<IngestionJobResponseDto>> {
    return this.ingestionJobs.listForDocument(id, context);
  }

  @ApiOperation({ summary: 'Departments scoped to this document' })
  @ApiWrappedResponse(DocumentDepartmentsResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id/departments')
  @RequirePermission('document.read')
  listDepartments(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentDepartmentsResponseDto> {
    return this.documents.listDepartments(id, context);
  }

  /**
   * Replaces the whole set, and is REFUSED (409) while the document is
   * organization-wide.
   *
   * Refused rather than silently ignored: an admin scoping a document to two
   * departments believes they have restricted it, and a request that
   * "succeeded" while leaving it visible to everyone is the worst answer
   * available.
   */
  @ApiOperation({ summary: 'Set departments' })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Put(':id/departments')
  @RequirePermission('document.share')
  @ResponseMessage('Document scoping updated')
  setDepartments(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDocumentDepartmentsDto,
  ): Promise<DocumentResponseDto> {
    return this.documents.setDepartments(id, dto, context);
  }

  @ApiOperation({
    summary:
      'Paginated document_chunks: chunk_index, content_text, page_number, token_count',
  })
  @ApiWrappedResponse(Paginated(DocumentChunkResponseDto))
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id/chunks')
  @RequirePermission('document.read')
  listChunks(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<PaginationResponseDto<DocumentChunkResponseDto>> {
    return this.documents.listChunks(id, query, context);
  }

  /**
   * The citation deep-link target — open to any member who can see the parent
   * document, because a citation in an AI answer is useless if following it
   * needs a permission the reader does not have.
   */
  @ApiOperation({ summary: 'Single chunk (citation deep-link target)' })
  @ApiWrappedResponse(DocumentChunkResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get(':id/chunks/:chunkId')
  getChunk(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
  ): Promise<DocumentChunkResponseDto> {
    return this.documents.getChunk(id, chunkId, context);
  }
}
