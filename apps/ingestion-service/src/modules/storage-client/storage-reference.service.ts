import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, ClientProxy, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  defaultIfEmpty,
  firstValueFrom,
  lastValueFrom,
  tap,
  timeout,
} from 'rxjs';
import {
  CallerContext,
  GRPC_DEADLINE_MS,
  packRequestContext,
  STORAGE_GRPC_CLIENT,
  STORAGE_SERVICE_NAME,
  StoragePurpose as ProtoStoragePurpose,
  StorageServiceClient,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  isStorageObjectPath,
  NATS_CLIENT,
  ObjectSupersededEvent,
  STORAGE_PATTERNS,
  SupersededReason,
  systemContext,
} from '@synapsedesk/common';

/**
 * Longer than `GRPC_DEADLINE_MS`, and it has to be: a document is up to 25 MB
 * streamed over gRPC, so the deadline sized for a lookup would kill every large
 * upload at exactly the same size boundary — which reads as "big PDFs are
 * broken" rather than as a timeout.
 */
const DOWNLOAD_DEADLINE_MS = 120_000;

/**
 * Stays here rather than moving to a mapper: despite the `export`, the only
 * reference in the repo is `presignDocument`'s return type in this same file.
 * auth-service and ticket-service declare it identically, in the same position,
 * and neither module has a mapper file — so relocating this one would cost the
 * symmetry between three parallel wrappers and buy nothing.
 *
 * The `export` is worth keeping regardless: it is the shape a caller receives,
 * and an un-exported return type is one that cannot be named at a call site.
 */
export type PresignedUpload = {
  uploadUrl: string;
  objectPath: string;
  expiresAt: Date;
};

/**
 * ingestion-service's view of storage — presign, confirm, resolve, and the
 * fire-and-forget delete.
 *
 * Wrapping the raw client rather than injecting it into `UsersService` keeps
 * two things in one place: the deadline on every call, and the decision that a
 * FAILED RESOLVE is not an error. That second one matters more than it looks —
 * see `resolveReadUrls`.
 */
@Injectable()
export class StorageReferenceService implements OnModuleInit {
  private readonly logger = new Logger(StorageReferenceService.name);

  private storageService!: StorageServiceClient;

  constructor(
    @Inject(STORAGE_GRPC_CLIENT) private readonly client: ClientGrpc,
    @Inject(NATS_CLIENT) private readonly nats: ClientProxy,
  ) {}

  onModuleInit(): void {
    this.storageService =
      this.client.getService<StorageServiceClient>(STORAGE_SERVICE_NAME);
  }

  /**
   * The DOCUMENT purpose — reserved in `PURPOSE_POLICY` since storage-service
   * was built, and given its first caller here.
   *
   * `documentId` is a per-upload nonce, not an existing row's id and not the id
   * the row will get — the `documents` row is created at confirm and mints its
   * own. What ties an object to the request that authorized it is storage's
   * `PendingUpload` record, which confirm consumes; the path is not an
   * authorization input anywhere.
   */
  async presignDocument(
    input: {
      documentId: string;
      contentType: string;
      sizeBytes: number;
      fileName: string;
    },
    context: CallerContext,
  ): Promise<PresignedUpload> {
    const response = await firstValueFrom(
      this.storageService
        .presignUpload(
          {
            purpose: ProtoStoragePurpose.STORAGE_PURPOSE_DOCUMENT,
            ownerId: input.documentId,
            secondaryOwnerId: '',
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            originalFileName: input.fileName,
          },
          packRequestContext(context),
        )
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );

    return {
      uploadUrl: response.uploadUrl,
      objectPath: response.objectPath,
      expiresAt: new Date((response.expiresAt?.seconds ?? 0) * 1000),
    };
  }

  async confirmUpload(
    objectPath: string,
    context: CallerContext,
  ): Promise<{ sizeBytes: number; contentType: string }> {
    const response = await firstValueFrom(
      this.storageService
        .confirmUpload({ objectPath }, packRequestContext(context))
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );

    return {
      sizeBytes: response.sizeBytes,
      contentType: response.contentType,
    };
  }

  /**
   * Batched, and NEVER fatal.
   *
   * A signing failure here would take down a whole document list because one
   * file could not be resolved. An unresolved path simply has no entry in the
   * map: a missing download link, which is a far better outcome than a 500 on
   * the knowledge-base page.
   */
  async resolveReadUrls(
    objectPaths: string[],
    context: CallerContext,
  ): Promise<Record<string, string>> {
    const paths = objectPaths.filter(Boolean);
    if (paths.length === 0) return {};

    try {
      const response = await firstValueFrom(
        this.storageService
          .getSignedReadUrls(
            { objectPaths: paths },
            packRequestContext(context),
          )
          .pipe(timeout(GRPC_DEADLINE_MS)),
      );
      return response.urlsByPath ?? {};
    } catch (error) {
      this.logger.error(
        `Could not resolve document URLs: ${formatErrorMsg(error)}`,
      );
      return {};
    }
  }

  /**
   * The document's BYTES, for the ingestion worker.
   *
   * A signed URL would be the wrong tool: those exist so a browser can reach
   * Storage without our credentials, and the worker runs inside the trust
   * boundary. Minting a public, time-limited, unauthenticated link so that one
   * of our own services can read a file it already owns is more moving parts
   * and a wider blast radius than asking for it.
   *
   * The stream is reassembled here rather than passed through, because every
   * parser downstream needs the whole buffer anyway — a PDF cannot be parsed
   * incrementally, so streaming past this point would buy nothing and cost the
   * callers a shape they cannot use.
   */
  async downloadObject(
    objectPath: string,
    organizationId: string,
  ): Promise<Buffer> {
    // A SYSTEM context: the worker acts for the tenant, not for the person who
    // uploaded the file hours ago. storage-service still checks the tenant
    // against the path, which is the boundary it owns — "internal" is not a
    // tenant.
    const chunks: Buffer[] = [];

    await lastValueFrom(
      this.storageService
        .downloadObject(
          { objectPath },
          packRequestContext(systemContext(organizationId)),
        )
        .pipe(
          // A longer deadline than a normal RPC: this is 25 MB of bytes over a
          // stream, not a lookup, and the standard deadline would kill every
          // large document at the same size boundary.
          timeout(DOWNLOAD_DEADLINE_MS),
          tap((chunk) => {
            if (chunk.data?.length) chunks.push(Buffer.from(chunk.data));
          }),
          defaultIfEmpty({ data: new Uint8Array() }),
        ),
    );

    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0) {
      // An empty read is a missing object, not an empty document — confirm
      // rejected zero-byte uploads long before this. Treating it as "parse
      // nothing successfully" would mark the document INDEXED with no chunks
      // and no indication anything went wrong.
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Storage returned no bytes for '${objectPath}'`,
      });
    }

    return bytes;
  }

  /**
   * Announces that an object is no longer referenced, so storage can delete it.
   *
   * Fire-and-forget, exactly like `AuditPublisher` — never awaited, never
   * throws. A lost event leaks one object and nothing else; the caller's write
   * has already committed either way.
   *
   * @param objectPath the OLD path being replaced or removed, never the new one
   */
  emitSuperseded(objectPath: string, reason: SupersededReason): void {
    if (!objectPath) return;

    // The same refusal auth-service makes, for the same reason: this is the
    // last point before a stored value becomes a delete call, so anything that
    // is not one of our paths stops here. Logged and dropped, never thrown —
    // the caller's write has already committed by the time this runs.
    if (!isStorageObjectPath(objectPath)) {
      this.logger.error(
        `Refusing to supersede '${objectPath}': not a storage object path`,
      );
      return;
    }

    const event: ObjectSupersededEvent = { objectPath, reason };

    // `.subscribe()` is mandatory: `emit()` returns a COLD observable and
    // nothing is published until something subscribes. Omitting it is the
    // classic silent failure with this API — no error, no message, no clue.
    this.nats.emit(STORAGE_PATTERNS.objectSuperseded, event).subscribe({
      error: (error: unknown) =>
        this.logger.error(
          `Failed to publish supersede for '${objectPath}': ${formatErrorMsg(error)}`,
        ),
    });
  }

  /** Maps a storage failure into something the caller can act on. */
  static asClientError(error: unknown): RpcException {
    const code = (error as { code?: number })?.code;

    // INVALID_ARGUMENT and NOT_FOUND are the caller's problem and pass through;
    // anything else is storage-service being unwell, which is not.
    if (code === status.INVALID_ARGUMENT || code === status.NOT_FOUND) {
      return new RpcException({
        code,
        message: formatErrorMsg(error),
      });
    }

    return new RpcException({
      code: status.UNAVAILABLE,
      message: 'File storage is currently unavailable',
    });
  }
}
