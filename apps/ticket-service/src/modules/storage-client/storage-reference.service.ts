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
  UNKNOWN_ORIGIN,
} from '@synapsedesk/common';

export type PresignedUpload = {
  uploadUrl: string;
  objectPath: string;
  expiresAt: Date;
};

/**
 * Longer than a normal RPC because this one moves bytes — the same figure
 * ingestion-service uses for the same reason.
 */
const DOWNLOAD_DEADLINE_MS = 120_000;

/**
 * ticket-service's view of storage — presign, confirm, resolve, and the
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
   * The ticket and the MESSAGE both go into the path, so an attachment's
   * location says which conversation turn it belongs to without a lookup.
   */
  async presignAttachment(
    input: {
      ticketId: string;
      /** Absent before the message exists — 36-doc §1.3. */
      messageId?: string;
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
            purpose: ProtoStoragePurpose.STORAGE_PURPOSE_TICKET_ATTACHMENT,
            ownerId: input.ticketId,
            // Empty, not omitted: the field is a plain `string` on the wire, so
            // an absent message and an empty one are the same bytes either way.
            // storage-service reads empty as "no segment".
            secondaryOwnerId: input.messageId ?? '',
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

  /**
   * The analytics export's upload slot — 19-doc §5.
   *
   * A BACKGROUND job has no caller context: it runs from a queue, on behalf of
   * a request that finished minutes ago. So the tenant is passed explicitly and
   * a synthetic context is built here rather than threading a stale one through
   * BullMQ — a serialised `CallerContext` sitting in Redis is an identity with
   * no expiry, which is a worse thing to have than a slightly awkward signature.
   */
  async presignExport(
    exportId: string,
    sizeBytes: number,
    organizationId: string,
  ): Promise<PresignedUpload> {
    const response = await firstValueFrom(
      this.storageService
        .presignUpload(
          {
            purpose: ProtoStoragePurpose.STORAGE_PURPOSE_EXPORT,
            ownerId: exportId,
            // An export has one owner. `EXPORT`'s policy sets
            // `requiresSecondaryOwner: false`, so storage-service ignores this
            // — sent as an empty string because proto3 has no absent scalar.
            secondaryOwnerId: '',
            contentType: 'text/csv',
            sizeBytes,
            originalFileName: `analytics-${exportId}.csv`,
          },
          packRequestContext(systemContext(organizationId)),
        )
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );

    return {
      uploadUrl: response.uploadUrl,
      objectPath: response.objectPath,
      expiresAt: new Date((response.expiresAt?.seconds ?? 0) * 1000),
    };
  }

  /** The confirm half of the same background upload. */
  async confirmExportUpload(
    objectPath: string,
    organizationId: string,
  ): Promise<void> {
    await firstValueFrom(
      this.storageService
        .confirmUpload(
          { objectPath },
          packRequestContext(systemContext(organizationId)),
        )
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );
  }

  /**
   * A short-lived download URL for a finished export.
   *
   * **A signed URL to a file containing a tenant's full ticket history is a
   * credential** (19-doc §5), so it is minted per request and expires in
   * minutes rather than being stored on the row. Storing it would turn a
   * database read into a durable secret.
   */
  async resolveExportUrl(
    objectPath: string,
    organizationId: string,
  ): Promise<string | null> {
    const resolved = await this.resolveReadUrls(
      [objectPath],
      systemContext(organizationId),
    );

    return resolved[objectPath] ?? null;
  }

  async confirmUpload(
    objectPath: string,
    context: CallerContext,
  ): Promise<{ objectPath: string; sizeBytes: number; contentType: string }> {
    const response = await firstValueFrom(
      this.storageService
        .confirmUpload({ objectPath }, packRequestContext(context))
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );

    return {
      // **The path storage-service RETURNED, not the one we sent** — 36-doc
      // §1.3.2. A confirmed attachment moves out of `pending/`, so the presign
      // path is where the object no longer is — and a row built from it would
      // point at exactly what the lifecycle rule is about to delete.
      objectPath: response.objectPath,
      sizeBytes: response.sizeBytes,
      contentType: response.contentType,
    };
  }

  /**
   * The bytes of one object — 36-doc §2.
   *
   * **New here, and it is the first byte path this service has had.** Everything
   * above hands out signed URLs: presign to upload, `resolveReadUrls` so a
   * browser can download. Attachments in the AI path need the bytes in-process,
   * because they travel inline in `ChatRequest`/`DraftRequest` — rag-service
   * has no storage client and giving it one would add a peer, a credential and
   * a failure mode to the query path (35-doc §7).
   *
   * Reassembled rather than passed through as a stream, for the same reason
   * ingestion-service reassembles: the consumer needs the whole buffer to put
   * it in a protobuf field, so streaming past this point would buy nothing and
   * cost the caller a shape it cannot use.
   *
   * **Throws rather than returning empty.** One unreadable attachment must not
   * silently become an answer about the other four — the caller decides whether
   * to skip it, and it can only decide if it is told.
   */
  async downloadObject(
    objectPath: string,
    context: CallerContext,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];

    await lastValueFrom(
      this.storageService
        .downloadObject({ objectPath }, packRequestContext(context))
        .pipe(
          // Longer than `GRPC_DEADLINE_MS`: this is megabytes over a stream
          // rather than a lookup, and the standard deadline would kill every
          // large attachment at the same size boundary.
          timeout(DOWNLOAD_DEADLINE_MS),
          tap((chunk) => {
            if (chunk.data?.length) chunks.push(Buffer.from(chunk.data));
          }),
          defaultIfEmpty({ data: new Uint8Array() }),
        ),
    );

    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0) {
      // An empty read is a MISSING object, not an empty file — confirm rejects
      // zero-byte uploads. Treating it as "read nothing successfully" would put
      // an empty part in the prompt and spend a call on it.
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'That file is no longer available',
      });
    }

    return bytes;
  }

  /**
   * Batched, and NEVER fatal.
   *
   * A signing failure here would take down a whole message thread because one
   * attachment could not be resolved. An unresolved path simply has no entry in
   * the map and the mapper renders null: a missing download link, which is a
   * far better outcome than a 500 on a conversation.
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
        `Could not resolve attachment URLs: ${formatErrorMsg(error)}`,
      );
      return {};
    }
  }

  /**
   * Fire-and-forget, exactly like `AuditPublisher` — §1.6.
   *
   * A delete that fails must never roll back or block the attachment removal
   * the user actually asked for. The worst case is an orphaned object, which costs
   * storage; the alternative costs the user their action.
   */
  emitSuperseded(objectPath: string, reason: SupersededReason): void {
    if (!objectPath) return;

    // The same refusal auth-service makes, for the same reason: this is the
    // last point before a stored value becomes a delete call, so anything that
    // is not one of our paths stops here. Logged and dropped, never thrown —
    // the row is already gone by the time this runs.
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

/**
 * The tenant, with no user.
 *
 * A background job acts for the TENANT rather than for the person who queued
 * the work — that request finished minutes ago, and carrying their identity
 * through a queue would mean an authorization decision made against a session
 * that may since have been revoked. storage-service scopes by
 * `organizationId`, which is exactly what this carries and all it carries.
 */
function systemContext(organizationId: string): CallerContext {
  return {
    sub: null,
    organizationId,
    isSuperAdmin: false,
    departmentIds: [],
    permissionCodes: [],
    isEmailVerified: true,
    ...UNKNOWN_ORIGIN,
  };
}
