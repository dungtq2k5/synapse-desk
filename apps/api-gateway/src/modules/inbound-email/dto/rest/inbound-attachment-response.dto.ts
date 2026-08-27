/**
 * @file What the Worker's presign route RETURNS.
 *
 * Split out of `inbound-attachment.dto.ts`, which held both halves. §12.1's rule
 * is not about tidiness: a `ValidationPipe` runs on request DTOs and never on
 * response ones, so "does this class get validated?" has to be answerable from
 * the import line. These three carry no validators — correctly, and invisibly so
 * while they sat among classes that do.
 */

/**
 * One file the Worker may now PUT to storage.
 *
 * `objectPath` is handed back on the webhook as `attachments[].objectPath`,
 * which is how the message write binds the bytes to the ticket.
 */
export class InboundAttachmentPresignResponseDto {
  fileName!: string;
  uploadUrl!: string;
  objectPath!: string;
}

/**
 * Why one file will not be uploaded.
 *
 * **Named rather than silently omitted**, so the Worker can put it in
 * `droppedAttachments` and the ticket can still say what was left out. "My
 * attachment vanished" is something a customer discovers before you do — the
 * same rule set when attachments were dropped wholesale.
 */
export class InboundAttachmentDeclinedResponseDto {
  fileName!: string;
  reason!: string;
}

/** Every presented file, sorted into the ones that may be uploaded and the rest. */
export class InboundAttachmentUploadResponseDto {
  uploads!: InboundAttachmentPresignResponseDto[];
  declined!: InboundAttachmentDeclinedResponseDto[];
}
