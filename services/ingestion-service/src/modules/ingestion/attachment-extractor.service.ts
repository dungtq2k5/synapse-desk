import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  CHARACTER_TRUNCATION_MARKER,
  sectionTruncationMarker,
  MAX_EXTRACTED_TEXT_CHARS,
  PARSE_ELIGIBLE_MIME_TYPES,
  extensionFor,
  formatErrorMsg,
} from '@synapsedesk/common';
import { DocumentParserService } from './document-parser.service';
import { StorageReferenceService } from '../storage-client/storage-reference.service';

/** What `parse()`'s pages are joined with — one blank line, as markdown wants. */
const SEPARATOR = '\n\n';

/**
 * Room reserved for {@link sectionTruncationMarker}.
 *
 * Its length varies with the two counts, so this is a fixed over-allocation
 * rather than a measurement — the marker is ~60 characters at any realistic
 * page count, and being generous here costs a rounding error of the budget.
 */
const MARKER_HEADROOM = 120;

/**
 * Parse-as-a-service for ticket attachments.
 *
 * **Here rather than in ticket-service because the parser is here**, and
 * because the alternative is mammoth — and later a spreadsheet library — in
 * `@synapsedesk/common`, which every service imports. One rpc costs one hop; a
 * shared package costs the dependency in six processes to serve one.
 *
 * **It reuses `DocumentParserService` rather than reimplementing it.** A second
 * docx path would drift from the first, and the first is the one with
 * `markFirstTableRowAsHeader` on it — the hook that keeps GFM tables intact
 * through turndown. A quote table that survives ingestion and collapses in an
 * attachment would be a difference nobody could explain.
 *
 * Everything here is best-effort from the CALLER's point of view: `confirm`
 * must not fail because a parser did. That decision lives at the call site in
 * ticket-service, not in this service, which reports failures honestly.
 */
@Injectable()
export class AttachmentExtractorService {
  private readonly logger = new Logger(AttachmentExtractorService.name);

  constructor(
    private readonly parser: DocumentParserService,
    private readonly storage: StorageReferenceService,
  ) {}

  /**
   * One stored object to markdown, capped.
   *
   * @param objectPath the confirmed path — never a `pending/` one.
   * @param mimeType read back from the object at confirm, never client-declared.
   * @param organizationId the tenant, for storage-service's own path check.
   * @throws RpcException `INVALID_ARGUMENT` when the type has no parser.
   * @throws RpcException `INTERNAL` when the parse itself failed.
   */
  async extract(
    objectPath: string,
    mimeType: string,
    organizationId: string,
  ): Promise<{ markdown: string; truncated: boolean }> {
    if (!(PARSE_ELIGIBLE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      // INVALID_ARGUMENT, not an empty success. `''` is a real answer — "this
      // parsed to nothing" — and handing it back for a type nobody can parse
      // would make the two indistinguishable in the caller's column.
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `No parser for '${mimeType}'`,
      });
    }

    const bytes = await this.storage.downloadObject(objectPath, organizationId);

    let pages: string[];
    try {
      // The EXTENSION, because that is what `parse` switches on — it takes a
      // file type, not a MIME type, and the mapping already exists for exactly
      // this translation.
      const parsed = await this.parser.parse(bytes, extensionFor(mimeType));
      pages = parsed.pages.map((page) => page.markdown);
    } catch (error) {
      // Named for the operator and rethrown for the caller. ticket-service
      // turns this into a stored `null`; this service's job is to be honest
      // that it could not do the work.
      this.logger.warn(
        `Could not extract '${objectPath}' (${mimeType}): ${formatErrorMsg(error)}`,
      );

      throw new RpcException({
        code: status.INTERNAL,
        message: `Could not extract text from this ${mimeType} attachment`,
      });
    }

    return this.cap(pages);
  }

  /**
   * The per-attachment character cap, applied where the text is STORED.
   *
   * **Two stops, and the outer one is on PAGES.** Joining first and slicing
   * afterwards cuts mid-table: a half-row, and no account of what is missing.
   * Accumulating page by page and stopping before the one that would overflow
   * leaves every included page whole, and says how many were dropped.
   *
   * **"Pages", not "sheets", and that is not pedantry.** This service is
   * deliberately format-blind — it receives `ParsedPage[]` and cannot see that a
   * page is a worksheet. Phrased on pages the rule is right for `.docx` (one
   * page, so it never fires) and for every format added later, with no
   * `if (mimeType === …)` anywhere. Phrased on sheets, this class becomes half a
   * parser, which is the thing its own docblock argues against.
   *
   * The character slice survives as the BACKSTOP for the case pages cannot
   * cover: a single page bigger than the entire budget, where dropping it would
   * store nothing at all.
   *
   * The per-MESSAGE cap is not here and cannot be: this sees one attachment,
   * and `confirmAttachment` calls it once per file with no view of the
   * siblings. That one is spent down at feed, in the loop that already spends
   * `MAX_AI_ATTACHMENT_BYTES`.
   */
  private cap(pages: string[]): { markdown: string; truncated: boolean } {
    const joined = pages.join(SEPARATOR);
    if (joined.length <= MAX_EXTRACTED_TEXT_CHARS) {
      return { markdown: joined, truncated: false };
    }

    const kept: string[] = [];
    let used = 0;

    for (const page of pages) {
      const cost = page.length + (kept.length > 0 ? SEPARATOR.length : 0);
      // Budget for the marker itself, so the stored value honours the cap
      // rather than exceeding it by the width of its own warning.
      if (used + cost > MAX_EXTRACTED_TEXT_CHARS - MARKER_HEADROOM) break;

      kept.push(page);
      used += cost;
    }

    if (kept.length > 0) {
      return {
        markdown:
          kept.join(SEPARATOR) +
          sectionTruncationMarker(kept.length, pages.length),
        truncated: true,
      };
    }

    // Not one page fits — a single sheet, or a `.docx`, larger than the whole
    // budget. A page-boundary stop would store NOTHING here, so the character
    // slice takes over: a cut table is worse than a whole one and much better
    // than an empty column.
    const room = MAX_EXTRACTED_TEXT_CHARS - CHARACTER_TRUNCATION_MARKER.length;

    return {
      markdown: joined.slice(0, room) + CHARACTER_TRUNCATION_MARKER,
      truncated: true,
    };
  }
}
