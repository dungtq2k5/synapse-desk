/**
 * @file The storage contract: the object path scheme and the async delete.
 *
 * Lives in `libs/common` rather than in `storage-service` because BOTH ends
 * need it: the owning services build/consume object paths and emit the delete
 * event, and `storage-service` reads them. A second definition on either side
 * is how a path scheme drifts, and a drifted path is an orphaned file nobody
 * can find again.
 */

/**
 * What a stored object is FOR.
 *
 * The purpose decides the path prefix, the mime allowlist and the size cap —
 * three things that must move together. Adding a purpose without a policy entry
 * is a compile error by construction (see `PURPOSE_POLICY` in storage-service).
 */
export enum StoragePurpose {
  AVATAR = 'AVATAR',
  TICKET_ATTACHMENT = 'TICKET_ATTACHMENT',
  /** Reserved for Domain C's `ingestion-service`. No caller today. */
  DOCUMENT = 'DOCUMENT',
  /**
   * An analytics export.
   *
   * A new purpose rather than a second file path: the signed-URL discipline,
   * the tenant path prefix and the deletion story all already exist here, and
   * inventing a parallel mechanism for one feature is how a bucket ends up with
   * two sets of rules.
   *
   * **A signed URL to a file containing a tenant's full ticket history is a
   * CREDENTIAL.** Short expiry on the URL, and a retention policy on the
   * object — see `PURPOSE_POLICY`.
   */
  EXPORT = 'EXPORT',
}

export const STORAGE_PATTERNS = {
  objectSuperseded: 'storage.object.superseded',
} as const;

export type StoragePattern =
  (typeof STORAGE_PATTERNS)[keyof typeof STORAGE_PATTERNS];

/**
 * Why an object is being deleted.
 *
 * Recorded rather than inferred, because the two cases have different
 * implications for anyone auditing storage later: REPLACED is routine churn, a
 * RECORD_DELETED is somebody removing something on purpose.
 */
export enum SupersededReason {
  /** A new avatar took the old one's place. */
  REPLACED = 'REPLACED',
  /** The row referencing this object was removed. */
  RECORD_DELETED = 'RECORD_DELETED',
}

export type ObjectSupersededEvent = {
  /**
   * The OLD path being replaced or removed — NEVER the new one.
   *
   * Worth stating twice, because emitting the new path is a single-character
   * mistake at the call site and it deletes the file the user just uploaded.
   * The owning services read the current value BEFORE overwriting it for
   * exactly this reason.
   */
  objectPath: string;
  reason: SupersededReason;
};

/**
 * The path scheme, as functions.
 *
 * Functions rather than a documented convention, because every consequence of
 * getting a path wrong is silent: a mistyped prefix writes an object nothing
 * will ever look for, and a missing tenant segment puts one customer's file
 * where another customer's ACL governs it.
 *
 * The FILENAME is always a fresh uuid, never the original. The human-readable
 * name is served back through the signed URL's content-disposition instead, so
 * the path carries nothing worth protecting and two people uploading
 * `screenshot.png` on the same day cannot collide.
 */
export function avatarObjectPath(
  organizationId: string,
  userId: string,
  fileName: string,
): string {
  return `organizations/${organizationId}/avatars/${userId}/${fileName}`;
}

export function ticketAttachmentObjectPath(
  organizationId: string,
  ticketId: string,
  messageId: string,
  fileName: string,
): string {
  return `organizations/${organizationId}/tickets/${ticketId}/attachments/${messageId}/${fileName}`;
}

/** Reserved — Domain C. Present so the scheme is complete in one place. */
export function documentObjectPath(
  organizationId: string,
  documentId: string,
  fileName: string,
): string {
  return `organizations/${organizationId}/documents/${documentId}/${fileName}`;
}

/**
 * The tenant segment of a path, or null if it has none.
 *
 * Used to re-check that an object a caller is confirming lives under THEIR
 * organization.2's authorization check, and the reason the tenant is the
 * first segment rather than buried mid-path.
 */
export function organizationIdFromObjectPath(
  objectPath: string,
): string | null {
  const match = /^organizations\/([^/]+)\//.exec(objectPath);
  return match?.[1] ?? null;
}

/**
 * Whether a value is one of OUR object paths rather than some other string.
 *
 * Columns like `users.avatar_url` and `attachments.file_url` hold an internal
 * object path, never a URL. An external URL reaching them is not a cosmetic
 * mismatch: it flows on to `bucket.file(value).delete()` through the supersede
 * event, and it silently defeats the tenant check in
 * `organizationIdFromObjectPath`, which returns null for anything else.
 *
 * Defined next to the path builders on purpose — this predicate and the
 * `organizations/...` scheme they produce have to change together.
 */
export function isStorageObjectPath(value: string): boolean {
  return organizationIdFromObjectPath(value) !== null;
}
