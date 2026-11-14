import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import {
  CallerContext,
  DOCUMENT_SERVICE_NAME,
  DocumentServiceClient,
  INGESTION_GRPC_CLIENT,
  packRequestContext,
} from '@synapsedesk/grpc-proto';
import { formatErrorMsg } from '@synapsedesk/nest-common';

/**
 * Longer than `GRPC_DEADLINE_MS`, because this is a PARSE and not a lookup.
 *
 * A 10 MB `.docx` is downloaded from storage inside ingestion-service and then
 * run through mammoth and turndown. The deadline sized for a database read
 * would time out on exactly the large documents this exists for — which reads
 * as "big attachments silently lose their text" rather than as a timeout.
 */
const EXTRACT_DEADLINE_MS = 60_000;

/**
 * ticket-service's view of ingestion-service's parser.
 *
 * **Never throws.** Every caller is inside a confirm, and an attachment the
 * model cannot read is still a perfectly good attachment for a human. Refusing
 * an upload because a parser was unavailable would be the wrong direction, and
 * it is the trade `INGESTION_GRPC_CLIENT`'s own registration already documents:
 * an unset URL *"makes the outcome write fail and be logged, which costs a
 * metric — not a reply."*
 *
 * `null` means "no text stored", and the column is nullable for exactly that.
 */
@Injectable()
export class AttachmentExtractorClient implements OnModuleInit {
  private readonly logger = new Logger(AttachmentExtractorClient.name);

  private documents!: DocumentServiceClient;

  constructor(
    @Inject(INGESTION_GRPC_CLIENT) private readonly client: ClientGrpc,
  ) {}

  onModuleInit(): void {
    this.documents = this.client.getService<DocumentServiceClient>(
      DOCUMENT_SERVICE_NAME,
    );
  }

  /**
   * The markdown for one confirmed object, or `null` if anything went wrong.
   *
   * @param objectPath the CONFIRMED path — the object has left `pending/`.
   * @param mimeType read back from the object, never client-declared.
   * @param context the caller's, so ingestion-service scopes the download.
   */
  async extract(
    objectPath: string,
    mimeType: string,
    context: CallerContext,
  ): Promise<string | null> {
    const result = await this.attempt(objectPath, mimeType, context);
    return result.ok ? result.markdown : null;
  }

  /**
   * One extraction, saying how it failed: the gRPC code ingestion-service
   * answered, or `null` when none came back (a local timeout). The hourly
   * retry needs that to tell a corrupt file or an ineligible type from an
   * ingestion-service that was down. Never throws.
   *
   * @example
   * const result = await extractor.attempt(path, mime, ctx);
   * if (!result.ok && result.code === status.INVALID_ARGUMENT) giveUp();
   */
  async attempt(
    objectPath: string,
    mimeType: string,
    context: CallerContext,
  ): Promise<ExtractionAttempt> {
    try {
      const response = await firstValueFrom(
        this.documents
          .extractAttachmentText(
            { objectPath, mimeType },
            packRequestContext(context),
          )
          .pipe(timeout(EXTRACT_DEADLINE_MS)),
      );

      return { ok: true, markdown: response.markdown };
    } catch (error) {
      // `warn`, not `error`: the upload succeeded, the file is downloadable,
      // and the user loses only the model's view of it — which they are told
      // about through `skippedAttachments` at feed time.
      this.logger.warn(
        `Could not extract text from '${objectPath}' (${mimeType}): ${formatErrorMsg(error)}`,
      );
      const code = (error as { code?: unknown } | null)?.code;

      return { ok: false, code: typeof code === 'number' ? code : null };
    }
  }
}

/** One extraction's result: the markdown, or the gRPC code it failed with. */
export type ExtractionAttempt =
  { ok: true; markdown: string } | { ok: false; code: number | null };
