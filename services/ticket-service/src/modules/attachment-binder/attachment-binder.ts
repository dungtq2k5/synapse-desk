import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { PARSE_ELIGIBLE_MIME_TYPES } from '@synapsedesk/contracts';
import type { CallerContext } from '@synapsedesk/contracts';
import type { NewAttachment } from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/nest-common';
import { AttachmentExtractorClient } from '../ai-client/attachment-extractor.client';
import { StorageReferenceService } from '../storage-client/storage-reference.service';

/** A confirmed file, ready to be written on a message or a ticket's opening. */
export type ConfirmedAttachment = {
  fileName: string;
  fileUrl: string;
  fileSizeBytes: bigint;
  mimeType: string;
  extractedText: string | null;
};

/**
 * Binds uploaded files: confirms each path with storage-service and extracts
 * what the model can read. One place for both writes that take files, a
 * message (`CreateMessage`) and a ticket's opening (`CreateTicket`), so the
 * two can't disagree about what a confirmed file is.
 */
@Injectable()
export class AttachmentBinder {
  private readonly logger = new Logger(AttachmentBinder.name);

  constructor(
    private readonly storage: StorageReferenceService,
    private readonly extractor: AttachmentExtractorClient,
  ) {}

  /**
   * Confirms every uploaded path, and reports the ones that did not.
   *
   * Sequential rather than `Promise.all`: these are writes against a peer, the
   * count is capped at the tenant's per-message limit, and a burst of
   * parallel confirms buys milliseconds while making the failure modes harder
   * to reason about.
   */
  async confirmNewAttachments(
    attachments: NewAttachment[],
    context: CallerContext,
  ): Promise<{
    confirmed: ConfirmedAttachment[];
    skippedAttachments: string[];
  }> {
    const confirmed: ConfirmedAttachment[] = [];
    const skippedAttachments: string[] = [];

    for (const attachment of attachments) {
      const fileName = requireFileName(attachment.fileName);

      try {
        const object = await this.storage.confirmUpload(
          attachment.objectPath,
          context,
        );

        confirmed.push({
          fileName,
          // An object PATH, never a URL — the same rule `confirmAttachment`
          // follows, so a read resolves a fresh signed URL rather than trusting
          // one stored months ago.
          //
          // **`object.objectPath`, not `attachment.objectPath`**
          // The caller presigned into `pending/` and the object has
          // just moved out of it; storing what the client sent would record the
          // one path a lifecycle sweep is entitled to delete.
          fileUrl: object.objectPath,
          // Read back from the OBJECT, never from what the client declared.
          // Moving the confirm did not move that: a row built from the caller's
          // claims would record whatever they felt like claiming.
          fileSizeBytes: BigInt(object.sizeBytes),
          mimeType: object.contentType,
          // **The single extraction hook, and it has to be this one.** Both
          // attachment routes reach here — a client confirming its own upload,
          // and `createMessage` writing a message that arrived with files
          // already in storage. That second one is the path inbound email's
          // attachments take: objects already in storage arrive as paths, and
          // this is where they are confirmed.
          //
          // Hooking `confirmAttachment` alone would have left every emailed
          // office attachment unextracted, permanently and silently — on the
          // surface `injection.py` calls the highest-trust position an
          // untrusted file reaches in this system, because nobody sending it
          // ever authenticated.
          //
          // `object.contentType` for the same reason the column above uses it.
          extractedText: await this.extractIfParseable(
            object.objectPath,
            object.contentType,
            context,
          ),
        });
      } catch (error) {
        // **Named, not thrown.** An expired presign, a forged path and an
        // already-confirmed one are indistinguishable by design, so there is no
        // message this could produce that is both honest and useful — and the
        // typed message must survive either way.
        this.logger.warn(
          `Attachment could not be confirmed: ${formatErrorMsg(error)}`,
        );
        skippedAttachments.push(fileName);
      }
    }

    return { confirmed, skippedAttachments };
  }

  /**
   * The markdown for a parse-eligible attachment, or `null` for everything else.
   *
   * **Three outcomes, and the column holds all three.** `null` when nothing was
   * attempted — a `.png`, a `.doc`, a type with no parser — or when the attempt
   * failed. `''` when a parser ran and the file genuinely had no text. Text
   * when it worked. The feed path treats the first two identically and the
   * DIFFERENCE is for whoever debugs it later, which is why a `String[]` would
   * not do: Prisma scalar lists cannot be null.
   *
   * **Never throws**, because every caller is inside a confirm. `AttachmentExtractorClient`
   * already swallows its own failures; the eligibility check here is what stops
   * a `.png` costing a pointless round trip to ingestion-service.
   *
   * @param objectPath the CONFIRMED path, after the object left `pending/`.
   * @param mimeType read back from the object, never client-declared.
   */
  async extractIfParseable(
    objectPath: string,
    mimeType: string,
    context: CallerContext,
  ): Promise<string | null> {
    if (!(PARSE_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      return null;
    }

    return this.extractor.extract(objectPath, mimeType, context);
  }
}

/** A file name a row can store: trimmed, at most 255 characters. */
export function requireFileName(fileName: string): string {
  const trimmed = fileName?.trim() ?? '';
  if (!trimmed) {
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'A file name is required',
    });
  }

  return trimmed.slice(0, 255);
}
