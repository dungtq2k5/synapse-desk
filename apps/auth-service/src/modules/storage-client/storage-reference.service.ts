import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, ClientProxy, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, timeout } from 'rxjs';
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
} from '@synapsedesk/common';

export type PresignedUpload = {
  uploadUrl: string;
  objectPath: string;
  expiresAt: Date;
};

/**
 * auth-service's view of storage — presign, confirm, resolve, and the
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

  async presignAvatar(
    input: { contentType: string; sizeBytes: number; fileName: string },
    context: CallerContext,
  ): Promise<PresignedUpload> {
    const response = await firstValueFrom(
      this.storageService
        .presignUpload(
          {
            purpose: ProtoStoragePurpose.STORAGE_PURPOSE_AVATAR,
            ownerId: context.sub ?? '',
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            originalFileName: input.fileName,
            secondaryOwnerId: '',
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

  async confirmAvatar(
    objectPath: string,
    context: CallerContext,
  ): Promise<void> {
    await firstValueFrom(
      this.storageService
        .confirmUpload({ objectPath }, packRequestContext(context))
        .pipe(timeout(GRPC_DEADLINE_MS)),
    );
  }

  /**
   * Batched, and NEVER fatal.
   *
   * A signing failure here would take down `GET /users` — a whole page of
   * people — because one avatar could not be resolved. An unresolved path
   * simply has no entry in the map, and the mapper renders null: a missing
   * picture, which is a far better outcome than a 500 on a user list.
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
        `Could not resolve avatar URLs: ${formatErrorMsg(error)}`,
      );
      return {};
    }
  }

  /**
   * Resolve for a caller we know only by their row, not by a CallerContext.
   *
   * Three paths need this: `getCurrentUser`, which the gateway calls DURING
   * token verification — before a context exists to unpack — and the two
   * session-issuing paths, which run pre-authentication and carry only a
   * `RequestOrigin`. In all three the user row has already been loaded and is
   * itself the authority on the tenant, and the only avatar being resolved is
   * that user's own.
   *
   * Storage cares about exactly one field, so the rest of the context is inert
   * filler; keeping the synthesis here rather than at three call sites means
   * there is one place to change if that ever stops being true.
   *
   * A null tenant returns `{}` WITHOUT a round trip. Super Admins have no
   * organization, and `getSignedReadUrls` answers a null tenant with
   * FAILED_PRECONDITION — so asking would be a guaranteed failure, swallowed
   * into the same empty map this returns immediately.
   */
  resolveOwnReadUrls(
    objectPaths: string[],
    organizationId: string | null,
    userId: string,
  ): Promise<Record<string, string>> {
    if (!organizationId) return Promise.resolve({});

    return this.resolveReadUrls(objectPaths, {
      ip: '',
      userAgent: '',
      sub: userId,
      organizationId,
      isSuperAdmin: false,
      departmentIds: [],
      permissionCodes: [],
      isEmailVerified: true,
    });
  }

  /**
   * Fire-and-forget, exactly like `AuditPublisher`.
   *
   * A delete that fails must never roll back or block the avatar change the
   * user actually asked for. The worst case is an orphaned object, which costs
   * storage; the alternative costs the user their action.
   */
  emitSuperseded(objectPath: string, reason: SupersededReason): void {
    if (!objectPath) return;

    // Refuse anything that is not one of our paths. This is the last point
    // before an `objectPath` becomes a `bucket.file(...).delete()`, so a value
    // that entered the column from somewhere else — an external CDN URL, say —
    // must stop here rather than reach a delete call.
    //
    // Logged and dropped rather than thrown: the caller has already committed
    // the avatar change the user asked for, and this is fire-and-forget
    // cleanup. Throwing would fail a request whose real work succeeded, which
    // is the one outcome worse than an orphaned object.
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
