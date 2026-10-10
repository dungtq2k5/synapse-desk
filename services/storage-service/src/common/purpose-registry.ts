import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ALLOWED_DOCUMENT_MIME_TYPES,
  AVATAR_MIME_TYPES,
  EXPORT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_AVATAR_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_EXPORT_BYTES,
  StoragePurpose,
} from '@synapsedesk/common';
import type { ValidatedMimeType } from './content-signature';

/**
 * What each purpose allows.
 *
 * ONE table, not a `switch` scattered across handlers. Three things have to
 * move together whenever a purpose changes (the allowlist, the cap, and the
 * path prefix), and three `switch` statements in three files is how two of them
 * end up updated.
 *
 * `Record<StoragePurpose, …>` rather than a partial map: adding a purpose to
 * the enum without a policy is then a compile error, which is the only moment
 * anyone is thinking about it.
 */
export type PurposePolicy = {
  /**
   * **`ValidatedMimeType`, not `MimeType`** — narrower on purpose.
   *
   * `matchesDeclaredType` fails closed, so a type allowlisted here without a
   * matcher in `content-signature.ts` is accepted at presign and REJECTED at
   * confirm, once the bytes are already in the bucket. This type is what turns
   * that into a compile error at the assignment below, where the two lists
   * meet: the constants stay `MimeType[]` in `libs/`, which cannot know about
   * this service's validator.
   */
  mimeAllowlist: readonly ValidatedMimeType[];
  maxSizeBytes: number;
  /** The path segment under `organizations/{orgId}/`. */
  prefix: string;
  /**
   * Whether the path CAN take a second owner id — a message, for an attachment.
   *
   * **Permitted, not required**. It was required until the
   * one-shot case turned up: presign and confirm both took a `message_id`, so
   * the attachment row could only exist after the message did, while
   * `invoke_ai` runs during the create. The screenshot arrived a moment too
   * late to be read.
   *
   * Now a ticket attachment may be presigned before its message exists, and the
   * segment is simply absent from the path. **Nothing depends on the shape**:
   * no code in this repo parses an object path, there is no prefix-based
   * delete, and the authorization is the Redis record plus the tenant check —
   * never the path. What the segment buys is a readable bucket, which is worth
   * having when there is a message to name and worth nothing when there is not.
   */
  allowsSecondaryOwner: boolean;
};

export const PURPOSE_POLICY: Record<StoragePurpose, PurposePolicy> = {
  [StoragePurpose.AVATAR]: {
    mimeAllowlist: AVATAR_MIME_TYPES,
    maxSizeBytes: MAX_AVATAR_BYTES,
    prefix: 'avatars',
    allowsSecondaryOwner: false,
  },
  [StoragePurpose.TICKET_ATTACHMENT]: {
    mimeAllowlist: ALLOWED_ATTACHMENT_MIME_TYPES,
    maxSizeBytes: MAX_ATTACHMENT_BYTES,
    prefix: 'tickets',
    allowsSecondaryOwner: true,
  },
  [StoragePurpose.EXPORT]: {
    mimeAllowlist: EXPORT_MIME_TYPES,
    maxSizeBytes: MAX_EXPORT_BYTES,
    prefix: 'exports',
    allowsSecondaryOwner: false,
  },
  [StoragePurpose.DOCUMENT]: {
    mimeAllowlist: ALLOWED_DOCUMENT_MIME_TYPES,
    maxSizeBytes: MAX_DOCUMENT_BYTES,
    prefix: 'documents',
    allowsSecondaryOwner: false,
  },
};

/**
 * Re-exported so call sites here need one import, not two.
 *
 * The table itself lives in `libs/common` beside the vocabulary: storage-service
 * names an object's extension and ingestion-service writes the same string into
 * `documents.file_type`, and they had drifted into two tables mapping the same
 * thing.
 */
export { extensionFor } from '@synapsedesk/common';
