import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import { Observable, throwError } from 'rxjs';
import {
  CallerContext,
  ConfirmUploadRequest,
  DownloadObjectChunk,
  DownloadObjectRequest,
  ConfirmUploadResponse,
  GetSignedReadUrlsRequest,
  GetSignedReadUrlsResponse,
  PresignUploadRequest,
  PresignUploadResponse,
  StoragePurpose as ProtoStoragePurpose,
  toProtoTimestamp,
  fromProtoStoragePurpose,
} from '@synapsedesk/grpc-proto';
import {
  formatErrorMsg,
  organizationIdFromObjectPath,
  requireActor,
  requireTenant,
  StoragePurpose,
  exceedsLimit,
} from '@synapsedesk/common';
import { FirebaseStorageService } from '../firebase/firebase-storage.service';
import { extensionFor, PURPOSE_POLICY } from '../../common/purpose-registry';
import {
  matchesDeclaredType,
  SIGNATURE_SAMPLE_BYTES,
} from '../../common/content-signature';
import { PendingUploadStore } from './pending-upload.store';

/**
 * Presign → upload → confirm, one mechanism for every file type.
 *
 * The file bytes never touch an application server: the client PUTs them
 * straight to Firebase Storage using a signed URL. What this service does is
 * decide WHERE they may go and WHETHER the upload that landed there was one it
 * authorized.
 *
 * The tenant is taken from the CALLER'S CONTEXT and never from the request, in
 * every method here. That is the single rule the whole design rests on: a
 * request body is something a caller asserts, and the tenant boundary is not
 * theirs to assert.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  private readonly uploadTtlSeconds: number;
  private readonly readTtlSeconds: number;

  constructor(
    private readonly firebase: FirebaseStorageService,
    private readonly pending: PendingUploadStore,
    configService: ConfigService,
  ) {
    this.uploadTtlSeconds = configService.getOrThrow<number>(
      'UPLOAD_URL_TTL_SECONDS',
    );
    this.readTtlSeconds = configService.getOrThrow<number>(
      'READ_URL_TTL_SECONDS',
    );
  }

  /**
   * Validate, build a path, record what was authorized, mint a signed PUT.
   *
   * The order matters: `contentType` and `sizeBytes` are checked against the
   * purpose's policy BEFORE any Firebase call, so a rejected request never
   * costs a signing operation.
   */
  async presignUpload(
    request: PresignUploadRequest,
    context: CallerContext,
  ): Promise<PresignUploadResponse> {
    const organizationId = requireTenant(context);
    const actorId = requireActor(context);
    const purpose = this.requirePurpose(request.purpose);
    const policy = PURPOSE_POLICY[purpose];

    if (!request.ownerId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'An owner id is required',
      });
    }
    if (request.secondaryOwnerId && !policy.allowsSecondaryOwner) {
      // The check, since inverted. It used to REQUIRE the segment for a
      // ticket attachment, which is what made presign-before-the-message
      // impossible; now the only error is a secondary owner on a purpose that
      // has nowhere to put one, which would otherwise be silently discarded.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `${purpose} uploads take no secondary owner id`,
      });
    }
    // **Widened to `string` for the CHECK, narrow for the DECLARATION.**
    // `mimeAllowlist` is `readonly MimeType[]` so a mistyped entry cannot be
    // written; `contentType` is whatever a caller sent, which is precisely what
    // this line exists to judge. Typing the input would be claiming the
    // untrusted value is already valid.
    if (
      !(policy.mimeAllowlist as readonly string[]).includes(request.contentType)
    ) {
      // An allowlist, never a denylist — a denylist is a promise to have
      // thought of every dangerous type, and nobody can keep that promise.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `'${request.contentType}' is not an allowed type for ${purpose}`,
      });
    }
    if (
      request.sizeBytes <= 0 ||
      exceedsLimit(request.sizeBytes, policy.maxSizeBytes)
    ) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `${purpose} uploads must be between 1 and ${policy.maxSizeBytes} bytes`,
      });
    }

    const { objectPath, committedPath } = this.buildObjectPath(
      purpose,
      organizationId,
      request.ownerId,
      request.secondaryOwnerId,
      request.contentType,
    );
    const expiresAt = new Date(Date.now() + this.uploadTtlSeconds * 1000);

    // Recorded BEFORE the URL is handed out. The other order would leave a
    // window in which a usable upload URL existed with nothing authorizing it,
    // and a confirm arriving in that window would be refused for an upload that
    // was perfectly legitimate.
    await this.pending.put(
      {
        objectPath,
        committedPath,
        organizationId,
        actorId,
        contentType: request.contentType,
        sizeBytes: request.sizeBytes,
        originalFileName: request.originalFileName,
      },
      this.uploadTtlSeconds,
    );

    const [uploadUrl] = await this.firebase.bucket
      .file(objectPath)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        // Pinned into the SIGNATURE. A client that PUTs a different type than
        // it declared gets a signature mismatch from Google rather than a
        // successful upload of something the allowlist never saw.
        contentType: request.contentType,
      });

    return { uploadUrl, objectPath, expiresAt: toProtoTimestamp(expiresAt) };
  }

  /**
   * "Was this exact object, at this exact path, something WE authorized THIS
   * caller to create?"
   *
   * That question — not "does an object exist here" — is what makes confirm an
   * authorization check. Every failure answers NOT_FOUND, including the
   * ownership mismatch: the same reasoning every cross-tenant lookup in this
   * codebase uses, since confirming that the path exists at all is itself the
   * leak.
   */
  async confirmUpload(
    request: ConfirmUploadRequest,
    context: CallerContext,
  ): Promise<ConfirmUploadResponse> {
    const organizationId = requireTenant(context);
    const pending = await this.pending.get(request.objectPath);

    // Absent covers three cases that must be indistinguishable: never
    // presigned, expired, and already confirmed once.
    if (pending?.organizationId !== organizationId) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No pending upload for that object path',
      });
    }

    const segregated = pending.committedPath !== request.objectPath;

    let file = this.firebase.bucket.file(request.objectPath);
    let alreadyMoved = false;

    if (!(await file.exists())[0]) {
      // **The crash window between `move()` and `consume()`** — and the reason
      // this is a resumption rather than a refusal.
      //
      // A process that dies in that window leaves the object at the COMMITTED
      // path with the record still keyed to the pending one. Refusing here
      // would then report the opposite of what happened — "no object was
      // uploaded" for an upload that landed AND was committed — and the
      // residue sits outside `pending/`, where the lifecycle rule exists
      // for will never touch it.
      //
      // Nothing can close the window: there is no transaction spanning a bucket
      // and Redis. Making the retry idempotent is strictly better than
      // narrowing it, and costs one `exists()` on a path already in hand.
      const committed = this.firebase.bucket.file(pending.committedPath);
      if (segregated && (await committed.exists())[0]) {
        file = committed;
        alreadyMoved = true;
      } else {
        // The client skipped step 4 of the flow. FAILED_PRECONDITION rather
        // than NOT_FOUND: the authorization passed, and telling them their
        // upload never landed is actionable in a way a 404 would not be.
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'No object was uploaded to that path',
        });
      }
    }

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType ?? pending.contentType;

    // The one point in the whole flow where the server can see the bytes.
    //
    // Until here every check has been about the ENVELOPE — path, tenant,
    // declared type, declared size — and the client writes the envelope. This
    // is what stops `image/png` from being a delivery mechanism for something
    // else entirely, which matters because attachments are served on to other
    // people in the same ticket.
    const [head] = await file.download({
      start: 0,
      end: SIGNATURE_SAMPLE_BYTES - 1,
    });
    if (!matchesDeclaredType(head, contentType)) {
      // Deleted, not merely rejected. The object is already in the bucket by
      // the time confirm runs, so refusing without deleting would leave an
      // unreferenced file that nothing will ever clean up — the caller has no
      // row pointing at it and no reason to try again.
      await file.delete({ ignoreNotFound: true });

      // The PendingUpload is deliberately NOT consumed: uploading the wrong
      // file is a mistake the caller can correct, and burning the record would
      // force a fresh presign for what is a legitimate retry.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'File content does not match its declared type',
      });
    }

    // **The move out of `pending/`**, and the whole reason that
    // prefix exists. Everything still under it after this point is unreferenced
    // by construction, which is what makes a lifecycle rule over it safe.
    //
    // **Before the record is consumed**, so a failure HERE leaves the object
    // exactly where a sweep expects it and the caller free to retry.
    //
    // That ordering narrows the crash window; it does not close it. A death
    // between this line and `consume()` below leaves a committed object with a
    // live record — which the resumption above turns into a successful retry
    // rather than a lie plus an unsweepable orphan. Both halves are needed:
    // this order for the common failure, that check for the remaining one.
    //
    // Skipped when a previous attempt already moved it, and a no-op for every
    // purpose that does not segregate — `committedPath` equals `objectPath`
    // there, and moving a file onto itself is not worth a round trip.
    if (segregated && !alreadyMoved) {
      await file.move(pending.committedPath);
    }

    // Consumed only after everything succeeded. Consuming first would burn the
    // record on a transient metadata failure and leave the caller unable to
    // retry a confirm that would otherwise have worked.
    await this.pending.consume(request.objectPath);

    return {
      // **The COMMITTED path, not the one the caller sent.** The object is no
      // longer at the path they presigned to, and a caller that stored their
      // own copy would write a `file_url` pointing at something a sweep is
      // about to delete.
      objectPath: pending.committedPath,
      // The REAL values from the object, not the ones the client declared at
      // presign. Those were a hint for the policy check; these are what is
      // actually stored, and the caller writes them into its own row.
      // `metadata.size` is typed `string | number | undefined` by the SDK
      // (GCS returns it as a string over JSON), so it is normalized rather than
      // trusted to be a number.
      sizeBytes: Number(metadata.size ?? 0),
      contentType,
    };
  }

  /**
   * Batched from day one.
   *
   * One round trip for N paths, because the alternative is one signing call per
   * file per response: a list of 50 tickets each showing an avatar would be 50
   * calls. A missing object is simply ABSENT from the map rather than an error
   * for the whole batch — the caller decides how to render a missing avatar,
   * and one deleted file must not blank a whole page.
   */
  async getSignedReadUrls(
    request: GetSignedReadUrlsRequest,
    context: CallerContext,
  ): Promise<GetSignedReadUrlsResponse> {
    const organizationId = requireTenant(context);
    const expires = new Date(Date.now() + this.readTtlSeconds * 1000);

    // Deduplicated: the same avatar appearing on twenty rows of a list is one
    // signing call, not twenty.
    const paths = [...new Set(request.objectPaths)].filter(
      // The tenant check, applied to the PATH. `storage-service` cannot know
      // this ticket's ACL and never will — the owning service checks that — but
      // it can and must refuse to sign a path belonging to another tenant
      // outright, which is the one boundary it does own.
      (path) => organizationIdFromObjectPath(path) === organizationId,
    );

    const entries = await Promise.all(
      paths.map(async (objectPath) => {
        try {
          const file = this.firebase.bucket.file(objectPath);
          const [exists] = await file.exists();
          if (!exists) return null;

          const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires,
          });
          return [objectPath, url] as const;
        } catch (error) {
          // One bad path must not fail the batch. Logged rather than raised:
          // the caller gets the other nineteen avatars and renders a
          // placeholder for this one.
          this.logger.warn(
            `Could not sign '${objectPath}': ${formatErrorMsg(error)}`,
          );
          return null;
        }
      }),
    );

    return {
      // A type PREDICATE, not a bare `!== null`. Narrowing a
      // `(readonly [string, string] | null)[]` through `.filter` only works
      // implicitly on TS 5.5+; below that the `null` survives in the type and
      // `Object.fromEntries` has no overload for it. Spelling the predicate out
      // makes the narrowing explicit rather than a property of the compiler
      // version this happens to build with.
      urlsByPath: Object.fromEntries(
        entries.filter(
          (entry): entry is readonly [string, string] => entry !== null,
        ),
      ),
    };
  }

  /**
   * The bytes, STREAMED, for a service rather than a browser.
   *
   * The tenant check is the same one `getSignedReadUrls` applies and it is the
   * only one this service can make: it does not know a document's department
   * scoping and never will — `ingestion-service` checks that before it asks.
   * What this owns is the coarser boundary, that a caller in one tenant cannot
   * read another tenant's object, and that check must not be skipped merely
   * because the caller is an internal service. "Internal" is not a tenant.
   *
   * Streamed rather than returned whole: a 25 MB document against a 10 MB gRPC
   * message limit fails, and it fails on the first real 200-page PDF rather
   * than on any fixture.
   */
  downloadObject(
    request: DownloadObjectRequest,
    context: CallerContext,
  ): Observable<DownloadObjectChunk> {
    const organizationId = requireTenant(context);
    const objectPath = request.objectPath;

    if (organizationIdFromObjectPath(objectPath) !== organizationId) {
      // NOT_FOUND rather than PERMISSION_DENIED, matching every other read in
      // this system: "you may not read this" confirms the object exists, which
      // turns path enumeration into an oracle.
      return throwError(
        () =>
          new RpcException({
            code: status.NOT_FOUND,
            message: 'No such object',
          }),
      );
    }

    return new Observable<DownloadObjectChunk>((subscriber) => {
      const stream = this.firebase.bucket
        .file(objectPath)
        .createReadStream({ validation: false });

      stream.on('data', (data: Buffer) => subscriber.next({ data }));
      stream.on('end', () => subscriber.complete());
      stream.on('error', (error: unknown) => {
        this.logger.warn(
          `Could not read '${objectPath}': ${formatErrorMsg(error)}`,
        );
        subscriber.error(
          new RpcException({
            code: status.NOT_FOUND,
            message: 'No such object',
          }),
        );
      });

      // Unsubscribing must destroy the stream, or a cancelled download leaks a
      // socket per call — and the worker cancels routinely, because a job that
      // times out mid-download is the ordinary case rather than the strange one.
      return () => stream.destroy();
    });
  }

  // -------------------------------------------------------------------------

  /**
   * The path, built from the CALLER'S tenant and the purpose's prefix.
   *
   * The filename is a fresh uuid with an extension derived from the MIME type —
   * never the client's own name, and never its extension. That is what makes a
   * `.php` disguised as a `.jpg` a non-event, and what makes two people
   * uploading `screenshot.png` on the same day structurally unable to collide.
   */
  private buildObjectPath(
    purpose: StoragePurpose,
    organizationId: string,
    ownerId: string,
    secondaryOwnerId: string,
    contentType: string,
  ): { objectPath: string; committedPath: string } {
    const policy = PURPOSE_POLICY[purpose];
    const fileName = `${randomUUID()}.${extensionFor(contentType)}`;
    const base = `organizations/${organizationId}/${policy.prefix}`;

    if (purpose !== StoragePurpose.TICKET_ATTACHMENT) {
      // **No segregation for the other purposes**, and it would buy nothing.
      // An avatar, a document and an export are each referenced by a row
      // written in the same call that confirms them, so there is no window in
      // which one exists unreferenced by a user changing their mind.
      const path = `${base}/${ownerId}/${fileName}`;

      return { objectPath: path, committedPath: path };
    }

    // **The message segment is omitted rather than filled with a placeholder**
    // when the message does not exist yet. A literal `pending`
    // would read as a real message id to anyone browsing the bucket, and would
    // be the one path segment that means something different from all the
    // others.
    const attachments = `${base}/${ownerId}/attachments`;
    const suffix = secondaryOwnerId
      ? `${secondaryOwnerId}/${fileName}`
      : fileName;

    return {
      // **Uploaded under `pending/`, committed out of it**.
      //
      // Nothing else makes the prefix sweepable. `confirmUpload` never moved
      // the object, so a live attachment on a real ticket had the same path
      // shape as one somebody uploaded and abandoned — and a lifecycle rule
      // over `**/attachments/**` would have deleted both. Under `pending/`
      // everything is unreferenced BY CONSTRUCTION, which is what makes the
      // rule safe to enable.
      //
      // Inserted after `attachments`, not before `organizations`: the tenant
      // check in `organizationIdFromObjectPath` reads segment 2, and this
      // leaves it exactly where it was.
      objectPath: `${attachments}/pending/${suffix}`,
      committedPath: `${attachments}/${suffix}`,
    };
  }

  private requirePurpose(purpose: ProtoStoragePurpose): StoragePurpose {
    const domain = fromProtoStoragePurpose(purpose);
    if (!domain) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'A storage purpose is required',
      });
    }

    return domain;
  }
}
