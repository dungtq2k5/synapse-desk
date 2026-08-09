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
import { RequestContext } from '@synapsedesk/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PaginationResponseBase } from '../../common/dto/base/pagination-response-base.dto';
import { DocumentsGrpcClient } from './documents-grpc.client';
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
  ListDocumentsQueryDto,
  PresignDocumentDto,
  SetDocumentDepartmentsDto,
  UpdateDocumentDto,
} from './dto/rest/document.dto';
import {
  DocumentChunkResponseDto,
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
  constructor(private readonly documentsGrpcClient: DocumentsGrpcClient) {}

  @ApiOperation({
    summary:
      "List documents visible to the caller (org-wide ∪ their departments' via department_documents)",
  })
  @ApiWrappedResponse(Paginated(DocumentResponseDto))
  @ApiFilterErrors(['401'])
  @ApiOperation({
    summary:
      "List documents visible to the caller (org-wide ∪ their departments' via department_documents)",
  })
  @ApiWrappedResponse(Paginated(DocumentResponseDto))
  @ApiFilterErrors(['401'])
  @Get()
  list(
    @CurrentUser() context: RequestContext,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<PaginationResponseBase<DocumentResponseDto>> {
    return this.documentsGrpcClient.list(query, context);
  }

  /**
   * Declared BEFORE `@Get(':id')`.
   *
   * Nest matches in declaration order and `:id` would swallow both `presign`
   * and `storage`, turning them into a `ParseUUIDPipe` 400 that reads as a
   * client bug rather than a routing mistake. The same hazard `bulk/status` hit
   * in Domain B and `by-number` before it.
   */
  @ApiOperation({ summary: 'Storage usage breakdown vs max_storage_bytes' })
  @ApiWrappedResponse(StorageUsageResponseDto)
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'Storage usage breakdown vs max_storage_bytes' })
  @ApiWrappedResponse(StorageUsageResponseDto)
  @ApiFilterErrors(['401', '403'])
  @Get('storage')
  @RequirePermission('document.read')
  storageUsage(
    @CurrentUser() context: RequestContext,
  ): Promise<StorageUsageResponseDto> {
    return this.documentsGrpcClient.storageUsage(context);
  }

  /**
   * The flag worklist — 16-doc §5. Declared before `@Get(':id')`, like
   * `storage`.
   *
   * `document.read` rather than open to every member: a flag names a document
   * as stale, unread or redundant, which is a judgement about somebody's work
   * and belongs with the people who curate the knowledge base.
   */
  @ApiOperation({ summary: 'List quality flags' })
  @ApiWrappedResponse(Paginated(DocumentFlagResponseDto))
  @ApiFilterErrors(['401', '403'])
  @ApiOperation({ summary: 'List quality flags' })
  @ApiWrappedResponse(Paginated(DocumentFlagResponseDto))
  @ApiFilterErrors(['401', '403'])
  @Get('flags')
  @RequirePermission('document.read')
  listFlags(
    @CurrentUser() context: RequestContext,
    @Query() query: ListDocumentFlagsQueryDto,
  ): Promise<PaginationResponseBase<DocumentFlagResponseDto>> {
    return this.documentsGrpcClient.listFlags(query, context);
  }

  /**
   * 200, not 201 — nothing has been created yet.
   *
   * The STORAGE QUOTA is checked in ingestion-service before anything is
   * signed, so a tenant over `max_storage_bytes` never receives a usable URL
   * rather than discovering it after uploading 25 MB.
   */
  @ApiOperation({
    summary:
      '{ contentType, sizeBytes, fileName } → storage-service.PresignUpload(purpose: DOCUMENT) → { uploadUrl, objectPath, expiresAt }',
  })
  @ApiWrappedResponse(PresignDocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
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
    return this.documentsGrpcClient.presign(dto, context);
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
    return this.documentsGrpcClient.confirm(dto, context);
  }

  @ApiOperation({
    summary: 'Metadata + ingestion status + linked departments + chunk count',
  })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
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
    return this.documentsGrpcClient.get(id, context);
  }

  @ApiOperation({ summary: 'Update' })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
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
    return this.documentsGrpcClient.update(id, dto, context);
  }

  @ApiOperation({ summary: 'Remove' })
  @ApiWrappedResponse(undefined, { status: HttpStatus.NO_CONTENT })
  @ApiFilterErrors(['400', '401', '403', '404'])
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
    return this.documentsGrpcClient.remove(id, context);
  }

  @ApiOperation({ summary: 'Restore' })
  @ApiWrappedResponse(DocumentResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
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
    return this.documentsGrpcClient.restore(id, context);
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
  @ApiOperation({ summary: 'Short-lived signed URL via GetSignedReadUrls' })
  @ApiWrappedResponse(DownloadDocumentResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get(':id/download')
  download(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DownloadDocumentResponseDto> {
    return this.documentsGrpcClient.download(id, context);
  }

  @ApiOperation({ summary: 'Departments scoped to this document' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @ApiOperation({ summary: 'Departments scoped to this document' })
  @ApiWrappedResponse()
  @ApiFilterErrors(['400', '401', '403', '404'])
  @Get(':id/departments')
  @RequirePermission('document.read')
  listDepartments(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string[]> {
    return this.documentsGrpcClient.listDepartments(id, context);
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
    return this.documentsGrpcClient.setDepartments(id, dto, context);
  }

  @ApiOperation({
    summary:
      'Paginated document_chunks: chunk_index, content_text, page_number, token_count',
  })
  @ApiWrappedResponse(Paginated(DocumentChunkResponseDto))
  @ApiFilterErrors(['400', '401', '403', '404'])
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
  ): Promise<PaginationResponseBase<DocumentChunkResponseDto>> {
    return this.documentsGrpcClient.listChunks(id, query, context);
  }

  /**
   * The citation deep-link target — open to any member who can see the parent
   * document, because a citation in an AI answer is useless if following it
   * needs a permission the reader does not have.
   */
  @ApiOperation({ summary: 'Single chunk (citation deep-link target)' })
  @ApiWrappedResponse(DocumentChunkResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @ApiOperation({ summary: 'Single chunk (citation deep-link target)' })
  @ApiWrappedResponse(DocumentChunkResponseDto)
  @ApiFilterErrors(['400', '401', '404'])
  @Get(':id/chunks/:chunkId')
  getChunk(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chunkId', ParseUUIDPipe) chunkId: string,
  ): Promise<DocumentChunkResponseDto> {
    return this.documentsGrpcClient.getChunk(id, chunkId, context);
  }
}
